// Infinite procedural Backrooms.
//
// The level is an endless lattice of 8 m cells (16 x 16 tiles of 0.5 m). Each cell owns
// its top and left edge. An edge is open, a drywall partition, or a poured concrete wall,
// and every wall that exists keeps a doorway, so every room on the infinite plane stays
// reachable. Cells come in three kinds: carpeted offices, pillar halls, and concrete
// utility rooms. Vents sit in walls at floor height and connect to a duct network that
// only the horde can use.

import { hash3 } from '../core/math.js';

export const TILE = 0.5;          // meters per tile
export const CELL = 16;           // tiles per cell side (8 m rooms)
export const HW = 2.7;            // wall and ceiling height, meters
export const LIGHT_Z = 2.62;      // fluorescent troffer height

export const T = { CARPET:0, CONCRETE_FLOOR:1, DRYWALL:2, CONCRETE:3, PILLAR:4, VENT:5 };
export const isSolid = t => t >= 2;
export const surfaceOf = t => (t === T.DRYWALL ? 'drywall' : t === T.VENT ? 'metal' : 'concrete');

const cellCache = new Map();
export function resetWorld() { cellCache.clear(); }

function makeEdge(cx, cy, kind, k) {
  const h = s => hash3(cx, cy, k + s);
  if (kind === 'hall') return null;
  if (kind === 'office' && h(0) < 0.42) return null;
  if (kind === 'utility' && h(0) < 0.2) return null;
  const type = kind === 'utility' || h(1) < 0.12 ? T.CONCRETE : T.DRYWALL;
  const gw = 3 + Math.floor(h(2) * 3);                         // doorway 1.5–2.5 m
  const g = 3 + Math.floor(h(3) * (CELL - 5 - gw));            // doorway start
  let vent = -1;
  if (h(4) < 0.3) {
    const v = 2 + Math.floor(h(5) * (CELL - 3));
    if (v < g - 1 || v > g + gw) vent = v;
  }
  return { type, g, gw, vent };
}

export function cellInfo(cx, cy) {
  const key = cx + ',' + cy;
  let c = cellCache.get(key);
  if (c) return c;
  if (cellCache.size > 8000) cellCache.clear();
  const h = s => hash3(cx, cy, s);
  const r = h(1);
  const kind = r < 0.6 ? 'office' : r < 0.82 ? 'hall' : 'utility';
  const top = makeEdge(cx, cy, kind, 100);
  const left = makeEdge(cx, cy, kind, 200);
  const cornerPillar = kind === 'hall' ? h(20) < 0.75 : h(20) < 0.3;
  const spots = kind === 'office' ? [[5, 8], [11, 8]]
    : kind === 'hall' ? [[8, 3.5], [8, 12.5], [3.5, 8], [12.5, 8]]
    : [[8, 8]];
  const lights = spots.map(([lx, ly], i) => {
    const s = h(30 + i);
    return {
      id: key + ':' + i,
      x: (cx * CELL + lx) * TILE,
      y: (cy * CELL + ly) * TILE,
      state: s < 0.1 ? 'dead' : s < 0.28 ? 'flicker' : 'steady',
      horiz: h(40 + i) < 0.5,
      seed: h(50 + i),
    };
  });
  c = { cx, cy, kind, top, left, cornerPillar, lights };
  cellCache.set(key, c);
  return c;
}

export function tileAt(tx, ty) {
  const cx = Math.floor(tx / CELL), cy = Math.floor(ty / CELL);
  const lx = tx - cx * CELL, ly = ty - cy * CELL;
  const c = cellInfo(cx, cy);
  if (c.cornerPillar && lx < 2 && ly < 2) return T.PILLAR;
  if (c.kind === 'hall' && (lx === 5 || lx === 6 || lx === 10 || lx === 11) && (ly === 5 || ly === 6 || ly === 10 || ly === 11)) return T.PILLAR;
  if (ly === 0 && c.top) {
    const e = c.top;
    if (lx < e.g || lx >= e.g + e.gw) return lx === e.vent ? T.VENT : e.type;
  }
  if (lx === 0 && c.left) {
    const e = c.left;
    if (ly < e.g || ly >= e.g + e.gw) return ly === e.vent ? T.VENT : e.type;
  }
  return c.kind === 'utility' ? T.CONCRETE_FLOOR : T.CARPET;
}

// Vent openings within a radius, each with the floor-side exit points on both faces.
export function ventsNear(x, y, radius) {
  const out = [];
  const c0x = Math.floor((x - radius) / (CELL * TILE)), c1x = Math.floor((x + radius) / (CELL * TILE));
  const c0y = Math.floor((y - radius) / (CELL * TILE)), c1y = Math.floor((y + radius) / (CELL * TILE));
  for (let cy = c0y; cy <= c1y; cy++) for (let cx = c0x; cx <= c1x; cx++) {
    const c = cellInfo(cx, cy);
    if (c.top && c.top.vent >= 0) {
      const tx = cx * CELL + c.top.vent, ty = cy * CELL;
      const vx = (tx + 0.5) * TILE, vy = (ty + 0.5) * TILE;
      out.push({ x:vx, y:vy, exits:[[vx, vy - TILE * 1.2], [vx, vy + TILE * 1.2]] });
    }
    if (c.left && c.left.vent >= 0) {
      const tx = cx * CELL, ty = cy * CELL + c.left.vent;
      const vx = (tx + 0.5) * TILE, vy = (ty + 0.5) * TILE;
      out.push({ x:vx, y:vy, exits:[[vx - TILE * 1.2, vy], [vx + TILE * 1.2, vy]] });
    }
  }
  return out.filter(v => Math.hypot(v.x - x, v.y - y) <= radius);
}

export function lightsInRect(x0, y0, x1, y1) {
  const out = [];
  const s = CELL * TILE;
  for (let cy = Math.floor(y0 / s); cy <= Math.floor(y1 / s); cy++) {
    for (let cx = Math.floor(x0 / s); cx <= Math.floor(x1 / s); cx++) {
      for (const l of cellInfo(cx, cy).lights) out.push(l);
    }
  }
  return out;
}

// A streamed square of tiles around the player, mirrored to a GPU texture.
export class MapWindow {
  constructor(size = 128) {
    this.size = size;
    this.ox = 0;
    this.oy = 0;
    this.tiles = new Uint8Array(size * size);
    this.texData = new Uint8Array(size * size * 4);
    this.version = 0;
    this.valid = false;
  }

  recenter(px, py, force = false) {
    const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
    const nx = tx - this.size / 2, ny = ty - this.size / 2;
    if (!force && this.valid && Math.abs(nx - this.ox) < 24 && Math.abs(ny - this.oy) < 24) return false;
    this.ox = nx; this.oy = ny;
    const n = this.size;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const t = tileAt(nx + x, ny + y);
      const i = y * n + x;
      this.tiles[i] = t;
      this.texData[i * 4] = t;
      this.texData[i * 4 + 1] = (hash3(nx + x, ny + y, 7) * 255) | 0;
      this.texData[i * 4 + 2] = 0;
      this.texData[i * 4 + 3] = 255;
    }
    this.valid = true;
    this.version++;
    return true;
  }

  get(tx, ty) {
    const lx = tx - this.ox, ly = ty - this.oy;
    if (lx < 0 || ly < 0 || lx >= this.size || ly >= this.size) return tileAt(tx, ty);
    return this.tiles[ly * this.size + lx];
  }

  tileAtM(x, y) { return this.get(Math.floor(x / TILE), Math.floor(y / TILE)); }
  solidAt(x, y) { return isSolid(this.tileAtM(x, y)); }

  blocked(x, y, r) {
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (this.solidAt(x + ox * r, y + oy * r)) return true;
    }
    return false;
  }

  // Axis-separated slide. Returns true when either axis was blocked.
  move(e, dx, dy, r) {
    let hit = false;
    if (dx) { const nx = e.x + dx; if (!this.blocked(nx, e.y, r)) e.x = nx; else hit = true; }
    if (dy) { const ny = e.y + dy; if (!this.blocked(e.x, ny, r)) e.y = ny; else hit = true; }
    return hit;
  }

  // Grid DDA in meters. visit(tx, ty, tEnter, axis, stepX, stepY) returns true to stop.
  trace(ox, oy, dx, dy, maxDist, visit) {
    let tx = Math.floor(ox / TILE), ty = Math.floor(oy / TILE);
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
    const dX = Math.abs(dx) < 1e-9 ? 1e9 : TILE / Math.abs(dx);
    const dY = Math.abs(dy) < 1e-9 ? 1e9 : TILE / Math.abs(dy);
    const fx = ox / TILE - tx, fy = oy / TILE - ty;
    let tMaxX = (dx > 0 ? 1 - fx : fx) * dX;
    let tMaxY = (dy > 0 ? 1 - fy : fy) * dY;
    if (visit(tx, ty, 0, -1, sx, sy)) return;
    for (let i = 0; i < 4000; i++) {
      let t, axis;
      if (tMaxX < tMaxY) { t = tMaxX; tMaxX += dX; tx += sx; axis = 0; }
      else { t = tMaxY; tMaxY += dY; ty += sy; axis = 1; }
      if (t > maxDist) return;
      if (visit(tx, ty, t, axis, sx, sy)) return;
    }
  }

  // Distance to the first solid tile along a ray, or maxDist.
  rayWall(ox, oy, dx, dy, maxDist) {
    let res = { t:maxDist, tx:0, ty:0, axis:-1, sx:0, sy:0, type:-1 };
    this.trace(ox, oy, dx, dy, maxDist, (tx, ty, t, axis, sx, sy) => {
      const tt = this.get(tx, ty);
      if (isSolid(tt)) { res = { t, tx, ty, axis, sx, sy, type:tt }; return true; }
      return false;
    });
    return res;
  }

  los(x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy);
    if (d < 1e-6) return true;
    return this.rayWall(x0, y0, dx / d, dy / d, d).t >= d - 1e-4;
  }

  // Distance field to the nearest wall at 4 texels per tile, packed 0..2 m into 0..255.
  computeSDF(res = 4) {
    const n = this.size * res;
    const INF = 1e9;
    const d = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      d[y * n + x] = isSolid(this.tiles[((y / res) | 0) * this.size + ((x / res) | 0)]) ? 0 : INF;
    }
    const D = Math.SQRT2;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 1);
      if (y > 0) {
        v = Math.min(v, d[i - n] + 1);
        if (x > 0) v = Math.min(v, d[i - n - 1] + D);
        if (x < n - 1) v = Math.min(v, d[i - n + 1] + D);
      }
      d[i] = v;
    }
    for (let y = n - 1; y >= 0; y--) for (let x = n - 1; x >= 0; x--) {
      const i = y * n + x;
      let v = d[i];
      if (x < n - 1) v = Math.min(v, d[i + 1] + 1);
      if (y < n - 1) {
        v = Math.min(v, d[i + n] + 1);
        if (x < n - 1) v = Math.min(v, d[i + n + 1] + D);
        if (x > 0) v = Math.min(v, d[i + n - 1] + D);
      }
      d[i] = v;
    }
    const out = new Uint8Array(n * n);
    const toM = TILE / res;
    for (let i = 0; i < n * n; i++) out[i] = Math.min(255, (d[i] * toM / 2) * 255) | 0;
    return { data:out, size:n };
  }
}
