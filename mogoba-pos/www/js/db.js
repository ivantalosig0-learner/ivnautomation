/* Mogoba POS — IndexedDB storage.
 * Every business write goes through db.write(), which runs ONE transaction over all touched
 * stores, so an order, its stock moves, its audit entry and its sync event land together or
 * not at all. */
(function (M) {
  'use strict';
  const NAME = 'mogoba-pos';
  const VERSION = 1;
  const STORES = {
    kv: { keyPath: 'k' },
    users: { keyPath: 'id' },
    cats: { keyPath: 'id' },
    items: { keyPath: 'id' },
    mods: { keyPath: 'id' },
    ings: { keyPath: 'id' },
    orders: { keyPath: 'id', idx: { day: 'day', status: 'status' } },
    moves: { keyPath: 'id', idx: { ing: 'ing', day: 'day' } },
    shifts: { keyPath: 'id', idx: { status: 'status' } },
    cash: { keyPath: 'id', idx: { shift: 'shiftId' } },
    counts: { keyPath: 'id', idx: { day: 'day' } },
    audit: { keyPath: 'id', idx: { at: 'at' } },
    outbox: { keyPath: 'seq', autoIncrement: true },
  };
  let db = null;

  function req(r) {
    return new Promise((res, rej) => {
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }

  const DB = (M.db = {
    STORES: Object.keys(STORES),

    open() {
      if (db) return Promise.resolve(db);
      if (!self.indexedDB) return Promise.reject(new Error('This browser has no IndexedDB, so the register cannot store sales.'));
      return new Promise((res, rej) => {
        const r = indexedDB.open(NAME, VERSION);
        r.onupgradeneeded = () => {
          const d = r.result;
          for (const [name, spec] of Object.entries(STORES)) {
            if (d.objectStoreNames.contains(name)) continue;
            const s = d.createObjectStore(name, { keyPath: spec.keyPath, autoIncrement: !!spec.autoIncrement });
            for (const [iname, path] of Object.entries(spec.idx || {})) s.createIndex(iname, path);
          }
        };
        r.onsuccess = () => {
          db = r.result;
          db.onversionchange = () => {
            db.close();
            db = null;
            M.bus.emit('db:closed');
          };
          res(db);
        };
        r.onerror = () => rej(r.error);
        r.onblocked = () => rej(new Error('The register database is busy in another tab. Close other Mogoba POS tabs and reload.'));
      });
    },

    /* Ask the browser not to evict our data under storage pressure. */
    async persist() {
      try {
        if (navigator.storage && navigator.storage.persist) {
          if (await navigator.storage.persisted()) return true;
          return await navigator.storage.persist();
        }
      } catch (e) {
        /* not fatal */
      }
      return false;
    },

    async estimate() {
      try {
        if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate();
      } catch (e) {
        /* ignore */
      }
      return null;
    },

    get(store, key) {
      return req(db.transaction(store).objectStore(store).get(key));
    },
    all(store) {
      return req(db.transaction(store).objectStore(store).getAll());
    },
    byIndex(store, index, range) {
      return req(db.transaction(store).objectStore(store).index(index).getAll(range));
    },
    count(store) {
      return req(db.transaction(store).objectStore(store).count());
    },
    range(lo, hi) {
      return IDBKeyRange.bound(lo, hi);
    },

    /* fn(t) receives {put, del, add, clear} bound to this transaction and must be synchronous.
     * Resolves with fn's return value after the transaction commits. */
    write(stores, fn) {
      return new Promise((res, rej) => {
        let out;
        let tx;
        try {
          tx = db.transaction(stores, 'readwrite');
        } catch (e) {
          rej(e);
          return;
        }
        const t = {
          put: (s, v) => tx.objectStore(s).put(v),
          add: (s, v) => tx.objectStore(s).add(v),
          del: (s, k) => tx.objectStore(s).delete(k),
          clear: (s) => tx.objectStore(s).clear(),
        };
        tx.oncomplete = () => res(out);
        tx.onerror = () => rej(tx.error || new Error('Save failed'));
        tx.onabort = () => rej(tx.error || new Error('Save was cancelled'));
        try {
          out = fn(t);
        } catch (e) {
          try {
            tx.abort();
          } catch (_) {
            /* already finished */
          }
          rej(e);
        }
      });
    },

    /* Read the oldest n outbox events. */
    outboxBatch(n) {
      return new Promise((res, rej) => {
        const out = [];
        const r = db.transaction('outbox').objectStore('outbox').openCursor();
        r.onsuccess = () => {
          const c = r.result;
          if (!c || out.length >= n) return res(out);
          out.push(c.value);
          c.continue();
        };
        r.onerror = () => rej(r.error);
      });
    },

    async dump() {
      const out = { app: 'mogoba-pos', schema: VERSION, exportedAt: Date.now(), stores: {} };
      for (const s of Object.keys(STORES)) out.stores[s] = await DB.all(s);
      return out;
    },

    async restore(data) {
      if (!data || data.app !== 'mogoba-pos' || !data.stores) throw new Error('This file is not a Mogoba POS backup.');
      const names = Object.keys(STORES);
      await DB.write(names, (t) => {
        for (const s of names) {
          t.clear(s);
          for (const v of data.stores[s] || []) t.put(s, v);
        }
      });
    },

    async wipe() {
      const names = Object.keys(STORES);
      await DB.write(names, (t) => {
        for (const s of names) t.clear(s);
      });
    },
  });
})((window.M = window.M || {}));
