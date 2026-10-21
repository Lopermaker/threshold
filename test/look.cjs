// Renders the game view after N simulated seconds, driving update() directly so slow software GL doesn't matter.
const { chromium } = require('playwright');
const path = require('path');
const { spawn } = require('child_process');
(async () => {
  const port = 8125 + Math.floor(Math.random() * 500);
  const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd:path.resolve(__dirname, '../dist'), stdio:'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport:{ width:1280, height:720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/manifest|404/.test(m.text())) errors.push(m.text().slice(0, 1500)); });
  await page.goto(`http://127.0.0.1:${port}/threshold.html`);
  await page.waitForTimeout(1500);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__threshold.mode === 'game', null, { timeout:60000 });
  await page.mouse.move(980, 300);
  const script = process.argv[2] || 'basic';
  const out = await page.evaluate(async script => {
    const a = window.__threshold, g = a.game;
    // Freeze the real loop so we control time.
    a.frame = () => {};
    const W = a.canvas.clientWidth, H = a.canvas.clientHeight;
    const step = (sec, fn) => { const n = Math.round(sec / 0.033); for (let i = 0; i < n; i++) { fn && fn(i); g.update(0.033); a.input.endFrame(); } };
    const draw = () => { g.render(W, H, 1, 0.033); g.drawHUD(a.hg, W, H, a.loader.summary()); };
    const log = {};
    a.input.mouse.x = 980; a.input.mouse.y = 300;
    step(1.0);
    if (script === 'combat') {
      const p = g.p;
      for (let k = 0; k < 8; k++) g.horde.spawn(k % 3, p.x + 3 + (k % 4) * 0.7, p.y - 1.4 + Math.floor(k / 4) * 1.2, 77, 0);
      const wp = { x:p.x + 4, y:p.y - 0.8 };
      a.input.mouse.x = W / 2 + (wp.x - g.cam.x) * 56; a.input.mouse.y = H / 2 + (wp.y - g.cam.y) * 56;
      a.input.mouse.buttons[0] = true;
      step(2.5);
      a.input.mouse.buttons[0] = false;
      step(1.5);
    }
    if (script === 'nvg') {
      g.p.head = { ...g.p.head, nvg:true, mask:true, shader:2 };
      g.p.nvg = true; g.p.maskFog = 0.75; g.p.breathPh = 0;
      step(0.1);
    }
    if (script === 'wallblood') {
      // Find a wall to the east and put creatures right in front of it.
      const p = g.p;
      a.settings.density = 0;
      g.horde.reset();
      let best = null;
      for (let k = 0; k < 16; k++) { const an = k / 16 * Math.PI * 2; const h = g.win.rayWall(p.x, p.y, Math.cos(an), Math.sin(an), 8); if (h.axis >= 0 && h.t > 2 && (!best || h.t < best.t)) best = { t:h.t, an }; }
      const dx = Math.cos(best.an), dy = Math.sin(best.an);
      const tx = p.x + dx * (best.t - 0.7), ty = p.y + dy * (best.t - 0.7);
      for (let k = 0; k < 3; k++) { const i = g.horde.spawn(2, tx - dy * (k - 1) * 0.5, ty + dx * (k - 1) * 0.5, 55, 0); g.horde.hp[i] = 400; }
      g.cam.x = p.x + dx * best.t * 0.5; g.cam.y = p.y + dy * best.t * 0.5;
      a.input.mouse.x = W / 2 + (tx - g.cam.x) * 56; a.input.mouse.y = H / 2 + (ty - g.cam.y) * 56;
      a.input.mouse.buttons[0] = true; step(1.6); a.input.mouse.buttons[0] = false;
      g.horde.reset(); step(3);
      log.wall = best;
    }
    if (script === 'horde') {
      a.settings.density = 1000;
      const t0 = performance.now(); step(6); log.simMs = ((performance.now() - t0) / (6 / 0.033)).toFixed(2);
      const t1 = performance.now(); for (let i = 0; i < 30; i++) { g.update(0.033); } log.updateMsAt1000 = ((performance.now() - t1) / 30).toFixed(2);
    }
    draw();
    log.stats = g.stats; log.horde = g.horde.count; log.corpses = g.horde.corpses.length; log.limbs = g.horde.limbs.length;
    log.gore = g.gore.stats; log.pools = g.gore.pools.length; log.drips = g.gore.drips.length; log.hp = g.p.hp;
    return log;
  }, script);
  console.log(JSON.stringify(out));
  await page.waitForTimeout(300);
  await page.screenshot({ path:path.join(__dirname, 'shots', `look-${script}.png`) });
  console.log('errors:', errors.length ? errors.slice(0, 4) : 'none');
  await browser.close(); server.kill();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
