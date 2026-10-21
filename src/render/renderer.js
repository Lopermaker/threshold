// Deferred WebGL2 renderer for the game view. See shaders.js for the pass order.

import * as S from './shaders.js';
import { createProgram, use, createTexture, createFBO, bindTarget, createGeometry, createInstanced, drawInstances } from './gl.js';
import { TILE, HW } from '../world/world.js';

export const GORE_SPAN = 64;      // meters covered by the toroidal floor gore map
export const GORE_RES = 2048;     // texels per side (32 per meter)

// Graybox values used until a real texture set is loaded: [r, g, b, roughness].
const GRAYBOX = [
  [0.40, 0.36, 0.23, 0.96],   // carpet
  [0.66, 0.58, 0.33, 0.78],   // wallpaper
  [0.46, 0.45, 0.43, 0.88],   // concrete
  [0.30, 0.31, 0.32, 0.42],   // metal
];

export class Renderer {
  constructor(gl) {
    this.gl = gl;
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('This GPU/browser cannot render to float targets (EXT_color_buffer_float).');
    gl.getExtension('OES_texture_float_linear');
    this.geo = createGeometry(gl);
    const P = (fs, name, vs = S.VS_FULL) => createProgram(gl, vs, fs, name);
    this.p = {
      shadow: P(S.FS_SHADOW, 'shadow'),
      world: P(S.FS_WORLD, 'world'),
      entity: P(S.FS_ENTITY, 'entity', S.VS_ENTITY),
      light: P(S.FS_LIGHT, 'light'),
      line: P(S.FS_LINE, 'line', S.VS_LINE),
      fog: P(S.FS_FOG, 'fog'),
      compose: P(S.FS_COMPOSE, 'compose'),
      dust: P(S.FS_DUST, 'dust', S.VS_DUST),
      down: P(S.FS_DOWN, 'down'),
      blur: P(S.FS_BLUR, 'blur'),
      post: P(S.FS_POST, 'post'),
      splat: P(S.FS_SPLAT, 'splat', S.VS_SPLAT),
    };
    this.entities = createInstanced(gl, this.geo.quadBuf, 4, 8192);
    this.player = createInstanced(gl, this.geo.quadBuf, 4, 1);
    this.lines = createInstanced(gl, this.geo.quadBuf, 3, 2048);
    this.splats = createInstanced(gl, this.geo.quadBuf, 3, 8192);
    this.dust = createInstanced(gl, this.geo.quadBuf, 1, 6000);
    for (let i = 0; i < 6000; i++) {
      this.dust.data.set([Math.random(), Math.random(), Math.random(), 0.010 + Math.random() * 0.018], i * 4);
    }

    // Map window, distance field, shadow atlas, gore map.
    this.mapTex = createTexture(gl, { w:128, h:128, ifmt:gl.RGBA8, fmt:gl.RGBA, type:gl.UNSIGNED_BYTE, filter:gl.NEAREST });
    this.sdfTex = createTexture(gl, { w:512, h:512, ifmt:gl.R8, fmt:gl.RED, type:gl.UNSIGNED_BYTE, filter:gl.LINEAR });
    this.shadowTex = createTexture(gl, { w:S.SHADOW_W, h:S.MAXL, ifmt:gl.R32F, fmt:gl.RED, type:gl.FLOAT, filter:gl.NEAREST, wrapS:gl.REPEAT });
    this.shadowFBO = createFBO(gl, [this.shadowTex]);
    this.goreTex = createTexture(gl, { w:GORE_RES, h:GORE_RES, ifmt:gl.RGBA8, fmt:gl.RGBA, type:gl.UNSIGNED_BYTE, filter:gl.LINEAR, wrapS:gl.REPEAT, wrapT:gl.REPEAT });
    this.goreFBO = createFBO(gl, [this.goreTex]);
    this.wallTex = createTexture(gl, { w:2048, h:2048, ifmt:gl.RGBA8, fmt:gl.RGBA, type:gl.UNSIGNED_BYTE, filter:gl.LINEAR });
    this.wallFBO = createFBO(gl, [this.wallTex]);
    this.faceTex = createTexture(gl, { w:128, h:128, ifmt:gl.RGBA16UI, fmt:gl.RGBA_INTEGER, type:gl.UNSIGNED_SHORT, filter:gl.NEAREST });
    this.wallSplat = createInstanced(gl, this.geo.quadBuf, 3, 1);
    this.clearGore();

    // Materials: albedo (rgb + roughness in alpha) and tangent-space normal.
    this.alb = GRAYBOX.map(c => this.solid(c.map(v => Math.round(v * 255))));
    this.nrm = GRAYBOX.map(() => this.solid([128, 128, 255, 255]));
    this.matLoaded = [0, 0, 0, 0];
    this.matScale = [2.0, 1.6, 2.4, 1.0];
    this.size = { w:0, h:0 };
  }

  solid(rgba) {
    const gl = this.gl;
    return createTexture(gl, { w:1, h:1, ifmt:gl.RGBA8, fmt:gl.RGBA, type:gl.UNSIGNED_BYTE, filter:gl.NEAREST, wrapS:gl.REPEAT, wrapT:gl.REPEAT, data:new Uint8Array(rgba) });
  }

  // source: ImageBitmap / canvas. kind: 'albedo' | 'normal'.
  setMaterial(index, kind, source) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
    (kind === 'normal' ? this.nrm : this.alb)[index] = t;
    if (kind === 'albedo') this.matLoaded[index] = 1;
  }

  resize(cssW, cssH, dpr, scale) {
    const gl = this.gl;
    const w = Math.max(64, Math.round(cssW * dpr * scale)), h = Math.max(64, Math.round(cssH * dpr * scale));
    if (w === this.size.w && h === this.size.h) return;
    this.size = { w, h };
    const F16 = { ifmt:gl.RGBA16F, fmt:gl.RGBA, type:gl.HALF_FLOAT };
    const U8 = { ifmt:gl.RGBA8, fmt:gl.RGBA, type:gl.UNSIGNED_BYTE };
    this.depth = createTexture(gl, { w, h, ifmt:gl.DEPTH_COMPONENT24, fmt:gl.DEPTH_COMPONENT, type:gl.UNSIGNED_INT, filter:gl.NEAREST });
    this.gAlb = createTexture(gl, { w, h, ...U8, filter:gl.NEAREST });
    this.gNrm = createTexture(gl, { w, h, ...U8, filter:gl.NEAREST });
    this.gPos = createTexture(gl, { w, h, ...F16, filter:gl.NEAREST });
    this.gFBO = createFBO(gl, [this.gAlb, this.gNrm, this.gPos], this.depth);
    this.litTex = createTexture(gl, { w, h, ...F16 });
    this.litFBO = createFBO(gl, [this.litTex], this.depth);
    const fw = Math.max(16, w >> 2), fh = Math.max(16, h >> 2);
    this.fogTex = createTexture(gl, { w:fw, h:fh, ...F16 });
    this.fogFBO = createFBO(gl, [this.fogTex]);
    this.compTex = createTexture(gl, { w, h, ...F16 });
    this.compFBO = createFBO(gl, [this.compTex]);
    this.pyr = [];
    let lw = w, lh = h;
    for (let i = 0; i < 3; i++) {
      lw = Math.max(8, lw >> 1); lh = Math.max(8, lh >> 1);
      const a = createTexture(gl, { w:lw, h:lh, ...F16 }), b = createTexture(gl, { w:lw, h:lh, ...F16 });
      this.pyr.push({ a, b, fa:createFBO(gl, [a]), fb:createFBO(gl, [b]), w:lw, h:lh });
    }
  }

  uploadMap(win) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.mapTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, win.size, win.size, gl.RGBA, gl.UNSIGNED_BYTE, win.texData);
  }

  uploadSDF(sdf) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.sdfTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, sdf.size, sdf.size, gl.RED, gl.UNSIGNED_BYTE, sdf.data);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  }

  clearGore() {
    const gl = this.gl;
    for (const f of [this.goreFBO, this.wallFBO]) {
      bindTarget(gl, f);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    bindTarget(gl, null);
  }

  clearWallSlot(x, y, w, h) { this.clearGoreRect(x, y, w, h, this.wallFBO); }

  uploadFaceSlots(data, size) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.faceTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, size, size, gl.RGBA_INTEGER, gl.UNSIGNED_SHORT, data);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  }

  // One splat into one wall-atlas slot, scissored so it cannot bleed into a neighbour slot.
  paintWallSplat(x, y, w, h, inst) {
    const gl = this.gl;
    bindTarget(gl, this.wallFBO);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(x, y, w, h);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.MAX);
    use(this.p.splat, { uRes:[2048, 2048] });
    this.wallSplat.data.set(inst, 0);
    this.wallSplat.count = 1;
    drawInstances(gl, this.wallSplat);
    gl.blendEquation(gl.FUNC_ADD);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    bindTarget(gl, null);
  }

  clearGoreRect(x, y, w, h, target = this.goreFBO) {
    const gl = this.gl;
    bindTarget(gl, target);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(x, y, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.SCISSOR_TEST);
    bindTarget(gl, null);
  }

  // Splats are already packed by gore.js into this.splats.data / count.
  paintGore() {
    const gl = this.gl;
    if (!this.splats.count) return;
    bindTarget(gl, this.goreFBO);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.MAX);
    use(this.p.splat, { uRes:[GORE_RES, GORE_RES] });
    drawInstances(gl, this.splats);
    gl.blendEquation(gl.FUNC_ADD);
    gl.disable(gl.BLEND);
    this.splats.count = 0;
  }

  packLights(lights, cam) {
    const n = Math.min(lights.length, S.MAXL);
    const pos = new Float32Array(S.MAXL * 4), col = new Float32Array(S.MAXL * 4);
    const dir = new Float32Array(S.MAXL * 4), ext = new Float32Array(S.MAXL * 4), world = new Float32Array(S.MAXL * 4);
    for (let i = 0; i < n; i++) {
      const L = lights[i];
      pos.set([L.x - cam.x, L.y - cam.y, L.z, L.range], i * 4);
      world.set([L.x, L.y, 0, L.range], i * 4);
      col.set([L.r * L.intensity, L.g * L.intensity, L.b * L.intensity, L.spot ? 1 : 0], i * 4);
      dir.set([L.dx || 0, L.dy || 0, L.dz || 0, L.cosOuter || 0], i * 4);
      ext.set([L.cosInner || 0, i, L.shadow === false ? 0 : 1, 0], i * 4);
    }
    return { n, pos, col, dir, ext, world };
  }

  render(f) {
    const gl = this.gl;
    const { w, h } = this.size;
    const cam = f.cam;
    const lp = this.packLights(f.lights, cam);
    const mapU = { uMap:this.mapTex, uMapOrigin:[f.win.ox, f.win.oy], uMapSize:f.win.size, uTile:TILE };
    const lightU = { uLPos:lp.pos, uLCol:lp.col, uLDir:lp.dir, uLExt:lp.ext, uLightCount:lp.n, uShadow:this.shadowTex, uShadowRows:S.MAXL };

    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(this.geo.tri);

    // 1. shadow atlas
    bindTarget(gl, this.shadowFBO);
    use(this.p.shadow, { ...mapU, uLWorld:lp.world, uLightCount:lp.n });
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 2. world into the G-buffer
    bindTarget(gl, this.gFBO);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.ALWAYS);
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    use(this.p.world, {
      ...mapU, uRes:[w, h], uPPM:f.ppm, uCam:[cam.x, cam.y], uHc:f.hc, uHw:HW,
      uSdf:this.sdfTex, uGore:this.goreTex, uGoreSpan:GORE_SPAN, uGoreNow:f.goreNow,
      uWallGore:this.wallTex, uFaceSlot:this.faceTex,
      uAlb0:this.alb[0], uAlb1:this.alb[1], uAlb2:this.alb[2], uAlb3:this.alb[3],
      uNrm0:this.nrm[0], uNrm1:this.nrm[1], uNrm2:this.nrm[2], uNrm3:this.nrm[3],
      uMatScale:this.matScale, uMatLoaded:this.matLoaded,
    });
    gl.bindVertexArray(this.geo.tri);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 3. entities and the operator
    gl.depthFunc(gl.LEQUAL);
    const entU = { uRes:[w, h], uPPM:f.ppm, uHc:f.hc, uTime:f.time };
    use(this.p.entity, { ...entU, ...f.operator });
    drawInstances(gl, this.entities);
    if (f.drawPlayer) drawInstances(gl, this.player);
    gl.disable(gl.DEPTH_TEST);

    // 4. lighting
    bindTarget(gl, this.litFBO);
    use(this.p.light, { ...lightU, gAlb:this.gAlb, gNrm:this.gNrm, gPos:this.gPos, uHc:f.hc, uAmbient:f.ambient });
    gl.bindVertexArray(this.geo.tri);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 5. emissive geometry, depth tested against the G-buffer depth
    if (this.lines.count) {
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(false);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      use(this.p.line, { uRes:[w, h], uPPM:f.ppm, uHc:f.hc });
      drawInstances(gl, this.lines);
      gl.disable(gl.BLEND);
      gl.depthMask(true);
      gl.disable(gl.DEPTH_TEST);
    }

    // 6. volumetric fog
    if (f.fog) {
      bindTarget(gl, this.fogFBO);
      use(this.p.fog, { ...lightU, gPos:this.gPos, uHc:f.hc, uHw:HW, uTime:f.time, uDensity:f.fogDensity, uCamW:[cam.x, cam.y], uFogCount:Math.min(lp.n, S.MAXFOG) });
      gl.bindVertexArray(this.geo.tri);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // 7. compose + dust motes
    bindTarget(gl, this.compFBO);
    use(this.p.compose, { uLit:this.litTex, uFog:this.fogTex, uFogOn:f.fog ? 1 : 0 });
    gl.bindVertexArray(this.geo.tri);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (f.dustCount > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      use(this.p.dust, { uRes:[w, h], uPPM:f.ppm, uHc:f.hc, uHw:HW, uCamW:[cam.x, cam.y], uTime:f.time, uSpan:[w / f.ppm + 4, h / f.ppm + 4], uLit:this.litTex, uAmount:0.5 });
      this.dust.count = f.dustCount;
      drawInstances(gl, this.dust);
      gl.disable(gl.BLEND);
    }

    // 8. blur pyramid (bloom + mask condensation)
    let src = this.compTex, sw = w, sh = h;
    for (const L of this.pyr) {
      bindTarget(gl, L.fa);
      use(this.p.down, { uSrc:src, uTexel:[0.5 / sw, 0.5 / sh] });
      gl.bindVertexArray(this.geo.tri);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      bindTarget(gl, L.fb);
      use(this.p.blur, { uSrc:L.a, uDir:[1 / L.w, 0] });
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      bindTarget(gl, L.fa);
      use(this.p.blur, { uSrc:L.b, uDir:[0, 1 / L.h] });
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      src = L.a; sw = L.w; sh = L.h;
    }

    // 9. post to the canvas
    bindTarget(gl, null);
    use(this.p.post, {
      uComp:this.compTex, uB1:this.pyr[0].a, uB2:this.pyr[1].a, uB3:this.pyr[2].a,
      uRes:[gl.drawingBufferWidth, gl.drawingBufferHeight], uTime:f.time,
      uExposure:f.exposure, uNvg:f.nvg ? 1 : 0, uMaskOn:f.maskOn ? 1 : 0, uMaskFog:f.maskFog, uBreath:f.breath,
      uDamage:f.damage, uGrain:f.grain, uFlash:f.flash, uAds:f.ads,
    });
    gl.bindVertexArray(this.geo.tri);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }
}
