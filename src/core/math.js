// Shared math helpers. World units are meters; +x right, +y down (screen aligned), +z up.

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const randRange = (a, b) => a + Math.random() * (b - a);
export const randSign = () => (Math.random() < 0.5 ? -1 : 1);

export function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

// World seed: every generated room, light and vent derives from (seed, cell, salt).
let SEED = 1;
export const setSeed = s => { SEED = s | 0; };
export const getSeed = () => SEED;

export function hash3(a, b, c) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1274126177) ^ Math.imul(SEED, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function rng(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Segment vs circle: distance along the segment to the first contact, or -1.
export function segCircle(ox, oy, dx, dy, len, cx, cy, r) {
  const fx = cx - ox, fy = cy - oy;
  const t = fx * dx + fy * dy;
  if (t < -r || t > len + r) return -1;
  const px = fx - dx * t, py = fy - dy * t;
  const d2 = px * px + py * py;
  if (d2 > r * r) return -1;
  const back = Math.sqrt(r * r - d2);
  const hit = t - back;
  return hit < 0 ? 0 : hit > len ? -1 : hit;
}
