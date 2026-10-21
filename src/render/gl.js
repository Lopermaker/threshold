// Thin WebGL2 helpers: programs with reflected uniforms, textures, framebuffers.

export function createProgram(gl, vsSrc, fsSrc, name = 'program') {
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      const lines = src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n');
      throw new Error(`${name} ${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'} shader failed:\n${log}\n${lines}`);
    }
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`${name} link failed: ${gl.getProgramInfoLog(p)}`);
  const uniforms = {};
  const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(p, i);
    const key = info.name.replace(/\[0\]$/, '');
    uniforms[key] = { loc:gl.getUniformLocation(p, info.name), type:info.type, size:info.size };
  }
  return { gl, prog:p, uniforms, name, units:{} };
}

// Set uniforms by name. Samplers take { tex } and get a texture unit automatically.
export function use(P, values) {
  const gl = P.gl;
  gl.useProgram(P.prog);
  let unit = 0;
  for (const k in values) {
    const u = P.uniforms[k];
    if (!u) continue;
    const v = values[k];
    switch (u.type) {
      case gl.FLOAT: u.size > 1 ? gl.uniform1fv(u.loc, v) : gl.uniform1f(u.loc, v); break;
      case gl.FLOAT_VEC2: gl.uniform2fv(u.loc, v); break;
      case gl.FLOAT_VEC3: gl.uniform3fv(u.loc, v); break;
      case gl.FLOAT_VEC4: gl.uniform4fv(u.loc, v); break;
      case gl.INT: case gl.BOOL: u.size > 1 ? gl.uniform1iv(u.loc, v) : gl.uniform1i(u.loc, v); break;
      case gl.FLOAT_MAT4: gl.uniformMatrix4fv(u.loc, false, v); break;
      case gl.SAMPLER_2D: case gl.UNSIGNED_INT_SAMPLER_2D: {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, v);
        gl.uniform1i(u.loc, unit);
        unit++;
        break;
      }
      default: break;
    }
  }
}

export function createTexture(gl, { w, h, ifmt, fmt, type, filter, wrapS, wrapT, data = null }) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter ?? gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter ?? gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS ?? gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapT ?? gl.CLAMP_TO_EDGE);
  t.w = w; t.h = h;
  return t;
}

export function createFBO(gl, colors, depth = null) {
  const f = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, f);
  const bufs = [];
  colors.forEach((tex, i) => {
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, tex, 0);
    bufs.push(gl.COLOR_ATTACHMENT0 + i);
  });
  if (depth) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
  gl.drawBuffers(bufs);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Framebuffer incomplete: 0x' + status.toString(16));
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  f.w = colors[0] ? colors[0].w : depth.w;
  f.h = colors[0] ? colors[0].h : depth.h;
  f.colors = colors;
  return f;
}

export function bindTarget(gl, fbo) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  if (fbo) gl.viewport(0, 0, fbo.w, fbo.h);
  else gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
}

// One oversized triangle covering the viewport, plus a unit quad for instancing.
export function createGeometry(gl) {
  const tri = gl.createVertexArray();
  gl.bindVertexArray(tri);
  const tb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, tb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  const quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  return { tri, quadBuf };
}

// An instanced quad VAO with `attribs` vec4 per-instance attributes at locations 1..n.
export function createInstanced(gl, quadBuf, attribs, capacity) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const inst = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, inst);
  const stride = attribs * 16;
  gl.bufferData(gl.ARRAY_BUFFER, capacity * stride, gl.DYNAMIC_DRAW);
  for (let i = 0; i < attribs; i++) {
    gl.enableVertexAttribArray(1 + i);
    gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, stride, i * 16);
    gl.vertexAttribDivisor(1 + i, 1);
  }
  gl.bindVertexArray(null);
  return { vao, inst, attribs, capacity, data:new Float32Array(capacity * attribs * 4), count:0 };
}

export function uploadInstances(gl, I) {
  gl.bindBuffer(gl.ARRAY_BUFFER, I.inst);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, I.data, 0, I.count * I.attribs * 4);
}

export function drawInstances(gl, I) {
  if (!I.count) return;
  uploadInstances(gl, I);
  gl.bindVertexArray(I.vao);
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, I.count);
  gl.bindVertexArray(null);
}
