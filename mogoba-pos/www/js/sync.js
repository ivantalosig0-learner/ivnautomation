/* Mogoba POS: online sync.
 * Every committed change appends an event to the outbox in the same transaction. This engine
 * pushes the outbox oldest-first to the configured endpoint; each event carries a unique eid,
 * so a retried batch is safe to replay (the server de-duplicates on eid). Sales never wait for
 * the network: offline, events just queue. */
(function (M) {
  'use strict';
  const S = M.state;
  const st = { state: 'local', pending: 0, lastOk: 0, error: '', backoff: 0 };
  let busy = false;
  let timer = null;
  let started = false;

  function enabled() {
    const c = S.settings && S.settings.sync;
    return !!(c && c.enabled && c.url && S.meta && !S.meta.demo);
  }

  function compute() {
    if (S.meta && S.meta.demo) st.state = 'demo';
    else if (!enabled()) st.state = 'local';
    else if (!navigator.onLine) st.state = 'offline';
    else if (busy) st.state = 'syncing';
    else if (st.error) st.state = 'error';
    else st.state = st.pending ? 'pending' : 'ok';
  }

  async function refresh() {
    try {
      st.pending = await M.db.count('outbox');
    } catch (e) {
      /* db closed */
    }
    compute();
    M.bus.emit('sync', st);
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(run, ms);
  }

  function post(url, key, body) {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 20000);
    return fetch(url, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, key ? { Authorization: 'Bearer ' + key } : {}),
      body: JSON.stringify(body),
      signal: ctl.signal,
    }).finally(() => clearTimeout(to));
  }

  async function run() {
    clearTimeout(timer);
    if (busy || !enabled() || !navigator.onLine) return refresh();
    busy = true;
    compute();
    M.bus.emit('sync', st);
    const cfg = S.settings.sync;
    try {
      for (let guard = 0; guard < 40; guard++) {
        const batch = await M.db.outboxBatch(50);
        if (!batch.length) break;
        const res = await post(cfg.url, cfg.key, {
          device: S.meta.deviceId,
          deviceName: S.settings.device.name,
          shop: S.settings.business.name,
          sentAt: Date.now(),
          events: batch.map((e) => ({ eid: e.eid, kind: e.kind, at: e.at, data: e.data })),
        });
        if (!res.ok) throw new Error('Server answered ' + res.status);
        let acked = batch.map((e) => e.eid);
        try {
          const j = await res.json();
          if (j && Array.isArray(j.ack)) acked = j.ack;
        } catch (e) {
          /* empty 2xx body = everything accepted */
        }
        const set = new Set(acked);
        const done = batch.filter((e) => set.has(e.eid));
        if (!done.length) throw new Error('Server accepted none of the changes');
        await M.db.write(['outbox'], (t) => {
          for (const e of done) t.del('outbox', e.seq);
        });
      }
      st.error = '';
      st.backoff = 0;
      st.lastOk = Date.now();
    } catch (e) {
      st.error = e.name === 'AbortError' ? 'The server took too long to answer' : e.message || String(e);
      st.backoff = Math.min(300000, Math.max(5000, st.backoff * 2));
      schedule(st.backoff);
    } finally {
      busy = false;
      await refresh();
    }
  }

  M.sync = {
    status: st,
    enabled,
    refresh,
    run,
    kick() {
      refresh();
      if (enabled() && !busy) schedule(800);
    },
    start() {
      if (started) return;
      started = true;
      addEventListener('online', () => {
        st.backoff = 0;
        run();
      });
      addEventListener('offline', refresh);
      setInterval(() => {
        if (enabled() && !busy && !st.backoff) run();
        else refresh();
      }, 30000);
      run();
    },
  };
})((window.M = window.M || {}));
