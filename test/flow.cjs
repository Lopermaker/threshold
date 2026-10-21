const { chromium } = require('playwright');
const path = require('path');
const { spawn } = require('child_process');
(async () => {
  const port = 9100 + Math.floor(Math.random() * 300);
  const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd:path.resolve(__dirname, '../dist'), stdio:'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport:{ width:1280, height:720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/manifest|404/.test(m.text())) errors.push(m.text().slice(0, 1500)); });
  await page.goto(`http://127.0.0.1:${port}/threshold.html`);
  await page.waitForTimeout(1500);
  const mode = () => page.evaluate(() => ({ mode:window.__threshold.mode, page:window.__threshold.terminal.page, paused:window.__threshold.paused }));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__threshold.mode === 'game', null, { timeout:60000 });
  console.log('1 entered', JSON.stringify(await mode()));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__threshold.mode === 'menu', null, { timeout:30000 });
  console.log('2 paused', JSON.stringify(await mode()), 'first item:', await page.evaluate(() => window.__threshold.terminal.items[0] && window.__threshold.terminal.page));
  await page.waitForTimeout(800);
  await page.keyboard.press('Enter');   // RESUME is item 0 while paused
  await page.waitForFunction(() => window.__threshold.mode === 'game', null, { timeout:30000 });
  console.log('3 resumed', JSON.stringify(await mode()));
  await page.evaluate(() => { const g = window.__threshold.game; g.p.hp = 0; g.die('skin'); });
  await page.waitForFunction(() => window.__threshold.mode === 'menu', null, { timeout:90000 });
  console.log('4 after death', JSON.stringify(await mode()), JSON.stringify(await page.evaluate(() => window.__threshold.lastReport)));
  // Gunsmith change persists and affects next run
  await page.evaluate(() => { const a = window.__threshold; a.loadout.primary.barrel = 'supp'; a.loadout.primary.mag = 'drum'; });
  await page.evaluate(() => window.__threshold.enterGame());
  await page.waitForFunction(() => window.__threshold.mode === 'game', null, { timeout:60000 });
  console.log('5 new run weapon', JSON.stringify(await page.evaluate(() => { const s = window.__threshold.game.weapons[0].s; return { cap:s.cap, suppressed:s.suppressed, soundRadius:Math.round(s.soundRadius), flash:s.flash.toFixed(2) }; })));
  console.log('errors:', errors.length ? errors.slice(0, 4) : 'none');
  await browser.close(); server.kill();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
