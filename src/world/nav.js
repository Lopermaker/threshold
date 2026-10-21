// Breadth-first flow fields over the streamed map window.
// One field leads to the player; a second leads to where the player is predicted to be,
// which lets "cutter" pack members get ahead of the player instead of trailing behind.

import { TILE, isSolid } from './world.js';

const UNREACHED = 0xffff;

export class FlowField {
  constructor(win) {
    this.win = win;
    this.n = win.size;
    this.dist = new Uint16Array(this.n * this.n).fill(UNREACHED);
    this.queue = new Int32Array(this.n * this.n);
    this.ox = 0;
    this.oy = 0;
    this.ready = false;
  }

  compute(goalX, goalY, maxSteps = 600) {
    const n = this.n, win = this.win;
    this.ox = win.ox; this.oy = win.oy;
    const dist = this.dist;
    dist.fill(UNREACHED);
    let gx = Math.floor(goalX / TILE) - this.ox, gy = Math.floor(goalY / TILE) - this.oy;
    if (gx < 0 || gy < 0 || gx >= n || gy >= n) { this.ready = false; return; }
    if (isSolid(win.tiles[gy * n + gx])) {
      // Goal inside a wall (predicted point): snap to the nearest open neighbour.
      let found = false;
      for (let r = 1; r < 4 && !found; r++) for (let oy = -r; oy <= r && !found; oy++) for (let ox = -r; ox <= r && !found; ox++) {
        const x = gx + ox, y = gy + oy;
        if (x >= 0 && y >= 0 && x < n && y < n && !isSolid(win.tiles[y * n + x])) { gx = x; gy = y; found = true; }
      }
      if (!found) { this.ready = false; return; }
    }
    const q = this.queue;
    let head = 0, tail = 0;
    dist[gy * n + gx] = 0;
    q[tail++] = gy * n + gx;
    while (head < tail) {
      const i = q[head++];
      const d = dist[i];
      if (d >= maxSteps) continue;
      const x = i % n, y = (i / n) | 0;
      if (x > 0) { const j = i - 1; if (dist[j] === UNREACHED && !isSolid(win.tiles[j])) { dist[j] = d + 1; q[tail++] = j; } }
      if (x < n - 1) { const j = i + 1; if (dist[j] === UNREACHED && !isSolid(win.tiles[j])) { dist[j] = d + 1; q[tail++] = j; } }
      if (y > 0) { const j = i - n; if (dist[j] === UNREACHED && !isSolid(win.tiles[j])) { dist[j] = d + 1; q[tail++] = j; } }
      if (y < n - 1) { const j = i + n; if (dist[j] === UNREACHED && !isSolid(win.tiles[j])) { dist[j] = d + 1; q[tail++] = j; } }
    }
    this.ready = true;
  }

  // Path distance in meters, or Infinity.
  sample(x, y) {
    if (!this.ready) return Infinity;
    const lx = Math.floor(x / TILE) - this.ox, ly = Math.floor(y / TILE) - this.oy;
    if (lx < 0 || ly < 0 || lx >= this.n || ly >= this.n) return Infinity;
    const d = this.dist[ly * this.n + lx];
    return d === UNREACHED ? Infinity : d * TILE;
  }

  // Unit direction that descends the field. Diagonals are only taken when both
  // orthogonal neighbours are open, so agents never clip wall corners.
  dir(x, y, out) {
    out.x = 0; out.y = 0;
    if (!this.ready) return false;
    const n = this.n;
    const lx = Math.floor(x / TILE) - this.ox, ly = Math.floor(y / TILE) - this.oy;
    if (lx < 1 || ly < 1 || lx >= n - 1 || ly >= n - 1) return false;
    const dist = this.dist;
    const here = dist[ly * n + lx];
    let best = here, bx = 0, by = 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      const v = dist[(ly + oy) * n + lx + ox];
      if (v >= best) continue;
      if (ox && oy && (dist[ly * n + lx + ox] === UNREACHED || dist[(ly + oy) * n + lx] === UNREACHED)) continue;
      best = v; bx = ox; by = oy;
    }
    if (!bx && !by) return false;
    const tx = (this.ox + lx + bx + 0.5) * TILE, ty = (this.oy + ly + by + 0.5) * TILE;
    const dx = tx - x, dy = ty - y, d = Math.hypot(dx, dy) || 1;
    out.x = dx / d; out.y = dy / d;
    return true;
  }

  // Walk downhill from (x, y) until the goal side has line of sight.
  // Used by audio to find where a sound appears to come from around corners.
  firstVisibleStep(x, y, lx, ly, maxSteps = 80) {
    const p = { x, y };
    const v = { x:0, y:0 };
    for (let i = 0; i < maxSteps; i++) {
      if (this.win.los(p.x, p.y, lx, ly)) return p;
      if (!this.dir(p.x, p.y, v)) return null;
      p.x += v.x * TILE; p.y += v.y * TILE;
    }
    return null;
  }
}
