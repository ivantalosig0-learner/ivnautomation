/* Mogoba POS: shared helpers: money, time, ids, hashing, DOM builder. */
(function (M) {
  'use strict';
  const U = (M.util = {});

  /* ---------- money (integer centavos) ---------- */
  const nf2 = new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nf0 = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 0 });
  U.peso = (c, short) => {
    const v = (c || 0) / 100;
    const neg = v < 0 ? '−' : '';
    const a = Math.abs(v);
    if (short && Number.isInteger(a)) return neg + '₱' + nf0.format(a);
    return neg + '₱' + nf2.format(a);
  };
  U.num2 = (c) => nf2.format((c || 0) / 100);
  /* Whole pesos, for charts and bars where centavos are noise. */
  U.peso0 = (c) => (c < 0 ? '−' : '') + '₱' + nf0.format(Math.round(Math.abs(c || 0) / 100));
  U.compact = (c) => {
    const v = (c || 0) / 100;
    if (Math.abs(v) >= 1e6) return '₱' + (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (Math.abs(v) >= 1e4) return '₱' + (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return '₱' + nf0.format(Math.round(v));
  };
  /* "120", "120.5", "₱1,200.50" -> centavos. Returns NaN when not a number. */
  U.toCents = (s) => {
    const t = String(s == null ? '' : s).replace(/[₱,\s]/g, '');
    if (!/^-?\d*(\.\d{0,2})?$/.test(t) || t === '' || t === '-' || t === '.') return NaN;
    return Math.round(parseFloat(t) * 100);
  };
  U.pct = (x, d) => (x * 100).toFixed(d == null ? 1 : d) + '%';

  /* ---------- quantities ---------- */
  U.fmtQty = (q, unit) => {
    const n = Math.round(q * 100) / 100;
    if (unit === 'g' && Math.abs(n) >= 1000) return trim(n / 1000) + ' kg';
    if (unit === 'ml' && Math.abs(n) >= 1000) return trim(n / 1000) + ' L';
    return trim(n) + ' ' + unit;
  };
  function trim(n) {
    return (Math.round(n * 100) / 100).toLocaleString('en-PH', { maximumFractionDigits: 2 });
  }
  U.trim = trim;

  /* ---------- time ---------- */
  const pad = (n, w) => String(n).padStart(w || 2, '0');
  U.pad = pad;
  U.dayKey = (ts) => {
    const d = ts == null ? new Date() : new Date(ts);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  };
  U.dayStart = (key) => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
  };
  U.addDays = (key, n) => {
    const [y, m, d] = key.split('-').map(Number);
    return U.dayKey(new Date(y, m - 1, d + n));
  };
  U.daysBetween = (a, b) => Math.round((U.dayStart(b) - U.dayStart(a)) / 864e5);
  const tf = new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' });
  const df = new Intl.DateTimeFormat('en-PH', { day: 'numeric', month: 'short', year: 'numeric' });
  const dfs = new Intl.DateTimeFormat('en-PH', { weekday: 'short', day: 'numeric', month: 'short' });
  U.fmtTime = (ts) => tf.format(new Date(ts));
  U.fmtDate = (ts) => df.format(new Date(ts));
  U.fmtDay = (key) => dfs.format(new Date(U.dayStart(key)));
  U.fmtDateTime = (ts) => U.fmtDate(ts) + ' · ' + U.fmtTime(ts);
  U.ago = (ts) => {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 45) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' d ago';
  };

  /* ---------- ids: time-sortable, collision-safe across devices ---------- */
  const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let lastT = 0;
  let lastR = [];
  U.uid = () => {
    let t = Date.now();
    let r;
    if (t <= lastT) {
      t = lastT;
      r = lastR.slice();
      for (let i = r.length - 1; i >= 0; i--) {
        if (r[i] < 31) { r[i]++; break; }
        r[i] = 0;
      }
    } else {
      r = Array.from(rand(12), (b) => b & 31);
    }
    lastT = t;
    lastR = r;
    let ts = '';
    for (let i = 0; i < 10; i++) { ts = B32[t % 32] + ts; t = Math.floor(t / 32); }
    return ts + r.map((x) => B32[x]).join('');
  };
  function rand(n) {
    const a = new Uint8Array(n);
    if (self.crypto && crypto.getRandomValues) crypto.getRandomValues(a);
    else for (let i = 0; i < n; i++) a[i] = Math.floor(Math.random() * 256);
    return a;
  }
  U.randHex = (n) => Array.from(rand(n), (b) => b.toString(16).padStart(2, '0')).join('');

  /* ---------- SHA-256 (sync; PIN hashing works on file:// and in any WebView) ---------- */
  U.sha256 = (msg) => {
    const K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
      0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
      0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
      0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    const bytes = new TextEncoder().encode(msg);
    const l = bytes.length;
    const words = new Array(((l + 9 + 63) >> 6) << 4).fill(0);
    for (let i = 0; i < l; i++) words[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
    words[l >> 2] |= 0x80 << (24 - (l % 4) * 8);
    words[words.length - 1] = l * 8;
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const w = new Array(64);
    const ror = (x, n) => (x >>> n) | (x << (32 - n));
    for (let j = 0; j < words.length; j += 16) {
      for (let i = 0; i < 64; i++) {
        if (i < 16) w[i] = words[j + i] | 0;
        else {
          const s0 = ror(w[i - 15], 7) ^ ror(w[i - 15], 18) ^ (w[i - 15] >>> 3);
          const s1 = ror(w[i - 2], 17) ^ ror(w[i - 2], 19) ^ (w[i - 2] >>> 10);
          w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
        }
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
        const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
  };
  U.hashPin = (pin, salt) => U.sha256(salt + ':' + pin + ':mogoba');

  /* ---------- DOM ---------- */
  U.$ = (sel, el) => (el || document).querySelector(sel);
  U.$$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  /* h('button.btn.primary', {onclick, disabled}, 'Text', child, [more]) */
  U.h = function h(tag, props) {
    const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(tag);
    const el = document.createElement((m && m[1]) || 'div');
    if (m && m[2]) {
      for (const part of m[2].match(/[.#][\w-]+/g)) {
        if (part[0] === '.') el.classList.add(part.slice(1));
        else el.id = part.slice(1);
      }
    }
    let start = 1;
    if (props && typeof props === 'object' && !(props instanceof Node) && !Array.isArray(props)) {
      start = 2;
      for (const k in props) {
        const v = props[k];
        if (v == null || v === false) continue;
        if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'value') el.value = v;
        else if (k === 'checked' || k === 'selected' || k === 'disabled' || k === 'hidden') el[k] = !!v;
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (let i = start; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  };
  function append(el, c) {
    if (c == null || c === false || c === true) return;
    if (Array.isArray(c)) for (const x of c) append(el, x);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  U.clear = (el) => {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  };
  U.mount = (el, ...kids) => {
    U.clear(el);
    for (const k of kids) append(el, k);
    return el;
  };

  U.debounce = (fn, ms) => {
    let t;
    return function () {
      clearTimeout(t);
      const a = arguments;
      t = setTimeout(() => fn.apply(this, a), ms);
    };
  };

  U.download = (name, text, type) => {
    if (M.ENV === 'preview') {
      if (M.ui) M.ui.toast('Downloads are turned off in this web preview. They work in the installed app and in Chrome.', 'err', 5000);
      return false;
    }
    const blob = new Blob([text], { type: type || 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  };

  U.csv = (rows) =>
    rows
      .map((r) =>
        r
          .map((v) => {
            let s = v == null ? '' : String(v);
            /* Spreadsheets run cells that start with = + - @ as formulas; customer text could. */
            if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
            return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
          })
          .join(',')
      )
      .join('\r\n');

  /* Tiny event bus so views re-render on data changes. */
  const subs = {};
  M.bus = {
    on(ev, fn) {
      (subs[ev] || (subs[ev] = new Set())).add(fn);
      return () => subs[ev].delete(fn);
    },
    emit(ev, data) {
      for (const fn of Array.from(subs[ev] || [])) {
        try {
          fn(data);
        } catch (e) {
          console.error(e);
        }
      }
    },
  };
})((window.M = window.M || {}));
