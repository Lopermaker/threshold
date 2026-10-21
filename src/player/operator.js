// Operator customisation: uniform, rig, headgear, and the persistent wear record.

export const UNIFORMS = [
  { id:'hazmat',  name:'Weathered hazmat suit',   color:[0.60, 0.52, 0.16], seam:[0.30, 0.27, 0.10], note:'Sealed suit. Taped seams.' },
  { id:'field',   name:'Tactical field uniform',  color:[0.30, 0.31, 0.22], seam:[0.18, 0.19, 0.13], note:'Olive drab, reinforced knees.' },
  { id:'coverall',name:'Maintenance coveralls',   color:[0.22, 0.27, 0.34], seam:[0.12, 0.15, 0.19], note:'Facility issue. Name tape torn off.' },
  { id:'black',   name:'Low-light assault kit',   color:[0.10, 0.10, 0.11], seam:[0.05, 0.05, 0.05], note:'Absorbs torchlight. Shows blood less.' },
];

export const RIGS = [
  { id:'plate', name:'Plate carrier',  dmgMult:0.68, moveMult:0.95, slots:8,  note:'Front plate, cummerbund pouches.' },
  { id:'chest', name:'Chest rig',      dmgMult:0.9,  moveMult:1.0,  slots:10, note:'No armour, more pouch space.' },
  { id:'none',  name:'Sling only',     dmgMult:1.0,  moveMult:1.04, slots:0,  note:'Spare magazines in pockets.' },
];

// Shader ids: 0 gas mask, 1 helmet+NVG, 2 helmet+NVG+mask, 3 balaclava
export const HEADGEAR = [
  { id:'mask', name:'Full-face gas mask',          mask:true,  nvg:false, shader:0, note:'Filters spores. Fogs when you breathe hard.' },
  { id:'nvg',  name:'Helmet with NVG',             mask:false, nvg:true,  shader:1, note:'Image intensifier. Press N.' },
  { id:'both', name:'Helmet, NVG and gas mask',    mask:true,  nvg:true,  shader:2, note:'Everything, and it all fogs.' },
  { id:'none', name:'Balaclava',                   mask:false, nvg:false, shader:3, note:'Nothing between you and the air.' },
];

export function defaultProfile() {
  return {
    callsign:'OPERATOR-7',
    uniform:'hazmat', rig:'plate', headgear:'mask',
    wear:{ blood:[], dirt:0, tears:[], boots:0 },
    stats:{ runs:0, deepest:0, kills:0, timeIn:0 },
  };
}

export function loadProfile() {
  try {
    const p = JSON.parse(localStorage.getItem('threshold.profile'));
    if (p && p.wear) return { ...defaultProfile(), ...p, wear:{ ...defaultProfile().wear, ...p.wear } };
  } catch (e) { /* storage is optional */ }
  return defaultProfile();
}

export function saveProfile(p) {
  try { localStorage.setItem('threshold.profile', JSON.stringify(p)); } catch (e) { /* storage is optional */ }
}

export const findUniform = id => UNIFORMS.find(u => u.id === id) || UNIFORMS[0];
export const findRig = id => RIGS.find(r => r.id === id) || RIGS[0];
export const findHead = id => HEADGEAR.find(h => h.id === id) || HEADGEAR[0];

// Wear is stored in the operator's local top-down frame (meters, +x forward).
// It never washes out; only "Issue new uniform" clears it.
export function addWear(profile, kind, x, y, r) {
  const w = profile.wear;
  if (kind === 'blood') {
    w.blood.push({ x, y, r });
    if (w.blood.length > 16) w.blood.splice(Math.floor(Math.random() * 8), 1);
  } else if (kind === 'tear') {
    w.tears.push({ x, y, r });
    if (w.tears.length > 6) w.tears.shift();
  } else if (kind === 'dirt') {
    w.dirt = Math.min(1, w.dirt + r);
  }
}

export function wearUniforms(profile) {
  const arr = new Float32Array(24 * 4);
  let n = 0;
  for (const b of profile.wear.blood) { if (n < 24) arr.set([b.x, b.y, b.r, 0], n++ * 4); }
  for (const t of profile.wear.tears) { if (n < 24) arr.set([t.x, t.y, t.r, 2], n++ * 4); }
  return { arr, n };
}

// Pouch layout on the rig, driven by what the operator carries.
// kind: 0 rifle mag, 1 pistol mag, 2 drum, 3 shotgun shells, 4 medical, 5 radio
export function pouchLayout(profile, primary, secondary, ammo) {
  const rig = findRig(profile.rig);
  const out = [];
  if (!rig.slots) return out;
  const front = [];
  const spareMags = primary.perShell ? 0 : Math.min(4, Math.ceil(ammo.primaryReserve / Math.max(1, primary.cap)));
  const maxPrimary = primary.perShell ? 0 : 4;
  for (let i = 0; i < maxPrimary; i++) {
    const kind = primary.magType === 2 ? 2 : 0;
    front.push({ kind, full:i < spareMags ? 1 : 0 });
  }
  if (primary.perShell) {
    const shells = Math.min(4, Math.ceil(ammo.primaryReserve / 6));
    for (let i = 0; i < 4; i++) front.push({ kind:3, full:i < shells ? 1 : 0 });
  }
  const pistolMags = Math.min(2, Math.ceil(ammo.secondaryReserve / Math.max(1, secondary.cap)));
  for (let i = 0; i < 2; i++) front.push({ kind:1, full:i < pistolMags ? 1 : 0 });
  front.push({ kind:4, full:ammo.meds > 0 ? 1 : 0 });
  if (rig.slots >= 10) front.push({ kind:5, full:1 });

  // Front row across the plate, overflow wraps to the cummerbund sides.
  const n = Math.min(rig.slots + 2, front.length, 12);
  for (let i = 0; i < n; i++) {
    const f = front[i];
    let x, y, w, h;
    if (i < 6) { x = 0.07; y = -0.15 + i * 0.06; w = f.kind === 3 ? 0.018 : 0.032; h = 0.024; }
    else { const k = i - 6; x = -0.05 + (k % 2) * 0.07; y = (k < 2 ? -1 : 1) * (0.2 + Math.floor(k / 4) * 0.02); w = 0.03; h = 0.03; }
    if (f.kind === 2) { w = 0.045; h = 0.045; }
    if (f.kind === 4) { w = 0.035; h = 0.03; }
    out.push({ x, y, w, h, kind:f.kind, full:f.full });
  }
  return out;
}
