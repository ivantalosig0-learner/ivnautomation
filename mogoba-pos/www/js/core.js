/* Mogoba POS — domain core.
 * builders (build*) are pure functions of an explicit context and return records to write;
 * live operations wrap them in ONE IndexedDB transaction and update memory only after commit.
 * The demo-history generator uses the very same builders, so sample data has real shapes. */
(function (M) {
  'use strict';
  const U = M.util;
  const L = M.logic;
  const DB = M.db;

  const S = (M.state = {
    ready: false,
    settings: null,
    meta: null,
    user: null,
    users: [],
    cats: [],
    items: {},
    mods: {},
    ings: {},
    shift: null,
    open: [],
    today: [],
    cart: null,
    lastType: 'dine',
  });

  const PAY = {
    cash: 'Cash',
    gcash: 'GCash',
    maya: 'Maya',
    card: 'Card',
    foodpanda: 'Foodpanda',
    grab: 'GrabFood',
    other: 'Other',
    none: 'No charge',
  };
  const TYPES = { dine: 'Dine-in', take: 'Take-out', delivery: 'Delivery' };
  const ROLES = { owner: 'Owner', manager: 'Manager', cashier: 'Cashier' };
  const PERMS = {
    owner: ['*'],
    manager: ['sell', 'orders', 'shift', 'discount', 'void', 'refund', 'cash', 'stock', 'reports'],
    cashier: ['sell', 'orders', 'shift'],
  };

  const menu = () => ({ items: S.items, mods: S.mods });
  const r3 = (x) => Math.round(x * 1000) / 1000;
  const emptyTot = L.emptyTot;

  function can(perm, user) {
    const u = user || S.user;
    if (!u) return false;
    const p = PERMS[u.role] || [];
    return p.includes('*') || p.includes(perm);
  }

  function who(u) {
    return u ? { id: u.id, name: u.name } : null;
  }

  /* ---------------- builders (pure) ---------------- */

  /* Snapshot the ingredient use and unit cost on every line at sale time, so later
   * refunds, voids and cost reports use what the kitchen actually spent then. */
  function snapshotLines(lines, ctx) {
    return lines.map((l) => {
      const use = l.use || L.unitRecipe(l, ctx.menu);
      return Object.assign({}, l, { use, ucost: L.costOf(use, ctx.ings) });
    });
  }

  function stockMoves(ctx, use, sign, type, ref, at, note) {
    const moves = [];
    const ings = {};
    for (const id of Object.keys(use)) {
      const cur = ings[id] || ctx.ings[id];
      if (!cur || !use[id]) continue;
      const qty = r3(sign * use[id]);
      moves.push({ id: U.uid(), ing: id, qty, type, ref: ref || '', at, day: U.dayKey(at), cost: cur.cost, by: ctx.user ? ctx.user.id : '', note: note || '' });
      ings[id] = Object.assign({}, cur, { onHand: r3(cur.onHand + qty), updatedAt: at });
    }
    return { moves, ings };
  }

  function lineUseMap(lines, qtyOf) {
    const out = {};
    for (const l of lines) {
      const q = qtyOf ? qtyOf(l) : l.qty;
      if (!q) continue;
      for (const k in l.use || {}) out[k] = (out[k] || 0) + l.use[k] * q;
    }
    return out;
  }

  function bumpShift(shift, fn) {
    if (!shift) return null;
    const s = Object.assign({}, shift, { tot: JSON.parse(JSON.stringify(shift.tot || emptyTot())) });
    fn(s.tot);
    return s;
  }

  function buildSale(ctx, cart, payments, at) {
    const cfg = { vat: !!ctx.settings.business.vat };
    const lines = snapshotLines(cart.lines, ctx);
    const totals = L.totals({ lines, disc: cart.disc }, cfg);
    if (!lines.length) throw new Error('Add at least one item first.');
    if (L.due(totals.total, payments) > 0) throw new Error('The order is not fully paid yet.');
    if (!ctx.shift) throw new Error('Open a shift before taking payment.');
    const day = U.dayKey(at);
    const seq = (ctx.meta.seq || 0) + 1;
    const queue = ctx.meta.queueDay === day ? (ctx.meta.queueN || 0) + 1 : 1;
    const pays = payments.length ? payments : [{ method: 'none', amount: 0, tendered: 0, change: 0, ref: '' }];
    const cogs = Math.round(lines.reduce((s, l) => s + l.ucost * l.qty, 0));
    const order = Object.assign({}, cart, {
      lines,
      status: 'paid',
      held: false,
      totals,
      payments: pays,
      refunds: [],
      no: (ctx.settings.device.prefix || 'A') + '-' + U.pad(seq, 6),
      queue,
      paidAt: at,
      day,
      shiftId: ctx.shift.id,
      by: who(ctx.user),
      device: ctx.meta.deviceId,
      cogs,
      kitchen: 'prep',
      rev: (cart.rev || 0) + 1,
      updatedAt: at,
    });
    const st = stockMoves(ctx, lineUseMap(lines), -1, 'sale', order.id, at);
    const meta = Object.assign({}, ctx.meta, { seq, queueDay: day, queueN: queue });
    const shift = bumpShift(ctx.shift, (t) => {
      for (const p of pays) t.sales[p.method] = (t.sales[p.method] || 0) + p.amount;
      t.orders++;
      t.net += totals.total;
      t.disc += totals.discountTotal;
    });
    return { order, moves: st.moves, ings: st.ings, meta, shift };
  }

  function buildVoid(ctx, order, opts, at) {
    if (order.status !== 'paid') throw new Error('Only paid orders can be voided.');
    if (!ctx.shift) throw new Error('Open a shift first — the cash goes back out of the drawer.');
    const left = (l) => l.qty - L.refundedQty(order, l.id);
    const st = opts.restock ? stockMoves(ctx, lineUseMap(order.lines, left), 1, 'void', order.id, at, opts.reason) : { moves: [], ings: {} };
    const back = {};
    for (const p of order.payments) back[p.method] = (back[p.method] || 0) + p.amount;
    for (const rf of order.refunds || []) back[rf.method] = (back[rf.method] || 0) - rf.amount;
    const o = Object.assign({}, order, {
      status: 'voided',
      voidInfo: { at, reason: opts.reason, restock: !!opts.restock, by: who(ctx.user), approver: who(opts.approver), shiftId: ctx.shift.id },
      rev: (order.rev || 0) + 1,
      updatedAt: at,
    });
    const shift = bumpShift(ctx.shift, (t) => {
      t.voidsCash += Math.max(0, back.cash || 0);
      t.voids++;
      t.net -= L.orderNet(order);
      for (const k in back) if (k !== 'cash' && back[k] > 0) t.refunds[k] = (t.refunds[k] || 0) + back[k];
    });
    return { order: o, moves: st.moves, ings: st.ings, shift };
  }

  function buildRefund(ctx, order, opts, at) {
    if (order.status !== 'paid') throw new Error('Only paid orders can be refunded.');
    if (!ctx.shift) throw new Error('Open a shift first — refunds come out of the drawer.');
    const picks = opts.picks.filter((p) => p.qty > 0);
    if (!picks.length) throw new Error('Pick at least one item to refund.');
    const amount = L.refundAmount(order, picks);
    const qtyOf = (l) => {
      const p = picks.find((x) => x.lineId === l.id);
      return p ? Math.min(p.qty, l.qty - L.refundedQty(order, l.id)) : 0;
    };
    const use = lineUseMap(order.lines, qtyOf);
    const cogs = Math.round(order.lines.reduce((s, l) => s + (l.ucost || 0) * qtyOf(l), 0));
    const refund = {
      id: U.uid(),
      at,
      lines: order.lines.filter((l) => qtyOf(l) > 0).map((l) => ({ lineId: l.id, qty: qtyOf(l) })),
      amount,
      method: opts.method || 'cash',
      reason: opts.reason,
      restock: !!opts.restock,
      cogs,
      by: who(ctx.user),
      approver: who(opts.approver),
      shiftId: ctx.shift.id,
    };
    const st = opts.restock ? stockMoves(ctx, use, 1, 'refund', order.id, at, opts.reason) : { moves: [], ings: {} };
    const o = Object.assign({}, order, { refunds: (order.refunds || []).concat([refund]), rev: (order.rev || 0) + 1, updatedAt: at });
    const shift = bumpShift(ctx.shift, (t) => {
      t.refunds[refund.method] = (t.refunds[refund.method] || 0) + amount;
      t.net -= amount;
    });
    return { order: o, refund, moves: st.moves, ings: st.ings, shift };
  }

  function buildReceive(ctx, rows, note, at) {
    const moves = [];
    const ings = {};
    for (const row of rows) {
      const cur = ings[row.ing] || ctx.ings[row.ing];
      if (!cur || !(row.qty > 0)) continue;
      const unitCost = row.unitCost >= 0 ? row.unitCost : cur.cost;
      const cost = L.avgCost(cur.onHand, cur.cost, row.qty, unitCost);
      moves.push({ id: U.uid(), ing: row.ing, qty: r3(row.qty), type: 'receive', ref: note.ref || '', at, day: U.dayKey(at), cost: unitCost, by: ctx.user ? ctx.user.id : '', note: note.supplier || note.note || '' });
      ings[row.ing] = Object.assign({}, cur, { onHand: r3(cur.onHand + row.qty), cost, updatedAt: at });
    }
    if (!moves.length) throw new Error('Enter a quantity for at least one item.');
    return { moves, ings };
  }

  function buildWaste(ctx, rows, reason, at) {
    const use = {};
    for (const row of rows) if (row.qty > 0) use[row.ing] = (use[row.ing] || 0) + row.qty;
    const st = stockMoves(ctx, use, -1, 'waste', '', at, reason);
    if (!st.moves.length) throw new Error('Enter a quantity for at least one item.');
    return st;
  }

  function buildCount(ctx, rows, note, at) {
    const id = U.uid();
    const entries = [];
    const moves = [];
    const ings = {};
    for (const row of rows) {
      const cur = ctx.ings[row.ing];
      if (!cur || !(row.counted >= 0)) continue;
      const delta = r3(row.counted - cur.onHand);
      entries.push({ ing: row.ing, expected: cur.onHand, counted: row.counted, delta, cost: cur.cost });
      if (delta !== 0) {
        moves.push({ id: U.uid(), ing: row.ing, qty: delta, type: 'count', ref: id, at, day: U.dayKey(at), cost: cur.cost, by: ctx.user ? ctx.user.id : '', note: note || '' });
        ings[row.ing] = Object.assign({}, cur, { onHand: r3(row.counted), updatedAt: at, countedAt: at });
      } else {
        ings[row.ing] = Object.assign({}, cur, { countedAt: at });
      }
    }
    if (!entries.length) throw new Error('Enter at least one counted quantity.');
    const count = { id, at, day: U.dayKey(at), by: who(ctx.user), note: note || '', entries, value: Math.round(entries.reduce((s, e) => s + e.delta * e.cost, 0)) };
    return { count, moves, ings };
  }

  function buildOpenShift(ctx, float, at) {
    return { id: U.uid(), status: 'open', openedAt: at, openedBy: who(ctx.user), float, device: ctx.meta.deviceId, tot: emptyTot() };
  }

  const drawer = L.drawer;

  function buildCloseShift(ctx, counts, note, at) {
    const counted = L.countTotal(counts);
    const d = drawer(ctx.shift);
    const zNo = (ctx.meta.zSeq || 0) + 1;
    const shift = Object.assign({}, ctx.shift, { status: 'closed', closedAt: at, closedBy: who(ctx.user), counts, counted, expected: d.expected, overShort: counted - d.expected, note: note || '', zNo });
    return { shift, meta: Object.assign({}, ctx.meta, { zSeq: zNo }) };
  }

  function buildCash(ctx, type, amount, reason, approver, at) {
    if (!ctx.shift) throw new Error('Open a shift first.');
    if (!(amount > 0)) throw new Error('Enter an amount greater than zero.');
    const entry = { id: U.uid(), shiftId: ctx.shift.id, type, amount, reason, at, by: who(ctx.user), approver: who(approver) };
    const shift = bumpShift(ctx.shift, (t) => {
      if (type === 'in') t.ins += amount;
      else t.outs += amount;
    });
    return { entry, shift };
  }

  /* ---------------- live context & commit ---------------- */

  function ctx() {
    return { settings: S.settings, meta: S.meta, shift: S.shift, user: S.user, ings: S.ings, menu: menu() };
  }

  function outbox(t, kind, data, at) {
    t.add('outbox', { eid: U.uid(), kind, at: at || Date.now(), device: S.meta.deviceId, data });
  }

  function audit(t, action, detail, approver) {
    t.put('audit', { id: U.uid(), at: Date.now(), by: who(S.user), approver: who(approver), action, detail: detail || '' });
  }

  async function commit(stores, fn) {
    const all = Array.from(new Set(stores.concat(['outbox', 'audit'])));
    const after = await DB.write(all, fn);
    if (typeof after === 'function') after();
    M.bus.emit('change');
    if (M.sync) M.sync.kick();
  }

  function applyIngs(map) {
    for (const k in map) S.ings[k] = map[k];
  }

  function upsertToday(o) {
    if (o.day !== U.dayKey()) return;
    const i = S.today.findIndex((x) => x.id === o.id);
    if (i >= 0) S.today[i] = o;
    else S.today.push(o);
  }

  /* ---------------- boot & setup ---------------- */

  async function load() {
    await DB.open();
    const kv = {};
    for (const row of await DB.all('kv')) kv[row.k] = row.v;
    S.settings = kv.settings || null;
    S.meta = kv.meta || null;
    if (!S.meta || !S.settings) return false;
    const defaults = M.seed.SETTINGS();
    for (const k in defaults) S.settings[k] = Object.assign({}, defaults[k], S.settings[k] || {});
    S.users = (await DB.all('users')).sort((a, b) => (a.sort || 0) - (b.sort || 0));
    S.cats = (await DB.all('cats')).sort((a, b) => a.sort - b.sort);
    S.items = {};
    for (const it of await DB.all('items')) S.items[it.id] = it;
    S.mods = {};
    for (const m of await DB.all('mods')) S.mods[m.id] = m;
    S.ings = {};
    for (const i of await DB.all('ings')) S.ings[i.id] = i;
    S.shift = (await DB.byIndex('shifts', 'status', 'open'))[0] || null;
    S.open = (await DB.byIndex('orders', 'status', 'open')).sort((a, b) => a.createdAt - b.createdAt);
    S.today = await DB.byIndex('orders', 'day', U.dayKey());
    S.lastType = kv.lastType || 'dine';
    S.cart = kv.draft && kv.draft.lines ? kv.draft : newCart();
    S.ready = true;
    return true;
  }

  /* Day rolled over while the app stayed open (it happens with all-day tablets). */
  async function refreshToday() {
    S.today = await DB.byIndex('orders', 'day', U.dayKey());
  }

  function makeUser(name, role, pin, sort) {
    const salt = U.randHex(8);
    return { id: U.uid(), name, role, salt, pin: U.hashPin(pin, salt), active: true, sort: sort || 0, createdAt: Date.now() };
  }

  async function setup(opts) {
    const now = Date.now();
    const meta = { deviceId: U.uid(), seq: 0, zSeq: 0, queueDay: '', queueN: 0, demo: !!opts.demo, createdAt: now, lastBackup: 0, schema: 1 };
    const settings = M.seed.SETTINGS();
    const users = opts.demo
      ? [makeUser('Owner', 'owner', '1234', 0), makeUser('Mark', 'manager', '2580', 1), makeUser('Joy', 'cashier', '0000', 2)]
      : [makeUser(opts.owner.name, 'owner', opts.owner.pin, 0)];
    const clone = (x) => JSON.parse(JSON.stringify(x));
    const items = clone(M.seed.items);
    const ings = M.seed.ingredients(false);
    await DB.wipe();
    await DB.write(DB.STORES, (t) => {
      t.put('kv', { k: 'meta', v: meta });
      t.put('kv', { k: 'settings', v: settings });
      for (const u of users) t.put('users', u);
      for (const c of M.seed.CATS) t.put('cats', c);
      for (const it of items) t.put('items', it);
      for (const m of clone(M.seed.MODS)) t.put('mods', m);
      for (const i of ings) t.put('ings', i);
    });
    await load();
    if (opts.demo && M.demo) await M.demo.generate(opts.onProgress);
    await load();
  }

  /* ---------------- auth ---------------- */

  const fails = { n: 0, until: 0 };
  function checkPin(user, pin) {
    return !!user && user.active && U.hashPin(pin, user.salt) === user.pin;
  }
  async function login(userId, pin) {
    if (Date.now() < fails.until) throw new Error('Too many wrong PINs. Wait ' + Math.ceil((fails.until - Date.now()) / 1000) + ' s.');
    const u = S.users.find((x) => x.id === userId);
    if (!checkPin(u, pin)) {
      fails.n++;
      if (fails.n >= 5) {
        fails.until = Date.now() + 30000;
        fails.n = 0;
      }
      throw new Error('Wrong PIN.');
    }
    fails.n = 0;
    S.user = u;
    await DB.write(['audit'], (t) => audit(t, 'login', u.name));
    M.bus.emit('auth');
    return u;
  }
  /* Approver PIN: any active user with the permission. */
  function approverByPin(pin, perm) {
    if (Date.now() < fails.until) throw new Error('Too many wrong PINs. Wait ' + Math.ceil((fails.until - Date.now()) / 1000) + ' s.');
    const u = S.users.find((x) => x.active && can(perm, x) && checkPin(x, pin));
    if (!u) {
      fails.n++;
      if (fails.n >= 5) {
        fails.until = Date.now() + 30000;
        fails.n = 0;
      }
      throw new Error('That PIN cannot approve this.');
    }
    fails.n = 0;
    return u;
  }
  function logout() {
    S.user = null;
    M.bus.emit('auth');
  }

  /* ---------------- cart ---------------- */

  function newCart() {
    return { id: U.uid(), status: 'open', held: false, type: S.lastType || 'dine', table: '', customer: '', channel: '', lines: [], disc: null, payments: [], refunds: [], createdAt: Date.now(), rev: 0 };
  }

  const saveCart = U.debounce(() => persistCart(), 250);
  function persistCart() {
    const c = S.cart;
    if (!c || !S.ready) return Promise.resolve();
    if (c.held) return DB.write(['orders'], (t) => t.put('orders', c)).catch((e) => console.error(e));
    return DB.write(['kv'], (t) => t.put('kv', { k: 'draft', v: c })).catch((e) => console.error(e));
  }
  function cartChanged() {
    S.cart.updatedAt = Date.now();
    saveCart();
    M.bus.emit('cart');
  }

  function cartTotals() {
    return L.totals(S.cart, { vat: !!S.settings.business.vat });
  }

  function addLine(item, variant, mods, qty, note) {
    const unit = (variant ? variant.price : item.price) + (mods || []).reduce((s, m) => s + m.price, 0);
    const line = {
      id: U.uid(),
      itemId: item.id,
      name: item.name,
      cat: item.cat,
      variantId: variant ? variant.id : '',
      variantName: variant ? variant.name : '',
      mods: (mods || []).map((m) => ({ gid: m.gid, oid: m.oid, name: m.name, price: m.price })),
      unit,
      qty: qty || 1,
      note: note || '',
      sent: false,
    };
    const key = L.lineKey(line);
    const same = S.cart.lines.find((l) => !l.sent && !l.disc && L.lineKey(l) === key);
    if (same) same.qty += line.qty;
    else S.cart.lines.push(line);
    cartChanged();
    return same || line;
  }

  /* More of a line the kitchen already has: a new, unsent line so the kitchen sees the extra. */
  function addMore(lineId, qty) {
    const l = findLine(lineId);
    if (!l || !(qty > 0)) return;
    S.cart.lines.push(Object.assign({}, l, { id: U.uid(), qty, sent: false, disc: null }));
    cartChanged();
  }

  function addCustom(name, unit, qty) {
    const line = { id: U.uid(), itemId: null, name: name || 'Custom item', cat: 'custom', variantId: '', variantName: '', mods: [], unit, qty: qty || 1, note: '', sent: false };
    S.cart.lines.push(line);
    cartChanged();
    return line;
  }

  function findLine(id) {
    return S.cart.lines.find((l) => l.id === id);
  }

  function setQty(lineId, qty) {
    const l = findLine(lineId);
    if (!l) return;
    if (qty <= 0) S.cart.lines = S.cart.lines.filter((x) => x.id !== lineId);
    else l.qty = qty;
    cartChanged();
  }

  function patchLine(lineId, patch) {
    const l = findLine(lineId);
    if (!l) return;
    Object.assign(l, patch);
    cartChanged();
  }

  /* Taking back something the kitchen already started is logged; the food can be wasted. */
  async function removeSent(lineId, qty, approver, reason, wasted) {
    const l = findLine(lineId);
    if (!l) return;
    const take = Math.min(qty, l.qty);
    const at = Date.now();
    let st = { moves: [], ings: {} };
    if (wasted) {
      const use = L.unitRecipe(l, menu());
      for (const k in use) use[k] *= take;
      st = stockMoves(ctx(), use, -1, 'waste', S.cart.id, at, 'Voided after kitchen: ' + reason);
    }
    if (take >= l.qty) S.cart.lines = S.cart.lines.filter((x) => x.id !== lineId);
    else l.qty -= take;
    S.cart.updatedAt = at;
    const cart = S.cart;
    await commit(['orders', 'moves', 'ings'], (t) => {
      if (cart.held) t.put('orders', cart);
      for (const m of st.moves) t.put('moves', m);
      for (const k in st.ings) t.put('ings', st.ings[k]);
      audit(t, 'line.void', take + ' × ' + l.name + (l.variantName ? ' (' + l.variantName + ')' : '') + ' — ' + reason + (wasted ? ' · wasted' : ''), approver);
      if (st.moves.length) outbox(t, 'stock.moves', { moves: st.moves }, at);
      return () => applyIngs(st.ings);
    });
    M.bus.emit('cart');
  }

  function setCart(patch) {
    Object.assign(S.cart, patch);
    if (patch.type) {
      S.lastType = patch.type;
      DB.write(['kv'], (t) => t.put('kv', { k: 'lastType', v: patch.type })).catch(() => {});
    }
    cartChanged();
  }

  async function clearCart(approver) {
    const c = S.cart;
    const sent = c.lines.some((l) => l.sent);
    if (c.held) {
      await commit(['orders'], (t) => {
        t.del('orders', c.id);
        audit(t, 'ticket.delete', (c.table || c.customer || 'Ticket') + ' · ' + c.lines.length + ' lines', approver);
        return () => {
          S.open = S.open.filter((o) => o.id !== c.id);
        };
      });
    } else if (sent) {
      await commit([], (t) => audit(t, 'ticket.clear', c.lines.length + ' lines', approver));
    }
    S.cart = newCart();
    await DB.write(['kv'], (t) => t.del('kv', 'draft'));
    M.bus.emit('cart');
  }

  async function holdCart() {
    const c = S.cart;
    if (!c.lines.length) throw new Error('Add items before holding the ticket.');
    for (const l of c.lines) l.sent = true;
    c.held = true;
    c.heldAt = c.heldAt || Date.now();
    c.updatedAt = Date.now();
    await commit(['orders', 'kv'], (t) => {
      t.put('orders', c);
      t.del('kv', 'draft');
      return () => {
        if (!S.open.find((o) => o.id === c.id)) S.open.push(c);
      };
    });
    S.cart = newCart();
    M.bus.emit('cart');
    return c;
  }

  async function resume(id) {
    const o = S.open.find((x) => x.id === id);
    if (!o) return;
    if (S.cart.lines.length && S.cart.id !== o.id) await holdCart();
    if (!S.cart.held) await DB.write(['kv'], (t) => t.del('kv', 'draft'));
    S.cart = o;
    M.bus.emit('cart');
  }

  /* ---------------- sales ---------------- */

  async function completeSale(payments) {
    const at = Date.now();
    const cart = S.cart;
    const b = buildSale(ctx(), cart, payments, at);
    await commit(['orders', 'moves', 'ings', 'kv', 'shifts'], (t) => {
      t.put('orders', b.order);
      for (const m of b.moves) t.put('moves', m);
      for (const k in b.ings) t.put('ings', b.ings[k]);
      t.put('kv', { k: 'meta', v: b.meta });
      t.put('shifts', b.shift);
      t.del('kv', 'draft');
      outbox(t, 'order.paid', { order: b.order, moves: b.moves }, at);
      if (b.order.disc) audit(t, 'discount', b.order.no + ' · ' + discLabel(b.order.disc) + ' · ' + U.peso(b.order.totals.discountTotal), b.order.disc.approver);
      return () => {
        S.meta = b.meta;
        S.shift = b.shift;
        applyIngs(b.ings);
        S.open = S.open.filter((o) => o.id !== b.order.id);
        upsertToday(b.order);
        S.cart = newCart();
      };
    });
    M.bus.emit('cart');
    return b.order;
  }

  async function voidOrder(order, opts) {
    const at = Date.now();
    const b = buildVoid(ctx(), order, opts, at);
    await commit(['orders', 'moves', 'ings', 'shifts'], (t) => {
      t.put('orders', b.order);
      for (const m of b.moves) t.put('moves', m);
      for (const k in b.ings) t.put('ings', b.ings[k]);
      t.put('shifts', b.shift);
      outbox(t, 'order.voided', { order: b.order, moves: b.moves }, at);
      audit(t, 'void', order.no + ' · ' + U.peso(L.orderNet(order)) + ' · ' + opts.reason + (opts.restock ? ' · restocked' : ' · not restocked'), opts.approver);
      return () => {
        S.shift = b.shift;
        applyIngs(b.ings);
        upsertToday(b.order);
      };
    });
    return b.order;
  }

  async function refundOrder(order, opts) {
    const at = Date.now();
    const b = buildRefund(ctx(), order, opts, at);
    await commit(['orders', 'moves', 'ings', 'shifts'], (t) => {
      t.put('orders', b.order);
      for (const m of b.moves) t.put('moves', m);
      for (const k in b.ings) t.put('ings', b.ings[k]);
      t.put('shifts', b.shift);
      outbox(t, 'order.refunded', { order: b.order, refund: b.refund, moves: b.moves }, at);
      audit(t, 'refund', order.no + ' · ' + U.peso(b.refund.amount) + ' · ' + opts.reason, opts.approver);
      return () => {
        S.shift = b.shift;
        applyIngs(b.ings);
        upsertToday(b.order);
      };
    });
    return b;
  }

  async function setKitchen(order, status) {
    const o = Object.assign({}, order, { kitchen: status, rev: (order.rev || 0) + 1, updatedAt: Date.now() });
    await commit(['orders'], (t) => {
      t.put('orders', o);
      outbox(t, 'order.kitchen', { id: o.id, kitchen: status, rev: o.rev });
      return () => upsertToday(o);
    });
    return o;
  }

  function discLabel(d) {
    if (!d) return '';
    if (d.kind === 'scpwd') return 'SC/PWD ' + d.count + ' of ' + d.diners;
    if (d.kind === 'pct') return d.value + '% ' + (d.reason || '');
    return U.peso(d.value) + ' off ' + (d.reason || '');
  }

  /* ---------------- shifts & cash ---------------- */

  async function openShift(float) {
    if (S.shift) throw new Error('A shift is already open.');
    const sh = buildOpenShift(ctx(), float, Date.now());
    await commit(['shifts'], (t) => {
      t.put('shifts', sh);
      outbox(t, 'shift.opened', { shift: sh });
      audit(t, 'shift.open', 'Float ' + U.peso(float));
      return () => {
        S.shift = sh;
      };
    });
    return sh;
  }

  async function cashMove(type, amount, reason, approver) {
    const b = buildCash(ctx(), type, amount, reason, approver, Date.now());
    await commit(['cash', 'shifts'], (t) => {
      t.put('cash', b.entry);
      t.put('shifts', b.shift);
      outbox(t, 'cash.' + type, { entry: b.entry });
      audit(t, 'cash.' + type, U.peso(amount) + ' · ' + reason, approver);
      return () => {
        S.shift = b.shift;
      };
    });
    return b.entry;
  }

  async function closeShift(counts, note) {
    const b = buildCloseShift(ctx(), counts, note, Date.now());
    await commit(['shifts', 'kv'], (t) => {
      t.put('shifts', b.shift);
      t.put('kv', { k: 'meta', v: b.meta });
      outbox(t, 'shift.closed', { shift: b.shift });
      audit(t, 'shift.close', 'Z' + b.shift.zNo + ' · counted ' + U.peso(b.shift.counted) + ' · ' + (b.shift.overShort === 0 ? 'balanced' : (b.shift.overShort > 0 ? 'over ' : 'short ') + U.peso(Math.abs(b.shift.overShort))));
      return () => {
        S.shift = null;
        S.meta = b.meta;
      };
    });
    return b.shift;
  }

  /* ---------------- stock ---------------- */

  async function stockOp(kind, b, detail) {
    await commit(['moves', 'ings', 'counts'], (t) => {
      for (const m of b.moves) t.put('moves', m);
      for (const k in b.ings) t.put('ings', b.ings[k]);
      if (b.count) t.put('counts', b.count);
      outbox(t, 'stock.' + kind, { moves: b.moves, count: b.count || null });
      audit(t, 'stock.' + kind, detail);
      return () => applyIngs(b.ings);
    });
    M.bus.emit('stock');
    return b;
  }
  const receive = (rows, note) => stockOp('receive', buildReceive(ctx(), rows, note || {}, Date.now()), rows.length + ' items' + (note && note.supplier ? ' from ' + note.supplier : ''));
  const waste = (rows, reason) => stockOp('waste', buildWaste(ctx(), rows, reason, Date.now()), rows.length + ' items · ' + reason);
  const count = (rows, note) => stockOp('count', buildCount(ctx(), rows, note, Date.now()), rows.length + ' items counted');

  async function saveIngredient(ing) {
    const isNew = !ing.id;
    const rec = Object.assign({ onHand: 0, cost: 0, par: 0, reorder: 0, active: true, sort: Object.keys(S.ings).length }, ing, { id: ing.id || U.uid(), updatedAt: Date.now() });
    if (!isNew) rec.onHand = S.ings[rec.id].onHand;
    await commit(['ings'], (t) => {
      t.put('ings', rec);
      outbox(t, 'ingredient.saved', { ing: rec });
      audit(t, isNew ? 'ingredient.add' : 'ingredient.edit', rec.name);
      return () => {
        S.ings[rec.id] = rec;
      };
    });
    M.bus.emit('stock');
    return rec;
  }

  function usedIn(ingId) {
    const out = [];
    for (const it of Object.values(S.items)) {
      const rows = (it.recipe || []).concat(...(it.variants || []).map((v) => v.recipe || []));
      if (rows.some((r) => r.ing === ingId)) out.push(it);
    }
    for (const g of Object.values(S.mods)) for (const o of g.options) if ((o.recipe || []).some((r) => r.ing === ingId)) out.push({ id: g.id + ':' + o.id, name: g.name + ': ' + o.name });
    return out;
  }

  /* ---------------- menu ---------------- */

  async function saveItem(item) {
    const isNew = !item.id;
    const rec = Object.assign({ variants: null, addons: [], recipe: [], img: '', ko: '', active: true, sort: Object.keys(S.items).length }, item, { id: item.id || U.uid(), updatedAt: Date.now() });
    await commit(['items'], (t) => {
      t.put('items', rec);
      outbox(t, 'item.saved', { item: rec });
      audit(t, isNew ? 'menu.add' : 'menu.edit', rec.name);
      return () => {
        S.items[rec.id] = rec;
      };
    });
    M.bus.emit('menu');
    return rec;
  }

  async function saveCat(cat) {
    const rec = Object.assign({ tone: 'gold', kind: 'food', sort: S.cats.length }, cat, { id: cat.id || U.uid(), updatedAt: Date.now() });
    await commit(['cats'], (t) => {
      t.put('cats', rec);
      outbox(t, 'cat.saved', { cat: rec });
      audit(t, 'menu.category', rec.name);
      return () => {
        const i = S.cats.findIndex((c) => c.id === rec.id);
        if (i >= 0) S.cats[i] = rec;
        else S.cats.push(rec);
        S.cats.sort((a, b) => a.sort - b.sort);
      };
    });
    M.bus.emit('menu');
    return rec;
  }

  /* ---------------- people & settings ---------------- */

  async function saveUser(data) {
    let rec;
    if (data.id) {
      const cur = S.users.find((u) => u.id === data.id);
      rec = Object.assign({}, cur, { name: data.name, role: data.role, active: data.active !== false });
      if (data.pin) {
        rec.salt = U.randHex(8);
        rec.pin = U.hashPin(data.pin, rec.salt);
      }
      const owners = S.users.filter((u) => u.role === 'owner' && u.active && u.id !== rec.id);
      if (!owners.length && (rec.role !== 'owner' || !rec.active)) throw new Error('Keep at least one active owner.');
    } else {
      if (!data.pin) throw new Error('Set a 4-digit PIN.');
      rec = makeUser(data.name, data.role, data.pin, S.users.length);
    }
    if (!rec.name.trim()) throw new Error('Enter a name.');
    const clash = S.users.find((u) => u.id !== rec.id && u.active && data.pin && checkPin(u, data.pin));
    if (clash) throw new Error('That PIN is already used by ' + clash.name + '. Pick another.');
    await commit(['users'], (t) => {
      t.put('users', rec);
      audit(t, data.id ? 'user.edit' : 'user.add', rec.name + ' · ' + ROLES[rec.role]);
      return () => {
        const i = S.users.findIndex((u) => u.id === rec.id);
        if (i >= 0) S.users[i] = rec;
        else S.users.push(rec);
        if (S.user && S.user.id === rec.id) S.user = rec;
      };
    });
    return rec;
  }

  async function saveSettings(patch) {
    const next = JSON.parse(JSON.stringify(S.settings));
    for (const k in patch) next[k] = Object.assign({}, next[k], patch[k]);
    await commit(['kv'], (t) => {
      t.put('kv', { k: 'settings', v: next });
      audit(t, 'settings', Object.keys(patch).join(', '));
      return () => {
        S.settings = next;
      };
    });
    M.bus.emit('settings');
  }

  async function saveMeta(patch) {
    const next = Object.assign({}, S.meta, patch);
    await DB.write(['kv'], (t) => t.put('kv', { k: 'meta', v: next }));
    S.meta = next;
  }

  /* ---------------- queries ---------------- */

  async function ordersBetween(from, to) {
    const rows = await DB.byIndex('orders', 'day', DB.range(from, to));
    return rows.filter((o) => o.status !== 'open').sort((a, b) => a.paidAt - b.paidAt);
  }
  async function movesBetween(from, to) {
    return DB.byIndex('moves', 'day', DB.range(from, to));
  }
  async function movesFor(ingId) {
    return (await DB.byIndex('moves', 'ing', ingId)).sort((a, b) => b.at - a.at);
  }
  async function countsBetween(from, to) {
    return DB.byIndex('counts', 'day', DB.range(from, to));
  }
  async function shifts() {
    return (await DB.all('shifts')).sort((a, b) => b.openedAt - a.openedAt);
  }
  async function cashFor(shiftId) {
    return (await DB.byIndex('cash', 'shift', shiftId)).sort((a, b) => a.at - b.at);
  }
  async function auditLog(limit) {
    const all = await DB.all('audit');
    return all.sort((a, b) => b.at - a.at).slice(0, limit || 300);
  }
  /* Average daily use per ingredient over the last n days (sales + waste). */
  async function usage(days) {
    const to = U.dayKey();
    const from = U.addDays(to, -(days - 1));
    const moves = await movesBetween(from, to);
    const out = {};
    for (const m of moves) if ((m.type === 'sale' || m.type === 'waste') && m.qty < 0) out[m.ing] = (out[m.ing] || 0) - m.qty;
    const span = Math.max(1, Math.min(days, U.daysBetween(U.dayKey(S.meta.createdAt), to) + 1));
    for (const k in out) out[k] /= span;
    return out;
  }

  /* Rebuild on-hand from the ledger — the integrity check for stock. */
  async function verifyStock() {
    const moves = await DB.all('moves');
    const sum = {};
    for (const m of moves) sum[m.ing] = (sum[m.ing] || 0) + m.qty;
    const diffs = [];
    for (const id in S.ings) {
      const want = r3(sum[id] || 0);
      if (Math.abs(want - S.ings[id].onHand) > 0.01) diffs.push({ id, name: S.ings[id].name, stored: S.ings[id].onHand, ledger: want });
    }
    return { moves: moves.length, diffs };
  }

  M.core = {
    PAY,
    TYPES,
    ROLES,
    can,
    menu,
    load,
    refreshToday,
    setup,
    login,
    logout,
    checkPin,
    approverByPin,
    newCart,
    persistCart,
    cartTotals,
    addLine,
    addCustom,
    addMore,
    setQty,
    patchLine,
    removeSent,
    setCart,
    clearCart,
    holdCart,
    resume,
    completeSale,
    voidOrder,
    refundOrder,
    setKitchen,
    discLabel,
    openShift,
    cashMove,
    closeShift,
    drawer,
    receive,
    waste,
    count,
    saveIngredient,
    usedIn,
    saveItem,
    saveCat,
    saveUser,
    saveSettings,
    saveMeta,
    ordersBetween,
    movesBetween,
    movesFor,
    countsBetween,
    shifts,
    cashFor,
    auditLog,
    usage,
    verifyStock,
    build: { buildSale, buildVoid, buildRefund, buildReceive, buildWaste, buildCount, buildOpenShift, buildCloseShift, buildCash, emptyTot },
  };
})((window.M = window.M || {}));
