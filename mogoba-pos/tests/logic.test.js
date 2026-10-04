'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../www/js/logic.js');

const line = (id, unit, qty, extra) => Object.assign({ id, itemId: 'i' + id, name: 'Item ' + id, unit, qty, mods: [] }, extra || {});

test('plain totals: no discount, non-VAT', () => {
  const t = L.totals({ lines: [line('a', 12000, 2), line('b', 15000, 1)] }, { vat: false });
  assert.equal(t.gross, 39000);
  assert.equal(t.subtotal, 39000);
  assert.equal(t.total, 39000);
  assert.equal(t.vat, 0);
  assert.equal(t.items, 3);
});

test('line discounts: pct and amount, capped at line gross', () => {
  const t = L.totals({ lines: [line('a', 12000, 2, { disc: { kind: 'pct', value: 50 } }), line('b', 2000, 1, { disc: { kind: 'amt', value: 5000 } })] }, {});
  assert.equal(t.lineDisc, 12000 + 2000);
  assert.equal(t.subtotal, 12000);
  assert.equal(t.total, 12000);
});

test('SC/PWD non-VAT: one of three diners on ₱450', () => {
  const t = L.totals({ lines: [line('a', 45000, 1)], disc: { kind: 'scpwd', count: 1, diners: 3 } }, { vat: false });
  assert.equal(t.eligible, 15000);
  assert.equal(t.orderDisc, 3000);
  assert.equal(t.vatRemoved, 0);
  assert.equal(t.total, 42000);
});

test('SC/PWD VAT-registered: exempt VAT then 20% (₱450 solo diner = ₱321.43)', () => {
  const t = L.totals({ lines: [line('a', 45000, 1)], disc: { kind: 'scpwd', count: 1, diners: 1 } }, { vat: true });
  assert.equal(t.vatExempt, 40179);
  assert.equal(t.vatRemoved, 4821);
  assert.equal(t.orderDisc, 8036);
  assert.equal(t.total, 32143);
  assert.equal(t.vatable, 0);
  assert.equal(t.vat, 0);
  assert.equal(t.vatable + t.vat + t.vatExempt - t.orderDisc, t.total);
});

test('SC/PWD VAT group meal keeps the receipt identity', () => {
  const t = L.totals({ lines: [line('a', 49000, 1), line('b', 15000, 2)], disc: { kind: 'scpwd', count: 2, diners: 5 } }, { vat: true });
  assert.equal(t.subtotal, 79000);
  assert.equal(t.eligible, 31600);
  assert.equal(t.vatable + t.vat + t.vatExempt - t.orderDisc, t.total);
  assert.equal(t.total, t.subtotal - t.orderDisc - t.vatRemoved);
});

test('SC/PWD count is clamped to diners', () => {
  const t = L.totals({ lines: [line('a', 10000, 1)], disc: { kind: 'scpwd', count: 9, diners: 2 } }, {});
  assert.equal(t.eligible, 10000);
  assert.equal(t.total, 8000);
});

test('VAT-registered regular discount splits VAT correctly', () => {
  const t = L.totals({ lines: [line('a', 11200, 1)], disc: { kind: 'pct', value: 10 } }, { vat: true });
  assert.equal(t.orderDisc, 1120);
  assert.equal(t.total, 10080);
  assert.equal(t.vatable, 9000);
  assert.equal(t.vat, 1080);
});

test('amount discount never exceeds subtotal', () => {
  const t = L.totals({ lines: [line('a', 5000, 1)], disc: { kind: 'amt', value: 99999 } }, {});
  assert.equal(t.total, 0);
});

test('cash payment computes change; non-cash cannot overpay', () => {
  const p = L.makePayment(52267, [], { method: 'cash', tendered: 60000 });
  assert.deepEqual([p.amount, p.change], [52267, 7733]);
  assert.throws(() => L.makePayment(10000, [], { method: 'gcash', tendered: 20000 }), /Only cash/);
  assert.throws(() => L.makePayment(10000, [{ amount: 10000 }], { method: 'cash', tendered: 100 }), /already fully paid/);
});

test('split payment: GCash part, cash rest', () => {
  const pays = [];
  pays.push(L.makePayment(50000, pays, { method: 'gcash', tendered: 20000, ref: ' 123 ' }));
  assert.equal(pays[0].ref, '123');
  pays.push(L.makePayment(50000, pays, { method: 'cash', tendered: 50000 }));
  assert.equal(L.due(50000, pays), 0);
  assert.equal(L.changeDue(pays), 20000);
});

test('refund allocation is pro-rata and the last refund closes the balance', () => {
  const o = { lines: [line('a', 12000, 2), line('b', 15000, 1)], disc: { kind: 'scpwd', count: 1, diners: 3 }, refunds: [] };
  o.totals = L.totals(o, {});
  const first = L.refundAmount(o, [{ lineId: 'a', qty: 1 }]);
  assert.equal(first, Math.round((12000 * o.totals.total) / o.totals.subtotal));
  o.refunds.push({ amount: first, lines: [{ lineId: 'a', qty: 1 }] });
  const rest = L.refundAmount(o, [{ lineId: 'a', qty: 1 }, { lineId: 'b', qty: 1 }]);
  assert.equal(first + rest, o.totals.total);
  o.refunds.push({ amount: rest, lines: [{ lineId: 'a', qty: 1 }, { lineId: 'b', qty: 1 }] });
  assert.equal(L.orderNet(o), 0);
  assert.equal(L.refundAmount(o, [{ lineId: 'a', qty: 5 }]), 0);
});

const menu = {
  items: {
    dos: { id: 'dos', cat: 'dosirak', recipe: [{ ing: 'chicken', qty: 150 }, { ing: 'rice', qty: 200 }], variants: [{ id: 'hb', recipe: [{ ing: 'hbsauce', qty: 30 }] }, { id: 'classic', recipe: [] }] },
  },
  mods: { add: { id: 'add', options: [{ id: 'cheese', recipe: [{ ing: 'mozz', qty: 30 }] }, { id: 'rice', recipe: [{ ing: 'rice', qty: 150 }] }] } },
};

test('recipe explosion: base + variant + add-ons, scaled by qty', () => {
  const l = { itemId: 'dos', variantId: 'hb', qty: 2, mods: [{ gid: 'add', oid: 'rice' }, { gid: 'add', oid: 'cheese' }] };
  assert.deepEqual(L.consumption([l], menu), { chicken: 300, rice: 700, hbsauce: 60, mozz: 60 });
  assert.deepEqual(L.consumption([{ itemId: null, qty: 3 }], menu), {});
});

test('makeable uses the scarcest ingredient; negative stock counts as zero', () => {
  const ings = { chicken: { onHand: 1000 }, rice: { onHand: 500 }, hbsauce: { onHand: 59 } };
  assert.equal(L.makeable(menu.items.dos, 'hb', ings), 1);
  assert.equal(L.makeable(menu.items.dos, 'classic', ings), 2);
  assert.equal(L.itemAvailability(menu.items.dos, ings), 2);
  ings.rice.onHand = -40;
  assert.equal(L.itemAvailability(menu.items.dos, ings), 0);
});

test('stock helpers: status, reorder suggestion, moving average', () => {
  assert.equal(L.stockStatus({ onHand: 0, reorder: 5 }), 'out');
  assert.equal(L.stockStatus({ onHand: 5, reorder: 5 }), 'low');
  assert.equal(L.stockStatus({ onHand: 6, reorder: 5 }), 'ok');
  assert.equal(L.suggestOrder({ onHand: 2500, par: 25000, buyFactor: 1000 }), 23);
  assert.equal(L.suggestOrder({ onHand: 30000, par: 25000, buyFactor: 1000 }), 0);
  assert.equal(L.avgCost(1000, 20, 1000, 30), 25);
  assert.equal(L.avgCost(-500, 20, 1000, 30), 30);
});

test('drawer: float + cash sales - cash refunds - voided cash + ins - outs', () => {
  const tot = L.emptyTot();
  tot.sales = { cash: 30000, gcash: 20000 };
  tot.refunds = { cash: 5000, gcash: 1000 };
  tot.voidsCash = 12000;
  tot.ins = 2000;
  tot.outs = 5000;
  const d = L.drawer({ float: 100000, tot });
  assert.equal(d.expected, 100000 + 30000 - 5000 - 12000 + 2000 - 5000);
  assert.equal(L.drawer({ float: 50000 }).expected, 50000);
});

test('denomination count', () => {
  assert.equal(L.countTotal({ 100000: 2, 50000: 1, 100: 7, cents: 133 }), 250000 + 700 + 133);
  assert.equal(L.countTotal({}), 0);
});

test('aggregate: net, refunds, voids, item allocation', () => {
  const mk = (id, lines, extra) => {
    const o = Object.assign({ id, status: 'paid', type: 'dine', day: '2026-10-04', paidAt: new Date(2026, 9, 4, 12, 5).getTime(), lines, payments: [], refunds: [], cogs: 1000 }, extra || {});
    o.totals = L.totals(o, {});
    o.payments = [{ method: 'cash', amount: o.totals.total }];
    return o;
  };
  const a = mk('a', [Object.assign(line('x', 12000, 2), { itemId: 'dos' })]);
  const b = mk('b', [line('y', 5000, 1)], { status: 'voided' });
  const c = mk('c', [Object.assign(line('z', 10000, 1), { itemId: 'dos' })]);
  c.refunds.push({ amount: 10000, method: 'cash', lines: [{ lineId: 'z', qty: 1 }], restock: true, cogs: 400 });
  const r = L.aggregate([a, b, c], menu);
  assert.equal(r.orders, 2);
  assert.equal(r.net, 24000);
  assert.equal(r.refunds, 10000);
  assert.deepEqual(r.voids, { count: 1, amount: 5000 });
  assert.equal(r.byPay.cash, 24000);
  assert.equal(r.byHour[12], 24000);
  assert.equal(r.cogs, 1600);
  assert.equal(r.byCat.dosirak, 24000);
});
