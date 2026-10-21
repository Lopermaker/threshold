// Audio engine for real recorded assets only. With an empty slot the call is a no-op;
// there is no synthesized fallback of any kind.
//
// Spatialisation
//   Direct path      line of sight → HRTF panner at the true position.
//   Around corners   the player's flow field gives the walking distance from the source.
//                    We descend that field from the source until a cell sees the listener;
//                    the sound appears to come from that opening, attenuated by the full path
//                    length and low-passed by how much longer the path is than a straight line.
//   Early reflections for important sounds (gunshots): first-order image sources on the
//                    walls around the listener (found by 8 ray casts), each a delayed, panned,
//                    material-absorbed tap. Concrete reflects more than drywall.
//   Late reverb      convolution with a recorded impulse response, if one is loaded.

import { AUDIO_SLOTS } from '../assets/manifest.js';
import { clamp } from '../core/math.js';
import { surfaceOf } from '../world/world.js';

const SLOT = new Map(AUDIO_SLOTS.map(s => [s.id, s]));
const SPEED_OF_SOUND = 343;
const REFLECT = { concrete:0.75, drywall:0.45, metal:0.85 };

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.buffers = new Map();
    this.lastPick = new Map();
    this.pendingRaw = [];
    this.missing = new Map();
    this.vol = { master:0.9, sfx:1, amb:0.7, ui:0.8 };
    this.loops = new Map();
    this.listener = { x:0, y:0 };
    this.world = null;     // { win, field }
    this.reflectCache = { t:-1, planes:[] };
    this.voices = 0;
  }

  // Must be called from a user gesture.
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return this.ctx; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.ratio.value = 4; this.comp.attack.value = 0.003; this.comp.release.value = 0.25;
    this.master.connect(this.comp).connect(ctx.destination);
    this.bus = {};
    for (const k of ['sfx', 'amb', 'ui']) { this.bus[k] = ctx.createGain(); this.bus[k].connect(this.master); }
    this.reverbIn = ctx.createGain();
    this.convolver = ctx.createConvolver();
    this.reverbOut = ctx.createGain();
    this.reverbOut.gain.value = 0.8;
    this.reverbIn.connect(this.convolver).connect(this.reverbOut).connect(this.master);
    this.applyVolumes();
    const raw = this.pendingRaw;
    this.pendingRaw = [];
    for (const r of raw) this.decode(r.slot, r.data);
    return ctx;
  }

  applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = this.vol.master;
    this.bus.sfx.gain.value = this.vol.sfx;
    this.bus.amb.gain.value = this.vol.amb;
    this.bus.ui.gain.value = this.vol.ui;
  }

  async decode(slotId, arrayBuffer) {
    if (!this.ctx) { this.pendingRaw.push({ slot:slotId, data:arrayBuffer }); return 'queued'; }
    const buf = await this.ctx.decodeAudioData(arrayBuffer.slice(0));
    this.addBuffer(slotId, buf);
    return 'ok';
  }

  addBuffer(slotId, buffer) {
    if (!this.buffers.has(slotId)) this.buffers.set(slotId, []);
    this.buffers.get(slotId).push(buffer);
    const s = SLOT.get(slotId);
    if (s && s.ir && slotId === 'ir.corridor' || (s && s.ir && !this.convolver.buffer)) this.convolver.buffer = buffer;
  }

  has(slotId) { return this.buffers.has(slotId); }
  count(slotId) { return (this.buffers.get(slotId) || []).length; }

  pick(slotId) {
    const list = this.buffers.get(slotId);
    if (!list || !list.length) {
      this.missing.set(slotId, (this.missing.get(slotId) || 0) + 1);
      return null;
    }
    if (list.length === 1) return list[0];
    let i;
    do { i = Math.floor(Math.random() * list.length); } while (i === this.lastPick.get(slotId));
    this.lastPick.set(slotId, i);
    return list[i];
  }

  setListener(x, y) { this.listener.x = x; this.listener.y = y; }

  propagate(sx, sy) {
    const L = this.listener;
    const dx = sx - L.x, dy = sy - L.y, direct = Math.hypot(dx, dy);
    const w = this.world;
    if (!w || direct < 0.6 || w.win.los(L.x, L.y, sx, sy)) return { vx:dx, vy:dy, path:direct, occl:0 };
    let path = w.field.sample(sx, sy);
    if (!isFinite(path)) path = direct * 1.7;
    let vx = dx, vy = dy;
    const v = w.field.firstVisibleStep(sx, sy, L.x, L.y, 70);
    if (v) {
      vx = v.x - L.x; vy = v.y - L.y;
      const l = Math.hypot(vx, vy) || 1;
      vx = vx / l * path; vy = vy / l * path;
    }
    const occl = clamp(0.25 + (path - direct) / 10, 0, 1);
    return { vx, vy, path, occl };
  }

  // Wall planes around the listener, refreshed at most every 150 ms.
  reflectionPlanes(now) {
    if (now - this.reflectCache.t < 0.15) return this.reflectCache.planes;
    const planes = [];
    const w = this.world;
    if (w) {
      const L = this.listener;
      for (let k = 0; k < 8; k++) {
        const a = k / 8 * Math.PI * 2;
        const dx = Math.cos(a), dy = Math.sin(a);
        const hit = w.win.rayWall(L.x, L.y, dx, dy, 14);
        if (hit.axis < 0) continue;
        const px = L.x + dx * hit.t, py = L.y + dy * hit.t;
        const nx = hit.axis === 0 ? -hit.sx : 0, ny = hit.axis === 1 ? -hit.sy : 0;
        if (planes.some(p => p.nx === nx && p.ny === ny && Math.abs((px - p.px) * nx + (py - p.py) * ny) < 0.3)) continue;
        planes.push({ px, py, nx, ny, absorb:REFLECT[surfaceOf(hit.type)] || 0.6 });
      }
    }
    this.reflectCache = { t:now, planes };
    return planes;
  }

  play(slotId, opt = {}) {
    if (!this.ctx) return null;
    const buf = this.pick(slotId);
    if (!buf) return null;
    if (this.voices > 48 && !opt.important) return null;
    const ctx = this.ctx, s = SLOT.get(slotId) || {};
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = !!opt.loop;
    src.playbackRate.value = (opt.rate || 1) * (1 + (Math.random() - 0.5) * 2 * (opt.jitter ?? 0.04));
    const gain = ctx.createGain();
    gain.gain.value = opt.gain ?? 1;
    const bus = this.bus[opt.bus || 'sfx'];
    let out = gain;
    src.connect(gain);
    if (opt.x !== undefined && s.spatial !== false) {
      const P = this.propagate(opt.x, opt.y);
      const ref = s.ref || 2, max = s.max || 30;
      const distGain = P.path <= ref ? 1 : ref / (ref + (P.path - ref) * 1.2);
      const edge = clamp((max - P.path) / (max * 0.25), 0, 1);
      const g = distGain * edge;
      if (g < 0.003) { src.disconnect(); return null; }
      gain.gain.value *= g;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 700 + 19000 * Math.pow(1 - P.occl, 2.2);
      const pan = ctx.createPanner();
      pan.panningModel = 'HRTF';
      pan.distanceModel = 'linear';
      pan.rolloffFactor = 0;
      const l = Math.hypot(P.vx, P.vy) || 1;
      const r = Math.min(4, l);
      pan.positionX.value = P.vx / l * r;
      pan.positionY.value = 0;
      pan.positionZ.value = P.vy / l * r;
      gain.connect(lp).connect(pan).connect(bus);
      out = pan;
      const send = ctx.createGain();
      send.gain.value = 0.12 + 0.55 * P.occl;
      lp.connect(send).connect(this.reverbIn);
      if (opt.important || s.important) this.earlyReflections(gain, opt.x, opt.y, P.path, opt.now || 0);
    } else {
      gain.connect(bus);
    }
    this.voices++;
    src.onended = () => { this.voices--; };
    src.start(ctx.currentTime + (opt.delay || 0));
    return { src, gain, out };
  }

  earlyReflections(srcGain, sx, sy, direct, now) {
    const ctx = this.ctx, L = this.listener;
    const taps = [];
    for (const p of this.reflectionPlanes(now)) {
      const d = (sx - p.px) * p.nx + (sy - p.py) * p.ny;     // source distance to the plane
      const ix = sx - 2 * d * p.nx, iy = sy - 2 * d * p.ny;   // image source
      const len = Math.hypot(ix - L.x, iy - L.y);
      if (len > 40) continue;
      taps.push({ ix, iy, len, absorb:p.absorb });
    }
    taps.sort((a, b) => a.len - b.len);
    for (const t of taps.slice(0, 4)) {
      const delay = ctx.createDelay(0.25);
      delay.delayTime.value = clamp((t.len - direct) / SPEED_OF_SOUND + 0.004, 0.002, 0.24);
      const g = ctx.createGain();
      g.gain.value = t.absorb * 0.55 * Math.min(1, 6 / Math.max(t.len, 1));
      const pan = ctx.createPanner();
      pan.panningModel = 'HRTF';
      pan.rolloffFactor = 0;
      const vx = t.ix - L.x, vy = t.iy - L.y, l = Math.hypot(vx, vy) || 1;
      pan.positionX.value = vx / l * 3; pan.positionY.value = 0; pan.positionZ.value = vy / l * 3;
      srcGain.connect(delay).connect(g).connect(pan).connect(this.bus.sfx);
    }
  }

  // Persistent loops keyed by name; called every frame with the wanted gain (0 stops it).
  loop(key, slotId, gain, opt = {}) {
    if (!this.ctx) return;
    let L = this.loops.get(key);
    if (gain <= 0.001) {
      if (L) { L.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2); L.src.stop(this.ctx.currentTime + 1); this.loops.delete(key); }
      return;
    }
    if (!L) {
      const h = this.play(slotId, { ...opt, loop:true, gain:0, jitter:0 });
      if (!h) return;
      L = h;
      this.loops.set(key, L);
    }
    L.gain.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.15);
  }

  stopAllLoops() { for (const k of [...this.loops.keys()]) this.loop(k, null, 0); }

  missingSlots() { return AUDIO_SLOTS.filter(s => !this.buffers.has(s.id)); }
}
