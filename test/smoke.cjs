const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const shots = path.join(__dirname, 'shots');
  require('fs').mkdirSync(shots, { recursive:true });
  const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport:{ width:1280, height:720 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 3000)); });
  await page.goto('file://' + path.resolve(__dirname, '../dist/threshold.html'));
  await page.waitForTimeout(4000);
  const fatal = await page.$eval('#fatal', e => e.hidden ? null : e.textContent);
  console.log('fatal:', fatal ? fatal.slice(0, 2000) : 'none');
  await page.screenshot({ path:path.join(shots, 'menu.png') });
  console.log('errors:', errors.length ? errors.slice(0, 5) : 'none');
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
