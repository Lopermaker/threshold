const { chromium } = require('playwright');
const path = require('path');
const { spawn } = require('child_process');
(async () => {
  const server = spawn('python3', ['-m', 'http.server', '8123', '--bind', '127.0.0.1'], { cwd:path.resolve(__dirname, '../dist'), stdio:'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const shots = path.join(__dirname, 'shots');
  const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport:{ width:1280, height:720 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/manifest\.json|404/.test(m.text())) errors.push('console: ' + m.text().slice(0, 2500)); });
  await page.goto('http://127.0.0.1:8123/threshold.html');
  await page.waitForTimeout(4500);
  await page.screenshot({ path:path.join(shots, 'menu2.png') });
  const step = process.argv[2] || 'all';
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__threshold.mode === 'game', null, { timeout:60000 });
  await page.waitForTimeout(1500);
  let st = await page.evaluate(() => { const a = window.__threshold; return { mode:a.mode, fatal:document.getElementById('fatal').hidden ? null : document.getElementById('fatal').textContent }; });
  console.log('after enter:', JSON.stringify(st).slice(0, 2500));
  await page.mouse.move(900, 300);
  await page.waitForTimeout(800);
  await page.screenshot({ path:path.join(shots, 'game1.png') });
  // put some creatures in front and shoot
  await page.evaluate(() => {
    const g = window.__threshold.game, p = g.p;
    for (let k = 0; k < 6; k++) g.horde.spawn(k % 3, p.x + 2.5 + k * 0.6, p.y - 1 + (k % 2) * 0.8, 99, 0);
  });
  await page.mouse.move(1000, 330);
  await page.mouse.down();
  await page.waitForTimeout(1600);
  await page.mouse.up();
  await page.waitForTimeout(400);
  await page.screenshot({ path:path.join(shots, 'game2.png') });
  const info = await page.evaluate(() => { const g = window.__threshold.game; return { kills:g.stats.kills, shots:g.stats.shots, hits:g.stats.hits, limbs:g.horde.limbs.length, corpses:g.horde.corpses.length, pools:g.gore.pools.length, splats:g.gore.stats, horde:g.horde.count, hp:g.p.hp, fps:window.__threshold.fps.toFixed(1) }; });
  console.log('combat:', JSON.stringify(info));
  // walk a bit
  await page.keyboard.down('KeyW'); await page.waitForTimeout(1500); await page.keyboard.up('KeyW');
  await page.keyboard.down('KeyD'); await page.waitForTimeout(1200); await page.keyboard.up('KeyD');
  await page.screenshot({ path:path.join(shots, 'game3.png') });
  // NVG + mask
  await page.evaluate(() => { const g = window.__threshold.game; g.p.head = { ...g.p.head, nvg:true, mask:true }; g.p.nvg = true; g.p.maskFog = 0.8; });
  await page.waitForTimeout(500);
  await page.screenshot({ path:path.join(shots, 'game-nvg.png') });
  console.log('errors:', errors.length ? errors.slice(0, 6) : 'none');
  await browser.close();
  server.kill();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
