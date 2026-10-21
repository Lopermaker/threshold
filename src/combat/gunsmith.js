// Weapon platforms, attachment catalogue and the stat model behind the Arsenal Archive.

import { CALIBERS } from './ballistics.js';
import { rng } from '../core/math.js';

export const SLOTS = ['barrel', 'optic', 'laser', 'light', 'grip', 'stock', 'mag'];
export const SLOT_NAMES = { barrel:'Barrel', optic:'Optic', laser:'Laser', light:'Weapon light', grip:'Grip', stock:'Stock', mag:'Magazine' };

export const PLATFORMS = {
  mk9:      { name:'MK-9 Carbine',        caliber:'9x19',  rpm:850, auto:true,  spread:0.032, recoilV:0.85, recoilH:0.35, ads:0.22, weight:2.9, cap:30, reload:2.1, receiver:0.26, barrel:0.20, stock:0.20, kind:'smg' },
  kestrel:  { name:'Kestrel AR-15',       caliber:'556',   rpm:750, auto:true,  spread:0.016, recoilV:1.25, recoilH:0.45, ads:0.30, weight:3.4, cap:30, reload:2.4, receiver:0.30, barrel:0.30, stock:0.24, kind:'rifle' },
  vorona:   { name:'Vorona AKM',          caliber:'762',   rpm:600, auto:true,  spread:0.021, recoilV:1.75, recoilH:0.80, ads:0.34, weight:3.6, cap:30, reload:2.6, receiver:0.30, barrel:0.32, stock:0.25, kind:'rifle' },
  breach12: { name:'Breach-12 Pump',      caliber:'12ga',  rpm:75,  auto:false, spread:0.085, recoilV:3.0,  recoilH:1.0,  ads:0.32, weight:3.5, cap:6,  reload:0.55, receiver:0.30, barrel:0.36, stock:0.26, kind:'shotgun', perShell:true, pump:true },
  p9:       { name:'P9 Service Pistol',   caliber:'9x19',  rpm:420, auto:false, spread:0.028, recoilV:0.8,  recoilH:0.3,  ads:0.14, weight:0.8, cap:15, reload:1.6, receiver:0.14, barrel:0.06, stock:0,    kind:'pistol' },
  m1911:    { name:'M45 Heritage .45',    caliber:'45acp', rpm:380, auto:false, spread:0.026, recoilV:1.1,  recoilH:0.4,  ads:0.15, weight:1.1, cap:8,  reload:1.7, receiver:0.15, barrel:0.06, stock:0,    kind:'pistol' },
};

// Every option lists only the stats it changes. Multipliers compose; additive values sum.
export const ATTACHMENTS = {
  barrel: [
    { id:'std',   name:'Standard barrel',        len:1.0 },
    { id:'short', name:'Short barrel',           len:0.65, velMult:0.9,  flash:1.45, sound:1.1,  spread:1.12, ads:-0.03, weight:-0.25 },
    { id:'long',  name:'Extended barrel',        len:1.45, velMult:1.08, flash:0.85, sound:1.05, spread:0.85, ads:0.04,  weight:0.3 },
    { id:'comp',  name:'Barrel + compensator',   len:1.1,  flash:1.25, sound:1.25, recoilV:0.85, recoilH:0.8, weight:0.15, muzzle:0.05 },
    { id:'supp',  name:'Suppressed barrel',      len:1.0,  velMult:0.96, flash:0.12, sound:0.38, recoilV:0.92, ads:0.05, weight:0.45, muzzle:0.17, suppressed:true },
  ],
  optic: [
    { id:'iron',  name:'Iron sights',            optic:0, zoom:1.0,  shift:2.5 },
    { id:'dot',   name:'Red dot',                optic:1, zoom:1.06, shift:3.5, ads:-0.02, weight:0.1 },
    { id:'holo',  name:'Holographic sight',      optic:2, zoom:1.08, shift:4.0, weight:0.15 },
    { id:'scope', name:'2.5× prism scope',       optic:3, zoom:1.38, shift:7.5, ads:0.12, weight:0.4 },
  ],
  laser: [
    { id:'none',  name:'None',                   laser:0 },
    { id:'red',   name:'Visible red laser',      laser:1, spread:0.92, weight:0.08 },
    { id:'ir',    name:'IR laser (NVG only)',    laser:2, spread:0.92, weight:0.08 },
  ],
  light: [
    { id:'none',  name:'None',                   light:0 },
    { id:'flood', name:'Flood light (wide)',     light:1, cone:0.95, range:9,  lumen:5.5, weight:0.12 },
    { id:'bal',   name:'Balanced light',         light:2, cone:0.62, range:13, lumen:8,   weight:0.14 },
    { id:'throw', name:'Throw light (narrow)',   light:3, cone:0.34, range:20, lumen:13,  weight:0.16 },
  ],
  grip: [
    { id:'none',  name:'None' },
    { id:'vert',  name:'Vertical grip',          recoilV:0.75, ads:0.03, weight:0.12 },
    { id:'angle', name:'Angled grip',            recoilH:0.8,  ads:-0.04, weight:0.08 },
    { id:'stub',  name:'Stubby grip',            recoilV:0.88, recoilH:0.9, weight:0.06 },
  ],
  stock: [
    { id:'full',  name:'Fixed stock',            len:1.0 },
    { id:'coll',  name:'Collapsed stock',        len:0.6,  recoilV:1.15, recoilH:1.1, ads:-0.04, weight:-0.1 },
    { id:'none',  name:'No stock',               len:0,    recoilV:1.5,  recoilH:1.4, ads:-0.08, weight:-0.3 },
    { id:'heavy', name:'Heavy padded stock',     len:1.1,  recoilV:0.82, recoilH:0.85, ads:0.05, weight:0.4 },
  ],
  mag: [
    { id:'std',   name:'Standard magazine',      capMult:1,   magType:0 },
    { id:'ext',   name:'Extended magazine',      capMult:1.67, reload:0.3, weight:0.2, magType:1 },
    { id:'drum',  name:'Drum magazine',          capMult:3.3, reload:1.2, ads:0.06, weight:0.9, magType:2 },
    { id:'fast',  name:'Coupled fast-mag',       capMult:1,   reload:-0.4, weight:0.25, magType:3 },
  ],
};

export function defaultConfig(platformId) {
  const c = { platform:platformId };
  for (const s of SLOTS) c[s] = ATTACHMENTS[s][0].id;
  if (PLATFORMS[platformId].kind === 'pistol') { c.stock = 'none'; c.grip = 'none'; }
  c.light = 'bal';
  return c;
}

export function allowedOptions(platformId, slot) {
  const P = PLATFORMS[platformId];
  let list = ATTACHMENTS[slot];
  if (P.kind === 'pistol' && (slot === 'stock' || slot === 'grip')) list = list.filter(o => o.id === 'none');
  if (P.kind === 'pistol' && slot === 'optic') list = list.filter(o => o.id !== 'scope');
  if (P.kind === 'shotgun' && slot === 'mag') list = list.filter(o => o.id === 'std' || o.id === 'ext');
  return list;
}

export function opt(slot, id) {
  return ATTACHMENTS[slot].find(o => o.id === id) || ATTACHMENTS[slot][0];
}

export function computeStats(config) {
  const P = PLATFORMS[config.platform];
  const cal = CALIBERS[P.caliber];
  const s = {
    name:P.name, caliber:P.caliber, caliberName:cal.name, kind:P.kind, auto:P.auto, pump:!!P.pump, perShell:!!P.perShell,
    rpm:P.rpm, spread:P.spread, recoilV:P.recoilV, recoilH:P.recoilH, ads:P.ads, weight:P.weight,
    velMult:1, flash:1, sound:1, cap:P.cap, reload:P.reload,
    zoom:1, shift:2.5, optic:0, laser:0, light:0, cone:0.62, range:13, lumen:8, suppressed:false,
    muzzleLen:0, barrelLen:P.barrel, stockLen:P.stock, receiver:P.receiver, magType:0,
  };
  for (const slot of SLOTS) {
    const o = opt(slot, config[slot]);
    if (o.velMult) s.velMult *= o.velMult;
    if (o.flash) s.flash *= o.flash;
    if (o.sound) s.sound *= o.sound;
    if (o.spread) s.spread *= o.spread;
    if (o.recoilV) s.recoilV *= o.recoilV;
    if (o.recoilH) s.recoilH *= o.recoilH;
    if (o.ads) s.ads += o.ads;
    if (o.weight) s.weight += o.weight;
    if (o.reload) s.reload += o.reload;
    if (o.capMult) s.cap = Math.round(P.cap * o.capMult);
    if (o.magType !== undefined) s.magType = o.magType;
    if (o.zoom) { s.zoom = o.zoom; s.shift = o.shift; s.optic = o.optic; }
    if (o.laser !== undefined) s.laser = o.laser;
    if (o.light !== undefined) { s.light = o.light; if (o.cone) { s.cone = o.cone; s.range = o.range; s.lumen = o.lumen; } }
    if (o.suppressed) s.suppressed = true;
    if (slot === 'barrel') { s.barrelLen = P.barrel * o.len; s.muzzleLen = o.muzzle || 0; }
    if (slot === 'stock' && o.len !== undefined) s.stockLen = P.stock * o.len;
  }
  s.ads = Math.max(0.08, s.ads);
  s.reload = Math.max(0.35, s.reload);
  s.velocity = cal.v0 * s.velMult;
  s.energy = cal.energy * s.velMult * s.velMult;
  s.damage = cal.dmg * cal.pellets;
  s.pellets = cal.pellets;
  s.soundRadius = cal.sound * s.sound;
  s.flashLight = 3.2 * s.flash;
  s.moveMult = Math.max(0.78, 1 - Math.max(0, s.weight - 1) * 0.04);
  s.interval = 60 / s.rpm;
  return s;
}

// A repeatable recoil pattern per platform: horizontal drift per shot index.
const patterns = {};
export function recoilPattern(platformId) {
  if (patterns[platformId]) return patterns[platformId];
  const r = rng(platformId.length * 977 + platformId.charCodeAt(0));
  const pts = [];
  let drift = 0;
  for (let i = 0; i < 60; i++) {
    drift += (r() - 0.45) * 0.6;
    drift = Math.max(-1.2, Math.min(1.2, drift));
    pts.push(drift);
  }
  patterns[platformId] = pts;
  return pts;
}

export function defaultLoadout() {
  return { primary:defaultConfig('mk9'), secondary:defaultConfig('p9') };
}

export function loadLoadout() {
  try {
    const l = JSON.parse(localStorage.getItem('threshold.loadout'));
    if (l && PLATFORMS[l.primary?.platform] && PLATFORMS[l.secondary?.platform]) return l;
  } catch (e) { /* storage is optional */ }
  return defaultLoadout();
}

export function saveLoadout(l) {
  try { localStorage.setItem('threshold.loadout', JSON.stringify(l)); } catch (e) { /* storage is optional */ }
}
