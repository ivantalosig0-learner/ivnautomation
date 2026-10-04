#!/usr/bin/env node
/* Mogoba online ordering server. Zero dependencies, Node 22.
 *
 * Serves the customer site (/order/), the register app (/pos/) and the API in
 * docs/online-ordering.md. Orders, the published menu and register sync events are kept in
 * JSON files under DATA_DIR. Configuration is by environment variable; see server/README.md.
 *
 *   POS_KEY=... node server/server.mjs */

import { createServer } from 'node:http';
import { randomBytes, randomInt, createHash, timingSafeEqual } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { Storage } from './lib/storage.mjs';
import { serveFile, resolveInside } from './lib/static.mjs';
import { isIP } from 'node:net';
import { ApiError, buildOrder, applyStatus, checkStore, isObj, storeOpen } from './lib/rules.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const gz = promisify(gzip);
const BODY_LIMIT = 2 * 1024 * 1024;
const DRAIN_LIMIT = 8 * 1024 * 1024;
/* A register poll carries at most this much screenshot data. More waits for the next poll,
 * so a shop on mobile data still gets an answer inside its 15 s timeout. */
const POLL_PROOF_BUDGET = 8 * 1024 * 1024;
/* v1.1 heartbeat: no register poll for this long means nobody is watching for orders. */
const POS_STALE_MS = 5 * 60 * 1000;

/* ---------- config ---------- */

function loadConfig(env) {
  const key = env.POS_KEY || '';
  if (key.length < 24) throw new Error('POS_KEY must be set to a secret of at least 24 characters.');
  let base = (env.BASE_PATH || '').trim().replace(/\/+$/, '');
  if (base && !base.startsWith('/')) base = '/' + base;
  if (!/^(\/[A-Za-z0-9._~-]+)*$/.test(base)) throw new Error('BASE_PATH must look like /mogoba.');
  const port = env.PORT === undefined || env.PORT === '' ? 8790 : Number(env.PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be a port number.');
  return {
    port,
    host: env.HOST || '127.0.0.1',
    dataDir: resolve(env.DATA_DIR || join(HERE, 'data')),
    orderDir: resolve(env.ORDER_DIR || join(ROOT, 'order')),
    posDir: resolve(env.POS_DIR || join(ROOT, 'www')),
    keyHash: createHash('sha256').update(key).digest(),
    base,
    origins: new Set((env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean)),
    trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',
    retentionDays: Number(env.ORDER_RETENTION_DAYS) > 0 ? Number(env.ORDER_RETENTION_DAYS) : 30,
  };
}

/* ---------- security headers ---------- */

const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

/* Both apps load only their own files. Inline style attributes are allowed because the UIs
 * set them; scripts are not. Payment QR codes and proof previews are data: or blob: images.
 * The register may sync to a server the owner configures, so it may connect to any https. */
const csp = (connect) =>
  [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    'connect-src ' + connect,
    "manifest-src 'self'",
    "worker-src 'self'",
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
const ORDER_HEADERS = Object.assign({}, BASE_HEADERS, { 'Content-Security-Policy': csp("'self'") });
const POS_HEADERS = Object.assign({}, BASE_HEADERS, { 'Content-Security-Policy': csp("'self' https:") });
const API_HEADERS = Object.assign({}, BASE_HEADERS, {
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Cache-Control': 'no-store',
});

/* ---------- rate limits ---------- */

/* Sliding window counter kept in memory. A restart forgets it, which is acceptable for
 * abuse protection on a single small shop. */
class Limiter {
  constructor(max, windowMs) {
    this.max = max;
    this.win = windowMs;
    this.hits = new Map();
  }
  recent(key, now) {
    const list = (this.hits.get(key) || []).filter((t) => t > now - this.win);
    if (list.length) this.hits.set(key, list);
    else this.hits.delete(key);
    return list;
  }
  /* Seconds until a slot frees up, or 0 when the key is under its limit. */
  wait(key, now) {
    const list = this.recent(key, now);
    return list.length < this.max ? 0 : Math.ceil((list[0] + this.win - now) / 1000);
  }
  hit(key, now) {
    const list = this.recent(key, now);
    list.push(now);
    this.hits.set(key, list);
  }
  prune(now) {
    for (const k of [...this.hits.keys()]) this.recent(k, now);
  }
}

/* Rate limit key for an address. IPv6 users usually hold a whole /64, so the key is that
 * prefix; otherwise one phone could rotate through addresses and never hit the limit.
 * IPv4-mapped IPv6 (::ffff:1.2.3.4) is keyed as the IPv4 address. */
export function ipKey(ip) {
  let a = String(ip || '').trim().replace(/%.*$/, '');
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(a);
  if (mapped) a = mapped[1];
  if (isIP(a) !== 6) return a;
  /* Expand to eight groups so compressed and full spellings give the same key. A dotted
   * IPv4 tail is rewritten as its two hex groups first. */
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(a);
  if (v4) {
    const n = v4.slice(1).map(Number);
    a = a.slice(0, v4.index) + ((n[0] << 8) | n[1]).toString(16) + ':' + ((n[2] << 8) | n[3]).toString(16);
  }
  const [head, rest] = a.split('::');
  const hs = head ? head.split(':') : [];
  const rs = rest ? rest.split(':') : [];
  const fill = rest === undefined ? [] : Array(8 - hs.length - rs.length).fill('0');
  const groups = hs.concat(fill, rs).map((g) => parseInt(g, 16).toString(16));
  return groups.slice(0, 4).join(':') + '::/64';
}

/* ---------- app ---------- */

export function createApp(cfg) {
  const db = new Storage(cfg.dataDir);
  /* Placed orders per connection, and a looser cap on refused attempts so a customer who
   * fixes a typo is not locked out, while a script trying references still is. */
  const ipLimit = new Limiter(8, 10 * 60 * 1000);
  const failLimit = new Limiter(30, 10 * 60 * 1000);
  const phoneLimit = new Limiter(5, 60 * 60 * 1000);
  /* Last time the register polled for orders (v1.1 heartbeat). Memory only: after a restart
   * orders wait for the register's next poll, which comes within seconds. */
  let posSeenAt = 0;

  /* Monotonic change stamps. A register poll returns `now`; any change made after that poll
   * is stamped later than it, so `since=now` on the next poll never misses an order. */
  let lastStamp = 0;
  let lastServed = 0;
  const stamp = () => (lastStamp = Math.max(Date.now(), lastStamp + 1, lastServed + 1));

  const reply = async (req, res, status, body, extra) => {
    let data = Buffer.from(JSON.stringify(body));
    const h = Object.assign({}, API_HEADERS, extra, { 'Content-Type': 'application/json; charset=utf-8', Vary: 'Origin, Accept-Encoding' });
    if (data.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      data = await gz(data);
      h['Content-Encoding'] = 'gzip';
    }
    h['Content-Length'] = data.length;
    res.writeHead(status, h);
    res.end(data);
  };

  /* CORS for /api: same origin is always fine, other origins only when listed. */
  function corsOk(req, res) {
    const origin = req.headers.origin;
    if (!origin) return true;
    let same = false;
    try {
      same = new URL(origin).host === req.headers.host;
    } catch {
      /* "null" and other opaque origins */
    }
    if (!same && !cfg.origins.has(origin)) return false;
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '600');
    return true;
  }

  function clientIp(req) {
    if (cfg.trustProxy) {
      const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (xff.length) return ipKey(xff[xff.length - 1]);
    }
    return ipKey(req.socket.remoteAddress || '');
  }

  /* The key is compared as a hash so the comparison takes the same time whatever it holds. */
  function authed(req) {
    const m = /^Bearer\s+(.+)$/.exec(req.headers.authorization || '');
    if (!m) return false;
    return timingSafeEqual(createHash('sha256').update(m[1].trim()).digest(), cfg.keyHash);
  }
  function requireAuth(req) {
    if (!authed(req)) throw new ApiError(401, 'The register key is missing or wrong.');
  }

  /* JSON body, at most 2 MB. Anything else is refused before it is parsed. */
  async function readBody(req) {
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') throw new ApiError(415, 'Send the request as JSON.');
    /* Oversized bodies are read to the end and dropped (up to DRAIN_LIMIT) so the client gets
     * a clean 413 it can show, instead of a connection reset part way through its upload.
     * Anything larger than that is cut off. */
    const tooBig = () => new ApiError(413, 'The request is too large. Use a smaller payment screenshot.');
    if (Number(req.headers['content-length']) > DRAIN_LIMIT) throw tooBig();
    const chunks = [];
    let size = 0;
    await new Promise((ok, fail) => {
      req.on('data', (c) => {
        size += c.length;
        if (size <= BODY_LIMIT) chunks.push(c);
        else if (size > DRAIN_LIMIT) {
          req.pause();
          ok();
        }
      });
      req.on('end', ok);
      req.on('error', fail);
      /* A customer who closes the page mid-upload: stop waiting for the rest. */
      req.on('close', () => {
        if (!req.complete) fail(Object.assign(new Error('aborted'), { code: 'ECONNRESET' }));
      });
    });
    if (size > BODY_LIMIT) throw tooBig();
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new ApiError(400, 'The request is not valid JSON.');
    }
    if (!isObj(body)) throw new ApiError(400, 'The request must be a JSON object.');
    return body;
  }

  /* Views of a stored record. The proof file name and the secrets never leave the server
   * except to the register, which gets the screenshot inline as a data URL while the order
   * is pending, which is when staff check it. Later copies leave it out so a long history of
   * orders never makes the register's poll heavy. proofSha is not secret and stays. */
  function publicOrder(r) {
    const o = structuredClone(r);
    delete o.token;
    delete o.clientId;
    delete o.proofFile;
    delete o.payment.proof;
    return o;
  }
  async function registerOrder(r) {
    const o = structuredClone(r);
    delete o.proofFile;
    o.payment.proof = r.status === 'pending' ? await db.proofDataUrl(r.proofFile) : '';
    return o;
  }

  function newCode() {
    for (let i = 0; i < 500; i++) {
      const code = 'MGB-' + randomInt(1000, 10000);
      if (!db.orders.has(code)) return code;
    }
    throw new ApiError(503, 'We cannot take more online orders right now. Please call the store.');
  }

  function findOrder(code) {
    const r = db.orders.get(String(code).toUpperCase());
    if (!r) throw new ApiError(404, 'Order not found.');
    return r;
  }

  /* Tracking access: the token from the order link, compared in constant time. Lengths are
   * compared in bytes, since a non-ASCII token can match in characters and not in bytes. */
  function tokenMatches(r, t) {
    if (typeof t !== 'string') return false;
    const a = Buffer.from(t);
    const b = Buffer.from(r.token);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /* ---------- API handlers ---------- */

  async function placeOrder(req) {
    const body = await readBody(req);
    const ip = clientIp(req);
    return db.run(async () => {
      if (body.clientId !== undefined) {
        if (typeof body.clientId !== 'string' || !/^[A-Za-z0-9._:-]{1,100}$/.test(body.clientId)) throw new ApiError(400, 'Please refresh the page and try again.', 'clientId');
        /* Same clientId: the browser retried after a dropped connection. Return the order it
         * already placed instead of making a second one. Retries do not count as attempts. */
        const existing = db.byClient.get(body.clientId);
        if (existing && db.orders.has(existing)) return [200, db.orders.get(existing)];
      }
      const now = Date.now();
      const ipWait = Math.max(ipLimit.wait(ip, now), failLimit.wait(ip, now));
      if (ipWait) throw Object.assign(new ApiError(429, 'Too many orders from this connection. Please wait a few minutes and try again.'), { retry: ipWait });
      let o;
      try {
        if (now - posSeenAt > POS_STALE_MS) throw new ApiError(423, 'Online orders are paused. Please call the store.');
        o = buildOrder(body, db.store, now);
        const phoneWait = phoneLimit.wait(o.customer.phone, now);
        if (phoneWait) throw Object.assign(new ApiError(429, 'Too many orders for this phone number. Please call the store to order.', 'customer.phone'), { retry: phoneWait });
        if (o.payment.method !== 'cash' && db.refUsed(o.payment.method, o.payment.ref)) {
          throw new ApiError(409, 'This reference number was already used. Call the shop if this is a mistake.', 'payment.ref');
        }
      } catch (e) {
        if (e instanceof ApiError && (e.status === 400 || e.status === 409)) failLimit.hit(ip, now);
        throw e;
      }

      const code = newCode();
      const at = stamp();
      const proofFile = o.proof ? await db.saveProof(code, o.proof.ext, o.proof.buf) : '';
      const rec = {
        code,
        token: randomBytes(16).toString('hex'),
        clientId: body.clientId || '',
        createdAt: at,
        updatedAt: at,
        status: 'pending',
        customer: o.customer,
        fulfillment: o.fulfillment,
        lines: o.lines,
        subtotal: o.subtotal,
        deliveryFee: o.deliveryFee,
        total: o.total,
        payment: o.payment,
        note: o.note,
        reason: '',
        etaAt: 0,
        timeline: [{ status: 'pending', at, by: 'customer' }],
        posOrderId: '',
        proofFile,
      };
      await db.saveOrder(rec);
      /* Only placed orders count, so customers behind one carrier address are not blocked
       * by each other's typos. */
      ipLimit.hit(ip, now);
      phoneLimit.hit(o.customer.phone, now);
      return [201, rec];
    });
  }

  /* Customer cancel from the tracking page, allowed only before the shop accepts. This is
   * the "customer" path the contract names for `cancelled`; it needs the tracking token. */
  async function customerCancel(code, t) {
    return db.run(async () => {
      const r = findOrder(code);
      if (!tokenMatches(r, t)) throw new ApiError(404, 'Order not found.');
      if (r.status !== 'pending') throw new ApiError(409, 'This order is already confirmed. Please call the store to change it.', 'status');
      const next = applyStatus(r, { status: 'cancelled' }, stamp(), 'customer');
      await db.saveOrder(next);
      return next;
    });
  }

  async function api(req, res, path, url) {
    if (!corsOk(req, res)) {
      if (req.method === 'OPTIONS') throw new ApiError(403, 'This website is not allowed to use the ordering API.');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, API_HEADERS);
      return res.end();
    }
    const m = req.method;
    const allow = (methods) => {
      if (!methods.includes(m)) throw Object.assign(new ApiError(405, 'Method not allowed.'), { allow: methods.join(', ') });
    };
    let mm;

    if (path === '/api/health') {
      allow(['GET']);
      return reply(req, res, 200, { ok: true, now: Date.now(), open: storeOpen(db.store, Date.now()), posSeenAt });
    }

    if (path === '/api/store') {
      allow(['GET']);
      if (!db.store) throw new ApiError(404, 'The menu is not published yet.');
      /* posSeenAt is part of the tag, so a stale heartbeat is never served as 304. */
      const tag = db.storeTag.slice(0, -1) + '.' + posSeenAt.toString(36) + '"';
      if (req.headers['if-none-match'] === tag) {
        res.writeHead(304, Object.assign({}, API_HEADERS, { ETag: tag, 'Cache-Control': 'no-cache' }));
        return res.end();
      }
      return reply(req, res, 200, Object.assign({}, db.store, { posSeenAt }), { ETag: tag, 'Cache-Control': 'no-cache' });
    }

    if (path === '/api/orders') {
      allow(['POST']);
      const [status, rec] = await placeOrder(req);
      return reply(req, res, status, { code: rec.code, token: rec.token, order: publicOrder(rec) });
    }

    if ((mm = /^\/api\/orders\/([A-Za-z0-9-]{1,20})$/.exec(path))) {
      allow(['GET']);
      const r = db.orders.get(mm[1].toUpperCase());
      if (!r || !tokenMatches(r, url.searchParams.get('t'))) throw new ApiError(404, 'Order not found. Check the link from your order confirmation.');
      return reply(req, res, 200, publicOrder(r));
    }

    if ((mm = /^\/api\/orders\/([A-Za-z0-9-]{1,20})\/cancel$/.exec(path))) {
      allow(['POST']);
      const next = await customerCancel(mm[1], url.searchParams.get('t'));
      return reply(req, res, 200, { order: publicOrder(next) });
    }

    if (path === '/api/pos/store') {
      allow(['PUT']);
      requireAuth(req);
      const body = await readBody(req);
      const snap = checkStore(body, Date.now());
      await db.run(() => db.saveStore(snap));
      return reply(req, res, 200, { ok: true, updatedAt: snap.updatedAt });
    }

    if (path === '/api/pos/orders') {
      allow(['GET']);
      requireAuth(req);
      const since = Number(url.searchParams.get('since')) || 0;
      /* Read inside the queue so a change half way through its write is never skipped. */
      const [list, now] = await db.run(() => {
        const n = Date.now();
        lastServed = Math.max(lastServed, n);
        posSeenAt = n;
        const l = [...db.orders.values()].filter((r) => r.updatedAt > since).sort((a, b) => a.updatedAt - b.updatedAt);
        return [l, n];
      });
      /* Stop adding orders once the screenshot budget is spent (always at least one). `now`
       * is then the last included order's stamp, so the next poll continues from there.
       * Orders sharing a stamp are never split across two polls. */
      const orders = [];
      let used = 0;
      let upTo = now;
      for (const r of list) {
        const o = await registerOrder(r);
        const last = orders[orders.length - 1];
        if (last && used + o.payment.proof.length > POLL_PROOF_BUDGET && r.updatedAt !== last.updatedAt) {
          upTo = last.updatedAt;
          break;
        }
        used += o.payment.proof.length;
        orders.push(o);
      }
      const body = { orders, now: upTo };
      if (upTo !== now) body.more = true;
      return reply(req, res, 200, body);
    }

    if ((mm = /^\/api\/pos\/orders\/([A-Za-z0-9-]{1,20})\/status$/.exec(path))) {
      allow(['POST']);
      requireAuth(req);
      const body = await readBody(req);
      const next = await db.run(async () => {
        const n = applyStatus(findOrder(mm[1]), body, stamp(), 'register');
        await db.saveOrder(n);
        return n;
      });
      return reply(req, res, 200, { order: await registerOrder(next) });
    }

    if (path === '/api/sync') {
      allow(['POST']);
      requireAuth(req);
      const body = await readBody(req);
      if (!Array.isArray(body.events) || body.events.length > 1000) throw new ApiError(400, 'events must be a list of at most 1000.', 'events');
      const device = typeof body.device === 'string' ? body.device.slice(0, 100) : '';
      const receivedAt = Date.now();
      const valid = body.events.filter((e) => isObj(e) && typeof e.eid === 'string' && e.eid.length > 0 && e.eid.length <= 200);
      const rows = valid.map((e) => ({ eid: e.eid, kind: typeof e.kind === 'string' ? e.kind : '', at: Number(e.at) || 0, device, receivedAt, data: e.data === undefined ? null : e.data }));
      await db.run(() => db.appendEvents(rows));
      /* Every well-formed eid is acknowledged, new or already stored, so a replayed batch
       * clears the register's outbox. Malformed events are left for the register to keep. */
      return reply(req, res, 200, { ack: valid.map((e) => e.eid) });
    }

    throw new ApiError(404, 'Not found.');
  }

  /* ---------- static ---------- */

  async function files(req, res, path) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, Object.assign({ Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' }, BASE_HEADERS));
      return res.end('Method not allowed.\n');
    }
    const redirect = (to) => {
      res.writeHead(301, Object.assign({ Location: cfg.base + to }, BASE_HEADERS));
      res.end();
    };
    if (path === '/') return redirect('/order/');
    if (path === '/order' || path === '/pos') return redirect(path + '/');

    /* The customer site reads its API base from here, so the same files work in demo mode
     * (static config.js) and hosted mode (this one, which points at the server). The site
     * adds /api/... itself, and an empty base would switch it to demo mode, so the base is
     * the full origin plus BASE_PATH. */
    if (path === '/order/config.js') {
      const js = 'window.MOGOBA_ORDER = { api: location.origin + ' + JSON.stringify(cfg.base) + ' };\n';
      res.writeHead(200, Object.assign({}, ORDER_HEADERS, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'Content-Length': Buffer.byteLength(js) }));
      return res.end(req.method === 'HEAD' ? undefined : js);
    }

    let file = null;
    let headers = null;
    if (path.startsWith('/order/')) {
      file = resolveInside(cfg.orderDir, path.slice('/order'.length));
      headers = ORDER_HEADERS;
    } else if (path.startsWith('/pos/')) {
      file = resolveInside(cfg.posDir, path.slice('/pos'.length));
      headers = POS_HEADERS;
    }
    if (file && (await serveFile(req, res, file, headers))) return;
    res.writeHead(404, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' }, BASE_HEADERS));
    res.end('Not found.\n');
  }

  /* ---------- request entry ---------- */

  async function handle(req, res) {
    const started = process.hrtime.bigint();
    let url;
    try {
      url = new URL(req.url, 'http://x');
    } catch {
      url = new URL('http://x/');
    }
    /* One line per request. The path only: queries carry tracking tokens, and no IPs,
     * names or phone numbers are written. */
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      process.stdout.write(new Date().toISOString() + ' ' + req.method + ' ' + url.pathname.slice(0, 200) + ' ' + res.statusCode + ' ' + ms.toFixed(1) + 'ms\n');
    });

    let path = url.pathname;
    if (cfg.base && (path === cfg.base || path.startsWith(cfg.base + '/'))) path = path.slice(cfg.base.length) || '/';

    try {
      if (path === '/api' || path.startsWith('/api/')) await api(req, res, path, url);
      else await files(req, res, path);
    } catch (e) {
      /* The customer closed the page mid-upload: nobody is left to answer, and it is not a
       * server fault worth a stack trace. (req.destroyed is no test for this: it is also
       * true once a complete body has been read.) */
      if ((e && e.code === 'ECONNRESET') || req.socket.destroyed) return res.destroy();
      if (res.headersSent) return res.destroy();
      if (e instanceof ApiError) {
        const extra = {};
        if (e.retry) extra['Retry-After'] = String(e.retry);
        if (e.allow) extra.Allow = e.allow;
        if (e.status === 401) extra['WWW-Authenticate'] = 'Bearer';
        if (e.status === 413) extra.Connection = 'close';
        const body = { error: e.message };
        if (e.field) body.field = e.field;
        await reply(req, res, e.status, body, extra);
      } else {
        process.stderr.write(new Date().toISOString() + ' error ' + (e && e.stack ? e.stack : String(e)) + '\n');
        await reply(req, res, 500, { error: 'Something went wrong on our side. Please try again.' });
      }
    }
  }

  /* Two minutes per request: a 2 MB screenshot upload on a weak mobile signal can take most
   * of that. Headers still have to arrive within 15 s. */
  const server = createServer({ requestTimeout: 120000, headersTimeout: 15000, keepAliveTimeout: 5000 }, (req, res) => {
    handle(req, res);
  });

  async function start() {
    await db.init();
    await db.run(() => db.archive(Date.now(), cfg.retentionDays));
    const timers = [
      setInterval(() => {
        const now = Date.now();
        ipLimit.prune(now);
        failLimit.prune(now);
        phoneLimit.prune(now);
      }, 10 * 60 * 1000),
      setInterval(() => db.run(() => db.archive(Date.now(), cfg.retentionDays)).catch((e) => process.stderr.write('archive failed: ' + e.message + '\n')), 6 * 3600 * 1000),
    ];
    for (const t of timers) t.unref();
    await new Promise((ok, fail) => {
      server.once('error', fail);
      server.listen(cfg.port, cfg.host, ok);
    });
    return server.address();
  }

  /* Finish queued writes before exiting so a deploy restart never cuts a save short. */
  async function stop() {
    await new Promise((ok) => server.close(ok));
    server.closeAllConnections();
    await db.run(() => {});
  }

  return { start, stop, server, db };
}

/* ---------- main ---------- */

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  let cfg;
  try {
    cfg = loadConfig(process.env);
  } catch (e) {
    process.stderr.write('mogoba-pos server: ' + e.message + '\n');
    process.exit(1);
  }
  const app = createApp(cfg);
  app
    .start()
    .then((addr) => {
      process.stdout.write('mogoba-pos server listening on http://' + addr.address + ':' + addr.port + (cfg.base || '') + '/ data ' + cfg.dataDir + '\n');
    })
    .catch((e) => {
      process.stderr.write('mogoba-pos server: cannot start: ' + e.message + '\n');
      process.exit(1);
    });
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.once(sig, () => {
      app.stop().finally(() => process.exit(0));
      setTimeout(() => process.exit(0), 5000).unref();
    });
  }
}

export { loadConfig };
