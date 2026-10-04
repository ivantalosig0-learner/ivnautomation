/* Renders the deck with Chromium.
 *   node export.cjs pdf [out.pdf]   one 16:9 page per slide; slides and lines marked data-private (prices) are left out
 *   node export.cjs presenter [out] every slide, prices included, for the presenter (and the PowerPoint)
 *   node export.cjs preview [out]   same as pdf, but only slides with no [[placeholders]] left
 *   node export.cjs shots [dir]     a 1600x900 PNG of every slide, for review
 * Serves this folder on a local port so fonts and images load exactly as on the web. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}

const ROOT = __dirname;
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const [mode = 'pdf', out] = process.argv.slice(2);

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

server.listen(0, '127.0.0.1', async () => {
  const url = 'http://127.0.0.1:' + server.address().port + '/index.html';
  const browser = await chromium.launch();
  try {
    if (mode === 'pdf' || mode === 'preview' || mode === 'presenter') {
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await page.emulateMedia({ media: 'print' });
      if (mode !== 'presenter') await page.addStyleTag({ content: '@media print { .slide[data-private], .slide [data-private] { display: none !important; } }' });
      /* preview: leave out slides that still carry [[placeholders]] */
      if (mode === 'preview') await page.evaluate(() => document.querySelectorAll('.slide').forEach((s) => s.innerHTML.includes('[[') && s.setAttribute('data-private', '')));
      const file = out || path.join(ROOT, 'Juvals-Growth-Plan.pdf');
      await page.pdf({ path: file, width: '1600px', height: '900px', printBackground: true, preferCSSPageSize: true });
      console.log('pdf', file, Math.round(fs.statSync(file).size / 1024) + ' KB');
    } else {
      const dir = out || path.join(ROOT, '.shots');
      fs.mkdirSync(dir, { recursive: true });
      const page = await browser.newPage({ viewport: { width: 1600, height: 964 } });
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      const n = await page.locator('.slide').count();
      for (let i = 1; i <= n; i++) {
        await page.evaluate((k) => (location.hash = '#' + k), i);
        await page.waitForTimeout(650);
        await page.screenshot({ path: path.join(dir, String(i).padStart(2, '0') + '.png'), clip: { x: 0, y: 0, width: 1600, height: 900 } });
      }
      const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      await phone.goto(url, { waitUntil: 'networkidle' });
      await phone.screenshot({ path: path.join(dir, 'phone.png'), fullPage: true });
      const w = await phone.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
      console.log('shots', dir, n, 'slides; phone scrollWidth', w.join(' / '));
    }
  } finally {
    await browser.close();
    server.close();
  }
});
