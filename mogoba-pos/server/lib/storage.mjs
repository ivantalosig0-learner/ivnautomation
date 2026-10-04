/* Mogoba online ordering: file storage in DATA_DIR.
 *
 *   store.json      the published store snapshot
 *   orders.json     active orders { v, orders: [record] }
 *   events.jsonl    register sync events, one line per eid, append only
 *   proofs/         payment screenshots, <code>.jpg or <code>.png, never served publicly
 *   archive/        finished orders past the retention window, by month, plus their proofs
 *
 * The data is small, so the whole state lives in memory and files are the durable copy.
 * Every write goes through one serialized queue and lands with write-temp, fsync, rename,
 * so a crash or power cut leaves either the old file or the new one, never half of each. */

import { promises as fsp, createReadStream } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { refKey } from './rules.mjs';

export class Storage {
  constructor(dir) {
    this.dir = dir;
    this.store = null;
    this.orders = new Map();
    this.byClient = new Map();
    this.eids = new Set();
    /* Every GCash or Maya reference ever used, archived orders included (v1.1: unique forever). */
    this.refs = new Set();
    this.chain = Promise.resolve();
  }

  path(...p) {
    return join(this.dir, ...p);
  }

  async init() {
    /* Private: the files hold customer names, phone numbers and payment screenshots. */
    for (const d of [this.dir, this.path('proofs'), this.path('archive'), this.path('archive', 'proofs')]) await fsp.mkdir(d, { recursive: true, mode: 0o700 });
    await this.sweepTemp();
    this.store = await readJson(this.path('store.json'), null);
    this.storeTag = this.store ? tagOf(JSON.stringify(this.store)) : '';
    const o = await readJson(this.path('orders.json'), { v: 1, orders: [] });
    for (const r of o.orders || []) this.index(r);
    await this.loadArchiveRefs();
    await this.loadEvents();
  }

  /* Archived orders leave memory, but their references stay used. */
  async loadArchiveRefs() {
    for (const f of await fsp.readdir(this.path('archive'))) {
      if (!f.endsWith('.jsonl')) continue;
      await eachLine(this.path('archive', f), (r) => this.addRef(r));
    }
  }

  addRef(r) {
    const p = r && r.payment;
    if (p && p.method && p.method !== 'cash' && typeof p.ref === 'string' && p.ref) this.refs.add(refKey(p.method, p.ref));
  }

  refUsed(method, ref) {
    return this.refs.has(refKey(method, ref));
  }

  /* Leftover temp files are writes that never reached their rename. */
  async sweepTemp() {
    for (const d of [this.dir, this.path('proofs')]) {
      for (const f of await fsp.readdir(d)) if (f.endsWith('.tmp')) await fsp.rm(join(d, f), { force: true });
    }
  }

  index(r) {
    this.orders.set(r.code, r);
    if (r.clientId) this.byClient.set(r.clientId, r.code);
    this.addRef(r);
  }

  /* Reads every eid already stored. A crash mid-append can leave a partial last line, which
   * is skipped here and closed with a newline so the next append starts clean. */
  async loadEvents() {
    const file = this.path('events.jsonl');
    let size = 0;
    try {
      size = (await fsp.stat(file)).size;
    } catch {
      return;
    }
    if (!size) return;
    await eachLine(file, (e) => {
      if (e && typeof e.eid === 'string') this.eids.add(e.eid);
    });
    const fh = await fsp.open(file, 'r');
    const last = Buffer.alloc(1);
    await fh.read(last, 0, 1, size - 1);
    await fh.close();
    if (last[0] !== 0x0a) await fsp.appendFile(file, '\n');
  }

  /* Runs fn alone: the next queued task starts only after this one has finished, so a
   * read-check-write sequence (duplicate ref, idempotent clientId) cannot interleave. */
  run(fn) {
    const p = this.chain.then(fn);
    this.chain = p.catch(() => {});
    return p;
  }

  /* The ETag is a hash of the content, so a republish with an unchanged updatedAt but new
   * stock still reaches customers. */
  async saveStore(snapshot) {
    const json = JSON.stringify(snapshot);
    await writeAtomic(this.path('store.json'), json);
    this.store = snapshot;
    this.storeTag = tagOf(json);
  }

  /* Persists the order set with `rec` replacing or adding its code, then commits it to
   * memory. Memory only changes after the file is safely on disk. */
  async saveOrder(rec) {
    const all = [];
    for (const [code, r] of this.orders) if (code !== rec.code) all.push(r);
    all.push(rec);
    all.sort((a, b) => a.createdAt - b.createdAt);
    await this.writeOrders(all);
    this.index(rec);
  }

  async writeOrders(list) {
    await writeAtomic(this.path('orders.json'), JSON.stringify({ v: 1, orders: list }));
  }

  async saveProof(code, ext, buf) {
    const name = code + '.' + ext;
    await writeAtomic(this.path('proofs', name), buf);
    return name;
  }

  async proofDataUrl(name) {
    if (!name) return '';
    try {
      const buf = await fsp.readFile(this.path('proofs', name));
      return 'data:image/' + (name.endsWith('.png') ? 'png' : 'jpeg') + ';base64,' + buf.toString('base64');
    } catch {
      return '';
    }
  }

  /* Appends only the events whose eid is new and returns how many were written. */
  async appendEvents(events) {
    const fresh = events.filter((e) => !this.eids.has(e.eid));
    const seen = new Set();
    const lines = [];
    for (const e of fresh) {
      if (seen.has(e.eid)) continue;
      seen.add(e.eid);
      lines.push(JSON.stringify(e) + '\n');
    }
    if (!lines.length) return 0;
    const fh = await fsp.open(this.path('events.jsonl'), 'a');
    try {
      await fh.writeFile(lines.join(''));
      await fh.sync();
    } finally {
      await fh.close();
    }
    for (const id of seen) this.eids.add(id);
    return lines.length;
  }

  /* Moves finished orders older than the retention window to archive/orders-YYYY-MM.jsonl
   * (with their proofs). This keeps orders.json small and frees MGB codes for reuse; the
   * archive keeps the history for the owner. */
  async archive(now, days) {
    const cutoff = now - days * 86400000;
    const old = [...this.orders.values()].filter((r) => ['completed', 'rejected', 'cancelled'].includes(r.status) && r.updatedAt < cutoff);
    if (!old.length) return 0;
    const byMonth = {};
    for (const r of old) {
      const m = new Date(r.createdAt).toISOString().slice(0, 7);
      (byMonth[m] = byMonth[m] || []).push(JSON.stringify(r) + '\n');
    }
    for (const [m, lines] of Object.entries(byMonth)) await fsp.appendFile(this.path('archive', 'orders-' + m + '.jsonl'), lines.join(''));
    for (const r of old) {
      if (!r.proofFile) continue;
      const to = r.code + '-' + r.createdAt + r.proofFile.slice(r.proofFile.lastIndexOf('.'));
      await fsp.rename(this.path('proofs', r.proofFile), this.path('archive', 'proofs', to)).catch(() => {});
    }
    const gone = new Set(old.map((r) => r.code));
    const keep = [...this.orders.values()].filter((r) => !gone.has(r.code));
    await this.writeOrders(keep);
    for (const r of old) {
      this.orders.delete(r.code);
      if (r.clientId) this.byClient.delete(r.clientId);
    }
    return old.length;
  }
}

/* Calls fn with each JSON line of a file. A partial line from an interrupted append is skipped. */
async function eachLine(file, fn) {
  const rl = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    let v;
    try {
      v = JSON.parse(line);
    } catch {
      continue;
    }
    fn(v);
  }
}

const tagOf = (json) => 'W/"' + createHash('sha1').update(json).digest('base64url').slice(0, 20) + '"';

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw new Error('Cannot read ' + file + ': ' + e.message);
  }
}

/* Write to a temp file in the same directory, fsync it, rename over the target, then fsync
 * the directory so the rename itself survives a power cut. */
export async function writeAtomic(file, data) {
  const tmp = file + '.' + randomBytes(6).toString('hex') + '.tmp';
  const fh = await fsp.open(tmp, 'w', 0o600);
  try {
    await fh.writeFile(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await fsp.rename(tmp, file);
  } catch (e) {
    await fsp.rm(tmp, { force: true });
    throw e;
  }
  try {
    const dh = await fsp.open(join(file, '..'), 'r');
    await dh.sync().catch(() => {});
    await dh.close();
  } catch {
    /* some filesystems do not allow opening a directory; the rename is still atomic */
  }
}
