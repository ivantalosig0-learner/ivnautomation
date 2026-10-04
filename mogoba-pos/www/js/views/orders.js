/* Mogoba POS: Orders: kitchen queue, today, past days; reprint, refund, void. */
(function (M) {
  'use strict';
  const U = M.util;
  const L = M.logic;
  const C = M.core;
  const S = M.state;
  const h = U.h;
  const ui = () => M.ui;

  const view = { tab: 'queue', day: null, q: '' };
  const KITCHEN = { prep: 'Preparing', ready: 'Ready', done: 'Picked up' };

  function statusBadge(o) {
    if (o.status === 'voided') return ui().badge('out', 'Voided');
    const rf = L.refundedTotal(o);
    if (rf && rf >= o.totals.total) return ui().badge('low', 'Refunded');
    if (rf) return ui().badge('low', 'Part refund');
    return null;
  }

  function summary(o) {
    const names = o.lines.map((l) => (l.qty > 1 ? l.qty + '× ' : '') + l.name + (l.variantName && l.variantName.length < 8 ? ' ' + l.variantName : ''));
    return names.slice(0, 2).join(', ') + (names.length > 2 ? ' +' + (names.length - 2) + ' more' : '');
  }

  /* Kitchen wait: green under 10 minutes, amber to 15, red after. */
  function waitClass(paidAt) {
    const m = (Date.now() - paidAt) / 60000;
    return m < 10 ? 'ok' : m < 15 ? 'warn' : 'bad';
  }

  function orderRow(o, onOpen) {
    return h(
      'button.row',
      { type: 'button', onclick: () => onOpen(o) },
      h('span.q-no', '#' + o.queue),
      h('div.grow', h('div.t.ellipsis', summary(o)), h('div.s', U.fmtTime(o.paidAt) + ' · ' + C.TYPES[o.type] + (o.table ? ' T' + o.table : '') + (o.customer ? ' · ' + o.customer : '') + ' · ' + o.payments.map((p) => C.PAY[p.method]).join(' + '))),
      statusBadge(o),
      h('span.amt', { style: o.status === 'voided' ? { textDecoration: 'line-through', color: 'var(--ink-3)' } : null }, U.peso(o.totals.total))
    );
  }

  function detail(order) {
    let o = order;
    const s = ui().sheet({ title: 'Order #' + o.queue + ' · ' + o.no, wide: true, icon: 'orders' });
    const draw = () => {
      const t = o.totals;
      const refunded = L.refundedTotal(o);
      const canAct = o.status === 'paid' && refunded < t.total;
      const info = h(
        'div.stack',
        h(
          'dl.kv',
          h('dt', 'Paid'),
          h('dd', U.fmtDateTime(o.paidAt)),
          h('dt', 'Cashier'),
          h('dd', o.by ? o.by.name : '-'),
          h('dt', 'Type'),
          h('dd', C.TYPES[o.type] + (o.table ? ' · Table ' + o.table : '')),
          o.customer ? [h('dt', 'Customer'), h('dd', o.customer)] : null,
          h('dt', 'Total'),
          h('dd.big', U.peso(t.total)),
          refunded ? [h('dt', 'Refunded'), h('dd', { style: { color: 'var(--bad)' } }, '−' + U.peso(refunded))] : null,
          C.can('reports') ? [h('dt', 'Food cost'), h('dd', U.peso(o.cogs) + (t.total ? ' · ' + U.pct(o.cogs / t.total, 0) : ''))] : null
        ),
        o.status === 'voided' ? h('div.banner.bad', ui().icon('ban'), h('div', h('b', 'Voided ' + U.fmtTime(o.voidInfo.at)), h('div.s', o.voidInfo.reason + ' · approved by ' + (o.voidInfo.approver ? o.voidInfo.approver.name : '-') + (o.voidInfo.restock ? ' · restocked' : '')))) : null,
        (o.refunds || []).map((r) => h('div.banner', ui().icon('refund'), h('div', h('b', 'Refund ' + U.peso(r.amount) + ' · ' + C.PAY[r.method]), h('div.s', U.fmtDateTime(r.at) + ' · ' + r.reason + ' · ' + (r.restock ? 'restocked' : 'not restocked') + ' · ' + (r.approver ? r.approver.name : ''))))),
        o.status === 'paid'
          ? h(
              'div',
              h('div.group-label', 'Kitchen'),
              ui().seg(Object.entries(KITCHEN).map(([k, v]) => [k, v]), o.kitchen || 'done', async (v) => {
                o = await C.setKitchen(o, v);
              }, 'Kitchen status')
            )
          : null,
        h(
          'div.stack-sm',
          h('button.btn.block', { type: 'button', onclick: () => M.print.printText(M.print.receipt(o, { copy: true })) }, ui().icon('print', 20), 'Reprint receipt'),
          h('button.btn.block', { type: 'button', onclick: () => M.print.printText(M.print.kitchen(o)) }, ui().icon('fire', 20), 'Kitchen ticket'),
          canAct ? h('button.btn.block', { type: 'button', onclick: () => refundFlow(o, (n) => ((o = n), draw())) }, ui().icon('refund', 20), 'Refund items') : null,
          canAct && refunded === 0 ? h('button.btn.danger.block', { type: 'button', onclick: () => voidFlow(o, (n) => ((o = n), draw())) }, ui().icon('ban', 20), 'Void order') : null
        )
      );
      s.setBody(h('div.done-grid', h('pre.paper', { class: S.settings.print.paper === 80 ? 'w80' : 'w58' }, M.print.receipt(o)), info));
    };
    draw();
  }

  async function voidFlow(o, after) {
    const ap = await ui().approve('void', 'Approve void', 'Voiding a paid order needs a manager or the owner.');
    if (!ap) return;
    let reason = '';
    let restock = true;
    const s = ui().sheet({ title: 'Void order #' + o.queue, cls: 'narrow', icon: 'ban' });
    const inp = h('input.input', { placeholder: 'Reason', 'aria-label': 'Reason', maxlength: 80 });
    inp.addEventListener('input', () => (reason = inp.value));
    const cash = o.payments.filter((p) => p.method === 'cash').reduce((t, p) => t + p.amount, 0) - (o.refunds || []).filter((r) => r.method === 'cash').reduce((t, r) => t + r.amount, 0);
    s.setBody(
      h('p.lead', 'The whole order is cancelled.' + (cash > 0 ? ' Give back ' + U.peso(cash) + ' cash from the drawer.' : ' Reverse the ' + o.payments.map((p) => C.PAY[p.method]).join(' + ') + ' payment outside the register.')),
      h('div.chips', ['Customer cancelled', 'Wrong order punched', 'Duplicate order', 'Test order'].map((r) => h('button.chip', { type: 'button', onclick: () => ((inp.value = r), (reason = r)) }, r))),
      h('div', { style: { marginTop: '10px' } }, inp),
      h('div.group-label', 'Food'),
      ui().seg([['yes', 'Not made: back to stock'], ['no', 'Made: count as waste']], 'yes', (v) => (restock = v === 'yes'), 'Restock')
    );
    s.setFoot(
      h(
        'button.btn.danger-solid.lg.block',
        {
          type: 'button',
          onclick: async () => {
            if (!reason.trim()) return ui().toast('Pick or type a reason.', 'err');
            try {
              const n = await C.voidOrder(o, { reason: reason.trim(), restock, approver: ap });
              s.close();
              ui().toast('Order #' + o.queue + ' voided.', 'ok');
              after(n);
            } catch (e) {
              ui().toast(e.message, 'err');
            }
          },
        },
        'Void order'
      )
    );
  }

  async function refundFlow(o, after) {
    const ap = await ui().approve('refund', 'Approve refund', 'Refunds need a manager or the owner.');
    if (!ap) return;
    const picks = {};
    let reason = '';
    let restock = false;
    let method = 'cash';
    const s = ui().sheet({ title: 'Refund · order #' + o.queue, icon: 'refund' });
    const amountEl = h('b.num');
    const update = () => {
      const p = Object.entries(picks).map(([lineId, qty]) => ({ lineId, qty }));
      amountEl.textContent = U.peso(L.refundAmount(o, p.length ? p : [{ lineId: '-', qty: 0 }]));
    };
    const rows = o.lines
      .map((l) => {
        const left = l.qty - L.refundedQty(o, l.id);
        if (left <= 0) return null;
        picks[l.id] = 0;
        return h(
          'div.row',
          h('div.grow', h('div.t', l.name), h('div.s', [l.variantName].concat(l.mods.map((m) => '+ ' + m.name)).filter(Boolean).join(' · ') + (l.variantName || l.mods.length ? ' · ' : '') + left + ' refundable')),
          ui().stepper(0, (v) => {
            picks[l.id] = v;
            update();
          }, { min: 0, max: left })
        );
      })
      .filter(Boolean);
    const inp = h('input.input', { placeholder: 'Reason', 'aria-label': 'Reason', maxlength: 80 });
    inp.addEventListener('input', () => (reason = inp.value));
    const methods = Array.from(new Set(['cash'].concat(o.payments.map((p) => p.method).filter((m) => m !== 'none'))));
    s.setBody(
      h('div.list', { style: { margin: '0 -14px' } }, rows),
      h('div.chips', { style: { marginTop: '12px' } }, ['Wrong item served', 'Food quality', 'Missing item', 'Long wait'].map((r) => h('button.chip', { type: 'button', onclick: () => ((inp.value = r), (reason = r)) }, r))),
      h('div', { style: { marginTop: '10px' } }, inp),
      h('div.group-label', 'Food'),
      ui().seg([['no', 'Served: count as waste'], ['yes', 'Unopened: back to stock']], 'no', (v) => (restock = v === 'yes'), 'Restock'),
      h('div.group-label', 'Refund as'),
      ui().seg(methods.map((m) => [m, C.PAY[m]]), method, (v) => (method = v), 'Refund method'),
      h('div.sumrow.total', { style: { marginTop: '16px' } }, h('span.lbl', 'Refund amount'), amountEl)
    );
    update();
    s.setFoot(
      h(
        'button.btn.danger-solid.lg.block',
        {
          type: 'button',
          onclick: async () => {
            const p = Object.entries(picks)
              .filter(([, q]) => q > 0)
              .map(([lineId, qty]) => ({ lineId, qty }));
            if (!p.length) return ui().toast('Pick the items to refund.', 'err');
            if (!reason.trim()) return ui().toast('Pick or type a reason.', 'err');
            try {
              const b = await C.refundOrder(o, { picks: p, reason: reason.trim(), restock, method, approver: ap });
              s.close();
              ui().toast('Refunded ' + U.peso(b.refund.amount) + (method === 'cash' ? '. Give it from the drawer.' : '.'), 'ok');
              after(b.order);
            } catch (e) {
              ui().toast(e.message, 'err');
            }
          },
        },
        'Refund'
      )
    );
  }

  function mount(el) {
    if (!view.day) view.day = U.addDays(U.dayKey(), -1);
    const body = h('div.stack');
    const search = h('input.input', { type: 'search', placeholder: 'Order no., name or table', 'aria-label': 'Search orders', value: view.q });
    const dayIn = h('input.input', { type: 'date', value: view.day, max: U.dayKey(), 'aria-label': 'Day', style: { maxWidth: '190px' } });
    const tabsBox = h('div');
    const tools = h('div.row-gap', h('div.search.grow', ui().icon('search', 20), search));
    U.mount(el, h('div.page', h('div.panel.glass.stack', tabsBox, tools, body)));
    let past = [];

    search.addEventListener('input', () => {
      view.q = search.value;
      draw();
    });
    dayIn.addEventListener('change', async () => {
      if (!dayIn.value) return;
      view.day = dayIn.value;
      past = await C.ordersBetween(view.day, view.day);
      draw();
    });
    const filter = (list) => {
      const q = view.q.trim().toLowerCase();
      if (!q) return list;
      return list.filter((o) => (o.no + ' #' + o.queue + ' ' + (o.customer || '') + ' t' + (o.table || '') + ' ' + summary(o)).toLowerCase().includes(q));
    };
    const open = (o) => detail(o);

    let onlineDraw = null;
    function draw() {
      const today = S.today.filter((o) => o.status !== 'open');
      const queue = today.filter((o) => o.status === 'paid' && o.kitchen !== 'done').sort((a, b) => a.paidAt - b.paidAt);
      const online = M.online && S.settings.online && S.settings.online.enabled;
      if (view.tab === 'online' && !online) view.tab = 'queue';
      const tabs = [['queue', 'Kitchen (' + queue.length + ')']];
      if (online) tabs.push(['online', 'Online (' + M.online.pendingCount() + ')']);
      tabs.push(['today', 'Today (' + today.length + ')'], ['past', 'Past days']);
      U.mount(
        tabsBox,
        ui().seg(tabs, view.tab, async (v) => {
          view.tab = v;
          if (v === 'past') past = await C.ordersBetween(view.day, view.day);
          draw();
        }, 'Order list')
      );
      tools.hidden = view.tab === 'online';
      if (view.tab === 'past') {
        if (!tools.contains(dayIn)) tools.append(dayIn);
      } else if (tools.contains(dayIn)) dayIn.remove();
      if (view.tab === 'online') {
        onlineDraw = M.online.panel(body);
        return;
      }
      onlineDraw = null;

      if (view.tab === 'queue') {
        const list = filter(queue);
        if (!list.length) return U.mount(body, ui().empty('Kitchen is clear', 'Paid orders show here until they are picked up.'));
        U.mount(
          body,
          h(
            'div.list',
            list.map((o) =>
              h(
                'div.row',
                h('span.q-no', '#' + o.queue),
                h('span.wait', { class: waitClass(o.paidAt), title: 'Minutes waiting' }, Math.max(0, Math.round((Date.now() - o.paidAt) / 60000)) + "'"),
                h('button.grow', { type: 'button', style: { textAlign: 'left' }, onclick: () => open(o) }, h('div.t', summary(o)), h('div.s', U.fmtTime(o.paidAt) + ' · ' + C.TYPES[o.type] + (o.table ? ' T' + o.table : '') + (o.customer ? ' · ' + o.customer : ''))),
                o.kitchen === 'ready'
                  ? h('button.btn.go', { type: 'button', onclick: async () => (await C.setKitchen(o, 'done'), draw()) }, ui().icon('check', 18), 'Picked up')
                  : h('button.btn.gold', { type: 'button', onclick: async () => (await C.setKitchen(o, 'ready'), draw()) }, 'Mark ready')
              )
            )
          )
        );
        return;
      }
      const list = filter((view.tab === 'today' ? today : past).slice().sort((a, b) => b.paidAt - a.paidAt));
      if (!list.length) return U.mount(body, ui().empty(view.q ? 'No matching orders' : 'No orders', view.tab === 'today' ? 'Sales you ring up today appear here.' : 'Pick another day.'));
      const net = list.reduce((t, o) => t + L.orderNet(o), 0);
      U.mount(body, h('div.row-gap.muted', { style: { fontSize: '13px', fontWeight: 700 } }, list.length + ' orders · net ' + U.peso(net)), h('div.list', list.map((o) => orderRow(o, open))));
    }
    draw();
    const offs = [
      M.bus.on('change', async () => {
        if (view.tab === 'past') past = await C.ordersBetween(view.day, view.day);
        draw();
      }),
      M.bus.on('online', () => (view.tab === 'online' && onlineDraw ? onlineDraw() : draw())),
      M.bus.on('orders:tab', (t) => {
        view.tab = t;
        draw();
      }),
    ];
    const tick = setInterval(() => view.tab === 'queue' && draw(), 30000);
    return () => {
      clearInterval(tick);
      offs.forEach((f) => f());
    };
  }

  M.views = M.views || {};
  M.views.orders = { title: 'Orders', icon: 'orders', perm: 'orders', mount };
  M.ordersView = { detail };
})((window.M = window.M || {}));
