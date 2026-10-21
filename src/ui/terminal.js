// The terminal's pages, drawn into a 1024×768 canvas that the CRT shader displays.
// Drawing is monochrome (luminance only); the CRT shader supplies the amber phosphor.

import { PLATFORMS, SLOTS, SLOT_NAMES, allowedOptions, opt, computeStats, defaultConfig, saveLoadout } from '../combat/gunsmith.js';
import { CALIBERS } from '../combat/ballistics.js';
import { UNIFORMS, RIGS, HEADGEAR, findUniform, findRig, findHead, pouchLayout, saveProfile, defaultProfile } from '../player/operator.js';
import { AUDIO_SLOTS, TEXTURE_SLOTS } from '../assets/manifest.js';
import { fmtTime } from '../game.js';

export const TW = 1024, TH = 768;
const FONT = '"VT323", "Courier New", monospace';
const FG = '#f2f2f2', MID = '#9a9a9a', LOW = '#555', BG = '#000';

export class Terminal {
  constructor(app) {
    this.app = app;
    this.canvas = document.createElement('canvas');
    this.canvas.width = TW; this.canvas.height = TH;
    this.g = this.canvas.getContext('2d');
    this.page = 'main';
    this.sel = 0;
    this.items = [];
    this.dirty = true;
    this.scroll = 0;
    this.armTab = 0;
    this.bootT = 0;
    this.hover = -1;
  }

  go(page) {
    this.page = page;
    this.sel = 0;
    this.scroll = 0;
    this.dirty = true;
    this.app.sound('ui.key');
  }

  /* ---------- input ---------- */

  // mouse: { u, v } in 0..1 over the screen glass, or null
  handle(input, mouse) {
    const before = this.sel;
    const n = this.items.length;
    if (mouse) {
      const mx = mouse.u * TW, my = mouse.v * TH;
      const idx = this.items.findIndex(it => mx >= it.x && mx <= it.x + it.w && my >= it.y && my <= it.y + it.h);
      if (idx >= 0 && idx !== this.hover) { this.hover = idx; this.sel = idx; this.dirty = true; }
      for (const c of input.clicks) {
        if (c.button !== 0) continue;
        const cx = c.u * TW, cy = c.v * TH;
        const it = this.items.find(q => cx >= q.x && cx <= q.x + q.w && cy >= q.y && cy <= q.y + q.h);
        if (it) {
          if (it.adjust) {
            const dir = cx < it.x + it.w * 0.5 ? -1 : 1;
            it.adjust(dir);
          } else if (it.act) it.act();
          this.dirty = true;
          this.app.sound('ui.key');
        }
      }
    }
    if (n) {
      if (input.wasPressed('ArrowDown') || input.wasPressed('KeyS')) this.sel = (this.sel + 1) % n;
      if (input.wasPressed('ArrowUp') || input.wasPressed('KeyW')) this.sel = (this.sel - 1 + n) % n;
      const it = this.items[this.sel];
      if (it) {
        if (it.adjust && (input.wasPressed('ArrowLeft') || input.wasPressed('KeyA'))) { it.adjust(-1); this.dirty = true; this.app.sound('ui.key'); }
        if (it.adjust && (input.wasPressed('ArrowRight') || input.wasPressed('KeyD'))) { it.adjust(1); this.dirty = true; this.app.sound('ui.key'); }
        if ((input.wasPressed('Enter') || input.wasPressed('Space')) && (it.act || it.adjust)) { (it.act || (() => it.adjust(1)))(); this.dirty = true; this.app.sound('ui.key'); }
      }
    }
    if (input.wheel && this.page === 'missing') { this.scroll = Math.max(0, this.scroll + input.wheel * 3); this.dirty = true; }
    if (input.wasPressed('Escape') || input.wasPressed('Backspace')) {
      if (this.page !== 'main' && this.page !== 'report') this.go(this.page === 'missing' ? 'diag' : 'main');
      else if (this.app.paused) this.app.resume();
    }
    if (this.sel !== before) { this.dirty = true; this.app.sound('ui.key', 0.4); }
  }

  /* ---------- drawing primitives ---------- */

  text(s, x, y, size = 26, col = FG, align = 'left') {
    const g = this.g;
    g.font = `${size}px ${FONT}`;
    g.fillStyle = col;
    g.textAlign = align;
    g.fillText(s, x, y);
  }

  item(i, label, x, y, w, { act, adjust, value, hint } = {}) {
    const selected = i === this.sel;
    const g = this.g;
    if (selected) { g.fillStyle = FG; g.fillRect(x - 8, y - 22, w + 16, 30); }
    const col = selected ? BG : FG;
    if (adjust) {
      this.text(label, x, y, 26, col);
      this.text(`◄ ${value} ►`, x + w, y, 26, col, 'right');
    } else {
      this.text(label, x, y, 26, col);
      if (value) this.text(value, x + w, y, 26, selected ? BG : MID, 'right');
    }
    this.items.push({ x:x - 8, y:y - 22, w:w + 16, h:30, act, adjust, hint });
  }

  frame(title) {
    const g = this.g;
    g.fillStyle = BG;
    g.fillRect(0, 0, TW, TH);
    g.strokeStyle = MID;
    g.lineWidth = 2;
    g.strokeRect(24, 24, TW - 48, TH - 48);
    g.fillStyle = FG;
    g.fillRect(24, 24, TW - 48, 36);
    this.text('ASYNC RESEARCH DIVISION // THRESHOLD TERMINAL 07', 40, 51, 26, BG);
    this.text(title, TW - 40, 51, 26, BG, 'right');
    const t = new Date();
    this.text(`${t.toISOString().slice(0, 10)}  ${t.toTimeString().slice(0, 8)}  LINK: LOCAL  SITE: LEVEL 0`, 40, TH - 36, 20, MID);
  }

  bar(x, y, w, v, base = null) {
    const g = this.g;
    g.strokeStyle = MID; g.lineWidth = 1;
    g.strokeRect(x + 0.5, y + 0.5, w, 10);
    g.fillStyle = FG;
    g.fillRect(x + 2, y + 2, Math.max(0, Math.min(1, v)) * (w - 3), 7);
    if (base !== null) { g.fillStyle = MID; g.fillRect(x + 2 + Math.min(1, base) * (w - 3) - 1, y - 2, 2, 15); }
  }

  /* ---------- pages ---------- */

  draw(time) {
    this.items = [];
    const p = this.page;
    if (p === 'main') this.drawMain(time);
    else if (p === 'arsenal') this.drawArsenal();
    else if (p === 'personnel') this.drawPersonnel();
    else if (p === 'diag') this.drawDiag();
    else if (p === 'missing') this.drawMissing();
    else if (p === 'report') this.drawReport();
    if (this.sel >= this.items.length) this.sel = Math.max(0, this.items.length - 1);
    // Blinking cursor
    if (Math.floor(time * 2) % 2 === 0) { this.g.fillStyle = FG; this.g.fillRect(40, TH - 74, 14, 22); }
    this.dirty = false;
  }

  drawMain(time) {
    const a = this.app, pr = a.profile;
    this.frame('MAIN');
    const lines = [
      `> SUBJECT ........ ${pr.callsign}`,
      `> DEEPEST LOGGED . ${pr.stats.deepest} M        INCURSIONS ${pr.stats.runs}        CONFIRMED KILLS ${pr.stats.kills}`,
      `> PRIMARY ........ ${PLATFORMS[a.loadout.primary.platform].name.toUpperCase()}`,
      `> SECONDARY ...... ${PLATFORMS[a.loadout.secondary.platform].name.toUpperCase()}`,
      `> ASSET STATUS ... AUDIO ${a.loader.summary().audioFilled}/${AUDIO_SLOTS.length}   MATERIALS ${a.loader.summary().texFilled}/${TEXTURE_SLOTS.length}`,
    ];
    lines.forEach((l, i) => this.text(l, 56, 110 + i * 30, 24, MID));
    this.text('THE CARPET IS WET. THE LIGHTS HUM AT 120 HZ. NOBODY WHO WENT', 56, 290, 24, LOW);
    this.text('PAST THE THIRD DOORWAY HAS RADIOED BACK.', 56, 316, 24, LOW);
    let y = 400, i = 0;
    if (a.paused) this.item(i++, '[ RESUME INCURSION ]', 300, y, 420, { act:() => a.resume() }), y += 48;
    this.item(i++, '[ ENTER THE THRESHOLD ]', 300, y, 420, { act:() => a.enterGame() }); y += 48;
    this.item(i++, '[ ARSENAL ARCHIVE ]', 300, y, 420, { act:() => this.go('arsenal') }); y += 48;
    this.item(i++, '[ PERSONNEL FILE ]', 300, y, 420, { act:() => this.go('personnel') }); y += 48;
    this.item(i++, '[ SYSTEM DIAGNOSTICS ]', 300, y, 420, { act:() => this.go('diag') }); y += 48;
    this.text('ARROWS / MOUSE TO SELECT   ENTER TO CONFIRM   ESC TO GO BACK', TW / 2, TH - 80, 20, LOW, 'center');
  }

  drawArsenal() {
    const a = this.app;
    this.frame('ARSENAL ARCHIVE');
    const key = this.armTab === 0 ? 'primary' : 'secondary';
    const cfg = a.loadout[key];
    const s = computeStats(cfg);
    const base = computeStats(defaultConfig(cfg.platform));
    const g = this.g;

    // Workbench schematic: the weapon from above, at true proportions.
    const bx = 48, by = 80, bw = 520, bh = 250;
    g.strokeStyle = LOW; g.lineWidth = 1;
    for (let x = bx; x <= bx + bw; x += 26) { g.beginPath(); g.moveTo(x + 0.5, by); g.lineTo(x + 0.5, by + bh); g.stroke(); }
    for (let y = by; y <= by + bh; y += 26) { g.beginPath(); g.moveTo(bx, y + 0.5); g.lineTo(bx + bw, y + 0.5); g.stroke(); }
    this.drawGun(s, bx + 40, by + bh / 2, 520);
    this.text(`${s.name.toUpperCase()}  //  ${s.caliberName.toUpperCase()}`, bx, by + bh + 28, 24, FG);
    const cal = CALIBERS[s.caliber];
    this.text(`DRYWALL: ${cal.wallCost < 0.8 ? 'PENETRATES CLEANLY' : cal.wallCost < 1.3 ? 'PENETRATES, LOSES ENERGY' : 'PELLETS OFTEN STOP'}   CONCRETE: RICOCHET BELOW ${cal.crit}°`, bx, by + bh + 52, 20, MID);

    // Stats with the stock configuration marked
    const rows = [
      ['MUZZLE ENERGY', s.energy * s.pellets / 3600, base.energy * base.pellets / 3600, `${Math.round(s.energy * s.pellets)} J`],
      ['RATE OF FIRE', s.rpm / 900, base.rpm / 900, `${s.rpm} RPM`],
      ['CONTROL (V)', 1 - s.recoilV / 3.5, 1 - base.recoilV / 3.5, s.recoilV.toFixed(2)],
      ['CONTROL (H)', 1 - s.recoilH / 1.6, 1 - base.recoilH / 1.6, s.recoilH.toFixed(2)],
      ['ADS SPEED', 1 - s.ads / 0.6, 1 - base.ads / 0.6, `${Math.round(s.ads * 1000)} MS`],
      ['ACCURACY', 1 - s.spread / 0.12, 1 - base.spread / 0.12, `${(s.spread * 57.3).toFixed(1)}°`],
      ['MUZZLE FLASH', s.flash / 1.6, base.flash / 1.6, `${Math.round(s.flash * 100)}%`],
      ['HEARD WITHIN', s.soundRadius / 110, base.soundRadius / 110, `${Math.round(s.soundRadius)} M`],
      ['CAPACITY', s.cap / 100, base.cap / 100, `${s.cap}`],
      ['RELOAD', 1 - s.reload / 4, 1 - base.reload / 4, `${s.reload.toFixed(2)} S`],
      ['WEIGHT', s.weight / 6, base.weight / 6, `${s.weight.toFixed(1)} KG`],
    ];
    rows.forEach((r, i) => {
      const y = 430 + i * 25;
      this.text(r[0], 56, y, 20, MID);
      this.bar(220, y - 11, 220, r[1], r[2]);
      this.text(r[3], 560, y, 20, FG, 'right');
    });

    // Slots
    let i = 0, y = 104;
    const x = 610, w = 360;
    this.item(i++, 'LOADOUT', x, y, w, { adjust:() => { this.armTab = 1 - this.armTab; }, value:this.armTab === 0 ? 'PRIMARY' : 'SECONDARY' }); y += 40;
    const plats = Object.keys(PLATFORMS).filter(k => (PLATFORMS[k].kind === 'pistol') === (this.armTab === 1));
    this.item(i++, 'PLATFORM', x, y, w, {
      value:PLATFORMS[cfg.platform].name.toUpperCase().slice(0, 18),
      adjust:d => { const k = plats[(plats.indexOf(cfg.platform) + d + plats.length) % plats.length]; a.loadout[key] = defaultConfig(k); saveLoadout(a.loadout); },
    }); y += 40;
    for (const slot of SLOTS) {
      const list = allowedOptions(cfg.platform, slot);
      if (list.length <= 1 && (slot === 'stock' || slot === 'grip')) continue;
      this.item(i++, SLOT_NAMES[slot].toUpperCase(), x, y, w, {
        value:opt(slot, cfg[slot]).name.toUpperCase().slice(0, 20),
        adjust:d => { const idx = list.findIndex(o => o.id === cfg[slot]); cfg[slot] = list[(idx + d + list.length) % list.length].id; saveLoadout(a.loadout); },
      });
      y += 36;
    }
    y += 14;
    this.item(i++, '[ BACK ]', x, y, w, { act:() => this.go('main') });
    const sel = this.items[this.sel];
    this.text('◄ ► CHANGES THE SELECTED PART.', 610, TH - 104, 18, LOW);
    this.text('CHANGES SAVE AUTOMATICALLY.', 610, TH - 82, 18, LOW);
    void sel;
  }

  drawGun(s, x0, y0, ppm) {
    const g = this.g;
    g.strokeStyle = FG; g.fillStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 2;
    const box = (x, y, w, h) => { g.fillRect(x, y - h / 2, w, h); g.strokeRect(x, y - h / 2, w, h); };
    const rx = x0 + s.stockLen * ppm;
    if (s.stockLen > 0) box(x0, y0, s.stockLen * ppm, 22);
    box(rx, y0, s.receiver * ppm, 34);
    box(rx + s.receiver * ppm, y0, s.barrelLen * ppm, 10);
    if (s.muzzleLen > 0) box(rx + (s.receiver + s.barrelLen) * ppm, y0, s.muzzleLen * ppm, s.suppressed ? 26 : 16);
    // optic on top
    if (s.optic > 0) { const ow = s.optic === 3 ? 0.18 : 0.07; box(rx + s.receiver * ppm * 0.35, y0, ow * ppm, s.optic === 3 ? 18 : 14); }
    // laser and light on the rails
    if (s.laser) { box(rx + s.receiver * ppm + 8, y0 + 24, 0.06 * ppm, 10); g.setLineDash([6, 6]); g.beginPath(); g.moveTo(rx + s.receiver * ppm + 8 + 0.06 * ppm, y0 + 24); g.lineTo(x0 + 500, y0 + 24); g.stroke(); g.setLineDash([]); }
    if (s.light) { box(rx + s.receiver * ppm + 8, y0 - 26, 0.08 * ppm, 14); const half = s.cone * 0.5; const lx = rx + s.receiver * ppm + 8 + 0.08 * ppm; g.globalAlpha = 0.5; g.beginPath(); g.moveTo(lx, y0 - 26); g.lineTo(lx + 120, y0 - 26 - Math.tan(half) * 120); g.moveTo(lx, y0 - 26); g.lineTo(lx + 120, y0 - 26 + Math.tan(half) * 120); g.stroke(); g.globalAlpha = 1; }
    // magazine footprint (dashed: under the receiver)
    g.setLineDash([4, 4]);
    const mx = rx + s.receiver * ppm * 0.45;
    if (s.magType === 2) { g.beginPath(); g.arc(mx, y0 + 46, 30, 0, Math.PI * 2); g.stroke(); }
    else { const len = s.magType === 1 ? 90 : 56; g.strokeRect(mx - 12, y0 + 18, 24, len); if (s.magType === 3) g.strokeRect(mx + 14, y0 + 18, 24, len); }
    g.setLineDash([]);
    this.text(`L ${(s.stockLen + s.receiver + s.barrelLen + s.muzzleLen).toFixed(2)} M`, x0, y0 - 90, 18, MID);
  }

  drawPersonnel() {
    const a = this.app, pr = a.profile;
    this.frame('PERSONNEL FILE');
    const g = this.g;
    // Top-down preview of the operator
    const cx = 260, cy = 350, k = 400;
    g.save();
    g.beginPath(); g.rect(40, 70, 440, 470); g.clip();
    g.translate(cx, cy);
    g.rotate(-Math.PI / 2);
    const uni = findUniform(pr.uniform), rig = findRig(pr.rig), head = findHead(pr.headgear);
    const lum = c => { const v = Math.min(190, Math.round(40 + (c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11) * 300)); return `rgb(${v},${v},${v})`; };
    g.fillStyle = lum(uni.color);
    g.strokeStyle = FG; g.lineWidth = 2;
    const ell = (x, y, rx, ry) => { g.beginPath(); g.ellipse(x * k, y * k, rx * k, ry * k, 0, 0, Math.PI * 2); g.fill(); g.stroke(); };
    // boots, weapon, arms, body
    ell(0.06, -0.11, 0.13, 0.06); ell(-0.06, 0.11, 0.13, 0.06);
    const s0w = computeStats(a.loadout.primary);
    g.fillStyle = '#1a1a1a';
    g.fillRect((0.12 - s0w.stockLen) * k, 0.035 * k, (s0w.stockLen + s0w.receiver + s0w.barrelLen + s0w.muzzleLen) * k, 0.05 * k);
    g.strokeRect((0.12 - s0w.stockLen) * k, 0.035 * k, (s0w.stockLen + s0w.receiver + s0w.barrelLen + s0w.muzzleLen) * k, 0.05 * k);
    g.strokeStyle = lum(uni.color); g.lineWidth = 0.055 * k; g.lineCap = 'round';
    g.beginPath(); g.moveTo(0.02 * k, 0.2 * k); g.lineTo(0.12 * k, 0.16 * k); g.lineTo(0.16 * k, 0.07 * k); g.stroke();
    g.beginPath(); g.moveTo(0.02 * k, -0.2 * k); g.lineTo(0.2 * k, -0.12 * k); g.lineTo((0.12 + s0w.receiver * 0.85) * k, 0.05 * k); g.stroke();
    g.strokeStyle = FG; g.lineWidth = 2; g.lineCap = 'butt';
    g.fillStyle = lum(uni.color);
    ell(0, 0, 0.15, 0.25);
    // wear
    for (const b of pr.wear.blood) { g.fillStyle = '#2a2a2a'; g.beginPath(); g.arc(b.x * k, b.y * k, b.r * k, 0, Math.PI * 2); g.fill(); }
    for (const t of pr.wear.tears) { g.strokeStyle = BG; g.lineWidth = 3; g.beginPath(); g.moveTo((t.x - t.r) * k, (t.y - t.r * 0.4) * k); g.lineTo((t.x + t.r) * k, (t.y + t.r * 0.4) * k); g.stroke(); }
    g.strokeStyle = FG; g.lineWidth = 2;
    // rig and pouches
    if (rig.slots) {
      g.fillStyle = '#3a3a3a';
      const pw = rig.id === 'plate' ? 0.135 : 0.11, ph = rig.id === 'plate' ? 0.17 : 0.19;
      g.fillRect(-pw * k, -ph * k, pw * 2 * k, ph * 2 * k); g.strokeRect(-pw * k, -ph * k, pw * 2 * k, ph * 2 * k);
      const s0 = computeStats(a.loadout.primary), s1 = computeStats(a.loadout.secondary);
      const pouches = pouchLayout(pr, s0, s1, { primaryReserve:s0.perShell ? 24 : s0.cap * 3, secondaryReserve:s1.cap * 2, meds:2 });
      for (const q of pouches) {
        g.fillStyle = q.full ? '#777' : '#2a2a2a';
        if (q.kind === 2) { g.beginPath(); g.arc(q.x * k, q.y * k, q.w * k, 0, Math.PI * 2); g.fill(); g.stroke(); }
        else { g.fillRect((q.x - q.w) * k, (q.y - q.h) * k, q.w * 2 * k, q.h * 2 * k); g.strokeRect((q.x - q.w) * k, (q.y - q.h) * k, q.w * 2 * k, q.h * 2 * k); }
      }
    }
    // head and headgear
    g.fillStyle = head.shader === 3 ? '#8a8a8a' : '#505050';
    g.beginPath(); g.arc(0.02 * k, 0, 0.105 * k, 0, Math.PI * 2); g.fill(); g.stroke();
    if (head.mask) { g.fillStyle = '#202020'; ell(0.1, 0, 0.05, 0.08); g.beginPath(); g.arc(0.09 * k, -0.08 * k, 0.045 * k, 0, Math.PI * 2); g.fill(); g.stroke(); }
    if (head.nvg) { g.fillStyle = '#101010'; g.fillRect(0.085 * k, -0.05 * k, 0.07 * k, 0.1 * k); g.strokeRect(0.085 * k, -0.05 * k, 0.07 * k, 0.1 * k); }
    g.restore();
    this.text('FACING ↑   TOP-DOWN VIEW', cx, 560, 18, LOW, 'center');

    const w = pr.wear;
    const lines = [
      `CALLSIGN ...... ${pr.callsign}`,
      `INCURSIONS .... ${pr.stats.runs}   DEEPEST ${pr.stats.deepest} M`,
      `KILLS ......... ${pr.stats.kills}   TIME INSIDE ${fmtTime(pr.stats.timeIn)}`,
      `KIT CONDITION . ${w.blood.length} STAIN(S), ${w.tears.length} TEAR(S), GRIME ${Math.round(w.dirt * 100)}%`,
      `BOOTS ......... ${w.boots > 0.5 ? 'CAKED IN BLOOD' : w.boots > 0.1 ? 'BLOOD IN THE TREAD' : 'CLEAN'}`,
    ];
    lines.forEach((l, i) => this.text(l, 520, 110 + i * 28, 22, MID));

    let i = 0, y = 290;
    const x = 520, wd = 450;
    const cyc = (list, cur, set) => d => { const idx = list.findIndex(o => o.id === cur()); set(list[(idx + d + list.length) % list.length].id); saveProfile(pr); };
    this.item(i++, 'UNIFORM', x, y, wd, { value:uni.name.toUpperCase().slice(0, 22), adjust:cyc(UNIFORMS, () => pr.uniform, v => { pr.uniform = v; }) }); y += 26;
    this.text(uni.note.toUpperCase(), x, y, 18, LOW); y += 34;
    this.item(i++, 'RIG', x, y, wd, { value:rig.name.toUpperCase(), adjust:cyc(RIGS, () => pr.rig, v => { pr.rig = v; }) }); y += 26;
    this.text(`${rig.note.toUpperCase()}  DAMAGE TAKEN ${Math.round(rig.dmgMult * 100)}%`, x, y, 18, LOW); y += 34;
    this.item(i++, 'HEADGEAR', x, y, wd, { value:head.name.toUpperCase().slice(0, 22), adjust:cyc(HEADGEAR, () => pr.headgear, v => { pr.headgear = v; }) }); y += 26;
    this.text(head.note.toUpperCase(), x, y, 18, LOW); y += 40;
    this.item(i++, '[ ISSUE NEW UNIFORM ]', x, y, wd, { act:() => { pr.wear = defaultProfile().wear; saveProfile(pr); }, value:'CLEARS WEAR' }); y += 44;
    this.item(i++, '[ BACK ]', x, y, wd, { act:() => this.go('main') });
  }

  drawDiag() {
    const a = this.app, st = a.settings;
    this.frame('SYSTEM DIAGNOSTICS');
    const sum = a.loader.summary();
    this.text(`RENDERER  WEBGL2 DEFERRED · ${a.gpuName}`, 56, 100, 20, MID);
    this.text(`FRAME     ${a.fps.toFixed(0)} FPS   ENTITIES ${a.game.horde.count}`, 56, 124, 20, MID);
    this.text(`ASSETS    AUDIO ${sum.audioFilled}/${sum.audioTotal}${sum.audioQueued ? ` (+${sum.audioQueued} WAITING FOR AUDIO)` : ''}   MATERIALS ${sum.texFilled}/${sum.texTotal}`, 56, 148, 20, MID);
    const step = (k, lo, hi, d) => dir => { st[k] = Math.round(Math.min(hi, Math.max(lo, st[k] + dir * d)) * 100) / 100; a.saveSettings(); };
    const pct = v => `${Math.round(v * 100)}%`;
    let i = 0, y = 196;
    const x = 56, w = 440;
    const col2 = 540;
    this.item(i++, 'RENDER SCALE', x, y, w, { value:pct(st.renderScale), adjust:step('renderScale', 0.4, 1, 0.1) }); y += 36;
    this.item(i++, 'VOLUMETRIC FOG', x, y, w, { value:st.fog ? 'ON' : 'OFF', adjust:() => { st.fog = !st.fog; a.saveSettings(); } }); y += 36;
    this.item(i++, 'FOG DENSITY', x, y, w, { value:st.fogDensity.toFixed(2), adjust:step('fogDensity', 0.02, 0.4, 0.02) }); y += 36;
    this.item(i++, 'DUST MOTES', x, y, w, { value:String(st.dust), adjust:d => { st.dust = Math.min(6000, Math.max(0, st.dust + d * 500)); a.saveSettings(); } }); y += 36;
    this.item(i++, 'HORDE DENSITY', x, y, w, { value:st.density >= 800 ? `${st.density} (LOTS)` : String(st.density), adjust:d => { st.density = Math.min(1600, Math.max(20, st.density + d * (st.density >= 400 ? 200 : 40))); a.saveSettings(); } }); y += 36;
    this.item(i++, 'FILM GRAIN', x, y, w, { value:st.grain.toFixed(2), adjust:step('grain', 0, 0.12, 0.02) }); y += 36;
    this.item(i++, 'EXPOSURE', x, y, w, { value:st.exposure.toFixed(1), adjust:step('exposure', 0.5, 3, 0.1) }); y += 36;
    this.item(i++, 'CAMERA ZOOM', x, y, w, { value:st.zoom.toFixed(1), adjust:step('zoom', 0.6, 1.6, 0.1) }); y += 36;
    let y2 = 196;
    this.item(i++, 'MASTER VOLUME', col2, y2, w, { value:pct(a.audio.vol.master), adjust:d => { a.audio.vol.master = Math.min(1, Math.max(0, a.audio.vol.master + d * 0.1)); a.audio.applyVolumes(); a.saveSettings(); } }); y2 += 36;
    this.item(i++, 'EFFECTS VOLUME', col2, y2, w, { value:pct(a.audio.vol.sfx), adjust:d => { a.audio.vol.sfx = Math.min(1, Math.max(0, a.audio.vol.sfx + d * 0.1)); a.audio.applyVolumes(); a.saveSettings(); } }); y2 += 36;
    this.item(i++, 'AMBIENCE VOLUME', col2, y2, w, { value:pct(a.audio.vol.amb), adjust:d => { a.audio.vol.amb = Math.min(1, Math.max(0, a.audio.vol.amb + d * 0.1)); a.audio.applyVolumes(); a.saveSettings(); } }); y2 += 52;
    this.item(i++, '[ LOAD ASSET FILES ]', col2, y2, w, { act:() => a.pickFiles(), value:'WAV OGG MP3 PNG JPG' }); y2 += 36;
    this.item(i++, '[ LIST EMPTY SLOTS ]', col2, y2, w, { act:() => this.go('missing') }); y2 += 36;
    this.item(i++, '[ FORGET STORED ASSETS ]', col2, y2, w, { act:() => a.loader.clearStored() }); y2 += 36;
    this.item(i++, '[ BACK ]', col2, y2, w, { act:() => this.go('main') });
    const log = a.loader.log.slice(-5);
    log.forEach((l, k) => this.text(l.slice(0, 84), 56, 530 + k * 22, 18, LOW));
    this.text('DROP FILES ANYWHERE ON THIS WINDOW TO LOAD THEM. NAMES MAP TO SLOTS, E.G. gun.9mm.fire_01.wav', 56, 660, 18, MID);
  }

  drawMissing() {
    const a = this.app;
    this.frame('ASSET SLOTS');
    const rows = [...AUDIO_SLOTS.map(s => ({ id:s.id, desc:s.desc, have:a.audio.count(s.id) })), ...TEXTURE_SLOTS.map(s => ({ id:s.id, desc:s.desc, have:a.loader.textures.has(s.id) ? 1 : 0 }))];
    this.text('SLOT ID                         FILES  WHAT TO RECORD OR SOURCE', 56, 96, 20, FG);
    const per = 20;
    const start = Math.min(this.scroll, Math.max(0, rows.length - per));
    rows.slice(start, start + per).forEach((r, k) => {
      this.text(r.id.padEnd(30, ' '), 56, 124 + k * 24, 18, r.have ? FG : MID);
      this.text(r.have ? String(r.have).padStart(3, ' ') : '  -', 330, 124 + k * 24, 18, r.have ? FG : LOW);
      this.text(r.desc.toUpperCase().slice(0, 62), 400, 124 + k * 24, 18, r.have ? MID : LOW);
    });
    this.text(`${start + 1}–${Math.min(rows.length, start + per)} OF ${rows.length}   SCROLL WITH THE WHEEL`, 56, 625, 18, LOW);
    this.item(0, '[ BACK ]', 760, 660, 200, { act:() => this.go('diag') });
  }

  drawReport() {
    const a = this.app, r = a.lastReport || {};
    this.frame('INCURSION REPORT');
    this.text('SIGNAL LOST', TW / 2, 170, 64, FG, 'center');
    const lines = [
      `CAUSE ............ ${String(r.killedBy || 'UNKNOWN').toUpperCase()}`,
      `DEPTH REACHED .... ${r.depth ?? 0} M`,
      `TIME INSIDE ...... ${fmtTime(r.time || 0)}`,
      `CONFIRMED KILLS .. ${r.kills ?? 0}`,
      `LIMBS SEVERED .... ${r.dismember ?? 0}`,
      `ROUNDS FIRED ..... ${r.shots ?? 0}   HITS ${r.hits ?? 0}`,
    ];
    lines.forEach((l, i) => this.text(l, 260, 250 + i * 32, 24, MID));
    let i = 0;
    this.item(i++, '[ RE-ENTER THE THRESHOLD ]', 300, 500, 420, { act:() => a.enterGame() });
    this.item(i++, '[ ARSENAL ARCHIVE ]', 300, 548, 420, { act:() => this.go('arsenal') });
    this.item(i++, '[ MAIN ]', 300, 596, 420, { act:() => this.go('main') });
  }
}
