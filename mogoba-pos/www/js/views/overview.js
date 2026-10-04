/* Mogoba POS: Overview. The day at a glance for the owner and managers: sales against
 * target and against a usual day, what needs attention, stock to watch, best sellers. */
(function (M) {
  'use strict';
  const U = M.util;
  const L = M.logic;
  const C = M.core;
  const S = M.state;
  const h = U.h;
  const ui = () => M.ui;

  const OPEN_H = 9;
  const CLOSE_H = 20;

  function mins(ts) {
    const d = new Date(ts);
    return d.getHours() * 60 + d.getMinutes();
  }

  async function history() {
    const t = U.dayKey();
    const orders = await C.ordersBetween(U.addDays(t, -28), U.addDays(t, -1));
    return orders.filter((o) => o.status !== 'voided');
  }

  function tile(label, value, extra, opts) {
    const o = opts || {};
    return h('div.stat.glass', { class: o.cls || '' }, h('span.label', label), h('span.value', { style: o.color ? { color: o.color } : null }, value), extra);
  }

  function attention(items) {
    if (!items.length) return h('div.empty', { style: { padding: '24px 8px' } }, h('h3', 'All clear'), h('p', 'Nothing needs you right now.'));
    return h(
      'div.list',
      items.map((x) =>
        h(
          'button.row.att',
          { type: 'button', onclick: x.go },
          h('span.att-dot', { class: x.level }),
          h('div.grow', h('div.t', x.title), x.sub ? h('div.s', x.sub) : null),
          x.count != null ? h('span.att-n', String(x.count)) : null,
          ui().icon('right', 18)
        )
      )
    );
  }

  function mount(el) {
    const body = h('div.stack');
    U.mount(el, h('div.page', body));
    let hist = null;
    let token = 0;

    async function draw() {
      const my = ++token;
      if (!hist) hist = await history();
      if (my !== token) return;
      const now = Date.now();
      const today = U.dayKey();
      const dow = new Date().getDay();
      const cfg = S.settings;
      const target = (cfg.sales && cfg.sales.dailyTarget) || 0;
      const orders = S.today.filter((o) => o.status !== 'open');
      const r = L.aggregate(orders, C.menu());

      /* the same weekday over the last four weeks gives "a usual day" */
      const sameDays = {};
      for (const o of hist) if (new Date(o.paidAt).getDay() === dow) (sameDays[o.day] = sameDays[o.day] || []).push(o);
      const nSame = Object.keys(sameDays).length || 1;
      const usualHour = new Array(24).fill(0);
      let usualByNow = 0;
      let usualDay = 0;
      for (const d in sameDays)
        for (const o of sameDays[d]) {
          const net = L.orderNet(o);
          usualHour[new Date(o.paidAt).getHours()] += net / nSame;
          usualDay += net / nSame;
          if (mins(o.paidAt) <= mins(now)) usualByNow += net / nSame;
        }
      const lastWeek = U.addDays(today, -7);
      const lwByNow = hist.filter((o) => o.day === lastWeek && mins(o.paidAt) <= mins(now)).reduce((t, o) => t + L.orderNet(o), 0);

      /* expected share of the day done by now, from the usual curve, else from clock time */
      const share = usualDay > 0 ? usualByNow / usualDay : Math.max(0, Math.min(1, (mins(now) / 60 - OPEN_H) / (CLOSE_H - OPEN_H)));
      const expectedNow = target * share;
      const pace = target ? r.net / target : 0;
      /* projected close: today so far divided by the share a usual day has reached by now */
      const projected = share > 0.08 ? Math.round(r.net / share) : 0;

      /* 7-day sparklines */
      const days = [];
      for (let i = 6; i >= 1; i--) days.push(U.addDays(today, -i));
      const byDay = {};
      for (const o of hist) if (days.includes(o.day)) {
        const b = (byDay[o.day] = byDay[o.day] || { net: 0, n: 0 });
        b.net += L.orderNet(o);
        b.n++;
      }
      const sparkNet = days.map((d) => (byDay[d] ? byDay[d].net : 0)).concat([r.net]);
      const sparkN = days.map((d) => (byDay[d] ? byDay[d].n : 0)).concat([r.orders]);
      const sparkAvg = days.map((d) => (byDay[d] && byDay[d].n ? byDay[d].net / byDay[d].n : 0)).concat([r.avg]);
      const fc = r.foodCostPct;
      const fcTarget = (cfg.sales && cfg.sales.foodCostTarget) || 40;
      const fcState = fc * 100 <= fcTarget ? 'ok' : fc * 100 <= fcTarget + 5 ? 'low' : 'out';
      const vs = (cur, prev) => (prev > 0 ? h('span.delta', { class: cur >= prev ? 'up' : 'down' }, (cur >= prev ? '▲ ' : '▼ ') + U.pct(Math.abs(cur - prev) / prev, 0) + ' vs last ' + new Intl.DateTimeFormat('en-PH', { weekday: 'short' }).format(new Date())) : h('span.sub', 'No sales same time last week'));

      const parts = [];
      parts.push(
        h(
          'div.cards.kpis',
          h(
            'div.stat.glass.hero',
            h('span.label', 'Net sales today'),
            h('span.value', U.peso(r.net)),
            target
              ? h(
                  'div.target',
                  ui().bullet(r.net, target, projected, { expected: expectedNow, label: 'Sales against daily target' }),
                  h('div.legend', h('span', U.pct(pace, 0) + ' of ', h('b', U.peso0(target))), projected ? h('span', 'On track for ', h('b', U.peso0(projected))) : null, h('span', r.net >= expectedNow ? 'Ahead of pace' : 'Behind by ' + U.peso0(expectedNow - r.net)))
                )
              : h('span.sub', 'Set a daily target in Settings'),
            vs(r.net, lwByNow)
          ),
          tile('Orders', String(r.orders), h('div.kpi-foot', ui().spark(sparkN), h('span.sub', 'last 7 days'))),
          tile('Average order', U.peso(r.avg), h('div.kpi-foot', ui().spark(sparkAvg), h('span.sub', 'last 7 days'))),
          tile('Food cost', r.net ? U.pct(fc, 0) : '-', h('div.target', ui().level(fc * 100, Math.max(60, fc * 100), { state: fcState, marker: fcTarget, markerLabel: 'Target ' + fcTarget + '%', label: 'Food cost percent' }), h('div.legend', h('span', 'Target ', h('b', fcTarget + '%')), h('span', 'Recipe cost ', h('b', U.peso0(r.cogs))))), { color: fcState === 'out' ? 'var(--bad)' : null })
        )
      );

      /* attention list */
      const items = [];
      const queue = orders.filter((o) => o.status === 'paid' && o.kitchen && o.kitchen !== 'done');
      if (queue.length) {
        const oldest = Math.round((now - Math.min(...queue.map((o) => o.paidAt))) / 60000);
        items.push({ level: oldest > 20 ? 'bad' : oldest > 12 ? 'warn' : 'ok', title: queue.length + ' in the kitchen queue', sub: 'Oldest ' + oldest + ' min', count: queue.length, go: () => M.app.go('orders') });
      }
      if (M.online && M.online.pendingCount() > 0) items.push({ level: 'bad', title: 'Online orders to confirm', sub: 'Check payment, then accept', count: M.online.pendingCount(), go: () => M.online.inbox() });
      const ings = Object.values(S.ings).filter((i) => i.active !== false);
      const out = ings.filter((i) => L.stockStatus(i) === 'out');
      const low = ings.filter((i) => L.stockStatus(i) === 'low');
      if (out.length) items.push({ level: 'bad', title: out.length + ' out of stock', sub: out.slice(0, 3).map((i) => i.name).join(', '), count: out.length, go: () => M.app.go('stock') });
      if (low.length) items.push({ level: 'warn', title: low.length + ' running low', sub: low.slice(0, 3).map((i) => i.name).join(', '), count: low.length, go: () => M.stockView.reorderSheet() });
      const exp = M.stockView.expiringLots();
      const expired = exp.filter((x) => x.state === 'expired');
      if (exp.length) items.push({ level: expired.length ? 'bad' : 'warn', title: expired.length ? expired.length + ' expired lots' : exp.length + ' lots expire soon', sub: exp.slice(0, 3).map((x) => x.ing.name).join(', '), count: exp.length, go: () => M.app.go('stock') });
      if (S.open.length) items.push({ level: 'ok', title: S.open.length + ' open tickets', sub: S.open.slice(0, 3).map((o) => (o.table ? 'T' + o.table : o.customer)).join(', '), count: S.open.length, go: () => M.app.go('register') });
      if (!S.shift) items.push({ level: 'warn', title: 'No open shift', sub: 'Open one to take payments', go: () => M.drawerView.openShiftFlow() });
      if (!S.meta.demo && C.can('*') && now - (S.meta.lastBackup || 0) > 3 * 864e5) items.push({ level: 'warn', title: 'Backup is overdue', sub: S.meta.lastBackup ? 'Last ' + U.ago(S.meta.lastBackup) : 'Never backed up', go: () => M.app.go('settings') });

      if (M.online && cfg.online && cfg.online.enabled) {
        const on = M.online.list().filter((o) => U.dayKey(o.createdAt) === today);
        const acc = on.filter((o) => o.timeline && o.timeline.find((x) => x.status === 'accepted'));
        const mins = acc.length ? Math.round(acc.reduce((t, o) => t + (o.timeline.find((x) => x.status === 'accepted').at - o.createdAt), 0) / acc.length / 60000) : 0;
        if (on.length) items.push({ level: 'ok', title: 'Online today: ' + on.length + ' placed, ' + acc.length + ' accepted', sub: on.filter((o) => o.status === 'rejected').length + ' rejected' + (acc.length ? ' · accepted in ' + mins + ' min on average' : ''), go: () => M.online.inbox() });
      }
      const hours = [];
      for (let i = OPEN_H; i < CLOSE_H; i++) hours.push(i);
      const series = hours.map((i) => ({ label: (i % 12 || 12) + (i < 12 ? 'a' : 'p'), full: (i % 12 || 12) + ':00 ' + (i < 12 ? 'AM' : 'PM'), value: r.byHour[i], mark: Math.round(usualHour[i]), sub: r.byHourCount[i] + ' orders', dim: i > new Date().getHours() }));
      parts.push(
        h(
          'div.split',
          h('section.panel.glass', h('div.panel-title', h('h3', 'Sales by hour'), h('span.sub', 'today vs a usual ' + new Intl.DateTimeFormat('en-PH', { weekday: 'long' }).format(new Date()))), M.charts.columns(series, { label: 'Sales by hour, today against a usual day', markLabel: 'Usual', table: false, height: 200 })),
          h('section.panel.glass', h('div.panel-title', h('h3', 'Needs attention'), h('span.sub', items.length ? items.length + (items.length === 1 ? ' item' : ' items') : '')), attention(items))
        )
      );

      /* stock to watch and best sellers */
      const watch = ings
        .filter((i) => i.par > 0)
        .map((i) => ({ i, ratio: i.onHand / i.par }))
        .sort((a, b) => a.ratio - b.ratio)
        .slice(0, 6);
      const top = Object.values(r.items).sort((a, b) => b.qty - a.qty).slice(0, 6);
      const pay = Object.entries(r.byPay).filter(([k, v]) => v > 0 && k !== 'none').sort((a, b) => b[1] - a[1]);
      const PAY_CLS = ['c-gold', 'c-ok', 'c-low', 'c-out', 'c-muted', 'c-muted', 'c-muted'];
      parts.push(
        h(
          'div.split.even',
          h(
            'section.panel.glass',
            h('div.panel-title', h('h3', 'Stock to watch'), h('button.btn.sm', { type: 'button', onclick: () => M.app.go('stock') }, 'Stock')),
            h(
              'div.watch',
              watch.map(({ i }) => {
                const st = L.stockStatus(i);
                return h('div.watch-row', h('span.nm', i.name), ui().level(i.onHand, Math.max(i.par, i.onHand), { state: st, marker: i.reorder, thin: true, label: i.name }), h('span.v', U.fmtQty(Math.max(0, i.onHand), i.unit)));
              })
            )
          ),
          h(
            'section.panel.glass',
            h('div.panel-title', h('h3', 'Best sellers today')),
            top.length ? M.charts.hbars(top.map((x) => ({ name: x.name + (x.variant ? ' · ' + x.variant : ''), value: x.qty, sub: U.peso0(x.net) })), (v) => String(v)) : h('p.muted', 'No sales yet today.'),
            pay.length ? h('div', { style: { marginTop: '16px' } }, h('div.group-label', { style: { marginTop: 0 } }, 'Payments'), ui().stackBar(pay.map(([k, v], i) => ({ value: v, cls: PAY_CLS[i], label: C.PAY[k], text: U.peso0(v) })))) : null
          )
        )
      );
      U.mount(body, ...parts);
    }
    draw();
    const tick = setInterval(draw, 60000);
    const offs = [M.bus.on('change', draw), M.bus.on('stock', draw), M.bus.on('online', draw)];
    return () => {
      clearInterval(tick);
      offs.forEach((f) => f());
    };
  }

  M.views = M.views || {};
  M.views.overview = { title: 'Overview', icon: 'gauge', perm: 'reports', mount };
})((window.M = window.M || {}));
