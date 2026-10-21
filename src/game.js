// One run inside the Backrooms: ties world, horde, weapons, gore, lights, audio and renderer.

import { TILE, HW, LIGHT_Z, T, MapWindow, resetWorld, lightsInRect, surfaceOf } from './world/world.js';
import { FlowField } from './world/nav.js';
import { setSeed, clamp, lerp, angleDiff } from './core/math.js';
import { Horde, TYPES } from './ai/horde.js';
import { Gore } from './gore/gore.js';
import { traceRound, CALIBERS } from './combat/ballistics.js';
import { computeStats, recoilPattern } from './combat/gunsmith.js';
import { findUniform, findRig, findHead, pouchLayout, wearUniforms, addWear, saveProfile } from './player/operator.js';
import { MAXL } from './render/shaders.js';

const EYE = 14;                 // camera height (m) for the perspective raycast
const BASE_PPM = 56;            // CSS pixels per meter at floor level
const CAL_SLOT = { '9x19':'gun.9mm.fire', '45acp':'gun.45acp.fire', '556':'gun.556.fire', '762':'gun.762.fire', '12ga':'gun.12ga.fire' };

export class Game {
  constructor(renderer, audio, input, settings) {
    this.r = renderer;
    this.audio = audio;
    this.input = input;
    this.settings = settings;
    this.win = new MapWindow(128);
    this.fieldP = new FlowField(this.win);
    this.fieldI = new FlowField(this.win);
    this.horde = new Horde(this.win);
    this.gore = null;
    this.lightState = new Map();
    this.active = false;
    this.messages = [];
    this.time = 0;
  }

  /* ---------- lifecycle ---------- */

  start(profile, loadout) {
    this.profile = profile;
    this.loadout = loadout;
    setSeed((Math.random() * 2147483647) | 0);
    resetWorld();
    this.win.valid = false;
    const sx = 8 * TILE + 0.25, sy = 8 * TILE + 0.25;
    this.win.recenter(sx, sy, true);
    this.gore = new Gore(this.r, this.win);
    this.r.clearGore();
    this.onRecenter();
    this.horde.reset();
    this.horde.density = this.settings.density;
    this.lightState.clear();
    const mk = cfg => {
      const s = computeStats(cfg);
      return { cfg, s, mag:s.cap, reserve:s.perShell ? 24 : s.cap * 3, cool:0, reloadT:0, reloadStage:0, pumpT:0, shot:0, bloom:0, pattern:recoilPattern(cfg.platform) };
    };
    this.weapons = [mk(loadout.primary), mk(loadout.secondary)];
    this.weapons[1].reserve = this.weapons[1].s.cap * 2;
    const rig = findRig(profile.rig), head = findHead(profile.headgear);
    this.p = {
      x:sx, y:sy, vx:0, vy:0, r:0.3, hp:100, stamina:100, aim:0, aimKick:0, ads:0,
      exert:0, maskFog:0, breathPh:0, nvg:false, light:true, laser:true, wi:0, switchT:0,
      bootBlood:0, stepAcc:0, stepSide:1, startX:sx, startY:sy, depth:0, hurt:0, alive:true,
      meds:2, healT:0, sprintLock:0, rig, head,
    };
    this.cam = { x:sx, y:sy, kick:0 };
    this.stats = { kills:0, time:0, shots:0, hits:0, dismember:0 };
    this.time = 0;
    this.lines = [];
    this.flashT = 0;
    this.shake = 0;
    this.fieldT = 0;
    this.saveT = 0;
    this.messages = [];
    this.msg('ENTERED THE THRESHOLD. FIND A WAY DEEPER.');
    this.active = true;
    this.dead = false;
  }

  msg(text) {
    this.messages.unshift({ text, t:this.time });
    if (this.messages.length > 5) this.messages.pop();
  }

  onRecenter() {
    this.r.uploadMap(this.win);
    this.r.uploadSDF(this.win.computeSDF(4));
    this.gore.rebuildFaces();
    this.audio.world = { win:this.win, field:this.fieldP };
  }

  /* ---------- weapons ---------- */

  weapon() { return this.weapons[this.p.wi]; }

  muzzle() {
    const p = this.p, w = this.weapon();
    const len = 0.12 + w.s.receiver + w.s.barrelLen + w.s.muzzleLen;
    const c = Math.cos(p.aim), s = Math.sin(p.aim);
    return { x:p.x + c * len - s * 0.06, y:p.y + s * len + c * 0.06 };
  }

  fire() {
    const p = this.p, w = this.weapon(), s = w.s;
    if (w.cool > 0 || w.reloadT > 0 || w.pumpT > 0 || p.switchT > 0 || p.sprinting) return;
    if (w.mag <= 0) {
      this.audio.play('gun.dryfire', { x:p.x, y:p.y });
      w.cool = 0.25;
      this.reload();
      return;
    }
    w.mag--;
    w.cool = s.interval;
    if (s.pump) w.pumpT = 0.5;
    this.stats.shots++;
    const m = this.muzzle();
    const moving = Math.hypot(p.vx, p.vy) > 0.5 ? 1.45 : 1;
    const spread = s.spread * (1 - 0.6 * p.ads) * (1 + w.bloom) * moving;
    const kickH = w.pattern[w.shot % w.pattern.length] * s.recoilH * 0.018;
    w.shot++;
    w.bloom = Math.min(2.5, w.bloom + s.recoilV * 0.12);
    p.aimKick += kickH + (Math.random() - 0.5) * s.recoilV * 0.008;
    this.cam.kick += s.recoilV * 0.07;
    this.shake = Math.max(this.shake, s.recoilV * 0.05);
    this.flashT = 0.055;
    this.flashMult = s.flash;

    const cal = CALIBERS[s.caliber];
    for (let k = 0; k < cal.pellets; k++) {
      const a = p.aim + p.aimKick + (Math.random() - 0.5) * 2 * spread;
      const dx = Math.cos(a), dy = Math.sin(a);
      const res = traceRound(this.win, m.x, m.y, dx, dy, s.caliber, s.velMult, (ox, oy, ddx, ddy, len) => this.horde.query(ox, oy, ddx, ddy, len));
      for (const sg of res.segs) this.lines.push({ ax:sg[0], ay:sg[1], az:1.3, bx:sg[2], by:sg[3], bz:1.25, w:0.018, r:1, g:0.82, b:0.5, i:cal.pellets > 1 ? 3 : 7, life:0.05, kind:0 });
      this.handleRound(res.events, cal);
    }
    const slot = s.suppressed ? 'gun.suppressed.fire' : CAL_SLOT[s.caliber];
    this.audio.play(slot, { x:p.x, y:p.y, important:true, now:this.time, jitter:0.03 });
    if (!s.suppressed) this.audio.play('gun.tail.concrete', { gain:0.5, jitter:0.02 });
    const floor = this.win.tileAtM(p.x, p.y) === T.CARPET ? 'casing.carpet' : 'casing.concrete';
    if (!s.pump) this.audio.play(floor, { x:p.x + Math.sin(p.aim) * 0.8, y:p.y - Math.cos(p.aim) * 0.8, delay:0.3 + Math.random() * 0.2 });
    this.horde.alertNoise(p.x, p.y, s.soundRadius, this.fieldP, this.time);
  }

  handleRound(events, cal) {
    const hordeEvents = [];
    for (const e of events) {
      if (e.type === 'flesh') {
        this.stats.hits++;
        this.horde.hit(e.id, e.dmg, e.x, e.y, e.dx, e.dy, e.energy, this.gore, hordeEvents, cal);
        this.audio.play('impact.flesh', { x:e.x, y:e.y });
      } else {
        const f = this.gore.faceAt(e.x, e.y, e.nx, e.ny);
        if (f) this.gore.wallHole(f, 1.15 + (Math.random() - 0.5) * 0.3);
        const nSparks = e.surf === 'drywall' ? 0 : e.type === 'ricochet' ? 7 : 4;
        for (let k = 0; k < nSparks; k++) {
          const a = Math.atan2(e.ny, e.nx) + (Math.random() - 0.5) * 2.2;
          const l = 0.08 + Math.random() * 0.25;
          this.lines.push({ ax:e.x, ay:e.y, az:1.2, bx:e.x + Math.cos(a) * l, by:e.y + Math.sin(a) * l, bz:1.0 + Math.random() * 0.4, w:0.01, r:1, g:0.65, b:0.3, i:9, life:0.06 + Math.random() * 0.08, kind:0 });
        }
        if (e.type === 'ricochet') this.audio.play('ricochet', { x:e.x, y:e.y });
        else if (e.type !== 'exit') this.audio.play('impact.' + e.surf, { x:e.x, y:e.y });
      }
    }
    this.handleHordeEvents(hordeEvents);
  }

  reload() {
    const w = this.weapon(), s = w.s;
    if (w.reloadT > 0 || w.mag >= s.cap || w.reserve <= 0) return;
    w.reloadT = s.reload;
    w.reloadStage = 0;
    w.wasEmpty = w.mag === 0;
    if (!s.perShell) this.audio.play('gun.mag.out', { x:this.p.x, y:this.p.y });
  }

  updateWeapon(dt) {
    const p = this.p, w = this.weapon(), s = w.s, inp = this.input;
    for (const ww of this.weapons) { ww.cool -= dt; ww.bloom = Math.max(0, ww.bloom - dt * 2.2); }
    p.aimKick *= Math.exp(-dt * 5);
    if (w.pumpT > 0) {
      const before = w.pumpT;
      w.pumpT -= dt;
      if (before > 0.25 && w.pumpT <= 0.25) this.audio.play('gun.pump', { x:p.x, y:p.y });
    }
    if (w.reloadT > 0) {
      w.reloadT -= dt;
      if (s.perShell) {
        if (w.reloadT <= 0) {
          w.mag++; w.reserve--;
          this.audio.play('gun.shell.load', { x:p.x, y:p.y });
          if (w.mag < s.cap && w.reserve > 0 && !inp.mouse.buttons[0]) w.reloadT = s.reload;
          else if (w.wasEmpty) { w.pumpT = 0.5; w.wasEmpty = false; }
        }
      } else {
        if (w.reloadStage === 0 && w.reloadT < s.reload * 0.35) { w.reloadStage = 1; this.audio.play('gun.mag.in', { x:p.x, y:p.y }); }
        if (w.reloadT <= 0) {
          const take = Math.min(s.cap - w.mag, w.reserve);
          w.mag += take; w.reserve -= take;
          if (w.wasEmpty) this.audio.play('gun.bolt.rack', { x:p.x, y:p.y });
        }
      }
    }
    if (inp.mouse.buttons[0]) {
      if (s.auto) this.fire();
      else if (!this.triggerHeld) this.fire();
      if (s.perShell && w.reloadT > 0 && w.mag > 0) w.reloadT = 0;
    }
    this.triggerHeld = inp.mouse.buttons[0];
  }

  /* ---------- lights ---------- */

  fixtureLevel(L, dt) {
    if (L.state === 'dead') return 0;
    let st = this.lightState.get(L.id);
    if (!st) { st = { on:true, t:Math.random() * 3, level:1 }; this.lightState.set(L.id, st); }
    if (L.state === 'steady') { st.level = 0.96 + 0.04 * Math.sin(this.time * 7 + L.seed * 50); return st.level; }
    st.t -= dt;
    if (st.t <= 0) {
      st.on = !st.on;
      st.t = st.on ? 0.04 + Math.random() * (Math.random() < 0.2 ? 4 : 0.6) : 0.02 + Math.random() * 0.25;
      if (st.on && Math.random() < 0.35 && Math.hypot(L.x - this.p.x, L.y - this.p.y) < 18) this.audio.play('light.pop', { x:L.x, y:L.y, gain:0.7 });
    }
    st.level = st.on ? 0.85 + Math.random() * 0.15 : 0.04;
    return st.level;
  }

  gatherLights(dt, halfW, halfH) {
    const p = this.p, cam = this.cam;
    const list = [];
    const w = this.weapon();
    if (p.light && w.s.light > 0) {
      const c = Math.cos(p.aim), s = Math.sin(p.aim);
      const d = Math.hypot(c, s, -0.16);
      list.push({ x:p.x + c * 0.45, y:p.y + s * 0.45, z:1.35, range:w.s.range, r:1, g:0.96, b:0.88, intensity:w.s.lumen * 0.6,
        spot:true, dx:c / d, dy:s / d, dz:-0.16 / d, cosOuter:Math.cos(w.s.cone * 0.5), cosInner:Math.cos(w.s.cone * 0.3) });
    }
    if (this.flashT > 0) {
      const m = this.muzzle();
      list.push({ x:m.x, y:m.y, z:1.3, range:4 + 3 * this.flashMult, r:1, g:0.72, b:0.42, intensity:16 * this.flashMult * (this.flashT / 0.055) });
    }
    const fixtures = lightsInRect(cam.x - halfW - 9, cam.y - halfH - 9, cam.x + halfW + 9, cam.y + halfH + 9);
    const panels = [];
    const near = [];
    for (const L of fixtures) {
      const lvl = this.fixtureLevel(L, dt);
      panels.push({ L, lvl });
      if (lvl < 0.05) continue;
      near.push({ x:L.x, y:L.y, z:LIGHT_Z, range:9.5, r:1, g:0.94, b:0.76, intensity:1.25 * lvl, d:Math.hypot(L.x - cam.x, L.y - cam.y), L });
    }
    near.sort((a, b) => a.d - b.d);
    for (const n of near) { if (list.length >= MAXL) break; list.push(n); }
    this.panels = panels;
    this.nearLights = near;
    return list;
  }

  /* ---------- per frame ---------- */

  update(dt) {
    if (!this.active) return;
    const p = this.p, inp = this.input, st = this.settings;
    this.time += dt;
    this.stats.time += dt;
    const cssW = this.r.viewW, cssH = this.r.viewH;

    // Map streaming
    if (this.win.recenter(p.x, p.y)) this.onRecenter();
    this.fieldT -= dt;
    if (this.fieldT <= 0) {
      this.fieldT = 0.2;
      this.fieldP.compute(p.x, p.y);
      this.fieldI.compute(p.x + p.vx * 2.5, p.y + p.vy * 2.5);
    }

    // Toggles
    if (inp.wasPressed('KeyF')) { p.light = !p.light; this.audio.play('ui.relay', { gain:0.4, bus:'ui' }); }
    if (inp.wasPressed('KeyL')) p.laser = !p.laser;
    if (inp.wasPressed('KeyN')) {
      if (p.head.nvg) { p.nvg = !p.nvg; if (p.nvg) this.audio.play('nvg.on', { bus:'ui' }); }
      else this.msg('NO NIGHT VISION ON THIS HEADGEAR.');
    }
    if (inp.wasPressed('KeyR')) this.reload();
    if (inp.wasPressed('Digit1') || inp.wasPressed('Digit2') || inp.wasPressed('KeyQ') || inp.wheel) {
      const next = inp.wasPressed('Digit1') ? 0 : inp.wasPressed('Digit2') ? 1 : 1 - p.wi;
      if (next !== p.wi) { p.wi = next; p.switchT = 0.45; this.weapon().reloadT = 0; this.audio.play('gun.bolt.rack', { x:p.x, y:p.y, gain:0.4 }); }
    }
    if (inp.wasPressed('KeyH') && p.meds > 0 && p.hp < 100) { p.meds--; p.healT = 2; this.msg('MEDKIT APPLIED.'); }
    p.switchT = Math.max(0, p.switchT - dt);
    if (p.healT > 0) { p.healT -= dt; p.hp = Math.min(100, p.hp + 20 * dt); }

    // Movement
    const w = this.weapon();
    let ix = (inp.isDown('KeyD') ? 1 : 0) - (inp.isDown('KeyA') ? 1 : 0);
    let iy = (inp.isDown('KeyS') ? 1 : 0) - (inp.isDown('KeyW') ? 1 : 0);
    const im = Math.hypot(ix, iy);
    if (im > 1) { ix /= im; iy /= im; }
    const wantAds = inp.mouse.buttons[2];
    p.sprinting = inp.isDown('ShiftLeft') && im > 0 && p.stamina > 1 && !wantAds && p.sprintLock <= 0;
    if (p.stamina <= 1) p.sprintLock = 1.2;
    p.sprintLock -= dt;
    p.ads = clamp(p.ads + (wantAds && !p.sprinting ? dt : -dt) / w.s.ads, 0, 1);
    const speed = (p.sprinting ? 5.6 : 3.4) * w.s.moveMult * p.rig.moveMult * lerp(1, 0.55, p.ads);
    const blend = 1 - Math.exp(-dt * 12);
    p.vx += (ix * speed - p.vx) * blend;
    p.vy += (iy * speed - p.vy) * blend;
    const ox = p.x, oy = p.y;
    this.win.move(p, p.vx * dt, p.vy * dt, p.r);
    const moved = Math.hypot(p.x - ox, p.y - oy);
    p.depth = Math.max(p.depth, Math.hypot(p.x - p.startX, p.y - p.startY));

    // Stamina, exertion, breathing, mask fog
    p.stamina = clamp(p.stamina + (p.sprinting ? -17 : im > 0 ? 7 : 13) * dt, 0, 100);
    const exertTarget = p.sprinting ? 1 : im > 0 ? 0.3 : 0.05;
    p.exert += (Math.max(exertTarget, (1 - p.stamina / 100) * 0.8) - p.exert) * (1 - Math.exp(-dt * 0.8));
    p.breathPh += dt * (0.25 + p.exert * 0.85) * Math.PI * 2;
    if (p.head.mask) {
      const target = clamp(p.exert * 0.85 + (1 - p.stamina / 100) * 0.35, 0, 1);
      p.maskFog += (target - p.maskFog) * (target > p.maskFog ? 1 - Math.exp(-dt * 1.4) : 1 - Math.exp(-dt * 0.25));
    }

    // Footsteps, blood on boots, prints
    p.stepAcc += moved;
    const stride = p.sprinting ? 0.95 : 0.72;
    if (p.stepAcc > stride) {
      p.stepAcc = 0;
      p.stepSide = -p.stepSide;
      const a = Math.atan2(p.vy, p.vx);
      const fx = p.x - Math.sin(a) * 0.11 * p.stepSide, fy = p.y + Math.cos(a) * 0.11 * p.stepSide;
      const b = this.gore.bloodAt(fx, fy);
      if (b > 0.25) { p.bootBlood = 1; this.profile.wear.boots = Math.min(1, this.profile.wear.boots + 0.05); }
      if (p.bootBlood > 0.05) { this.gore.footprint(fx, fy, a, p.bootBlood); p.bootBlood *= 0.83; }
      const floorTile = this.win.tileAtM(p.x, p.y);
      const slot = b > 0.25 ? 'foot.blood' : floorTile === T.CARPET ? 'foot.carpet' : 'foot.concrete';
      this.audio.play(slot, { x:fx, y:fy, gain:p.sprinting ? 1 : 0.6 });
      if (p.head.mask && p.sprinting && Math.random() < 0.08) this.audio.play('breath.heavy', { gain:0.6 });
      addWear(this.profile, 'dirt', 0, 0, 0.0004);
    }

    // Aim from the mouse projected onto the floor plane
    const ppmCss = BASE_PPM * this.zoom();
    const mx = this.cam.x + (inp.mouse.x - cssW / 2) / ppmCss, my = this.cam.y + (inp.mouse.y - cssH / 2) / ppmCss;
    p.aim = Math.atan2(my - p.y, mx - p.x);

    this.updateWeapon(dt);
    this.flashT = Math.max(0, this.flashT - dt);
    this.shake = Math.max(0, this.shake - dt * 2);
    this.cam.kick *= Math.exp(-dt * 10);
    p.hurt = Math.max(0, p.hurt - dt * 2.2);

    // Horde
    this.horde.density = st.density;
    const ev = [];
    const ws = w.s;
    this.horde.update(dt, {
      player:{ x:p.x, y:p.y, vx:p.vx, vy:p.vy, aim:p.aim, r:p.r, lightOn:p.light && ws.light > 0, lightCone:ws.cone, lightRange:ws.range },
      fieldP:this.fieldP, fieldI:this.fieldI, now:this.time, events:ev, gore:this.gore, depth:p.depth,
    });
    this.handleHordeEvents(ev);

    // Camera follows the player, leans toward the aim, pushes further while aiming down sights.
    const c = Math.cos(p.aim), s = Math.sin(p.aim);
    const lead = 1.2 + ws.shift * p.ads;
    const tx = p.x + c * lead - c * this.cam.kick, ty = p.y + s * lead - s * this.cam.kick;
    const cb = 1 - Math.exp(-dt * 6);
    this.cam.x += (tx - this.cam.x) * cb;
    this.cam.y += (ty - this.cam.y) * cb;

    // Gore simulation and painting
    this.gore.update(dt, this.time);

    // Ambience
    this.audio.setListener(p.x, p.y);
    this.audio.loop('hvac', 'amb.hvac.loop', 0.5, { bus:'amb' });
    this.audio.loop('room', 'amb.roomtone.loop', 0.35, { bus:'amb' });
    this.audio.loop('mask', 'breath.mask.loop', p.head.mask ? 0.15 + p.exert * 0.5 : 0, { bus:'sfx' });

    for (const l of this.lines) l.life -= dt;
    this.lines = this.lines.filter(l => l.life > 0);

    this.saveT -= dt;
    if (this.saveT <= 0) { this.saveT = 15; saveProfile(this.profile); }
  }

  handleHordeEvents(ev) {
    const p = this.p;
    for (const e of ev) {
      if (e.type === 'attack') {
        if (!p.alive) continue;
        const dmg = e.dmg * p.rig.dmgMult * (0.85 + Math.random() * 0.3);
        p.hp -= dmg;
        p.hurt = Math.min(1, p.hurt + dmg / 70);
        this.shake = Math.max(this.shake, 0.35);
        const a = Math.atan2(p.y - e.y, p.x - e.x);
        this.gore.impact(p.x, p.y, Math.cos(a), Math.sin(a), 0.6, 0.35);
        this.horde.spray(p.x, p.y, Math.cos(a), Math.sin(a), 500);
        // The hit lands on the operator's kit: front torso in the local frame.
        const la = a - p.aim + Math.PI;
        addWear(this.profile, 'blood', Math.cos(la) * 0.1, Math.sin(la) * 0.15, 0.025 + Math.random() * 0.03);
        if (dmg > 18 && Math.random() < 0.35) addWear(this.profile, 'tear', (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.3, 0.03);
        this.audio.play('player.hurt', { gain:0.8 });
        if (p.hp <= 0) this.die(e.kind);
      } else if (e.type === 'scream') {
        const slot = e.kind === 'hound' ? 'hound.scream' : e.kind === 'bacteria' ? 'bacteria.click' : 'skin.whisper';
        this.audio.play(slot, { x:e.x, y:e.y });
      } else if (e.type === 'step') {
        if (e.kind === 'hound' && Math.random() < 0.5) this.audio.play('hound.step', { x:e.x, y:e.y, gain:0.6 });
      } else if (e.type === 'vent') {
        this.audio.play('vent.burst', { x:e.x, y:e.y });
        this.msg('SOMETHING CAME OUT OF THE VENTS.');
      } else if (e.type === 'ventIn') {
        this.audio.play('vent.crawl', { x:e.x, y:e.y });
      } else if (e.type === 'dismember') {
        this.stats.dismember++;
        this.audio.play('gore.dismember', { x:e.x, y:e.y });
      } else if (e.type === 'death') {
        this.stats.kills++;
        this.audio.play('creature.death', { x:e.x, y:e.y });
        if (Math.hypot(e.x - p.x, e.y - p.y) < 1.8) addWear(this.profile, 'blood', (Math.random() - 0.3) * 0.2, (Math.random() - 0.5) * 0.3, 0.02 + Math.random() * 0.03);
      }
    }
  }

  die(kind) {
    const p = this.p;
    p.alive = false;
    this.dead = true;
    this.killedBy = TYPES.find(t => t.key === kind)?.name || 'Unknown';
    this.gore.pool(p.x, p.y, 1.3, 12);
    const pr = this.profile;
    pr.stats.runs++;
    pr.stats.kills += this.stats.kills;
    pr.stats.deepest = Math.max(pr.stats.deepest, Math.floor(p.depth));
    pr.stats.timeIn += this.stats.time;
    saveProfile(pr);
  }

  zoom() {
    const w = this.weapon();
    return lerp(1, w.s.zoom, this.p.ads) * this.settings.zoom;
  }

  /* ---------- render ---------- */

  render(cssW, cssH, dpr, dt = 1 / 60) {
    const p = this.p, r = this.r, st = this.settings;
    r.viewW = cssW; r.viewH = cssH;
    r.resize(cssW, cssH, dpr, st.renderScale);
    const ppm = BASE_PPM * this.zoom() * dpr * st.renderScale;
    const halfW = r.size.w / ppm / 2, halfH = r.size.h / ppm / 2;
    const sh = this.shake;
    const cam = { x:this.cam.x + (Math.random() - 0.5) * sh * 0.15, y:this.cam.y + (Math.random() - 0.5) * sh * 0.15 };
    const lights = this.gatherLights(dt, halfW, halfH);

    this.gore.flush(this.cam.x, this.cam.y);
    this.horde.fillInstances(r.entities, cam, halfW, halfH);

    // Operator instance + its customisation uniforms
    const w = this.weapon(), ws = w.s;
    const sp = Math.hypot(p.vx, p.vy);
    r.player.data.set([p.x - cam.x, p.y - cam.y, p.aim, 0.85, 3, p.stepAcc / 0.72 * Math.PI + (p.stepSide > 0 ? Math.PI : 0), sp, 0, 0, 0, 0, 1.8, 0, 0, 0, 1], 0);
    r.player.count = 1;
    const uni = findUniform(this.profile.uniform);
    const pouches = pouchLayout(this.profile, this.weapons[0].s, this.weapons[1].s, { primaryReserve:this.weapons[0].reserve, secondaryReserve:this.weapons[1].reserve, meds:p.meds });
    const pu = new Float32Array(48), pk = new Float32Array(48);
    pouches.forEach((q, i) => { pu.set([q.x, q.y, q.w, q.h], i * 4); pk.set([q.kind, q.full, 0, 0], i * 4); });
    const wear = wearUniforms(this.profile);
    const operator = {
      uSuit:uni.color, uSuitSeam:uni.seam, uRig:['plate', 'chest', 'none'].indexOf(p.rig.id), uHead:p.head.shader,
      uPouch:pu, uPouchKind:pk, uPouchCount:pouches.length, uWear:wear.arr, uWearCount:wear.n, uDirt:this.profile.wear.dirt,
      uGun0:[ws.receiver, ws.barrelLen, ws.muzzleLen, ws.stockLen], uGun1:[ws.optic, ws.laser, ws.light > 0 ? 1 : 0, ws.magType],
      uBootBlood:Math.max(p.bootBlood, this.profile.wear.boots),
    };

    // Emissive: troffer panels, tracers, sparks, laser
    const L = r.lines;
    let n = 0;
    const line = (ax, ay, az, wdt, bx, by, bz, kind, cr, cg, cb, ci) => {
      if (n >= L.capacity) return;
      L.data.set([ax - cam.x, ay - cam.y, az, wdt, bx - cam.x, by - cam.y, bz, kind, cr, cg, cb, ci], n * 12);
      n++;
    };
    for (const { L:F, lvl } of this.panels || []) {
      const hx = F.horiz ? 0.58 : 0, hy = F.horiz ? 0 : 0.58;
      line(F.x - hx, F.y - hy, LIGHT_Z, 0.22, F.x + hx, F.y + hy, LIGHT_Z, 1, 1, 0.97, 0.88, 0.15 + lvl * 1.5);
    }
    for (const l of this.lines) line(l.ax, l.ay, l.az, l.w, l.bx, l.by, l.bz, l.kind, l.r, l.g, l.b, l.i * Math.min(1, l.life / 0.03));
    if (p.laser && ws.laser > 0 && p.alive && (ws.laser === 1 || p.nvg)) {
      const m = this.muzzle();
      const dx = Math.cos(p.aim + p.aimKick), dy = Math.sin(p.aim + p.aimKick);
      let t = this.win.rayWall(m.x, m.y, dx, dy, 35).t;
      const hits = this.horde.query(m.x, m.y, dx, dy, t);
      if (hits.length) t = hits[0].t;
      const col = ws.laser === 1 ? [1, 0.04, 0.02] : [0.6, 1, 0.6];
      line(m.x, m.y, 1.3, 0.008, m.x + dx * t, m.y + dy * t, 1.15, 0, col[0], col[1], col[2], ws.laser === 1 ? 2.2 : 3);
      line(m.x + dx * (t - 0.04), m.y + dy * (t - 0.04), 1.15, 0.03, m.x + dx * t, m.y + dy * t, 1.15, 0, col[0], col[1], col[2], 14);
    }
    L.count = n;

    r.render({
      cam, ppm, hc:EYE, win:this.win, lights, time:this.time, goreNow:this.gore.timeN(),
      operator, drawPlayer:p.alive, ambient:p.nvg ? [0.02, 0.02, 0.02] : [0.006, 0.0055, 0.004],
      fog:st.fog, fogDensity:st.fogDensity, dustCount:st.dust,
      exposure:st.exposure, nvg:p.nvg, maskOn:p.head.mask, maskFog:p.maskFog, breath:0.5 + 0.5 * Math.sin(p.breathPh),
      damage:p.hurt, grain:p.nvg ? 0.03 : st.grain, flash:this.flashT > 0 ? this.flashMult * 0.3 : 0, ads:p.ads,
    });
  }

  drawHUD(g, cssW, cssH, assetSummary) {
    const p = this.p, w = this.weapon(), s = w.s;
    g.clearRect(0, 0, cssW, cssH);
    if (!this.active) return;
    const amber = '#e9c46a', dim = 'rgba(233,220,190,.65)', red = '#d1342b';
    g.font = '16px "VT323", ui-monospace, monospace';
    g.textBaseline = 'alphabetic';

    // Vitals
    const bx = 24, by = cssH - 30;
    g.fillStyle = dim; g.fillText('VITALS', bx, by - 52);
    const bar = (y, v, col, label) => {
      g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(bx, y, 200, 8);
      g.fillStyle = col; g.fillRect(bx, y, 200 * clamp(v, 0, 1), 8);
      g.fillStyle = dim; g.fillText(label, bx + 208, y + 8);
    };
    bar(by - 42, p.hp / 100, p.hp < 35 ? red : '#c9b37c', `HP ${Math.max(0, Math.ceil(p.hp))}`);
    bar(by - 26, p.stamina / 100, '#8aa1a8', `STA ${Math.ceil(p.stamina)}`);
    if (p.head.mask) bar(by - 10, p.maskFog, '#cfd6d8', `VISOR ${Math.round(p.maskFog * 100)}%`);
    g.fillStyle = dim;
    g.fillText(`MEDS ${p.meds} [H]   ${p.rig.name.toUpperCase()}`, bx, by + 14);

    // Weapon
    g.textAlign = 'right';
    g.fillStyle = amber;
    g.font = '30px "VT323", ui-monospace, monospace';
    const ammo = w.reloadT > 0 && !s.perShell ? 'RELOADING' : `${w.mag} / ${w.reserve}`;
    g.fillText(ammo, cssW - 24, cssH - 44);
    g.font = '16px "VT323", ui-monospace, monospace';
    g.fillStyle = dim;
    g.fillText(`${s.name.toUpperCase()} · ${s.caliberName.toUpperCase()}`, cssW - 24, cssH - 24);
    g.fillText(`LIGHT ${p.light && s.light ? 'ON' : 'OFF'} [F]   LASER ${s.laser ? (p.laser ? 'ON' : 'OFF') : '—'} [L]   NVG ${p.head.nvg ? (p.nvg ? 'ON' : 'OFF') : '—'} [N]`, cssW - 24, cssH - 8);

    // Run info
    g.textAlign = 'left';
    g.fillStyle = amber;
    g.font = '22px "VT323", ui-monospace, monospace';
    g.fillText(`DEPTH ${Math.floor(p.depth)} M`, 24, 34);
    g.font = '16px "VT323", ui-monospace, monospace';
    g.fillStyle = dim;
    g.fillText(`KILLS ${this.stats.kills}   LIMBS ${this.stats.dismember}   ${fmtTime(this.stats.time)}`, 24, 54);
    g.textAlign = 'right';
    g.fillText(`ENTITIES ${this.horde.count}   CORPSES ${this.horde.corpses.length}`, cssW - 24, 34);
    if (assetSummary && assetSummary.audioFilled === 0) {
      g.fillStyle = 'rgba(233,196,106,.75)';
      g.fillText('AUDIO: NO RECORDINGS LOADED — SEE SYSTEM DIAGNOSTICS', cssW - 24, 54);
    }

    // Messages
    g.textAlign = 'left';
    this.messages.forEach((m, i) => {
      const age = this.time - m.t;
      if (age > 6) return;
      g.fillStyle = `rgba(233,220,190,${Math.max(0, 1 - age / 6) * 0.85})`;
      g.fillText(m.text, 24, 84 + i * 18);
    });

    // Crosshair: spread circle at the cursor
    const mx = this.input.mouse.x, my = this.input.mouse.y;
    const ppmCss = BASE_PPM * this.zoom();
    const dist = Math.hypot((mx - cssW / 2) / ppmCss + this.cam.x - p.x, (my - cssH / 2) / ppmCss + this.cam.y - p.y);
    const spread = s.spread * (1 - 0.6 * p.ads) * (1 + w.bloom);
    const rad = Math.max(5, Math.tan(spread) * dist * ppmCss);
    g.strokeStyle = 'rgba(240,230,200,.8)';
    g.lineWidth = 1;
    g.beginPath(); g.arc(mx, my, rad, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(240,230,200,.9)';
    g.fillRect(mx - 1, my - 1, 2, 2);
    g.textAlign = 'left';
  }
}

export function fmtTime(t) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export { EYE, BASE_PPM, HW, surfaceOf, angleDiff };
