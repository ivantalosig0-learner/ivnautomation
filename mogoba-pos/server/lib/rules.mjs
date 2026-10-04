/* Mogoba online ordering: pure rules shared by the HTTP handlers (no I/O).
 * Everything here follows docs/online-ordering.md. Money is integer centavos, times are epoch
 * ms, and store hours are read in Asia/Manila whatever the host clock's zone is. */

import { createHash } from 'node:crypto';

export const TZ = 'Asia/Manila';
export const MAX_LINES = 30;
export const MAX_QTY = 50;
export const MAX_PROOF_CHARS = Math.floor(1.5 * 1024 * 1024);
export const METHODS = ['gcash', 'maya', 'cash'];
export const METHOD_NAMES = { gcash: 'GCash', maya: 'Maya', cash: 'Cash' };
export const STATUSES = ['pending', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'completed', 'rejected', 'cancelled'];
export const FINAL = new Set(['completed', 'rejected', 'cancelled']);

/* Allowed status changes, straight from the contract table. */
export const TRANSITIONS = {
  pending: ['accepted', 'rejected', 'cancelled'],
  accepted: ['preparing', 'ready', 'cancelled'],
  preparing: ['ready'],
  ready: ['out_for_delivery', 'completed'],
  out_for_delivery: ['completed'],
  completed: [],
  rejected: [],
  cancelled: [],
};

export const STATUS_LABELS = {
  pending: 'Waiting for confirmation',
  accepted: 'Confirmed',
  preparing: 'Preparing',
  ready: 'Ready',
  out_for_delivery: 'Out for delivery',
  completed: 'Completed',
  rejected: 'Not accepted',
  cancelled: 'Cancelled',
};

/* An error that maps straight to an HTTP reply: { error, field } with this status. */
export class ApiError extends Error {
  constructor(status, message, field) {
    super(message);
    this.status = status;
    this.field = field || undefined;
  }
}
const bad = (message, field) => new ApiError(400, message, field);

export const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
export const isInt = (x) => Number.isSafeInteger(x);
const isCents = (x) => isInt(x) && x >= 0 && x <= 100000000;

export function peso(c) {
  return '₱' + (c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* Plain text in: control characters become spaces, runs of space collapse. Format characters
 * (zero width spaces, bidi overrides) are dropped so a name can be neither invisible nor
 * shown backwards on the register. Anything that is not a string (other than missing) is a
 * client bug and is refused rather than coerced. */
export function text(v, field, max, label) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw bad('Please check ' + label + '.', field);
  const s = v
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ')
    .replace(/\p{Cf}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > max) throw bad(cap(label) + ' can be at most ' + max + ' characters.', field);
  return s;
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* ---------- phone ---------- */

/* PH mobile in either local or international form, stored as 09XXXXXXXXX. Spaces, dashes,
 * dots and brackets are ignored because people type numbers the way they read them. */
export function normalizePhone(v) {
  if (typeof v !== 'string') return null;
  const raw = v.replace(/[\s\-().]/g, '');
  if (/^09\d{9}$/.test(raw)) return raw;
  if (/^\+639\d{9}$/.test(raw)) return '0' + raw.slice(3);
  return null;
}

/* ---------- time and hours ---------- */

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  weekday: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const DAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/* Manila calendar date, weekday (0 = Sunday) and minute of the day for an instant. */
export function manila(ms) {
  const p = {};
  for (const x of fmt.formatToParts(new Date(ms))) p[x.type] = x.value;
  return { date: p.year + '-' + p.month + '-' + p.day, day: DAYS[p.weekday], minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/* "HH:MM" to minutes. "24:00" is allowed so a day can close at midnight. */
export function hm(s) {
  const m = typeof s === 'string' && /^(\d{2}):(\d{2})$/.exec(s);
  if (!m) return NaN;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return Number(m[2]) < 60 && v <= 1440 ? v : NaN;
}

/* Open at an instant when some hours row covers it. A row whose close is before its open
 * runs past midnight, so yesterday's late row can still cover the early hours of today. A row
 * whose close equals its open covers nothing, the same as the customer site reads it. */
export function openAt(hours, ms) {
  if (!Array.isArray(hours)) return false;
  const t = manila(ms);
  const yesterday = (t.day + 6) % 7;
  for (const h of hours) {
    const o = hm(h.open);
    let c = hm(h.close);
    if (Number.isNaN(o) || Number.isNaN(c) || c === o) continue;
    if (c < o) c += 1440;
    if (h.day === t.day && t.minutes >= o && t.minutes < c) return true;
    if (h.day === yesterday && t.minutes + 1440 >= o && t.minutes + 1440 < c) return true;
  }
  return false;
}

/* v1.1: the register can pause orders for a while without turning them off. */
export const paused = (store, now) => !!store && isInt(store.pausedUntil) && now < store.pausedUntil;

export function storeOpen(store, now) {
  return !!store && store.accepting === true && !paused(store, now) && openAt(store.hours, now);
}

/* ---------- payment references ---------- */

/* v1.1: spaces and dashes removed, upper case. GCash uses 13 digits and Maya 12 hex
 * characters, but only the general shape is enforced; the register warns on the rest. */
export function normalizeRef(v) {
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  return String(v).replace(/[\s-]+/g, '').toUpperCase();
}

/* Key for the "used forever" set. Leading zeros are dropped so 0123456 and 123456 count as
 * the same payment. */
export const refKey = (method, ref) => method + ':' + String(ref).replace(/^0+(?=.)/, '');

/* ---------- store snapshot ---------- */

/* Checks a snapshot from the register before it is published. Prices must be whole centavos
 * because every order total is recomputed from them. Returns the snapshot with v and
 * updatedAt filled in; other fields pass through untouched for the customer site. */
export function checkStore(s, now) {
  const fail = (msg, field) => {
    throw bad('The store snapshot is not valid: ' + msg + '.', field);
  };
  if (!isObj(s)) fail('expected an object');
  if (typeof s.name !== 'string' || !s.name.trim()) fail('name is missing', 'name');
  if (typeof s.accepting !== 'boolean') fail('accepting must be true or false', 'accepting');
  if (!Array.isArray(s.hours)) fail('hours must be a list', 'hours');
  s.hours.forEach((h, i) => {
    if (!isObj(h) || !isInt(h.day) || h.day < 0 || h.day > 6) fail('hours ' + i + ' needs a day from 0 to 6', 'hours.' + i + '.day');
    if (Number.isNaN(hm(h.open)) || Number.isNaN(hm(h.close))) fail('hours ' + i + ' needs open and close as HH:MM', 'hours.' + i);
  });
  if (s.prepMinutes !== undefined && (!isInt(s.prepMinutes) || s.prepMinutes < 0)) fail('prepMinutes must be whole minutes', 'prepMinutes');
  if (s.delivery !== undefined) {
    if (!isObj(s.delivery)) fail('delivery must be an object', 'delivery');
    if (s.delivery.enabled && (!isCents(s.delivery.fee) || !isCents(s.delivery.minOrder))) fail('delivery fee and minOrder must be whole centavos', 'delivery');
  }
  if (s.payments !== undefined) {
    if (!isObj(s.payments)) fail('payments must be an object', 'payments');
    const cash = s.payments.cash;
    if (isObj(cash) && cash.maxTotal !== undefined && !isCents(cash.maxTotal)) fail('cash maxTotal must be whole centavos', 'payments.cash.maxTotal');
  }
  if (s.pausedUntil !== undefined && (!isInt(s.pausedUntil) || s.pausedUntil < 0)) fail('pausedUntil must be epoch milliseconds', 'pausedUntil');
  if (!Array.isArray(s.cats)) fail('cats must be a list', 'cats');
  if (!Array.isArray(s.items) || s.items.length > 1000) fail('items must be a list', 'items');
  const ids = new Set();
  s.items.forEach((it, i) => {
    const f = 'items.' + i;
    if (!isObj(it) || typeof it.id !== 'string' || !it.id) fail('item ' + i + ' needs an id', f + '.id');
    if (ids.has(it.id)) fail('item id ' + it.id + ' is used twice', f + '.id');
    ids.add(it.id);
    if (typeof it.name !== 'string') fail('item ' + it.id + ' needs a name', f + '.name');
    if (!isCents(it.price)) fail('item ' + it.id + ' price must be whole centavos', f + '.price');
    if (it.variants != null) {
      if (!Array.isArray(it.variants)) fail('item ' + it.id + ' variants must be a list', f + '.variants');
      it.variants.forEach((v, j) => {
        if (!isObj(v) || typeof v.id !== 'string' || !isCents(v.price)) fail('item ' + it.id + ' variant ' + j + ' needs an id and a price in centavos', f + '.variants.' + j);
      });
    }
    if (it.addons != null) {
      if (!Array.isArray(it.addons)) fail('item ' + it.id + ' addons must be a list', f + '.addons');
      it.addons.forEach((g, j) => {
        if (!isObj(g) || typeof g.gid !== 'string' || !Array.isArray(g.options)) fail('item ' + it.id + ' addon group ' + j + ' needs a gid and options', f + '.addons.' + j);
        g.options.forEach((o, k) => {
          if (!isObj(o) || typeof o.id !== 'string' || !isCents(o.price)) fail('item ' + it.id + ' addon option ' + k + ' needs an id and a price in centavos', f + '.addons.' + j + '.options.' + k);
        });
      });
    }
  });
  return Object.assign({}, s, { v: 1, updatedAt: isInt(s.updatedAt) && s.updatedAt > 0 ? s.updatedAt : now });
}

/* ---------- placing an order ---------- */

const enabled = (x) => !!(x && x.enabled === true);

/* Price one cart line from the snapshot. The request only names things; every price, name and
 * sold-out flag comes from the published menu. */
function priceLine(l, i, byId) {
  const f = 'items.' + i;
  if (!isObj(l)) throw bad('One item in your cart could not be read. Please remove it and try again.', f);
  const it = typeof l.itemId === 'string' ? byId.get(l.itemId) : undefined;
  if (!it) throw bad('One item in your cart is no longer on the menu. Please remove it and try again.', f + '.itemId');
  if (it.soldOut === true || it.active === false) throw bad(it.name + ' is sold out. Please remove it and try again.', f + '.itemId');
  if (!isInt(l.qty) || l.qty < 1 || l.qty > MAX_QTY) throw bad('Quantity must be between 1 and ' + MAX_QTY + '.', f + '.qty');

  const changed = () => bad(it.name + ' has changed on the menu. Please remove it and add it again.', f);
  let unit = it.price;
  let variantId = '';
  let variantName = '';
  const variants = Array.isArray(it.variants) && it.variants.length ? it.variants : null;
  if (variants) {
    const v = variants.find((x) => x.id === l.variantId);
    if (!v) throw bad('Please choose a ' + String(it.variantLabel || 'option').toLowerCase() + ' for ' + it.name + '.', f + '.variantId');
    if (v.soldOut === true) throw bad(it.name + ' (' + v.name + ') is sold out. Please remove it and try again.', f + '.variantId');
    unit = v.price;
    variantId = v.id;
    variantName = String(v.name || '');
  } else if (l.variantId !== undefined && l.variantId !== null && l.variantId !== '') {
    throw changed();
  }

  const mods = [];
  if (l.mods !== undefined && l.mods !== null) {
    if (!Array.isArray(l.mods) || l.mods.length > 20) throw changed();
    const seen = new Set();
    const perGroup = {};
    for (const m of l.mods) {
      if (!isObj(m)) throw changed();
      const g = (it.addons || []).find((x) => x.gid === m.gid);
      const o = g && g.options.find((x) => x.id === m.oid);
      if (!o) throw changed();
      if (o.soldOut === true) throw bad(o.name + ' is sold out. Please remove it from ' + it.name + ' and try again.', f + '.mods');
      const key = g.gid + ':' + o.id;
      if (seen.has(key)) continue;
      seen.add(key);
      perGroup[g.gid] = (perGroup[g.gid] || 0) + 1;
      if (isInt(g.max) && g.max > 0 && perGroup[g.gid] > g.max) throw bad('Please choose at most ' + g.max + ' from ' + (g.name || 'add-ons') + '.', f + '.mods');
      mods.push({ gid: g.gid, oid: o.id, name: String(o.name || ''), price: o.price });
      unit += o.price;
    }
  }

  return {
    itemId: it.id,
    variantId,
    name: String(it.name),
    variantName,
    mods,
    unit,
    qty: l.qty,
    note: text(l.note, f + '.note', 140, 'the item note'),
  };
}

/* Proof screenshot: a JPEG or PNG data URL. The declared type must match the file's magic
 * bytes, so a renamed file of another kind is refused. */
export function checkProof(v) {
  if (v === undefined || v === null || v === '') return null;
  const err = bad('The payment screenshot must be a JPEG or PNG under 1.5 MB.', 'payment.proof');
  if (typeof v !== 'string' || v.length > MAX_PROOF_CHARS) throw err;
  const m = /^data:image\/(jpeg|jpg|png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(v);
  if (!m) throw err;
  const buf = Buffer.from(m[2], 'base64');
  const png = buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (m[1] === 'png' ? !png : !jpg) throw err;
  /* v1.1 fingerprint: the register flags two orders that send the same screenshot. */
  return { buf, ext: png ? 'png' : 'jpg', sha: createHash('sha256').update(buf).digest('hex') };
}

/* Validates a placement request against the published store at time `now` and returns the
 * priced order parts. Throws ApiError on the first problem, with the field to highlight.
 * Store-wide checks that need other orders (duplicate ref, rate limits) live in the server. */
export function buildOrder(body, store, now) {
  if (!store) throw new ApiError(423, 'Online ordering is not available yet. Please call the store.');
  if (store.accepting !== true) throw new ApiError(423, 'We are not taking online orders right now. Please call the store.');
  if (paused(store, now)) throw new ApiError(423, 'We are paused right now. Please try again later.');
  if (!openAt(store.hours, now)) throw new ApiError(423, 'We are closed right now. Please check our opening hours.');

  /* items */
  if (!Array.isArray(body.items) || !body.items.length) throw bad('Your cart is empty.', 'items');
  if (body.items.length > MAX_LINES) throw bad('Your cart can have at most ' + MAX_LINES + ' lines.', 'items');
  const byId = new Map(store.items.map((it) => [it.id, it]));
  const lines = body.items.map((l, i) => priceLine(l, i, byId));
  const subtotal = lines.reduce((s, l) => s + l.unit * l.qty, 0);

  /* customer */
  const c = isObj(body.customer) ? body.customer : {};
  const name = text(c.name, 'customer.name', 60, 'your name');
  if (name.length < 2) throw bad('Please enter your name (2 to 60 characters).', 'customer.name');
  const phone = normalizePhone(c.phone);
  if (!phone) throw bad('Please enter a mobile number like 0917 123 4567.', 'customer.phone');

  /* fulfillment */
  const fu = isObj(body.fulfillment) ? body.fulfillment : {};
  const type = fu.type;
  if (type !== 'pickup' && type !== 'delivery') throw bad('Please choose pickup or delivery.', 'fulfillment.type');
  if (type === 'pickup' && store.pickup && store.pickup.enabled === false) throw bad('Pickup is not available right now. Please choose delivery.', 'fulfillment.type');
  let address = '';
  let landmark = '';
  let deliveryFee = 0;
  if (type === 'delivery') {
    if (!enabled(store.delivery)) throw bad('Delivery is not available right now. Please choose pickup.', 'fulfillment.type');
    address = text(fu.address, 'fulfillment.address', 200, 'the address');
    if (address.length < 5) throw bad('Please enter your delivery address.', 'fulfillment.address');
    landmark = text(fu.landmark, 'fulfillment.landmark', 120, 'the landmark');
    const min = store.delivery.minOrder || 0;
    if (subtotal < min) throw bad('Delivery needs a minimum order of ' + peso(min) + '. Add more items or choose pickup.', 'fulfillment.type');
    deliveryFee = store.delivery.fee || 0;
  }
  let time = 'asap';
  if (fu.time !== 'asap') {
    const t = fu.time;
    const ok = isInt(t) && t > now && manila(t).date === manila(now).date && openAt(store.hours, t);
    if (!ok) throw bad('Please choose a time later today while we are open.', 'fulfillment.time');
    time = t;
  }

  /* payment */
  const p = isObj(body.payment) ? body.payment : {};
  const method = p.method;
  if (!METHODS.includes(method)) throw bad('Please choose GCash, Maya or cash.', 'payment.method');
  if (!enabled(store.payments && store.payments[method])) throw bad(METHOD_NAMES[method] + ' is not available right now. Please choose another way to pay.', 'payment.method');
  /* v1.1 prepayment: bilao trays and large orders are paid up front, never cash on pickup. */
  if (method === 'cash') {
    if (lines.some((l) => byId.get(l.itemId).prepay === true)) throw bad('Some items must be paid by GCash or Maya.', 'payment.method');
    const maxT = store.payments.cash.maxTotal;
    if (isCents(maxT) && maxT > 0 && subtotal + deliveryFee > maxT) throw bad('Orders above ' + peso(maxT) + ' must be paid by GCash or Maya.', 'payment.method');
  }
  let ref = '';
  let sender = '';
  let proof = null;
  if (method !== 'cash') {
    ref = normalizeRef(p.ref);
    if (!/^[A-Z0-9]{6,20}$/.test(ref)) throw bad('Please enter the reference number from your ' + METHOD_NAMES[method] + ' receipt (6 to 20 letters and digits).', 'payment.ref');
    sender = text(p.sender, 'payment.sender', 60, 'the sender name');
    proof = checkProof(p.proof);
  }
  const payment = { method, ref, sender, proof: '', verified: false };
  if (proof) payment.proofSha = proof.sha;

  return {
    customer: { name, phone },
    fulfillment: { type, time, address, landmark },
    lines,
    subtotal,
    deliveryFee,
    total: subtotal + deliveryFee,
    payment,
    note: text(body.note, 'note', 300, 'the order note'),
    proof,
  };
}

/* ---------- status changes ---------- */

/* Applies a register status request to a copy of the order. Same status means "update the
 * other fields only" (eta, POS id, verified, payment check) and adds no timeline entry. */
export function applyStatus(order, body, now, by) {
  const next = structuredClone(order);
  const status = body.status;
  if (!STATUSES.includes(status)) throw bad('Unknown status.', 'status');
  if (status !== order.status) {
    if (!TRANSITIONS[order.status].includes(status)) {
      throw new ApiError(409, 'This order cannot change from ' + STATUS_LABELS[order.status] + ' to ' + STATUS_LABELS[status] + '.', 'status');
    }
    if (status === 'out_for_delivery' && order.fulfillment.type !== 'delivery') {
      throw new ApiError(409, 'Only delivery orders can go out for delivery.', 'status');
    }
    next.status = status;
    next.timeline.push({ status, at: now, by });
  }
  if (body.reason !== undefined) next.reason = text(body.reason, 'reason', 200, 'the reason');
  if (status === 'rejected' && !next.reason) throw bad('Please give a reason for not accepting the order.', 'reason');
  if (body.etaAt !== undefined && body.etaAt !== null) {
    if (!isInt(body.etaAt) || body.etaAt < 0) throw bad('etaAt must be epoch milliseconds.', 'etaAt');
    next.etaAt = body.etaAt;
  }
  if (body.posOrderId !== undefined && body.posOrderId !== null) next.posOrderId = text(body.posOrderId, 'posOrderId', 80, 'the POS order id');
  /* v1.1 verification fields typed by staff. Only these three are taken from body.payment;
   * the rest of the payment (method, ref, proof) never changes after the order is placed. */
  if (isObj(body.payment)) {
    const bp = body.payment;
    if (bp.amountReceived !== undefined && bp.amountReceived !== null) {
      if (!isCents(bp.amountReceived)) throw bad('amountReceived must be whole centavos.', 'payment.amountReceived');
      next.payment.amountReceived = bp.amountReceived;
    }
    if (bp.verifiedBy !== undefined && bp.verifiedBy !== null) next.payment.verifiedBy = text(bp.verifiedBy, 'payment.verifiedBy', 60, 'the staff name');
    if (bp.verifiedAt !== undefined && bp.verifiedAt !== null) {
      if (!isInt(bp.verifiedAt) || bp.verifiedAt < 0) throw bad('verifiedAt must be epoch milliseconds.', 'payment.verifiedAt');
      next.payment.verifiedAt = bp.verifiedAt;
    }
  }
  /* Underpaid GCash and Maya orders can only be rejected. */
  if (status === 'accepted' && order.status === 'pending' && order.payment.method !== 'cash' && isInt(next.payment.amountReceived) && next.payment.amountReceived < order.total) {
    throw new ApiError(409, 'The amount received is less than the order total. Reject the order or ask for the rest.', 'payment.amountReceived');
  }
  if (typeof body.verified === 'boolean') next.payment.verified = body.verified;
  /* For GCash and Maya, accepting means staff found the payment, so it counts as verified
   * unless the register says otherwise. */
  else if (status === 'accepted' && order.status === 'pending' && order.payment.method !== 'cash') next.payment.verified = true;
  next.updatedAt = now;
  return next;
}
