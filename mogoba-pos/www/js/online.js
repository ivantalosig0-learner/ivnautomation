/* Mogoba POS: online ordering, register side.
 * Publishes the menu, availability, hours and payment details for the customer site, picks
 * up new orders, and sends status changes back. Two transports carry the same JSON
 * (docs/online-ordering.md): the server over HTTP, or localStorage on the same device for
 * the demo. Accepting a GCash or Maya order records a paid sale; a cash order becomes an
 * open ticket that the cashier charges at pickup. */
(function (M) {
  'use strict';
  const U = M.util;
  const L = M.logic;
  const C = M.core;
  const S = M.state;
  const h = U.h;
  const ui = () => M.ui;

  const BR = 'mogoba.bridge.';
  const NEXT = {
    pending: ['accepted', 'rejected', 'cancelled'],
    accepted: ['preparing', 'ready', 'cancelled'],
    preparing: ['ready'],
    ready: ['out_for_delivery', 'completed'],
    out_for_delivery: ['completed'],
  };
  const LABEL = { pending: 'To confirm', accepted: 'Confirmed', preparing: 'Preparing', ready: 'Ready', out_for_delivery: 'Out for delivery', completed: 'Completed', rejected: 'Not accepted', cancelled: 'Cancelled' };
  const REJECT = ['Payment not found', 'Amount does not match', 'Sold out', 'Closed', 'Outside delivery area'];
  const state = { orders: {}, since: 0, status: 'off', error: '', seen: new Set(), acked: new Set(), timer: null, nag: null, lastHash: '' };
  const FORMAT = { gcash: [/^\d{13}$/, '13 digits'], maya: [/^[0-9A-F]{12}$/, '12 letters and digits'] };
  const VERIFY_PIN_FROM = 100000;

  const cfg = () => (S.settings && S.settings.online) || {};
  const enabled = () => !!cfg().enabled;
  const isDemo = () => (cfg().mode || 'demo') === 'demo';
  const base = () => String(cfg().url || '').replace(/\/+$/, '');

  /* ---------- transports ---------- */
  function lsGet(k) {
    try {
      return JSON.parse(localStorage.getItem(k) || 'null');
    } catch (e) {
      return null;
    }
  }
  function lsSet(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
      localStorage.setItem(BR + 'ping', String(Date.now()));
      return true;
    } catch (e) {
      return false;
    }
  }
  async function api(method, path, body) {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 15000);
    try {
      const res = await fetch(base() + path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (cfg().key || '') }, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Server answered ' + res.status);
      return j;
    } finally {
      clearTimeout(to);
    }
  }
  const T = {
    publish(snap) {
      if (isDemo()) return Promise.resolve(lsSet(BR + 'store', snap));
      return api('PUT', '/pos/store', snap);
    },
    async list() {
      if (isDemo()) {
        const out = [];
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.indexOf(BR + 'order.') === 0) {
              const o = lsGet(k);
              if (o && o.code) out.push(o);
            }
          }
        } catch (e) {
          /* storage blocked */
        }
        return out;
      }
      const j = await api('GET', '/pos/orders?since=' + state.since);
      state.since = j.now || state.since;
      return j.orders || [];
    },
    async status(o, patch) {
      if (isDemo()) {
        const cur = lsGet(BR + 'order.' + o.code) || o;
        const at = Date.now();
        const next = Object.assign({}, cur, patch, { updatedAt: at, timeline: (cur.timeline || []).concat([{ status: patch.status, at, by: 'register' }]) });
        next.payment = Object.assign({}, cur.payment, patch.payment || {}, patch.verified != null ? { verified: patch.verified } : {});
        delete next.verified;
        lsSet(BR + 'order.' + o.code, next);
        return next;
      }
      const j = await api('POST', '/pos/orders/' + encodeURIComponent(o.code) + '/status', patch);
      return j.order || Object.assign({}, o, patch);
    },
  };

  /* ---------- store snapshot for the customer site ---------- */
  function snapshot() {
    const c = cfg();
    const b = S.settings.business;
    const ings = S.ings;
    const items = Object.values(S.items)
      .filter((i) => i.active !== false && i.online !== false)
      .sort((a, z) => S.cats.findIndex((x) => x.id === a.cat) - S.cats.findIndex((x) => x.id === z.cat) || a.sort - z.sort)
      .map((i) => {
        const variants = (i.variants || []).map((v) => ({ id: v.id, name: v.name, price: v.price, soldOut: L.makeable(i, v.id, ings) === 0 }));
        return {
          id: i.id,
          cat: i.cat,
          name: i.name,
          ko: i.ko || '',
          img: i.img || '',
          price: i.price,
          badge: i.badge || '',
          soldOut: L.itemAvailability(i, ings) === 0,
          prepay: i.cat === 'bilao' || !!i.prepay,
          variantLabel: i.variantLabel || '',
          variants,
          addons: (i.addons || []).map((gid) => S.mods[gid]).filter(Boolean).map((g) => ({ gid: g.id, name: g.name, options: g.options.map((o) => ({ id: o.id, name: o.name, price: o.price })) })),
        };
      });
    const cats = S.cats.filter((x) => items.some((i) => i.cat === x.id)).map((x) => ({ id: x.id, name: x.name, ko: x.ko || '' }));
    const pay = c.payments || {};
    return {
      v: 1,
      updatedAt: Date.now(),
      name: b.name,
      address: b.address,
      phone: b.phone,
      accepting: !!c.accepting,
      pausedUntil: c.pausedUntil > Date.now() ? c.pausedUntil : 0,
      hours: c.hours || [],
      prepMinutes: c.prepMinutes || 20,
      pickup: { enabled: c.pickup !== false },
      delivery: Object.assign({ enabled: false, fee: 0, minOrder: 0, area: '' }, c.delivery || {}),
      payments: {
        gcash: Object.assign({ enabled: false, accountName: '', number: '', qr: '' }, pay.gcash || {}),
        maya: Object.assign({ enabled: false, accountName: '', number: '', qr: '' }, pay.maya || {}),
        cash: Object.assign({ enabled: true, maxTotal: 100000 }, pay.cash || {}),
      },
      cats,
      items,
    };
  }

  async function publish(force) {
    if (!enabled()) return;
    const snap = snapshot();
    const hash = JSON.stringify(Object.assign({}, snap, { updatedAt: 0 }));
    if (!force && hash === state.lastHash) return;
    try {
      await T.publish(snap);
      state.lastHash = hash;
      state.error = '';
    } catch (e) {
      state.error = e.message;
    }
    M.bus.emit('online');
  }
  const publishSoon = U.debounce(() => publish(false), 1500);

  /* ---------- picking up orders ---------- */
  function chime() {
    try {
      const A = window.AudioContext || window.webkitAudioContext;
      if (!A) return;
      const ac = (chime.ac = chime.ac || new A());
      [0, 0.18].forEach((t, i) => {
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.frequency.value = i ? 1046 : 784;
        g.gain.setValueAtTime(0.0001, ac.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.25, ac.currentTime + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t + 0.16);
        o.connect(g).connect(ac.destination);
        o.start(ac.currentTime + t);
        o.stop(ac.currentTime + t + 0.18);
      });
    } catch (e) {
      /* sound is optional */
    }
  }

  async function refresh() {
    if (!enabled() || !S.user) return;
    try {
      const list = await T.list();
      let fresh = 0;
      for (const o of list) {
        const prev = state.orders[o.code];
        state.orders[o.code] = o;
        if (o.status === 'pending' && !state.seen.has(o.code)) {
          state.seen.add(o.code);
          if (!prev && state.status !== 'off') fresh++;
        }
      }
      state.status = 'ok';
      state.error = '';
      if (fresh) {
        chime();
        ui().toast(fresh === 1 ? 'New online order' : fresh + ' new online orders', 'ok');
      }
    } catch (e) {
      state.status = 'error';
      state.error = e.name === 'AbortError' ? 'The server took too long to answer' : e.message;
    }
    M.bus.emit('online');
  }

  /* New orders keep chiming every 15 s until someone opens the Online tab. */
  const unacked = () => list().filter((o) => o.status === 'pending' && !state.acked.has(o.code));
  function ack() {
    for (const o of list()) if (o.status === 'pending') state.acked.add(o.code);
  }

  function start() {
    clearInterval(state.timer);
    clearInterval(state.nag);
    state.status = 'off';
    if (!enabled()) return M.bus.emit('online');
    publish(true);
    refresh();
    state.timer = setInterval(refresh, isDemo() ? 4000 : 10000);
    state.nag = setInterval(() => {
      if (S.user && unacked().length) chime();
    }, 15000);
  }

  addEventListener('storage', (e) => {
    if (enabled() && isDemo() && e.key && e.key.indexOf(BR) === 0 && e.key !== BR + 'store') refresh();
  });
  M.bus.on('menu', publishSoon);
  M.bus.on('stock', publishSoon);
  M.bus.on('change', publishSoon);
  M.bus.on('settings', () => {
    state.lastHash = '';
    if (S.user) start();
  });

  const list = () => Object.values(state.orders).sort((a, b) => b.createdAt - a.createdAt);
  const pendingCount = () => list().filter((o) => o.status === 'pending').length;

  /* ---------- actions ---------- */
  /* A reference is good for one order only, whatever happened to the other order. */
  function duplicateRef(o) {
    if (!o.payment || !o.payment.ref) return null;
    return list().find((x) => x.code !== o.code && x.payment && x.payment.method === o.payment.method && x.payment.ref === o.payment.ref) || null;
  }
  function duplicateProof(o) {
    const sha = o.payment && o.payment.proofSha;
    if (!sha) return null;
    return list().find((x) => x.code !== o.code && x.payment && x.payment.proofSha === sha) || null;
  }
  function refFormatOk(o) {
    const f = FORMAT[o.payment && o.payment.method];
    return !f || !o.payment.ref || f[0].test(o.payment.ref);
  }

  function posLines(o) {
    const lines = o.lines.map((l) => ({
      id: U.uid(),
      itemId: S.items[l.itemId] ? l.itemId : null,
      name: l.name,
      cat: S.items[l.itemId] ? S.items[l.itemId].cat : 'custom',
      variantId: l.variantId || '',
      variantName: l.variantName || '',
      mods: (l.mods || []).map((m) => ({ gid: m.gid, oid: m.oid, name: m.name, price: m.price })),
      unit: l.unit,
      qty: l.qty,
      note: l.note || '',
      sent: false,
    }));
    if (o.deliveryFee > 0) lines.push({ id: U.uid(), itemId: null, name: 'Delivery fee', cat: 'custom', variantId: '', variantName: '', mods: [], unit: o.deliveryFee, qty: 1, note: '', sent: false });
    return lines;
  }

  async function setStatus(o, status, extra) {
    const allowed = NEXT[o.status] || [];
    if (!allowed.includes(status)) throw new Error('Cannot move an order from ' + LABEL[o.status] + ' to ' + LABEL[status] + '.');
    const next = await T.status(o, Object.assign({ status }, extra || {}));
    state.orders[o.code] = next;
    M.bus.emit('online');
    return next;
  }

  async function accept(o, etaMin, check) {
    const pay = o.payment || {};
    const cart = {
      type: o.fulfillment.type === 'delivery' ? 'delivery' : 'take',
      channel: o.fulfillment.type === 'delivery' ? 'online' : '',
      customer: o.customer.name + ' · ' + o.code,
      lines: posLines(o),
      source: 'online',
      onlineCode: o.code,
    };
    let posOrderId = '';
    if (pay.method === 'gcash' || pay.method === 'maya') {
      if (!S.shift) throw new Error('Open a shift before accepting paid online orders.');
      const sale = await C.recordSale(cart, [{ method: pay.method, amount: o.total, tendered: o.total, change: 0, ref: pay.ref || '' }]);
      posOrderId = sale.id;
    } else {
      const t = await C.createTicket(Object.assign(cart, { table: '', customer: o.customer.name + ' · ' + o.code }));
      posOrderId = t.id;
    }
    const extra = { verified: pay.method !== 'cash', etaAt: Date.now() + (etaMin || cfg().prepMinutes || 20) * 60000, posOrderId };
    if (check) extra.payment = Object.assign({}, pay, { verified: true, amountReceived: check.amount, verifiedBy: check.by, verifiedAt: Date.now() });
    return setStatus(o, 'accepted', extra);
  }

  /* Staff confirm the money is really in the wallet app before cooking. */
  function verifySheet(o, eta, done) {
    const pay = o.payment || {};
    let amount = 0;
    const s = ui().sheet({ title: 'Verify payment · ' + o.code, cls: 'narrow', icon: 'drawer' });
    const warn = h('div.stack-sm');
    const okBtn = h('button.btn.go.lg.block', { type: 'button', disabled: true }, 'Verify and accept');
    const kp = ui().keypad((v) => {
      amount = v;
      const diff = amount - o.total;
      okBtn.disabled = !(amount > 0) || diff < 0;
      U.mount(
        warn,
        amount > 0 && diff < 0 ? h('div.oo-warn', ui().icon('alert', 16), 'Underpaid by ' + U.peso(-diff) + '. Reject it or ask for the rest.') : null,
        amount > 0 && diff > 0 ? h('div.banner', ui().icon('alert', 18), 'Overpaid by ' + U.peso(diff) + '. Send it back to the same account.') : null
      );
    }, 0, { placeholder: 'Amount in the app' });
    const dup = duplicateRef(o);
    const dupProof = duplicateProof(o);
    s.setBody(
      h(
        'dl.kv',
        h('dt', 'Amount due'),
        h('dd.big', U.peso(o.total)),
        h('dt', 'Method'),
        h('dd', C.PAY[pay.method] || pay.method),
        h('dt', 'Reference'),
        h('dd.selectable', pay.ref || '-'),
        pay.sender ? [h('dt', 'Sender'), h('dd', pay.sender)] : null,
        h('dt', 'Ordered'),
        h('dd', U.fmtTime(o.createdAt))
      ),
      h(
        'div.stack-sm',
        { style: { margin: '12px 0' } },
        !refFormatOk(o) ? h('div.oo-warn', ui().icon('alert', 16), C.PAY[pay.method] + ' references are usually ' + FORMAT[pay.method][1] + '.') : null,
        dup ? h('div.oo-warn', ui().icon('alert', 16), 'Reference already used by ' + dup.code + '.') : null,
        dupProof ? h('div.oo-warn', ui().icon('alert', 16), 'Same screenshot as ' + dupProof.code + '.') : null
      ),
      h('p.lead', { style: { margin: '0 0 10px' } }, 'Find this payment in the ' + (C.PAY[pay.method] || '') + ' app and type the amount you received.'),
      kp.el,
      warn
    );
    okBtn.onclick = async () => {
      let by = S.user;
      if (o.total >= VERIFY_PIN_FROM || dup || dupProof) {
        by = await ui().approve('refund', 'Approve payment', 'Large or flagged payments need a manager PIN.');
        if (!by) return;
      }
      try {
        await accept(o, eta, { amount, by: by.name });
        s.close();
        ui().toast(o.code + ' accepted.', 'ok');
        done();
      } catch (e) {
        ui().toast(e.message, 'err');
      }
    };
    s.setFoot(h('button.btn.danger', { type: 'button', onclick: () => (s.close(), reject(o, done)) }, 'Reject'), okBtn);
  }

  /* ---------- inbox UI (Orders → Online) ---------- */
  function proofView(src) {
    const s = ui().sheet({ title: 'Payment screenshot', cls: 'narrow' });
    s.setBody(h('img', { src, alt: 'Payment screenshot', style: { width: '100%', borderRadius: '12px' } }));
  }

  function card(o, redraw) {
    const pay = o.payment || {};
    const dup = duplicateRef(o);
    const f = o.fulfillment || {};
    const when = f.time && f.time !== 'asap' ? 'for ' + U.fmtTime(+f.time) : 'ASAP';
    const actions = h('div.oo-actions');
    const act = async (fn) => {
      try {
        await fn();
        redraw();
      } catch (e) {
        ui().toast(e.message, 'err');
      }
    };
    if (o.status === 'pending') {
      let eta = cfg().prepMinutes || 20;
      actions.append(
        h('div.oo-eta', h('span.muted', 'Ready in'), ui().seg([[15, '15'], [20, '20'], [30, '30'], [45, '45']], [15, 20, 30, 45].includes(eta) ? eta : 20, (v) => (eta = v), 'Ready in minutes'), h('span.muted', 'min')),
        h('div.row-gap', h('button.btn.danger', { type: 'button', onclick: () => reject(o, redraw) }, 'Reject'), h('button.btn.go.grow', { type: 'button', onclick: () => (pay.method === 'cash' ? act(() => accept(o, eta)) : verifySheet(o, eta, redraw)) }, pay.method === 'cash' ? 'Accept order' : 'Verify payment'))
      );
    } else if (NEXT[o.status]) {
      const nx = NEXT[o.status].filter((x) => x !== 'cancelled' && !(x === 'out_for_delivery' && f.type !== 'delivery'));
      actions.append(h('div.row-gap', nx.map((x) => h('button.btn', { type: 'button', class: x === 'completed' ? 'go' : '', onclick: () => act(() => setStatus(o, x)) }, { preparing: 'Start preparing', ready: f.type === 'delivery' ? 'Ready for rider' : 'Ready for pickup', out_for_delivery: 'Out for delivery', completed: f.type === 'delivery' ? 'Delivered' : 'Picked up' }[x] || LABEL[x]))));
    }
    return h(
      'article.oo-card.glass',
      { class: 'st-' + o.status },
      h(
        'header.oo-head',
        h('div', h('b.oo-code', o.code), h('span.muted', ' · ' + U.fmtTime(o.createdAt) + ' · ' + U.ago(o.createdAt))),
        h('span.badge', { class: o.status === 'pending' ? 'solid' : o.status === 'rejected' || o.status === 'cancelled' ? 'out' : o.status === 'completed' ? 'muted' : 'ok' }, LABEL[o.status])
      ),
      h(
        'div.oo-body',
        h(
          'div.oo-col',
          h('div.t', o.customer.name),
          h('div.s.selectable', o.customer.phone),
          h('div.s', (f.type === 'delivery' ? 'Delivery ' : 'Pickup ') + when),
          f.type === 'delivery' ? h('div.s', f.address + (f.landmark ? ' · ' + f.landmark : '')) : null,
          o.note ? h('div.s.note', o.note) : null,
          h('ul.oo-lines', o.lines.map((l) => h('li', h('span', l.qty + '× ' + l.name + (l.variantName ? ' · ' + l.variantName : '') + (l.mods && l.mods.length ? ' + ' + l.mods.map((m) => m.name).join(', ') : '') + (l.note ? ' (' + l.note + ')' : '')), h('span.num', U.peso(l.unit * l.qty)))))
        ),
        h(
          'div.oo-pay',
          h('div.oo-total', h('span.muted', 'Total'), h('b', U.peso(o.total))),
          o.deliveryFee ? h('div.s', 'incl. delivery ' + U.peso(o.deliveryFee)) : null,
          h('div.oo-method', h('b', C.PAY[pay.method] || pay.method), pay.verified ? ui().badge('ok', 'Verified') : pay.method === 'cash' ? ui().badge('muted', 'Pay at ' + (f.type === 'delivery' ? 'delivery' : 'pickup')) : ui().badge('low', 'Check app')),
          pay.ref ? h('div.s', 'Ref ', h('b.selectable', pay.ref)) : null,
          pay.sender ? h('div.s', 'From ' + pay.sender) : null,
          dup ? h('div.oo-warn', ui().icon('alert', 16), 'Ref already used by ' + dup.code) : null,
          duplicateProof(o) ? h('div.oo-warn', ui().icon('alert', 16), 'Same screenshot as ' + duplicateProof(o).code) : null,
          pay.ref && !refFormatOk(o) ? h('div.oo-warn', ui().icon('alert', 16), 'Unusual reference format') : null,
          pay.amountReceived ? h('div.s', 'Received ' + U.peso(pay.amountReceived) + (pay.verifiedBy ? ' · ' + pay.verifiedBy : '')) : null,
          pay.proof ? h('button.oo-proof', { type: 'button', onclick: () => proofView(pay.proof), 'aria-label': 'Open payment screenshot' }, h('img', { src: pay.proof, alt: '' })) : null
        )
      ),
      o.reason ? h('div.s', { style: { color: 'var(--bad)' } }, o.reason) : null,
      actions
    );
  }

  function reject(o, redraw) {
    let reason = '';
    const s = ui().sheet({ title: 'Reject ' + o.code, cls: 'narrow' });
    const inp = h('input.input', { placeholder: 'Reason the customer will see', 'aria-label': 'Reason', maxlength: 120 });
    inp.addEventListener('input', () => (reason = inp.value));
    s.setBody(h('div.chips', REJECT.map((r) => h('button.chip', { type: 'button', onclick: () => ((inp.value = r), (reason = r)) }, r))), h('div', { style: { marginTop: '10px' } }, inp));
    s.setFoot(
      h('button.btn.danger-solid.lg.block', {
        type: 'button',
        onclick: async () => {
          if (!reason.trim()) return ui().toast('Pick or type a reason.', 'err');
          try {
            await setStatus(o, 'rejected', { reason: reason.trim() });
            s.close();
            redraw();
          } catch (e) {
            ui().toast(e.message, 'err');
          }
        },
      }, 'Reject order')
    );
  }

  /* Rendered inside the Orders screen. */
  function panel(box) {
    let tab = 'pending';
    const draw = () => {
      if (!enabled()) {
        U.mount(box, ui().empty('Online ordering is off', 'Turn it on in Settings to take orders from the website.', C.can('*') ? h('button.btn.primary', { type: 'button', onclick: () => M.app.go('settings') }, 'Open settings') : null));
        return;
      }
      const all = list();
      const today = U.dayKey();
      const groups = {
        pending: all.filter((o) => o.status === 'pending'),
        active: all.filter((o) => ['accepted', 'preparing', 'ready', 'out_for_delivery'].includes(o.status)),
        done: all.filter((o) => ['completed', 'rejected', 'cancelled'].includes(o.status) && U.dayKey(o.updatedAt) === today),
      };
      const c = cfg();
      const link = siteUrl();
      ack();
      const paused = c.pausedUntil > Date.now();
      const pauseFor = async (until) => {
        await C.saveSettings({ online: Object.assign({}, c, { pausedUntil: until }) });
        ui().toast(until ? 'Paused until ' + U.fmtTime(until) + '.' : 'Taking orders again.');
      };
      const endOfDay = () => {
        const d = new Date();
        d.setHours(23, 59, 0, 0);
        return d.getTime();
      };
      U.mount(
        box,
        h(
          'div.oo-bar',
          h('label.switch', h('input', { type: 'checkbox', checked: !!c.accepting, onchange: async (e) => {
            await C.saveSettings({ online: Object.assign({}, c, { accepting: e.target.checked, pausedUntil: 0 }) });
            ui().toast(e.target.checked ? 'Taking online orders.' : 'Online orders off.');
          } }), h('span.track'), h('span.txt', h('b', !c.accepting ? 'Not taking orders' : paused ? 'Paused until ' + U.fmtTime(c.pausedUntil) : 'Taking orders'), h('small', (isDemo() ? 'Demo on this device' : 'Server') + (state.status === 'error' ? ' · ' + state.error : '')))),
          c.accepting
            ? paused
              ? h('button.btn.sm.go', { type: 'button', onclick: () => pauseFor(0) }, 'Resume')
              : h('div.row-gap', h('span.muted', { style: { fontSize: '13px' } }, 'Pause'), h('button.chip', { type: 'button', onclick: () => pauseFor(Date.now() + 20 * 60000) }, '20 min'), h('button.chip', { type: 'button', onclick: () => pauseFor(Date.now() + 40 * 60000) }, '40 min'), h('button.chip', { type: 'button', onclick: () => pauseFor(endOfDay()) }, 'Rest of today'))
            : null,
          h('div.grow'),
          link ? h('a.btn.sm', { href: link, target: '_blank', rel: 'noopener' }, ui().icon('right', 16), 'Customer site') : null
        ),
        ui().seg([['pending', 'To confirm (' + groups.pending.length + ')'], ['active', 'In progress (' + groups.active.length + ')'], ['done', 'Done today (' + groups.done.length + ')']], tab, (v) => ((tab = v), draw()), 'Online orders'),
        groups[tab].length ? h('div.oo-list', groups[tab].map((o) => card(o, draw))) : ui().empty(tab === 'pending' ? 'No orders to confirm' : 'Nothing here', tab === 'pending' ? 'New website orders appear here with a sound.' : null)
      );
    };
    draw();
    return draw;
  }

  function siteUrl() {
    if (!isDemo() && base()) return base().replace(/\/api$/, '') + '/order/';
    try {
      return new URL('../order/index.html', location.href).href;
    } catch (e) {
      return '';
    }
  }

  function inbox() {
    M.app.go('orders');
    M.bus.emit('orders:tab', 'online');
  }

  M.online = { start, refresh, publish, snapshot, list, pendingCount, panel, inbox, accept, setStatus, siteUrl, state, LABEL, duplicateRef, duplicateProof, refFormatOk };
})((window.M = window.M || {}));
