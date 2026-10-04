/* Mogoba POS: pure business logic (no DOM, no storage).
 * Money is always integer centavos. Quantities of ingredients are base units (g, ml, pc).
 * Loaded as a classic script in the app (window.M.logic) and as a CommonJS module in tests. */
(function (root, factory) {
  const L = factory();
  if (typeof module === 'object' && module.exports) module.exports = L;
  else { root.M = root.M || {}; root.M.logic = L; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VAT_RATE = 0.12;
  const SC_RATE = 0.20;

  /* Half-away-from-zero rounding to whole centavos. */
  const rnd = (x) => (x < 0 ? -Math.round(-x) : Math.round(x));
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

  /* ---------- lines ---------- */

  function lineGross(line) {
    return line.unit * line.qty;
  }

  function lineDiscount(line) {
    const g = lineGross(line);
    const d = line.disc;
    if (!d || g <= 0) return 0;
    if (d.kind === 'pct') return clamp(rnd((g * d.value) / 100), 0, g);
    if (d.kind === 'amt') return clamp(d.value, 0, g);
    return 0;
  }

  function lineNet(line) {
    return lineGross(line) - lineDiscount(line);
  }

  /* Identity used to merge repeated taps of the same thing into one line. */
  function lineKey(line) {
    const mods = (line.mods || []).map((m) => m.gid + ':' + m.oid).sort().join(',');
    return [line.itemId || 'custom:' + line.name + ':' + line.unit, line.variantId || '', mods, line.note || ''].join('|');
  }

  /* ---------- order totals ----------
   * cfg.vat: business is VAT-registered (menu prices are VAT-inclusive).
   * Order discount kinds:
   *   pct   {value: 0..100}
   *   amt   {value: centavos}
   *   scpwd {count, diners}: RA 9994 / RA 10754, 20% off the eligible share, plus VAT
   *         exemption on that share when VAT-registered. Group meals are pro-rated by
   *         count/diners. Cannot be combined with another order discount (one at a time). */
  function totals(order, cfg) {
    const vatOn = !!(cfg && cfg.vat);
    let gross = 0;
    let lineDisc = 0;
    for (const l of order.lines) {
      gross += lineGross(l);
      lineDisc += lineDiscount(l);
    }
    const subtotal = gross - lineDisc;
    const d = order.disc;
    let orderDisc = 0;
    let eligible = 0;
    let exemptBase = 0;
    let vatRemoved = 0;
    if (d && subtotal > 0) {
      if (d.kind === 'pct') orderDisc = clamp(rnd((subtotal * d.value) / 100), 0, subtotal);
      else if (d.kind === 'amt') orderDisc = clamp(d.value, 0, subtotal);
      else if (d.kind === 'scpwd') {
        const diners = Math.max(1, d.diners | 0);
        const count = clamp(d.count | 0, 1, diners);
        eligible = rnd((subtotal * count) / diners);
        exemptBase = vatOn ? rnd(eligible / (1 + VAT_RATE)) : eligible;
        vatRemoved = eligible - exemptBase;
        orderDisc = rnd(exemptBase * SC_RATE);
      }
    }
    const total = subtotal - orderDisc - vatRemoved;
    let vatable = 0;
    let vat = 0;
    let vatExempt = 0;
    if (vatOn) {
      const taxedGross = subtotal - eligible - (d && d.kind !== 'scpwd' ? orderDisc : 0);
      vatable = rnd(taxedGross / (1 + VAT_RATE));
      vat = taxedGross - vatable;
      vatExempt = exemptBase;
    }
    return {
      gross,
      lineDisc,
      subtotal,
      orderDisc,
      eligible,
      vatRemoved,
      discountTotal: lineDisc + orderDisc + vatRemoved,
      total,
      vatable,
      vat,
      vatExempt,
      items: order.lines.reduce((s, l) => s + l.qty, 0),
    };
  }

  /* ---------- payments ---------- */

  function paid(payments) {
    return (payments || []).reduce((s, p) => s + p.amount, 0);
  }

  function due(total, payments) {
    return total - paid(payments);
  }

  /* Returns the payment record to append, or throws with a cashier-readable message. */
  function makePayment(total, payments, input) {
    const remaining = due(total, payments);
    if (remaining <= 0) throw new Error('This order is already fully paid.');
    const tendered = Math.round(input.tendered);
    if (!(tendered > 0)) throw new Error('Enter an amount greater than zero.');
    if (input.method === 'cash') {
      const amount = Math.min(tendered, remaining);
      return { method: 'cash', amount, tendered, change: tendered - amount, ref: '' };
    }
    if (tendered > remaining) throw new Error('Only cash can be more than the amount due.');
    return { method: input.method, amount: tendered, tendered, change: 0, ref: (input.ref || '').trim() };
  }

  function changeDue(payments) {
    return (payments || []).reduce((s, p) => s + (p.change || 0), 0);
  }

  /* ---------- refunds ---------- */

  function refundedQty(order, lineId) {
    let q = 0;
    for (const r of order.refunds || []) for (const x of r.lines) if (x.lineId === lineId) q += x.qty;
    return q;
  }

  function refundedTotal(order) {
    return (order.refunds || []).reduce((s, r) => s + r.amount, 0);
  }

  /* picks: [{lineId, qty}]. Allocates order-level discounts and VAT removal pro-rata,
   * and returns exactly the remaining balance when everything left is being refunded. */
  function refundAmount(order, picks) {
    const t = order.totals;
    const remainingMoney = t.total - refundedTotal(order);
    if (remainingMoney <= 0) return 0;
    let share = 0;
    let all = true;
    for (const l of order.lines) {
      const left = l.qty - refundedQty(order, l.id);
      const pick = picks.find((p) => p.lineId === l.id);
      const q = pick ? clamp(pick.qty | 0, 0, left) : 0;
      if (q !== left) all = false;
      share += (lineNet(l) * q) / l.qty;
    }
    if (all) return remainingMoney;
    if (t.subtotal <= 0) return 0;
    return clamp(rnd((share * t.total) / t.subtotal), 0, remainingMoney);
  }

  function orderNet(order) {
    if (order.status === 'voided') return 0;
    return order.totals.total - refundedTotal(order);
  }

  /* ---------- recipes & stock ---------- */

  /* Ingredient use for ONE unit of a line: base recipe + chosen variant + chosen add-ons. */
  function unitRecipe(line, menu) {
    const out = {};
    const add = (rows) => {
      for (const r of rows || []) out[r.ing] = (out[r.ing] || 0) + r.qty;
    };
    const item = line.itemId ? menu.items[line.itemId] : null;
    if (!item) return out;
    add(item.recipe);
    if (line.variantId && item.variants) {
      const v = item.variants.find((x) => x.id === line.variantId);
      if (v) add(v.recipe);
    }
    for (const m of line.mods || []) {
      const g = menu.mods[m.gid];
      const o = g && g.options.find((x) => x.id === m.oid);
      if (o) add(o.recipe);
    }
    return out;
  }

  /* Total ingredient use for a set of lines (qty-scaled). Map ing -> qty. */
  function consumption(lines, menu, qtyOf) {
    const out = {};
    for (const l of lines) {
      const q = qtyOf ? qtyOf(l) : l.qty;
      if (!q) continue;
      const per = unitRecipe(l, menu);
      for (const k in per) out[k] = (out[k] || 0) + per[k] * q;
    }
    return out;
  }

  function costOf(use, ings) {
    let c = 0;
    for (const k in use) {
      const ing = ings[k];
      if (ing) c += use[k] * (ing.cost || 0);
    }
    return rnd(c);
  }

  /* How many more of item/variant can be made from stock on hand (add-ons ignored). */
  function makeable(item, variantId, ings) {
    const per = {};
    for (const r of item.recipe || []) per[r.ing] = (per[r.ing] || 0) + r.qty;
    if (variantId && item.variants) {
      const v = item.variants.find((x) => x.id === variantId);
      if (v) for (const r of v.recipe || []) per[r.ing] = (per[r.ing] || 0) + r.qty;
    }
    let n = Infinity;
    for (const k in per) {
      if (!(per[k] > 0)) continue;
      const ing = ings[k];
      if (!ing) continue;
      n = Math.min(n, Math.floor(Math.max(0, ing.onHand) / per[k] + 1e-9));
    }
    return n;
  }

  /* Best case across variants: an item is available if any variant can be made. */
  function itemAvailability(item, ings) {
    if (!item.variants || !item.variants.length) return makeable(item, null, ings);
    let best = 0;
    for (const v of item.variants) best = Math.max(best, makeable(item, v.id, ings));
    return best;
  }

  function stockStatus(ing) {
    if (ing.onHand <= 0) return 'out';
    if (ing.onHand <= (ing.reorder || 0)) return 'low';
    return 'ok';
  }

  /* Suggested purchase, rounded up to whole buying units (kg, L, pack...). */
  function suggestOrder(ing) {
    const need = (ing.par || 0) - ing.onHand;
    if (need <= 0) return 0;
    const f = ing.buyFactor || 1;
    return Math.ceil(need / f - 1e-9);
  }

  /* Moving-average unit cost after receiving qty at unitCost. Negative on-hand is treated as 0. */
  function avgCost(onHand, cost, qty, unitCost) {
    const base = Math.max(0, onHand);
    if (base + qty <= 0) return unitCost;
    return (base * (cost || 0) + qty * unitCost) / (base + qty);
  }

  /* ---------- lots & expiry ----------
   * Each ingredient keeps lots: [{id, qty, exp: 'YYYY-MM-DD' or '', at, cost}].
   * Stock leaves first-expiry-first-out (undated lots last). The lots always sum to
   * max(0, onHand), so the ledger stays the single source of truth for quantity. */
  const r3 = (x) => Math.round(x * 1000) / 1000;
  const lotKey = (l) => (l.exp || '9999-12-31') + '|' + String(l.at || 0).padStart(15, '0');
  function sortLots(lots) {
    return (lots || []).slice().sort((a, b) => (lotKey(a) < lotKey(b) ? -1 : lotKey(a) > lotKey(b) ? 1 : 0));
  }
  function lotsTotal(lots) {
    return r3((lots || []).reduce((s, l) => s + l.qty, 0));
  }
  /* Older records have no lots: treat what is on hand as one undated lot. */
  function lotsOf(ing) {
    if (Array.isArray(ing.lots)) return ing.lots;
    return ing.onHand > 0 ? [{ id: 'undated', qty: ing.onHand, exp: '', at: 0 }] : [];
  }
  /* Take qty first-expiry-first-out; preferId is taken first (writing off one lot). */
  function takeLots(lots, qty, preferId) {
    let need = Math.max(0, qty);
    const order = sortLots(lots);
    if (preferId) {
      const i = order.findIndex((l) => l.id === preferId);
      if (i > 0) order.unshift(order.splice(i, 1)[0]);
    }
    const out = [];
    const taken = [];
    for (const l of order) {
      if (need > 1e-9) {
        const t = Math.min(l.qty, need);
        need -= t;
        if (t > 0) taken.push({ id: l.id, qty: r3(t), exp: l.exp || '' });
        const left = r3(l.qty - t);
        if (left > 1e-9) out.push(Object.assign({}, l, { qty: left }));
      } else out.push(l);
    }
    return { lots: sortLots(out), taken, short: r3(Math.max(0, need)) };
  }
  /* Lots with the same expiry date merge, so the list stays short. */
  function addLot(lots, lot) {
    if (!(lot.qty > 0)) return sortLots(lots);
    const exp = lot.exp || '';
    const same = (lots || []).find((l) => (l.exp || '') === exp);
    if (same) return sortLots(lots.map((l) => (l === same ? Object.assign({}, l, { qty: r3(l.qty + lot.qty) }) : l)));
    return sortLots((lots || []).concat([Object.assign({}, lot, { exp, qty: r3(lot.qty) })]));
  }
  /* Restocked items (void, refund) go back to the lot they most likely came from. */
  function returnLots(lots, qty, at) {
    if (!(qty > 0)) return sortLots(lots);
    const s = sortLots(lots);
    if (!s.length) return [{ id: 'undated', qty: r3(qty), exp: '', at: at || 0 }];
    s[0] = Object.assign({}, s[0], { qty: r3(s[0].qty + qty) });
    return s;
  }
  function fitLots(lots, onHand) {
    const total = lotsTotal(lots);
    const target = Math.max(0, onHand);
    if (total > target + 1e-6) return takeLots(lots, total - target).lots;
    if (total < target - 1e-6) return addLot(lots, { id: 'undated', qty: r3(target - total), exp: '', at: 0 });
    return sortLots(lots);
  }
  function daysUntil(exp, today) {
    const p = (k) => {
      const [y, m, d] = k.split('-').map(Number);
      return Date.UTC(y, m - 1, d);
    };
    return Math.round((p(exp) - p(today)) / 864e5);
  }
  /* "Soon" scales with shelf life: same day for 1-day items (tea base), 1 day for chicken,
   * up to 3 days for long-life stock. */
  function soonWindow(ing) {
    const life = ing.shelfLife || 0;
    return life > 0 ? Math.min(3, Math.round(life * 0.25)) : 3;
  }
  function expiryState(exp, today, soonDays) {
    if (!exp) return 'none';
    const d = daysUntil(exp, today);
    if (d < 0) return 'expired';
    if (d <= (soonDays == null ? 3 : soonDays)) return 'soon';
    return 'ok';
  }
  /* The most urgent dated lot of an ingredient, or null. */
  function nextExpiry(ing, today) {
    const lot = sortLots(lotsOf(ing)).find((l) => l.exp && l.qty > 0);
    if (!lot) return null;
    return { lot, days: daysUntil(lot.exp, today), state: expiryState(lot.exp, today, soonWindow(ing)) };
  }

  /* ---------- shifts ---------- */

  /* Bills and coins from ₱1,000 down to ₱1; loose centavo coins are entered as one total. */
  const DENOMS = [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 100];

  function countTotal(counts) {
    let s = 0;
    for (const d of DENOMS) s += (counts[d] | 0) * d;
    return s + Math.max(0, Math.round(counts.cents || 0));
  }

  const emptyTot = () => ({ sales: {}, refunds: {}, voidsCash: 0, voids: 0, ins: 0, outs: 0, orders: 0, net: 0, disc: 0 });

  /* Cash the drawer should hold, from the shift's running totals (kept in the same
   * transaction as every sale, refund, void and cash in/out). */
  function drawer(shift) {
    const t = shift.tot || emptyTot();
    const cash = t.sales.cash || 0;
    const refunds = t.refunds.cash || 0;
    return { float: shift.float, cash, refunds, voids: t.voidsCash, ins: t.ins, outs: t.outs, expected: shift.float + cash - refunds - t.voidsCash + t.ins - t.outs };
  }

  /* ---------- reports ---------- */

  function aggregate(orders, menu, opts) {
    const o2 = opts || {};
    const r = {
      orders: 0,
      gross: 0,
      discounts: 0,
      refunds: 0,
      net: 0,
      cogs: 0,
      vat: 0,
      voids: { count: 0, amount: 0 },
      voidWaste: 0,
      byHour: new Array(24).fill(0),
      byHourCount: new Array(24).fill(0),
      byDay: {},
      byPay: {},
      byType: {},
      byCat: {},
      items: {},
      scpwd: [],
      discounted: [],
    };
    for (const o of orders) {
      if (o.status === 'open') continue;
      if (o.status === 'voided') {
        r.voids.count++;
        r.voids.amount += o.totals.total;
        /* Voided after the kitchen made it: the stock is gone, so its cost is waste. */
        if (o.voidInfo && !o.voidInfo.restock) {
          let lost = o.cogs || 0;
          for (const rf of o.refunds || []) if (rf.restock) lost -= rf.cogs || 0;
          r.voidWaste += Math.max(0, lost);
        }
        continue;
      }
      const t = o.totals;
      const refunded = refundedTotal(o);
      const net = t.total - refunded;
      r.orders++;
      r.gross += t.gross;
      r.discounts += t.discountTotal;
      r.refunds += refunded;
      r.net += net;
      r.vat += t.total > 0 ? Math.round(((t.vat || 0) * net) / t.total) : 0;
      let cogs = o.cogs || 0;
      for (const rf of o.refunds || []) if (rf.restock) cogs -= rf.cogs || 0;
      r.cogs += cogs;
      const d = new Date(o.paidAt);
      r.byHour[d.getHours()] += net;
      r.byHourCount[d.getHours()]++;
      r.byDay[o.day] = (r.byDay[o.day] || 0) + net;
      r.byType[o.type] = (r.byType[o.type] || 0) + net;
      for (const p of o.payments) r.byPay[p.method] = (r.byPay[p.method] || 0) + p.amount;
      for (const rf of o.refunds || []) r.byPay[rf.method] = (r.byPay[rf.method] || 0) - rf.amount;
      const ratio = t.subtotal > 0 ? t.total / t.subtotal : 0;
      for (const l of o.lines) {
        const keptQty = l.qty - refundedQty(o, l.id);
        if (keptQty <= 0) continue;
        const amount = (lineNet(l) * keptQty * ratio) / l.qty;
        const key = (l.itemId || 'custom') + '|' + (l.variantId || '');
        const it = r.items[key] || (r.items[key] = { key, itemId: l.itemId, name: l.name, variant: l.variantName || '', qty: 0, net: 0 });
        it.qty += keptQty;
        it.net += amount;
        const item = l.itemId && menu && menu.items[l.itemId];
        const cat = item ? item.cat : 'custom';
        r.byCat[cat] = (r.byCat[cat] || 0) + amount;
      }
      if (o.disc && o.disc.kind === 'scpwd') r.scpwd.push(o);
      else if (o.disc || t.lineDisc > 0) r.discounted.push(o);
    }
    r.avg = r.orders ? Math.round(r.net / r.orders) : 0;
    r.profit = r.net - r.vat - r.cogs;
    r.foodCostPct = r.net - r.vat > 0 ? r.cogs / (r.net - r.vat) : 0;
    for (const k in r.items) r.items[k].net = rnd(r.items[k].net);
    for (const k in r.byCat) r.byCat[k] = rnd(r.byCat[k]);
    if (o2.keepOrders === false) {
      r.scpwd = r.scpwd.length;
      r.discounted = r.discounted.length;
    }
    return r;
  }

  return {
    VAT_RATE,
    SC_RATE,
    DENOMS,
    rnd,
    clamp,
    lineGross,
    lineDiscount,
    lineNet,
    lineKey,
    totals,
    paid,
    due,
    makePayment,
    changeDue,
    refundedQty,
    refundedTotal,
    refundAmount,
    orderNet,
    unitRecipe,
    consumption,
    costOf,
    makeable,
    itemAvailability,
    stockStatus,
    suggestOrder,
    avgCost,
    sortLots,
    lotsTotal,
    lotsOf,
    takeLots,
    addLot,
    returnLots,
    fitLots,
    daysUntil,
    soonWindow,
    expiryState,
    nextExpiry,
    countTotal,
    emptyTot,
    drawer,
    aggregate,
  };
});
