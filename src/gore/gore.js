// Blood and damage that stays in the world.
//
// Floors: a toroidal 2048² map covering 64 m (32 texels per meter) that follows the player
// in 4 m pages. A page is wiped only when the world page it held scrolls out of range.
// Walls: an atlas of 16×96 texel slots, one per wall face tile that has been hit. Faces are
// looked up through a per-tile indirection texture, so walls get full vertical resolution.
// Channels: R blood thickness, G time painted (drying), B bullet damage.
//
// Painted shapes are directional impact masks, spreading pools, drip runs, smears, boot
// prints and hand prints. A coarse CPU mirror of blood amounts drives gory footprints.

import { TILE, HW, isSolid } from '../world/world.js';
import { GORE_SPAN, GORE_RES } from '../render/renderer.js';

const TPM = GORE_RES / GORE_SPAN;              // floor texels per meter
const PAGE_M = 4;
const PAGES = GORE_SPAN / PAGE_M;
const PAGE_TEX = GORE_RES / PAGES;
export const WALL_RES = 2048, SLOT_W = 16, SLOT_H = 96, SLOTS_X = 128, SLOTS_Y = 21, WALL_TPM = 32;
const NSLOTS = SLOTS_X * SLOTS_Y;
const NORMALS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const KIND = { impact:0, pool:1, streak:2, boot:3, hole:4, hand:5 };

const mod = (a, n) => ((a % n) + n) % n;

export class Gore {
  constructor(renderer, win) {
    this.r = renderer;
    this.win = win;
    this.queue = [];
    this.wallQueue = [];
    this.pages = new Array(PAGES * PAGES).fill(null);
    this.pools = [];
    this.drips = [];
    this.grid = new Map();
    this.slotOf = new Map();
    this.slotKeys = new Array(NSLOTS).fill(null);
    this.nextSlot = 0;
    this.faceData = new Uint16Array(win.size * win.size * 4);
    this.faceDirty = true;
    this.now = 0;
    this.camX = 0;
    this.camY = 0;
    this.stats = { splats:0, wallSplats:0 };
  }

  timeN() { return (this.now / 900) % 1; }

  /* ---------- CPU blood mirror ---------- */

  addBlood(x, y, radius, amount) {
    const s = 4;
    const r = Math.ceil(radius * s);
    const cx = Math.floor(x * s), cy = Math.floor(y * s);
    for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
      if (ox * ox + oy * oy > r * r) continue;
      const k = (cx + ox) + ',' + (cy + oy);
      const v = this.grid.get(k) || 0;
      if (amount > v) this.grid.set(k, amount);
    }
    if (this.grid.size > 120000) this.grid.clear();
  }

  bloodAt(x, y) { return this.grid.get(Math.floor(x * 4) + ',' + Math.floor(y * 4)) || 0; }

  /* ---------- floor painting ---------- */

  floor(kind, x, y, sizeM, ang, opt = {}) {
    if (Math.abs(x - this.camX) > 26 || Math.abs(y - this.camY) > 26) return;
    this.queue.push({ kind, x, y, sizeM, ang, seed:opt.seed ?? Math.random() * 100, speed:opt.speed ?? 0.5, inten:opt.inten ?? 1, ex:opt.ex ?? 0, ey:opt.ey ?? 0, width:opt.width ?? 0 });
    this.stats.splats++;
  }

  impact(x, y, dx, dy, speed, sizeM, inten = 1) {
    this.floor(KIND.impact, x, y, sizeM, Math.atan2(dy, dx), { speed, inten });
    this.addBlood(x + dx * sizeM * 0.3, y + dy * sizeM * 0.3, sizeM * 0.45, 0.8 * inten);
  }

  pool(x, y, maxR, growTime = 18) {
    this.pools.push({ x, y, r:0.08, maxR, rate:maxR / growTime, t:0, seed:Math.random() * 100 });
  }

  streak(x0, y0, x1, y1, widthM, inten = 0.8) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    this.floor(KIND.streak, x0, y0, len + widthM * 2, 0, { ex:(x1 - x0) * TPM, ey:(y1 - y0) * TPM, width:widthM * TPM, inten });
    this.addBlood((x0 + x1) / 2, (y0 + y1) / 2, Math.max(widthM, len * 0.4), 0.5 * inten);
  }

  footprint(x, y, ang, inten, hand = false) {
    this.floor(hand ? KIND.hand : KIND.boot, x, y, hand ? 0.09 : 0.15, ang, { inten:Math.min(1, inten) });
  }

  /* ---------- walls ---------- */

  faceKey(tx, ty, dir) { return tx + ',' + ty + ',' + dir; }

  setFaceTexel(tx, ty, dir, value) {
    const lx = tx - this.win.ox, ly = ty - this.win.oy, n = this.win.size;
    if (lx < 0 || ly < 0 || lx >= n || ly >= n) return;
    this.faceData[(ly * n + lx) * 4 + dir] = value;
    this.faceDirty = true;
  }

  allocSlot(tx, ty, dir) {
    const key = this.faceKey(tx, ty, dir);
    let slot = this.slotOf.get(key);
    if (slot !== undefined) return slot;
    slot = this.nextSlot;
    this.nextSlot = (this.nextSlot + 1) % NSLOTS;
    const old = this.slotKeys[slot];
    if (old) {
      this.slotOf.delete(old);
      const [ox, oy, od] = old.split(',').map(Number);
      this.setFaceTexel(ox, oy, od, 0);
    }
    this.slotKeys[slot] = key;
    this.slotOf.set(key, slot);
    this.setFaceTexel(tx, ty, dir, slot + 1);
    this.r.clearWallSlot((slot % SLOTS_X) * SLOT_W, Math.floor(slot / SLOTS_X) * SLOT_H, SLOT_W, SLOT_H);
    return slot;
  }

  rebuildFaces() {
    this.faceData.fill(0);
    for (const [key, slot] of this.slotOf) {
      const [tx, ty, dir] = key.split(',').map(Number);
      this.setFaceTexel(tx, ty, dir, slot + 1);
    }
    this.faceDirty = true;
  }

  // Convert a world point on a wall face (with outward normal) to face coordinates.
  faceAt(x, y, nx, ny) {
    const tx = Math.floor((x - nx * 0.02) / TILE), ty = Math.floor((y - ny * 0.02) / TILE);
    if (!isSolid(this.win.get(tx, ty))) return null;
    const dir = nx < -0.5 ? 0 : nx > 0.5 ? 1 : ny < -0.5 ? 2 : 3;
    const along = dir < 2 ? y - ty * TILE : x - tx * TILE;
    return { tx, ty, dir, along };
  }

  facePoint(f, along = f.along) {
    const [nx, ny] = NORMALS[f.dir];
    const x = f.dir === 0 ? f.tx * TILE : f.dir === 1 ? (f.tx + 1) * TILE : f.tx * TILE + along;
    const y = f.dir === 2 ? f.ty * TILE : f.dir === 3 ? (f.ty + 1) * TILE : f.ty * TILE + along;
    return { x, y, nx, ny };
  }

  wall(f, kind, z, sizeM, ang, opt = {}) {
    const [nx, ny] = NORMALS[f.dir];
    const along = f.dir < 2 ? [0, 1] : [1, 0];
    for (let k = -1; k <= 1; k++) {
      const tx = f.tx + along[0] * k, ty = f.ty + along[1] * k;
      const centre = f.along - k * TILE;
      if (centre + sizeM < 0 || centre - sizeM > TILE) continue;
      if (k !== 0 && (!isSolid(this.win.get(tx, ty)) || isSolid(this.win.get(tx + nx, ty + ny)))) continue;
      const slot = this.allocSlot(tx, ty, f.dir);
      this.wallQueue.push({
        slot, cu:centre * WALL_TPM, cv:z * WALL_TPM, half:sizeM * WALL_TPM, ang, kind,
        seed:opt.seed ?? Math.random() * 100, speed:opt.speed ?? 0.5, inten:opt.inten ?? 1,
        ex:(opt.ex ?? 0), ey:(opt.ey ?? 0), width:(opt.width ?? 0),
      });
      this.stats.wallSplats++;
    }
  }

  wallImpact(f, z, dirAlong, speed, sizeM) {
    // Spatter flies along the wall in the bullet's travel direction and slumps a little.
    const ang = Math.atan2(-0.25, dirAlong >= 0 ? 1 : -1);
    this.wall(f, KIND.impact, z, sizeM, ang, { speed });
    const n = 1 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const a = Math.min(TILE - 0.02, Math.max(0.02, f.along + (Math.random() - 0.5) * sizeM));
      this.drips.push({ f:{ ...f, along:a }, z:z - Math.random() * sizeM * 0.4, last:z, v:0.03 + Math.random() * 0.06, w:0.6 + Math.random() * 1.4, pause:0 });
    }
  }

  wallHole(f, z) {
    this.wall(f, KIND.hole, z, 0.05, Math.random() * 6.28);
  }

  /* ---------- composite effects ---------- */

  // A round through flesh: spatter on the floor beyond the target, and on any wall behind it.
  fleshHit(x, y, dx, dy, energy) {
    const speed = Math.min(1, energy / 1500);
    const size = 0.3 + speed * 0.55;
    this.impact(x + dx * 0.3, y + dy * 0.3, dx, dy, speed, size);
    const hit = this.win.rayWall(x, y, dx, dy, 2.6);
    if (hit.axis >= 0) {
      const wx = x + dx * hit.t, wy = y + dy * hit.t;
      const nx = hit.axis === 0 ? -hit.sx : 0, ny = hit.axis === 1 ? -hit.sy : 0;
      const f = this.faceAt(wx, wy, nx, ny);
      if (f) {
        const tang = f.dir < 2 ? dy : dx;
        this.wallImpact(f, 0.7 + Math.random() * 0.9, tang, speed, 0.18 + speed * 0.3 * (1 - hit.t / 2.6));
      }
    }
  }

  /* ---------- per frame ---------- */

  update(dt, now) {
    this.now = now;
    for (const p of this.pools) {
      p.t += dt;
      p.r = Math.min(p.maxR, p.r + p.rate * dt * (1 - p.r / p.maxR * 0.7));
      if (p.t > 0.35) {
        p.t = 0;
        this.floor(KIND.pool, p.x, p.y, p.r, 0, { seed:p.seed });
        this.addBlood(p.x, p.y, p.r * 0.85, 0.9);
      }
    }
    this.pools = this.pools.filter(p => p.r < p.maxR * 0.985);
    for (const d of this.drips) {
      if (d.pause > 0) { d.pause -= dt; continue; }
      if (Math.random() < dt * 0.7) { d.pause = 0.3 + Math.random() * 1.4; continue; }
      d.z -= d.v * dt;
      d.v *= 1 - dt * 0.05;
      if (d.last - d.z > 0.04 || d.z <= 0.02) {
        this.wall(d.f, KIND.streak, d.last, Math.abs(d.last - d.z) + 0.05, 0, { ex:0, ey:(d.z - d.last) * WALL_TPM, width:d.w, inten:0.9 });
        d.last = d.z;
      }
    }
    for (const d of this.drips) {
      if (d.z <= 0.02) {
        const p = this.facePoint(d.f);
        this.pool(p.x + p.nx * 0.07, p.y + p.ny * 0.07, 0.06 + Math.random() * 0.06, 6);
      }
    }
    this.drips = this.drips.filter(d => d.z > 0.02 && d.v > 0.004);
  }

  ensurePages(cx, cy) {
    const r = 27;
    for (let wy = Math.floor((cy - r) / PAGE_M); wy <= Math.floor((cy + r) / PAGE_M); wy++) {
      for (let wx = Math.floor((cx - r) / PAGE_M); wx <= Math.floor((cx + r) / PAGE_M); wx++) {
        const sx = mod(wx, PAGES), sy = mod(wy, PAGES), idx = sy * PAGES + sx, key = wx + ',' + wy;
        if (this.pages[idx] !== key) {
          this.pages[idx] = key;
          this.r.clearGoreRect(sx * PAGE_TEX, sy * PAGE_TEX, PAGE_TEX, PAGE_TEX);
        }
      }
    }
  }

  flush(camX, camY) {
    this.camX = camX; this.camY = camY;
    this.ensurePages(camX, camY);
    const I = this.r.splats;
    const tn = this.timeN();
    I.count = 0;
    const push = (x, y, half, ang, s) => {
      if (I.count >= I.capacity) return;
      I.data.set([x, y, half, ang, s.kind, s.seed, s.speed, s.inten, s.ex, s.ey, s.width, tn], I.count * 12);
      I.count++;
    };
    for (const s of this.queue) {
      const tx = mod(s.x / GORE_SPAN, 1) * GORE_RES, ty = mod(s.y / GORE_SPAN, 1) * GORE_RES;
      const half = s.sizeM * TPM + 2;
      const xs = [tx], ys = [ty];
      if (tx - half < 0) xs.push(tx + GORE_RES);
      if (tx + half > GORE_RES) xs.push(tx - GORE_RES);
      if (ty - half < 0) ys.push(ty + GORE_RES);
      if (ty + half > GORE_RES) ys.push(ty - GORE_RES);
      for (const x of xs) for (const y of ys) push(x, y, half, s.ang, s);
    }
    this.queue.length = 0;
    this.r.paintGore();
    for (const s of this.wallQueue) {
      const ox = (s.slot % SLOTS_X) * SLOT_W, oy = Math.floor(s.slot / SLOTS_X) * SLOT_H;
      this.r.paintWallSplat(ox, oy, SLOT_W, SLOT_H, [ox + s.cu, oy + s.cv, s.half + 2, s.ang, s.kind, s.seed, s.speed, s.inten, s.ex, s.ey, s.width, tn]);
    }
    this.wallQueue.length = 0;
    if (this.faceDirty) { this.r.uploadFaceSlots(this.faceData, this.win.size); this.faceDirty = false; }
  }
}

export { KIND as GORE_KIND, HW as WALL_HEIGHT };
