// THRESHOLD: boot, state machine and frame loop.
//   menu        the CRT terminal in the research room
//   transition  the CRT collapses to a dot before the incursion starts
//   game        the incursion; Esc returns to the terminal with RESUME available

import { Input } from './core/input.js';
import { Renderer } from './render/renderer.js';
import { MenuScene } from './ui/menuscene.js';
import { Terminal } from './ui/terminal.js';
import { Game } from './game.js';
import { AudioEngine } from './audio/audio.js';
import { AssetLoader } from './assets/loader.js';
import { loadLoadout } from './combat/gunsmith.js';
import { loadProfile } from './player/operator.js';

const DEFAULTS = { renderScale:0.85, fog:true, fogDensity:0.12, dust:2500, density:160, grain:0.035, exposure:1.0, zoom:1.0 };

function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('threshold.settings') || '{}') }; } catch (e) { return { ...DEFAULTS }; }
}

class App {
  constructor() {
    this.canvas = document.getElementById('gl');
    this.hud = document.getElementById('hud');
    this.hg = this.hud.getContext('2d');
    const gl = this.canvas.getContext('webgl2', { antialias:false, alpha:false, depth:false, powerPreference:'high-performance', preserveDrawingBuffer:false });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpuName = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).toUpperCase().slice(0, 40);
    this.settings = loadSettings();
    this.profile = loadProfile();
    this.loadout = loadLoadout();
    this.input = new Input(this.canvas);
    this.audio = new AudioEngine();
    try { const v = JSON.parse(localStorage.getItem('threshold.volume') || 'null'); if (v) Object.assign(this.audio.vol, v); } catch (e) { /* storage is optional */ }
    this.renderer = new Renderer(gl);
    this.menu = new MenuScene(gl, this.renderer.geo);
    this.loader = new AssetLoader(this.audio, this.renderer);
    this.game = new Game(this.renderer, this.audio, this.input, this.settings);
    this.terminal = new Terminal(this);
    this.mode = 'menu';
    this.paused = false;
    this.time = 0;
    this.last = performance.now();
    this.fps = 60;
    this.termT = 0;
    this.deadT = 0;
    this.transT = 0;

    const unlock = () => { this.audio.ensure(); };
    addEventListener('pointerdown', unlock);
    addEventListener('keydown', unlock);
    this.setupDrop();
    this.filePicker = document.getElementById('files');
    this.filePicker.addEventListener('change', async () => {
      this.audio.ensure();
      const n = await this.loader.loadFiles([...this.filePicker.files]);
      this.loader.note(`LOADED     ${n} file(s)`);
      this.filePicker.value = '';
      this.terminal.dirty = true;
    });
    this.loader.restore().then(() => { this.terminal.dirty = true; });
    this.loader.fetchManifest().then(() => { this.terminal.dirty = true; });
    document.fonts && document.fonts.load('26px "VT323"').then(() => { this.terminal.dirty = true; });
    requestAnimationFrame(t => this.frame(t));
  }

  sound(slot, gain = 0.6) { this.audio.play(slot, { bus:'ui', gain, jitter:0.08 }); }
  saveSettings() {
    try {
      localStorage.setItem('threshold.settings', JSON.stringify(this.settings));
      localStorage.setItem('threshold.volume', JSON.stringify(this.audio.vol));
    } catch (e) { /* storage is optional */ }
  }
  pickFiles() { this.filePicker.click(); }

  setupDrop() {
    addEventListener('dragover', e => e.preventDefault());
    addEventListener('drop', async e => {
      e.preventDefault();
      this.audio.ensure();
      const files = [];
      const walk = async entry => {
        if (entry.isFile) files.push(await new Promise(r => entry.file(r)));
        else if (entry.isDirectory) {
          const reader = entry.createReader();
          let batch;
          do {
            batch = await new Promise(r => reader.readEntries(r));
            for (const b of batch) await walk(b);
          } while (batch.length);
        }
      };
      const items = [...(e.dataTransfer.items || [])];
      if (items.length && items[0].webkitGetAsEntry) {
        for (const it of items) { const en = it.webkitGetAsEntry(); if (en) await walk(en); }
      } else files.push(...e.dataTransfer.files);
      const n = await this.loader.loadFiles(files);
      this.loader.note(`LOADED     ${n} of ${files.length} dropped file(s)`);
      this.terminal.dirty = true;
    });
  }

  enterGame() {
    this.mode = 'transition';
    this.transStart = performance.now();
    this.paused = false;
    this.menu.targetPower = 0;
    this.audio.play('crt.degauss', { bus:'ui' });
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.mode = 'game';
    this.audio.loop('crt', 'crt.hum.loop', 0, { bus:'ui' });
  }

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    this.fps += (1 / Math.max(dt, 1e-3) - this.fps) * 0.05;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const cssW = this.canvas.clientWidth, cssH = this.canvas.clientHeight;
    const W = Math.round(cssW * dpr), H = Math.round(cssH * dpr);
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
    if (this.hud.width !== Math.round(cssW * dpr)) { this.hud.width = Math.round(cssW * dpr); this.hud.height = Math.round(cssH * dpr); }
    this.hg.setTransform(dpr, 0, 0, dpr, 0, 0);
    const inp = this.input;

    try {
      if (this.mode === 'game') {
        if (inp.wasPressed('Escape') && !this.game.dead) {
          inp.pressed.delete('Escape');
          this.paused = true;
          this.mode = 'menu';
          this.menu.targetPower = 1;
          this.menu.power = 0.15;
          this.terminal.go('main');
        } else {
          this.renderer.viewW = cssW; this.renderer.viewH = cssH;
          this.game.update(dt);
          this.game.render(cssW, cssH, dpr, dt);
          this.game.drawHUD(this.hg, cssW, cssH, this.loader.summary());
          if (this.game.dead) {
            this.deadT += dt;
            if (this.deadT > 2.4) {
              const g = this.game;
              this.lastReport = { killedBy:g.killedBy, depth:Math.floor(g.p.depth), time:g.stats.time, kills:g.stats.kills, dismember:g.stats.dismember, shots:g.stats.shots, hits:g.stats.hits };
              this.deadT = 0;
              this.game.active = false;
              this.audio.stopAllLoops();
              this.mode = 'menu';
              this.menu.power = 0.1;
              this.menu.targetPower = 1;
              this.terminal.go('report');
            }
          }
        }
      }

      if (this.mode === 'menu' || this.mode === 'transition') {
        this.hg.clearRect(0, 0, cssW, cssH);
        if (this.mode === 'menu') {
          const pick = (x, y) => this.menu.pick(x, y, cssW, cssH);
          const m = pick(inp.mouse.x, inp.mouse.y);
          const clicks = inp.clicks.map(c => ({ ...pick(c.x, c.y), button:c.button })).filter(c => c.u !== undefined);
          this.terminal.handle({ wasPressed:k => inp.wasPressed(k), clicks, wheel:inp.wheel }, m);
          this.canvas.style.cursor = m ? 'pointer' : 'default';
          this.audio.loop('crt', 'crt.hum.loop', 0.35, { bus:'ui' });
        } else {
          this.transT = (performance.now() - this.transStart) / 1000;
          if (this.transT > 0.9) {
            this.audio.loop('crt', 'crt.hum.loop', 0, { bus:'ui' });
            this.game.start(this.profile, this.loadout);
            this.mode = 'game';
            this.canvas.style.cursor = 'none';
            this.deadT = 0;
          }
        }
        this.termT -= dt;
        if (this.terminal.dirty || this.termT <= 0) {
          this.terminal.draw(this.time);
          this.menu.uploadTerminal(this.terminal.canvas);
          this.termT = 0.25;
        }
        const fade = this.mode === 'transition' ? Math.max(0, 1 - Math.max(0, this.transT - 0.5) * 2.5) : 1;
        this.menu.render(this.time, dt, cssW, cssH, dpr, 0.9, fade);
      }
    } catch (e) {
      this.fail(e);
      return;
    }
    inp.endFrame();
    requestAnimationFrame(t => this.frame(t));
  }

  fail(e) {
    console.error(e);
    const el = document.getElementById('fatal');
    el.hidden = false;
    el.textContent = 'THRESHOLD stopped: ' + (e && e.message ? e.message : String(e));
  }
}

try {
  window.__threshold = new App();
} catch (e) {
  console.error(e);
  const el = document.getElementById('fatal');
  el.hidden = false;
  el.textContent = 'THRESHOLD could not start: ' + e.message;
}
