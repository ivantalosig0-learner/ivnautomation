/* Layout check for the deck: node qa.cjs
 * For every slide, at three screen sizes and in the 1600x900 print layout, it measures each
 * piece of text (HTML and SVG) and reports:
 *   - text that leaves the slide,
 *   - text clipped by its own box (content wider or taller than the box),
 *   - two pieces of text that overlap each other,
 *   - leftover [[placeholders]] and em or en dashes.
 * Exit code 1 when anything is found. */
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
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

/* Runs in the page: returns problems for the slide element passed in. */
function inspect(slide) {
  const out = [];
  const sr = slide.getBoundingClientRect();
  const label = (el) => {
    const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
    return el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '') + ' "' + t.slice(0, 40) + '"';
  };
  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    let p = el;
    while (p && p !== slide) {
      const c = getComputedStyle(p);
      if (c.display === 'none' || c.visibility === 'hidden') return false;
      p = p.parentElement;
    }
    return true;
  };
  /* leaf text boxes: elements with their own non-empty text node */
  const boxes = [];
  const walker = document.createTreeWalker(slide, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (!n.textContent.trim()) continue;
    const el = n.parentElement;
    if (!el || seen.has(el) || el.closest('.notes') || !visible(el)) continue;
    seen.add(el);
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 1 && r.height > 1);
    if (!rects.length) continue;
    boxes.push({ el, rects });
  }
  for (const b of boxes) {
    for (const r of b.rects) {
      if (r.left < sr.left - 1 || r.right > sr.right + 1 || r.top < sr.top - 1 || r.bottom > sr.bottom + 1) {
        out.push('off slide: ' + label(b.el));
        break;
      }
    }
    /* clipped by an ancestor with overflow hidden (but not the slide itself) */
    let a = b.el;
    while (a && a !== slide) {
      const cs = getComputedStyle(a);
      if ((cs.overflow === 'hidden' || cs.overflowX === 'hidden' || cs.overflowY === 'hidden') && a !== slide && !a.matches('.screen, .bleed, .mosaic figure, .browser, .phone, .tablet')) {
        const ar = a.getBoundingClientRect();
        if (b.rects.some((r) => r.right > ar.right + 1 || r.bottom > ar.bottom + 1 || r.left < ar.left - 1)) out.push('clipped: ' + label(b.el));
        break;
      }
      a = a.parentElement;
    }
    /* clipped inside device screens: text that runs past the screen edge */
    const scr = b.el.closest('.screen');
    if (scr) {
      const r0 = scr.getBoundingClientRect();
      if (b.rects.some((r) => r.right > r0.right + 1 || r.bottom > r0.bottom + 1)) out.push('cut by device screen: ' + label(b.el));
    }
  }
  /* text running into a card or mockup it does not belong to */
  const blocks = Array.from(slide.querySelectorAll('.card, .tier, .browser, .phone, .tablet, .nfc-card, .stand, .mosaic figure, .asphalt')).filter(visible);
  for (const b of boxes) {
    for (const blk of blocks) {
      if (blk.contains(b.el)) continue;
      const br = blk.getBoundingClientRect();
      if (b.rects.some((r) => Math.min(r.right, br.right) - Math.max(r.left, br.left) > 2 && Math.min(r.bottom, br.bottom) - Math.max(r.top, br.top) > 2)) out.push('text over ' + label(blk).split(' ')[0] + ': ' + label(b.el));
    }
  }
  /* cards, devices and text keep a margin from the slide edges (3% of the height) */
  const m = sr.height * 0.03;
  const near = (r) => r.bottom > sr.bottom - m || r.right > sr.right - m || r.top < sr.top + m / 2 || r.left < sr.left + m / 2;
  for (const B of blocks) if (near(B.getBoundingClientRect())) out.push('touches slide edge: ' + label(B).split(' ')[0]);
  for (const b of boxes) if (b.rects.some(near)) out.push('text at slide edge: ' + label(b.el));
  /* boxes overlapping each other (cards, devices) unless one holds the other */
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const A = blocks[i], B = blocks[j];
      if (A.contains(B) || B.contains(A)) continue;
      const a = A.getBoundingClientRect(), c = B.getBoundingClientRect();
      if (Math.min(a.right, c.right) - Math.max(a.left, c.left) > 2 && Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top) > 2) out.push('boxes overlap: ' + label(A).split(' ')[0] + ' x ' + label(B).split(' ')[0]);
    }
  }
  /* text over text */
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const A = boxes[i], B = boxes[j];
      if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
      let hit = false;
      for (const r of A.rects) {
        for (const q of B.rects) {
          const w = Math.min(r.right, q.right) - Math.max(r.left, q.left);
          const h = Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top);
          if (w > 2 && h > 2) hit = true;
        }
      }
      if (hit) out.push('overlap: ' + label(A.el) + ' x ' + label(B.el));
    }
  }
  const html = slide.innerHTML;
  if (html.includes('[[')) out.push('placeholder left: ' + (html.match(/\[\[[A-Z0-9_]+\]\]/) || [''])[0]);
  const text = slide.innerText;
  if (/[–—]/.test(text)) out.push('em or en dash in text');
  return out;
}

server.listen(0, '127.0.0.1', async () => {
  const url = 'http://127.0.0.1:' + server.address().port + '/index.html';
  const browser = await chromium.launch();
  let problems = 0;
  try {
    const sizes = [[1600, 964], [1280, 784], [1920, 1144]];
    for (const [w, hgt] of sizes) {
      const page = await browser.newPage({ viewport: { width: w, height: hgt } });
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate((src) => (window.__inspect = src), inspect.toString());
      const n = await page.locator('.slide').count();
      for (let i = 1; i <= n; i++) {
        await page.evaluate((k) => (location.hash = '#' + k), i);
        await page.waitForTimeout(520);
        const res = await page.evaluate((k) => (0, eval)('(' + window.__inspect + ')')(document.querySelectorAll('.slide')[k - 1]), i);
        for (const p of res) {
          problems++;
          console.log(w + 'x' + hgt + ' slide ' + i + ': ' + p);
        }
      }
      await page.close();
    }
    /* print layout, as in the PDF */
    const pp = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    await pp.goto(url, { waitUntil: 'networkidle' });
    await pp.emulateMedia({ media: 'print' });
    await pp.evaluate(() => document.fonts.ready);
    await pp.evaluate((src) => (window.__inspect = src), inspect.toString());
    const n = await pp.locator('.slide').count();
    for (let i = 1; i <= n; i++) {
      const res = await pp.evaluate((k) => (0, eval)('(' + window.__inspect + ')')(document.querySelectorAll('.slide')[k - 1]), i);
      for (const p of res) {
        problems++;
        console.log('print slide ' + i + ': ' + p);
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(problems ? problems + ' problem(s)' : 'No layout problems found');
  process.exit(problems ? 1 : 0);
});
