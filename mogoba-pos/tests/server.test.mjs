/* Mogoba online ordering server: end-to-end tests over real HTTP.
 * Each run starts server/server.mjs as a child process on a free port with a temp DATA_DIR,
 * behind BASE_PATH=/mogoba, exactly as it runs in production.
 *
 *   node --test tests/server.test.mjs */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { connect } from 'node:net';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { openAt, manila, normalizePhone } from '../server/lib/rules.mjs';
import { createApp, loadConfig, ipKey } from '../server/server.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = join(ROOT, 'server', 'server.mjs');
const KEY = 'test-pos-key-0123456789abcdef';
const BASE = '/mogoba';

let dataDir;
let srv;

/* Start the server and resolve once it prints its listening line (PORT=0 picks a free port). */
function start(env) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [SERVER], {
      env: Object.assign({ PATH: process.env.PATH, HOST: '127.0.0.1', PORT: '0' }, env),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => {
      out += d;
      const m = /listening on http:\/\/[^:]+:(\d+)/.exec(out);
      if (m && !proc.port) {
        proc.port = Number(m[1]);
        resolve(proc);
      }
    });
    proc.stderrText = '';
    proc.stderr.on('data', (d) => {
      err += d;
      proc.stderrText = err;
    });
    proc.on('exit', (code) => {
      proc.exitCode_ = code;
      proc.stderrText = err;
      if (!proc.port) reject(Object.assign(new Error('server exited ' + code + ': ' + err), { code, stderr: err }));
    });
  });
}

function stop(proc) {
  return new Promise((resolve) => {
    if (proc.exitCode !== null) return resolve();
    proc.once('exit', resolve);
    proc.kill('SIGTERM');
  });
}

const env = () => ({ POS_KEY: KEY, DATA_DIR: dataDir, BASE_PATH: BASE, TRUST_PROXY: '1' });

/* Each call comes from its own client IP unless one is given, so the per-IP rate limit
 * only bites in the test that is about it. */
let ipSeq = 1;
async function call(method, path, body, opts = {}) {
  const headers = { 'X-Forwarded-For': opts.ip || '10.0.' + Math.floor(ipSeq / 250) + '.' + (ipSeq++ % 250) };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.auth) headers.Authorization = 'Bearer ' + (opts.auth === true ? KEY : opts.auth);
  const port = (opts.srv || srv).port;
  const res = await fetch('http://127.0.0.1:' + port + BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, json, headers: res.headers, text };
}

/* Raw request so the test sees exactly what went over the wire (no automatic gunzip). */
function raw(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: srv.port, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

const ALL_DAY = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: '00:00', close: '24:00' }));

function storeSnapshot(over = {}) {
  return Object.assign(
    {
      v: 1,
      updatedAt: Date.now(),
      name: 'Mogoba Korean Food House',
      address: 'Rizal St, Aparri, Cagayan',
      phone: '0936 575 7278',
      accepting: true,
      hours: ALL_DAY,
      prepMinutes: 20,
      pickup: { enabled: true },
      delivery: { enabled: true, fee: 5000, minOrder: 30000, area: 'Aparri town proper' },
      payments: {
        gcash: { enabled: true, accountName: 'A. M.', number: '0936 *** 7278', qr: '' },
        maya: { enabled: true, accountName: 'A. M.', number: '', qr: '' },
        cash: { enabled: true },
      },
      cats: [{ id: 'dosirak', name: 'Dosirak', ko: '도시락' }],
      items: [
        {
          id: 'chicken-dosirak', cat: 'dosirak', name: 'Chicken Dosirak', ko: '치킨 도시락', img: 'honeybutter', price: 12000, soldOut: false, badge: '',
          variantLabel: 'Flavour',
          variants: [
            { id: 'honey', name: 'Honey Butter', price: 12000, soldOut: false },
            { id: 'spicy', name: 'Spicy', price: 13000, soldOut: true },
          ],
          addons: [{ gid: 'addon', name: 'Add-ons', options: [{ id: 'mozz', name: 'Mozzarella cheese', price: 2000 }] }],
        },
        { id: 'pork-dosirak', cat: 'dosirak', name: 'Pork Dosirak', img: 'dosirak', price: 12000, soldOut: false, variants: null, addons: [] },
        { id: 'gimbap', cat: 'dosirak', name: 'Gimbap', img: 'gimbap', price: 13000, soldOut: true, variants: null, addons: [] },
      ],
    },
    over,
  );
}

let phoneSeq = 1000000;
const newPhone = () => '0917' + phoneSeq++;
let refSeq = 100000000;
const newRef = () => String(refSeq++);

function orderBody(over = {}) {
  return Object.assign(
    {
      clientId: 'c-' + Math.random().toString(36).slice(2) + Date.now(),
      items: [{ itemId: 'chicken-dosirak', variantId: 'honey', mods: [{ gid: 'addon', oid: 'mozz' }], qty: 2, note: 'Extra spicy' }],
      customer: { name: 'Juan Dela Cruz', phone: newPhone() },
      fulfillment: { type: 'pickup', time: 'asap', address: '', landmark: '' },
      payment: { method: 'gcash', ref: newRef(), sender: 'Juan D.' },
      note: '',
    },
    over,
  );
}

const publish = (over, s) => call('PUT', '/api/pos/store', storeSnapshot(over), { auth: true, srv: s });
/* The register's poll. It is also the v1.1 heartbeat: without one in the last 5 minutes the
 * server refuses new orders. */
const poll = (since, s) => call('GET', '/api/pos/orders?since=' + since, undefined, { auth: true, srv: s });

/* A second server on its own data dir, for tests that need a fresh state or other settings. */
async function withServer(over, fn) {
  const dir = await mkdtemp(join(tmpdir(), 'mogoba-server-'));
  const s = await start(Object.assign(env(), { DATA_DIR: dir }, over));
  try {
    await fn(s, dir);
  } finally {
    await stop(s);
    await rm(dir, { recursive: true, force: true });
  }
}

/* A minimal PNG: the signature is what the server checks. */
const PNG = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('0000000d49484452', 'hex'), Buffer.alloc(32, 1)]).toString('base64');

before(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'mogoba-server-'));
  srv = await start(env());
  await poll(Date.now());
});

after(async () => {
  if (srv) await stop(srv);
  await rm(dataDir, { recursive: true, force: true });
});

test('refuses to start without a POS_KEY, or with a short one', async () => {
  for (const key of [undefined, 'too-short']) {
    const e = Object.assign({}, env(), { POS_KEY: key });
    if (key === undefined) delete e.POS_KEY;
    await assert.rejects(start(e), (err) => {
      assert.equal(err.code, 1);
      assert.match(err.stderr, /POS_KEY/);
      return true;
    });
  }
});

test('store is not published until the register sends it', async () => {
  const r = await call('GET', '/api/store');
  assert.equal(r.status, 404);
  assert.ok(r.json.error);
});

test('publishing the store requires the register key', async () => {
  assert.equal((await call('PUT', '/api/pos/store', storeSnapshot())).status, 401);
  assert.equal((await call('PUT', '/api/pos/store', storeSnapshot(), { auth: 'wrong-key-wrong-key-wrong-key' })).status, 401);
  const bad = await call('PUT', '/api/pos/store', storeSnapshot({ items: [{ id: 'x', name: 'X', price: 12.5 }] }), { auth: true });
  assert.equal(bad.status, 400);
  const ok = await publish();
  assert.equal(ok.status, 200);
  const s = await call('GET', '/api/store');
  assert.equal(s.status, 200);
  assert.equal(s.json.name, 'Mogoba Korean Food House');
  assert.equal(s.json.items.length, 3);
});

test('places a valid order with server-side prices', async () => {
  const r = await call('POST', '/api/orders', orderBody());
  assert.equal(r.status, 201, r.text);
  assert.match(r.json.code, /^MGB-\d{4}$/);
  assert.match(r.json.token, /^[0-9a-f]{32}$/);
  const o = r.json.order;
  assert.equal(o.status, 'pending');
  assert.equal(o.lines[0].unit, 14000);
  assert.equal(o.lines[0].name, 'Chicken Dosirak');
  assert.equal(o.lines[0].variantName, 'Honey Butter');
  assert.deepEqual(o.lines[0].mods, [{ gid: 'addon', oid: 'mozz', name: 'Mozzarella cheese', price: 2000 }]);
  assert.equal(o.subtotal, 28000);
  assert.equal(o.deliveryFee, 0);
  assert.equal(o.total, 28000);
  assert.equal(o.timeline.length, 1);
  assert.equal(o.timeline[0].by, 'customer');
  assert.equal(o.token, undefined);
  assert.equal(o.clientId, undefined);
  assert.equal(o.payment.proof, undefined);
});

test('ignores prices sent by the client', async () => {
  const body = orderBody({ subtotal: 1, total: 1 });
  body.items = [{ itemId: 'pork-dosirak', qty: 3, unit: 1, price: 1, name: 'Free food', mods: [] }];
  const r = await call('POST', '/api/orders', body);
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.order.lines[0].unit, 12000);
  assert.equal(r.json.order.lines[0].name, 'Pork Dosirak');
  assert.equal(r.json.order.total, 36000);
});

test('rejects sold-out and unknown items', async () => {
  let r = await call('POST', '/api/orders', orderBody({ items: [{ itemId: 'gimbap', qty: 1 }] }));
  assert.equal(r.status, 400);
  assert.equal(r.json.field, 'items.0.itemId');
  assert.match(r.json.error, /sold out/);
  r = await call('POST', '/api/orders', orderBody({ items: [{ itemId: 'chicken-dosirak', variantId: 'spicy', qty: 1 }] }));
  assert.equal(r.status, 400);
  assert.equal(r.json.field, 'items.0.variantId');
  r = await call('POST', '/api/orders', orderBody({ items: [{ itemId: 'nope', qty: 1 }] }));
  assert.equal(r.status, 400);
  assert.equal(r.json.field, 'items.0.itemId');
  r = await call('POST', '/api/orders', orderBody({ items: [{ itemId: 'pork-dosirak', qty: 51 }] }));
  assert.equal(r.status, 400);
  assert.equal(r.json.field, 'items.0.qty');
  r = await call('POST', '/api/orders', orderBody({ items: Array.from({ length: 31 }, () => ({ itemId: 'pork-dosirak', qty: 1 })) }));
  assert.equal(r.status, 400);
  assert.equal(r.json.field, 'items');
});

test('refuses orders with 423 while the store is closed', async () => {
  try {
    await publish({ accepting: false });
    let r = await call('POST', '/api/orders', orderBody());
    assert.equal(r.status, 423);
    assert.ok(r.json.error);
    await publish({ hours: [] });
    r = await call('POST', '/api/orders', orderBody());
    assert.equal(r.status, 423);
  } finally {
    await publish();
  }
});

test('validates and normalizes the phone number', async () => {
  let r = await call('POST', '/api/orders', orderBody({ customer: { name: 'Juan', phone: '12345' } }));
  assert.equal(r.status, 400);
  assert.equal(r.json.field, 'customer.phone');
  r = await call('POST', '/api/orders', orderBody({ customer: { name: 'J', phone: newPhone() } }));
  assert.equal(r.status, 400);
  assert.equal(r.json.field, 'customer.name');
  r = await call('POST', '/api/orders', orderBody({ customer: { name: 'Ana Santos', phone: '+63 918 555 0101' } }));
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.order.customer.phone, '09185550101');
});

test('delivery needs an address and the minimum order, and adds the fee', async () => {
  const delivery = { type: 'delivery', time: 'asap', address: 'Rizal St, Aparri', landmark: 'Near the plaza' };
  let r = await call('POST', '/api/orders', orderBody({ items: [{ itemId: 'pork-dosirak', qty: 1 }], fulfillment: delivery }));
  assert.equal(r.status, 400);
  assert.equal(r.json.field, 'fulfillment.type');
  assert.match(r.json.error, /minimum order of ₱300\.00/);
  r = await call('POST', '/api/orders', orderBody({ items: [{ itemId: 'pork-dosirak', qty: 3 }], fulfillment: Object.assign({}, delivery, { address: 'abc' }) }));
  assert.equal(r.status, 400);
  assert.equal(r.json.field, 'fulfillment.address');
  r = await call('POST', '/api/orders', orderBody({ items: [{ itemId: 'pork-dosirak', qty: 3 }], fulfillment: delivery }));
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.order.deliveryFee, 5000);
  assert.equal(r.json.order.total, 41000);
});

test('scheduled time must be later today', async () => {
  const r = await call('POST', '/api/orders', orderBody({ fulfillment: { type: 'pickup', time: Date.now() - 3600000 } }));
  assert.equal(r.status, 400);
  assert.equal(r.json.field, 'fulfillment.time');
});

test('scheduled time later today inside hours is accepted', async (t) => {
  const when = Date.now() + 5 * 60000;
  if (manila(when).date !== manila(Date.now()).date) return t.skip('too close to midnight in Manila');
  const r = await call('POST', '/api/orders', orderBody({ fulfillment: { type: 'pickup', time: when } }));
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.order.fulfillment.time, when);
});

test('store hours are read in Asia/Manila, including rows past midnight', () => {
  /* 2026-10-04 is a Sunday. 01:00 UTC is 09:00 in Manila. */
  const sun = [{ day: 0, open: '09:00', close: '20:00' }];
  assert.equal(openAt(sun, Date.parse('2026-10-04T01:00:00Z')), true);
  assert.equal(openAt(sun, Date.parse('2026-10-04T00:59:00Z')), false);
  assert.equal(openAt(sun, Date.parse('2026-10-04T12:00:00Z')), false);
  /* Saturday 18:00 to 02:00 still covers 01:30 on Sunday morning. */
  const late = [{ day: 6, open: '18:00', close: '02:00' }];
  assert.equal(openAt(late, Date.parse('2026-10-03T17:30:00Z')), true);
  assert.equal(openAt(late, Date.parse('2026-10-03T18:30:00Z')), false);
  assert.equal(normalizePhone('0917-123-4567'), '09171234567');
  assert.equal(normalizePhone('+63 917 123 4567'), '09171234567');
  assert.equal(normalizePhone('+1 917 123 4567'), null);
});

test('payment reference must be 6 to 20 letters or digits and method enabled', async () => {
  let r = await call('POST', '/api/orders', orderBody({ payment: { method: 'gcash', ref: '12a45' } }));
  assert.equal(r.status, 400);
  assert.equal(r.json.field, 'payment.ref');
  r = await call('POST', '/api/orders', orderBody({ payment: { method: 'card' } }));
  assert.equal(r.status, 400);
  assert.equal(r.json.field, 'payment.method');
  r = await call('POST', '/api/orders', orderBody({ payment: { method: 'gcash', ref: '1234 5678 9012' } }));
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.order.payment.ref, '123456789012');
  r = await call('POST', '/api/orders', orderBody({ payment: { method: 'cash' } }));
  assert.equal(r.status, 201, r.text);
});

test('v1.1: references drop spaces and dashes, upper-case, and allow letters', async () => {
  let r = await call('POST', '/api/orders', orderBody({ payment: { method: 'maya', ref: 'a1b2c3d4e5f6' } }));
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.order.payment.ref, 'A1B2C3D4E5F6');
  r = await call('POST', '/api/orders', orderBody({ payment: { method: 'maya', ref: 'A1B2-C3D4-E5F6' } }));
  assert.equal(r.status, 409);
  r = await call('POST', '/api/orders', orderBody({ payment: { method: 'gcash', ref: '1012-345-678901' } }));
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.order.payment.ref, '1012345678901');
  r = await call('POST', '/api/orders', orderBody({ payment: { method: 'gcash', ref: '01012345678901' } }));
  assert.equal(r.status, 409, 'a leading zero is the same reference');
  r = await call('POST', '/api/orders', orderBody({ payment: { method: 'gcash', ref: 'ABC/12345' } }));
  assert.equal(r.status, 400);
  assert.equal(r.json.field, 'payment.ref');
});

test('v1.1: a reference is used forever, even after the first order is rejected', async () => {
  const ref = newRef();
  const first = await call('POST', '/api/orders', orderBody({ payment: { method: 'maya', ref } }));
  assert.equal(first.status, 201, first.text);
  const dup = await call('POST', '/api/orders', orderBody({ payment: { method: 'maya', ref } }));
  assert.equal(dup.status, 409);
  assert.equal(dup.json.field, 'payment.ref');
  assert.equal(dup.json.error, 'This reference number was already used. Call the shop if this is a mistake.');
  /* the same digits with the other method are a different payment */
  const other = await call('POST', '/api/orders', orderBody({ payment: { method: 'gcash', ref } }));
  assert.equal(other.status, 201, other.text);
  const rej = await call('POST', '/api/pos/orders/' + first.json.code + '/status', { status: 'rejected', reason: 'Payment not found' }, { auth: true });
  assert.equal(rej.status, 200, rej.text);
  const again = await call('POST', '/api/orders', orderBody({ payment: { method: 'maya', ref } }));
  assert.equal(again.status, 409, again.text);
});

test('v1.1: references from archived orders stay used', async () => {
  await withServer({}, async (s, dir) => {
    await stop(s);
    await mkdir(join(dir, 'archive'), { recursive: true });
    const old = { code: 'MGB-1111', status: 'completed', createdAt: 1, updatedAt: 1, payment: { method: 'gcash', ref: '5550001112223' } };
    await writeFile(join(dir, 'archive', 'orders-2026-01.jsonl'), JSON.stringify(old) + '\n');
    const s2 = await start(Object.assign(env(), { DATA_DIR: dir }));
    try {
      await publish(undefined, s2);
      await poll(Date.now(), s2);
      const r = await call('POST', '/api/orders', orderBody({ payment: { method: 'gcash', ref: '0555-0001-112223' } }), { srv: s2 });
      assert.equal(r.status, 409, r.text);
    } finally {
      await stop(s2);
    }
  });
});

test('the same clientId returns the existing order', async () => {
  const body = orderBody();
  const a = await call('POST', '/api/orders', body);
  const b = await call('POST', '/api/orders', body);
  assert.equal(a.status, 201);
  assert.equal(b.status, 200);
  assert.equal(b.json.code, a.json.code);
  assert.equal(b.json.token, a.json.token);
});

test('tracking needs the token', async () => {
  const placed = await call('POST', '/api/orders', orderBody());
  const { code, token } = placed.json;
  assert.equal((await call('GET', '/api/orders/' + code)).status, 404);
  assert.equal((await call('GET', '/api/orders/' + code + '?t=' + 'f'.repeat(32))).status, 404);
  assert.equal((await call('GET', '/api/orders/MGB-0000?t=' + token)).status, 404);
  const r = await call('GET', '/api/orders/' + code + '?t=' + token);
  assert.equal(r.status, 200);
  assert.equal(r.json.code, code);
  assert.equal(r.json.token, undefined);
  assert.equal(r.json.clientId, undefined);
  assert.equal(r.json.payment.proof, undefined);
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('register sees the order with the proof as a data URL; the public never does', async () => {
  const bad = await call('POST', '/api/orders', orderBody({ payment: { method: 'gcash', ref: newRef(), proof: 'data:image/png;base64,/9j/4AAQSkZJRgABAQ==' } }));
  assert.equal(bad.status, 400);
  assert.equal(bad.json.field, 'payment.proof');

  const since = Date.now() - 1;
  const placed = await call('POST', '/api/orders', orderBody({ payment: { method: 'gcash', ref: newRef(), sender: 'Juan D.', proof: PNG } }));
  assert.equal(placed.status, 201, placed.text);
  assert.equal(placed.json.order.payment.proof, undefined);
  assert.equal((await call('GET', '/api/pos/orders?since=0')).status, 401);
  const r = await call('GET', '/api/pos/orders?since=' + since, undefined, { auth: true });
  assert.equal(r.status, 200);
  assert.ok(r.json.now >= since);
  const o = r.json.orders.find((x) => x.code === placed.json.code);
  assert.ok(o, 'order listed for the register');
  assert.equal(o.payment.proof, PNG);
  const sha = createHash('sha256').update(Buffer.from(PNG.split(',')[1], 'base64')).digest('hex');
  assert.equal(o.payment.proofSha, sha, 'v1.1 fingerprint');
  assert.equal(placed.json.order.payment.proofSha, sha);
  assert.equal(o.token, placed.json.token);
  assert.equal(o.proofFile, undefined);
  const pub = await call('GET', '/api/orders/' + placed.json.code + '?t=' + placed.json.token);
  assert.equal(pub.json.payment.proof, undefined);
  assert.doesNotMatch(pub.text, /base64/);
  const later = await call('GET', '/api/pos/orders?since=' + r.json.now, undefined, { auth: true });
  assert.equal(later.json.orders.length, 0);

  /* Once the order leaves pending, the register's copies no longer carry the screenshot. */
  const acc = await call('POST', '/api/pos/orders/' + placed.json.code + '/status', { status: 'accepted' }, { auth: true });
  assert.equal(acc.status, 200, acc.text);
  assert.equal(acc.json.order.payment.proof, '');
  assert.equal(acc.json.order.payment.proofSha, sha);
  const after = await call('GET', '/api/pos/orders?since=0', undefined, { auth: true });
  assert.equal(after.json.orders.find((x) => x.code === placed.json.code).payment.proof, '');
});

test('a register poll stops at the screenshot budget and continues on the next poll', async () => {
  await withServer({}, async (s) => {
    await publish(undefined, s);
    await poll(Date.now(), s);
    /* About 1.33 MB of data URL each; 8 of them are more than the 8 MB budget. */
    const big = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(1000000, 7)]).toString('base64');
    const codes = [];
    for (let i = 0; i < 8; i++) {
      const r = await call('POST', '/api/orders', orderBody({ payment: { method: 'gcash', ref: newRef(), proof: big } }), { srv: s });
      assert.equal(r.status, 201, r.text);
      codes.push(r.json.code);
    }
    const first = await poll(0, s);
    assert.equal(first.status, 200);
    assert.equal(first.json.more, true);
    assert.ok(first.json.orders.length >= 1 && first.json.orders.length < 8);
    assert.equal(first.json.now, first.json.orders[first.json.orders.length - 1].updatedAt);
    const second = await poll(first.json.now, s);
    assert.equal(second.json.more, undefined);
    const got = first.json.orders.concat(second.json.orders).map((o) => o.code);
    assert.deepEqual(got.slice().sort(), codes.slice().sort());
    assert.ok(first.json.orders.concat(second.json.orders).every((o) => o.payment.proof === big));
  });
});

test('status transitions follow the contract table', async () => {
  const placed = await call('POST', '/api/orders', orderBody());
  const code = placed.json.code;
  const set = (body) => call('POST', '/api/pos/orders/' + code + '/status', body, { auth: true });
  assert.equal((await call('POST', '/api/pos/orders/' + code + '/status', { status: 'accepted' })).status, 401);
  assert.equal((await set({ status: 'cooking' })).status, 400);
  assert.equal((await set({ status: 'completed' })).status, 409);
  let r = await set({ status: 'accepted', etaAt: Date.now() + 1200000, posOrderId: 'pos-1' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.order.status, 'accepted');
  assert.equal(r.json.order.payment.verified, true);
  assert.equal(r.json.order.posOrderId, 'pos-1');
  assert.equal((await set({ status: 'pending' })).status, 409);
  assert.equal((await set({ status: 'preparing' })).status, 200);
  assert.equal((await set({ status: 'cancelled' })).status, 409);
  assert.equal((await set({ status: 'ready' })).status, 200);
  const odd = await set({ status: 'out_for_delivery' });
  assert.equal(odd.status, 409, 'pickup orders do not go out for delivery');
  r = await set({ status: 'completed' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.order.timeline.map((t) => t.status), ['pending', 'accepted', 'preparing', 'ready', 'completed']);
  assert.ok(r.json.order.timeline.slice(1).every((t) => t.by === 'register'));
  assert.equal((await set({ status: 'preparing' })).status, 409);

  const other = await call('POST', '/api/orders', orderBody());
  const rej = await call('POST', '/api/pos/orders/' + other.json.code + '/status', { status: 'rejected' }, { auth: true });
  assert.equal(rej.status, 400);
  assert.equal(rej.json.field, 'reason');
  assert.equal((await call('POST', '/api/pos/orders/MGB-0000/status', { status: 'accepted' }, { auth: true })).status, 404);
});

test('v1.1: status updates carry the verification fields, and underpaid orders cannot be accepted', async () => {
  const placed = await call('POST', '/api/orders', orderBody());
  assert.equal(placed.status, 201, placed.text);
  const { code, order } = placed.json;
  const set = (body) => call('POST', '/api/pos/orders/' + code + '/status', body, { auth: true });
  let r = await set({ status: 'accepted', payment: { amountReceived: order.total - 100 } });
  assert.equal(r.status, 409);
  assert.equal(r.json.field, 'payment.amountReceived');
  assert.equal((await set({ status: 'accepted', payment: { amountReceived: 12.5 } })).status, 400);
  const at = Date.now();
  r = await set({ status: 'accepted', verified: true, payment: { amountReceived: order.total + 1000, verifiedBy: 'Ana', verifiedAt: at, method: 'cash', ref: 'CHANGED', proof: PNG } });
  assert.equal(r.status, 200, r.text);
  const p = r.json.order.payment;
  assert.equal(p.amountReceived, order.total + 1000);
  assert.equal(p.verifiedBy, 'Ana');
  assert.equal(p.verifiedAt, at);
  assert.equal(p.method, 'gcash', 'only the verification fields are taken');
  assert.equal(p.ref, order.payment.ref);
  assert.equal(p.proof, '');
});

test('customer can cancel only while pending', async () => {
  const placed = await call('POST', '/api/orders', orderBody());
  const { code, token } = placed.json;
  assert.equal((await call('POST', '/api/orders/' + code + '/cancel?t=bad')).status, 404);
  const r = await call('POST', '/api/orders/' + code + '/cancel?t=' + token);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.order.status, 'cancelled');
  assert.equal(r.json.order.timeline[1].by, 'customer');
  assert.equal((await call('POST', '/api/orders/' + code + '/cancel?t=' + token)).status, 409);
});

test('sync stores each eid once', async () => {
  const ev = (eid) => ({ eid, kind: 'sale', at: Date.now(), data: { total: 12000 } });
  assert.equal((await call('POST', '/api/sync', { device: 'd1', events: [ev('e1')] })).status, 401);
  let r = await call('POST', '/api/sync', { device: 'd1', events: [ev('e1'), ev('e2'), ev('e2')] }, { auth: true });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.ack, ['e1', 'e2', 'e2']);
  r = await call('POST', '/api/sync', { device: 'd1', events: [ev('e2'), ev('e3'), { kind: 'no-eid' }] }, { auth: true });
  assert.deepEqual(r.json.ack, ['e2', 'e3']);
  const lines = (await readFile(join(dataDir, 'events.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.eid), ['e1', 'e2', 'e3']);
  assert.equal(lines[0].device, 'd1');
});

test('rejects non-JSON bodies and oversized requests', async () => {
  const res = await fetch('http://127.0.0.1:' + srv.port + BASE + '/api/orders', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'hello' });
  assert.equal(res.status, 415);
  const big = await fetch('http://127.0.0.1:' + srv.port + BASE + '/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pad: 'x'.repeat(2.2 * 1024 * 1024) }) });
  assert.equal(big.status, 413);
  const arr = await call('POST', '/api/orders', [1, 2]);
  assert.equal(arr.status, 400);
});

test('rate limits orders per IP and per phone', async () => {
  const ip = '192.0.2.77';
  /* Refused attempts do not use up the 8 placed orders a connection gets. */
  for (let i = 0; i < 8; i++) {
    const r = await call('POST', '/api/orders', orderBody({ customer: { name: 'Ana', phone: 'bad' } }), { ip });
    assert.equal(r.status, 400);
  }
  for (let i = 0; i < 8; i++) {
    const r = await call('POST', '/api/orders', orderBody(), { ip });
    assert.equal(r.status, 201, r.text);
  }
  const limited = await call('POST', '/api/orders', orderBody(), { ip });
  assert.equal(limited.status, 429);
  assert.ok(limited.json.error);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);

  /* Refused attempts have their own, looser limit. */
  const ip2 = '192.0.2.78';
  for (let i = 0; i < 30; i++) {
    const r = await call('POST', '/api/orders', orderBody({ customer: { name: 'Ana', phone: 'bad' } }), { ip: ip2 });
    assert.equal(r.status, 400);
  }
  assert.equal((await call('POST', '/api/orders', orderBody(), { ip: ip2 })).status, 429);

  const phone = newPhone();
  for (let i = 0; i < 5; i++) {
    const r = await call('POST', '/api/orders', orderBody({ customer: { name: 'Ana', phone } }));
    assert.equal(r.status, 201, r.text);
  }
  const sixth = await call('POST', '/api/orders', orderBody({ customer: { name: 'Ana', phone } }));
  assert.equal(sixth.status, 429);
  assert.equal(sixth.json.field, 'customer.phone');
});

test('serves static files under BASE_PATH with MIME, caching, gzip and security headers', async () => {
  const css = await raw(BASE + '/pos/css/app.css', { 'Accept-Encoding': 'gzip' });
  assert.equal(css.status, 200);
  assert.equal(css.headers['content-type'], 'text/css; charset=utf-8');
  assert.equal(css.headers['content-encoding'], 'gzip');
  assert.equal(css.headers['x-content-type-options'], 'nosniff');
  assert.equal(css.headers['referrer-policy'], 'no-referrer');
  assert.match(css.headers['content-security-policy'], /frame-ancestors 'none'/);
  const original = await readFile(join(ROOT, 'www', 'css', 'app.css'));
  assert.ok(gunzipSync(css.body).equals(original));
  assert.ok(css.headers.etag);
  const again = await raw(BASE + '/pos/css/app.css', { 'Accept-Encoding': 'gzip', 'If-None-Match': css.headers.etag });
  assert.equal(again.status, 304);

  const png = await raw(BASE + '/pos/assets/logo.png');
  assert.equal(png.status, 200);
  assert.equal(png.headers['content-type'], 'image/png');
  assert.ok(png.headers['last-modified']);

  const index = await raw(BASE + '/pos/');
  assert.equal(index.status, 200);
  assert.match(index.headers['content-type'], /^text\/html/);

  const cfg = await raw(BASE + '/order/config.js');
  assert.equal(cfg.status, 200);
  assert.match(cfg.headers['content-type'], /^text\/javascript/);
  /* The site adds /api/... itself; an empty value would mean demo mode. */
  assert.equal(cfg.body.toString(), 'window.MOGOBA_ORDER = { api: location.origin + "/mogoba" };\n');

  const root = await raw(BASE + '/');
  assert.equal(root.status, 301);
  assert.equal(root.headers.location, '/mogoba/order/');
  assert.equal((await raw(BASE + '/pos/%2e%2e/server/server.mjs')).status, 404);
  assert.equal((await raw(BASE + '/pos/..%2fpackage.json')).status, 404);
  assert.equal((await raw(BASE + '/elsewhere')).status, 404);
});

test('API answers CORS only for allowed origins', async () => {
  const same = await raw(BASE + '/api/health', { Origin: 'http://127.0.0.1:' + srv.port });
  assert.equal(same.headers['access-control-allow-origin'], 'http://127.0.0.1:' + srv.port);
  const other = await raw(BASE + '/api/health', { Origin: 'https://evil.example' });
  assert.equal(other.headers['access-control-allow-origin'], undefined);
});

test('v1.1: prepay items and large totals cannot be paid in cash', async () => {
  try {
    const items = storeSnapshot().items.concat([{ id: 'bilao', cat: 'dosirak', name: 'Bilao tray', price: 80000, prepay: true, variants: null, addons: [] }]);
    const payments = Object.assign({}, storeSnapshot().payments, { cash: { enabled: true, maxTotal: 100000 } });
    assert.equal((await publish({ items, payments })).status, 200);
    let r = await call('POST', '/api/orders', orderBody({ items: [{ itemId: 'bilao', qty: 1 }], payment: { method: 'cash' } }));
    assert.equal(r.status, 400);
    assert.equal(r.json.field, 'payment.method');
    r = await call('POST', '/api/orders', orderBody({ items: [{ itemId: 'bilao', qty: 1 }] }));
    assert.equal(r.status, 201, r.text);
    r = await call('POST', '/api/orders', orderBody({ items: [{ itemId: 'pork-dosirak', qty: 9 }], payment: { method: 'cash' } }));
    assert.equal(r.status, 400);
    assert.match(r.json.error, /above ₱1,000\.00/);
    r = await call('POST', '/api/orders', orderBody({ items: [{ itemId: 'pork-dosirak', qty: 8 }], payment: { method: 'cash' } }));
    assert.equal(r.status, 201, r.text);
    assert.equal((await publish({ payments: Object.assign({}, payments, { cash: { enabled: true, maxTotal: 'x' } }) })).status, 400);
  } finally {
    await publish();
  }
});

test('v1.1: a paused store takes no orders', async () => {
  try {
    assert.equal((await publish({ pausedUntil: Date.now() + 3600000 })).status, 200);
    const r = await call('POST', '/api/orders', orderBody());
    assert.equal(r.status, 423);
    assert.match(r.json.error, /paused/);
    assert.equal((await call('GET', '/api/health')).json.open, false);
    assert.equal((await publish({ pausedUntil: 'soon' })).status, 400);
    assert.equal((await publish({ pausedUntil: Date.now() - 1000 })).status, 200);
    assert.equal((await call('POST', '/api/orders', orderBody())).status, 201);
  } finally {
    await publish();
  }
});

test('v1.1: orders wait for the register heartbeat, and the store reports it', async () => {
  await withServer({}, async (s) => {
    await publish(undefined, s);
    let store = await call('GET', '/api/store', undefined, { srv: s });
    assert.equal(store.json.posSeenAt, 0);
    const r = await call('POST', '/api/orders', orderBody(), { srv: s });
    assert.equal(r.status, 423);
    assert.equal(r.json.error, 'Online orders are paused. Please call the store.');
    const tag = store.headers.get('etag');
    await poll(Date.now(), s);
    store = await call('GET', '/api/store', undefined, { srv: s });
    assert.ok(store.json.posSeenAt > 0);
    assert.notEqual(store.headers.get('etag'), tag, 'a new heartbeat is never a 304');
    assert.equal((await call('GET', '/api/health', undefined, { srv: s })).json.posSeenAt, store.json.posSeenAt);
    assert.equal((await call('POST', '/api/orders', orderBody(), { srv: s })).status, 201);
  });
});

test('per-IP limit keys IPv6 by /64, so rotating addresses does not get around it', async () => {
  assert.equal(ipKey('2001:db8:1:2::1'), ipKey('2001:0db8:0001:0002:ffff:0:0:c'));
  assert.notEqual(ipKey('2001:db8:1:2::1'), ipKey('2001:db8:1:3::1'));
  assert.equal(ipKey('::ffff:192.0.2.1'), '192.0.2.1');
  const codes = [];
  for (let i = 1; i <= 12; i++) codes.push((await call('POST', '/api/orders', orderBody(), { ip: '2001:db8:7:2::' + i.toString(16) })).status);
  assert.deepEqual(codes, [201, 201, 201, 201, 201, 201, 201, 201, 429, 429, 429, 429]);
});

test('without TRUST_PROXY, X-Forwarded-For does not change the rate limit key', async () => {
  await withServer({ TRUST_PROXY: '' }, async (s) => {
    await publish(undefined, s);
    await poll(Date.now(), s);
    const codes = [];
    for (let i = 0; i < 9; i++) codes.push((await call('POST', '/api/orders', orderBody(), { srv: s })).status);
    assert.deepEqual(codes, [201, 201, 201, 201, 201, 201, 201, 201, 429]);
  });
});

test('a non-ASCII tracking token is a plain 404, not a server error', async () => {
  const placed = await call('POST', '/api/orders', orderBody());
  assert.equal(placed.status, 201, placed.text);
  const t = encodeURIComponent('é'.repeat(32));
  assert.equal((await call('GET', '/api/orders/' + placed.json.code + '?t=' + t)).status, 404);
  assert.equal((await call('POST', '/api/orders/' + placed.json.code + '/cancel?t=' + t)).status, 404);
  assert.doesNotMatch(srv.stderrText, /RangeError/);
});

test('names lose invisible and bidi control characters', async () => {
  let r = await call('POST', '/api/orders', orderBody({ customer: { name: '\u200b\u200b', phone: newPhone() } }));
  assert.equal(r.status, 400);
  assert.equal(r.json.field, 'customer.name');
  r = await call('POST', '/api/orders', orderBody({ customer: { name: '\u202eJuan\ufeff', phone: newPhone() } }));
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.order.customer.name, 'Juan');
});

test('an hours row whose close equals its open is closed, as the customer site reads it', () => {
  const row = [{ day: 0, open: '09:00', close: '09:00' }];
  assert.equal(openAt(row, Date.parse('2026-10-04T01:00:00Z')), false);
  assert.equal(openAt(row, Date.parse('2026-10-04T05:00:00Z')), false);
});

test('a customer closing the page mid-upload is not logged as an error', async () => {
  const before = srv.stderrText.length;
  await new Promise((resolve, reject) => {
    const sock = connect(srv.port, '127.0.0.1', () => {
      sock.write('POST ' + BASE + '/api/orders HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 100000\r\n\r\n{"items":');
      setTimeout(() => {
        sock.destroy();
        resolve();
      }, 100);
    });
    sock.on('error', reject);
  });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(srv.stderrText.slice(before), '');
  assert.equal((await call('GET', '/api/health')).status, 200);
});

test('slow uploads get two minutes before the request times out', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mogoba-server-'));
  try {
    const app = createApp(loadConfig({ POS_KEY: KEY, DATA_DIR: dir }));
    assert.equal(app.server.requestTimeout, 120000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('orders, store and sync log survive a restart', async () => {
  const body = orderBody({ clientId: 'restart-check' });
  const placed = await call('POST', '/api/orders', body);
  assert.equal(placed.status, 201);
  await stop(srv);
  srv = await start(env());
  const r = await call('GET', '/api/orders/' + placed.json.code + '?t=' + placed.json.token);
  /* References survive the restart too. */
  await poll(Date.now());
  const dup = await call('POST', '/api/orders', orderBody({ payment: { method: 'gcash', ref: placed.json.order.payment.ref } }));
  assert.equal(dup.status, 409);
  assert.equal(r.status, 200);
  assert.equal(r.json.total, placed.json.order.total);
  assert.equal((await call('GET', '/api/store')).status, 200);
  const s = await call('POST', '/api/sync', { device: 'd1', events: [{ eid: 'e1', kind: 'sale', at: 1, data: {} }] }, { auth: true });
  assert.deepEqual(s.json.ack, ['e1']);
  const lines = (await readFile(join(dataDir, 'events.jsonl'), 'utf8')).trim().split('\n');
  assert.equal(lines.length, 3);
  const replay = await call('POST', '/api/orders', body);
  assert.equal(replay.status, 200);
  assert.equal(replay.json.code, placed.json.code);
});
