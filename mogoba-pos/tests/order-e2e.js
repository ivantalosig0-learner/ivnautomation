/* Customer ordering site, end to end in a real Chromium (demo mode): node tests/order-e2e.js
 * Serves the project with http-server on :8131 (started and stopped here), pins the clock to
 * a Monday noon in Manila so the store is open, and plays both sides of the localStorage bridge:
 * the customer page orders, a second tab on the same origin acts as the register.
 * Covers menu, variants and add-ons, totals, delivery fee, validation, GCash checkout with a
 * reference and screenshot, live tracking (storage events and polling), duplicate reference,
 * cash checkout, closed store, phone width without horizontal scroll, and console errors.
 * v1.1: Maya references with letters, reference reuse after a rejection, prepay and cash limit,
 * pause, slow confirmation, screenshot fingerprint, plus regressions from the review (double
 * tap remove, sold out mid payment, focus after re-render, phone formats, tall screenshots,
 * "Later today" across a refresh, desktop tracking layout). */
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const vm = require('vm');
const { spawn } = require('child_process');
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}

const ROOT = path.join(__dirname, '..');
const PORT = 8131;
const ORIGIN = 'http://127.0.0.1:' + PORT;
const SITE = ORIGIN + '/order/index.html';
const SHOTS = process.env.SHOTS || path.join(ROOT, '.shots');
fs.mkdirSync(SHOTS, { recursive: true });
/* Monday 5 October 2026, 12:00 in Manila: inside the 09:00 to 20:00 fallback hours. */
const NOON = new Date('2026-10-05T12:00:00+08:00');

let failures = 0;
const ok = (cond, msg) => {
  if (cond) console.log('  ✓ ' + msg);
  else {
    failures++;
    console.log('  ✗ ' + msg);
  }
};

function fallbackStore() {
  const sb = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'order', 'fallback-store.js'), 'utf8'), sb);
  return sb.window.MOGOBA_FALLBACK_STORE;
}

function waitForServer(ms) {
  const until = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      http
        .get(SITE, (res) => {
          res.resume();
          if (res.statusCode === 200) resolve();
          else retry();
        })
        .on('error', retry);
    };
    const retry = () => (Date.now() > until ? reject(new Error('http-server did not start on ' + PORT)) : setTimeout(tryOnce, 200));
    tryOnce();
  });
}

(async () => {
  /* detached, so the whole npx process group can be stopped at the end */
  const srv = spawn('npx', ['http-server', ROOT, '-p', String(PORT), '-a', '127.0.0.1', '-c-1', '-s'], { detached: true, stdio: 'ignore' });
  const stopServer = () => {
    try {
      process.kill(-srv.pid);
    } catch (e) {
      /* already gone */
    }
  };
  process.on('exit', stopServer);
  let browser;
  try {
    await waitForServer(20000);
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Manila', locale: 'en-PH', hasTouch: true });
    await ctx.clock.install({ time: NOON });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    /* let a toast fade first so it does not cover the screenshot */
    const shot = async (n, full) => {
      await page.waitForSelector('#toast', { state: 'hidden', timeout: 4000 }).catch(() => {});
      await page.screenshot({ path: path.join(SHOTS, 'order-' + n + '.png'), fullPage: !!full });
    };
    const text = (sel) => page.locator(sel).first().innerText();
    const noHScroll = async (where) => {
      const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
      ok(w[0] <= w[1], 'no horizontal scroll at 390 px on ' + where + ' (' + w[0] + ' <= ' + w[1] + ')');
    };
    const noDashes = async (where) => {
      const t = await page.evaluate(() => document.body.innerText);
      ok(!t.includes(String.fromCharCode(0x2014)), 'no em dash on ' + where);
    };

    /* the "register": another tab on the same origin, so writes raise storage events */
    const reg = await ctx.newPage();
    await reg.goto(ORIGIN + '/order/config.js');
    const regWrite = (fn, arg) => reg.evaluate(fn, arg);

    console.log('Menu');
    await page.goto(SITE);
    await page.waitForSelector('.item');
    const items = await page.locator('.item').count();
    const store = fallbackStore();
    ok(items === store.items.length && items === 50, 'all 50 active items render from the fallback snapshot (' + items + ')');
    ok((await page.locator('.chip').count()) === store.cats.length, 'one chip per category');
    ok(await page.locator('.demo-tag').isVisible(), 'Demo mode tag is shown');
    ok((await text('#store-status')).includes('Open now'), 'store shows Open now with today\'s hours: ' + (await text('#store-status')).replace(/\s+/g, ' '));
    ok((await text('.item[data-id="mt-wintermelon"] .price')) === '₱40 to ₱60', 'variant item shows a price range');
    ok((await page.locator('.item[data-id="fries"] .ko-tile').count()) === 1, 'item without a photo shows its Korean name tile');
    await page.evaluate(() => document.fonts.ready);
    await noHScroll('menu');
    await noDashes('menu');
    await shot('menu');

    /* publish a snapshot with a GCash QR, as the register would after online settings change */
    const qr = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = c.height = 116;
      const x = c.getContext('2d');
      x.fillStyle = '#fff';
      x.fillRect(0, 0, 116, 116);
      x.fillStyle = '#000';
      let seed = 7;
      for (let i = 0; i < 29; i++)
        for (let j = 0; j < 29; j++) {
          seed = (seed * 9301 + 49297) % 233280;
          const finder = (i < 7 && j < 7) || (i < 7 && j > 21) || (i > 21 && j < 7);
          if (finder ? i % 6 === 0 || j % 6 === 0 || i % 22 === 0 || j % 22 === 0 || (i % 22 > 1 && i % 22 < 5 && j % 22 > 1 && j % 22 < 5) : seed / 233280 > 0.5) x.fillRect(j * 4, i * 4, 4, 4);
        }
      return c.toDataURL('image/png');
    });
    const published = JSON.parse(JSON.stringify(store));
    published.updatedAt = NOON.getTime();
    published.payments.gcash = { enabled: true, accountName: 'A. M.', number: '0936 575 7278', qr };
    published.payments.maya = Object.assign({}, published.payments.maya, { qr: '' });
    await regWrite((s) => {
      localStorage.setItem('mogoba.bridge.store', JSON.stringify(s));
      localStorage.setItem('mogoba.bridge.ping', String(Date.now()));
    }, published);

    console.log('Item sheet and cart');
    await page.click('.item[data-id="chicken-dosirak"]');
    await page.waitForSelector('.sheet');
    await page.click('.opt:has-text("Honey Butter")');
    await page.click('.opt:has-text("Mozzarella cheese")');
    await page.click('[data-act="sel-qty"][data-d="1"]');
    ok((await text('#sel-amt')) === '₱280', 'sheet total for 2 x (Honey Butter ₱120 + mozzarella ₱20) is ₱280');
    await page.fill('#item-note', 'Extra spicy');
    await noHScroll('item sheet');
    await shot('item-sheet');
    await page.click('#add-item');
    await page.waitForSelector('.sheet', { state: 'detached' });
    ok((await text('#cartbar-btn')).replace(/\s+/g, ' ').includes('2 View order ₱280'), 'cart bar shows 2 items and ₱280');
    ok((await page.locator('.item[data-id="chicken-dosirak"] .incart').textContent()) === '2 in your order', 'menu card shows 2 in the order');

    await page.click('.chip[data-cat="street"]');
    await page.click('.item[data-id="gimbap"]');
    await page.waitForSelector('.sheet');
    await page.click('#add-item');
    await page.waitForSelector('.sheet', { state: 'detached' });
    ok((await text('#cartbar-btn')).replace(/\s+/g, ' ').includes('3 View order ₱410'), 'cart bar shows 3 items and ₱410');

    await page.click('#cartbar-btn');
    await page.waitForSelector('#to-details');
    ok((await page.locator('.co-main .line').count()) === 2, 'cart has 2 lines');
    ok((await text('.co-main .line .line-sub')).includes('Honey Butter, + Mozzarella cheese, Note: Extra spicy'), 'line shows variant, add-on and note');
    ok((await text('[data-total]')) === '₱410', 'cart total ₱410');
    await page.click('.co-main .line:nth-child(2) [data-act="line-qty"][data-d="1"]');
    ok((await text('[data-total]')) === '₱540', 'qty up on gimbap makes ₱540');
    await page.click('.co-main .line:nth-child(2) [data-act="line-qty"][data-d="-1"]');
    ok((await text('[data-total]')) === '₱410', 'qty back down makes ₱410');
    await noHScroll('cart');
    await shot('cart');

    console.log('Details and validation');
    await page.click('#to-details');
    await page.waitForSelector('#f-name');
    await page.fill('#f-name', 'Juan Dela Cruz');
    await page.fill('#f-phone', '12345');
    await page.locator('#f-phone').blur();
    ok((await text('#e-phone')).includes('Enter a PH mobile number'), 'bad phone shows an inline error');
    ok((await page.getAttribute('#f-phone', 'aria-invalid')) === 'true', 'bad phone is marked aria-invalid');
    await page.click('#to-pay');
    ok(page.url().endsWith('#/details'), 'cannot continue with a bad phone');
    await noHScroll('details');
    await shot('details-error');
    await page.fill('#f-phone', '0917 123 4567');
    ok((await page.locator('#e-phone').innerText()) === '', 'error clears once the phone is valid');
    await page.click('.co-main [data-act="mode"][data-mode="delivery"]');
    await page.waitForSelector('#f-address');
    ok((await text('[data-total]')) === '₱460', 'delivery adds the ₱50 fee: ₱460');
    await page.click('#to-pay');
    ok(page.url().endsWith('#/details'), 'delivery needs an address');
    ok((await text('#e-address')).includes('Enter your delivery address'), 'missing address shows an inline error');
    await page.fill('#f-address', 'Blk 3 Rizal St, Centro');
    await page.fill('#f-landmark', 'Near the plaza');
    await page.click('[data-act="when"][data-when="later"]');
    const slots = await page.locator('#f-time option').allInnerTexts();
    ok(slots[0] === '12:30 PM' && slots[slots.length - 1] === '7:45 PM', 'later today offers 15 minute slots from 12:30 PM to 7:45 PM (' + slots.length + ')');
    await page.click('[data-act="when"][data-when="asap"]');
    await page.click('#to-pay');
    await page.waitForSelector('input[name="method"]');

    console.log('Payment');
    ok(await page.locator('label.choice:has-text("Maya")').evaluate((el) => el.classList.contains('disabled') && el.innerText.includes('QR not set up yet')), 'Maya without a QR is disabled with a clear state');
    await page.click('label.choice:has-text("GCash")');
    await page.waitForSelector('#pay-exact');
    ok((await text('#pay-exact')) === '₱460', 'GCash panel shows the exact amount ₱460');
    ok(await page.locator('.qr img').evaluate((img) => img.complete && img.naturalWidth > 0), 'GCash QR from the snapshot is shown');
    ok((await text('.acct')).includes('0936 575 7278') && (await page.locator('[data-act="copy"][data-copy="09365757278"]').count()) === 1, 'account name and number are shown with a copy button');
    await page.click('#place');
    ok((await text('#e-ref')).includes('Enter the reference number'), 'missing reference number is refused inline');
    ok(page.url().endsWith('#/pay'), 'still on payment after the error');
    await noHScroll('payment');
    await shot('pay-error');
    await page.fill('#f-ref', '1234 5678-9012 3!#');
    ok((await page.inputValue('#f-ref')) === '1234 5678-9012 3', 'reference field keeps letters, digits, spaces and dashes only');
    await page.setInputFiles('#f-proof', path.join(ROOT, 'order', 'assets', 'food', 'honeybutter.jpg'));
    await page.waitForSelector('.proof img');
    ok(true, 'payment screenshot is compressed and attached');
    await shot('pay-ready');
    await page.click('#place');
    await page.waitForSelector('#track-status', { timeout: 10000 });

    console.log('Tracking');
    const m = /#\/track\/(MGB-\d{4})\/([0-9a-f]{32})$/.exec(page.url());
    ok(!!m, 'lands on /#/track/<code>/<token>: ' + page.url().split('#')[1]);
    const code = m && m[1];
    ok((await text('#track-status')) === 'Waiting for confirmation', 'status reads Waiting for confirmation');
    ok((await text('#pay-status')) === 'Waiting for payment check', 'payment reads Waiting for payment check');
    ok((await page.locator('#store-phone').innerText()) === '0936 575 7278' && (await page.locator('a[href="tel:09365757278"]').count()) === 1, 'store phone is shown with a tel: link');
    const rec = await page.evaluate((c) => JSON.parse(localStorage.getItem('mogoba.bridge.order.' + c)), code);
    ok(rec && rec.status === 'pending' && rec.total === 46000 && rec.subtotal === 41000 && rec.deliveryFee === 5000, 'order record: pending, subtotal 41000, fee 5000, total 46000');
    ok(rec && rec.lines[0].unit === 14000 && rec.lines[0].qty === 2 && rec.lines[0].variantName === 'Honey Butter' && rec.lines[0].mods[0].name === 'Mozzarella cheese', 'line priced from the snapshot: unit 14000 with variant and add-on names');
    ok(rec && rec.payment.method === 'gcash' && rec.payment.ref === '1234567890123' && /^data:image\/jpeg;base64,/.test(rec.payment.proof) && rec.payment.proof.length < 1.5 * 1024 * 1024, 'payment: gcash, ref without spaces or dashes, JPEG proof under 1.5 MB');
    const shaOk = await page.evaluate(async (r) => {
      const b = Uint8Array.from(atob(r.payment.proof.split(',')[1]), (ch) => ch.charCodeAt(0));
      const d = new Uint8Array(await crypto.subtle.digest('SHA-256', b));
      return Array.from(d, (x) => x.toString(16).padStart(2, '0')).join('') === r.payment.proofSha;
    }, rec);
    ok(rec && /^[0-9a-f]{64}$/.test(rec.payment.proofSha || '') && shaOk, 'payment.proofSha is the SHA-256 of the screenshot bytes');
    ok(rec && rec.customer.phone === '09171234567' && rec.fulfillment.type === 'delivery' && rec.fulfillment.address === 'Blk 3 Rizal St, Centro', 'customer phone normalised and delivery address stored');
    ok(rec && rec.token.length === 32 && rec.timeline.length === 1 && rec.timeline[0].by === 'customer', 'token and first timeline entry written');
    ok((await page.evaluate(() => JSON.parse(localStorage.getItem('mogoba.order.cart')).length)) === 0, 'cart is cleared after placing');
    ok((await page.evaluate(() => JSON.parse(localStorage.getItem('mogoba.order.recent'))[0].code)) === code, 'order is remembered on this device');
    await noHScroll('tracking');
    await noDashes('tracking');
    await shot('track-pending');

    /* register accepts (another tab: storage event) */
    await regWrite(
      ({ code, now }) => {
        const k = 'mogoba.bridge.order.' + code;
        const o = JSON.parse(localStorage.getItem(k));
        o.status = 'accepted';
        o.payment.verified = true;
        o.etaAt = now + 25 * 60e3;
        o.updatedAt = now;
        o.timeline.push({ status: 'accepted', at: now, by: 'register' });
        localStorage.setItem(k, JSON.stringify(o));
        localStorage.setItem('mogoba.bridge.ping', String(now));
      },
      { code, now: await page.evaluate(() => Date.now()) }
    );
    await page.waitForFunction(() => document.getElementById('track-status').textContent === 'Confirmed', null, { timeout: 7000 });
    ok(true, 'register accept shows Confirmed');
    ok((await text('#pay-status')) === 'Payment confirmed', 'payment reads Payment confirmed');
    ok(/Expected around \d{1,2}:\d{2} (AM|PM)/.test(await text('#track-eta')), 'ETA shown: ' + (await text('#track-eta')));

    /* register marks it ready from this same tab: no storage event, so the 5 s poll must catch it */
    const t0 = Date.now();
    await page.evaluate((code) => {
      const k = 'mogoba.bridge.order.' + code;
      const o = JSON.parse(localStorage.getItem(k));
      o.status = 'ready';
      o.updatedAt = Date.now();
      o.timeline.push({ status: 'ready', at: Date.now(), by: 'register' });
      localStorage.setItem(k, JSON.stringify(o));
    }, code);
    await page.waitForFunction(() => document.getElementById('track-status').textContent === 'Ready', null, { timeout: 8000 });
    ok(true, 'polling picks up ready within ' + Math.round((Date.now() - t0) / 100) / 10 + ' s');
    ok((await page.locator('.stepper li.done').count()) === 3 && (await page.locator('.stepper li[aria-current="step"]').innerText()).startsWith('Ready'), 'stepper: 3 steps done, Ready is current');
    ok((await page.locator('.timeline li').count()) === 3, 'timeline lists 3 changes');
    await shot('track-ready', true);

    console.log('Order again, duplicate reference, cash');
    await page.click('[data-act="again"]');
    await page.waitForSelector('#to-details');
    ok((await text('[data-total]')) === '₱460', 'order again refills the cart (₱410 + ₱50 delivery)');
    await page.click('#to-details');
    await page.waitForSelector('#f-name');
    ok((await page.inputValue('#f-name')) === 'Juan Dela Cruz' && (await page.inputValue('#f-address')) === 'Blk 3 Rizal St, Centro', 'contact and address are remembered');
    await page.click('#to-pay');
    await page.waitForSelector('input[name="method"]');
    await page.click('label.choice:has-text("GCash")');
    await page.fill('#f-ref', '1234567890123');
    await page.click('#place');
    await page.waitForSelector('#place-error');
    ok((await text('#e-ref')).includes('This reference number was already used. Call the shop if this is a mistake.'), 'same GCash reference is refused (409) with the v1.1 message');
    ok(page.url().endsWith('#/pay') && (await page.evaluate(() => JSON.parse(localStorage.getItem('mogoba.order.cart')).length)) === 2, 'cart is kept after the error');
    await page.click('label.choice:has-text("Cash on delivery")');
    await page.click('#place');
    await page.waitForSelector('#track-status', { timeout: 10000 });
    ok((await text('#track-status')) === 'Waiting for confirmation' && (await text('.panel:has(#p-pay)')).includes('Cash on delivery'), 'cash order placed and tracked');
    /* v1.1 rule 7: still pending after 5 minutes */
    await page.clock.fastForward('06:00');
    await page.waitForFunction(() => document.getElementById('track-eta').textContent.startsWith('Taking longer than usual'), null, { timeout: 8000 });
    ok((await text('#track-eta')) === 'Taking longer than usual. Call us at 0936 575 7278.', 'pending over 5 minutes shows Taking longer than usual with the shop phone');
    await page.goto(SITE + '#/orders');
    await page.waitForSelector('.recent a');
    ok((await page.locator('.recent a').count()) === 2, 'recent orders lists both orders');
    ok((await page.locator('.recent a small').first().innerText()).endsWith(', ₱460'), 'recent order row puts the amount on the date line');
    await shot('orders');

    console.log('v1.1 rules');
    /* register rejects the first order; its reason prints once, and its reference stays used */
    await regWrite(
      ({ code }) => {
        const k = 'mogoba.bridge.order.' + code;
        const o = JSON.parse(localStorage.getItem(k));
        o.status = 'rejected';
        o.reason = 'Payment not found.';
        o.updatedAt = Date.now();
        o.timeline.push({ status: 'rejected', at: Date.now(), by: 'register' });
        localStorage.setItem(k, JSON.stringify(o));
        localStorage.setItem('mogoba.bridge.ping', String(Date.now()));
      },
      { code }
    );
    await page.goto(SITE + '#/track/' + code + '/' + m[2]);
    await page.waitForSelector('#track-status');
    const body = await page.evaluate(() => document.body.innerText);
    ok((await text('#track-eta')) === 'The store could not accept this order.' && (await text('.notice.bad')).includes('Reason: Payment not found. If you already paid'), 'rejected order shows the reason once, with one period');
    ok(body.split('Payment not found').length === 2 && !body.includes('..'), 'reason is not repeated in the header');

    const withMaya = JSON.parse(JSON.stringify(published));
    withMaya.payments.maya = { enabled: true, accountName: 'A. M.', number: '', qr };
    const publish = (s) =>
      regWrite((x) => {
        localStorage.setItem('mogoba.bridge.store', JSON.stringify(x));
        localStorage.setItem('mogoba.bridge.ping', String(Date.now()));
      }, s);
    await publish(withMaya);
    /* cart set straight in storage, then a real reload so the page reads it */
    const loadCart = async (lines, hash) => {
      await page.evaluate((l) => localStorage.setItem('mogoba.order.cart', JSON.stringify(l)), lines);
      await page.goto(SITE + '?r=' + Math.random().toString(36).slice(2) + hash);
    };
    const L = (itemId, qty) => ({ itemId, variantId: '', mods: [], qty, note: '' });

    await loadCart([L('gimbap', 1)], '#/cart');
    await page.waitForSelector('#to-details');
    await page.click('#to-details');
    await page.waitForSelector('#f-name');
    await page.click('#mode-pickup');
    ok(await page.evaluate(() => document.activeElement.id === 'mode-pickup'), 'focus stays on the Pickup button after it re-renders the step');
    await page.click('#to-pay');
    await page.waitForSelector('input[name="method"]');
    await page.click('label.choice:has-text("GCash")');
    await page.fill('#f-ref', '1234567890123');
    await page.click('#place');
    await page.waitForSelector('#place-error');
    ok((await text('#e-ref')).includes('already used'), 'a reference from a rejected order cannot be used again');

    /* Maya references are 12 hex characters */
    await page.click('label.choice:has-text("Maya")');
    await page.waitForSelector('#f-ref');
    await page.fill('#f-ref', '');
    await page.locator('#f-ref').pressSequentially('3f9a-12bc 45de');
    ok((await page.inputValue('#f-ref')) === '3F9A-12BC 45DE', 'Maya reference keeps letters, upper case: ' + (await page.inputValue('#f-ref')));
    ok((await page.locator('#f-ref').getAttribute('inputmode')) === 'text' && (await page.locator('#f-ref').getAttribute('placeholder')) === 'From your receipt', 'Maya reference field opens the text keyboard');
    /* a 1080 x 6000 receipt keeps a readable width */
    const tall = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 1080;
      c.height = 6000;
      const x = c.getContext('2d');
      x.fillStyle = '#fff';
      x.fillRect(0, 0, 1080, 6000);
      x.fillStyle = '#000';
      x.font = '40px sans-serif';
      for (let y = 60; y < 6000; y += 120) x.fillText('Ref 3F9A12BC45DE  PHP 130.00', 40, y);
      return c.toDataURL('image/png').split(',')[1];
    });
    await page.setInputFiles('#f-proof', { name: 'receipt.png', mimeType: 'image/png', buffer: Buffer.from(tall, 'base64') });
    await page.waitForSelector('.proof img');
    const dims = await page.locator('.proof img').evaluate((img) => [img.naturalWidth, img.naturalHeight]);
    ok(dims[1] === 4096 && dims[0] >= 700, 'tall screenshot is scaled to ' + dims.join(' x ') + ' (long side 4096, text stays readable)');
    /* register marks gimbap sold out while the customer is on payment */
    const gimbapOut = JSON.parse(JSON.stringify(withMaya));
    gimbapOut.items.find((i) => i.id === 'gimbap').soldOut = true;
    await publish(gimbapOut);
    await page.waitForFunction(() => location.hash === '#/cart', null, { timeout: 5000 });
    ok((await text('#toast')).includes('no longer available') && (await page.locator('.co-main .line.bad').count()) === 1, 'item sold out mid payment returns to the cart with a note');
    await publish(withMaya);
    await page.waitForFunction(() => !document.querySelector('.co-main .line.bad'), null, { timeout: 5000 });
    await page.click('#to-details');
    await page.click('#to-pay');
    await page.click('label.choice:has-text("Maya")');
    await page.fill('#f-ref', '3f9a-12bc 45de');
    await page.click('#place');
    await page.waitForSelector('#track-status', { timeout: 10000 });
    const mayaRec = await page.evaluate(() => {
      const c = decodeURIComponent(location.hash.split('/')[2]);
      return JSON.parse(localStorage.getItem('mogoba.bridge.order.' + c));
    });
    ok(mayaRec && mayaRec.payment.method === 'maya' && mayaRec.payment.ref === '3F9A12BC45DE', 'Maya order stored with reference 3F9A12BC45DE');

    /* v1.1 rule 2: bilao trays and totals above cash.maxTotal are paid ahead */
    await loadCart([], '#/');
    await page.waitForSelector('.item');
    await page.click('.item[data-id="bilao-bihon"]');
    await page.waitForSelector('.sheet');
    ok((await text('.sheet .prepay')) === 'Paid ahead by GCash or Maya.', 'bilao item sheet says it is paid ahead');
    await page.click('#add-item');
    await page.waitForSelector('.sheet', { state: 'detached' });
    await page.goto(SITE + '#/pay');
    await page.waitForSelector('input[name="method"]');
    ok(await page.locator('label.choice:has-text("Cash on pickup")').evaluate((el) => el.classList.contains('disabled') && el.innerText.includes('Not for Bihon Bilao')), 'cash is not offered for a bilao tray');
    await loadCart([L('tteokbokki', 7)], '#/pay');
    await page.waitForSelector('input[name="method"]');
    ok(await page.locator('label.choice:has-text("Cash on pickup")').evaluate((el) => el.classList.contains('disabled') && el.innerText.includes('Up to ₱1,000 only')), 'cash is not offered above ₱1,000 (₱1,050 cart)');
    await loadCart([L('tteokbokki', 6)], '#/pay');
    await page.waitForSelector('input[name="method"]');
    ok(await page.locator('#m-cash').isEnabled(), 'cash is offered at ₱900');

    /* keyboard: arrow keys move through payment methods without losing focus */
    await page.focus('#m-gcash');
    await page.keyboard.press('ArrowDown');
    ok(await page.evaluate(() => document.activeElement.name === 'method' && document.activeElement.id !== 'm-gcash'), 'arrow key moves to the next payment method and keeps focus');

    /* "Later today" survives a refresh on the payment step */
    await page.goto(SITE + '#/details');
    await page.waitForSelector('#when-later');
    await page.click('#when-later');
    await page.selectOption('#f-time', { index: 2 });
    const picked = await page.locator('#f-time option:checked').innerText();
    await page.click('#to-pay');
    await page.waitForSelector('input[name="method"]');
    await page.reload();
    await page.waitForSelector('input[name="method"]');
    ok((await text('.co-side .kv')).includes('Today ' + picked), 'Later today ' + picked + ' is kept after a refresh');

    /* phone formats people type */
    await page.goto(SITE + '#/details');
    await page.waitForSelector('#f-phone');
    await page.fill('#f-phone', '+63 (917) 123-4567');
    await page.locator('#f-phone').blur();
    ok((await page.inputValue('#f-phone')) === '+63 (917) 123-4567' && (await page.locator('#e-phone').innerText()) === '', 'phone +63 (917) 123-4567 fits and is accepted');
    await page.fill('#f-phone', '917 123 4567');
    ok((await page.locator('#e-phone').innerText()) === '', 'phone without the leading 0 is accepted');
    await page.fill('#f-phone', '0917 123 4567');

    /* double tap on a trash button removes one line, not two; keyboard focus survives a re-render */
    await loadCart([L('tteokbokki', 1), L('gimbap', 1), L('fries', 3)], '#/cart');
    await page.waitForSelector('#to-details');
    await page.dblclick('.co-main .line:nth-child(1) [data-act="line-qty"][data-d="-1"]');
    const left = await page.evaluate(() => JSON.parse(localStorage.getItem('mogoba.order.cart')).map((l) => l.itemId + 'x' + l.qty).join(','));
    ok(left === 'gimbapx1,friesx3', 'double tap on trash removes only that line: ' + left);
    await page.focus('#q-1p');
    await page.keyboard.press('Enter');
    ok(await page.evaluate(() => document.activeElement.id === 'q-1p'), 'Enter on a quantity button keeps focus on it');
    ok((await page.locator('.co-main .line:nth-child(2) output').innerText()) === '4', 'quantity went up to 4');

    console.log('Closed store');
    const closed = JSON.parse(JSON.stringify(published));
    closed.accepting = false;
    await regWrite((s) => {
      localStorage.setItem('mogoba.bridge.store', JSON.stringify(s));
      localStorage.setItem('mogoba.bridge.ping', String(Date.now()));
    }, closed);
    await page.goto(SITE);
    await page.waitForSelector('.item');
    ok((await text('#store-status')).includes('Paused') && (await page.locator('#closed-note').isVisible()), 'menu shows the store is not taking orders');
    await page.click('.item[data-id="tteokbokki"]');
    await page.click('#add-item');
    await page.click('#cartbar-btn');
    await page.waitForSelector('#to-details');
    ok((await page.getAttribute('#to-details', 'aria-disabled')) === 'true', 'checkout is disabled while closed');
    ok((await text('#closed-note')).includes('paused'), 'closed notice explains why: ' + (await text('#closed-note b')));
    await shot('closed');
    /* v1.1 rule 3: paused for two hours */
    const pausedStore = JSON.parse(JSON.stringify(published));
    const nowMs = await page.evaluate(() => Date.now());
    pausedStore.pausedUntil = nowMs + 2 * 3600e3;
    await publish(pausedStore);
    await page.goto(SITE + '?p=1');
    await page.waitForSelector('.item');
    const backAt = await page.evaluate((t) => {
      const d = new Date(t + 8 * 3600e3);
      const h = d.getUTCHours();
      return (h % 12 || 12) + ':' + String(d.getUTCMinutes()).padStart(2, '0') + ' ' + (h < 12 ? 'AM' : 'PM');
    }, pausedStore.pausedUntil);
    ok((await text('#store-status')).includes('Paused') && (await text('#closed-note b')) === 'Paused, back at ' + backAt + '.', 'pausedUntil shows Paused, back at ' + backAt);
    await page.goto(SITE + '#/details');
    await page.waitForSelector('#to-pay');
    ok(await page.locator('#to-pay').isDisabled(), 'checkout is disabled while paused');
    await publish(closed);
    /* typing the next step's address directly still cannot place an order */
    await page.evaluate(() => (location.hash = '#/details'));
    await page.waitForSelector('#to-pay');
    ok(await page.locator('#to-pay').isDisabled(), 'details step keeps the button disabled while closed');
    /* reopen through a storage event and check the page follows without a reload */
    await regWrite((s) => {
      localStorage.setItem('mogoba.bridge.store', JSON.stringify(s));
      localStorage.setItem('mogoba.bridge.ping', String(Date.now()));
    }, published);
    await page.waitForFunction(() => !document.getElementById('to-pay').disabled, null, { timeout: 5000 });
    ok(true, 'reopening in the register enables checkout live');

    console.log('Desktop');
    const desk = await browser.newContext({ viewport: { width: 1280, height: 860 }, timezoneId: 'Asia/Manila', locale: 'en-PH' });
    await desk.clock.install({ time: NOON });
    const dp = await desk.newPage();
    dp.on('pageerror', (e) => errors.push(e.message));
    dp.on('console', (m2) => m2.type() === 'error' && errors.push(m2.text()));
    await dp.goto(SITE);
    await dp.waitForSelector('.item');
    await dp.click('.item[data-id="chicken-box"]');
    await dp.click('.opt:has-text("Spicy")');
    await dp.click('#add-item');
    await dp.waitForSelector('.sheet', { state: 'detached' });
    ok(await dp.locator('#sidecart').isVisible(), 'side cart is shown on wide screens');
    ok(!(await dp.locator('#cartbar').isVisible()), 'phone cart bar is hidden on wide screens');
    ok((await dp.locator('#sidecart [data-total]').innerText()) === '₱500', 'side cart total ₱500');
    await dp.evaluate(() => document.fonts.ready);
    await dp.screenshot({ path: path.join(SHOTS, 'order-desktop.png') });
    ok((await dp.locator('.chips').evaluate((el) => getComputedStyle(el).flexWrap)) === 'nowrap', 'category chips stay on one row on wide screens');
    /* tracking page uses two columns on wide screens */
    const recDesk = await page.evaluate((c) => localStorage.getItem('mogoba.bridge.order.' + c), code);
    await dp.evaluate(([c, r]) => localStorage.setItem('mogoba.bridge.order.' + c, r), [code, recDesk]);
    await dp.goto(SITE + '#/track/' + code + '/' + m[2]);
    await dp.waitForSelector('#track-status');
    const grid = await dp.locator('.track-grid').evaluate((el) => [getComputedStyle(el).display, el.querySelector('.track-col').getBoundingClientRect().width]);
    ok(grid[0] === 'grid' && grid[1] > 600, 'desktop tracking is a two column grid (first column ' + Math.round(grid[1]) + ' px)');
    await dp.waitForSelector('#toast', { state: 'hidden', timeout: 4000 }).catch(() => {});
    await dp.screenshot({ path: path.join(SHOTS, 'order-track-desktop.png') });
    await desk.close();

    ok(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  } catch (e) {
    failures++;
    console.log('  ✗ test crashed: ' + (e && e.stack ? e.stack : e));
  } finally {
    if (browser) await browser.close();
    stopServer();
  }
  console.log(failures ? '\n' + failures + ' failed' : '\nAll order checks passed');
  process.exit(failures ? 1 : 0);
})();
