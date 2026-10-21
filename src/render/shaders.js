// GLSL for the deferred pipeline.
//
// Pass order per frame:
//   1. shadow   polar shadow atlas: one row per light, 512 angles, distance to the first wall
//   2. world    perspective heightfield raycast of the tile map into the G-buffer
//   3. entities instanced SDF creatures, limbs, corpses and the operator into the G-buffer
//   4. light    normal-mapped Blinn-Phong over every light, soft shadows from the atlas
//   5. emissive troffer panels, laser beams and tracers added on top (depth tested)
//   6. fog      quarter-resolution volumetric in-scattering along each view ray
//   7. compose  lit * transmittance + in-scatter, then dust motes lit by the scene
//   8. blur     pyramid for bloom and the gas-mask condensation blur
//   9. post     exposure, ACES, NVG intensifier, mask fog, damage, grain, vignette

export const MAXL = 40;      // lights per frame
export const MAXFOG = 14;    // lights that scatter in the fog pass
export const SHADOW_W = 512;

const HEAD = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
#define PI 3.14159265
#define MAXL ${MAXL}
`;

export const VS_FULL = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const NOISE = `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3){ p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise3(vec3 p){
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = hash13(i), b = hash13(i + vec3(1,0,0)), c = hash13(i + vec3(0,1,0)), d = hash13(i + vec3(1,1,0));
  float e = hash13(i + vec3(0,0,1)), g = hash13(i + vec3(1,0,1)), h = hash13(i + vec3(0,1,1)), k = hash13(i + vec3(1,1,1));
  return mix(mix(mix(a,b,f.x), mix(c,d,f.x), f.y), mix(mix(e,g,f.x), mix(h,k,f.x), f.y), f.z);
}
float vnoise2(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1,0)), f.x), mix(hash12(i + vec2(0,1)), hash12(i + vec2(1,1)), f.x), f.y);
}
float fbm2(vec2 p){ float s = 0.0, a = 0.5; for(int i = 0; i < 4; i++){ s += a * vnoise2(p); p *= 2.03; a *= 0.5; } return s; }
`;

const MAP = `
uniform sampler2D uMap;
uniform vec2 uMapOrigin;   // window origin in absolute tiles
uniform float uMapSize;
uniform float uTile;
int tileAt(ivec2 c){
  if(c.x < 0 || c.y < 0 || c.x >= int(uMapSize) || c.y >= int(uMapSize)) return 3;
  return int(texelFetch(uMap, c, 0).r * 255.0 + 0.5);
}
bool solidT(int t){ return t >= 2; }
`;

const LIGHTS = `
uniform vec4 uLPos[MAXL];    // xyz relative to camera, w = range
uniform vec4 uLCol[MAXL];    // rgb * intensity, w = 1 for spot
uniform vec4 uLDir[MAXL];    // spot direction, w = cos outer
uniform vec4 uLExt[MAXL];    // x = cos inner, y = shadow row, z = casts shadow
uniform int uLightCount;
uniform sampler2D uShadow;
uniform float uShadowRows;
float shadowAt(int i, vec2 rel){
  if(uLExt[i].z < 0.5) return 1.0;
  float dist = length(rel);
  float u = atan(rel.y, rel.x) / (2.0 * PI) + 0.5;
  float v = (uLExt[i].y + 0.5) / uShadowRows;
  float lit = 0.0;
  for(int k = -2; k <= 2; k++){
    float occ = texture(uShadow, vec2(u + float(k) * 0.0011, v)).r;
    lit += smoothstep(-0.03, 0.05, occ - dist + 0.04);
  }
  return lit * 0.2;
}
float shadowHard(int i, vec2 rel){
  if(uLExt[i].z < 0.5) return 1.0;
  float u = atan(rel.y, rel.x) / (2.0 * PI) + 0.5;
  float occ = texture(uShadow, vec2(u, (uLExt[i].y + 0.5) / uShadowRows)).r;
  return step(length(rel) - 0.05, occ);
}
`;

/* ---------- 1. shadow atlas ---------- */

export const FS_SHADOW = HEAD + MAP + `
uniform vec4 uLWorld[MAXL];   // absolute xy, range
uniform int uLightCount;
out vec4 o;
void main(){
  int row = int(gl_FragCoord.y);
  if(row >= uLightCount){ o = vec4(1e4); return; }
  vec4 L = uLWorld[row];
  float ang = (gl_FragCoord.x / ${SHADOW_W}.0 - 0.5) * 2.0 * PI;
  vec2 d = vec2(cos(ang), sin(ang));
  vec2 p = L.xy / uTile - uMapOrigin;
  ivec2 c = ivec2(floor(p));
  if(solidT(tileAt(c))){ o = vec4(0.0); return; }
  ivec2 stp = ivec2(d.x > 0.0 ? 1 : -1, d.y > 0.0 ? 1 : -1);
  vec2 inv = vec2(abs(d.x) > 1e-6 ? 1.0 / abs(d.x) : 1e6, abs(d.y) > 1e-6 ? 1.0 / abs(d.y) : 1e6);
  vec2 fr = p - floor(p);
  vec2 tMax = vec2(d.x > 0.0 ? 1.0 - fr.x : fr.x, d.y > 0.0 ? 1.0 - fr.y : fr.y) * inv;
  float maxT = L.w / uTile;
  float t = maxT;
  for(int i = 0; i < 96; i++){
    float tt;
    if(tMax.x < tMax.y){ tt = tMax.x; tMax.x += inv.x; c.x += stp.x; }
    else { tt = tMax.y; tMax.y += inv.y; c.y += stp.y; }
    if(tt > maxT){ break; }
    if(solidT(tileAt(c))){ t = tt; break; }
  }
  o = vec4(t * uTile);
}
`;

/* ---------- 2. world G-buffer ---------- */

export const FS_WORLD = HEAD + NOISE + MAP + `
uniform vec2 uRes;
uniform float uPPM;          // render pixels per meter at floor level
uniform vec2 uCam;           // camera ground point, absolute meters
uniform float uHc;           // eye height
uniform float uHw;           // wall height
uniform sampler2D uSdf;
uniform sampler2D uGore;
uniform float uGoreSpan;
uniform float uGoreNow;
uniform sampler2D uWallGore;
uniform highp usampler2D uFaceSlot;
uniform sampler2D uAlb0; uniform sampler2D uAlb1; uniform sampler2D uAlb2; uniform sampler2D uAlb3;
uniform sampler2D uNrm0; uniform sampler2D uNrm1; uniform sampler2D uNrm2; uniform sampler2D uNrm3;
uniform vec4 uMatScale;      // meters per texture repeat: carpet, wallpaper, concrete, metal
uniform vec4 uMatLoaded;     // 1 where a real texture set is loaded
layout(location=0) out vec4 oAlb;
layout(location=1) out vec4 oNrm;
layout(location=2) out vec4 oPos;

vec4 mat(int m, vec2 uv, out vec3 nts){
  if(m == 0){ nts = texture(uNrm0, uv).xyz * 2.0 - 1.0; return texture(uAlb0, uv); }
  if(m == 1){ nts = texture(uNrm1, uv).xyz * 2.0 - 1.0; return texture(uAlb1, uv); }
  if(m == 2){ nts = texture(uNrm2, uv).xyz * 2.0 - 1.0; return texture(uAlb2, uv); }
  nts = texture(uNrm3, uv).xyz * 2.0 - 1.0; return texture(uAlb3, uv);
}
float sdf(vec2 w){ return texture(uSdf, (w / uTile - uMapOrigin) / uMapSize).r * 2.0; }
vec4 gore(vec2 w){ return texture(uGore, w / uGoreSpan); }

// Wall faces: per-tile slot lookup into the wall gore atlas (16 x 96 texels, 32 per meter).
vec4 wallGore(ivec2 cell, int dir, float along, float z){
  uvec4 s = texelFetch(uFaceSlot, cell, 0);
  uint id = dir == 0 ? s.x : dir == 1 ? s.y : dir == 2 ? s.z : s.w;
  if(id == 0u) return vec4(0.0);
  int k = int(id) - 1;
  vec2 origin = vec2(float(k % 128) * 16.0, float(k / 128) * 96.0);
  vec2 t = origin + clamp(vec2(along * 32.0, z * 32.0), vec2(0.5), vec2(15.5, 95.5));
  return texture(uWallGore, t / 2048.0);
}

void applyGore(vec4 g, vec2 grad, inout vec3 alb, inout float rough, inout vec3 n, bool floorFace){
  if(g.r > 0.01){
    float age = fract(uGoreNow - g.g) * 900.0;
    float dry = smoothstep(25.0, 300.0, age);
    float cover = smoothstep(0.04, 0.32, g.r);
    vec3 fresh = vec3(0.26, 0.012, 0.010), dried = vec3(0.085, 0.022, 0.016);
    vec3 blood = mix(fresh, dried, dry) * (0.75 + 0.25 * smoothstep(0.9, 0.3, g.r));
    alb = mix(alb, blood, cover);
    rough = mix(rough, mix(0.08, 0.62, dry), cover);
    if(floorFace) n = normalize(n + vec3(-grad, 0.0) * 1.4 * (1.0 - dry * 0.7));
  }
  if(g.b > 0.02){
    float hole = smoothstep(0.55, 0.95, g.b);
    float scorch = smoothstep(0.02, 0.5, g.b);
    alb *= (1.0 - 0.35 * scorch) * (1.0 - 0.9 * hole);
    rough = mix(rough, 1.0, scorch);
  }
}

void main(){
  vec2 frag = gl_FragCoord.xy;
  vec2 p = vec2(frag.x - uRes.x * 0.5, uRes.y * 0.5 - frag.y) / uPPM;
  float s0 = 1.0 - uHw / uHc;
  vec2 A = (uCam + p * s0) / uTile - uMapOrigin;
  vec2 B = (uCam + p) / uTile - uMapOrigin;
  vec2 d = B - A;
  ivec2 cell = ivec2(floor(A));
  ivec2 stp = ivec2(d.x > 0.0 ? 1 : -1, d.y > 0.0 ? 1 : -1);
  int face = 3;       // 0 top cut, 1 face across x, 2 face across y, 3 floor
  int hitT = -1;
  float u = 1.0;
  int t0 = tileAt(cell);
  if(solidT(t0)){ face = 0; hitT = t0; u = 0.0; }
  else {
    vec2 inv = vec2(abs(d.x) > 1e-6 ? 1.0 / abs(d.x) : 1e6, abs(d.y) > 1e-6 ? 1.0 / abs(d.y) : 1e6);
    vec2 fr = A - floor(A);
    vec2 tMax = vec2(d.x > 0.0 ? 1.0 - fr.x : fr.x, d.y > 0.0 ? 1.0 - fr.y : fr.y) * inv;
    for(int i = 0; i < 40; i++){
      float tt; int ax;
      if(tMax.x < tMax.y){ tt = tMax.x; tMax.x += inv.x; cell.x += stp.x; ax = 1; }
      else { tt = tMax.y; tMax.y += inv.y; cell.y += stp.y; ax = 2; }
      if(tt > 1.0) break;
      int tt2 = tileAt(cell);
      if(solidT(tt2)){ face = ax; hitT = tt2; u = tt; break; }
    }
  }

  vec2 hitTile = A + d * u;
  vec2 w = (hitTile + uMapOrigin) * uTile;
  float z = face == 0 ? uHw : face == 3 ? 0.0 : uHw * (1.0 - u);
  float depth = face == 3 ? 1.0 : s0 + u * (1.0 - s0);
  gl_FragDepth = depth;

  vec3 n = vec3(0.0, 0.0, 1.0);
  vec3 alb; float rough; float ao = 1.0;
  vec3 nts;
  if(face == 0){
    // Cut-away wall tops: raw concrete section with a lighter edge where the wall meets air.
    alb = vec3(0.07, 0.066, 0.06) * (0.85 + 0.3 * vnoise2(w * 3.0));
    rough = 0.95;
  } else if(face == 3){
    int ft = tileAt(ivec2(floor(B)));
    int m = ft == 1 ? 2 : 0;
    float sc = m == 0 ? uMatScale.x : uMatScale.z;
    vec4 a = mat(m, w / sc, nts);
    alb = a.rgb; rough = a.a;
    n = normalize(vec3(nts.x, -nts.y, max(nts.z, 0.2)));
    float e = 1.0 / 32.0;
    vec2 grad = vec2(gore(w + vec2(e, 0.0)).r - gore(w - vec2(e, 0.0)).r, gore(w + vec2(0.0, e)).r - gore(w - vec2(0.0, e)).r);
    applyGore(gore(w), grad, alb, rough, n, true);
    float s = sdf(w);
    float cornerAvg = 0.25 * (sdf(w + vec2(0.35, 0.35)) + sdf(w + vec2(-0.35, 0.35)) + sdf(w + vec2(0.35, -0.35)) + sdf(w + vec2(-0.35, -0.35)));
    ao = mix(0.28, 1.0, smoothstep(0.0, 0.85, s)) * mix(0.6, 1.0, smoothstep(0.05, 0.6, cornerAvg));
  } else {
    vec3 fn = face == 1 ? vec3(-float(stp.x), 0.0, 0.0) : vec3(0.0, -float(stp.y), 0.0);
    float along = face == 1 ? w.y : w.x;
    int m = hitT == 2 ? 1 : hitT == 5 ? 3 : 2;
    float sc = m == 1 ? uMatScale.y : m == 3 ? uMatScale.w : uMatScale.z;
    vec4 a = mat(m, vec2(along, -z) / sc, nts);
    alb = a.rgb; rough = a.a;
    vec3 T = face == 1 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 Bt = vec3(0.0, 0.0, 1.0);
    n = normalize(T * nts.x + Bt * nts.y + fn * max(nts.z, 0.2));
    if(hitT == 5 && z < 0.55){
      // Vent grille: real slats, so the normal follows the louvre geometry.
      float slat = fract(z * 18.0);
      n = normalize(fn + Bt * (slat - 0.5) * 1.2);
      alb *= 0.35 + 0.65 * smoothstep(0.1, 0.4, slat);
    }
    if(hitT == 2 && z < 0.12){ alb = mix(alb, vec3(0.16, 0.14, 0.11), 0.8); rough = 0.5; } // baseboard
    int dir = face == 1 ? (stp.x > 0 ? 0 : 1) : (stp.y > 0 ? 2 : 3);
    float alongT = face == 1 ? w.y - float(cell.y + int(uMapOrigin.y)) * uTile : w.x - float(cell.x + int(uMapOrigin.x)) * uTile;
    applyGore(wallGore(cell, dir, alongT, z), vec2(0.0), alb, rough, n, false);
    float corner = sdf(w + fn.xy * 0.35);
    ao = mix(0.35, 1.0, smoothstep(0.0, 1.3, z)) * mix(0.5, 1.0, smoothstep(0.04, 0.33, corner));
  }

  oAlb = vec4(alb, rough);
  oNrm = vec4(n * 0.5 + 0.5, ao);
  oPos = vec4(w - uCam, z, 0.0);
}
`;

/* ---------- 3. entities (procedural skeletons as signed distance fields) ---------- */

export const VS_ENTITY = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 iA;   // x, y (rel camera), angle, half extent
layout(location=2) in vec4 iB;   // type, phase, speed, kind
layout(location=3) in vec4 iC;   // hitFlash, blood, mask bits, top height
layout(location=4) in vec4 iD;   // part, lean, attack, seed
uniform vec2 uRes;
uniform float uPPM;
uniform float uHc;
out vec2 vLocal;
flat out vec4 vA; flat out vec4 vB; flat out vec4 vC; flat out vec4 vD;
void main(){
  float c = cos(iA.z), s = sin(iA.z);
  vec2 local = aCorner * iA.w;
  vec2 w = iA.xy + vec2(c * local.x - s * local.y, s * local.x + c * local.y);
  float z = iC.w;
  float f = uHc / (uHc - z);
  vec2 scr = w * uPPM * f;
  gl_Position = vec4(scr.x / (uRes.x * 0.5), -scr.y / (uRes.y * 0.5), (1.0 - z / uHc) * 2.0 - 1.0, 1.0);
  vLocal = local; vA = iA; vB = iB; vC = iC; vD = iD;
}
`;

export const FS_ENTITY = HEAD + NOISE + `
in vec2 vLocal;
flat in vec4 vA; flat in vec4 vB; flat in vec4 vC; flat in vec4 vD;
uniform float uTime;
// Operator customisation (only read when type == 3)
uniform vec3 uSuit; uniform vec3 uSuitSeam;
uniform int uRig; uniform int uHead;
uniform vec4 uPouch[12]; uniform vec4 uPouchKind[12]; uniform int uPouchCount;
uniform vec4 uWear[24]; uniform int uWearCount; uniform float uDirt;
uniform vec4 uGun0;   // receiver len, barrel len, suppressor len, stock len
uniform vec4 uGun1;   // optic (0 iron 1 dot 2 holo 3 scope), laser, light, mag type
uniform float uBootBlood;
layout(location=0) out vec4 oAlb;
layout(location=1) out vec4 oNrm;
layout(location=2) out vec4 oPos;

float sdCap(vec2 p, vec2 a, vec2 b, float r){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) - r; }
float sdCapT(vec2 p, vec2 a, vec2 b, float ra, float rb){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) - mix(ra, rb, h); }
float sdEll(vec2 p, vec2 r){ float k = length(p / r); return (k - 1.0) * min(r.x, r.y); }
float sdBox(vec2 p, vec2 b){ vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
vec2 ik(vec2 root, vec2 target, float l1, float l2, float bend){
  vec2 dv = target - root; float L = clamp(length(dv), 0.001, l1 + l2 - 0.002); vec2 dn = normalize(dv);
  float a = (l1 * l1 - l2 * l2 + L * L) / (2.0 * L); float h = sqrt(max(l1 * l1 - a * a, 0.0));
  return root + dn * a + vec2(-dn.y, dn.x) * h * bend;
}
bool has(float mask, int bit){ return mod(floor(mask / float(bit)), 2.0) < 0.5; }

// Part ids: 1 torso 2 head 3 arm 4 leg 5 stump 6 cloth 7 rig 8 pouch 9 gun 10 mask/helmet 11 skin
float gPart; float gD;
void add(float d, float part){ if(d < gD){ gD = d; gPart = part; } }
void addS(float d, float part, float k){ float m = smin(gD, d, k); if(d < gD) gPart = part; gD = m; }

void limb(vec2 p, vec2 root, vec2 target, float l1, float l2, float bend, float r0, float r1, bool present, float part){
  if(!present){ add(length(p - root) - r0 * 1.15, 5.0); return; }
  float L = l1 + l2; vec2 dv = target - root;
  if(length(dv) > L) target = root + normalize(dv) * L;
  vec2 j = ik(root, target, l1, l2, bend);
  addS(sdCapT(p, root, j, r0, r0 * 0.8), part, 0.03);
  add(sdCapT(p, j, target, r0 * 0.8, r1), part);
  add(length(p - j) - r0 * 0.85, part);
}

float twitch(float seed, float k){
  float t = uTime * 7.0 + seed * 30.0;
  float burst = step(0.82, vnoise2(vec2(uTime * 1.3, seed * 11.0)));
  return (vnoise2(vec2(t, seed * 5.0 + k)) - 0.5) * (0.25 + burst * 1.2);
}

float scene(vec2 p){
  gD = 1e5; gPart = 0.0;
  float type = vB.x, ph = vB.y, kind = vB.w, mask = vC.z, atk = vD.z, seed = vD.w;
  bool corpse = kind > 0.5 && kind < 1.5;
  if(kind > 1.5 && kind < 2.5){
    // Severed limb: one bent segment, ragged end.
    float part = vD.x;
    if(part < 0.5){ add(sdEll(p, vec2(0.12, 0.10)), 2.0); add(length(p - vec2(-0.1, 0.0)) - 0.05, 5.0); }
    else {
      float L = part < 1.5 ? 0.30 : 0.36;
      vec2 a = vec2(-L, 0.0), j = vec2(0.0, 0.05 * sin(seed * 20.0)), b = vec2(L, 0.0);
      add(sdCapT(p, a, j, 0.055, 0.045), part < 1.5 ? 3.0 : 4.0);
      add(sdCapT(p, j, b, 0.045, 0.04), part < 1.5 ? 3.0 : 4.0);
      add(length(p - a) - 0.06, 5.0);
      add(length(p - b) - 0.055, part < 1.5 ? 3.0 : 4.0);
    }
    return gD;
  }
  if(kind > 2.5){ return length(p * vec2(0.7, 1.0)) - 0.02; }  // airborne blood droplet, stretched along travel

  float gait = corpse ? 0.0 : 1.0;
  if(type < 0.5){
    // HOUND: a person running on all fours. Elbows and knees splay outward like a spider.
    float tw = twitch(seed, 1.0) * 0.08 * gait;
    addS(sdCapT(p, vec2(-0.34, 0.0), vec2(0.28, tw), 0.13, 0.15), 1.0, 0.05);
    if(has(mask, 1)) add(sdEll(p - vec2(0.47, tw * 2.0 + 0.02 * sin(ph * 2.0)), vec2(0.13, 0.095)), 2.0);
    else add(length(p - vec2(0.33, 0.0)) - 0.07, 5.0);
    float st = 0.22 * gait;
    vec2 fl = vec2(0.30 + cos(ph) * st, -0.36 - (corpse ? 0.15 : 0.0));
    vec2 fr = vec2(0.30 + cos(ph + PI) * st, 0.36 + (corpse ? 0.12 : 0.0));
    vec2 bl = vec2(-0.30 + cos(ph + PI) * st, -0.32);
    vec2 br = vec2(-0.30 + cos(ph) * st, 0.32 + (corpse ? 0.2 : 0.0));
    if(atk > 0.0){ fl = mix(fl, vec2(0.75, -0.12), atk); fr = mix(fr, vec2(0.75, 0.12), atk); }
    limb(p, vec2(0.24, -0.13), fl, 0.26, 0.28, 1.0, 0.055, 0.04, has(mask, 2), 3.0);
    limb(p, vec2(0.24, 0.13), fr, 0.26, 0.28, -1.0, 0.055, 0.04, has(mask, 4), 3.0);
    limb(p, vec2(-0.28, -0.12), bl, 0.27, 0.29, -1.0, 0.06, 0.045, has(mask, 8), 4.0);
    limb(p, vec2(-0.28, 0.12), br, 0.27, 0.29, 1.0, 0.06, 0.045, has(mask, 16), 4.0);
  } else if(type < 1.5){
    // BACTERIA: thin black biped with arms far too long, joints jittering.
    float t1 = twitch(seed, 2.0) * gait, t2 = twitch(seed, 3.0) * gait;
    add(sdEll(p, vec2(0.10, 0.17)), 1.0);
    if(has(mask, 1)) add(sdEll(p - vec2(0.09 + t1 * 0.05, t2 * 0.06), vec2(0.09, 0.055)), 2.0);
    else add(length(p - vec2(0.05, 0.0)) - 0.045, 5.0);
    float sw = sin(ph) * 0.14 * gait;
    vec2 la = vec2(0.62 + sw + atk * 0.25, -0.36 + t1 * 0.18);
    vec2 ra = vec2(0.62 - sw + atk * 0.25, 0.36 + t2 * 0.18);
    if(corpse){ la = vec2(0.1, -0.8); ra = vec2(0.5, 0.7); }
    limb(p, vec2(0.02, -0.15), la, 0.40, 0.42, -1.0, 0.034, 0.022, has(mask, 2), 3.0);
    limb(p, vec2(0.02, 0.15), ra, 0.40, 0.42, 1.0, 0.034, 0.022, has(mask, 4), 3.0);
    float lg = sin(ph) * 0.26 * gait;
    limb(p, vec2(-0.04, -0.07), vec2(lg - 0.02, -0.13), 0.24, 0.24, 1.0, 0.03, 0.025, has(mask, 8), 4.0);
    limb(p, vec2(-0.04, 0.07), vec2(-lg - 0.02, 0.13), 0.24, 0.24, -1.0, 0.03, 0.025, has(mask, 16), 4.0);
  } else if(type < 2.5){
    // SKIN-STEALER: a person-shaped thing wearing a person. Head hangs off-axis.
    add(sdEll(p, vec2(0.13, 0.25)), 1.0);
    float tilt = 0.09 + twitch(seed, 4.0) * 0.06 * gait;
    if(has(mask, 1)) add(sdEll(p - vec2(0.03, tilt), vec2(0.105, 0.09)), 2.0);
    else add(length(p - vec2(0.0, 0.0)) - 0.06, 5.0);
    float sw = sin(ph) * 0.13 * gait;
    vec2 la = vec2(0.18 + sw + atk * 0.5, -0.31), ra = vec2(0.18 - sw + atk * 0.5, 0.31);
    if(corpse){ la = vec2(-0.2, -0.6); ra = vec2(0.3, 0.55); }
    limb(p, vec2(0.0, -0.23), la, 0.28, 0.27, 1.0, 0.05, 0.04, has(mask, 2), 3.0);
    limb(p, vec2(0.0, 0.23), ra, 0.28, 0.27, -1.0, 0.05, 0.04, has(mask, 4), 3.0);
    float lg = sin(ph) * 0.3 * gait;
    limb(p, vec2(-0.02, -0.09), vec2(lg, -0.12), 0.22, 0.22, 1.0, 0.055, 0.045, has(mask, 8), 4.0);
    limb(p, vec2(-0.02, 0.09), vec2(-lg, 0.12), 0.22, 0.22, -1.0, 0.055, 0.045, has(mask, 16), 4.0);
  } else {
    // OPERATOR (top-down): boots, uniform, plate carrier with pouches, arms on the weapon, headgear.
    float lg = sin(ph) * 0.2;
    add(sdEll(p - vec2(lg, -0.11), vec2(0.13, 0.06)), 6.0);
    add(sdEll(p - vec2(-lg, 0.11), vec2(0.13, 0.06)), 6.0);
    add(sdEll(p, vec2(0.15, 0.25)), 6.0);
    if(uRig < 2){
      float plate = sdBox(p - vec2(0.0, 0.0), uRig == 0 ? vec2(0.135, 0.17) : vec2(0.11, 0.19)) - 0.02;
      add(plate, 7.0);
      for(int i = 0; i < 12; i++){
        if(i >= uPouchCount) break;
        vec4 q = uPouch[i];
        float dq = uPouchKind[i].x > 1.5 && uPouchKind[i].x < 2.5 ? length(p - q.xy) - q.z : sdBox(p - q.xy, q.zw) - 0.008;
        add(dq, 8.0 + float(i) * 0.001);
      }
    }
    // Weapon along +x from the hands
    float rx = uGun0.x, bl = uGun0.y, sup = uGun0.z, stk = uGun0.w;
    float gx0 = 0.12;
    add(sdBox(p - vec2(gx0 + rx * 0.5, 0.06), vec2(rx * 0.5, 0.028)), 9.0);
    add(sdBox(p - vec2(gx0 + rx + bl * 0.5, 0.06), vec2(bl * 0.5, 0.012)), 9.0);
    if(sup > 0.0) add(sdBox(p - vec2(gx0 + rx + bl + sup * 0.5, 0.06), vec2(sup * 0.5, 0.022)) - 0.004, 9.0);
    if(stk > 0.0) add(sdBox(p - vec2(gx0 - stk * 0.5, 0.06), vec2(stk * 0.5, 0.022)), 9.0);
    if(uGun1.x > 0.5) add(sdBox(p - vec2(gx0 + rx * 0.45, 0.06), vec2(uGun1.x > 2.5 ? 0.09 : 0.035, 0.018)), 9.0);
    if(uGun1.y > 0.5) add(sdBox(p - vec2(gx0 + rx + 0.03, 0.093), vec2(0.03, 0.012)), 9.0);
    if(uGun1.z > 0.5) add(sdBox(p - vec2(gx0 + rx + 0.03, 0.027), vec2(0.04, 0.014)), 9.0);
    if(uGun1.w > 1.5 && uGun1.w < 2.5) add(length(p - vec2(gx0 + rx * 0.55, 0.12)) - 0.06, 9.0);
    // Arms reach the grip and the handguard
    limb(p, vec2(0.02, 0.2), vec2(gx0 + 0.04, 0.07), 0.2, 0.2, 1.0, 0.055, 0.045, true, 6.0);
    limb(p, vec2(0.02, -0.2), vec2(gx0 + rx * 0.85, 0.05), 0.26, 0.26, -1.0, 0.055, 0.045, true, 6.0);
    // Head and headgear
    add(length(p - vec2(0.02, 0.0)) - 0.105, uHead == 3 ? 11.0 : 10.0);
    if(uHead == 0 || uHead == 2) add(sdEll(p - vec2(0.1, 0.0), vec2(0.05, 0.08)), 10.0);
    if(uHead == 0 || uHead == 2) add(length(p - vec2(0.09, -0.08)) - 0.045, 10.0);
    if(uHead == 1 || uHead == 2) add(sdBox(p - vec2(0.12, 0.0), vec2(0.035, 0.05)), 9.0);
  }
  return gD;
}

vec3 paletteFor(float part, float type, vec2 p, float seed){
  if(type > 2.5){
    if(part < 6.5) return uSuit;
    if(part < 7.5) return vec3(0.16, 0.16, 0.14);
    if(part < 8.5) return vec3(0.21, 0.21, 0.17);
    if(part < 9.5) return vec3(0.07, 0.07, 0.075);
    if(part < 10.5) return vec3(0.12, 0.13, 0.12);
    return vec3(0.55, 0.42, 0.34);
  }
  if(part > 4.5 && part < 5.5) return vec3(0.28, 0.02, 0.02);
  if(type < 0.5) return mix(vec3(0.34, 0.29, 0.28), vec3(0.20, 0.13, 0.13), vnoise2(p * 18.0 + seed));
  if(type < 1.5) return vec3(0.035, 0.035, 0.04) + 0.03 * vnoise2(p * 30.0);
  float seam = smoothstep(0.02, 0.0, abs(fract(p.y * 9.0 + vnoise2(p * 6.0 + seed) * 0.6) - 0.5) - 0.46);
  return mix(vec3(0.74, 0.63, 0.56), vec3(0.32, 0.16, 0.14), seam * 0.8);
}

void main(){
  vec2 p = vec2(vLocal.x, vLocal.y);
  float type = vB.x, kind = vB.w;
  float d = scene(p);
  if(d > 0.0) discard;
  float part = gPart;
  float e = 0.012;
  float dx = scene(p + vec2(e, 0.0)) - scene(p - vec2(e, 0.0));
  float dy = scene(p + vec2(0.0, e)) - scene(p - vec2(0.0, e));
  d = scene(p); part = gPart;
  float bulge = smoothstep(0.0, -0.06, d);
  vec2 g = vec2(dx, dy) / (2.0 * e);
  float c = cos(vA.z), s = sin(vA.z);
  vec2 gw = vec2(c * g.x - s * g.y, s * g.x + c * g.y);
  vec3 n = normalize(vec3(gw * (1.0 - bulge) * 1.8, 1.0));

  vec3 alb = paletteFor(part, type, p, vD.w);
  float rough = type > 0.5 && type < 1.5 ? 0.22 : 0.7;
  if(type > 2.5 && part < 6.5){
    float seam = smoothstep(0.012, 0.0, abs(p.x) - 0.0) * 0.4;
    alb = mix(alb, uSuitSeam, seam);
    alb = mix(alb, vec3(0.2, 0.17, 0.12), uDirt * (0.4 + 0.6 * vnoise2(p * 14.0)));
    for(int i = 0; i < 24; i++){
      if(i >= uWearCount) break;
      vec4 wv = uWear[i];
      float dd = length(p - wv.xy) - wv.z * (0.75 + 0.5 * vnoise2(p * 40.0 + float(i)));
      if(wv.w < 0.5) alb = mix(alb, vec3(0.2, 0.02, 0.015), smoothstep(0.01, -0.01, dd) * 0.9);
      else if(wv.w < 1.5) alb = mix(alb, vec3(0.18, 0.15, 0.1), smoothstep(0.02, -0.02, dd) * 0.6);
      else alb = mix(alb, vec3(0.06, 0.05, 0.04), smoothstep(0.004, -0.004, abs(dd + wv.z * 0.5) - 0.006));
    }
    if(part < 6.5 && abs(p.y) > 0.07 && abs(p.y) < 0.16 && abs(p.x) > 0.04) alb = mix(alb, vec3(0.25, 0.02, 0.015), uBootBlood * 0.6);
  }
  if(type > 2.5 && part > 7.5 && part < 8.5){
    int idx = int(round((part - 8.0) * 1000.0));
    float full = uPouchKind[idx].y;
    alb *= mix(0.55, 1.0, full);
    vec4 q = uPouch[idx];
    if(full > 0.5 && sdBox(p - q.xy, q.zw * 0.55) < 0.0) alb = mix(alb, vec3(0.05), 0.5);
  }
  float blood = vC.y;
  if(blood > 0.0 && type < 2.5){
    float m = smoothstep(1.0 - blood, 1.0 - blood + 0.2, vnoise2(p * 9.0 + vD.w * 13.0));
    alb = mix(alb, vec3(0.22, 0.01, 0.01), m);
    rough = mix(rough, 0.15, m);
  }
  alb += vec3(vC.x * 0.7, vC.x * 0.55, vC.x * 0.45);
  if(kind > 2.5){ alb = vec3(0.24, 0.008, 0.008); rough = 0.12; }
  vec2 wpos = vA.xy + vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  oAlb = vec4(alb, rough);
  oNrm = vec4(n * 0.5 + 0.5, 1.0);
  oPos = vec4(wpos, vC.w * (0.82 + 0.18 * bulge), 1.0);
}
`;

/* ---------- 4. lighting ---------- */

export const FS_LIGHT = HEAD + LIGHTS + `
in vec2 vUv;
uniform sampler2D gAlb; uniform sampler2D gNrm; uniform sampler2D gPos;
uniform float uHc;
uniform vec3 uAmbient;
out vec4 o;
void main(){
  vec4 A = texture(gAlb, vUv), Nn = texture(gNrm, vUv), P = texture(gPos, vUv);
  vec3 N = normalize(Nn.xyz * 2.0 - 1.0);
  float ao = Nn.a;
  vec3 pos = P.xyz;
  float rough = A.a;
  vec3 V = normalize(vec3(0.0, 0.0, uHc) - pos);
  vec3 col = uAmbient * A.rgb * ao;
  for(int i = 0; i < MAXL; i++){
    if(i >= uLightCount) break;
    vec4 lp = uLPos[i];
    vec3 L = lp.xyz - pos;
    float d = length(L);
    if(d > lp.w) continue;
    vec3 l = L / d;
    float ndl = dot(N, l);
    if(ndl <= 0.0) continue;
    float att = 1.0 / (1.0 + d * d * 0.32) * smoothstep(lp.w, lp.w * 0.55, d);
    vec4 lc = uLCol[i];
    if(lc.w > 0.5){
      float cd = dot(-l, uLDir[i].xyz);
      float cone = smoothstep(uLDir[i].w, uLExt[i].x, cd);
      if(cone <= 0.0) continue;
      att *= cone;
    }
    float sh = shadowAt(i, pos.xy - lp.xy);
    if(sh <= 0.0) continue;
    vec3 H = normalize(l + V);
    float shin = mix(90.0, 6.0, rough);
    float spec = pow(max(dot(N, H), 0.0), shin) * (1.0 - rough) * (shin + 8.0) / 60.0;
    col += lc.rgb * att * sh * ndl * (A.rgb + vec3(spec)) * mix(1.0, ao, 0.5);
  }
  o = vec4(col, 1.0);
}
`;

/* ---------- 5. emissive lines and panels ---------- */

export const VS_LINE = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 iA;   // ax, ay, az, width (m)
layout(location=2) in vec4 iB;   // bx, by, bz, kind (0 beam, 1 panel)
layout(location=3) in vec4 iC;   // rgb, intensity
uniform vec2 uRes; uniform float uPPM; uniform float uHc;
out vec2 vT; flat out vec4 vC; flat out float vKind;
vec2 proj(vec3 w){ float f = uHc / (uHc - w.z); return w.xy * uPPM * f; }
void main(){
  vec2 a = proj(iA.xyz), b = proj(iB.xyz);
  vec2 dir = b - a; float len = max(length(dir), 1e-3); dir /= len;
  vec2 nrm = vec2(-dir.y, dir.x);
  float wpx = iA.w * uPPM * uHc / (uHc - max(iA.z, iB.z));
  float t = aCorner.x * 0.5 + 0.5;
  vec2 pt = mix(a, b, t) + nrm * aCorner.y * wpx + dir * (aCorner.x * wpx);
  float z = mix(iA.z, iB.z, t);
  gl_Position = vec4(pt.x / (uRes.x * 0.5), -pt.y / (uRes.y * 0.5), (1.0 - z / uHc) * 2.0 - 1.0, 1.0);
  vT = vec2(t, aCorner.y); vC = iC; vKind = iB.w;
}
`;

export const FS_LINE = HEAD + `
in vec2 vT; flat in vec4 vC; flat in float vKind;
out vec4 o;
void main(){
  float a;
  if(vKind < 0.5){ a = exp(-vT.y * vT.y * 6.0) * smoothstep(0.0, 0.04, vT.x) * smoothstep(1.0, 0.85, vT.x); }
  else { float tube = exp(-pow(abs(vT.y) * 3.0 - 1.2, 2.0) * 6.0); a = (0.35 + tube) * smoothstep(1.0, 0.8, abs(vT.y)) * smoothstep(0.0, 0.03, vT.x) * smoothstep(1.0, 0.97, vT.x); }
  o = vec4(vC.rgb * vC.a * a, 1.0);
}
`;

/* ---------- 6. volumetric fog ---------- */

export const FS_FOG = HEAD + NOISE + LIGHTS + `
in vec2 vUv;
uniform sampler2D gPos;
uniform float uHc; uniform float uHw;
uniform float uTime; uniform float uDensity; uniform vec2 uCamW;
uniform int uFogCount;
out vec4 o;
void main(){
  vec3 P = texture(gPos, vUv).xyz;
  vec3 E = vec3(0.0, 0.0, uHc);
  float s0 = clamp((uHc - uHw) / max(uHc - P.z, 0.01), 0.0, 1.0);
  vec3 S0 = E + (P - E) * s0;
  vec3 seg = P - S0;
  float len = length(seg);
  const int N = 10;
  float stepL = len / float(N);
  float jit = hash12(gl_FragCoord.xy + fract(uTime * 7.3) * 97.0);
  vec3 acc = vec3(0.0);
  float T = 1.0;
  for(int i = 0; i < N; i++){
    vec3 S = S0 + seg * ((float(i) + jit) / float(N));
    vec3 wp = S + vec3(uCamW, 0.0);
    float dens = uDensity * (0.55 + 0.9 * vnoise3(wp * vec3(0.45, 0.45, 0.9) + vec3(0.0, uTime * 0.07, uTime * 0.03)));
    vec3 ins = vec3(0.0);
    for(int j = 0; j < MAXL; j++){
      if(j >= uFogCount) break;
      vec4 lp = uLPos[j];
      vec3 L = lp.xyz - S;
      float d = length(L);
      if(d > lp.w) continue;
      float att = 1.0 / (1.0 + d * d * 0.55) * smoothstep(lp.w, lp.w * 0.4, d);
      vec4 lc = uLCol[j];
      if(lc.w > 0.5){
        float cd = dot(-L / d, uLDir[j].xyz);
        float cone = smoothstep(uLDir[j].w, uLExt[j].x, cd);
        if(cone <= 0.0) continue;
        att *= cone * 1.6;
      }
      ins += lc.rgb * att * shadowHard(j, S.xy - lp.xy);
    }
    acc += T * ins * dens * stepL;
    T *= exp(-dens * stepL * 0.6);
  }
  o = vec4(acc * 0.14, T);
}
`;

/* ---------- 7. composite + dust ---------- */

export const FS_COMPOSE = HEAD + `
in vec2 vUv;
uniform sampler2D uLit; uniform sampler2D uFog;
uniform float uFogOn;
out vec4 o;
void main(){
  vec3 c = texture(uLit, vUv).rgb;
  if(uFogOn > 0.5){ vec4 f = texture(uFog, vUv); c = c * mix(1.0, f.a, 0.85) + f.rgb; }
  o = vec4(c, 1.0);
}
`;

export const VS_DUST = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 iA;   // seed xyz, size
uniform vec2 uRes; uniform float uPPM; uniform float uHc; uniform float uHw;
uniform vec2 uCamW; uniform float uTime; uniform vec2 uSpan;
out vec2 vC; out vec2 vScreenUv;
void main(){
  vec3 drift = vec3(sin(uTime * 0.11 + iA.x * 40.0), cos(uTime * 0.09 + iA.y * 37.0), sin(uTime * 0.07 + iA.z * 23.0)) * 0.6;
  vec3 base = iA.xyz * vec3(uSpan, uHw * 0.92) + drift + vec3(0.0, 0.0, uTime * 0.01);
  vec2 rel = mod(base.xy - uCamW + uSpan * 0.5, uSpan) - uSpan * 0.5;
  float z = 0.05 + mod(base.z, uHw * 0.92);
  float f = uHc / (uHc - z);
  vec2 scr = rel * uPPM * f + aCorner * iA.w * f;
  gl_Position = vec4(scr.x / (uRes.x * 0.5), -scr.y / (uRes.y * 0.5), 0.0, 1.0);
  vC = aCorner;
  vScreenUv = (rel * uPPM * f) / uRes + 0.5;
  vScreenUv.y = 1.0 - vScreenUv.y;
}
`;

export const FS_DUST = HEAD + `
in vec2 vC; in vec2 vScreenUv;
uniform sampler2D uLit; uniform float uAmount;
out vec4 o;
void main(){
  float a = smoothstep(1.0, 0.0, length(vC));
  vec3 l = texture(uLit, vScreenUv).rgb;
  float lum = dot(l, vec3(0.3, 0.59, 0.11));
  o = vec4(l * a * uAmount * (0.6 + 2.5 * smoothstep(0.15, 1.2, lum)), 1.0);
}
`;

/* ---------- 8. blur pyramid ---------- */

export const FS_DOWN = HEAD + `
in vec2 vUv; uniform sampler2D uSrc; uniform vec2 uTexel; out vec4 o;
void main(){
  vec3 c = texture(uSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture(uSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb
         + texture(uSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture(uSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  o = vec4(c * 0.25, 1.0);
}
`;

export const FS_BLUR = HEAD + `
in vec2 vUv; uniform sampler2D uSrc; uniform vec2 uDir; out vec4 o;
void main(){
  vec3 c = texture(uSrc, vUv).rgb * 0.227;
  c += (texture(uSrc, vUv + uDir * 1.38).rgb + texture(uSrc, vUv - uDir * 1.38).rgb) * 0.316;
  c += (texture(uSrc, vUv + uDir * 3.23).rgb + texture(uSrc, vUv - uDir * 3.23).rgb) * 0.070;
  o = vec4(c, 1.0);
}
`;

/* ---------- 9. post ---------- */

export const FS_POST = HEAD + NOISE + `
in vec2 vUv;
uniform sampler2D uComp; uniform sampler2D uB1; uniform sampler2D uB2; uniform sampler2D uB3;
uniform vec2 uRes; uniform float uTime;
uniform float uExposure; uniform float uNvg; uniform float uMaskOn; uniform float uMaskFog; uniform float uBreath;
uniform float uDamage; uniform float uGrain; uniform float uFlash; uniform float uAds;
out vec4 o;
vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
void main(){
  vec2 dc = vUv - 0.5;
  float r2 = dot(dc, dc);
  float ca = 0.0035 * r2;
  vec3 c;
  c.r = texture(uComp, vUv - dc * ca).r;
  c.g = texture(uComp, vUv).g;
  c.b = texture(uComp, vUv + dc * ca).b;
  vec3 b1 = texture(uB1, vUv).rgb, b2 = texture(uB2, vUv).rgb, b3 = texture(uB3, vUv).rgb;
  vec3 bloom = max(b1 - 0.9, 0.0) * 0.35 + max(b2 - 0.7, 0.0) * 0.45 + max(b3 - 0.5, 0.0) * 0.6;
  c += bloom;
  c *= uExposure * (1.0 + uFlash * 0.4);
  if(uMaskOn > 0.5){
    // Condensation creeps in from the visor edges with each exhale.
    float edge = smoothstep(0.08, 0.42, length(dc * vec2(1.0, 1.25)));
    float n = fbm2(vUv * vec2(9.0, 6.0) + vec2(0.0, uTime * 0.02));
    float fog = clamp(uMaskFog * (0.55 + 0.45 * uBreath) * (edge * 1.3 + n * 0.35), 0.0, 0.92);
    vec3 blurred = b2 * uExposure * 1.1 + vec3(0.02);
    c = mix(c, blurred + vec3(0.05, 0.055, 0.06) * fog, fog);
    float lens = smoothstep(0.62, 0.52, length(dc * vec2(1.0, 1.35)));
    c *= mix(0.25, 1.0, lens);
  }
  if(uNvg > 0.5){
    float l = dot(c, vec3(0.3, 0.59, 0.11)) * 4.5;
    l = l / (1.0 + l);
    l += (hash12(gl_FragCoord.xy + fract(uTime) * 311.0) - 0.5) * 0.22;
    l *= 1.0 - 0.15 * step(0.985, hash12(vec2(floor(uTime * 24.0), gl_FragCoord.y * 0.1)));
    vec3 g = vec3(0.10, 0.95, 0.30) * l + vec3(0.0, 0.03, 0.0);
    float tube = smoothstep(0.52, 0.44, length(dc * vec2(uRes.x / uRes.y, 1.0)));
    c = g * tube;
  } else {
    c = aces(c);
  }
  c = mix(c, vec3(0.35, 0.0, 0.0), uDamage * smoothstep(0.22, 0.62, length(dc)) * 0.55);
  c *= 1.0 - smoothstep(0.35, 0.85, length(dc)) * (0.55 + uAds * 0.3);
  c += (hash12(gl_FragCoord.xy * 1.37 + fract(uTime * 13.0) * 431.0) - 0.5) * uGrain;
  o = vec4(pow(max(c, 0.0), vec3(1.0 / 2.2)), 1.0);
}
`;

/* ---------- gore painting (rendered into the toroidal gore map) ---------- */

export const VS_SPLAT = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 iA;   // center texel x, y, half size (texels), angle
layout(location=2) in vec4 iB;   // kind, seed, speed, intensity
layout(location=3) in vec4 iC;   // streak end (texels rel), width, time
uniform vec2 uRes;
out vec2 vL; flat out vec4 vA; flat out vec4 vB; flat out vec4 vC;
void main(){
  float c = cos(iA.w), s = sin(iA.w);
  vec2 l = aCorner * iA.z;
  vec2 p = iA.xy + vec2(c * l.x - s * l.y, s * l.x + c * l.y);
  gl_Position = vec4(p / uRes * 2.0 - 1.0, 0.0, 1.0);
  vL = aCorner; vA = iA; vB = iB; vC = iC;
}
`;

export const FS_SPLAT = HEAD + NOISE + `
in vec2 vL; flat in vec4 vA; flat in vec4 vB; flat in vec4 vC;
out vec4 o;
float sdCap(vec2 p, vec2 a, vec2 b, float r){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) - r; }
void main(){
  float kind = vB.x, seed = vB.y, spd = vB.z, inten = vB.w;
  vec2 p = vL;                       // -1..1, +x along travel direction
  float thick = 0.0, hole = 0.0;
  if(kind < 0.5){
    // High-velocity impact: a dense core, then satellite droplets thrown forward in a cone.
    // Faster impacts make thinner, longer droplets with exclamation-mark tails.
    float el = 1.0 + spd * 0.9;
    float core = length(p * vec2(1.0 / (0.3 * el), 1.0 / 0.3) - vec2(0.25, 0.0)) - 1.0;
    core += (fbm2(p * 7.0 + seed * 13.0) - 0.5) * 0.9;
    thick = smoothstep(0.1, -0.2, core);
    for(int i = 0; i < 18; i++){
      float fi = float(i);
      float a = (hash12(vec2(seed, fi)) - 0.5) * (1.4 - spd * 0.6);
      float dist = 0.25 + hash12(vec2(fi, seed + 3.1)) * 0.7;
      vec2 dir = vec2(cos(a), sin(a));
      vec2 c = dir * dist;
      float r = (0.02 + hash12(vec2(seed + 7.7, fi)) * 0.06) * (1.0 - dist * 0.5);
      float tail = r * (1.5 + spd * 6.0) * dist;
      float dd = sdCap(p, c - dir * tail, c, r * 0.35);
      dd = min(dd, length(p - c) - r);
      thick = max(thick, smoothstep(0.01, -0.01, dd) * 0.85);
    }
  } else if(kind < 1.5){
    // Pool: a slick with an irregular, slightly lobed edge. Painted again as it spreads.
    float ang = atan(p.y, p.x);
    float edge = 0.82 + 0.12 * sin(ang * 3.0 + seed * 9.0) + 0.08 * sin(ang * 7.0 + seed * 4.0) + (fbm2(p * 3.0 + seed) - 0.5) * 0.25;
    float r = length(p);
    thick = smoothstep(edge, edge - 0.18, r) * (0.75 + 0.25 * smoothstep(edge, 0.0, r));
  } else if(kind < 2.5){
    // Streak / drip run / smear from the center to the end point.
    vec2 pt = p * vA.z;
    float w = vC.z;
    float dd = sdCap(pt, vec2(0.0), vC.xy, w * (0.7 + 0.3 * vnoise2(pt * 0.3 + seed)));
    thick = smoothstep(0.5, -0.5, dd);
  } else if(kind < 3.5){
    // Boot print: heel and forefoot with tread bars that leave gaps.
    vec2 q = p * vec2(1.0, 2.4);
    float heel = length((q - vec2(-0.55, 0.0)) * vec2(1.6, 1.0)) - 0.42;
    float fore = length((q - vec2(0.35, 0.0)) * vec2(1.0, 0.85)) - 0.55;
    float sole = min(heel, fore);
    float tread = step(0.45, fract(p.x * 6.0 + seed));
    thick = smoothstep(0.04, -0.04, sole) * mix(0.35, 1.0, tread);
    thick *= 0.7 + 0.3 * vnoise2(p * 9.0 + seed);
  } else if(kind < 4.5){
    // Bullet hole with radial cracks and a scorch ring.
    float r = length(p);
    float ang = atan(p.y, p.x);
    float cracks = smoothstep(0.03, 0.0, abs(fract(ang * 7.0 / (2.0 * PI) + seed) - 0.5) - 0.47) * smoothstep(0.9, 0.2, r);
    hole = max(smoothstep(0.22, 0.12, r), max(smoothstep(0.65, 0.2, r) * 0.45, cracks * 0.5));
  } else {
    // Hand print from a crawling hound.
    vec2 q = p * vec2(1.0, 1.6);
    float palm = length(q - vec2(-0.2, 0.0)) - 0.45;
    float fingers = 1e3;
    for(int i = 0; i < 4; i++){ float y = (float(i) - 1.5) * 0.32; fingers = min(fingers, sdCap(q, vec2(0.2, y * 0.8), vec2(0.8, y), 0.1)); }
    thick = smoothstep(0.04, -0.04, min(palm, fingers));
  }
  if(thick < 0.003 && hole < 0.003) discard;
  o = vec4(thick * inten, thick > 0.003 ? vC.w : 0.0, hole, 1.0);
}
`;
