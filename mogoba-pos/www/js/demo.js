/* Mogoba POS: sample history for the demo: two weeks of trading built with the same
 * builders as live sales (so every number in Reports, Stock and Drawer reconciles).
 * Never pushed to sync. Wiped by Settings → Data → Start fresh. */
(function (M) {
  'use strict';
  const U = M.util;
  const L = M.logic;

  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const FOOD = [
    ['gimbap-dosirak', 14], ['chicken-dosirak', 12], ['tteokbokki', 9], ['ramyeon', 8], ['pork-dosirak', 6], ['gimbap', 7],
    ['chicken-box', 4], ['chicken-pops', 4], ['fries', 4], ['chicken-fries', 4], ['col-pop', 3], ['kimchi-tub', 1.1],
    ['fishcake-tub', 1], ['cucumber-kimchi', 0.6], ['pickled-radish', 0.5], ['extra-rice', 2.5], ['extra-mozz', 0.8],
  ];
  const DRINK = [
    ['mt-wintermelon', 5], ['mt-okinawa', 4], ['mt-taro', 3], ['mt-cookies', 3], ['mt-matcha', 2], ['mt-chocolate', 2], ['mt-redvelvet', 2],
    ['ft-wintermelon', 1.5], ['ft-strawberry', 1.2], ['ft-lychee', 1.4], ['ft-mango', 1.2], ['mc-dirty', 1.2], ['mc-latte', 1], ['mc-strawberry', 1],
    ['fs-blueberry', 0.8], ['fs-greenapple', 0.8], ['fs-lemon', 0.9], ['fs-passion', 0.8], ['fs-watermelon', 0.7],
    ['cf-spanish', 2], ['cf-americano', 1], ['cf-latte', 1.4], ['cf-macchiato', 0.6], ['cf-cappuccino', 0.6], ['sd-coke', 2], ['sd-water', 1],
  ];
  const BILAO = [['bilao-gimbap-s', 3], ['bilao-gimbap-m', 2], ['bilao-chicken', 2], ['bilao-bihon', 2], ['bilao-suyuk', 1.5]];
  const HOURS = [[9, 2], [10, 4], [11, 9], [12, 12], [13, 9], [14, 5], [15, 5], [16, 6], [17, 9], [18, 11], [19, 7]];
  const FLAV = [['classic', 3], ['honey', 3], ['spicy', 3], ['prinkle', 2]];
  const SIZE = [['s', 2], ['m', 5], ['l', 3]];
  /* Bought short and never restocked, so the demo ends with real low and out-of-stock alerts. */
  const NEGLECT = ['mozzarella', 'taro', 's_lychee', 'cheesepowder', 'tub'];

  async function generate(onProgress) {
    const S = M.state;
    const B = M.core.build;
    const rand = rng(20261004);
    const pick = (list) => {
      const total = list.reduce((s, x) => s + x[1], 0);
      let r = rand() * total;
      for (const x of list) if ((r -= x[1]) <= 0) return x[0];
      return list[list.length - 1][0];
    };
    const chance = (p) => rand() < p;
    const int = (a, b) => a + Math.floor(rand() * (b - a + 1));

    const DAYS = 14;
    const now = Date.now();
    const today = U.dayKey(now);
    const start = U.addDays(today, -DAYS);
    const [owner, mark, joy] = S.users;
    const ings = {};
    for (const k in S.ings) ings[k] = Object.assign({}, S.ings[k], { onHand: 0 });
    const ctx = { settings: S.settings, meta: Object.assign({}, S.meta, { createdAt: U.dayStart(start) }), shift: null, user: owner, ings, menu: M.core.menu() };
    const out = { orders: [], moves: [], shifts: [], cash: [], counts: [], audit: [] };
    const apply = (b) => {
      for (const k in b.ings) ings[k] = b.ings[k];
      if (b.moves) out.moves.push(...b.moves);
    };
    const audit = (at, by, action, detail, approver) => out.audit.push({ id: U.uid(), at, by: { id: by.id, name: by.name }, approver: approver ? { id: approver.id, name: approver.name } : null, action, detail });
    const T = (day, h, m) => U.dayStart(day) + (h * 60 + m) * 60000 + Math.floor(rand() * 50000);

    for (let d = 0; d <= DAYS; d++) {
      const day = U.addDays(start, d);
      const isToday = day === today;
      const dow = new Date(U.dayStart(day)).getDay();
      const weekend = dow === 0 || dow === 6;

      /* 08:00 deliveries */
      ctx.user = owner;
      const rows = [];
      for (const k in ings) {
        const ing = ings[k];
        const neglect = NEGLECT.includes(k);
        if (neglect && d > 0) continue;
        if (d > 0 && ing.onHand > ing.reorder * 1.6) continue;
        const target = neglect ? ing.par * 0.45 : ing.par;
        const units = Math.ceil(Math.max(0, target - ing.onHand) / ing.buyFactor - 1e-9);
        if (units <= 0) continue;
        rows.push({ ing: k, qty: units * ing.buyFactor, unitCost: ing.cost * (0.96 + rand() * 0.08), exp: ing.shelfLife ? U.addDays(day, ing.shelfLife) : '' });
      }
      if (rows.length) {
        const at = T(day, 8, 0);
        apply(B.buildReceive(ctx, rows, { supplier: d === 0 ? 'Opening stock' : 'Aparri market & suppliers' }, at));
        audit(at, owner, 'stock.receive', rows.length + ' items');
      }
      if (isToday && now < T(day, 8, 46)) break;

      /* open shift */
      const cashier = dow === 0 ? mark : joy;
      ctx.user = cashier;
      ctx.shift = B.buildOpenShift(ctx, 100000, T(day, 8, 45));
      audit(ctx.shift.openedAt, cashier, 'shift.open', 'Float ₱1,000.00');

      /* orders */
      const n = weekend ? int(55, 68) : int(36, 50);
      const times = [];
      for (let i = 0; i < n; i++) times.push(T(day, pick(HOURS), int(0, 59)));
      times.sort((a, b) => a - b);
      const bilaoCount = chance(0.6) ? int(1, 2) : 0;
      for (let i = 0; i < times.length; i++) {
        const at = times[i];
        if (isToday && at > now - 60000) break;
        const cart = M.core.newCart();
        cart.createdAt = at - int(60, 400) * 1000;
        const type = pick([['dine', 50], ['take', 40], ['delivery', 10]]);
        cart.type = type;
        if (type === 'dine') cart.table = String(int(1, 8));
        if (type === 'delivery') cart.channel = pick([['foodpanda', 5], ['grab', 3], ['own', 2]]);
        const want = [];
        if (i < bilaoCount && i < 3) want.push([pick(BILAO), 1]);
        const foods = type === 'dine' ? int(1, 3) : int(1, 2);
        for (let f = 0; f < foods; f++) want.push([pick(FOOD), chance(0.15) ? 2 : 1]);
        if (chance(0.58)) want.push([pick(DRINK), chance(0.25) ? 2 : 1]);
        if (chance(0.15)) want.push([pick(DRINK), 1]);
        for (const [id, qty] of want) {
          const item = S.items[id];
          if (!item) continue;
          let variant = null;
          if (item.variants) {
            const vid = item.variantLabel === 'Size' ? pick(SIZE) : item.variantLabel === 'Flavour' ? pick(FLAV) : item.variants[int(0, item.variants.length - 1)].id;
            variant = item.variants.find((v) => v.id === vid) || item.variants[0];
          }
          const mods = [];
          if ((item.addons || []).includes('addon') && chance(item.id === 'tteokbokki' ? 0.35 : 0.12)) {
            const g = S.mods.addon;
            const o = item.id === 'tteokbokki' ? g.options.find((x) => x.id === 'mozz') : g.options[int(0, g.options.length - 1)];
            mods.push({ gid: g.id, oid: o.id, name: o.name, price: o.price });
          }
          /* the cashier would have marked a sold-out dish unavailable */
          const probe = { itemId: item.id, variantId: variant ? variant.id : '', mods: mods.map((m) => ({ gid: m.gid, oid: m.oid })), qty };
          const use = L.consumption([probe], ctx.menu);
          let ok = true;
          for (const k in use) if (ings[k] && ings[k].onHand < use[k]) ok = false;
          if (!ok) continue;
          const unit = (variant ? variant.price : item.price) + mods.reduce((s, m) => s + m.price, 0);
          const note = item.cat === 'milktea' && chance(0.2) ? 'Less sugar' : item.id === 'tteokbokki' && chance(0.15) ? 'Extra spicy' : '';
          cart.lines.push({ id: U.uid(), itemId: item.id, name: item.name, cat: item.cat, variantId: variant ? variant.id : '', variantName: variant ? variant.name : '', mods, unit, qty, note, sent: type === 'dine' });
        }
        if (!cart.lines.length) continue;
        let approver = null;
        if (chance(0.05)) {
          const diners = Math.max(1, Math.min(4, cart.lines.length + int(-1, 1)));
          cart.disc = { kind: 'scpwd', count: 1, diners, people: [{ type: chance(0.6) ? 'SC' : 'PWD', name: 'Sample guest ' + (out.orders.length + 1), idNo: 'DEMO-' + U.pad(int(1, 99999), 5) }] };
        } else if (chance(0.02)) {
          approver = mark;
          cart.disc = { kind: 'pct', value: 10, reason: 'Suki discount', approver: { id: mark.id, name: mark.name } };
        }
        const total = L.totals(cart, { vat: !!S.settings.business.vat }).total;
        const method = type === 'delivery' && cart.channel !== 'own' ? cart.channel : pick([['cash', 68], ['gcash', 27], ['maya', 5]]);
        let pays;
        if (method === 'cash') {
          const steps = [total, Math.ceil(total / 5000) * 5000, Math.ceil(total / 10000) * 10000, Math.ceil(total / 50000) * 50000, 100000];
          const tendered = steps.filter((x) => x >= total)[int(0, 3)] || total;
          pays = [L.makePayment(total, [], { method: 'cash', tendered })];
        } else {
          pays = [L.makePayment(total, [], { method, tendered: total, ref: method === 'gcash' || method === 'maya' ? String(int(1000000000, 9999999999)) : '' })];
        }
        ctx.user = chance(0.85) ? cashier : mark;
        const b = B.buildSale(ctx, cart, pays, at);
        b.order.kitchen = 'done';
        apply(b);
        ctx.meta = b.meta;
        ctx.shift = b.shift;
        out.orders.push(b.order);
        if (approver) audit(at, ctx.user, 'discount', b.order.no + ' · 10% Suki discount', approver);
      }

      /* a void and a partial refund every few days */
      ctx.user = cashier;
      const dayOrders = out.orders.filter((o) => o.day === day && o.status === 'paid');
      if (d % 3 === 1 && dayOrders.length > 10) {
        const idx = int(3, dayOrders.length - 3);
        const o = dayOrders[idx];
        const at = o.paidAt + 4 * 60000;
        const b = B.buildVoid(ctx, o, { reason: 'Customer cancelled before food was made', restock: true, approver: mark }, at);
        apply(b);
        ctx.shift = b.shift;
        out.orders[out.orders.indexOf(o)] = b.order;
        audit(at, cashier, 'void', o.no + ' · Customer cancelled', mark);
      }
      if (d % 4 === 2 && dayOrders.length > 12) {
        const o = dayOrders.find((x, j) => j > 6 && x.status === 'paid' && x.lines.length >= 2 && x.payments[0].method === 'cash');
        if (o) {
          const at = o.paidAt + 9 * 60000;
          const b = B.buildRefund(ctx, o, { picks: [{ lineId: o.lines[0].id, qty: 1 }], reason: 'Wrong flavour served', restock: false, method: 'cash', approver: mark }, at);
          apply(b);
          ctx.shift = b.shift;
          out.orders[out.orders.indexOf(o)] = b.order;
          audit(at, cashier, 'refund', o.no + ' · ' + U.peso(b.refund.amount) + ' · Wrong flavour served', mark);
        }
      }

      /* petty cash */
      if (chance(0.6)) {
        const at = T(day, 10, int(0, 50));
        const b = B.buildCash(ctx, 'out', int(6, 12) * 1000, 'Ice', mark, at);
        ctx.shift = b.shift;
        out.cash.push(b.entry);
      }
      if (d % 4 === 3) {
        const at = T(day, 14, int(0, 50));
        const b = B.buildCash(ctx, 'out', 115000, 'LPG refill', mark, at);
        ctx.shift = b.shift;
        out.cash.push(b.entry);
      }

      if (isToday) break;

      /* end of day: waste, weekly count, close */
      const wrows = [{ ing: 'rice', qty: int(3, 7) * 100 }];
      if (d % 3 === 0) wrows.push({ ing: 'oil', qty: 3000 });
      if (chance(0.3)) wrows.push({ ing: 'kimchi', qty: int(2, 5) * 100 });
      apply(B.buildWaste(ctx, wrows, d % 3 === 0 ? 'Oil change and leftover rice' : 'Leftover rice', T(day, 20, 5)));
      /* closing check: anything past its use-by date tomorrow is thrown out */
      const expired = [];
      for (const k in ings) for (const lot of L.lotsOf(ings[k])) if (lot.exp && lot.exp <= day && lot.qty > 0) expired.push({ ing: k, qty: lot.qty, lot: lot.id });
      if (expired.length) apply(B.buildWaste(ctx, expired, 'Expired', T(day, 20, 8)));
      if (d === 7 || d === DAYS - 1) {
        ctx.user = owner;
        const crow = ['chicken', 'pork', 'rice', 'oil', 'kimchi', 'tteok', 'pearls', 'cup_m', 'box_dosirak', 'seaweed'].map((k) => {
          const ing = ings[k];
          const loss = ing.unit === 'pc' ? -int(0, 3) : -Math.round(ing.onHand * (0.005 + rand() * 0.03));
          return { ing: k, counted: Math.max(0, Math.round((ing.onHand + loss) * 10) / 10) };
        });
        const b = B.buildCount(ctx, crow, 'Weekly count', T(day, 20, 10));
        apply(b);
        out.counts.push(b.count);
        ctx.user = cashier;
      }
      const dr = L.drawer(ctx.shift);
      const diff = chance(0.7) ? 0 : pick([[-2000, 2], [-500, 3], [1000, 2], [-10000, 0.5]]);
      const counted = dr.expected + diff;
      const counts = {};
      let rest = counted;
      for (const den of L.DENOMS) {
        counts[den] = Math.floor(rest / den);
        rest -= counts[den] * den;
      }
      counts.cents = rest;
      const b = B.buildCloseShift(ctx, counts, diff ? 'Checked twice' : '', T(day, 20, 15));
      ctx.meta = b.meta;
      out.shifts.push(b.shift);
      audit(b.shift.closedAt, cashier, 'shift.close', 'Z' + b.shift.zNo + ' · ' + (diff === 0 ? 'balanced' : (diff > 0 ? 'over ' : 'short ') + U.peso(Math.abs(diff))));
      ctx.shift = null;
      if (onProgress) onProgress((d + 1) / (DAYS + 1));
    }
    if (ctx.shift) out.shifts.push(ctx.shift);
    /* the last few of today's orders are still in the kitchen */
    out.orders
      .filter((o) => o.day === today && o.status === 'paid')
      .filter((o) => now - o.paidAt < 25 * 60000)
      .slice(-3)
      .forEach((o, i, a) => (o.kitchen = i === a.length - 1 ? 'prep' : 'ready'));

    const meta = Object.assign({}, ctx.meta, { demo: true, lastBackup: Date.now() });
    await M.db.write(['orders', 'moves', 'ings', 'shifts', 'cash', 'counts', 'audit', 'kv'], (t) => {
      for (const o of out.orders) t.put('orders', o);
      for (const m of out.moves) t.put('moves', m);
      for (const k in ings) t.put('ings', ings[k]);
      for (const s of out.shifts) t.put('shifts', s);
      for (const c of out.cash) t.put('cash', c);
      for (const c of out.counts) t.put('counts', c);
      for (const a of out.audit) t.put('audit', a);
      t.put('kv', { k: 'meta', v: meta });
    });
    sampleOnline(now);
    return { orders: out.orders.length, moves: out.moves.length };
  }

  /* Two website orders so Orders > Online has something to show: one waiting for the GCash
   * check, one already picked up. Same record shape the customer site writes. */
  function sampleOnline(now) {
    const S = M.state;
    const it = (id, vid, qty, mods) => {
      const item = S.items[id];
      const v = vid ? item.variants.find((x) => x.id === vid) : null;
      const ms = (mods || []).map((oid) => {
        const o = S.mods.addon.options.find((x) => x.id === oid);
        return { gid: 'addon', oid, name: o.name, price: o.price };
      });
      return { itemId: id, variantId: vid || '', name: item.name, variantName: v ? v.name : '', mods: ms, unit: (v ? v.price : item.price) + ms.reduce((t, m) => t + m.price, 0), qty, note: '' };
    };
    const rec = (code, minsAgo, status, method, lines, extra) => {
      const at = now - minsAgo * 60000;
      const subtotal = lines.reduce((t, l) => t + l.unit * l.qty, 0);
      return Object.assign(
        {
          code,
          token: U.randHex(16),
          clientId: U.uid(),
          createdAt: at,
          updatedAt: at,
          status,
          customer: { name: 'Sample customer', phone: '09171234567' },
          fulfillment: { type: 'pickup', time: 'asap', address: '', landmark: '' },
          lines,
          subtotal,
          deliveryFee: 0,
          total: subtotal,
          payment: { method, ref: method === 'cash' ? '' : '1012345678901', sender: method === 'cash' ? '' : 'Sample C.', proof: '', verified: false },
          note: '',
          reason: '',
          etaAt: 0,
          timeline: [{ status: 'pending', at, by: 'customer' }],
          posOrderId: '',
        },
        extra || {}
      );
    };
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.indexOf('mogoba.bridge.order.') === 0) localStorage.removeItem(k);
      }
      const a = rec('MGB-2041', 3, 'pending', 'gcash', [it('chicken-dosirak', 'honey', 2, ['mozz']), it('mt-wintermelon', 'l', 1)]);
      const b = rec('MGB-1987', 95, 'completed', 'cash', [it('gimbap-dosirak', null, 1)], { timeline: [{ status: 'pending', at: now - 95 * 60000, by: 'customer' }, { status: 'accepted', at: now - 92 * 60000, by: 'register' }, { status: 'ready', at: now - 75 * 60000, by: 'register' }, { status: 'completed', at: now - 70 * 60000, by: 'register' }], updatedAt: now - 70 * 60000 });
      localStorage.setItem('mogoba.bridge.order.' + a.code, JSON.stringify(a));
      localStorage.setItem('mogoba.bridge.order.' + b.code, JSON.stringify(b));
    } catch (e) {
      /* storage blocked: the Online tab simply starts empty */
    }
  }

  M.demo = { generate };
})((window.M = window.M || {}));
