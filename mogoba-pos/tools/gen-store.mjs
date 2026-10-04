#!/usr/bin/env node
/* Generates order/fallback-store.js: the store snapshot the customer site uses in demo mode
 * when the register has not published one yet (no mogoba.bridge.store key on this origin).
 *
 * The menu comes from www/js/seed.js, run in a node:vm sandbox with a stub window/self, so the
 * fallback never drifts from the register's starting menu. Output follows the store snapshot
 * shape in docs/online-ordering.md. updatedAt is 0 so the file only changes when the menu does.
 *
 *   node tools/gen-store.mjs */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEED = join(ROOT, 'www', 'js', 'seed.js');
const OUT = join(ROOT, 'order', 'fallback-store.js');

/* seed.js is a classic script that writes window.M.seed. */
const sandbox = { window: {}, Date, Math };
sandbox.self = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(readFileSync(SEED, 'utf8'), sandbox, { filename: 'seed.js' });
const seed = sandbox.window.M && sandbox.window.M.seed;
if (!seed || !Array.isArray(seed.items)) throw new Error('seed.js did not define M.seed.items');

/* Add-on groups are referenced by id on items; the snapshot carries them inline. */
const groups = new Map(seed.MODS.map((g) => [g.id, g]));
const addonGroup = (gid) => {
  const g = groups.get(gid);
  if (!g) throw new Error('Unknown add-on group ' + gid);
  return { gid: g.id, name: g.name, options: g.options.map((o) => ({ id: o.id, name: o.name, price: o.price })) };
};

const cats = [...seed.CATS].sort((a, b) => a.sort - b.sort).map((c) => ({ id: c.id, name: c.name, ko: c.ko || '' }));

const items = seed.items
  .filter((it) => it.active !== false)
  .sort((a, b) => a.sort - b.sort)
  .map((it) => ({
    id: it.id,
    cat: it.cat,
    name: it.name,
    ko: it.ko || '',
    img: it.img || '',
    price: it.price,
    soldOut: false,
    badge: it.badge || '',
    /* v1.1 rule 2, same test as the register (www/js/online.js): bilao trays are paid ahead. */
    prepay: it.cat === 'bilao' || !!it.prepay,
    variantLabel: it.variants && it.variants.length ? it.variantLabel || 'Choose' : '',
    variants: (it.variants || []).map((v) => ({ id: v.id, name: v.name, price: v.price, soldOut: false })),
    addons: (it.addons || []).map(addonGroup),
  }));

/* Placeholder wallet QR, the same look as the register's sample data (www/js/demo.js):
 * QR-like but not decodable, stamped SAMPLE. The real codes come from Settings → Online ordering. */
function sampleQr(seedText, color) {
  const N = 25;
  const px = 12;
  const pad = 2 * px;
  const size = N * px + pad * 2;
  let x = 0;
  for (const ch of seedText) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => (x = (x * 1664525 + 1013904223) >>> 0) / 4294967296;
  const finder = (r, c) => (r < 8 && c < 8) || (r < 8 && c >= N - 8) || (r >= N - 8 && c < 8);
  const rects = [];
  const rect = (c, r, w, h, fill) => rects.push('<rect x="' + (pad + c * px) + '" y="' + (pad + r * px) + '" width="' + w * px + '" height="' + h * px + '" fill="' + fill + '"/>');
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (!finder(r, c) && rnd() < 0.5) rect(c, r, 1, 1, '#111');
  for (const [r, c] of [[0, 0], [0, N - 7], [N - 7, 0]]) {
    rect(c, r, 7, 7, '#111');
    rect(c + 1, r + 1, 5, 5, '#fff');
    rect(c + 2, r + 2, 3, 3, '#111');
  }
  const bw = Math.round(size * 0.62);
  const bh = Math.round(size * 0.2);
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '">' +
    '<rect width="' + size + '" height="' + size + '" fill="#fff"/>' + rects.join('') +
    '<rect x="' + (size - bw) / 2 + '" y="' + (size - bh) / 2 + '" width="' + bw + '" height="' + bh + '" fill="' + color + '"/>' +
    '<text x="' + size / 2 + '" y="' + size / 2 + '" fill="#fff" font-family="system-ui, sans-serif" font-weight="800" font-size="' + Math.round(bh * 0.5) + '" text-anchor="middle" dominant-baseline="central">SAMPLE</text></svg>';
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

const store = {
  v: 1,
  updatedAt: 0,
  name: seed.SETTINGS().business.name,
  address: seed.SETTINGS().business.address,
  phone: seed.SETTINGS().business.phone,
  accepting: true,
  pausedUntil: 0,
  hours: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: '09:00', close: '20:00' })),
  prepMinutes: 20,
  pickup: { enabled: true },
  delivery: { enabled: true, fee: 5000, minOrder: 30000, area: 'Aparri town proper' },
  /* Placeholders. With no QR the site shows GCash and Maya as "QR not set up yet". */
  payments: {
    gcash: { enabled: true, accountName: 'Mogoba Korean Food House', number: '0917 000 0000', qr: sampleQr('gcash', '#0A5BD8') },
    maya: { enabled: true, accountName: 'Mogoba Korean Food House', number: '0917 000 0000', qr: sampleQr('maya', '#0B8A4C') },
    cash: { enabled: true, maxTotal: 100000 },
  },
  cats,
  items,
};

const body =
  '/* Generated by tools/gen-store.mjs from www/js/seed.js. Do not edit by hand.\n' +
  ' * Demo mode store snapshot, used until the register publishes mogoba.bridge.store. */\n' +
  'window.MOGOBA_FALLBACK_STORE = ' +
  JSON.stringify(store, null, 1) +
  ';\n';
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, body);
console.log('order/fallback-store.js: ' + cats.length + ' categories, ' + items.length + ' items, ' + body.length + ' bytes');
