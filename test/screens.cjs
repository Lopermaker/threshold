// Terminal pages + NVG/mask view.
const { chromium } = require('playwright');
const path = require('path');
const { spawn } = require('child_process');
(async () => {
  const port = 8700 + Math.floor(Math.random() * 200);
  const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd:path.resolve(__dirname, '../dist'), stdio:'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport:{ width:1280, height:720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/manifest|404/.test(m.text())) errors.push(m.text().slice(0, 1500)); });
  await page.goto(`http://127.0.0.1:${port}/threshold.html`);
  await page.waitForTimeout(2000);
  // Save the raw terminal canvas for each page (readable) and one CRT shot.
  for (const pg of ['arsenal', 'personnel', 'diag', 'missing']) {
    const data = await page.evaluate(pg => { const a = window.__threshold; a.terminal.go(pg); a.terminal.draw(a.time); return a.terminal.canvas.toDataURL('image/png'); }, pg);
    require('fs').writeFileSync(path.join(__dirname, 'shots', `term-${pg}.png`), Buffer.from(data.split(',')[1], 'base64'));
  }
  await page.evaluate(() => { const a = window.__threshold; a.terminal.go('arsenal'); a.time = 10; });
  await page.waitForTimeout(6000);
  await page.screenshot({ path:path.join(__dirname, 'shots', 'crt-arsenal.png') });
  console.log('errors:', errors.length ? errors.slice(0, 4) : 'none');
  await browser.close(); server.kill();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
