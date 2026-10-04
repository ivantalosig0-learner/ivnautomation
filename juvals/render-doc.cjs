/* Markdown to a readable PDF (and HTML) in the deck's type: node render-doc.cjs REVIEWER.md
 * Writes REVIEWER.pdf and REVIEWER.html next to the source. A5-ish pages so it reads well on a
 * phone and prints on short bond paper. Needs `marked` (set MARKED to its folder if it is not
 * installed here) and Playwright with Chromium. */
'use strict';
const fs = require('fs');
const path = require('path');
const { marked } = require(process.env.MARKED || 'marked');
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}

const src = path.resolve(process.argv[2]);
const base = src.replace(/\.md$/, '');
const md = fs.readFileSync(src, 'utf8');
const title = (md.match(/^#\s+(.+)$/m) || [, path.basename(base)])[1];
const fonts = path.join(__dirname, 'pitch', 'fonts', 'fonts.css');

const css = `
@import url("file://${fonts}");
:root { --ink: #1B1612; --muted: #5E544B; --line: #E2D8CA; --paper: #FFFDF9; --red: #B3141C; --gold: #8A6A2F; --tint: #F6EFE3; }
* { box-sizing: border-box; }
html { background: var(--paper); }
body { margin: 0 auto; max-width: 46rem; padding: 28px 22px 48px; color: var(--ink); font: 15.5px/1.55 Figtree, system-ui, sans-serif; background: var(--paper); }
h1, h2, h3 { font-family: "Zilla Slab", Georgia, serif; line-height: 1.12; text-wrap: balance; }
h1 { font-size: 2.1rem; margin: 0 0 .3rem; }
h2 { font-size: 1.45rem; margin: 2.1rem 0 .6rem; padding-top: .9rem; border-top: 2px solid var(--line); break-after: avoid; }
h3 { font-size: 1.12rem; margin: 1.4rem 0 .4rem; color: var(--red); break-after: avoid; }
p, li { text-wrap: pretty; }
ul, ol { padding-left: 1.3rem; }
li { margin: .25rem 0; }
strong { font-weight: 700; }
em { color: var(--muted); }
a { color: var(--red); word-break: break-word; }
blockquote { margin: .8rem 0; padding: .7rem 1rem; background: var(--tint); border-radius: 10px; border: 1px solid var(--line); }
blockquote p { margin: .2rem 0; }
code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: .88em; background: var(--tint); padding: .05em .35em; border-radius: 4px; }
table { width: 100%; border-collapse: collapse; margin: .8rem 0; font-size: .92em; break-inside: auto; }
th, td { text-align: left; vertical-align: top; padding: .45rem .5rem; border-bottom: 1px solid var(--line); }
th { font-size: .78em; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
tr { break-inside: avoid; }
hr { border: 0; border-top: 1px solid var(--line); margin: 1.6rem 0; }
.cover-sub { color: var(--muted); margin: 0 0 1.4rem; }
@page { size: 148mm 210mm; margin: 12mm 11mm 14mm; }
@media print { body { padding: 0; max-width: none; font-size: 10.5pt; } h2 { break-before: auto; } }
`;

const body = marked.parse(md);
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title.replace(/</g, '&lt;')}</title><style>${css}</style></head><body>${body}</body></html>`;
fs.writeFileSync(base + '.html', html.replace(`file://${fonts}`, path.relative(path.dirname(base), fonts)));

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto('file://' + base + '.html', { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({
      path: base + '.pdf',
      preferCSSPageSize: true,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: '<div style="width:100%;font:8px Figtree,sans-serif;color:#8a7f73;text-align:center"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    });
    console.log('pdf', base + '.pdf', Math.round(fs.statSync(base + '.pdf').size / 1024) + ' KB');
  } finally {
    await browser.close();
  }
})();
