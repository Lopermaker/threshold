// Brings real asset files into the engine.
//   1. assets/manifest.json published next to the page ({ "files": ["assets/gun.9mm.fire_01.wav", ...] })
//   2. Files or folders dropped on the window, or picked in SYSTEM DIAGNOSTICS
//   3. Files remembered in this browser's IndexedDB from an earlier session
// Filenames map to slots (see manifest.js). Albedo and roughness maps are packed into one
// RGBA texture (roughness in alpha) before upload.

import { AUDIO_SLOTS, TEXTURE_SLOTS, slotForFilename, isAudioFile, isImageFile } from './manifest.js';

const GRAY_ROUGH = [0.96, 0.78, 0.88, 0.42];
const DB = 'threshold-assets', STORE = 'files';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class AssetLoader {
  constructor(audio, renderer) {
    this.audio = audio;
    this.renderer = renderer;
    this.textures = new Map();      // slot id -> ImageBitmap
    this.log = [];
    this.unmatched = [];
  }

  note(msg) {
    this.log.push(msg);
    if (this.log.length > 40) this.log.shift();
  }

  async loadFiles(list, persist = true) {
    let ok = 0;
    for (const f of list) {
      const name = f.name;
      const slot = slotForFilename(name);
      if (!slot) { this.unmatched.push(name); this.note(`UNMATCHED  ${name}`); continue; }
      try {
        const data = await f.arrayBuffer();
        if (slot.mat === undefined && isAudioFile(name)) {
          await this.audio.decode(slot.id, data);
          ok++;
          this.note(`AUDIO      ${slot.id}  <-  ${name}`);
        } else if (slot.mat !== undefined && isImageFile(name)) {
          const bmp = await createImageBitmap(new Blob([data]));
          this.textures.set(slot.id, bmp);
          this.compose(slot.mat);
          ok++;
          this.note(`TEXTURE    ${slot.id}  <-  ${name}`);
        } else {
          this.note(`WRONG TYPE ${name} for ${slot.id}`);
          continue;
        }
        if (persist) this.store(name, data);
      } catch (e) {
        this.note(`FAILED     ${name}: ${e.message}`);
      }
    }
    return ok;
  }

  compose(mat) {
    const get = kind => this.textures.get(TEXTURE_SLOTS.find(s => s.mat === mat && s.kind === kind).id);
    const alb = get('albedo'), rough = get('roughness'), nrm = get('normal');
    if (nrm) this.renderer.setMaterial(mat, 'normal', nrm);
    if (!alb) return;
    const c = document.createElement('canvas');
    c.width = alb.width; c.height = alb.height;
    const g = c.getContext('2d', { willReadFrequently:true });
    g.drawImage(alb, 0, 0);
    const img = g.getImageData(0, 0, c.width, c.height);
    if (rough) {
      const rc = document.createElement('canvas');
      rc.width = c.width; rc.height = c.height;
      const rg = rc.getContext('2d', { willReadFrequently:true });
      rg.drawImage(rough, 0, 0, c.width, c.height);
      const r = rg.getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < img.data.length; i += 4) img.data[i + 3] = r[i];
    } else {
      const a = Math.round(GRAY_ROUGH[mat] * 255);
      for (let i = 3; i < img.data.length; i += 4) img.data[i] = a;
    }
    g.putImageData(img, 0, 0);
    this.renderer.setMaterial(mat, 'albedo', c);
  }

  async store(name, data) {
    try {
      const db = await openDB();
      db.transaction(STORE, 'readwrite').objectStore(STORE).put(data, name);
    } catch (e) { /* storage is optional */ }
  }

  async restore() {
    try {
      const db = await openDB();
      const tx = db.transaction(STORE, 'readonly').objectStore(STORE);
      const keys = await new Promise(r => { const q = tx.getAllKeys(); q.onsuccess = () => r(q.result); q.onerror = () => r([]); });
      const vals = await new Promise(r => { const q = tx.getAll(); q.onsuccess = () => r(q.result); q.onerror = () => r([]); });
      const files = keys.map((k, i) => ({ name:String(k), arrayBuffer:async () => vals[i] }));
      if (files.length) this.note(`RESTORED   ${files.length} stored file(s)`);
      return this.loadFiles(files, false);
    } catch (e) { return 0; }
  }

  async clearStored() {
    try {
      const db = await openDB();
      db.transaction(STORE, 'readwrite').objectStore(STORE).clear();
      this.note('CLEARED    stored assets (reload to unload them)');
    } catch (e) { /* storage is optional */ }
  }

  async fetchManifest() {
    try {
      const res = await fetch('assets/manifest.json');
      if (!res.ok) return 0;
      const m = await res.json();
      const files = (m.files || []).map(path => ({
        name:path.split('/').pop(),
        arrayBuffer:async () => (await fetch(path)).arrayBuffer(),
      }));
      this.note(`MANIFEST   ${files.length} file(s) listed`);
      return this.loadFiles(files, false);
    } catch (e) { return 0; }
  }

  summary() {
    const audioFilled = AUDIO_SLOTS.filter(s => this.audio.has(s.id)).length;
    const audioQueued = this.audio.pendingRaw.length;
    const texFilled = TEXTURE_SLOTS.filter(s => this.textures.has(s.id)).length;
    return { audioFilled, audioTotal:AUDIO_SLOTS.length, audioQueued, texFilled, texTotal:TEXTURE_SLOTS.length };
  }
}
