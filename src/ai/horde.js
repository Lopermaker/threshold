// The horde: a data-oriented entity store (structure of arrays) plus the systems that run it.
//
// Systems, in order: spawn → perception → pack roles → steering → separation → integrate →
// animation/footprints → attacks. Damage, dismemberment, corpses, severed limbs and blood
// droplets also live here because they share the same instance stream to the GPU.
//
// Pack roles
//   chaser   follows the flow field straight to the player
//   flanker  follows the field but slides sideways out of the player's aim, attacks from the side
//   cutter   follows a second field built from where the player will be in ~2.5 s
//   crawler  (hounds) dives into the nearest vent and resurfaces from a vent near the player,
//            out of the player's line of sight

import { TILE, ventsNear, isSolid } from '../world/world.js';
import { angleDiff, segCircle } from '../core/math.js';

export const TYPES = [
  { key:'hound',    name:'Hound',        r:0.30, hp:70,  speed:5.2, walk:1.6, dmg:10, rate:0.75, reach:0.8,  height:0.6,  stride:1.1, crawler:true },
  { key:'bacteria', name:'Bacteria',     r:0.24, hp:110, speed:4.3, walk:1.0, dmg:24, rate:1.1,  reach:1.05, height:1.9,  stride:0.9, lightShy:true },
  { key:'skin',     name:'Skin-Stealer', r:0.28, hp:150, speed:5.6, walk:1.25, dmg:26, rate:1.2, reach:0.85, height:1.75, stride:0.8, mimic:true },
];

// Local anchor of each severable part, per type: [bit, x, y]
const ANCHORS = [
  [[1, 0.47, 0], [2, 0.42, -0.3], [4, 0.42, 0.3], [8, -0.38, -0.3], [16, -0.38, 0.3]],
  [[1, 0.09, 0], [2, 0.45, -0.3], [4, 0.45, 0.3], [8, -0.05, -0.1], [16, -0.05, 0.1]],
  [[1, 0.03, 0.09], [2, 0.16, -0.3], [4, 0.16, 0.3], [8, -0.02, -0.1], [16, -0.02, 0.1]],
];
const PART_OF_BIT = { 1:0, 2:1, 4:1, 8:2, 16:2 };

const ROLE = { chaser:0, flanker:1, cutter:2, crawler:3 };
const STATE = { idle:0, hunt:1, vent:2 };
const CAP = 4096;

export class Horde {
  constructor(win) {
    this.win = win;
    const F = () => new Float32Array(CAP);
    this.x = F(); this.y = F(); this.vx = F(); this.vy = F(); this.ang = F(); this.phase = F();
    this.hp = F(); this.cd = F(); this.flash = F(); this.blood = F(); this.seed = F(); this.losT = F();
    this.ventT = F(); this.ventX = F(); this.ventY = F(); this.attackT = F(); this.speedNow = F();
    this.bleed = F(); this.feet = F(); this.stepPh = F(); this.recentE = F(); this.side = F(); this.stuck = F();
    this.type = new Uint8Array(CAP); this.role = new Uint8Array(CAP); this.state = new Uint8Array(CAP);
    this.mask = new Uint8Array(CAP); this.alive = new Uint8Array(CAP); this.pack = new Int32Array(CAP);
    this.limbDmg = new Float32Array(CAP * 5);
    this.free = [];
    for (let i = CAP - 1; i >= 0; i--) this.free.push(i);
    this.hi = 0;
    this.count = 0;
    this.packs = new Map();
    this.nextPack = 1;
    this.corpses = [];
    this.limbs = [];
    this.drops = [];
    this.spawnT = 0;
    this.density = 160;
    this.gridN = 64;
    this.cellStart = new Int32Array(this.gridN * this.gridN + 1);
    this.cellItems = new Int32Array(CAP);
    this.cellOf = new Int32Array(CAP);
    this.gridOX = 0; this.gridOY = 0;
    this.tmp = { x:0, y:0 };
    this.dir = { x:0, y:0 };
    this.kills = 0;
  }

  reset() {
    this.alive.fill(0);
    this.free = [];
    for (let i = CAP - 1; i >= 0; i--) this.free.push(i);
    this.hi = 0; this.count = 0;
    this.packs.clear();
    this.corpses = []; this.limbs = []; this.drops = [];
    this.kills = 0;
  }

  /* ---------- spawning ---------- */

  spawn(typeIdx, x, y, packId, role) {
    if (!this.free.length) return -1;
    const i = this.free.pop();
    const T = TYPES[typeIdx];
    this.alive[i] = 1; this.type[i] = typeIdx; this.role[i] = role; this.state[i] = STATE.idle;
    this.x[i] = x; this.y[i] = y; this.vx[i] = 0; this.vy[i] = 0; this.ang[i] = Math.random() * 6.28;
    this.phase[i] = Math.random() * 6.28; this.hp[i] = T.hp; this.cd[i] = 0; this.flash[i] = 0;
    this.blood[i] = Math.random() * 0.35; this.seed[i] = Math.random() * 100; this.losT[i] = Math.random() * 0.5;
    this.mask[i] = 0; this.pack[i] = packId; this.attackT[i] = 0; this.bleed[i] = 0; this.feet[i] = 0;
    this.recentE[i] = 0; this.side[i] = Math.random() < 0.5 ? -1 : 1; this.stuck[i] = 0;
    for (let k = 0; k < 5; k++) this.limbDmg[i * 5 + k] = 0;
    this.hi = Math.max(this.hi, i + 1);
    this.count++;
    return i;
  }

  kill(i) {
    this.alive[i] = 0;
    this.free.push(i);
    this.count--;
    const p = this.packs.get(this.pack[i]);
    if (p) { p.members--; if (p.members <= 0) this.packs.delete(this.pack[i]); }
  }

  spawnPack(px, py, depth) {
    const win = this.win;
    for (let tries = 0; tries < 20; tries++) {
      const a = Math.random() * 6.283, d = 22 + Math.random() * 9;
      const x = px + Math.cos(a) * d, y = py + Math.sin(a) * d;
      if (win.blocked(x, y, 0.4) || win.los(x, y, px, py)) continue;
      const r = Math.random();
      const typeIdx = r < 0.5 ? 0 : r < 0.75 ? 1 : 2;
      const size = typeIdx === 0 ? 4 + Math.floor(Math.random() * (4 + depth * 0.02)) : 2 + Math.floor(Math.random() * 3);
      const id = this.nextPack++;
      const pack = { members:0, alertAt:-1e9, seenX:px, seenY:py };
      this.packs.set(id, pack);
      for (let m = 0; m < size; m++) {
        let sx = x, sy = y;
        for (let k = 0; k < 6; k++) {
          const tx = x + (Math.random() - 0.5) * 3, ty = y + (Math.random() - 0.5) * 3;
          if (!win.blocked(tx, ty, 0.35)) { sx = tx; sy = ty; break; }
        }
        const rr = Math.random();
        let role = rr < 0.4 ? ROLE.chaser : rr < 0.7 ? ROLE.flanker : ROLE.cutter;
        if (TYPES[typeIdx].crawler && m === size - 1) role = ROLE.crawler;
        if (this.spawn(typeIdx, sx, sy, id, role) >= 0) pack.members++;
      }
      return true;
    }
    return false;
  }

  /* ---------- spatial hash over the map window ---------- */

  buildGrid() {
    const n = this.gridN, w = this.win;
    this.gridOX = w.ox * TILE; this.gridOY = w.oy * TILE;
    const counts = this.cellStart;
    counts.fill(0);
    for (let i = 0; i < this.hi; i++) {
      if (!this.alive[i] || this.state[i] === STATE.vent) { this.cellOf[i] = -1; continue; }
      const cx = Math.min(n - 1, Math.max(0, Math.floor(this.x[i] - this.gridOX)));
      const cy = Math.min(n - 1, Math.max(0, Math.floor(this.y[i] - this.gridOY)));
      const c = cy * n + cx;
      this.cellOf[i] = c;
      counts[c + 1]++;
    }
    for (let c = 0; c < n * n; c++) counts[c + 1] += counts[c];
    const fill = counts.slice(0, n * n);
    for (let i = 0; i < this.hi; i++) {
      const c = this.cellOf[i];
      if (c >= 0) this.cellItems[fill[c]++] = i;
    }
  }

  // Candidates hit by a segment, sorted by distance. Used by ballistics.
  query(ox, oy, dx, dy, len) {
    const out = [];
    const n = this.gridN;
    const steps = Math.ceil(len / 0.5) + 1;
    const seen = new Set();
    for (let s = 0; s <= steps; s++) {
      const px = ox + dx * Math.min(len, s * 0.5), py = oy + dy * Math.min(len, s * 0.5);
      const cx = Math.floor(px - this.gridOX), cy = Math.floor(py - this.gridOY);
      for (let oy2 = -1; oy2 <= 1; oy2++) for (let ox2 = -1; ox2 <= 1; ox2++) {
        const gx = cx + ox2, gy = cy + oy2;
        if (gx < 0 || gy < 0 || gx >= n || gy >= n) continue;
        const c = gy * n + gx;
        for (let k = this.cellStart[c]; k < this.cellStart[c + 1]; k++) {
          const i = this.cellItems[k];
          if (seen.has(i)) continue;
          seen.add(i);
          const t = segCircle(ox, oy, dx, dy, len, this.x[i], this.y[i], TYPES[this.type[i]].r + 0.12);
          if (t >= 0) out.push({ t, id:i });
        }
      }
    }
    out.sort((a, b) => a.t - b.t);
    return out;
  }

  // Every alive entity within radius (for sound alerts and melee).
  near(x, y, radius, fn) {
    for (let i = 0; i < this.hi; i++) {
      if (!this.alive[i]) continue;
      const d = Math.hypot(this.x[i] - x, this.y[i] - y);
      if (d <= radius) fn(i, d);
    }
  }

  alertNoise(x, y, radius, fieldP, now) {
    this.near(x, y, radius * 1.2, i => {
      const pd = fieldP.sample(this.x[i], this.y[i]);
      if (pd <= radius) {
        const p = this.packs.get(this.pack[i]);
        if (p) { p.alertAt = now; p.seenX = x; p.seenY = y; }
      }
    });
  }

  /* ---------- update ---------- */

  update(dt, ctx) {
    const { player:P, fieldP, fieldI, now, events, gore } = ctx;
    const win = this.win;

    // Spawn toward the population target, a few packs per frame at most.
    this.spawnT -= dt;
    if (this.spawnT <= 0 && this.count < this.density) {
      const burst = this.count < this.density * 0.6 ? 8 : 2;
      for (let k = 0; k < burst && this.count < this.density; k++) this.spawnPack(P.x, P.y, ctx.depth);
      this.spawnT = 0.25;
    }

    this.buildGrid();
    const dirv = this.dir;
    const aimX = Math.cos(P.aim), aimY = Math.sin(P.aim);

    for (let i = 0; i < this.hi; i++) {
      if (!this.alive[i]) continue;
      const T = TYPES[this.type[i]];
      let ex = this.x[i], ey = this.y[i];
      const dxp = P.x - ex, dyp = P.y - ey;
      const dist = Math.hypot(dxp, dyp);
      this.flash[i] = Math.max(0, this.flash[i] - dt);
      this.cd[i] -= dt;
      this.attackT[i] = Math.max(0, this.attackT[i] - dt * 2.5);
      this.recentE[i] = Math.max(0, this.recentE[i] - dt * 4000);

      // Despawn stragglers that fell far behind (keeps the horde around the player).
      if (dist > 46) { this.kill(i); continue; }

      const pack = this.packs.get(this.pack[i]);

      // In a vent: travel time elapses, then burst out somewhere close to the player.
      if (this.state[i] === STATE.vent) {
        this.ventT[i] -= dt;
        if (this.ventT[i] <= 0) {
          this.x[i] = this.ventX[i]; this.y[i] = this.ventY[i];
          this.state[i] = STATE.hunt;
          this.role[i] = ROLE.chaser;
          events.push({ type:'vent', x:this.x[i], y:this.y[i] });
        }
        continue;
      }

      // Perception, staggered: line of sight within 22 m alerts the whole pack.
      this.losT[i] -= dt;
      if (this.losT[i] <= 0) {
        this.losT[i] = 0.3 + Math.random() * 0.35;
        if (dist < 22 && win.los(ex, ey, P.x, P.y)) {
          if (pack) {
            if (now - pack.alertAt > 6) events.push({ type:'scream', x:ex, y:ey, kind:T.key });
            pack.alertAt = now; pack.seenX = P.x; pack.seenY = P.y;
          }
        }
      }
      const hunting = pack && now - pack.alertAt < 25;
      this.state[i] = hunting ? STATE.hunt : STATE.idle;

      let wantX = 0, wantY = 0, speed = T.walk;
      if (hunting) {
        speed = T.speed;
        const role = this.role[i];
        const pathD = fieldP.sample(ex, ey);
        const haveField = fieldP.dir(ex, ey, dirv);
        let fx = haveField ? dirv.x : dxp / (dist || 1), fy = haveField ? dirv.y : dyp / (dist || 1);
        if (dist < 2.2 && win.los(ex, ey, P.x, P.y)) { fx = dxp / dist; fy = dyp / dist; }

        if (role === ROLE.flanker && dist > 3.5 && dist < 16) {
          // Slide sideways relative to the player; more when inside the player's aim.
          const px = -dyp / dist, py = dxp / dist;
          const inAim = Math.max(0, (-(dxp * aimX + dyp * aimY) / dist - 0.75) * 4);
          const k = 0.7 + inAim * 1.2;
          fx += px * this.side[i] * k; fy += py * this.side[i] * k;
        } else if (role === ROLE.cutter && dist > 6 && fieldI.ready) {
          if (fieldI.dir(ex, ey, dirv)) { fx = dirv.x; fy = dirv.y; }
        } else if (role === ROLE.crawler && T.crawler && pathD > 16) {
          const vents = ventsNear(ex, ey, 6);
          if (vents.length) {
            const v = vents[0];
            const exit = v.exits.reduce((b, e) => Math.hypot(e[0] - ex, e[1] - ey) < Math.hypot(b[0] - ex, b[1] - ey) ? e : b);
            const vdx = exit[0] - ex, vdy = exit[1] - ey, vd = Math.hypot(vdx, vdy);
            if (vd < 0.6) {
              // Pick an exit vent near the player's predicted position, out of sight.
              const outs = ventsNear(P.x + P.vx * 2, P.y + P.vy * 2, 16)
                .filter(o => Math.hypot(o.x - P.x, o.y - P.y) > 5 && !win.los(o.x, o.y, P.x, P.y));
              if (outs.length) {
                const o = outs[Math.floor(Math.random() * outs.length)];
                const oe = o.exits.reduce((b, e) => Math.hypot(e[0] - P.x, e[1] - P.y) < Math.hypot(b[0] - P.x, b[1] - P.y) ? e : b);
                this.state[i] = STATE.vent;
                this.ventX[i] = oe[0]; this.ventY[i] = oe[1];
                this.ventT[i] = Math.hypot(o.x - ex, o.y - ey) / 7 + 0.8;
                events.push({ type:'ventIn', x:ex, y:ey });
                continue;
              }
              this.role[i] = ROLE.chaser;
            } else { fx = vdx / vd; fy = vdy / vd; }
          } else if (Math.random() < dt * 0.2) this.role[i] = ROLE.chaser;
        }

        // Bacteria will not move while your light is on them.
        if (T.lightShy && P.lightOn && dist < P.lightRange) {
          const facing = (dxp * -aimX + dyp * -aimY) / dist;
          if (facing > Math.cos(P.lightCone * 0.5) && win.los(ex, ey, P.x, P.y)) speed = 0;
        }
        // Skin-stealers walk like a person until they are close, then run.
        if (T.mimic && dist > 9) speed = T.walk * 1.3;
        if (this.mask[i] & 24) speed *= (this.mask[i] & 24) === 24 ? 0.35 : 0.65;   // lost legs
        const l = Math.hypot(fx, fy) || 1;
        wantX = fx / l; wantY = fy / l;
      } else {
        // Idle drift: slow, occasional turns.
        this.ang[i] += Math.sin(now * 0.3 + this.seed[i]) * dt * 0.8;
        wantX = Math.cos(this.ang[i]); wantY = Math.sin(this.ang[i]);
        if (Math.sin(now * 0.21 + this.seed[i] * 3) > 0.4) speed = 0;
      }

      // Stuck on a corner: sidestep for a moment.
      if (this.stuck[i] > 0.25) {
        const s = this.side[i];
        const nx = wantX * 0.3 - wantY * s, ny = wantY * 0.3 + wantX * s;
        const l = Math.hypot(nx, ny) || 1;
        wantX = nx / l; wantY = ny / l;
        this.stuck[i] -= dt * 2;
      }

      // Separation from neighbours in the same and adjacent grid cells.
      let sepX = 0, sepY = 0;
      const c = this.cellOf[i];
      if (c >= 0) {
        const n = this.gridN, gx = c % n, gy = (c / n) | 0;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const qx = gx + ox, qy = gy + oy;
          if (qx < 0 || qy < 0 || qx >= n || qy >= n) continue;
          const cc = qy * n + qx;
          for (let k = this.cellStart[cc]; k < this.cellStart[cc + 1]; k++) {
            const j = this.cellItems[k];
            if (j === i) continue;
            const ddx = ex - this.x[j], ddy = ey - this.y[j];
            const d2 = ddx * ddx + ddy * ddy;
            const rr = T.r + TYPES[this.type[j]].r;
            if (d2 < rr * rr && d2 > 1e-6) { const d = Math.sqrt(d2); sepX += ddx / d * (rr - d); sepY += ddy / d * (rr - d); }
          }
        }
      }

      const attackRange = T.reach + 0.3;
      if (hunting && dist < attackRange) speed *= 0.2;
      const tvx = wantX * speed + sepX * 6, tvy = wantY * speed + sepY * 6;
      const blend = 1 - Math.exp(-dt * 7);
      this.vx[i] += (tvx - this.vx[i]) * blend;
      this.vy[i] += (tvy - this.vy[i]) * blend;
      const tmp = this.tmp;
      tmp.x = ex; tmp.y = ey;
      const hit = win.move(tmp, this.vx[i] * dt, this.vy[i] * dt, T.r * 0.9);
      const moved = Math.hypot(tmp.x - ex, tmp.y - ey);
      this.stuck[i] = hit && moved < speed * dt * 0.3 ? this.stuck[i] + dt : Math.max(0, this.stuck[i] - dt);
      this.x[i] = tmp.x; this.y[i] = tmp.y;
      const sp = moved / Math.max(dt, 1e-4);
      this.speedNow[i] = sp;
      if (sp > 0.2) {
        const targetAng = hunting && dist < 3 ? Math.atan2(dyp, dxp) : Math.atan2(this.vy[i], this.vx[i]);
        this.ang[i] += angleDiff(this.ang[i], targetAng) * Math.min(1, dt * 10);
      } else if (hunting) {
        this.ang[i] += angleDiff(this.ang[i], Math.atan2(dyp, dxp)) * Math.min(1, dt * 6);
      }

      // Gait phase advances with distance travelled, so feet never skate.
      const prevPh = this.phase[i];
      this.phase[i] += moved / T.stride * Math.PI;
      if (Math.floor(prevPh / Math.PI) !== Math.floor(this.phase[i] / Math.PI) && dist < 16) {
        const side = Math.floor(this.phase[i] / Math.PI) % 2 ? 1 : -1;
        const fa = this.ang[i];
        const fxp = this.x[i] + Math.cos(fa + side * 0.6) * 0.25, fyp = this.y[i] + Math.sin(fa + side * 0.6) * 0.25;
        const b = gore.bloodAt(fxp, fyp);
        if (b > 0.25) this.feet[i] = 1;
        if (this.feet[i] > 0.06) {
          gore.footprint(fxp, fyp, fa, this.feet[i], T.key === 'hound');
          this.feet[i] *= 0.78;
        }
        if (dist < 9) events.push({ type:'step', x:fxp, y:fyp, kind:T.key });
      }

      // A severed limb keeps pumping while the thing keeps moving.
      if (this.bleed[i] > 0) {
        this.bleed[i] -= dt * 0.05;
        if (moved > 0 && Math.random() < dt * 6) gore.impact(this.x[i], this.y[i], this.vx[i], this.vy[i], 0.2, 0.12, 0.8);
      }

      // Attack
      if (hunting && dist < T.reach + P.r && this.cd[i] <= 0) {
        this.cd[i] = T.rate;
        this.attackT[i] = 1;
        events.push({ type:'attack', id:i, dmg:T.dmg, x:ex, y:ey, kind:T.key });
      }
    }

    this.updateLimbs(dt, gore);
    this.updateDrops(dt, gore);
  }

  /* ---------- damage and dismemberment ---------- */

  hit(i, dmg, hx, hy, dx, dy, energy, gore, events, cal) {
    if (!this.alive[i]) return;
    const T = TYPES[this.type[i]];
    this.flash[i] = 0.1;
    this.blood[i] = Math.min(1, this.blood[i] + 0.12);
    this.recentE[i] += energy;
    const a = this.ang[i], c = Math.cos(-a), s = Math.sin(-a);
    const lx = (hx - this.x[i]) * c - (hy - this.y[i]) * s, ly = (hx - this.x[i]) * s + (hy - this.y[i]) * c;
    let best = null, bd = 0.3;
    for (const an of ANCHORS[this.type[i]]) {
      if (this.mask[i] & an[0]) continue;
      const d = Math.hypot(lx - an[1], ly - an[2]);
      if (d < bd) { bd = d; best = an; }
    }
    let mult = 1;
    if (best && best[0] === 1) mult = 2.2;
    this.hp[i] -= dmg * mult;
    gore.fleshHit(hx, hy, dx, dy, energy);
    this.spray(hx, hy, dx, dy, energy);
    // Knockback scales with momentum.
    this.vx[i] += dx * energy * 0.0015; this.vy[i] += dy * energy * 0.0015;

    if (best) {
      const k = Math.log2(best[0]);
      this.limbDmg[i * 5 + k] += dmg * (energy > 900 ? 2.2 : 1);
      if (this.limbDmg[i * 5 + k] > (best[0] === 1 ? 70 : 45)) this.sever(i, best, dx, dy, energy, gore, events);
    }
    if (this.mask[i] & 1) this.hp[i] = 0;    // decapitated
    if (this.hp[i] <= 0) this.die(i, dx, dy, gore, events);
  }

  sever(i, an, dx, dy, energy, gore, events) {
    if (this.mask[i] & an[0]) return;
    this.mask[i] |= an[0];
    const a = this.ang[i], c = Math.cos(a), s = Math.sin(a);
    const wx = this.x[i] + an[1] * c - an[2] * s, wy = this.y[i] + an[1] * s + an[2] * c;
    const sp = 2 + Math.min(6, energy / 300);
    this.limbs.push({
      x:wx, y:wy, vx:dx * sp + (Math.random() - 0.5) * 2, vy:dy * sp + (Math.random() - 0.5) * 2,
      ang:a + (Math.random() - 0.5), av:(Math.random() - 0.5) * 18, part:PART_OF_BIT[an[0]], type:this.type[i],
      seed:Math.random() * 100, lastX:wx, lastY:wy, rest:0,
    });
    if (this.limbs.length > 1500) this.limbs.shift();
    gore.impact(wx, wy, dx, dy, 0.9, 0.7);
    gore.pool(wx, wy, 0.35, 8);
    this.bleed[i] = 1;
    for (let k = 0; k < 5; k++) this.spray(wx, wy, dx + (Math.random() - 0.5), dy + (Math.random() - 0.5), 900);
    events.push({ type:'dismember', x:wx, y:wy });
  }

  die(i, dx, dy, gore, events) {
    const T = TYPES[this.type[i]];
    // Enough energy in a short window (a close shotgun blast, a burst of rifle rounds)
    // tears the body apart instead of dropping it.
    if (this.recentE[i] > 1400) {
      for (const an of ANCHORS[this.type[i]]) {
        if (!(this.mask[i] & an[0])) this.sever(i, an, dx + (Math.random() - 0.5) * 1.2, dy + (Math.random() - 0.5) * 1.2, this.recentE[i], gore, events);
      }
      gore.impact(this.x[i], this.y[i], dx, dy, 1, 1.3);
    }
    this.corpses.push({ x:this.x[i], y:this.y[i], ang:this.ang[i], type:this.type[i], mask:this.mask[i], seed:this.seed[i], blood:Math.min(1, this.blood[i] + 0.4), phase:this.phase[i] });
    if (this.corpses.length > 600) this.corpses.shift();
    gore.pool(this.x[i], this.y[i], 0.7 + T.r * 2.2 + Math.random() * 0.4, 16 + Math.random() * 10);
    events.push({ type:'death', x:this.x[i], y:this.y[i], kind:T.key });
    this.kills++;
    this.kill(i);
  }

  // Airborne blood: droplets fly on ballistic arcs and paint where they land.
  spray(x, y, dx, dy, energy) {
    const n = 3 + Math.min(6, (energy / 300) | 0);
    for (let k = 0; k < n; k++) {
      if (this.drops.length > 1800) this.drops.shift();
      const sp = 1.5 + Math.random() * (2 + energy / 400);
      const a = Math.atan2(dy, dx) + (Math.random() - 0.5) * 1.1;
      this.drops.push({ x, y, z:1.0 + Math.random() * 0.4, vx:Math.cos(a) * sp, vy:Math.sin(a) * sp, vz:Math.random() * 2 });
    }
  }

  updateDrops(dt, gore) {
    const win = this.win;
    for (const d of this.drops) {
      d.vz -= 9.8 * dt;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      if (win.solidAt(d.x, d.y)) {
        d.z = -1;
        d.x -= d.vx * dt; d.y -= d.vy * dt;
        gore.impact(d.x, d.y, d.vx, d.vy, 0.3, 0.06, 0.8);
      } else if (d.z <= 0) {
        const sp = Math.hypot(d.vx, d.vy);
        gore.impact(d.x, d.y, d.vx / (sp || 1), d.vy / (sp || 1), Math.min(1, sp / 6), 0.05 + Math.random() * 0.05, 0.9);
      }
    }
    this.drops = this.drops.filter(d => d.z > 0);
  }

  updateLimbs(dt, gore) {
    const win = this.win;
    for (const L of this.limbs) {
      const sp = Math.hypot(L.vx, L.vy);
      if (sp < 0.03 && L.rest > 1) continue;
      const tmp = this.tmp;
      tmp.x = L.x; tmp.y = L.y;
      if (win.move(tmp, L.vx * dt, L.vy * dt, 0.08)) { L.vx *= -0.35; L.vy *= -0.35; L.av *= 0.5; }
      L.x = tmp.x; L.y = tmp.y;
      const f = Math.exp(-dt * 3.2);
      L.vx *= f; L.vy *= f; L.av *= f;
      L.ang += L.av * dt;
      if (Math.hypot(L.x - L.lastX, L.y - L.lastY) > 0.12) {
        gore.streak(L.lastX, L.lastY, L.x, L.y, 0.05, 0.7);
        L.lastX = L.x; L.lastY = L.y;
      }
      if (sp < 0.05) { L.rest += dt; if (L.rest > 0.5 && L.rest - dt <= 0.5) gore.pool(L.x, L.y, 0.22, 10); }
    }
  }

  /* ---------- GPU instances ---------- */

  fillInstances(I, cam, halfW, halfH) {
    const D = I.data;
    let n = 0;
    const put = (x, y, ang, half, type, phase, speed, kind, flash, blood, mask, z, part, lean, atk, seed) => {
      if (n >= I.capacity) return;
      if (Math.abs(x - cam.x) > halfW + 1.5 || Math.abs(y - cam.y) > halfH + 1.5) return;
      D.set([x - cam.x, y - cam.y, ang, half, type, phase, speed, kind, flash, blood, mask, z, part, lean, atk, seed], n * 16);
      n++;
    };
    for (const c of this.corpses) put(c.x, c.y, c.ang, 1.0, c.type, c.phase, 0, 1, 0, c.blood, c.mask, 0.18, 0, 0, 0, c.seed);
    for (const L of this.limbs) put(L.x, L.y, L.ang, 0.45, L.type, 0, 0, 2, 0, 1, 0, 0.1, L.part, 0, 0, L.seed);
    for (let i = 0; i < this.hi; i++) {
      if (!this.alive[i] || this.state[i] === STATE.vent) continue;
      const T = TYPES[this.type[i]];
      put(this.x[i], this.y[i], this.ang[i], 1.0, this.type[i], this.phase[i], this.speedNow[i], 0, this.flash[i], this.blood[i], this.mask[i], T.height, 0, 0, this.attackT[i], this.seed[i]);
    }
    for (const d of this.drops) put(d.x, d.y, Math.atan2(d.vy, d.vx), 0.05, 0, 0, 0, 3, 0, 1, 0, Math.max(0.02, d.z), 0, 0, 0, 0);
    I.count = n;
  }
}

export { ROLE, STATE, isSolid as _solid };
