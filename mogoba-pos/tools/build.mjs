#!/usr/bin/env node
/* Build:
 *   1. www/sw.js: offline cache list + content-hash version (hosted PWA)
 *   2. dist/mogoba-pos.html: the whole app in ONE file (fonts, photos, logo inlined).
 *      Opens from a phone's Files app, a laptop or a USB stick with no server and no internet.
 * The Android build (Capacitor) packages www/ as-is. */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WWW = join(ROOT, 'www');
const DIST = join(ROOT, 'dist');

/* 0. copy lint: em and en dashes read as machine-written, so the build refuses them. */
const LINT = ['www', 'order', 'server', 'docs', 'README.md'];
const lintHits = [];
const lintWalk = (p) => {
  let st;
  try {
    st = statSync(p);
  } catch (e) {
    return;
  }
  if (st.isDirectory()) {
    if (/node_modules|data$/.test(p)) return;
    for (const f of readdirSync(p)) lintWalk(join(p, f));
  } else if (/\.(js|mjs|css|html|md|json)$/.test(p)) {
    readFileSync(p, 'utf8')
      .split('\n')
      .forEach((l, i) => {
        if (/[\u2013\u2014]/.test(l)) lintHits.push(relative(ROOT, p) + ':' + (i + 1));
      });
  }
};
for (const p of LINT) lintWalk(join(ROOT, p));
if (lintHits.length) {
  console.error('Copy lint: remove em/en dashes at\n  ' + lintHits.join('\n  '));
  process.exit(1);
}

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const files = walk(WWW)
  .map((f) => relative(WWW, f).split('\\').join('/'))
  .filter((f) => f !== 'sw.js')
  .sort();

/* 1. service worker */
const hash = createHash('sha256');
for (const f of files) hash.update(f).update(readFileSync(join(WWW, f)));
const version = 'mogoba-pos-' + hash.digest('hex').slice(0, 10);
const sw = readFileSync(join(WWW, 'sw.js'), 'utf8')
  .replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`)
  .replace(/const FILES = \[[\s\S]*?\];/, 'const FILES = ' + JSON.stringify(files, null, 2) + ';');
writeFileSync(join(WWW, 'sw.js'), sw);

/* 2. single file */
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const dataUri = (rel) => 'data:' + MIME[extname(rel)] + ';base64,' + readFileSync(join(WWW, rel)).toString('base64');

let html = readFileSync(join(WWW, 'index.html'), 'utf8');
let css = readFileSync(join(WWW, 'css/app.css'), 'utf8').replace(/url\(\.\.\/(assets\/fonts\/[^)]+)\)/g, (_, p) => 'url(' + dataUri(p) + ')');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
const assets = {};
for (const f of files) if (f.startsWith('assets/food/') || f === 'assets/logo.png') assets[f.slice('assets/'.length)] = dataUri(f);
const js = scripts.map((s) => '/* ' + s + ' */\n' + readFileSync(join(WWW, s), 'utf8').replace(/<\/script/gi, '<\\/script')).join('\n');

html = html
  .replace(/<link rel="manifest"[^>]*>\n/, '')
  .replace(/<link rel="preload"[^>]*>\n/g, '')
  .replace(/<link rel="(icon|apple-touch-icon)"[^>]*>\n/g, '')
  .replace('<link rel="stylesheet" href="css/app.css">', () => '<link rel="icon" type="image/png" href="' + dataUri('assets/icons/icon-192.png') + '">\n<style>\n' + css + '\n</style>')
  .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
  .replace(/<!-- build:scripts -->[\s\S]*<!-- \/build:scripts -->/, () => '<script>\nwindow.M = { ASSETS: ' + JSON.stringify(assets) + ' };\n</script>\n<script>\n' + js + '\n</script>');

mkdirSync(DIST, { recursive: true });
writeFileSync(join(DIST, 'mogoba-pos.html'), html);

/* 3. web preview (claude.ai artifact): the host adds the document skeleton, so ship only the
 * title, styles and body content. ENV 'preview' turns print and file downloads into a
 * clear message, because that viewer cannot open the print dialog or save files. */
const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
const style = html.match(/<style>[\s\S]*?<\/style>/)[0];
const body = html
  .match(/<body>([\s\S]*)<\/body>/)[1]
  .replace('window.M = { ASSETS: ', "window.M = { ENV: 'preview', ASSETS: ");
const preview = title + '\n' + style + '\n' + body.trim() + '\n';
mkdirSync(join(DIST, 'web'), { recursive: true });
writeFileSync(join(DIST, 'web', 'mogoba-pos.html'), preview);
const kb = (n) => (n / 1024).toFixed(0) + ' KB';
const appBytes = files.reduce((t, f) => t + statSync(join(WWW, f)).size, 0);
console.log('sw.js       ', version, '·', files.length, 'files ·', kb(appBytes));
console.log('single file  dist/mogoba-pos.html ·', kb(Buffer.byteLength(html)));
console.log('web preview  dist/web/mogoba-pos.html ·', kb(Buffer.byteLength(preview)));
