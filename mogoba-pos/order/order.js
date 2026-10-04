/* Mogoba online ordering: menu, cart, checkout and order tracking for customers.
 *
 * Two transports carry the same JSON (docs/online-ordering.md):
 *   server mode  fetch() to window.MOGOBA_ORDER.api
 *   demo mode    localStorage on the register's origin (keys mogoba.bridge.*). The rules the
 *                server enforces are repeated here so the demo behaves like production.
 *
 * Money is integer centavos. The cart stores ids only; every price on screen is recomputed
 * from the current store snapshot, and the server (or the demo rules) reprices the order. */
(function () {
  'use strict';

  const CFG = window.MOGOBA_ORDER || {};
  const API = String(CFG.api || '').replace(/\/+$/, '');
  const DEMO = !API;

  const K = {
    store: 'mogoba.bridge.store',
    order: 'mogoba.bridge.order.',
    ping: 'mogoba.bridge.ping',
    cart: 'mogoba.order.cart',
    recent: 'mogoba.order.recent',
    contact: 'mogoba.order.contact',
    when: 'mogoba.order.when',
  };
  const POLL_MS = 5000;
  const MAX_QTY = 50;
  const MAX_LINES = 30;
  const NOTE_MAX = 140;
  const PROOF_MAX = 1.5 * 1024 * 1024;
  const EWALLET = { gcash: 'GCash', maya: 'Maya' };
  const TERMINAL = ['completed', 'rejected', 'cancelled'];
  const CONFIRMED = ['accepted', 'preparing', 'ready', 'out_for_delivery', 'completed'];

  /* ---------- storage (every access guarded: private mode and full disks throw) ---------- */

  const ls = {
    get(k) {
      try {
        const v = localStorage.getItem(k);
        return v == null ? null : JSON.parse(v);
      } catch (e) {
        return null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
        return true;
      } catch (e) {
        return false;
      }
    },
    keys(prefix) {
      const out = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(prefix)) out.push(k);
        }
      } catch (e) {
        /* storage blocked: no keys */
      }
      return out;
    },
  };

  /* ---------- formatting ---------- */

  const nf0 = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 0 });
  const nf2 = new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  /* Whole pesos print without centavos (menu style); anything else shows two decimals. */
  const peso = (c) => {
    const a = Math.abs(c || 0) / 100;
    return (c < 0 ? '-' : '') + '₱' + (Number.isInteger(a) ? nf0.format(a) : nf2.format(a));
  };
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

  const ICON = {
    back: '<path d="M15 18l-6-6 6-6"/>',
    close: '<path d="M18 6L6 18M6 6l12 12"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    bag: '<path d="M5 8h14l-1 12H6L5 8z"/><path d="M9 8V7a3 3 0 0 1 6 0v1"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    pin: '<path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
    store: '<path d="M4 10l1.5-6h13L20 10M4 10h16v10H4zM10 20v-5h4v5"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.5"/>',
    right: '<path d="M9 18l6-6-6-6"/>',
  };
  const ic = (n, size) =>
    '<span class="ic" aria-hidden="true"><svg width="' + (size || 20) + '" height="' + (size || 20) +
    '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    ICON[n] + '</svg></span>';

  /* ---------- time: business hours are Asia/Manila ----------
   * The Philippines is UTC+8 all year (no daylight saving), so a fixed offset is exact and
   * does not depend on the customer's phone time zone. */
  const PH = 8 * 3600e3;
  const DAY_MS = 864e5;
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const ph = (ms) => {
    const d = new Date(ms + PH);
    return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), day: d.getUTCDay(), min: d.getUTCHours() * 60 + d.getUTCMinutes() };
  };
  /* Epoch ms for minute-of-day `min` on the Manila date of `ms`, plus addDays. */
  const atMin = (ms, min, addDays) => {
    const p = ph(ms);
    return Date.UTC(p.y, p.mo, p.d + (addDays || 0), 0, min) - PH;
  };
  const sameDay = (a, b) => atMin(a, 0) === atMin(b, 0);
  const toMin = (s) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
    return m ? +m[1] * 60 + +m[2] : NaN;
  };
  const clock = (min) => {
    let h = Math.floor(min / 60) % 24;
    const ap = h < 12 ? 'AM' : 'PM';
    h = h % 12 || 12;
    return h + ':' + String(min % 60).padStart(2, '0') + ' ' + ap;
  };
  /* Register data is trusted for shape, not content: a missing time prints nothing. */
  const timeOf = (ms) => (Number.isFinite(ms) ? clock(ph(ms).min) : '');

  /* Opening windows [openMin, closeMin) for a weekday. Windows past midnight are not supported. */
  function windows(store, day) {
    return (store.hours || [])
      .filter((h) => h && h.day === day)
      .map((h) => [toMin(h.open), toMin(h.close)])
      .filter(([o, c]) => o >= 0 && c > o)
      .sort((a, b) => a[0] - b[0]);
  }

  const inHoursAt = (store, t) => windows(store, ph(t).day).some(([o, c]) => ph(t).min >= o && ph(t).min < c);

  /* First moment at or after `from` inside opening hours, or 0 when no hours are set. */
  function nextOpen(store, from, strict) {
    if (!strict && inHoursAt(store, from)) return from;
    const day = ph(from).day;
    for (let i = 0; i < 8; i++) {
      for (const [o] of windows(store, (day + i) % 7)) {
        const t = atMin(from, o, i);
        if (t > from) return t;
      }
    }
    return 0;
  }

  /* Register heartbeat (v1.1 rule 4). posSeenAt is server time, so compare it with the
   * server clock (estimated from the Date header) rather than the phone's clock. */
  const POS_STALE_MS = 5 * 60e3;
  let clockSkew = 0;

  /* Open means accepting, not paused, register online (server mode) and inside today's hours
   * (contract store snapshot, v1.1 rules 3 and 4). */
  function storeState(store, now) {
    const p = ph(now);
    const today = windows(store, p.day);
    const cur = today.find(([o, c]) => p.min >= o && p.min < c);
    const pausedUntil = Number.isFinite(store.pausedUntil) ? store.pausedUntil : 0;
    const paused = pausedUntil > now;
    const stale = !DEMO && Number.isFinite(store.posSeenAt) && now + clockSkew - store.posSeenAt > POS_STALE_MS;
    return {
      open: !!(store.accepting && !paused && !stale && cur),
      accepting: !!store.accepting,
      paused,
      stale,
      back: paused ? nextOpen(store, pausedUntil) : 0,
      inHours: !!cur,
      today,
      closesAt: cur ? atMin(now, cur[1]) : 0,
      next: nextOpen(store, now, true),
    };
  }

  function dayWord(t, now) {
    const days = Math.round((atMin(t, 0) - atMin(now, 0)) / DAY_MS);
    return days === 0 ? 'today' : days === 1 ? 'tomorrow' : DAYS[ph(t).day];
  }

  /* One sentence for a closed store. Used by the UI and as the demo 423 reply. */
  function closedText(st, now) {
    if (!st.accepting) return 'Online ordering is paused right now. Please check back soon.';
    if (st.stale) return 'Online orders are paused. Call ' + ((S.store && S.store.phone) || 'the store') + ' to order.';
    if (st.paused && st.back && (st.inHours || st.back !== st.next)) return 'Paused, back ' + (sameDay(st.back, now) ? '' : dayWord(st.back, now) + ' ') + 'at ' + timeOf(st.back) + '.';
    if (st.paused && !st.back) return 'Online ordering is paused right now. Please check back soon.';
    if (st.next) return 'We are closed. Ordering opens ' + dayWord(st.next, now) + ' at ' + timeOf(st.next) + '.';
    return 'We are closed right now.';
  }

  /* "Later today" choices: 15 minute slots, at least prepMinutes away, inside today's hours. */
  function laterSlots(store, now) {
    const p = ph(now);
    const start = Math.ceil((p.min + (store.prepMinutes || 0) + 1) / 15) * 15;
    const out = [];
    for (const [o, c] of windows(store, p.day)) {
      for (let m = Math.max(o, start); m < c; m += 15) out.push(atMin(now, m));
    }
    return out;
  }

  /* ---------- pricing against the snapshot ---------- */

  let itemIndex = new Map();
  const indexStore = (store) => {
    itemIndex = new Map((store.items || []).map((i) => [i.id, i]));
  };
  const findItem = (id) => itemIndex.get(id) || null;

  const itemSoldOut = (item) => !!item.soldOut || (!!(item.variants && item.variants.length) && item.variants.every((v) => v.soldOut));

  function priceText(item) {
    const vs = item.variants || [];
    if (!vs.length) return peso(item.price);
    const live = vs.filter((v) => !v.soldOut);
    const ps = (live.length ? live : vs).map((v) => v.price);
    const lo = Math.min.apply(null, ps);
    const hi = Math.max.apply(null, ps);
    return lo === hi ? peso(lo) : peso(lo) + ' to ' + peso(hi);
  }

  /* Resolve one line ({itemId, variantId, mods, qty}) to names and a unit price, or explain
   * why it cannot be ordered. Shared by the cart screen and the demo order rules. */
  function priceLine(line) {
    const item = findItem(line.itemId);
    if (!item) return { error: 'An item in your order is no longer on the menu. Remove it to continue.' };
    if (item.soldOut) return { item, error: item.name + ' is sold out. Remove it to continue.' };
    let unit = item.price;
    let variant = null;
    const vs = item.variants || [];
    if (vs.length) {
      variant = vs.find((v) => v.id === line.variantId) || null;
      if (!variant) return { item, error: 'Choose a ' + String(item.variantLabel || 'option').toLowerCase() + ' for ' + item.name + '.' };
      if (variant.soldOut) return { item, error: item.name + ', ' + variant.name + ' is sold out. Remove it to continue.' };
      unit = variant.price;
    } else if (line.variantId) {
      return { item, error: 'An option for ' + item.name + ' is no longer available. Remove it to continue.' };
    }
    const mods = [];
    const seen = new Set();
    for (const m of line.mods || []) {
      const g = (item.addons || []).find((x) => x.gid === (m && m.gid));
      const o = g && (g.options || []).find((x) => x.id === m.oid);
      if (!o || o.soldOut) return { item, error: 'An add-on for ' + item.name + ' is no longer available. Remove it to continue.' };
      const k = g.gid + ':' + o.id;
      if (seen.has(k)) continue;
      seen.add(k);
      mods.push({ gid: g.gid, oid: o.id, name: o.name, price: o.price });
      unit += o.price;
    }
    return { item, variant, mods, unit, name: item.name, variantName: variant ? variant.name : '' };
  }

  /* ---------- order rules (contract "Placing an order", rules 1 to 7) ----------
   * Used only by the demo transport; the server applies the same rules in production. */

  const PHONE_RE = /^(09\d{9}|\+639\d{9})$/;
  /* v1.1 rule 1: GCash references are 13 digits, Maya references 12 hex characters. */
  const REF_RE = /^[A-Z0-9]{6,20}$/;
  const cleanRef = (s) => String(s == null ? '' : s).replace(/[\s-]+/g, '').toUpperCase();
  const SHA_RE = /^[0-9a-f]{64}$/;
  /* What the customer typed, made strict: spaces, dashes and brackets removed, 63 prefix folded,
   * a missing leading 0 (917 123 4567) restored. */
  const cleanPhone = (s) => {
    let t = String(s == null ? '' : s).replace(/[\s\-().]/g, '');
    if (/^639\d{9}$/.test(t)) t = '+' + t;
    if (/^9\d{9}$/.test(t)) t = '0' + t;
    if (!PHONE_RE.test(t)) return '';
    return t.startsWith('+63') ? '0' + t.slice(3) : t;
  };
  const dataUrlBytes = (u) => {
    const i = String(u).indexOf(',');
    return i < 0 ? 0 : Math.floor(((u.length - i - 1) * 3) / 4);
  };

  function fail(status, error, field) {
    return { status, error, field: field || '' };
  }

  function checkOrder(store, req, now, existing) {
    const st = storeState(store, now);
    if (!st.open) return fail(423, closedText(st, now));
    const items = Array.isArray(req.items) ? req.items : [];
    if (!items.length) return fail(400, 'Your order is empty. Add an item to continue.', 'items');
    if (items.length > MAX_LINES) return fail(400, 'Orders can have up to ' + MAX_LINES + ' lines. Combine or remove some items.', 'items');

    const lines = [];
    let subtotal = 0;
    let prepay = false;
    for (let i = 0; i < items.length; i++) {
      const r = items[i] || {};
      const qty = r.qty;
      if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) return fail(400, 'Each item can be ordered 1 to ' + MAX_QTY + ' times.', 'items.' + i + '.qty');
      const p = priceLine({ itemId: r.itemId, variantId: r.variantId || '', mods: Array.isArray(r.mods) ? r.mods : [] });
      if (p.error) return fail(400, p.error, 'items.' + i);
      if (p.item.prepay === true) prepay = true;
      lines.push({ itemId: p.item.id, variantId: p.variant ? p.variant.id : '', name: p.name, variantName: p.variantName, mods: p.mods, unit: p.unit, qty, note: String(r.note || '').trim().slice(0, NOTE_MAX) });
      subtotal += p.unit * qty;
    }

    const c = req.customer || {};
    const name = String(c.name || '').trim();
    if (name.length < 2 || name.length > 60) return fail(400, 'Enter your name (2 to 60 characters).', 'customer.name');
    const rawPhone = String(c.phone || '');
    if (!PHONE_RE.test(rawPhone)) return fail(400, 'Enter a PH mobile number, like 0917 123 4567.', 'customer.phone');
    const phone = rawPhone.startsWith('+63') ? '0' + rawPhone.slice(3) : rawPhone;

    const f = req.fulfillment || {};
    if (f.type !== 'pickup' && f.type !== 'delivery') return fail(400, 'Choose pickup or delivery.', 'fulfillment.type');
    const mode = store[f.type] || {};
    if (!mode.enabled) return fail(400, (f.type === 'delivery' ? 'Delivery' : 'Pickup') + ' is not available right now.', 'fulfillment.type');
    let fee = 0;
    const address = f.type === 'delivery' ? String(f.address || '').trim().slice(0, 200) : '';
    const landmark = f.type === 'delivery' ? String(f.landmark || '').trim().slice(0, 120) : '';
    if (f.type === 'delivery') {
      if (address.length < 5) return fail(400, 'Enter your delivery address.', 'fulfillment.address');
      if (subtotal < (mode.minOrder || 0)) return fail(400, 'Delivery needs an order of at least ' + peso(mode.minOrder) + '. Add more items or choose pickup.', 'fulfillment.type');
      fee = mode.fee || 0;
    }
    let time = 'asap';
    if (f.time !== 'asap') {
      const t = f.time;
      const inHours = Number.isFinite(t) && windows(store, ph(t).day).some(([o, cl]) => ph(t).min >= o && ph(t).min < cl);
      if (!Number.isFinite(t) || t <= now || !sameDay(t, now) || !inHours) return fail(400, 'Choose a time later today while we are open.', 'fulfillment.time');
      time = t;
    }

    const pay = req.payment || {};
    const method = pay.method;
    const pm = (store.payments || {})[method];
    if (!['gcash', 'maya', 'cash'].includes(method)) return fail(400, 'Choose a payment method.', 'payment.method');
    if (!pm || !pm.enabled) return fail(400, (EWALLET[method] || 'Cash') + ' is not available right now. Choose another payment method.', 'payment.method');
    /* v1.1 rule 2: bilao trays and large orders are paid up front. */
    if (method === 'cash') {
      if (prepay) return fail(400, 'Some items must be paid by GCash or Maya.', 'payment.method');
      if (pm.maxTotal > 0 && subtotal + fee > pm.maxTotal) return fail(400, 'Orders above ' + peso(pm.maxTotal) + ' must be paid by GCash or Maya.', 'payment.method');
    }
    let ref = '';
    let proof = '';
    let proofSha = '';
    if (method !== 'cash') {
      ref = cleanRef(pay.ref);
      if (!REF_RE.test(ref)) return fail(400, 'Enter the ' + EWALLET[method] + ' reference number (6 to 20 letters or digits).', 'payment.ref');
      /* v1.1 rule 1: a reference is good for one order per method, whatever that order's status. */
      const dup = existing.some((o) => o.payment && o.payment.method === method && o.payment.ref === ref);
      if (dup) return fail(409, 'This reference number was already used. Call the shop if this is a mistake.', 'payment.ref');
      proof = String(pay.proof || '');
      if (proof && (!/^data:image\/(jpeg|png);base64,/.test(proof) || dataUrlBytes(proof) > PROOF_MAX)) return fail(400, 'The screenshot must be a JPEG or PNG under 1.5 MB.', 'payment.proof');
      if (proof && SHA_RE.test(String(pay.proofSha || ''))) proofSha = pay.proofSha;
    }
    const payment = { method, ref, sender: method === 'cash' ? '' : String(pay.sender || '').trim().slice(0, 60), proof, verified: false };
    if (proofSha) payment.proofSha = proofSha;

    return {
      order: {
        code: '',
        token: '',
        clientId: String(req.clientId || ''),
        createdAt: now,
        updatedAt: now,
        status: 'pending',
        customer: { name, phone },
        fulfillment: { type: f.type, time, address, landmark },
        lines,
        subtotal,
        deliveryFee: fee,
        total: subtotal + fee,
        payment,
        note: String(req.note || '').trim().slice(0, 200),
        reason: '',
        etaAt: 0,
        timeline: [{ status: 'pending', at: now, by: 'customer' }],
        posOrderId: '',
      },
    };
  }

  /* Tracking view of a stored record (contract "Tracking"). */
  function publicOrder(o) {
    const p = JSON.parse(JSON.stringify(o));
    delete p.token;
    delete p.clientId;
    if (p.payment) delete p.payment.proof;
    return p;
  }

  /* ---------- transports ---------- */

  class ApiError extends Error {
    constructor(status, message, field) {
      super(message);
      this.status = status;
      this.field = field || '';
    }
  }

  const hex = (bytes) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
  const uuid = () => {
    if (crypto.randomUUID) return crypto.randomUUID();
    const h = hex(16);
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-a' + h.slice(17, 20) + '-' + h.slice(20);
  };

  function validStore(s) {
    return !!(s && typeof s === 'object' && Array.isArray(s.items) && Array.isArray(s.cats) && Array.isArray(s.hours));
  }

  /* The generated fallback snapshot is loaded only when demo mode needs it. */
  let fallbackLoading = null;
  function loadFallback() {
    if (window.MOGOBA_FALLBACK_STORE) return Promise.resolve(window.MOGOBA_FALLBACK_STORE);
    if (!fallbackLoading) {
      fallbackLoading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'fallback-store.js';
        s.onload = () => (window.MOGOBA_FALLBACK_STORE ? resolve(window.MOGOBA_FALLBACK_STORE) : reject(new Error('empty')));
        s.onerror = () => {
          fallbackLoading = null;
          reject(new ApiError(0, 'The menu could not be loaded. Refresh the page to try again.'));
        };
        document.head.appendChild(s);
      });
    }
    return fallbackLoading;
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const demo = {
    async store() {
      const s = ls.get(K.store);
      return validStore(s) ? s : loadFallback();
    },
    orders() {
      return ls.keys(K.order).map((k) => ls.get(k)).filter((o) => o && o.code);
    },
    async place(req) {
      await wait(350); /* feels like a network round trip, so the loading state is honest */
      const store = await demo.store();
      indexStore(store);
      const all = demo.orders();
      const same = req.clientId && all.find((o) => o.clientId === req.clientId);
      if (same) return { code: same.code, token: same.token, order: publicOrder(same) };
      const now = Date.now();
      const r = checkOrder(store, req, now, all);
      if (r.error) throw new ApiError(r.status, r.error, r.field);
      const used = new Set(all.map((o) => o.code));
      let code = '';
      for (let i = 0; i < 200 && (!code || used.has(code)); i++) code = 'MGB-' + (1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000));
      if (used.has(code)) throw new ApiError(429, 'Too many orders right now. Please try again in a minute.');
      const order = Object.assign(r.order, { code, token: hex(16) });
      try {
        localStorage.setItem(K.order + code, JSON.stringify(order));
        localStorage.setItem(K.ping, String(Date.now()));
      } catch (e) {
        throw new ApiError(400, 'This device has no room to save the order. Remove the screenshot and try again.', 'payment.proof');
      }
      return { code, token: order.token, order: publicOrder(order) };
    },
    async track(code, token) {
      const o = ls.get(K.order + code);
      return o && o.token === token ? publicOrder(o) : null;
    },
  };

  const STATUS_TEXT = {
    0: 'Could not reach Mogoba. Check your connection and try again.',
    404: 'Not found.',
    409: 'This order conflicts with another order.',
    423: 'We are not taking orders right now.',
    429: 'Too many tries. Please wait a minute and try again.',
  };

  async function http(method, path, body) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15000);
    let res;
    try {
      res = await fetch(API + path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
        signal: ctl.signal,
        cache: 'no-store',
      });
    } catch (e) {
      throw new ApiError(0, STATUS_TEXT[0]);
    } finally {
      clearTimeout(timer);
    }
    /* Readable on the same origin (the hosted setup); cross origin it is null and skew stays 0. */
    const date = Date.parse(res.headers.get('Date') || '');
    if (Number.isFinite(date)) clockSkew = date - Date.now();
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }
    if (!res.ok) throw new ApiError(res.status, (data && data.error) || STATUS_TEXT[res.status] || 'Something went wrong. Please try again.', data && data.field);
    return data;
  }

  const server = {
    store: () => http('GET', '/api/store'),
    place: (req) => http('POST', '/api/orders', req),
    /* The public order may come bare or wrapped as {order}; accept both. */
    track: (code, token) =>
      http('GET', '/api/orders/' + encodeURIComponent(code) + '?t=' + encodeURIComponent(token)).then(
        (d) => (d && d.order ? d.order : d),
        (e) => {
          if (e.status === 404) return null;
          throw e;
        }
      ),
  };

  const T = DEMO ? demo : server;

  /* ---------- state ---------- */

  const savedContact = ls.get(K.contact) || {};
  /* "Later today" lives in this tab only (sessionStorage): it must survive a refresh on the
   * payment step, never a new visit tomorrow. Checked against the open slots once the store loads. */
  const ss = {
    get(k) {
      try {
        return JSON.parse(sessionStorage.getItem(k) || 'null');
      } catch (e) {
        return null;
      }
    },
    set(k, v) {
      try {
        sessionStorage.setItem(k, JSON.stringify(v));
      } catch (e) {
        /* storage blocked: the choice resets on refresh */
      }
    },
  };
  const savedWhen = ss.get(K.when) || {};
  const S = {
    store: null,
    storeErr: '',
    cart: sanitizeCart(ls.get(K.cart)),
    form: {
      type: savedContact.type === 'delivery' ? 'delivery' : 'pickup',
      when: savedWhen.when === 'later' && Number.isFinite(savedWhen.time) ? 'later' : 'asap',
      time: savedWhen.when === 'later' && Number.isFinite(savedWhen.time) ? savedWhen.time : 0,
      proofSha: '',
      name: String(savedContact.name || ''),
      phone: String(savedContact.phone || ''),
      address: String(savedContact.address || ''),
      landmark: String(savedContact.landmark || ''),
      method: '',
      ref: '',
      sender: '',
      proof: '',
    },
    touched: {},
    placing: false,
    placeErr: null,
    proofBusy: false,
    clientId: '',
    route: { name: '' },
    track: null,
    menuScroll: 0,
  };

  function sanitizeCart(c) {
    if (!Array.isArray(c)) return [];
    return c
      .filter((l) => l && typeof l.itemId === 'string' && Number.isInteger(l.qty) && l.qty > 0)
      .slice(0, MAX_LINES)
      .map((l) => ({ itemId: l.itemId, variantId: String(l.variantId || ''), mods: Array.isArray(l.mods) ? l.mods.filter((m) => m && m.gid && m.oid) : [], qty: Math.min(MAX_QTY, l.qty), note: String(l.note || '').slice(0, NOTE_MAX) }));
  }
  const lineKey = (l) => [l.itemId, l.variantId || '', (l.mods || []).map((m) => m.gid + ':' + m.oid).sort().join(','), (l.note || '').trim()].join('|');

  function saveCart() {
    ls.set(K.cart, S.cart);
    S.clientId = ''; /* a changed cart is a new order attempt */
  }
  function saveContact() {
    const f = S.form;
    ls.set(K.contact, { type: f.type, name: f.name, phone: f.phone, address: f.address, landmark: f.landmark });
  }
  function saveWhen() {
    ss.set(K.when, { when: S.form.when, time: S.form.time });
  }
  /* A saved slot that has passed (or a store without slots today) falls back to ASAP. */
  function checkWhen() {
    if (S.form.when === 'later' && !laterSlots(S.store, Date.now()).includes(S.form.time)) {
      S.form.when = 'asap';
      S.form.time = 0;
      saveWhen();
    }
  }

  function recents() {
    const r = ls.get(K.recent);
    return Array.isArray(r) ? r.filter((x) => x && x.code && x.token) : [];
  }
  function rememberOrder(entry) {
    const list = recents().filter((x) => x.code !== entry.code);
    list.unshift(entry);
    ls.set(K.recent, list.slice(0, 12));
  }
  function updateRecent(o) {
    const list = recents();
    const hit = list.find((x) => x.code === o.code);
    if (hit && (hit.status !== o.status || hit.total !== o.total)) {
      hit.status = o.status;
      hit.total = o.total;
      ls.set(K.recent, list);
    }
  }

  function totals() {
    let subtotal = 0;
    let count = 0;
    let bad = 0;
    const rows = S.cart.map((l, i) => {
      const p = priceLine(l);
      count += l.qty;
      if (p.error) bad++;
      else subtotal += p.unit * l.qty;
      return { l, p, i };
    });
    const d = S.store.delivery || {};
    const fee = S.form.type === 'delivery' ? d.fee || 0 : 0;
    return { rows, subtotal, fee, total: subtotal + fee, count, bad, minShort: S.form.type === 'delivery' ? Math.max(0, (d.minOrder || 0) - subtotal) : 0 };
  }

  const methodState = (m) => {
    const p = (S.store.payments || {})[m] || {};
    if (!p.enabled) return { ok: false, why: 'Not available' };
    if (EWALLET[m] && !p.qr) return { ok: false, why: 'QR not set up yet' };
    /* v1.1 rule 2: cash is not offered for prepay items (bilao trays) or above cash.maxTotal. */
    if (m === 'cash') {
      const pre = S.cart.map((l) => findItem(l.itemId)).find((i) => i && i.prepay === true);
      if (pre) return { ok: false, why: 'Not for ' + pre.name };
      if (p.maxTotal > 0 && totals().total > p.maxTotal) return { ok: false, why: 'Up to ' + peso(p.maxTotal) + ' only' };
    }
    return { ok: true, p };
  };
  const modeEnabled = (t) => !!(S.store[t] && S.store[t].enabled);

  /* ---------- small UI helpers ---------- */

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const view = () => document.getElementById('view');
  const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let toastTimer = 0;
  let toastAt = 0;
  function toast(msg) {
    const t = document.getElementById('toast');
    toastAt = Date.now();
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 2400);
  }

  const TONES = ['red', 'gold', 'green', 'yellow'];
  const toneOf = (catId) => {
    const i = (S.store.cats || []).findIndex((c) => c.id === catId);
    return 'tone-' + TONES[Math.max(0, i) % TONES.length];
  };

  /* Photo when the snapshot names one, otherwise the Korean name on a brand-tone tile. */
  function media(item, size) {
    if (item.img) {
      return '<img src="assets/food/' + encodeURIComponent(item.img) + '.jpg" alt="" loading="lazy" decoding="async" width="' + size + '" height="' + size + '">';
    }
    const label = item.ko || item.name.slice(0, 1);
    return '<span class="ko-tile ' + toneOf(item.cat) + (label.length > 4 ? ' long' : '') + '" aria-hidden="true" lang="ko">' + esc(label) + '</span>';
  }

  function lineSub(p, note) {
    const bits = [];
    if (p.variantName) bits.push(p.variantName);
    for (const m of p.mods || []) bits.push('+ ' + m.name);
    if (note) bits.push('Note: ' + note);
    return bits.join(', ');
  }

  const qtyCtl = (act, idx, qty, label, small) =>
    '<div class="qty' + (small ? ' sm' : '') + '" role="group" aria-label="' + esc(label) + '">' +
    '<button type="button" id="q-' + idx + 'm" data-act="' + act + '" data-i="' + idx + '" data-d="-1" aria-label="' + (qty <= 1 && act === 'line-qty' ? 'Remove ' : 'Decrease ') + esc(label) + '">' + ic(qty <= 1 && act === 'line-qty' ? 'trash' : 'minus', 18) + '</button>' +
    '<output aria-live="polite">' + qty + '</output>' +
    '<button type="button" id="q-' + idx + 'p" data-act="' + act + '" data-i="' + idx + '" data-d="1" aria-label="Increase ' + esc(label) + '"' + (qty >= MAX_QTY ? ' disabled' : '') + '>' + ic('plus', 18) + '</button></div>';

  function summaryRows(t) {
    return (
      '<div class="sum">' +
      '<div class="sumrow"><span>Subtotal</span><span class="val">' + peso(t.subtotal) + '</span></div>' +
      (S.form.type === 'delivery' ? '<div class="sumrow"><span>Delivery fee</span><span class="val">' + peso(t.fee) + '</span></div>' : '') +
      '<div class="sumrow total"><span>Total</span><span class="val" data-total>' + peso(t.total) + '</span></div></div>'
    );
  }

  const demoTag = () => (DEMO ? '<span class="demo-tag" title="Orders stay on this device">Demo mode</span>' : '');

  /* ---------- menu ---------- */

  function viewMenu() {
    const s = S.store;
    const now = Date.now();
    const st = storeState(s, now);
    const hoursToday = st.today.length ? st.today.map(([o, c]) => clock(o) + ' to ' + clock(c)).join(', ') : 'Closed today';
    const stateWord = st.open ? 'Open now' : !st.accepting || st.paused || st.stale ? 'Paused' : 'Closed';
    const hasRecent = recents().length > 0;

    let html =
      '<header class="hero wrap"><div class="hero-row"><div class="hero-main">' +
      '<div class="brand"><img src="assets/logo.png" alt="" width="48" height="48">' +
      '<div class="brand-text"><h1>' + brandName(s.name || 'Mogoba Korean Food House') + '</h1><p class="brand-sub">' + esc(s.address || '') + '</p></div>' +
      demoTag() +
      (hasRecent ? '<a class="icon-btn boxed" href="#/orders" aria-label="Your orders">' + ic('receipt') + '</a>' : '') +
      '</div>' +
      '<p class="status" id="store-status"><span class="dot ' + (st.open ? 'open' : 'closed') + '"></span><b>' + stateWord + '</b><span>' + (st.today.length ? 'Today ' : '') + esc(hoursToday) + '</span></p>' +
      '</div>' + modeCard() + '</div>' +
      activeOrderBanner() +
      (st.open ? '' : '<div class="notice warn" id="closed-note">' + ic('clock') + '<div><b>' + esc(closedText(st, now)) + '</b>You can still browse the menu.</div></div>') +
      '</header>';

    const cats = (s.cats || []).filter((c) => (s.items || []).some((i) => i.cat === c.id));
    html +=
      '<nav class="chipbar" aria-label="Menu categories"><div class="chips" id="chips">' +
      cats.map((c, i) => '<button type="button" class="chip" data-act="cat" data-cat="' + esc(c.id) + '"' + (i === 0 ? ' aria-current="true"' : '') + '>' + esc(c.name) + '</button>').join('') +
      '</div></nav>';

    html += '<div class="layout wrap"><div class="menu" id="menu">';
    for (const c of cats) {
      const items = s.items.filter((i) => i.cat === c.id);
      html +=
        '<section class="cat-sec" id="c-' + esc(c.id) + '" data-cat="' + esc(c.id) + '" aria-labelledby="h-' + esc(c.id) + '">' +
        '<div class="section-head ' + toneOf(c.id) + '"><h2 id="h-' + esc(c.id) + '">' + esc(c.name) + '</h2>' + (c.ko ? '<span class="ko" lang="ko">' + esc(c.ko) + '</span>' : '') + '</div>' +
        '<div class="items">' + items.map(itemCard).join('') + '</div></section>';
    }
    html += '</div><aside class="sidecart glass" id="sidecart" aria-label="Your order"></aside></div>';
    return html;
  }

  /* First word in the display face; the rest drops to a smaller line on phones. */
  function brandName(name) {
    const sp = name.indexOf(' ');
    return sp > 0 ? '<span class="nm-main">' + esc(name.slice(0, sp)) + '</span> <span class="nm-rest">' + esc(name.slice(sp + 1)) + '</span>' : esc(name);
  }

  function modeCard() {
    const d = S.store.delivery || {};
    const prep = S.store.prepMinutes || 0;
    const info =
      S.form.type === 'delivery'
        ? ic('pin', 16) + '<span><span class="num">' + peso(d.fee || 0) + '</span> delivery</span><span class="sep"></span><span><span class="num">' + peso(d.minOrder || 0) + '</span> minimum</span><span class="sep"></span><span>' + esc(d.area || '') + '</span>'
        : ic('clock', 16) + '<span>Ready in about <span class="num">' + prep + ' min</span> after we confirm</span>';
    return (
      '<div class="mode glass"><div class="seg" role="group" aria-label="Pickup or delivery">' +
      ['pickup', 'delivery']
        .map((t) => '<button type="button" id="mode-' + t + '" data-act="mode" data-mode="' + t + '" aria-pressed="' + (S.form.type === t) + '"' + (modeEnabled(t) ? '' : ' disabled') + '>' + ic(t === 'pickup' ? 'store' : 'pin', 18) + (t === 'pickup' ? 'Pickup' : 'Delivery') + '</button>')
        .join('') +
      '</div><p class="mode-info" id="mode-info">' + info + '</p></div>'
    );
  }

  function activeOrderBanner() {
    const now = Date.now();
    const a = recents().find((r) => !TERMINAL.includes(r.status) && now - (r.at || 0) < 12 * 3600e3);
    if (!a) return '';
    return (
      '<a class="active-order glass" href="#/track/' + encodeURIComponent(a.code) + '/' + encodeURIComponent(a.token) + '">' + ic('receipt') +
      '<span class="grow"><b class="num">' + esc(a.code) + '</b><small>' + esc(statusLabel(a.status, a.type)) + '</small></span>' +
      '<span class="btn sm">Track</span></a>'
    );
  }

  function itemCard(item) {
    const out = itemSoldOut(item);
    return (
      '<button type="button" class="item' + (out ? ' out' : '') + '" data-act="item" data-id="' + esc(item.id) + '"' + (out ? ' disabled' : '') + '>' +
      '<span class="item-text"><span class="item-name">' + esc(item.name) + '</span>' +
      (item.ko ? '<span class="item-ko" lang="ko">' + esc(item.ko) + '</span>' : '') +
      '<span class="item-foot"><span class="price">' + priceText(item) + '</span>' +
      (out ? '<span class="badge out">Sold out</span>' : item.badge ? '<span class="badge hot">' + esc(item.badge) + '</span>' : '') +
      '</span></span>' +
      '<span class="item-media">' + media(item, 176) + '<span class="incart" data-incart="' + esc(item.id) + '" hidden></span></span>' +
      '</button>'
    );
  }

  /* Cart bar (phones), side cart (wide screens) and the per-item "in cart" counts. */
  function renderCartUI() {
    const bar = document.getElementById('cartbar');
    const onMenu = S.route.name === 'menu' && S.store;
    if (!onMenu) {
      bar.hidden = true;
      return;
    }
    const t = totals();
    bar.hidden = !t.count;
    bar.innerHTML = t.count
      ? '<div class="cartbar-inner"><a class="btn primary lg cartbar-btn" href="#/cart" id="cartbar-btn"><span class="count">' + t.count + '</span><span class="lbl">View order</span><span class="amt">' + peso(t.subtotal) + '</span></a></div>'
      : '';

    const counts = {};
    for (const l of S.cart) counts[l.itemId] = (counts[l.itemId] || 0) + l.qty;
    for (const el of $$('[data-incart]')) {
      const n = counts[el.dataset.incart] || 0;
      el.hidden = !n;
      el.innerHTML = n + '<span class="sr"> in your order</span>';
    }

    const side = document.getElementById('sidecart');
    if (side) {
      const had = side.contains(document.activeElement) ? document.activeElement.id : '';
      const st = storeState(S.store, Date.now());
      side.innerHTML =
        '<h2 tabindex="-1">Your order</h2>' +
        (t.count
          ? '<div class="lines">' +
            t.rows
              .map(
                ({ l, p, i }) =>
                  '<div class="line compact' + (p.error ? ' bad' : '') + '"><span class="line-name">' + esc(p.item ? p.item.name : 'Unavailable item') + '</span><span class="line-amt">' + (p.error ? '' : peso(p.unit * l.qty)) + '</span>' +
                  (p.error ? '' : lineSub(p, l.note) ? '<span class="line-sub">' + esc(lineSub(p, l.note)) + '</span>' : '') +
                  '<div class="line-ctl">' + qtyCtl('line-qty', i, l.qty, p.item ? p.item.name : 'item', true) + '</div></div>'
              )
              .join('') +
            '</div>' + summaryRows(t) +
            '<a class="btn primary lg block" href="#/cart"' + (st.open ? '' : ' aria-disabled="true"') + '>' + (st.open ? 'Checkout' : 'Ordering closed') + '</a>'
          : '<p class="muted">Your order is empty. Tap an item to add it.</p>');
      if (had) {
        refocus(had);
        if (!side.contains(document.activeElement)) side.querySelector('h2').focus({ preventScroll: true });
      }
    }
  }

  let spy = null;
  function mountMenu() {
    if (spy) spy.disconnect();
    if (!('IntersectionObserver' in window)) return;
    /* Highlight the chip of the section under the sticky bar. */
    spy = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (vis) setChip(vis.target.dataset.cat);
      },
      { rootMargin: '-130px 0px -60% 0px' }
    );
    $$('.cat-sec').forEach((s) => spy.observe(s));
  }
  function setChip(cat) {
    const bar = document.getElementById('chips');
    if (!bar) return;
    let on = null;
    for (const c of $$('.chip', bar)) {
      const hit = c.dataset.cat === cat;
      if (hit) {
        c.setAttribute('aria-current', 'true');
        on = c;
      } else c.removeAttribute('aria-current');
    }
    /* Scroll the chip row only; scrollIntoView would also move the page. */
    if (on) {
      const l = on.offsetLeft - 16;
      const r = on.offsetLeft + on.offsetWidth + 16 - bar.clientWidth;
      if (bar.scrollLeft > l) bar.scrollLeft = l;
      else if (bar.scrollLeft < r) bar.scrollLeft = r;
    }
  }

  /* ---------- item sheet ---------- */

  let sheetReturn = null;
  function openSheet(html, onKey) {
    const layer = document.getElementById('layer');
    sheetReturn = document.activeElement;
    layer.innerHTML = html;
    document.body.classList.add('locked');
    const sheet = $('.sheet', layer);
    sheet._onKey = onKey;
    const first = $('[data-autofocus]', sheet) || $('button, input, textarea, select', sheet);
    if (first) first.focus({ preventScroll: true });
  }
  function closeSheet() {
    const layer = document.getElementById('layer');
    if (!layer.innerHTML) return;
    layer.innerHTML = '';
    document.body.classList.remove('locked');
    if (sheetReturn && document.contains(sheetReturn)) sheetReturn.focus({ preventScroll: true });
    sheetReturn = null;
  }

  let sel = null; /* item sheet selection */
  function openItem(id) {
    const item = findItem(id);
    if (!item || itemSoldOut(item)) return;
    const vs = item.variants || [];
    const firstLive = vs.find((v) => !v.soldOut);
    sel = { itemId: id, variantId: firstLive ? firstLive.id : '', mods: new Set(), qty: 1 };

    let body =
      '<div class="sheet-title"><h2 id="sheet-title">' + esc(item.name) + '</h2>' +
      (item.ko ? '<p lang="ko">' + esc(item.ko) + '</p>' : '') +
      '<span class="price">' + priceText(item) + '</span>' +
      (item.prepay === true ? '<p class="hint soft prepay">Paid ahead by GCash or Maya.</p>' : '') +
      '</div>';
    if (vs.length) {
      body +=
        '<div role="radiogroup" aria-labelledby="g-variant"><div class="group-head" id="g-variant"><b>' + esc(item.variantLabel || 'Choose') + '</b><small>Choose 1</small></div><div class="opts">' +
        vs
          .map(
            (v) =>
              '<label class="opt' + (v.soldOut ? ' disabled' : '') + '"><input type="radio" name="variant" value="' + esc(v.id) + '"' + (v.id === sel.variantId ? ' checked' : '') + (v.soldOut ? ' disabled' : '') + '>' +
              '<span class="mark"></span><span class="nm">' + esc(v.name) + '</span><span class="pr">' + (v.soldOut ? 'Sold out' : peso(v.price)) + '</span></label>'
          )
          .join('') +
        '</div></div>';
    }
    for (const g of item.addons || []) {
      body +=
        '<div role="group" aria-labelledby="g-' + esc(g.gid) + '"><div class="group-head" id="g-' + esc(g.gid) + '"><b>' + esc(g.name) + '</b><small>Optional</small></div><div class="opts">' +
        (g.options || [])
          .map(
            (o) =>
              '<label class="opt check' + (o.soldOut ? ' disabled' : '') + '"><input type="checkbox" name="mod" value="' + esc(g.gid + ':' + o.id) + '"' + (o.soldOut ? ' disabled' : '') + '>' +
              '<span class="mark"></span><span class="nm">' + esc(o.name) + '</span><span class="pr">+' + peso(o.price) + '</span></label>'
          )
          .join('') +
        '</div></div>';
    }
    body +=
      '<div class="field"><label for="item-note">Note for the kitchen</label>' +
      '<textarea id="item-note" class="input" maxlength="' + NOTE_MAX + '" rows="2" placeholder="Optional"></textarea></div>';

    openSheet(
      '<div class="scrim" data-act="scrim"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">' +
        '<div class="sheet-scroll"><div class="sheet-media">' + media(item, 560) +
        '<button type="button" class="icon-btn sheet-close" data-act="close" aria-label="Close">' + ic('close') + '</button></div><div class="sheet-body" id="item-form">' + body + '</div></div>' +
        '<div class="sheet-foot"><div class="qty" role="group" aria-label="Quantity">' +
        '<button type="button" data-act="sel-qty" data-d="-1" aria-label="Decrease quantity">' + ic('minus', 18) + '</button><output id="sel-qty" aria-live="polite">1</output>' +
        '<button type="button" data-act="sel-qty" data-d="1" aria-label="Increase quantity">' + ic('plus', 18) + '</button></div>' +
        '<button type="button" class="btn primary lg" data-act="add-item" id="add-item" data-autofocus><span>Add to order</span><span class="amt" id="sel-amt"></span></button></div>' +
        '</div></div>'
    );
    updateSel();
  }

  function selPrice() {
    const p = priceLine({ itemId: sel.itemId, variantId: sel.variantId, mods: selMods() });
    return p.error ? 0 : p.unit * sel.qty;
  }
  const selMods = () => Array.from(sel.mods, (k) => ({ gid: k.split(':')[0], oid: k.split(':').slice(1).join(':') }));
  function updateSel() {
    const amt = document.getElementById('sel-amt');
    if (!amt) return;
    amt.textContent = peso(selPrice());
    document.getElementById('sel-qty').textContent = sel.qty;
    const dec = $('[data-act="sel-qty"][data-d="-1"]');
    const inc = $('[data-act="sel-qty"][data-d="1"]');
    dec.disabled = sel.qty <= 1;
    inc.disabled = sel.qty >= MAX_QTY;
  }

  function addSelection() {
    const note = (document.getElementById('item-note').value || '').trim().slice(0, NOTE_MAX);
    const line = { itemId: sel.itemId, variantId: sel.variantId, mods: selMods(), qty: sel.qty, note };
    const p = priceLine(line);
    if (p.error) {
      toast(p.error);
      return;
    }
    const key = lineKey(line);
    const hit = S.cart.find((l) => lineKey(l) === key);
    if (hit) hit.qty = Math.min(MAX_QTY, hit.qty + line.qty);
    else {
      if (S.cart.length >= MAX_LINES) {
        toast('Your order is full. Check out or remove an item first.');
        return;
      }
      S.cart.push(line);
    }
    saveCart();
    closeSheet();
    renderCartUI();
    toast('Added to your order');
  }

  /* ---------- checkout ---------- */

  const STEPS = { cart: 1, details: 2, pay: 3 };
  const BACK = { cart: '#/', details: '#/cart', pay: '#/details' };

  function coFrame(step, title, main, side, cta) {
    const n = STEPS[step];
    return (
      '<div class="wrap">' +
      '<header class="topbar"><a class="icon-btn" href="' + BACK[step] + '" aria-label="Back">' + ic('back', 22) + '</a><h1>' + title + '</h1>' + demoTag() + '<span class="step">Step ' + n + ' of 3</span></header>' +
      '<div class="progress" aria-hidden="true">' + [1, 2, 3].map((i) => '<i' + (i <= n ? ' class="on"' : '') + '></i>').join('') + '</div>' +
      '<div class="co"><div class="co-main">' + main + '</div><div class="co-side">' + side + (cta ? '<div class="cta-bar" id="cta">' + cta + '</div>' : '') + '</div></div>' +
      '</div>'
    );
  }

  function closedNotice() {
    const st = storeState(S.store, Date.now());
    return st.open ? '' : '<div class="notice bad" id="closed-note">' + ic('clock') + '<div><b>' + esc(closedText(st, Date.now())) + '</b>You can still build your order.</div></div>';
  }

  function viewCart() {
    const t = totals();
    const st = storeState(S.store, Date.now());
    if (!S.cart.length) {
      return coFrame(
        'cart',
        'Your order',
        '<div class="panel glass empty">' + ic('bag', 32) + '<h2>Your order is empty</h2><p>Add something from the menu.</p><a class="btn primary" href="#/">Browse the menu</a></div>',
        '',
        ''
      );
    }
    const lines = t.rows
      .map(({ l, p, i }) => {
        const name = p.item ? p.item.name : 'Unavailable item';
        const sub = p.error ? '' : lineSub(p, l.note);
        return (
          '<div class="line' + (p.error ? ' bad' : '') + '"><span class="line-name">' + esc(name) + '</span><span class="line-amt">' + (p.error ? '' : peso(p.unit * l.qty)) + '</span>' +
          (sub ? '<span class="line-sub">' + esc(sub) + '</span>' : '') +
          (p.error ? '<span class="line-warn">' + esc(p.error) + '</span>' : '') +
          '<div class="line-ctl">' + qtyCtl('line-qty', i, l.qty, name) +
          (p.error ? '' : '<span class="muted num">' + peso(p.unit) + ' each</span>') +
          '<button type="button" class="btn ghost sm" id="del-' + i + '" data-act="line-del" data-i="' + i + '">Remove</button></div></div>'
        );
      })
      .join('');
    const d = S.store.delivery || {};
    const warn =
      t.minShort > 0
        ? '<div class="notice warn">' + ic('alert') + '<div><b>Delivery needs at least ' + peso(d.minOrder) + '.</b>Add ' + peso(t.minShort) + ' more, or switch to pickup.</div></div>'
        : '';
    const blocked = !st.open || t.bad > 0;
    return coFrame(
      'cart',
      'Your order',
      closedNotice() + warn +
        '<section class="panel glass" aria-labelledby="p-items"><div class="panel-head"><h2 id="p-items">' + plural(t.count, 'item', 'items') + '</h2><a class="link" href="#/">Add more</a></div><div class="lines">' + lines + '</div></section>',
      '<section class="panel glass" aria-label="Summary">' + summaryRows(t) + '</section>',
      (t.bad ? '<p class="form-error" role="alert">' + ic('alert') + '<span>Remove unavailable items to continue.</span></p>' : '') +
        '<a class="btn primary lg block center" href="#/details" id="to-details"' + (blocked ? ' aria-disabled="true" tabindex="-1"' : '') + '>Continue</a>'
    );
  }

  /* Inline field validation. Messages are plain sentences the customer can act on. */
  const V = {
    name: (v) => {
      const n = v.trim().length;
      return n >= 2 && n <= 60 ? '' : n ? 'Enter your name (2 to 60 characters).' : 'Enter your name.';
    },
    phone: (v) => (cleanPhone(v) ? '' : v.trim() ? 'Enter a PH mobile number, like 0917 123 4567.' : 'Enter your mobile number.'),
    address: (v) => (S.form.type !== 'delivery' || v.trim().length >= 5 ? '' : 'Enter your delivery address.'),
    ref: (v) => {
      if (!EWALLET[S.form.method]) return '';
      const r = cleanRef(v);
      return REF_RE.test(r) ? '' : r ? 'Reference numbers are 6 to 20 letters or digits.' : 'Enter the reference number from your ' + EWALLET[S.form.method] + ' receipt.';
    },
  };
  function fieldError(f) {
    return S.touched[f] && V[f] ? V[f](S.form[f] || '') : '';
  }
  function showFieldError(f) {
    const el = document.getElementById('e-' + f);
    const input = document.getElementById('f-' + f);
    const msg = fieldError(f);
    if (el) el.innerHTML = msg ? ic('alert', 16) + '<span>' + esc(msg) + '</span>' : '';
    if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }

  function field(f, label, attrs, hint) {
    const msg = fieldError(f);
    const tag = attrs.textarea ? 'textarea' : 'input';
    const a = Object.assign({}, attrs);
    const cls = a.cls ? ' ' + a.cls : '';
    delete a.textarea;
    delete a.cls;
    const attrStr = Object.keys(a)
      .map((k) => ' ' + k + '="' + esc(a[k]) + '"')
      .join('');
    const val = esc(S.form[f] || '');
    return (
      '<div class="field"><label for="f-' + f + '">' + label + '</label>' +
      '<' + tag + ' id="f-' + f + '" class="input' + cls + '" data-f="' + f + '"' + attrStr + ' aria-describedby="e-' + f + (hint ? ' h-' + f : '') + '" aria-invalid="' + (msg ? 'true' : 'false') + '"' +
      (tag === 'input' ? ' value="' + val + '">' : '>' + val + '</textarea>') +
      (hint ? '<span class="hint" id="h-' + f + '">' + hint + '</span>' : '') +
      '<p class="err" id="e-' + f + '">' + (msg ? ic('alert', 16) + '<span>' + esc(msg) + '</span>' : '') + '</p></div>'
    );
  }

  function viewDetails() {
    const t = totals();
    const s = S.store;
    const d = s.delivery || {};
    const prep = s.prepMinutes || 0;
    const slots = laterSlots(s, Date.now());
    if (S.form.when === 'later' && !slots.includes(S.form.time)) S.form.time = slots[0] || 0;
    if (!slots.length) S.form.when = 'asap';
    const deliv = S.form.type === 'delivery';

    const how =
      '<section class="panel glass" aria-labelledby="p-how"><h2 id="p-how">Pickup or delivery</h2>' +
      '<div class="seg" role="group" aria-label="Pickup or delivery">' +
      ['pickup', 'delivery']
        .map((m) => '<button type="button" id="mode-' + m + '" data-act="mode" data-mode="' + m + '" aria-pressed="' + (S.form.type === m) + '"' + (modeEnabled(m) ? '' : ' disabled') + '>' + ic(m === 'pickup' ? 'store' : 'pin', 18) + (m === 'pickup' ? 'Pickup' : 'Delivery') + '</button>')
        .join('') +
      '</div>' +
      (deliv
        ? '<p class="hint soft">' + esc(d.area || '') + ' only. ' + peso(d.fee || 0) + ' fee, ' + peso(d.minOrder || 0) + ' minimum order.</p>' +
          (t.minShort > 0 ? '<p class="form-error" id="e-min" role="alert">' + ic('alert') + '<span>Add ' + peso(t.minShort) + ' more for delivery, or choose pickup.</span></p>' : '') +
          field('address', 'Delivery address', { textarea: 1, rows: 2, maxlength: 200, autocomplete: 'street-address', placeholder: 'House no., street, barangay' }) +
          field('landmark', 'Landmark', { maxlength: 120, placeholder: 'Optional, for the rider' })
        : '<p class="hint soft">Pick up at ' + esc(s.address || 'the store') + '.</p>') +
      '</section>';

    const when =
      '<section class="panel glass" aria-labelledby="p-when"><h2 id="p-when">When</h2>' +
      '<div class="seg" role="group" aria-label="When">' +
      '<button type="button" id="when-asap" data-act="when" data-when="asap" aria-pressed="' + (S.form.when === 'asap') + '">As soon as possible</button>' +
      '<button type="button" id="when-later" data-act="when" data-when="later" aria-pressed="' + (S.form.when === 'later') + '"' + (slots.length ? '' : ' disabled') + '>Later today</button></div>' +
      (S.form.when === 'later'
        ? '<div class="field"><label for="f-time">Time</label><select id="f-time" class="input" data-f="time">' +
          slots.map((x) => '<option value="' + x + '"' + (x === S.form.time ? ' selected' : '') + '>' + timeOf(x) + '</option>').join('') +
          '</select></div>'
        : '<p class="hint soft">Usually ready about ' + prep + ' minutes after we confirm.</p>') +
      '</section>';

    const contact =
      '<section class="panel glass" aria-labelledby="p-you"><h2 id="p-you">Your details</h2>' +
      field('name', 'Name', { autocomplete: 'name', maxlength: 60, placeholder: 'Juan Dela Cruz' }) +
      field('phone', 'Mobile number', { type: 'tel', inputmode: 'tel', autocomplete: 'tel', maxlength: 20, placeholder: '0917 123 4567' }, 'We call this number only about your order.') +
      '</section>';

    const st = storeState(s, Date.now());
    return coFrame(
      'details',
      'Details',
      closedNotice() + how + when + contact,
      '<section class="panel glass" aria-label="Summary">' + summaryRows(t) + '</section>',
      '<button type="button" class="btn primary lg block center" data-act="to-pay" id="to-pay"' + (st.open ? '' : ' disabled') + '>Continue to payment</button>'
    );
  }

  function detailsValid(focus) {
    const fs = ['name', 'phone'].concat(S.form.type === 'delivery' ? ['address'] : []);
    let first = null;
    for (const f of fs) {
      S.touched[f] = true;
      showFieldError(f);
      if (!first && V[f](S.form[f] || '')) first = f;
    }
    const t = totals();
    if (focus && first) {
      const el = document.getElementById('f-' + first);
      if (el) el.focus();
    }
    if (!first && t.minShort > 0) {
      if (focus) toast('Add ' + peso(t.minShort) + ' more for delivery, or choose pickup.');
      return false;
    }
    return !first;
  }

  function viewPay() {
    const t = totals();
    S.payTotal = t.total;
    const s = S.store;
    const f = S.form;
    if (f.method && !methodState(f.method).ok) f.method = '';
    const methods = ['gcash', 'maya', 'cash']
      .map((m) => {
        const ms = methodState(m);
        const title = EWALLET[m] || (f.type === 'delivery' ? 'Cash on delivery' : 'Cash on pickup');
        const small = ms.ok ? (EWALLET[m] ? 'Scan to pay now' : f.type === 'delivery' ? 'Pay the rider' : 'Pay at the counter') : ms.why;
        return (
          '<label class="choice' + (ms.ok ? '' : ' disabled') + '"><input type="radio" id="m-' + m + '" name="method" value="' + m + '" data-f="method"' + (f.method === m ? ' checked' : '') + (ms.ok ? '' : ' disabled') + '>' +
          '<span class="pay-logo ' + m + '" aria-hidden="true">' + (m === 'cash' ? '₱' : m === 'gcash' ? 'G' : 'M') + '</span>' +
          '<span class="txt"><b>' + title + '</b><small>' + esc(small) + '</small></span><span class="mark"></span></label>'
        );
      })
      .join('');

    let payBox = '';
    if (EWALLET[f.method]) {
      const p = s.payments[f.method];
      const label = EWALLET[f.method];
      const digits = String(p.number || '').replace(/\s+/g, '');
      payBox =
        '<section class="panel glass pay-box" aria-labelledby="p-wallet"><h2 id="p-wallet" class="sr">Pay with ' + label + '</h2>' +
        '<div class="pay-amount"><small>Pay exactly</small><b id="pay-exact">' + peso(t.total) + '</b></div>' +
        '<div class="qr"><img src="' + esc(p.qr) + '" alt="' + label + ' QR code for ' + esc(p.accountName || s.name || '') + '"></div>' +
        '<div class="acct"><div class="grow"><small>' + label + ' account</small><b class="selectable">' + esc(p.accountName || '') + '</b>' +
        (p.number ? '<div class="selectable num soft">' + esc(p.number) + '</div>' : '') + '</div>' +
        (p.number && /^\d+$/.test(digits) ? '<button type="button" class="btn sm" data-act="copy" data-copy="' + esc(digits) + '">' + ic('copy', 16) + 'Copy</button>' : '') +
        '</div>' +
        '<ol class="steps-hint"><li>Open ' + label + ' and scan the QR' + (p.number ? ' or send to the number' : '') + '.</li><li>Pay exactly ' + peso(t.total) + '.</li><li>Enter the reference number from the receipt.</li></ol>' +
        field('ref', 'Reference number', { inputmode: f.method === 'gcash' ? 'numeric' : 'text', autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false', maxlength: 26, cls: 'ref', placeholder: 'From your receipt' }) +
        field('sender', 'Name on the ' + label + ' account', { autocomplete: 'off', maxlength: 60, placeholder: 'Optional' }) +
        proofField() +
        '</section>';
    } else if (f.method === 'cash') {
      payBox =
        '<div class="notice">' + ic('receipt') + '<div><b>Pay ' + peso(t.total) + ' in cash ' + (f.type === 'delivery' ? 'to the rider' : 'at the counter') + '.</b>Exact amount helps.</div></div>';
    }

    const recap =
      '<section class="panel glass" aria-labelledby="p-sum"><div class="panel-head"><h2 id="p-sum">Summary</h2><a class="link" href="#/cart">Edit</a></div>' +
      '<div class="lines">' +
      t.rows
        .filter(({ p }) => !p.error)
        .map(({ l, p }) => '<div class="line compact"><span class="line-name"><span class="q">' + l.qty + 'x</span>' + esc(p.name) + '</span><span class="line-amt">' + peso(p.unit * l.qty) + '</span>' + (lineSub(p, l.note) ? '<span class="line-sub">' + esc(lineSub(p, l.note)) + '</span>' : '') + '</div>')
        .join('') +
      '</div>' + summaryRows(t) +
      '<div class="kv"><div class="kv-row"><span>' + (f.type === 'delivery' ? 'Delivery' : 'Pickup') + '</span><span>' + (f.when === 'later' && f.time ? 'Today ' + timeOf(f.time) : 'As soon as possible') + '</span></div>' +
      (f.type === 'delivery' ? '<div class="kv-row"><span>Address</span><span>' + esc(f.address) + '</span></div>' : '') +
      '<div class="kv-row"><span>Contact</span><span>' + esc(f.name) + ', <span class="num">' + esc(cleanPhone(f.phone)) + '</span></span></div>' +
      '<a class="link" href="#/details">Change details</a></div></section>';

    return coFrame(
      'pay',
      'Payment',
      closedNotice() + '<section class="panel glass" aria-labelledby="p-method"><h2 id="p-method">Payment method</h2><div class="choice-grid three" role="radiogroup" aria-labelledby="p-method">' + methods + '</div>' +
        '<p class="err-line" id="e-method" role="alert">' + esc(S.touched.method && !f.method ? 'Choose a payment method.' : '') + '</p></section>' + payBox,
      recap,
      ctaPay(t)
    );
  }

  function proofField() {
    const f = S.form;
    if (S.proofBusy) return '<div class="upload" aria-live="polite">' + ic('image') + '<span>Preparing screenshot</span></div>';
    if (f.proof) {
      return (
        '<div class="field"><span class="label">Payment screenshot</span><div class="proof"><img src="' + esc(f.proof) + '" alt="Payment screenshot"><span class="grow soft">Attached</span>' +
        '<button type="button" class="btn sm ghost" data-act="proof-del">Remove</button></div></div>'
      );
    }
    return (
      '<div class="field"><label class="upload">' + ic('image') + '<span>Add payment screenshot <span class="muted">(optional)</span></span>' +
      '<input type="file" accept="image/*" id="f-proof" data-f="proof" aria-describedby="e-proof"></label><p class="err" id="e-proof"></p></div>'
    );
  }

  function ctaPay(t) {
    const st = storeState(S.store, Date.now());
    const e = S.placeErr;
    let errHtml = '';
    if (e) {
      const goto = /^customer\.|^fulfillment\./.test(e.field) ? '<a class="link" href="#/details">Edit details</a>' : /^items/.test(e.field) ? '<a class="link" href="#/cart">Edit order</a>' : '';
      errHtml = '<p class="form-error" id="place-error" role="alert">' + ic('alert') + '<span>' + esc(e.msg) + ' ' + goto + '</span></p>';
    }
    const btn = S.placing
      ? '<button type="button" class="btn primary lg block center busy" id="place" aria-busy="true"><span class="spin" aria-hidden="true"></span>Placing order</button>'
      : '<button type="button" class="btn primary lg block" data-act="place" id="place"' + (st.open ? '' : ' disabled') + '><span>Place order</span><span class="amt">' + peso(t.total) + '</span></button>';
    return errHtml + btn;
  }
  function renderCta() {
    const el = document.getElementById('cta');
    if (el && S.route.name === 'pay') el.innerHTML = ctaPay(totals());
  }

  /* Screenshot to JPEG, re-encoded until it fits the 1.5 MB limit. The short side is capped at
   * 1080 px and the long side at 4096 px, so a tall scrolling receipt keeps readable text. If
   * the lowest quality is still too big the image shrinks and tries again. The data URL string
   * itself is kept under the limit, so both readings of "1.5 MB" hold. */
  function compressImage(file) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type || 'image/')) return reject(new Error('Choose a photo or screenshot.'));
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const nw = img.naturalWidth;
          const nh = img.naturalHeight;
          let scale = Math.min(1, 1080 / Math.min(nw, nh), 4096 / Math.max(nw, nh));
          let out = '';
          for (let round = 0; round < 4; round++, scale *= 0.7) {
            const w = Math.max(1, Math.round(nw * scale));
            const h = Math.max(1, Math.round(nh * scale));
            const c = document.createElement('canvas');
            c.width = w;
            c.height = h;
            const ctx = c.getContext('2d');
            ctx.fillStyle = '#fff'; /* transparent PNGs become white, not black */
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);
            let q = 0.82;
            out = c.toDataURL('image/jpeg', q);
            while (out.length > PROOF_MAX && q > 0.35) {
              q -= 0.12;
              out = c.toDataURL('image/jpeg', q);
            }
            if (out.length <= PROOF_MAX) break;
          }
          if (out.length > PROOF_MAX) reject(new Error('That image is too large. Try a smaller screenshot.'));
          else resolve(out);
        } catch (e) {
          reject(new Error('That image could not be read. Try another screenshot.'));
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('That file is not an image we can read. Try a JPEG or PNG.'));
      };
      img.src = url;
    });
  }

  /* v1.1 rule 5: SHA-256 hex of the image bytes (not the data URL text), as the server computes
   * it. SubtleCrypto exists only on https and localhost; elsewhere the fingerprint is skipped. */
  async function sha256Hex(dataUrl) {
    try {
      if (!(window.crypto && crypto.subtle)) return '';
      const bin = atob(String(dataUrl).slice(String(dataUrl).indexOf(',') + 1));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      return '';
    }
  }

  function payValid() {
    S.touched.method = true;
    if (!S.form.method) {
      const e = document.getElementById('e-method');
      if (e) e.textContent = 'Choose a payment method.';
      const first = $('input[name="method"]:not([disabled])');
      if (first) first.focus();
      return false;
    }
    if (EWALLET[S.form.method]) {
      S.touched.ref = true;
      showFieldError('ref');
      if (V.ref(S.form.ref)) {
        document.getElementById('f-ref').focus();
        return false;
      }
    }
    return true;
  }

  function buildRequest() {
    const f = S.form;
    if (!S.clientId) S.clientId = uuid();
    const deliv = f.type === 'delivery';
    const wallet = !!EWALLET[f.method];
    return {
      clientId: S.clientId,
      items: S.cart.map((l) => ({ itemId: l.itemId, variantId: l.variantId || '', mods: (l.mods || []).map((m) => ({ gid: m.gid, oid: m.oid })), qty: l.qty, note: l.note || '' })),
      customer: { name: f.name.trim(), phone: cleanPhone(f.phone) },
      fulfillment: { type: f.type, time: f.when === 'later' && f.time ? f.time : 'asap', address: deliv ? f.address.trim() : '', landmark: deliv ? f.landmark.trim() : '' },
      payment: Object.assign(
        { method: f.method, ref: wallet ? cleanRef(f.ref) : '', sender: wallet ? f.sender.trim() : '', proof: wallet ? f.proof : '' },
        wallet && f.proof && f.proofSha ? { proofSha: f.proofSha } : {}
      ),
      note: '',
    };
  }

  async function placeOrder() {
    if (S.placing) return;
    if (!detailsValidSilent()) {
      location.hash = '#/details';
      return;
    }
    if (!payValid()) return;
    S.placing = true;
    S.placeErr = null;
    renderCta();
    try {
      const res = await T.place(buildRequest());
      const o = res.order || {};
      rememberOrder({ code: res.code, token: res.token, at: o.createdAt || Date.now(), total: o.total || 0, status: o.status || 'pending', type: (o.fulfillment && o.fulfillment.type) || S.form.type });
      S.cart = [];
      saveCart();
      Object.assign(S.form, { method: '', ref: '', sender: '', proof: '', proofSha: '', when: 'asap', time: 0 });
      saveWhen();
      S.touched = {};
      S.placing = false;
      S.track = { code: res.code, token: res.token, order: o.code ? o : null, missing: false, err: '', checkedAt: Date.now() };
      location.hash = '#/track/' + encodeURIComponent(res.code) + '/' + encodeURIComponent(res.token);
    } catch (e) {
      S.placing = false;
      S.placeErr = { msg: e.message || 'Something went wrong. Please try again.', field: e.field || '' };
      if (e.status === 423) await refreshStore();
      if (S.route.name !== 'pay') return;
      if (/^payment\./.test(S.placeErr.field) || e.status === 423) {
        /* Re-render so the error sits next to the field, then focus it. */
        render(true);
        const f = S.placeErr.field.split('.')[1];
        const el = f && document.getElementById('f-' + f);
        if (el && f === 'ref') {
          const box = document.getElementById('e-ref');
          if (box) box.innerHTML = ic('alert', 16) + '<span>' + esc(S.placeErr.msg) + '</span>';
          el.setAttribute('aria-invalid', 'true');
          el.focus();
        }
      } else renderCta();
    }
  }

  function detailsValidSilent() {
    const f = S.form;
    return !V.name(f.name) && !V.phone(f.phone) && !V.address(f.address) && totals().minShort === 0;
  }

  /* ---------- tracking ---------- */

  const LABEL = {
    pending: 'Waiting for confirmation',
    accepted: 'Confirmed',
    preparing: 'Preparing',
    ready: 'Ready for pickup',
    out_for_delivery: 'Out for delivery',
    completed: 'Completed',
    rejected: 'Not accepted',
    cancelled: 'Cancelled',
  };
  const statusLabel = (st, type) => (st === 'ready' && type === 'delivery' ? 'Ready' : LABEL[st] || 'Placed');
  const stepsFor = (type) => (type === 'delivery' ? ['pending', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'completed'] : ['pending', 'accepted', 'preparing', 'ready', 'completed']);

  /* v1.1 rule 7: pending for more than 5 minutes reads as slow, with the shop phone. */
  const SLOW_MS = 5 * 60e3;
  const isSlow = (o) => o.status === 'pending' && Number.isFinite(o.createdAt) && Date.now() + clockSkew - o.createdAt > SLOW_MS;

  function etaText(o) {
    const f = o.fulfillment || {};
    const sched = typeof f.time === 'number' ? f.time : 0;
    const deliv = f.type === 'delivery';
    const prep = (S.store && S.store.prepMinutes) || 20;
    const acc = (o.timeline || []).find((x) => x.status === 'accepted');
    const eta = o.etaAt || (sched ? 0 : acc ? acc.at + prep * 60e3 : 0);
    switch (o.status) {
      case 'pending':
        if (isSlow(o)) return 'Taking longer than usual. Call us at ' + ((S.store && S.store.phone) || 'the store') + '.';
        return (sched ? 'Scheduled for ' + timeOf(sched) + '. ' : '') + (EWALLET[o.payment && o.payment.method] ? 'We are checking your payment.' : 'We will confirm your order shortly.');
      case 'accepted':
      case 'preparing':
        if (sched && !o.etaAt) return 'Scheduled for ' + timeOf(sched) + '.';
        return eta ? (deliv ? 'Expected around ' : 'Ready around ') + timeOf(eta) + '.' : 'We are on it.';
      case 'ready':
        return deliv ? 'Packed and waiting for the rider.' : 'Your order is waiting at the counter.';
      case 'out_for_delivery':
        return 'The rider is on the way' + (o.etaAt ? ', expected around ' + timeOf(o.etaAt) : '') + '.';
      case 'completed':
        return 'Thank you for ordering from Mogoba.';
      case 'rejected':
        return 'The store could not accept this order.';
      case 'cancelled':
        return 'This order was cancelled.';
      default:
        return '';
    }
  }

  function viewTrack() {
    const t = S.track;
    const top =
      '<header class="topbar"><a class="icon-btn" href="#/" aria-label="Back to menu">' + ic('back', 22) + '</a><h1>Your order</h1>' + demoTag() + '</header>';
    if (!t.order) {
      if (t.missing) {
        return '<div class="wrap narrow">' + top + '<div class="panel glass empty">' + ic('receipt', 32) + '<h2>Order not found</h2><p>Check the link, or call the store.</p>' + phoneBlock() + '<a class="btn" href="#/">Back to menu</a></div></div>';
      }
      if (t.err) {
        return '<div class="wrap narrow">' + top + '<div class="panel glass empty">' + ic('alert', 32) + '<h2>Could not load your order</h2><p>' + esc(t.err) + '</p><button type="button" class="btn" data-act="retry-track">Try again</button></div></div>';
      }
      return '<div class="wrap narrow">' + top + '<div class="boot" role="status"><span>Loading your order</span></div></div>';
    }
    const o = t.order;
    const f = o.fulfillment || {};
    const type = f.type;
    const bad = o.status === 'rejected' || o.status === 'cancelled';
    const tone = bad ? 'bad' : o.status === 'pending' ? 'wait' : 'ok';
    t.slowShown = isSlow(o);
    const steps = stepsFor(type);
    const cur = steps.indexOf(o.status);
    const at = {};
    for (const e of o.timeline || []) at[e.status] = e.at;

    const head =
      '<section class="glass track-head" aria-live="polite"><span class="muted">Order</span><span class="track-code selectable">' + esc(o.code) + '</span>' +
      '<span class="track-status ' + tone + '" id="track-status">' + esc(statusLabel(o.status, type)) + '</span>' +
      '<span class="track-eta" id="track-eta">' + esc(etaText(o)) + '</span></section>';

    const stepper = bad
      ? '<div class="notice bad">' + ic('alert') + '<div><b>' + esc(statusLabel(o.status, type)) + '</b>' +
        (o.status === 'rejected' && o.reason ? 'Reason: ' + esc(String(o.reason).replace(/[.\s]+$/, '')) + '. ' : '') +
        (EWALLET[o.payment && o.payment.method] ? 'If you already paid, call us about a refund.' : 'Call us if you have questions.') + '</div></div>'
      : '<section class="panel glass" aria-labelledby="p-prog"><h2 id="p-prog">Progress</h2><ol class="stepper">' +
        steps
          .map((s, i) => {
            const cls = i < cur || (i === cur && s === 'completed') ? 'done' : i === cur ? 'now' : '';
            return '<li class="' + cls + '"' + (i === cur ? ' aria-current="step"' : '') + '><span class="node">' + (cls === 'done' ? ic('check', 14) : '') + '</span><span class="txt">' + esc(statusLabel(s, type)) + (at[s] ? '<small>' + timeOf(at[s]) + '</small>' : '') + '</span></li>';
          })
          .join('') +
        '</ol></section>';

    const pay = o.payment || {};
    const wallet = EWALLET[pay.method];
    let payBadge;
    if (wallet) {
      if (o.status === 'rejected') payBadge = '<span class="badge out">Not confirmed</span>';
      else if (pay.verified || CONFIRMED.includes(o.status)) payBadge = '<span class="badge ok" id="pay-status">Payment confirmed</span>';
      else payBadge = '<span class="badge wait" id="pay-status">Waiting for payment check</span>';
    } else {
      payBadge = o.status === 'completed' ? '<span class="badge ok">Paid</span>' : '<span class="badge muted">Pay on ' + (type === 'delivery' ? 'delivery' : 'pickup') + '</span>';
    }
    const payPanel =
      '<section class="panel glass" aria-labelledby="p-pay"><div class="panel-head"><h2 id="p-pay">Payment</h2>' + payBadge + '</div><div class="kv">' +
      '<div class="kv-row"><span>Method</span><span>' + (wallet || (type === 'delivery' ? 'Cash on delivery' : 'Cash on pickup')) + '</span></div>' +
      (wallet && pay.ref ? '<div class="kv-row"><span>Reference</span><span class="num selectable">' + esc(pay.ref) + '</span></div>' : '') +
      '<div class="kv-row"><span>Amount</span><span class="num">' + peso(o.total) + '</span></div></div></section>';

    const contact = '<section class="panel glass" aria-labelledby="p-help"><h2 id="p-help">Questions about your order?</h2>' + phoneBlock() + '</section>';

    const summary =
      '<section class="panel glass" aria-labelledby="p-items"><h2 id="p-items">Order summary</h2><div class="lines">' +
      (o.lines || [])
        .map((l) => {
          const sub = lineSub({ variantName: l.variantName, mods: l.mods }, l.note);
          const qty = Number(l.qty) | 0;
          return '<div class="line compact"><span class="line-name"><span class="q">' + qty + 'x</span>' + esc(l.name) + '</span><span class="line-amt">' + peso((Number(l.unit) | 0) * qty) + '</span>' + (sub ? '<span class="line-sub">' + esc(sub) + '</span>' : '') + '</div>';
        })
        .join('') +
      '</div><div class="sum"><div class="sumrow"><span>Subtotal</span><span>' + peso(o.subtotal) + '</span></div>' +
      (o.deliveryFee ? '<div class="sumrow"><span>Delivery fee</span><span>' + peso(o.deliveryFee) + '</span></div>' : '') +
      '<div class="sumrow total"><span>Total</span><span class="val">' + peso(o.total) + '</span></div></div>' +
      '<div class="kv"><div class="kv-row"><span>' + (type === 'delivery' ? 'Delivery' : 'Pickup') + '</span><span>' + (typeof f.time === 'number' ? 'Today ' + timeOf(f.time) : 'As soon as possible') + '</span></div>' +
      (type === 'delivery' ? '<div class="kv-row"><span>Address</span><span>' + esc(f.address) + (f.landmark ? ', ' + esc(f.landmark) : '') + '</span></div>' : '') +
      (o.customer ? '<div class="kv-row"><span>Name</span><span>' + esc(o.customer.name) + '</span></div>' : '') +
      '<div class="kv-row"><span>Placed</span><span>' + timeOf(o.createdAt) + '</span></div></div></section>';

    const timeline =
      '<section class="panel glass" aria-labelledby="p-time"><h2 id="p-time">Timeline</h2><ol class="timeline">' +
      (o.timeline || [])
        .slice()
        .reverse()
        .filter((e) => e && Number.isFinite(e.at))
        .map((e) => '<li><span>' + esc(statusLabel(e.status, type)) + '</span><time datetime="' + new Date(e.at).toISOString() + '">' + timeOf(e.at) + '</time></li>')
        .join('') +
      '</ol></section>';

    const again = '<button type="button" class="btn block" data-act="again">' + ic('bag', 18) + 'Order again</button>';
    const live = TERMINAL.includes(o.status) ? '' : '<p class="updated">Updates automatically' + (t.checkedAt ? ', last checked ' + timeOf(t.checkedAt) : '') + '</p>';

    return (
      '<div class="wrap">' + top +
      '<div class="track-grid"><div class="track-col">' + head + stepper + payPanel + contact + '</div>' +
      '<div class="track-col">' + summary + timeline + again + live + '</div></div></div>'
    );
  }

  function phoneBlock() {
    const phone = (S.store && S.store.phone) || '';
    if (!phone) return '';
    const tel = phone.replace(/[^\d+]/g, '');
    return (
      '<div class="phone-row"><div class="grow"><small class="muted">Call Mogoba</small><br><b class="selectable" id="store-phone">' + esc(phone) + '</b></div>' +
      '<a class="btn" href="tel:' + esc(tel) + '">' + ic('phone', 18) + 'Call</a></div>'
    );
  }

  let pollTimer = 0;
  let polling = false;
  async function pollTrack() {
    const t = S.track;
    if (!t || polling) return;
    polling = true;
    try {
      const o = await T.track(t.code, t.token);
      if (S.track !== t) return;
      t.checkedAt = Date.now();
      t.err = '';
      if (!o) {
        t.missing = !t.order;
      } else {
        /* Crossing the 5 minute mark changes the page even when the order itself did not. */
        const changed = !t.order || t.order.updatedAt !== o.updatedAt || t.order.status !== o.status || isSlow(o) !== !!t.slowShown;
        t.order = o;
        updateRecent(o);
        if (!changed) {
          const u = $('.updated');
          if (u) u.textContent = 'Updates automatically, last checked ' + timeOf(t.checkedAt);
          return;
        }
      }
      if (S.route.name === 'track') render(true);
      if (t.order && TERMINAL.includes(t.order.status)) stopPoll();
    } catch (e) {
      if (S.track === t && !t.order) {
        t.err = e.message;
        if (S.route.name === 'track') render(true);
      }
    } finally {
      polling = false;
    }
  }
  function stopPoll() {
    clearInterval(pollTimer);
    pollTimer = 0;
  }

  function orderAgain() {
    const o = S.track && S.track.order;
    if (!o) return;
    let added = 0;
    for (const l of o.lines || []) {
      const line = { itemId: l.itemId, variantId: l.variantId || '', mods: (l.mods || []).map((m) => ({ gid: m.gid, oid: m.oid })), qty: l.qty, note: l.note || '' };
      if (priceLine(line).error) continue;
      const hit = S.cart.find((c) => lineKey(c) === lineKey(line));
      if (hit) hit.qty = Math.min(MAX_QTY, hit.qty + line.qty);
      else if (S.cart.length < MAX_LINES) S.cart.push(line);
      else continue;
      added++;
    }
    if (!added) {
      toast('These items are not available right now.');
      return;
    }
    saveCart();
    if (added < (o.lines || []).length) toast('Some items are not available and were left out.');
    location.hash = '#/cart';
  }

  /* The badge shares the code's line so the date and amount get the full row width. */
  const recentBadge = (r) =>
    '<span class="badge ' + (r.status === 'rejected' || r.status === 'cancelled' ? 'out' : r.status === 'pending' ? 'wait' : 'ok') + '">' + esc(statusLabel(r.status, r.type)) + '</span>';

  function viewOrders() {
    const list = recents();
    return (
      '<div class="wrap narrow"><header class="topbar"><a class="icon-btn" href="#/" aria-label="Back to menu">' + ic('back', 22) + '</a><h1>Your orders</h1>' + demoTag() + '</header>' +
      (list.length
        ? '<div class="recent">' +
          list
            .map(
              (r) =>
                '<a class="glass" href="#/track/' + encodeURIComponent(r.code) + '/' + encodeURIComponent(r.token) + '"><span class="grow"><span class="top"><b>' + esc(r.code) + '</b>' + recentBadge(r) + '</span><small>' +
                esc(new Date(r.at).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric' }) + ', ' + timeOf(r.at) + ', ' + peso(r.total || 0)) +
                '</small></span>' + ic('right', 18) + '</a>'
            )
            .join('') +
          '</div><p class="updated" style="margin-top:12px">Saved on this device only.</p>'
        : '<div class="panel glass empty">' + ic('receipt', 32) + '<h2>No orders yet</h2><p>Orders you place on this device show up here.</p><a class="btn primary" href="#/">Browse the menu</a></div>') +
      '</div>'
    );
  }

  /* ---------- router and rendering ---------- */

  function parseRoute() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').map((p) => {
      try {
        return decodeURIComponent(p);
      } catch (e) {
        return p;
      }
    });
    const name = parts[0];
    if (name === 'track' && parts[1] && parts[2]) return { name: 'track', code: parts[1], token: parts[2] };
    if (['cart', 'details', 'pay', 'orders'].includes(name)) return { name };
    return { name: 'menu' };
  }

  function render(keepFocus) {
    const r = S.route;
    const v = view();
    const prevId = keepFocus && document.activeElement && document.activeElement.id;
    if (spy && r.name !== 'menu') {
      spy.disconnect();
      spy = null;
    }
    if (!S.store && r.name !== 'track') {
      v.innerHTML = S.storeErr
        ? '<div class="wrap narrow"><div class="panel glass empty" style="margin-top:40px">' + ic('alert', 32) + '<h2>Menu not available</h2><p>' + esc(S.storeErr) + '</p><button type="button" class="btn primary" data-act="retry-store">Try again</button></div></div>'
        : '<div class="boot" role="status"><img src="assets/logo.png" alt="" width="64" height="64"><span>Loading menu</span></div>';
      renderCartUI();
      return;
    }
    const html = r.name === 'cart' ? viewCart() : r.name === 'details' ? viewDetails() : r.name === 'pay' ? viewPay() : r.name === 'track' ? viewTrack() : r.name === 'orders' ? viewOrders() : viewMenu();
    v.innerHTML = html;
    if (S.store) S.shownOpen = storeState(S.store, Date.now()).open;
    if (r.name === 'menu') mountMenu();
    renderCartUI();
    if (prevId) refocus(prevId, true);
  }

  /* Re-renders replace the DOM, so focus is put back by id. When the control is gone (its line
   * was removed) focus goes to the main region instead of falling to <body>. */
  function refocus(id, fallback) {
    if (!id) return;
    const el = document.getElementById(id);
    if (el && !el.disabled) el.focus({ preventScroll: true });
    else if (fallback) view().focus({ preventScroll: true });
  }

  const TITLES = { menu: 'Order online', cart: 'Your order', details: 'Details', pay: 'Payment', track: 'Track order', orders: 'Your orders' };

  function onRoute() {
    const prev = S.route.name;
    if (prev === 'menu') S.menuScroll = window.scrollY;
    const r = parseRoute();
    closeSheet();
    stopPoll();
    /* A toast from the previous screen would cover this one; keep it only if it was just raised for this move. */
    if (Date.now() - toastAt > 500) document.getElementById('toast').hidden = true;
    /* Steps need what came before them. */
    if (S.store && (r.name === 'details' || r.name === 'pay')) {
      const t = totals();
      if (!S.cart.length || t.bad) return location.replace('#/cart');
      if (r.name === 'pay' && !detailsValidSilent()) return location.replace('#/details');
    }
    if (r.name !== 'pay') S.placeErr = null;
    S.route = r;
    document.title = TITLES[r.name] + ' | Mogoba Korean Food House';
    if (r.name === 'track') {
      if (!S.track || S.track.code !== r.code || S.track.token !== r.token) S.track = { code: r.code, token: r.token, order: null, missing: false, err: '', checkedAt: 0 };
      pollTrack();
      pollTimer = setInterval(pollTrack, POLL_MS);
    }
    render();
    if (r.name === 'menu' && prev && prev !== 'menu') window.scrollTo(0, S.menuScroll || 0);
    else if (prev && prev !== r.name) window.scrollTo(0, 0);
    if (prev && prev !== r.name) view().focus({ preventScroll: true });
  }

  async function refreshStore() {
    try {
      const s = await T.store();
      if (!validStore(s)) throw new ApiError(0, 'The menu could not be loaded. Refresh the page to try again.');
      const changed = !S.store || JSON.stringify(s) !== JSON.stringify(S.store);
      S.store = s;
      S.storeErr = '';
      indexStore(s);
      if (!modeEnabled(S.form.type)) S.form.type = modeEnabled('pickup') ? 'pickup' : 'delivery';
      return changed;
    } catch (e) {
      if (!S.store) S.storeErr = e.message || 'The menu could not be loaded.';
      return false;
    }
  }

  /* Re-render after a background store change without fighting the customer's typing. */
  function storeChanged() {
    const n = S.route.name;
    /* An item sold out or left the menu mid checkout: the total on screen is no longer the
     * order, so go back to the cart where the line is flagged. */
    if ((n === 'details' || n === 'pay') && !S.placing && totals().bad) {
      toast('An item is no longer available. Check your order.');
      location.replace('#/cart');
      return;
    }
    /* A price change moves "Pay exactly": redraw even mid typing, and say so. */
    if (n === 'pay' && S.payTotal && totals().total !== S.payTotal) {
      toast('The total is now ' + peso(totals().total) + '. Check it before you pay.');
      render(true);
      return;
    }
    if (n === 'menu') {
      const y = window.scrollY;
      render(true);
      window.scrollTo(0, y);
    } else if (n === 'cart' || n === 'orders' || n === 'track') render(true);
    else {
      const ae = document.activeElement;
      const typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT');
      if (!typing) render(true);
      else if (n === 'pay') renderCta();
      else {
        const b = document.getElementById('to-pay');
        if (b) b.disabled = !storeState(S.store, Date.now()).open;
      }
    }
  }

  /* ---------- events ---------- */

  /* After a line is removed the next row slides under the finger, so a quick second tap
   * would remove that one too. Pointer taps on line controls just after a removal are
   * ignored; keyboard presses (click detail 0) always go through. */
  let removedAt = 0;
  const justRemoved = (e) => e.detail > 0 && Date.now() - removedAt < 400;

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) {
      const a = e.target.closest('a[aria-disabled="true"]');
      if (a) e.preventDefault();
      return;
    }
    const act = el.dataset.act;
    switch (act) {
      case 'scrim':
        if (e.target === el) closeSheet();
        break;
      case 'close':
        closeSheet();
        break;
      case 'item':
        openItem(el.dataset.id);
        break;
      case 'cat': {
        const sec = document.getElementById('c-' + el.dataset.cat);
        if (sec) {
          sec.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
          setChip(el.dataset.cat);
        }
        break;
      }
      case 'mode':
        if (!modeEnabled(el.dataset.mode)) break;
        S.form.type = el.dataset.mode;
        saveContact();
        if (S.route.name === 'menu') {
          $$('[data-act="mode"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === S.form.type)));
          const card = $('.mode');
          const had = document.activeElement && document.activeElement.id;
          if (card) card.outerHTML = modeCard();
          renderCartUI();
          refocus(had);
        } else render(true);
        break;
      case 'when':
        S.form.when = el.dataset.when;
        if (S.form.when === 'later' && !S.form.time) S.form.time = laterSlots(S.store, Date.now())[0] || 0;
        saveWhen();
        render(true);
        break;
      case 'sel-qty':
        sel.qty = Math.min(MAX_QTY, Math.max(1, sel.qty + +el.dataset.d));
        updateSel();
        break;
      case 'add-item':
        addSelection();
        break;
      case 'line-qty': {
        const l = S.cart[+el.dataset.i];
        if (!l || justRemoved(e)) break;
        l.qty = Math.min(MAX_QTY, l.qty + +el.dataset.d);
        if (l.qty <= 0) {
          S.cart.splice(+el.dataset.i, 1);
          removedAt = Date.now();
        }
        saveCart();
        if (S.route.name === 'menu') renderCartUI();
        else render(true);
        break;
      }
      case 'line-del':
        if (!S.cart[+el.dataset.i] || justRemoved(e)) break;
        S.cart.splice(+el.dataset.i, 1);
        removedAt = Date.now();
        saveCart();
        render(true);
        break;
      case 'to-pay':
        if (detailsValid(true)) location.hash = '#/pay';
        break;
      case 'place':
        placeOrder();
        break;
      case 'copy':
        copyText(el.dataset.copy);
        break;
      case 'proof-del':
        S.form.proof = '';
        S.form.proofSha = '';
        render(true);
        break;
      case 'again':
        orderAgain();
        break;
      case 'retry-track':
        S.track.err = '';
        render();
        pollTrack();
        break;
      case 'retry-store':
        S.storeErr = '';
        render();
        refreshStore().then(() => render());
        break;
    }
  });

  /* Typing updates state in place (no re-render, so focus and the keyboard stay put). */
  document.addEventListener('input', (e) => {
    const el = e.target;
    const f = el.dataset && el.dataset.f;
    if (!f || f === 'proof' || f === 'method' || f === 'time') return;
    if (f === 'ref') {
      /* Letters, digits, spaces and dashes; upper case as typed, caret kept in place. */
      const clean = el.value.replace(/[^0-9A-Za-z -]/g, '').toUpperCase();
      if (clean !== el.value) {
        const at = el.selectionStart - (el.value.length - clean.length);
        el.value = clean;
        try {
          el.setSelectionRange(Math.max(0, at), Math.max(0, at));
        } catch (err) {
          /* input types without a selection */
        }
      }
    }
    S.form[f] = el.value;
    if (['name', 'phone', 'address', 'landmark'].includes(f)) saveContact();
    if (S.placeErr && S.route.name === 'pay') {
      S.placeErr = null;
      renderCta();
    }
    if (S.touched[f]) showFieldError(f);
  });

  document.addEventListener('change', (e) => {
    const el = e.target;
    /* Radios and checkboxes always fire change; input is not reliable for them everywhere. */
    if (el.name === 'variant' && sel) {
      sel.variantId = el.value;
      updateSel();
      return;
    }
    if (el.name === 'mod' && sel) {
      if (el.checked) sel.mods.add(el.value);
      else sel.mods.delete(el.value);
      updateSel();
      return;
    }
    const f = el.dataset && el.dataset.f;
    if (f === 'method') {
      S.form.method = el.value;
      S.placeErr = null;
      S.touched.ref = false;
      render(true);
    } else if (f === 'time') {
      S.form.time = +el.value;
      saveWhen();
    } else if (f === 'proof' && el.files && el.files[0]) {
      const file = el.files[0];
      S.proofBusy = true;
      render(true);
      compressImage(file)
        .then((data) => sha256Hex(data).then((sha) => [data, sha]))
        .then(
          ([data, sha]) => {
            S.proofBusy = false;
            S.form.proof = data;
            S.form.proofSha = sha;
            render(true);
          },
          (err) => {
            S.proofBusy = false;
            render(true);
            const box = document.getElementById('e-proof');
            if (box) box.innerHTML = ic('alert', 16) + '<span>' + esc(err.message) + '</span>';
          }
        );
    }
  });

  document.addEventListener('focusout', (e) => {
    const f = e.target.dataset && e.target.dataset.f;
    if (f && V[f]) {
      S.touched[f] = true;
      showFieldError(f);
    }
  });

  document.addEventListener('keydown', (e) => {
    const layer = document.getElementById('layer');
    if (!layer.innerHTML) return;
    if (e.key === 'Escape') {
      closeSheet();
      return;
    }
    /* Keep Tab inside the open sheet. */
    if (e.key === 'Tab') {
      const items = $$('button:not([disabled]), input:not([disabled]), textarea, select, a[href]', layer).filter((x) => x.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  /* A missing photo falls back to the plain tile background instead of a broken image. */
  document.addEventListener(
    'error',
    (e) => {
      const t = e.target;
      if (t && t.tagName === 'IMG' && t.closest('.item-media, .sheet-media')) t.hidden = true;
    },
    true
  );

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('Number copied');
      return;
    } catch (e) {
      /* clipboard API blocked (http or no permission): fall back to a hidden selection */
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (e) {
      ok = false;
    }
    ta.remove();
    toast(ok ? 'Number copied' : 'Copy did not work. Press and hold the number to copy it.');
  }

  /* Demo mode: the register writes to localStorage in another tab. */
  window.addEventListener('storage', (e) => {
    if (!DEMO) return;
    if (e.key === K.store || e.key === null) {
      refreshStore().then((changed) => changed && storeChanged());
    }
    if (S.route.name === 'track' && S.track && (e.key === K.ping || e.key === K.order + S.track.code || e.key === null)) pollTrack();
  });

  window.addEventListener('hashchange', onRoute);

  /* Opening hours move on their own: re-check the snapshot every 30 s (60 s for the server). */
  setInterval(
    () => {
      if (document.hidden) return;
      refreshStore().then((changed) => {
        /* Hours, a pause or the register heartbeat can flip open and closed with no new snapshot. */
        const st = S.store && storeState(S.store, Date.now());
        if (changed || (st && S.shownOpen !== undefined && S.shownOpen !== st.open)) storeChanged();
      });
    },
    DEMO ? 30000 : 60000
  );

  async function boot() {
    await refreshStore();
    if (S.store) checkWhen();
    onRoute();
  }
  boot();
})();
