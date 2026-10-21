// The main menu as a place: a CRT on a metal desk in an abandoned ASYNC research room.
// Raymarched signed-distance scene. The only light is the screen itself (an emissive area
// approximated by a point at the glass, with soft shadows) and a cold sliver of corridor
// light under a door. Dust drifts through the CRT glow as volumetric scattering plus
// discrete motes. The terminal canvas is shown through a CRT model: barrel distortion,
// scanlines, aperture grille, phosphor bloom, rolling hum bar and flicker.

import { createProgram, use, createTexture, createFBO, bindTarget, createInstanced, drawInstances } from '../render/gl.js';
import { VS_FULL } from '../render/shaders.js';

const SCREEN = { cx:0, cy:1.05, z:0.185, hw:0.168, hh:0.128 };

const FS_ROOM = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec2 uRes; uniform float uTime;
uniform vec3 uRo, uF, uR, uU; uniform float uTan;
uniform sampler2D uTerm;
uniform vec3 uScreenCol; uniform float uFlicker; uniform float uPower;
out vec4 o;

float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3){ p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z); }
float sdBox(vec3 p, vec3 b){ vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }
float sdRBox(vec3 p, vec3 b, float r){ return sdBox(p, b - r) - r; }
float sdCyl(vec3 p, float r, float h){ vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h); return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)); }
mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

vec2 opU(vec2 a, vec2 b){ return a.x < b.x ? a : b; }

// materials: 1 floor 2 wall 3 desk 4 monitor 5 screen 6 keyboard 7 paper 8 cabinet 9 mug 10 door light 11 door
vec2 map(vec3 p){
  vec2 r = vec2(p.y, 1.0);
  r = opU(r, vec2(min(min(1.9 - p.z, p.x + 2.3), min(2.6 - p.x, 2.9 - p.y)), 2.0));
  // Desk: top, side panels, modesty panel, drawer unit
  float desk = sdBox(p - vec3(0.0, 0.735, 0.25), vec3(0.95, 0.022, 0.42));
  desk = min(desk, sdBox(p - vec3(-0.92, 0.36, 0.25), vec3(0.02, 0.36, 0.4)));
  desk = min(desk, sdBox(p - vec3(0.92, 0.36, 0.25), vec3(0.02, 0.36, 0.4)));
  desk = min(desk, sdBox(p - vec3(0.0, 0.45, 0.62), vec3(0.9, 0.25, 0.012)));
  desk = min(desk, sdBox(p - vec3(0.6, 0.38, 0.25), vec3(0.28, 0.33, 0.38)));
  r = opU(r, vec2(desk, 3.0));
  // Drawer handles
  vec3 q = p - vec3(0.6, 0.0, -0.135);
  q.y = mod(q.y - 0.2, 0.22) - 0.11;
  if(p.y > 0.08 && p.y < 0.7) r = opU(r, vec2(sdBox(q, vec3(0.08, 0.008, 0.012)), 8.0));
  // Monitor: body with a recessed bezel, tapered rear, stand
  vec3 m = p - vec3(0.0, 1.03, 0.38);
  float body = sdRBox(m, vec3(0.23, 0.2, 0.2), 0.03);
  body = min(body, sdRBox(p - vec3(0.0, 1.0, 0.66), vec3(0.16, 0.14, 0.12), 0.04));
  float recess = sdRBox(p - vec3(0.0, ${SCREEN.cy.toFixed(3)}, 0.15), vec3(0.18, 0.14, 0.04), 0.02);
  body = max(body, -recess);
  body = min(body, sdRBox(p - vec3(0.0, 0.79, 0.38), vec3(0.13, 0.03, 0.13), 0.01));
  r = opU(r, vec2(body, 4.0));
  // Screen glass, bulged toward the viewer
  vec2 sq = (p.xy - vec2(0.0, ${SCREEN.cy.toFixed(3)})) / vec2(${SCREEN.hw.toFixed(3)}, ${SCREEN.hh.toFixed(3)});
  float bulge = 0.016 * (1.0 - 0.5 * dot(sq, sq));
  float glass = sdBox(vec3(p.x, p.y - ${SCREEN.cy.toFixed(3)}, p.z - (0.2 - bulge)), vec3(${SCREEN.hw.toFixed(3)}, ${SCREEN.hh.toFixed(3)}, 0.008));
  r = opU(r, vec2(glass, 5.0));
  // Keyboard with key rows
  vec3 kb = p - vec3(0.0, 0.772, -0.02);
  float key = sdRBox(kb, vec3(0.22, 0.012, 0.075), 0.006);
  vec3 kk = kb; kk.x = mod(kk.x + 0.009, 0.018) - 0.009; kk.z = mod(kk.z + 0.009, 0.018) - 0.009;
  if(abs(kb.x) < 0.2 && abs(kb.z) < 0.06) key = min(key, sdRBox(kk - vec3(0.0, 0.014, 0.0), vec3(0.007, 0.004, 0.007), 0.002));
  r = opU(r, vec2(key, 6.0));
  // Paper and a file folder
  vec3 pp = p - vec3(-0.52, 0.758, 0.12); pp.xz *= rot(0.22);
  r = opU(r, vec2(sdBox(pp, vec3(0.105, 0.002, 0.148)), 7.0));
  pp = p - vec3(-0.42, 0.762, 0.24); pp.xz *= rot(-0.35);
  r = opU(r, vec2(sdBox(pp, vec3(0.115, 0.004, 0.16)), 7.0));
  // Mug
  vec3 mg = p - vec3(0.42, 0.80, -0.02);
  float mug = max(sdCyl(mg, 0.04, 0.05), -sdCyl(mg - vec3(0.0, 0.01, 0.0), 0.034, 0.05));
  r = opU(r, vec2(mug, 9.0));
  // Filing cabinet and a door left ajar
  r = opU(r, vec2(sdBox(p - vec3(-1.75, 0.66, 1.4), vec3(0.3, 0.66, 0.3)), 8.0));
  r = opU(r, vec2(sdBox(p - vec3(1.45, 1.05, 1.88), vec3(0.38, 1.05, 0.03)), 11.0));
  return r;
}

vec3 normal(vec3 p){ vec2 e = vec2(0.0008, 0.0); return normalize(vec3(map(p + e.xyy).x - map(p - e.xyy).x, map(p + e.yxy).x - map(p - e.yxy).x, map(p + e.yyx).x - map(p - e.yyx).x)); }

float softShadow(vec3 ro, vec3 rd, float maxT){
  float res = 1.0, t = 0.01;
  for(int i = 0; i < 32; i++){
    float h = map(ro + rd * t).x;
    res = min(res, 10.0 * h / t);
    t += clamp(h, 0.006, 0.12);
    if(res < 0.002 || t > maxT) break;
  }
  return clamp(res, 0.0, 1.0);
}

float ao(vec3 p, vec3 n){ float s = 0.0, w = 1.0; for(int i = 1; i <= 5; i++){ float h = 0.03 * float(i); s += w * (h - map(p + n * h).x); w *= 0.6; } return clamp(1.0 - 3.0 * s, 0.0, 1.0); }

vec3 crt(vec2 uv){
  // uv in -1..1 across the glass
  vec2 c = uv * (1.0 + 0.07 * dot(uv, uv));
  if(abs(c.x) > 1.0 || abs(c.y) > 1.0) return vec3(0.0);
  // Power collapse: the picture folds to a line, then a dot.
  float sy = mix(0.004, 1.0, smoothstep(0.0, 0.6, uPower));
  float sx = mix(0.02, 1.0, smoothstep(0.0, 0.25, uPower));
  if(abs(c.y) > sy || abs(c.x) > sx) return vec3(0.0);
  vec2 tc = vec2(c.x / sx * 0.5 + 0.5, 0.5 - c.y / sy * 0.5);
  float l = texture(uTerm, tc).r;
  float glow = 0.0;
  for(int i = 0; i < 8; i++){ float a = float(i) * 0.785; glow += texture(uTerm, tc + vec2(cos(a), sin(a)) * 0.006).r; }
  l = l + glow * 0.06 + 0.035;
  float lines = 288.0;
  float fw = fwidth(tc.y * lines);
  float scan = 1.0 - 0.3 * clamp(1.0 - fw * 1.6, 0.0, 1.0) * (0.5 - 0.5 * cos(tc.y * lines * 6.28318));
  float bar = 0.06 * smoothstep(0.0, 0.1, 0.1 - abs(fract(tc.y * 0.5 - uTime * 0.08) - 0.5));
  vec3 phosphor = vec3(1.0, 0.62, 0.14);
  float vig = smoothstep(1.25, 0.6, length(c));
  return phosphor * (l * scan + bar) * vig * uFlicker * (1.0 + (1.0 - smoothstep(0.6, 1.0, uPower)) * 3.0);
}

vec3 shade(vec3 p, vec3 rd, float mat){
  vec3 n = normal(p);
  vec3 alb = mat < 1.5 ? vec3(0.09, 0.085, 0.08) : mat < 2.5 ? vec3(0.13, 0.135, 0.13) : mat < 3.5 ? vec3(0.22, 0.25, 0.22)
           : mat < 4.5 ? vec3(0.62, 0.58, 0.48) : mat < 6.5 ? vec3(0.55, 0.52, 0.44) : mat < 7.5 ? vec3(0.7, 0.68, 0.6)
           : mat < 8.5 ? vec3(0.2, 0.22, 0.21) : mat < 9.5 ? vec3(0.55, 0.5, 0.45) : vec3(0.1);
  float spec = mat > 2.5 && mat < 3.5 ? 0.5 : mat > 7.5 && mat < 8.5 ? 0.5 : mat < 1.5 ? 0.25 : 0.12;
  if(mat < 1.5) alb *= 0.8 + 0.4 * vnoise(p * 6.0);
  if(mat > 1.5 && mat < 2.5) alb *= 0.75 + 0.5 * vnoise(p * vec3(2.0, 9.0, 2.0));
  vec3 Ls = vec3(0.0, ${SCREEN.cy.toFixed(3)}, 0.15);
  vec3 L = Ls - p; float d = length(L); vec3 l = L / d;
  float face = max(dot(-l, vec3(0.0, 0.0, -1.0)), 0.0);
  float sh = softShadow(p + n * 0.004, l, d - 0.02);
  float ndl = max(dot(n, l), 0.0);
  vec3 h = normalize(l - rd);
  vec3 col = uScreenCol * (alb * ndl + spec * pow(max(dot(n, h), 0.0), 40.0)) * sh * face / (1.0 + d * d * 7.0) * 3.2;
  // Corridor light under the door: cold, faint, from the back right.
  vec3 Ld = vec3(1.1, 0.3, 1.82) - p; float dd = length(Ld);
  col += vec3(0.55, 0.62, 0.7) * alb * max(dot(n, Ld / dd), 0.0) * 0.05 / (1.0 + dd * dd);
  col += alb * vec3(0.012, 0.013, 0.015);
  if(mat > 3.5 && mat < 4.5){
    vec2 e = abs(p.xy - vec2(0.0, ${SCREEN.cy.toFixed(3)})) - vec2(${SCREEN.hw.toFixed(3)}, ${SCREEN.hh.toFixed(3)});
    float edge = length(max(e, 0.0));
    col += uScreenCol * alb * 0.35 * exp(-edge * 28.0) * step(p.z, 0.26);
  }
  return col * ao(p, n);
}

void main(){
  vec2 uv = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
  float asp = uRes.x / uRes.y;
  vec3 rd = normalize(uF + uv.x * uR * uTan * asp + uv.y * uU * uTan);
  float t = 0.0; vec2 h = vec2(0.0);
  for(int i = 0; i < 110; i++){
    h = map(uRo + rd * t);
    if(h.x < 0.0006 * t || t > 8.0) break;
    t += h.x * 0.9;
  }
  vec3 col = vec3(0.0);
  vec3 p = uRo + rd * t;
  if(t < 8.0){
    if(h.y > 4.5 && h.y < 5.5){
      vec2 s = vec2(p.x / ${SCREEN.hw.toFixed(3)}, (p.y - ${SCREEN.cy.toFixed(3)}) / ${SCREEN.hh.toFixed(3)});
      col = crt(s);
      vec3 n = normal(p);
      float fres = pow(1.0 - max(dot(n, -rd), 0.0), 4.0);
      col += vec3(0.02, 0.022, 0.025) * fres + vec3(0.5, 0.55, 0.6) * 0.012 * smoothstep(0.9, 1.0, 1.0 - abs(s.x - 0.6));
    } else if(h.y > 9.5 && h.y < 10.5){
      col = vec3(0.5, 0.58, 0.66) * 0.09 * smoothstep(2.05, 1.2, p.y) * (0.9 + 0.1 * sin(uTime * 100.0));
    } else {
      col = shade(p, rd, h.y);
    }
  }
  // Light shafts: dust lit by the screen along the view ray.
  float tm = min(t, 4.0);
  vec3 scat = vec3(0.0);
  float jit = hash12(gl_FragCoord.xy + uTime);
  for(int i = 0; i < 20; i++){
    float s = (float(i) + jit) / 20.0 * tm;
    vec3 q = uRo + rd * s;
    vec3 L = vec3(0.0, ${SCREEN.cy.toFixed(3)}, 0.17) - q; float d = length(L);
    float face = max(dot(-L / d, vec3(0.0, 0.0, -1.0)), 0.0);
    float dens = 0.55 + 0.9 * vnoise(q * 5.0 + vec3(0.0, uTime * 0.05, uTime * 0.02));
    scat += uScreenCol * pow(face, 3.0) * dens / (1.0 + d * d * 18.0) * (tm / 20.0);
  }
  col += scat * 0.22;
  col = clamp((col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14), 0.0, 1.0);
  col *= 1.0 - 0.45 * dot(uv * 0.75, uv * 0.75);
  col += (hash12(gl_FragCoord.xy * 1.7 + fract(uTime * 9.0) * 300.0) - 0.5) * 0.012;
  o = vec4(pow(max(col, 0.0), vec3(1.0 / 2.2)), 1.0);
}
`;

const FS_BLIT = `#version 300 es
precision highp float;
in vec2 vUv; uniform sampler2D uSrc; uniform float uFade; out vec4 o;
void main(){ o = vec4(texture(uSrc, vUv).rgb * uFade, 1.0); }
`;

const VS_MOTE = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 iA;
uniform vec3 uRo, uF, uR, uU; uniform float uTan; uniform vec2 uRes; uniform float uTime;
out vec2 vC; out float vLit;
void main(){
  vec3 p = vec3(-1.2, 0.75, -0.6) + iA.xyz * vec3(2.4, 1.1, 1.2);
  p += vec3(sin(uTime * 0.13 + iA.x * 40.0), sin(uTime * 0.07 + iA.y * 31.0) - uTime * 0.004, cos(uTime * 0.11 + iA.z * 27.0)) * 0.08;
  p.y = 0.75 + mod(p.y - 0.75, 1.1);
  vec3 d = p - uRo;
  vec3 c = vec3(dot(d, uR), dot(d, uU), dot(d, uF));
  float asp = uRes.x / uRes.y;
  vec2 ndc = vec2(c.x / (c.z * uTan * asp), c.y / (c.z * uTan));
  float size = iA.w / c.z;
  gl_Position = vec4(ndc + aCorner * vec2(size / asp, size), 0.0, 1.0);
  vec3 L = vec3(0.0, ${SCREEN.cy.toFixed(3)}, 0.17) - p; float dl = length(L);
  vLit = pow(max(dot(-L / dl, vec3(0.0, 0.0, -1.0)), 0.0), 2.0) / (1.0 + dl * dl * 10.0);
  vC = aCorner;
}
`;

const FS_MOTE = `#version 300 es
precision highp float;
in vec2 vC; in float vLit; uniform vec3 uScreenCol; out vec4 o;
void main(){ float a = smoothstep(1.0, 0.0, length(vC)); o = vec4(uScreenCol * vLit * a * 0.9, 1.0); }
`;

export class MenuScene {
  constructor(gl, geo) {
    this.gl = gl;
    this.geo = geo;
    this.room = createProgram(gl, VS_FULL, FS_ROOM, 'crt-room');
    this.blit = createProgram(gl, VS_FULL, FS_BLIT, 'blit');
    this.mote = createProgram(gl, VS_MOTE, FS_MOTE, 'mote');
    this.motes = createInstanced(gl, geo.quadBuf, 1, 500);
    for (let i = 0; i < 500; i++) this.motes.data.set([Math.random(), Math.random(), Math.random(), 0.0012 + Math.random() * 0.0025], i * 4);
    this.motes.count = 500;
    this.termTex = createTexture(gl, { w:1024, h:768, ifmt:gl.RGBA8, fmt:gl.RGBA, type:gl.UNSIGNED_BYTE, filter:gl.LINEAR });
    this.size = { w:0, h:0 };
    this.power = 0;
    this.targetPower = 1;
    this.flicker = 1;
    this.screenCol = [0.5, 0.3, 0.07];
    this.cam();
  }

  cam(t = 99) {
    const k = 1 - Math.pow(1 - Math.min(1, t / 3.2), 3);
    const mix = (a, b) => a.map((v, i) => v + (b[i] - v) * k);
    const sway = [Math.sin(t * 0.21) * 0.006, Math.sin(t * 0.17) * 0.004, 0];
    const ro = mix([0.22, 1.34, -1.15], [0.0, 1.075, -0.235]).map((v, i) => v + sway[i]);
    const ta = mix([0.0, 0.95, 0.3], [0.0, 1.045, 0.2]);
    const f = norm(sub(ta, ro));
    const r = norm(cross([0, 1, 0], f));
    const u = cross(f, r);
    this.c = { ro, f, r, u, tan:Math.tan(25 * Math.PI / 180) };
  }

  resize(w, h, scale) {
    const gl = this.gl;
    const rw = Math.max(64, Math.round(w * scale)), rh = Math.max(64, Math.round(h * scale));
    if (rw === this.size.w && rh === this.size.h) return;
    this.size = { w:rw, h:rh };
    this.tex = createTexture(gl, { w:rw, h:rh, ifmt:gl.RGBA8, fmt:gl.RGBA, type:gl.UNSIGNED_BYTE, filter:gl.LINEAR });
    this.fbo = createFBO(gl, [this.tex]);
  }

  uploadTerminal(canvas) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.termTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    // Screen light colour follows how much text is lit (sampled sparsely).
    const g = canvas.getContext('2d');
    const d = g.getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0, n = 0;
    for (let i = 0; i < d.length; i += 4 * 97) { sum += d[i]; n++; }
    const lvl = 0.35 + (sum / n / 255) * 2.2;
    this.screenCol = [1.0 * lvl, 0.62 * lvl, 0.15 * lvl];
  }

  // CSS px -> {u, v} on the glass (0..1, v down), or null when off-screen.
  pick(px, py, cssW, cssH) {
    const proj = p => {
      const d = sub(p, this.c.ro);
      const x = dot(d, this.c.r), y = dot(d, this.c.u), z = dot(d, this.c.f);
      const asp = cssW / cssH;
      return [(x / (z * this.c.tan * asp) * 0.5 + 0.5) * cssW, (0.5 - y / (z * this.c.tan) * 0.5) * cssH];
    };
    const z = SCREEN.z - 0.005;
    const a = proj([-SCREEN.hw, SCREEN.cy + SCREEN.hh, z]), b = proj([SCREEN.hw, SCREEN.cy + SCREEN.hh, z]);
    const c = proj([SCREEN.hw, SCREEN.cy - SCREEN.hh, z]), d = proj([-SCREEN.hw, SCREEN.cy - SCREEN.hh, z]);
    const uv = invBilinear([px, py], a, b, c, d);
    if (!uv || uv[0] < 0 || uv[0] > 1 || uv[1] < 0 || uv[1] > 1) return null;
    // Undo the barrel distortion approximately so clicks land on what is drawn.
    let sx = uv[0] * 2 - 1, sy = uv[1] * 2 - 1;
    const k = 1 + 0.07 * (sx * sx + sy * sy);
    sx *= k; sy *= k;
    return { u:sx * 0.5 + 0.5, v:sy * 0.5 + 0.5 };
  }

  screenRect(cssW, cssH) {
    return [this.pick, cssW, cssH];
  }

  render(time, dt, cssW, cssH, dpr, quality, fade = 1) {
    const gl = this.gl;
    this.power += (this.targetPower - this.power) * Math.min(1, dt * (this.targetPower > this.power ? 2.2 : 5));
    this.flicker = 0.93 + 0.07 * Math.sin(time * 120) * Math.sin(time * 3.1) + (Math.random() < 0.01 ? -0.15 : 0);
    this.cam(time);
    this.resize(cssW * dpr, cssH * dpr, quality);
    const c = this.c;
    const camU = { uRo:c.ro, uF:c.f, uR:c.r, uU:c.u, uTan:c.tan, uTime:time };
    const col = this.screenCol.map(v => v * this.flicker * Math.max(0.05, this.power));
    bindTarget(gl, this.fbo);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    use(this.room, { ...camU, uRes:[this.size.w, this.size.h], uTerm:this.termTex, uScreenCol:col, uFlicker:this.flicker, uPower:this.power });
    gl.bindVertexArray(this.geo.tri);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    use(this.mote, { ...camU, uRes:[this.size.w, this.size.h], uScreenCol:col });
    drawInstances(gl, this.motes);
    gl.disable(gl.BLEND);
    bindTarget(gl, null);
    use(this.blit, { uSrc:this.tex, uFade:fade });
    gl.bindVertexArray(this.geo.tri);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };

// Inverse bilinear interpolation (quad a-b-c-d, clockwise from top-left). Returns [u, v].
function invBilinear(p, a, b, c, d) {
  const cr = (u, v) => u[0] * v[1] - u[1] * v[0];
  const e = [b[0] - a[0], b[1] - a[1]], f = [d[0] - a[0], d[1] - a[1]];
  const g = [a[0] - b[0] + c[0] - d[0], a[1] - b[1] + c[1] - d[1]];
  const h = [p[0] - a[0], p[1] - a[1]];
  const k2 = cr(g, f), k1 = cr(e, f) + cr(h, g), k0 = cr(h, e);
  let v;
  if (Math.abs(k2) < 1e-6) v = -k0 / k1;
  else {
    let w = k1 * k1 - 4 * k0 * k2;
    if (w < 0) return null;
    w = Math.sqrt(w);
    const v1 = (-k1 - w) / (2 * k2), v2 = (-k1 + w) / (2 * k2);
    v = v1 >= 0 && v1 <= 1 ? v1 : v2;
  }
  const den = e[0] + g[0] * v;
  const u = Math.abs(den) > 1e-6 ? (h[0] - f[0] * v) / den : (h[1] - f[1] * v) / (e[1] + g[1] * v);
  return [u, v];
}
