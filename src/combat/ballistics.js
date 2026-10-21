// Caliber-based hitscan ballistics.
//
// A round carries kinetic energy. Each surface it meets costs energy:
//   drywall   penetrable; the cost scales with how obliquely the round crosses it
//   concrete  not penetrable; below a caliber's critical grazing angle the round may
//             ricochet, keeping part of its energy, otherwise it spalls and stops
//   metal     vent grilles; ricochet-prone
//   flesh     damage scales with remaining energy; high-energy rounds over-penetrate

import { TILE, isSolid, surfaceOf } from '../world/world.js';

export const CALIBERS = {
  '9x19':  { name:'9×19mm Parabellum', v0:360, mass:8.0,  pellets:1, dmg:34, crit:22, wallCost:1.0,  fleshCost:420, sound:45 },
  '45acp': { name:'.45 ACP',           v0:260, mass:14.9, pellets:1, dmg:42, crit:28, wallCost:1.15, fleshCost:520, sound:42 },
  '556':   { name:'5.56×45mm NATO',    v0:930, mass:4.0,  pellets:1, dmg:40, crit:12, wallCost:0.55, fleshCost:900, sound:72 },
  '762':   { name:'7.62×39mm',         v0:715, mass:7.9,  pellets:1, dmg:48, crit:16, wallCost:0.45, fleshCost:600, sound:76 },
  '12ga':  { name:'12 ga 00 buckshot', v0:400, mass:3.5,  pellets:9, dmg:15, crit:30, wallCost:1.6,  fleshCost:200, sound:62 },
};

for (const k in CALIBERS) {
  const c = CALIBERS[k];
  c.energy = 0.5 * (c.mass / 1000) * c.v0 * c.v0;   // joules per projectile
}

const DRYWALL_COST = 140;     // joules to cross one partition head-on, scaled by caliber
const STOP_ENERGY = 40;

// Trace one projectile. `hitEntities(ox, oy, dx, dy, len)` returns candidates sorted by
// distance: [{ t, id, r }]. Returns segments for tracers and events for effects/sound/gore.
export function traceRound(win, ox, oy, dx, dy, caliberId, velMult, hitEntities, maxRange = 90) {
  const cal = CALIBERS[caliberId];
  let E = cal.energy * velMult * velMult;
  const E0 = E;
  const segs = [], events = [];
  let x = ox, y = oy, range = maxRange;
  const hitIds = new Set();

  for (let bounce = 0; bounce < 5 && E > STOP_ENERGY && range > 0.2; bounce++) {
    const wall = win.rayWall(x, y, dx, dy, range);
    // Entities before the wall
    let blocked = false;
    for (const h of hitEntities(x, y, dx, dy, wall.t)) {
      if (hitIds.has(h.id)) continue;
      hitIds.add(h.id);
      const frac = Math.pow(E / cal.energy, 0.6);
      const hx = x + dx * h.t, hy = y + dy * h.t;
      events.push({ type:'flesh', id:h.id, x:hx, y:hy, dx, dy, dmg:cal.dmg * frac, energy:E, speed:Math.sqrt(E / E0) });
      E -= cal.fleshCost * (0.6 + Math.random() * 0.8);
      if (E <= STOP_ENERGY) {
        segs.push([x, y, hx, hy]);
        blocked = true;
        break;
      }
    }
    if (blocked) return { segs, events };

    const hx = x + dx * wall.t, hy = y + dy * wall.t;
    segs.push([x, y, hx, hy]);
    range -= wall.t;
    if (wall.axis < 0) break;                       // ran out of range in open air
    const nx = wall.axis === 0 ? -wall.sx : 0, ny = wall.axis === 1 ? -wall.sy : 0;
    const surf = surfaceOf(wall.type);
    const cosI = Math.abs(dx * nx + dy * ny);       // 1 = head on, 0 = grazing
    const grazeDeg = Math.asin(Math.min(1, cosI)) * 180 / Math.PI;

    if (surf === 'drywall') {
      // Walk through the partition to find the exit face.
      let ex = hx, ey = hy, inside = 0;
      for (let s = 0; s < 12; s++) {
        ex += dx * TILE * 0.25; ey += dy * TILE * 0.25; inside += TILE * 0.25;
        if (!isSolid(win.tileAtM(ex, ey))) break;
      }
      const cost = DRYWALL_COST * cal.wallCost * (inside / TILE) / Math.max(cosI, 0.35);
      events.push({ type:'impact', surf, x:hx, y:hy, nx, ny, dx, dy, energy:E });
      if (E - cost > STOP_ENERGY && !isSolid(win.tileAtM(ex, ey))) {
        E -= cost;
        events.push({ type:'exit', surf, x:ex, y:ey, nx:-nx, ny:-ny, dx, dy, energy:E });
        const yaw = (Math.random() - 0.5) * 0.07;
        const c = Math.cos(yaw), s2 = Math.sin(yaw);
        const ndx = dx * c - dy * s2, ndy = dx * s2 + dy * c;
        dx = ndx; dy = ndy;
        x = ex + dx * 0.02; y = ey + dy * 0.02;
        range -= inside;
        continue;
      }
      break;
    }

    // Dense surfaces: ricochet below the critical angle, otherwise spall and stop.
    const crit = cal.crit * (surf === 'metal' ? 1.3 : 1);
    const chance = grazeDeg < crit ? (1 - grazeDeg / crit) * 0.9 : 0;
    if (Math.random() < chance) {
      const dot = dx * nx + dy * ny;
      let rx = dx - 2 * dot * nx, ry = dy - 2 * dot * ny;
      const jitter = (Math.random() - 0.5) * (grazeDeg + 4) * Math.PI / 180;
      const c = Math.cos(jitter), s2 = Math.sin(jitter);
      dx = rx * c - ry * s2; dy = rx * s2 + ry * c;
      // Keep the new heading off the wall.
      if (dx * nx + dy * ny < 0.05) { dx += nx * 0.1; dy += ny * 0.1; const l = Math.hypot(dx, dy); dx /= l; dy /= l; }
      E *= 0.3 + 0.3 * (1 - grazeDeg / crit);
      events.push({ type:'ricochet', surf, x:hx, y:hy, nx, ny, dx, dy, energy:E });
      x = hx + nx * 0.03; y = hy + ny * 0.03;
      continue;
    }
    events.push({ type:'impact', surf, x:hx, y:hy, nx, ny, dx, dy, energy:E });
    break;
  }
  return { segs, events };
}
