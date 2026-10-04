/* Mogoba POS: app shell: boot, single-tab guard, navigation, top bar, auto-lock, day rollover. */
(function (M) {
  'use strict';
  const U = M.util;
  const C = M.core;
  const S = M.state;
  const h = U.h;
  const ui = () => M.ui;

  M.asset = (p) => (M.ASSETS && M.ASSETS[p]) || 'assets/' + p;

  const NAV = ['overview', 'register', 'orders', 'stock', 'drawer', 'reports', 'menu', 'settings'];
  const PHONE_TABS = ['register', 'orders', 'stock', 'drawer'];
  const App = (M.app = { route: null, cleanup: null, day: U.dayKey(), last: Date.now() });
  const root = () => document.getElementById('app');

  /* ---------- theme ---------- */
  const dark = matchMedia('(prefers-color-scheme: dark)');
  function applyTheme() {
    const t = (S.settings && S.settings.ui.theme) || 'dark';
    const mode = t === 'auto' ? (dark.matches ? 'dark' : 'light') : t;
    document.documentElement.dataset.theme = mode;
    document.documentElement.classList.toggle('lite', !!(S.settings && S.settings.ui.glass === 'lite'));
    const meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.content = mode === 'light' ? '#F1EBDF' : '#0E0D0C';
  }
  dark.addEventListener && dark.addEventListener('change', applyTheme);

  /* ---------- errors never leave the cashier stuck ---------- */
  addEventListener('error', (e) => {
    console.error(e.error || e.message);
    if (M.ui && e.message && !/ResizeObserver/.test(e.message)) M.ui.toast('Something went wrong: ' + e.message, 'err', 5000);
  });
  addEventListener('unhandledrejection', (e) => {
    console.error(e.reason);
    if (M.ui) M.ui.toast('Something went wrong: ' + ((e.reason && e.reason.message) || e.reason), 'err', 5000);
  });

  function fatal(title, text, action) {
    U.mount(root(), h('div.gate', h('div.gate-card.glass', h('div.empty-mark', '먹어봐'), h('h2', title), h('p.lead', { style: { margin: 0 } }, text), action || null)));
  }

  /* ---------- one register per device: two tabs would double-count stock ---------- */
  /* Where the lock API is missing or refused (some embedded frames), run without the guard. */
  function singleTab() {
    if (!navigator.locks || !navigator.locks.request) return Promise.resolve(true);
    return new Promise((res) => {
      let settled = false;
      const done = (v) => {
        if (!settled) {
          settled = true;
          res(v);
        }
      };
      try {
        navigator.locks
          .request('mogoba-pos-register', { ifAvailable: true }, (lock) => {
            done(!!lock);
            return lock ? new Promise(() => {}) : null;
          })
          .catch((e) => {
            if (!settled) return done(true);
            if (e && e.name === 'AbortError') {
              /* Another tab owns the register now: this one must stop selling, polling and saving. */
              App.lost = true;
              S.user = null;
              S.ready = false;
              if (M.online) M.online.stop();
              M.sync.stop();
              M.ui.closeAll();
              fatal('Opened somewhere else', 'Mogoba POS is open in another tab. This one stopped so stock and cash stay exact.', h('button.btn.primary.lg.block', { type: 'button', onclick: () => location.reload() }, 'Use it here instead'));
            }
          });
      } catch (e) {
        done(true);
      }
    });
  }
  function steal() {
    try {
      navigator.locks.request('mogoba-pos-register', { steal: true }, () => new Promise(() => {})).catch(() => {});
    } catch (e) {
      /* lock API refused: carry on without it */
    }
    setTimeout(start, 50);
  }

  /* ---------- boot ---------- */
  async function boot() {
    applyTheme();
    const mine = await singleTab();
    if (!mine) {
      fatal('Already open in another tab', 'Use one tab per tablet so stock and cash stay exact.', h('button.btn.primary.lg.block', { type: 'button', onclick: steal }, 'Use it here instead'));
      return;
    }
    start();
  }

  async function start() {
    let ready;
    try {
      ready = await C.load();
    } catch (e) {
      console.error(e);
      fatal('The register cannot open its storage', e.message + ' Close other Mogoba tabs and reload. If you are in a private window, use a normal one.', h('button.btn.primary.lg.block', { type: 'button', onclick: () => location.reload() }, 'Reload'));
      return;
    }
    M.db.persist();
    M.bus.on('db:closed', () => fatal('Storage was closed', 'Another version of the app took over storage. Reload to continue.', h('button.btn.primary.lg.block', { type: 'button', onclick: () => location.reload() }, 'Reload')));
    if (!ready) return M.lock.mountSetup(root(), afterSetup);
    applyTheme();
    showLock();
  }

  function afterSetup() {
    applyTheme();
    showLock();
  }

  function showLock() {
    if (App.lost) return;
    ui().closeAll();
    if (App.cleanup) App.cleanup();
    App.cleanup = null;
    App.route = null;
    M.lock.mountLock(root(), enter);
    /* Online orders and sync keep running behind the lock screen, so the shop stays open. */
    M.sync.start();
    if (M.online && !M.online.state.timer) M.online.start();
  }

  /* ---------- shell ---------- */
  let shell = null;
  async function enter() {
    App.last = Date.now();
    await computePopular();
    const rail = h('nav.rail.glass', { 'aria-label': 'Main' });
    const tabbar = h('nav.tabbar', { 'aria-label': 'Main' });
    const topbar = h('header.topbar.glass');
    const view = h('div.view');
    U.mount(root(), h('div.shell', rail, h('div.main', topbar, view)), tabbar);
    shell = { rail, tabbar, topbar, view };
    drawNav();
    drawTop();
    M.sync.start();
    if (M.online) M.online.start();
    go('register', true);
    if (!S.meta.demo && C.can('*') && Date.now() - (S.meta.lastBackup || 0) > 3 * 864e5) {
      setTimeout(() => ui().toast(S.meta.lastBackup ? 'Last backup was ' + U.ago(S.meta.lastBackup) + '. Settings → Download backup.' : 'No backup yet. Settings → Download backup.', 'err', 6000), 800);
    }
  }

  const allowed = (r) => C.can(M.views[r].perm);

  function badgeFor(r) {
    if (r === 'orders') {
      const n = S.today.filter((o) => o.status === 'paid' && o.kitchen && o.kitchen !== 'done').length + (M.online ? M.online.pendingCount() : 0);
      return n ? String(n) : '';
    }
    if (r === 'stock') {
      const n = Object.values(S.ings).filter((i) => i.active !== false && M.logic.stockStatus(i) === 'out').length;
      return n ? String(n) : '';
    }
    return '';
  }

  function drawNav() {
    if (!shell) return;
    const routes = NAV.filter(allowed);
    U.mount(
      shell.rail,
      h('img.logo', { src: M.asset('logo.png'), alt: 'Mogoba' }),
      routes.map((r) => {
        const b = badgeFor(r);
        return h('button.rail-btn', { type: 'button', 'aria-current': App.route === r ? 'page' : null, onclick: () => go(r) }, ui().icon(M.views[r].icon, 24), M.views[r].title, b ? h('span.dot', b) : null);
      }),
      h('div.spacer'),
      h('button.rail-btn', { type: 'button', onclick: lockNow }, ui().icon('lock', 24), 'Lock')
    );
    const tabs = PHONE_TABS.filter(allowed);
    U.mount(
      shell.tabbar,
      tabs.map((r) => {
        const b = badgeFor(r);
        return h('button', { type: 'button', 'aria-current': App.route === r ? 'page' : null, onclick: () => go(r) }, ui().icon(M.views[r].icon, 22), M.views[r].title, b ? h('span.dot', b) : null);
      }),
      h('button', { type: 'button', 'aria-current': !tabs.includes(App.route) && App.route ? 'page' : null, onclick: moreSheet }, ui().icon('grid', 22), 'More')
    );
    shell.tabbar.style.gridTemplateColumns = 'repeat(' + (tabs.length + 1) + ', 1fr)';
  }

  function moreSheet() {
    const s = ui().sheet({ title: 'More', cls: 'narrow' });
    const extra = NAV.filter((r) => !PHONE_TABS.includes(r) && allowed(r));
    s.setBody(
      h(
        'div.list',
        extra.map((r) => h('button.row', { type: 'button', onclick: () => (s.close(), go(r)) }, ui().icon(M.views[r].icon), h('div.grow.t', M.views[r].title), ui().icon('right', 18))),
        h('button.row', { type: 'button', onclick: () => (s.close(), lockNow()) }, ui().icon('lock'), h('div.grow.t', 'Lock / switch staff'))
      )
    );
  }

  function syncPill() {
    const st = M.sync.status;
    const map = { demo: ['', 'Sample data', 'sparkle'], local: ['', 'On this device', 'device'], offline: ['warn', 'Offline · ' + st.pending + ' queued', 'cloudOff'], syncing: ['ok', 'Syncing…', 'cloud'], error: ['bad', 'Sync retrying', 'cloudOff'], pending: ['warn', st.pending + ' to sync', 'cloud'], ok: ['ok', 'Synced', 'cloud'] };
    const [cls, txt, icon] = map[st.state] || map.local;
    /* On a phone the bar only shows sync when it needs attention. */
    const quiet = ['demo', 'local', 'ok', 'syncing'].includes(st.state) ? ' quiet' : '';
    return h('button.pill', { type: 'button', class: cls + quiet, title: txt, 'aria-label': 'Sync status: ' + txt, onclick: () => (C.can('*') ? go('settings') : ui().toast(txt)) }, h('i'), ui().icon(icon, 16), h('span.txt', txt));
  }

  function drawTop() {
    if (!shell) return;
    const v = App.route && M.views[App.route];
    const sh = S.shift;
    U.mount(
      shell.topbar,
      h('div.brand', h('img', { src: M.asset('logo.png'), alt: '' })),
      h('h1', v ? v.title : ''),
      h('span.shift-chip', sh ? 'Shift open since ' + U.fmtTime(sh.openedAt) : 'No open shift'),
      h('div.grow'),
      M.online && M.online.pendingCount() ? h('button.pill.bad.alert-pill', { type: 'button', 'aria-label': M.online.pendingCount() + ' online orders to confirm', onclick: () => M.online.inbox() }, ui().icon('orders', 16), h('b', String(M.online.pendingCount())), h('span.txt', 'online ' + (M.online.pendingCount() === 1 ? 'order' : 'orders'))) : null,
      syncPill(),
      h('button.user-btn', { type: 'button', 'aria-label': 'Signed in as ' + S.user.name + '. Open staff menu', onclick: userMenu }, h('span.avatar', { class: 'r-' + S.user.role }, S.user.name.slice(0, 1).toUpperCase()), h('span.nm', S.user.name))
    );
  }

  function userMenu() {
    const s = ui().sheet({ title: S.user.name + ' · ' + C.ROLES[S.user.role], cls: 'narrow', icon: 'user' });
    const row = (icon, t, fn) => h('button.row', { type: 'button', onclick: () => (s.close(), fn()) }, ui().icon(icon), h('div.grow.t', t), ui().icon('right', 18));
    s.setBody(
      h(
        'div.list',
        S.shift ? row('drawer', 'Drawer & shift', () => go('drawer')) : row('drawer', 'Open shift', () => M.drawerView.openShiftFlow()),
        row('settings', 'Settings', () => go('settings')),
        row('lock', 'Lock / switch staff', lockNow)
      )
    );
  }

  function lockNow() {
    if (App.lost) return;
    C.persistCart();
    C.logout();
    showLock();
  }

  function go(r, replace) {
    if (!M.views[r]) r = 'register';
    if (!allowed(r)) {
      ui().toast('Your role cannot open ' + M.views[r].title + '. Ask a manager.', 'err');
      if (App.route) return;
      r = 'register';
    }
    const hash = '#/' + r;
    if (location.hash !== hash) {
      try {
        if (replace) history.replaceState(null, '', hash);
        else history.pushState(null, '', hash);
      } catch (e) {
        /* history is locked in some embedded frames; navigation still works without it */
      }
    }
    render(r);
  }
  addEventListener('popstate', () => {
    if (!shell || !S.user) return;
    const r = (location.hash.match(/^#\/(\w+)/) || [])[1];
    if (r && r !== App.route && M.views[r]) render(allowed(r) ? r : 'register');
  });

  function render(r) {
    if (App.cleanup) App.cleanup();
    App.cleanup = null;
    App.route = r;
    shell.view.scrollTop = 0;
    try {
      App.cleanup = M.views[r].mount(shell.view) || null;
    } catch (e) {
      console.error(e);
      U.mount(shell.view, ui().empty('This screen hit a problem', e.message));
    }
    drawNav();
    drawTop();
  }

  async function computePopular() {
    try {
      const to = U.dayKey();
      const orders = await C.ordersBetween(U.addDays(to, -13), to);
      const n = {};
      for (const o of orders) if (o.status === 'paid') for (const l of o.lines) if (l.itemId) n[l.itemId] = (n[l.itemId] || 0) + l.qty;
      S.popular = Object.keys(n)
        .filter((id) => S.items[id] && S.items[id].active !== false && S.items[id].cat !== 'addons')
        .sort((a, b) => n[b] - n[a])
        .slice(0, 12);
      M.bus.emit('menu');
    } catch (e) {
      console.error(e);
    }
  }

  /* ---------- background duties ---------- */
  ['pointerdown', 'keydown'].forEach((ev) => addEventListener(ev, () => (App.last = Date.now()), { passive: true, capture: true }));
  setInterval(async () => {
    if (App.lost || !S.user || !S.settings) return;
    const min = S.settings.sales.autoLockMin;
    if (min > 0 && Date.now() - App.last > min * 60000 && !document.querySelector('.sheet')) lockNow();
    const d = U.dayKey();
    if (d !== App.day) {
      App.day = d;
      await C.refreshToday();
      computePopular();
      M.bus.emit('change');
    }
  }, 15000);
  M.bus.on('change', () => {
    drawNav();
    drawTop();
  });
  M.bus.on('sync', drawTop);
  M.bus.on('settings', () => {
    applyTheme();
    drawTop();
  });
  M.bus.on('stock', drawNav);
  M.bus.on('online', () => {
    drawNav();
    drawTop();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') C.persistCart();
  });

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !window.Capacitor && !M.ASSETS) {
    addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Offline cache unavailable:', e.message)));
  }

  M.app.go = go;
  M.app.lockNow = lockNow;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})((window.M = window.M || {}));
