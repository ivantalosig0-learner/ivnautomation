/* PowerPoint version of the deck: node pptx.cjs [out.pptx]
 * Each slide is the exact render of the HTML deck (so nothing can shift or overlap in
 * PowerPoint), with the speaker notes from the deck in PowerPoint's notes and one section per
 * chapter. Needs pptxgenjs (set PPTXGEN to its folder if it is not installed here), Playwright
 * and pdftoppm. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const pptxgen = require(process.env.PPTXGEN || 'pptxgenjs');

const ROOT = __dirname;
const out = process.argv[2] || path.join(ROOT, "Juvals-Growth-Plan.pptx");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'juvals-pptx-'));

/* 1. every slide as a page, prices included: this copy is for the presenter */
execFileSync(process.execPath, [path.join(ROOT, 'export.cjs'), 'presenter', path.join(tmp, 'all.pdf')], { stdio: 'inherit' });
execFileSync('pdftoppm', ['-jpeg', '-jpegopt', 'quality=90', '-r', '144', path.join(tmp, 'all.pdf'), path.join(tmp, 's')]);
const pngs = fs.readdirSync(tmp).filter((f) => /^s-\d+\.jpg$/.test(f)).sort((a, b) => parseInt(a.slice(2), 10) - parseInt(b.slice(2), 10));

/* 2. titles, chapters and notes from the deck source */
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const slides = [...html.matchAll(/<section class="slide"([^>]*)>([\s\S]*?)<\/section>/g)].map((m) => {
  const attr = (k) => ((m[1].match(new RegExp(k + '="([^"]*)"')) || [])[1] || '');
  const notes = ((m[2].match(/<aside class="notes">([\s\S]*?)<\/aside>/) || [])[1] || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const head = ((m[2].match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/) || [])[1] || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  return { title: attr('data-title'), chapter: attr('data-chapter'), head, notes };
});
if (slides.length !== pngs.length) throw new Error('Slide count mismatch: ' + slides.length + ' in the deck, ' + pngs.length + ' rendered');

/* 3. the deck */
const pres = new pptxgen();
pres.layout = 'LAYOUT_16x9';
pres.title = "Juval's Growth Plan";
pres.author = 'IVNautomation';
pres.company = 'IVNautomation';
let chapter = '';
slides.forEach((s, i) => {
  if (s.chapter !== chapter) {
    chapter = s.chapter;
    pres.addSection({ title: chapter });
  }
  const slide = pres.addSlide({ sectionTitle: chapter });
  slide.background = { color: '15110E' };
  slide.addImage({ path: path.join(tmp, pngs[i]), x: 0, y: 0, w: 10, h: 5.625, altText: s.head || s.title });
  if (s.notes) slide.addNotes(s.notes);
});

pres.writeFile({ fileName: out }).then(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('pptx', out, slides.length, 'slides', Math.round(fs.statSync(out).size / 1024) + ' KB');
});
