/* End-to-end checks in a real Chromium: node tests/e2e.js [baseUrl]
 * Covers setup, sign-in, shift, sale with options/add-ons/SC-PWD discount, cash change,
 * stock depletion, void + restock, partial refund, held tickets, manager approval, drawer
 * close, every screen rendering, persistence across reload, phone layout, offline reload. */
'use strict';
const path = require('path');
const fs = require('fs');
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}

const BASE = process.argv[2] || 'http://127.0.0.1:8123/';
const SHOTS = process.env.SHOTS || path.join(__dirname, '..', '.shots');
fs.mkdirSync(SHOTS, { recursive: true });
let failures = 0;
const ok = (cond, msg) => {
  if (cond) console.log('  ✓ ' + msg);
  else {
    failures++;
    console.log('  ✗ ' + msg);
  }
};
const near = (a, b, eps) => Math.abs(a - b) <= (eps || 0.001);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, timezoneId: 'Asia/Manila', locale: 'en-PH' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const st = (fn, arg) => page.evaluate(fn, arg);
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, n + '.png') });
  const pin = async (p) => {
    for (const d of p) await page.keyboard.press(d);
  };
  const top = () => page.locator('.scrim').last();
  const closeSheets = async () => {
    while (await page.locator('.sheet').count()) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(220);
    }
  };

  console.log('Setup & sign in');
  await page.goto(BASE);
  await page.click('text=Explore with sample data');
  await page.waitForSelector('.user-card', { timeout: 60000 });
  await page.click('.user-card:has-text("Owner")');
  await pin('1234');
  await page.waitForSelector('.reg');
  ok(await page.locator('.cat[aria-pressed="true"]:has-text("Popular")').count(), 'Popular tab is preselected');
  const hist = await st(() => ({ today: M.state.today.length, items: Object.keys(M.state.items).length, ings: Object.keys(M.state.ings).length }));
  ok(hist.items === 50 && hist.ings === 55, 'menu (50 items) and stock (55 items) loaded: ' + JSON.stringify(hist));
  const ledger = await st(() => M.core.verifyStock());
  ok(ledger.diffs.length === 0, 'demo history: on-hand equals the ledger (' + ledger.moves + ' moves)');

  console.log('Shift');
  if (!(await st(() => !!M.state.shift))) {
    await page.click('.gate >> text=Open shift');
    await page.click('.sheet >> text=Open shift');
    await page.waitForFunction(() => !!M.state.shift);
  }
  ok(await st(() => !!M.state.shift), 'shift is open');
  await st(() => M.core.clearCart());

  console.log('Sale with options, add-ons and SC/PWD discount');
  const before = await st(() => Object.fromEntries(Object.entries(M.state.ings).map(([k, v]) => [k, v.onHand])));
  await page.fill('.search input', 'chicken dosirak');
  await page.click('.tile:has-text("Chicken Dosirak")');
  await page.click('.opt:has-text("Honey Butter")');
  await page.click('.opt:has-text("Mozzarella")');
  await page.click('.sheet button[aria-label="More"]');
  await page.click('.sheet .chip:has-text("Extra spicy")');
  await shot('10-item-sheet');
  await page.click('.sheet >> text=Add to order');
  await page.fill('.search input', 'ramyeon');
  await page.click('.tile:has-text("Ramyeon")');
  await page.click('.sheet >> text=Add to order');
  await page.fill('.search input', 'wintermelon');
  await page.click('.tile:has-text("Wintermelon") >> nth=0');
  await page.click('.opt:has-text("Large")');
  await page.fill('.search input', '');
  let t = await st(() => M.core.cartTotals());
  ok(t.total === 46000, 'ticket total ₱460.00 (2×140 + 120 + 60): got ' + t.total);
  await page.click('button[aria-label="Discount"]');
  await page.click('.sheet button[aria-label="More"] >> nth=1');
  await page.click('.sheet button[aria-label="More"] >> nth=1');
  await page.fill('input[aria-label="Full name 1"]', 'Test Senior');
  await page.fill('input[aria-label="ID number 1"]', 'OSCA-12345');
  await shot('11-discount');
  await page.click('.sheet >> text=Apply discount');
  t = await st(() => M.core.cartTotals());
  ok(t.total === 42933 && t.orderDisc === 3067, 'SC 1 of 3 diners: 20% of ₱153.33 = ₱30.67 off → ₱429.33 (got ' + t.total + ')');
  await shot('12-ticket');
  await page.click('.charge');
  await page.waitForSelector('.methods');
  await shot('13-pay');
  await page.click('.sheet .chip:has-text("₱500")');
  await page.waitForSelector('.change-hero');
  const changeText = await page.textContent('.change-hero .big');
  ok(changeText.includes('70.67'), 'change shown ₱70.67: ' + changeText.trim());
  await shot('14-done');
  const sale = await st(() => M.state.today.slice().sort((a, b) => b.paidAt - a.paidAt)[0]);
  ok(sale.status === 'paid' && sale.totals.total === 42933 && sale.payments[0].change === 7067, 'order saved as paid with change recorded');
  ok(sale.lines[0].note === 'Extra spicy' && sale.lines[0].qty === 2, 'note and quantity kept on the line');
  const after = await st(() => Object.fromEntries(Object.entries(M.state.ings).map(([k, v]) => [k, v.onHand])));
  const used = (k) => Math.round((before[k] - after[k]) * 1000) / 1000;
  ok(used('chicken') === 220 && used('rice') === 360 && used('honeybutter') === 50 && used('mozzarella') === 60, 'recipe depletion: chicken 220 g, rice 360 g, glaze 50 ml, mozzarella 60 g (2 × recipe + add-on)');
  ok(used('ramyeon') === 1 && used('egg') === 1 && used('cup_l') === 1 && used('s_wintermelon') === 30 && used('pearls') === 50, 'ramyeon, egg, large cup, syrup 30 ml, pearls 50 g deducted');
  await page.click('.sheet >> text=New order');

  console.log('Void with restock');
  await page.click('.rail-btn:has-text("Orders")');
  await page.click('.seg button:has-text("Today")');
  await st((id) => M.ordersView.detail(M.state.today.find((o) => o.id === id)), sale.id);
  await page.waitForSelector('.sheet >> text=Void order');
  await shot('20-order-detail');
  await top().locator('button:has-text("Void order")').click();
  await top().locator('.chip:has-text("Customer cancelled")').click();
  await top().locator('button.btn.danger-solid:has-text("Void order")').click();
  await page.waitForFunction((id) => M.state.today.find((o) => o.id === id).status === 'voided', sale.id);
  const afterVoid = await st(() => Object.fromEntries(Object.entries(M.state.ings).map(([k, v]) => [k, v.onHand])));
  ok(near(afterVoid.chicken, before.chicken) && near(afterVoid.mozzarella, before.mozzarella) && near(afterVoid.cup_l, before.cup_l), 'void returned every ingredient to stock');
  await closeSheets();

  console.log('Partial refund, manager approval as cashier');
  await page.click('.rail-btn:has-text("Lock")');
  await page.click('.user-card:has-text("Joy")');
  await pin('0000');
  await page.waitForSelector('.reg');
  ok(!(await page.locator('.rail-btn:has-text("Reports")').count()), 'cashier cannot see Reports');
  const paidOne = await st(() => M.state.today.filter((o) => o.status === 'paid' && !o.refunds.length && o.lines.length >= 2 && o.payments[0].method === 'cash')[0]);
  if (paidOne) {
    await st((id) => M.ordersView.detail(M.state.today.find((o) => o.id === id)), paidOne.id);
    await top().locator('button:has-text("Refund items")').click();
    await page.waitForSelector('.sheet >> text=Approve refund');
    await shot('21-approval');
    await pin('9999');
    await page.waitForSelector('.err-text:has-text("cannot approve")');
    ok(true, 'wrong PIN rejected');
    await pin('2580');
    await page.waitForSelector('.sheet >> text=Refund amount');
    await top().locator('.stepper button[aria-label="More"]').first().click();
    await top().locator('.chip:has-text("Missing item")').click();
    await shot('22-refund');
    await top().locator('button.btn.danger-solid:has-text("Refund")').click();
    await page.waitForFunction((id) => M.state.today.find((o) => o.id === id).refunds.length === 1, paidOne.id);
    const r = await st((id) => M.state.today.find((o) => o.id === id).refunds[0], paidOne.id);
    ok(r.approver.name === 'Mark' && r.by.name === 'Joy' && r.amount > 0, 'refund recorded by Joy, approved by Mark: ' + r.amount);
    await closeSheets();
  }

  console.log('Held ticket');
  await page.fill('.search input', 'tteokbokki');
  await page.click('.tile:has-text("Tteokbokki")');
  await page.click('.sheet >> text=Add to order');
  await page.fill('.search input', '');
  await page.click('button[aria-label="Hold ticket"]');
  await page.fill('input[aria-label="Table number"]', '5');
  await page.click('.sheet >> button:has-text("Hold ticket")');
  await page.waitForFunction(() => M.state.open.length >= 1);
  ok(await st(() => M.state.cart.lines.length === 0 && M.state.open.some((o) => o.table === '5')), 'ticket held for table 5, register cleared');
  await page.click('button:has-text("Tickets")');
  await page.click('.sheet .row:has-text("Table 5")');
  await page.waitForFunction(() => M.state.cart.table === '5').catch(() => null);
  ok(await st(() => M.state.cart.table === '5' && M.state.cart.lines[0].sent), 'ticket resumed with lines marked sent to kitchen');
  await page.locator('.tline').first().click();
  await top().locator('button:has-text("Remove")').click();
  await page.waitForSelector('.sheet >> text=Approve removal');
  await pin('2580');
  await top().locator('.chip:has-text("Entered by mistake")').click();
  await top().locator('button:has-text("Remove item")').click();
  await page.waitForFunction(() => M.state.cart.lines.length === 0);
  const log = await st(() => M.core.auditLog(5));
  ok(log.some((a) => a.action === 'line.void' && a.approver && a.approver.name === 'Mark'), 'removing a sent item is logged with the approver');
  await st(() => M.core.clearCart());

  console.log('Drawer: pay-out and close');
  await page.click('.rail-btn:has-text("Lock")');
  await page.click('.user-card:has-text("Owner")');
  await pin('1234');
  await page.waitForSelector('.reg');
  await page.click('.rail-btn:has-text("Drawer")');
  await page.waitForSelector('text=Expected in drawer');
  await page.click('button:has-text("Cash out")');
  await page.click('.sheet .chip:has-text("Ice")');
  await page.click('.keypad button[aria-label="1"]');
  await page.click('.keypad button[aria-label="0"]');
  await page.click('.keypad button[aria-label="0"]');
  await page.click('.sheet >> text=Take out');
  await page.waitForFunction(() => M.state.shift.tot.outs >= 10000);
  await shot('30-drawer');
  const exp = await st(() => M.logic.drawer(M.state.shift).expected);
  await page.click('text=Count & close shift');
  let rest = exp;
  for (const d of [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 100]) {
    const n = Math.floor(rest / d);
    rest -= n * d;
    if (n) await page.fill('input[aria-label="' + { 100000: '₱1,000', 50000: '₱500', 20000: '₱200', 10000: '₱100', 5000: '₱50', 2000: '₱20', 1000: '₱10', 500: '₱5', 100: '₱1' }[d] + ' count"]', String(n));
  }
  if (rest) await page.fill('input[aria-label="Centavo coins total"]', (rest / 100).toFixed(2));
  rest = 0;
  await shot('31-close');
  await top().locator('button.btn.primary:has-text("Close shift")').click();
  await top().locator('button.btn.primary:has-text("Close shift")').click();
  await page.waitForSelector('text=Drawer balanced', { timeout: 5000 }).catch(() => null);
  const closed = await st(() => M.core.shifts().then((s) => s[0]));
  ok(closed.status === 'closed' && closed.overShort === 0 && closed.counted === exp, 'shift closed balanced: expected = counted = ' + exp);
  await shot('32-z');
  await closeSheets();

  console.log('Every screen renders');
  for (const r of ['Stock', 'Reports', 'Menu', 'Settings', 'Orders', 'Drawer']) {
    await page.click('.rail-btn:has-text("' + r + '")');
    await page.waitForTimeout(450);
    await shot('40-' + r.toLowerCase());
    ok((await page.locator('.view .empty:has-text("hit a problem")').count()) === 0, r + ' rendered');
  }
  await page.click('.rail-btn:has-text("Reports")');
  for (const rg of ['Yesterday', '7 days', '30 days']) {
    await page.click('.seg button:has-text("' + rg + '")');
    await page.waitForTimeout(400);
  }
  await shot('41-reports-7d');
  await page.click('.rail-btn:has-text("Stock")');
  await page.click('.view .row >> nth=0');
  await page.waitForSelector('.sheet >> text=Recent movements');
  await shot('42-stock-detail');
  await closeSheets();
  await page.click('button:has-text("Count")');
  await shot('43-count');
  await closeSheets();
  await page.click('.rail-btn:has-text("Menu")');
  await page.click('.view .row button.grow >> nth=0');
  await page.waitForSelector('.sheet >> text=Base recipe');
  await shot('44-menu-editor');
  await closeSheets();

  console.log('Persistence across reload');
  const nOrders = await st(() => M.state.today.length);
  await page.reload();
  await page.waitForSelector('.user-card');
  await page.click('.user-card:has-text("Owner")');
  await pin('1234');
  await page.waitForSelector('.page, .reg');
  ok((await st(() => M.state.today.length)) === nOrders, 'orders survive a reload');
  ok((await st(() => M.core.verifyStock())).diffs.length === 0, 'stock still equals the ledger after all operations');

  console.log('Offline reload (service worker)');
  await page.waitForTimeout(800);
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector('.user-card', { timeout: 10000 }).catch(() => null);
  ok(await page.locator('.user-card').count(), 'app loads with no network');
  await ctx.setOffline(false);

  console.log('Phone layout');
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'Asia/Manila' });
  const p2 = await phone.newPage();
  p2.on('pageerror', (e) => errors.push('phone: ' + e.message));
  await p2.goto(BASE);
  await p2.click('text=Explore with sample data');
  await p2.waitForSelector('.user-card', { timeout: 60000 });
  await p2.screenshot({ path: path.join(SHOTS, '50-phone-lock.png') });
  await p2.click('.user-card:has-text("Joy")');
  for (const d of '0000') await p2.keyboard.press(d);
  await p2.waitForSelector('.reg');
  if (!(await p2.evaluate(() => !!M.state.shift))) {
    await p2.click('.gate >> text=Open shift');
    await p2.click('.sheet >> text=Open shift');
  }
  await p2.click('.tile >> nth=0');
  if (await p2.locator('.sheet').count()) {
    await p2.locator('.opt').first().click();
    if (await p2.locator('.sheet >> text=Add to order').count()) await p2.click('.sheet >> text=Add to order');
  }
  await p2.waitForSelector('.cartbar .btn');
  await p2.screenshot({ path: path.join(SHOTS, '51-phone-register.png') });
  const overflow = await p2.evaluate(() => document.documentElement.scrollWidth > innerWidth || innerWidth !== 390);
  ok(!overflow, 'no horizontal scroll or zoom-out at 390 px');
  await p2.click('.cartbar .btn');
  await p2.screenshot({ path: path.join(SHOTS, '52-phone-ticket.png') });
  await p2.click('.sheet .charge');
  await p2.screenshot({ path: path.join(SHOTS, '53-phone-pay.png') });
  await p2.locator('.sheet .chip').first().click();
  await p2.waitForSelector('.change-hero');
  await p2.screenshot({ path: path.join(SHOTS, '54-phone-done.png') });
  await phone.close();

  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(failures ? '\n' + failures + ' FAILED' : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error('E2E crashed:', e);
  process.exit(1);
});
