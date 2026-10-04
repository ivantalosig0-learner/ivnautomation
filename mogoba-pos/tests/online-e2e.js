/* Online ordering across the three parts, in server mode: node tests/online-e2e.js
 * Starts server/server.mjs with a temp DATA_DIR, opens the register it serves at /pos/ in
 * Chromium, points the register at the server, then plays the customer through the public API:
 * the register publishes the menu, a GCash order with a screenshot reaches the Online tab,
 * staff verify the amount and accept, the sale is recorded once, and the customer's tracking
 * shows each step. Also checks the v1.1 rules end to end: reference reuse, prepay and cash
 * limit, pause, and the register heartbeat. */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}

const ROOT = path.join(__dirname, '..');
const PORT = 8141;
const ORIGIN = 'http://127.0.0.1:' + PORT;
const KEY = 'test-register-key-0123456789abcdef';
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mogoba-online-'));
/* 1x1 PNG, a valid image for the proof check */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

let failures = 0;
const ok = (cond, msg) => {
  if (cond) console.log('  ✓ ' + msg);
  else {
    failures++;
    console.log('  ✗ ' + msg);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms, step) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(step || 300);
  }
}
const api = async (method, p, body) => {
  const res = await fetch(ORIGIN + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
let n = 0;
const orderBody = (store, extra) => {
  const item = store.items.find((i) => !i.soldOut && !i.prepay && !(i.variants || []).length && i.price >= 10000 && i.price <= 20000);
  return Object.assign(
    {
      clientId: 'e2e-' + Date.now() + '-' + n++,
      items: [{ itemId: item.id, variantId: '', mods: [], qty: 2, note: '' }],
      customer: { name: 'Ana Reyes', phone: '0917 123 4567' },
      fulfillment: { type: 'pickup', time: 'asap', address: '', landmark: '' },
      payment: { method: 'gcash', ref: '1012 345 678902', sender: 'Ana R.', proof: PNG },
      note: '',
    },
    extra || {}
  );
};

(async () => {
  const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'server.mjs')], {
    env: Object.assign({}, process.env, { PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: DATA, POS_KEY: KEY }),
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let srvErr = '';
  srv.stderr.on('data', (d) => (srvErr += d));
  const stop = () => {
    try {
      srv.kill();
    } catch (e) {
      /* gone */
    }
    fs.rmSync(DATA, { recursive: true, force: true });
  };
  process.on('exit', stop);
  let browser;
  try {
    ok(await until(async () => (await api('GET', '/api/health')).status === 200, 15000), 'server is up');
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, timezoneId: 'Asia/Manila' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

    console.log('Register on the server');
    await page.goto(ORIGIN + '/pos/');
    await page.click('text=Explore with sample data');
    await page.waitForSelector('.user-card', { timeout: 60000 });
    await page.click('.user-card:has-text("Owner")');
    for (const d of '1234') await page.keyboard.press(d);
    await page.waitForSelector('.view');
    await page.evaluate(
      ([origin, key]) =>
        M.core.saveSettings({
          online: Object.assign({}, M.state.settings.online, {
            mode: 'server',
            url: origin + '/api',
            key,
            hours: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: '00:00', close: '24:00' })),
          }),
        }),
      [ORIGIN, KEY]
    );
    const store = await until(async () => {
      const r = await api('GET', '/api/store');
      return r.status === 200 && r.body.items && r.body.posSeenAt ? r.body : null;
    }, 20000);
    ok(!!store, 'register published the menu and polled (posSeenAt set)');
    if (!store) throw new Error('no store');
    ok(store.items.length >= 40, store.items.length + ' items on the public menu');
    ok(/^data:image\/png/.test(store.payments.gcash.qr), 'sample GCash QR is published');
    ok(store.items.some((i) => i.prepay) && store.payments.cash.maxTotal === 100000, 'bilao trays are prepay and cash is capped at ₱1,000');
    ok(!JSON.stringify(store).includes(KEY), 'register key is not in the public snapshot');

    console.log('Customer places a GCash order');
    const placed = await api('POST', '/api/orders', orderBody(store));
    ok(placed.status === 201 && /^MGB-\d{4}$/.test(placed.body.code), 'order accepted by the server: ' + placed.status + ' ' + (placed.body.code || placed.body.error));
    const { code, token } = placed.body;
    const total = placed.body.order.total;
    ok(placed.body.order.payment.ref === '1012345678902', 'reference stored without spaces');
    const track = () => api('GET', '/api/orders/' + code + '?t=' + token).then((r) => r.body);
    ok((await track()).status === 'pending', 'tracking shows pending');

    console.log('Register verifies and accepts');
    await page.evaluate(() => M.app.go('orders'));
    await page.evaluate(() => M.bus.emit('orders:tab', 'online'));
    const card = page.locator('.oo-card', { hasText: code });
    ok(!!(await until(async () => (await card.count()) === 1, 20000)), code + ' appears in Orders → Online');
    ok((await card.locator('.oo-proof img').count()) === 1, 'payment screenshot is shown on the card');
    const sha = await page.evaluate((c) => (M.online.state.orders[c].payment || {}).proofSha || '', code);
    ok(/^[0-9a-f]{64}$/.test(sha), 'register has the screenshot fingerprint');
    await card.locator('button:has-text("Verify payment")').click();
    await page.waitForSelector('.keypad');
    for (const d of String(total / 100)) await page.click('.keypad button[aria-label="' + d + '"]');
    await page.click('button:has-text("Verify and accept")');
    const acc = await until(async () => {
      const t = await track();
      return t.status === 'accepted' ? t : null;
    }, 10000);
    ok(!!acc, 'tracking shows accepted');
    if (acc) {
      ok(acc.payment.verified === true, 'payment marked verified');
      ok(acc.etaAt > Date.now(), 'ready time sent to the customer');
    }
    const regCopy = await api('GET', '/api/orders/' + code + '?t=' + token);
    ok(!regCopy.body.token && !regCopy.body.payment.proof, 'tracking never exposes the token or screenshot');
    const sales = await page.evaluate((c) => M.state.today.filter((o) => o.onlineCode === c).map((o) => ({ total: o.totals.total, pay: o.payments.map((p) => p.method + ':' + p.ref) })), code);
    ok(sales.length === 1 && sales[0].total === total && sales[0].pay[0] === 'gcash:1012345678902', 'one GCash sale recorded with the reference');
    const kept = await page.evaluate((c) => !!(M.online.state.orders[c].payment || {}).proof, code);
    ok(kept, 'register keeps the screenshot after the order leaves pending');

    console.log('Kitchen steps reach the customer');
    for (const [label, status] of [['Start preparing', 'preparing'], ['Ready for pickup', 'ready'], ['Picked up', 'completed']]) {
      await page.evaluate(() => M.bus.emit('orders:tab', 'online'));
      await page.click('.seg button:has-text("In progress")').catch(() => {});
      await page.locator('.oo-card', { hasText: code }).locator('button:has-text("' + label + '")').click();
      const t = await until(async () => ((await track()).status === status ? true : null), 8000);
      ok(!!t, label + ' → customer sees ' + status);
    }
    const timeline = (await track()).timeline.map((x) => x.status).join(' > ');
    ok(timeline === 'pending > accepted > preparing > ready > completed', 'timeline: ' + timeline);

    console.log('Rules');
    const dupRef = await api('POST', '/api/orders', orderBody(store, { payment: { method: 'gcash', ref: '1012-345-678902', sender: '', proof: '' } }));
    ok(dupRef.status === 409, 'same reference with dashes is refused: ' + dupRef.status);
    const bilao = store.items.find((i) => i.prepay && !i.soldOut);
    const prepay = await api('POST', '/api/orders', orderBody(store, { items: [{ itemId: bilao.id, variantId: (bilao.variants[0] || {}).id || '', mods: [], qty: 1, note: '' }], payment: { method: 'cash', ref: '', sender: '', proof: '' } }));
    ok(prepay.status === 400 && /GCash or Maya/.test(prepay.body.error), 'cash refused for a bilao tray: ' + prepay.body.error);
    const cash = await api('POST', '/api/orders', orderBody(store, { payment: { method: 'cash', ref: '', sender: '', proof: '' } }));
    ok(cash.status === 201, 'cash order under ₱1,000 goes through');
    await page.evaluate(() => M.bus.emit('orders:tab', 'online'));
    const cashCard = page.locator('.oo-card', { hasText: cash.body.code });
    ok(!!(await until(async () => (await cashCard.count()) === 1, 20000)), 'cash order reaches the register');
    await cashCard.locator('button:has-text("Accept order")').click();
    const ticket = await until(() => page.evaluate((c) => M.state.open.some((o) => o.onlineCode === c), cash.body.code), 8000);
    ok(!!ticket, 'accepted cash order becomes an open ticket to charge at pickup');

    await page.click('button:has-text("20 min")');
    const paused = await until(async () => ((await api('GET', '/api/store')).body.pausedUntil > Date.now() ? true : null), 10000);
    ok(!!paused, 'pause is published');
    const whilePaused = await api('POST', '/api/orders', orderBody(store, { payment: { method: 'gcash', ref: '1099988877766', sender: '', proof: '' } }));
    ok(whilePaused.status === 423, 'orders refused while paused: ' + whilePaused.status);

    ok(errors.length === 0, 'no register page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  } catch (e) {
    failures++;
    console.error('  ✗ ' + (e.stack || e.message));
  } finally {
    if (browser) await browser.close();
    stop();
  }
  if (srvErr.trim()) console.log('server stderr:\n' + srvErr.trim().split('\n').slice(-10).join('\n'));
  console.log(failures ? '\n' + failures + ' check(s) failed' : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
