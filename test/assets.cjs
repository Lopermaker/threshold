const { chromium } = require('playwright');
const path = require('path');
const { spawn } = require('child_process');
(async () => {
  const port = 9500 + Math.floor(Math.random() * 300);
  const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd:path.resolve(__dirname, '../dist'), stdio:'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport:{ width:1280, height:720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/threshold.html`);
  await page.waitForTimeout(1500);
  await page.mouse.click(640, 360);   // user gesture unlocks audio
  const fx = f => path.join(__dirname, 'fixtures', f);
  await page.setInputFiles('#files', [fx('gun_9mm_fire_01.wav'), fx('mat.carpet.albedo.png'), fx('unknown_file.png')]);
  await page.waitForTimeout(2500);
  console.log(JSON.stringify(await page.evaluate(() => { const a = window.__threshold; return { summary:a.loader.summary(), log:a.loader.log.slice(-4), carpetLoaded:a.renderer.matLoaded[0], played:!!a.audio.play('gun.9mm.fire', {}) }; }), null, 1));
  console.log('errors:', errors.length ? errors : 'none');
  await browser.close(); server.kill();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
