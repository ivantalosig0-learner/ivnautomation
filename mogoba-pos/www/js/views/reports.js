/* Mogoba POS: Reports: sales, margin, items, payments, SC/PWD log, waste and count variance. */
(function (M) {
  'use strict';
  const U = M.util;
  const L = M.logic;
  const C = M.core;
  const S = M.state;
  const h = U.h;
  const ui = () => M.ui;

  const view = { range: 'today' };
  const RANGES = [['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', '7 days'], ['30d', '30 days'], ['month', 'Month']];

  function bounds(r) {
    const t = U.dayKey();
    if (r === 'yesterday') return [U.addDays(t, -1), U.addDays(t, -1)];
    if (r === '7d') return [U.addDays(t, -6), t];
    if (r === '30d') return [U.addDays(t, -29), t];
    if (r === 'month') return [t.slice(0, 8) + '01', t];
    return [t, t];
  }
  function prevBounds(from, to) {
    const n = U.daysBetween(from, to) + 1;
    return [U.addDays(from, -n), U.addDays(from, -1)];
  }

  const columns = (data, opts) => M.charts.columns(data, opts);
  const hbars = (rows, fmt) => M.charts.hbars(rows, fmt);

  function delta(cur, prev) {
    if (!prev) return null;
    const d = (cur - prev) / prev;
    return h('span.delta', { class: d >= 0 ? 'up' : 'down' }, (d >= 0 ? '▲ ' : '▼ ') + U.pct(Math.abs(d), 0) + ' vs previous');
  }

  function exportCsv(orders, from, to) {
    const rows = [['Receipt', 'Order #', 'Date', 'Time', 'Status', 'Type', 'Table', 'Customer', 'Cashier', 'Items', 'Gross', 'Discounts', 'Total', 'Refunded', 'Net', 'Payment', 'Food cost']];
    for (const o of orders) {
      const t = o.totals;
      rows.push([o.no, o.queue, o.day, U.fmtTime(o.paidAt), o.status, C.TYPES[o.type], o.table || '', o.customer || '', o.by ? o.by.name : '', t.items, U.num2(t.gross), U.num2(t.discountTotal), U.num2(t.total), U.num2(L.refundedTotal(o)), U.num2(L.orderNet(o)), o.payments.map((p) => C.PAY[p.method]).join('+'), U.num2(o.cogs)]);
    }
    U.download('mogoba-sales-' + from + '_' + to + '.csv', U.csv(rows), 'text/csv');
    const items = [['Receipt', 'Date', 'Status', 'Item', 'Option', 'Add-ons', 'Qty', 'Unit price', 'Line total', 'Note']];
    for (const o of orders) for (const l of o.lines) items.push([o.no, o.day, o.status, l.name, l.variantName || '', l.mods.map((m) => m.name).join(' + '), l.qty, U.num2(l.unit), U.num2(L.lineNet(l)), l.note || '']);
    setTimeout(() => U.download('mogoba-items-' + from + '_' + to + '.csv', U.csv(items), 'text/csv'), 400);
  }

  function scpwdCsv(list, from, to) {
    const rows = [['Date', 'Receipt', 'Type', 'Name', 'ID no.', 'Diners', 'Gross', 'Discount', 'VAT exempted', 'Paid']];
    for (const o of list) for (const p of o.disc.people || []) rows.push([o.day, o.no, p.type, p.name, p.idNo, o.disc.count + '/' + o.disc.diners, U.num2(o.totals.eligible), U.num2(o.totals.orderDisc), U.num2(o.totals.vatRemoved), U.num2(o.totals.total)]);
    U.download('mogoba-sc-pwd-' + from + '_' + to + '.csv', U.csv(rows), 'text/csv');
  }

  function mount(el) {
    const filters = h('div');
    const body = h('div.stack');
    const head = h('div.page-head', h('h2', 'Reports'));
    U.mount(el, h('div.page', head, filters, body));
    let token = 0;

    async function draw() {
      const my = ++token;
      U.mount(filters, ui().seg(RANGES, view.range, (v) => ((view.range = v), draw()), 'Date range'));
      body.style.opacity = '.55';
      const [from, to] = bounds(view.range);
      const [pf, pt] = prevBounds(from, to);
      const [orders, prevOrders, moves, counts] = await Promise.all([C.ordersBetween(from, to), C.ordersBetween(pf, pt), C.movesBetween(from, to), C.countsBetween(from, to)]);
      if (my !== token) return;
      body.style.opacity = '';
      const menu = C.menu();
      const r = L.aggregate(orders, menu);
      const p = L.aggregate(prevOrders, menu, { keepOrders: false });
      const single = from === to;
      const parts = [];
      U.mount(head, h('h2', 'Reports'), h('span.muted.hide-phone', { style: { fontWeight: 700 } }, single ? U.fmtDay(from) : U.fmtDay(from) + ' to ' + U.fmtDay(to)), orders.length ? h('button.btn', { type: 'button', onclick: () => exportCsv(orders, from, to) }, ui().icon('download', 20), 'Export CSV') : null);
      if (!orders.length) {
        U.mount(body, h('div.panel.glass', ui().empty('No sales in this period', 'Pick another range, or ring up a sale on the register.')));
        return;
      }
      parts.push(
        h(
          'div.cards',
          h('div.stat.glass.hero', h('span.label', 'Net sales'), h('span.value', U.peso(r.net)), delta(r.net, p.net) || h('span.sub', 'after discounts and refunds')),
          h('div.stat.glass', h('span.label', 'Orders'), h('span.value', String(r.orders)), delta(r.orders, p.orders) || h('span.sub', ' ')),
          h('div.stat.glass', h('span.label', 'Average order'), h('span.value', U.peso(r.avg)), delta(r.avg, p.avg) || h('span.sub', ' ')),
          h('div.stat.glass', h('span.label', 'Gross profit'), h('span.value', U.peso(r.profit, true)), h('span.sub', 'food cost ' + U.pct(r.foodCostPct) + ' of sales'))
        )
      );
      let series;
      if (single) {
        const hrs = [];
        for (let i = 7; i <= 21; i++) hrs.push(i);
        series = hrs.map((i) => ({ label: (i % 12 || 12) + (i < 12 ? 'a' : 'p'), full: (i % 12 || 12) + ':00 ' + (i < 12 ? 'AM' : 'PM'), value: r.byHour[i], mark: p.byHour ? p.byHour[i] : null, sub: r.byHourCount[i] + ' orders' }));
      } else {
        series = [];
        let k = 0;
        for (let d = from; d <= to; d = U.addDays(d, 1), k++) series.push({ label: d.slice(8), full: U.fmtDay(d), value: r.byDay[d] || 0, mark: p.byDay ? p.byDay[U.addDays(pf, k)] || 0 : null });
      }
      /* menu engineering and busy hours come straight from the order lines */
      const eng = {};
      const heat = [0, 1, 2, 3, 4, 5, 6].map(() => new Array(24).fill(0));
      const dayCount = [0, 0, 0, 0, 0, 0, 0];
      const seenDay = new Set();
      for (const o of orders) {
        if (o.status !== 'paid') continue;
        const dt = new Date(o.paidAt);
        heat[dt.getDay()][dt.getHours()] += L.orderNet(o);
        if (!seenDay.has(o.day)) {
          seenDay.add(o.day);
          dayCount[dt.getDay()]++;
        }
        for (const l of o.lines) {
          if (!l.itemId) continue;
          const cat = S.cats.find((c) => c.id === (S.items[l.itemId] ? S.items[l.itemId].cat : l.cat));
          const e = (eng[l.itemId] = eng[l.itemId] || { name: l.name, kind: cat ? cat.kind : 'food', qty: 0, net: 0, cost: 0 });
          e.qty += l.qty;
          e.net += L.lineNet(l);
          e.cost += (l.ucost || 0) * l.qty;
        }
      }
      for (let d = 0; d < 7; d++) for (let hr = 0; hr < 24; hr++) heat[d][hr] = dayCount[d] ? heat[d][hr] / dayCount[d] : 0;
      const engPts = Object.values(eng)
        .filter((e) => e.qty > 0)
        .map((e) => ({ name: e.name, kind: e.kind, qty: e.qty, margin: Math.round((e.net - e.cost) / e.qty) }));
      const engBox = h('div');
      const drawEng = (kind) => {
        const pts = engPts.filter((x) => x.kind === kind);
        U.mount(engBox, pts.length > 2 ? M.charts.matrix(pts) : h('p.muted', 'Needs more sales in this period.'));
      };
      drawEng(view.eng || 'food');
      const top = Object.values(r.items).sort((a, b) => b.net - a.net);
      parts.push(
        h(
          'div.split',
          h('div.panel.glass', h('div.panel-title', h('h3', single ? 'Net sales by hour' : 'Net sales by day')), columns(series, { label: single ? 'Net sales by hour' : 'Net sales by day', fmt: (v) => U.peso(v), seriesLabel: 'This period', markLabel: 'Previous period' })),
          h(
            'div.panel.glass',
            h('div.panel-title', h('h3', 'Payments')),
            hbars(
              Object.entries(r.byPay)
                .filter(([k, v]) => v > 0 && k !== 'none')
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => ({ name: C.PAY[k], value: v, sub: U.pct(v / Math.max(1, r.net), 0) })),
              U.peso0,
              true
            ),
            h('div.panel-title', { style: { marginTop: '18px' } }, h('h3', 'Order types')),
            hbars(Object.entries(r.byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ name: C.TYPES[k], value: v })), U.peso0)
          )
        )
      );
      parts.push(
        h(
          'div.split',
          h(
            'div.panel.glass',
            h('div.panel-title', h('h3', 'Top items'), h('span.sub', 'by net sales')),
            hbars(top.slice(0, 10).map((x) => ({ name: x.name + (x.variant ? ' · ' + x.variant : ''), value: x.net, sub: x.qty + ' sold' })), U.peso0, true),
            top.length > 10
              ? h('details', { style: { marginTop: '10px' } }, h('summary.muted', { style: { cursor: 'pointer', fontSize: '13px' } }, 'All ' + top.length + ' items'), h('table.tbl', h('thead', h('tr', h('th', 'Item'), h('th.r', 'Qty'), h('th.r', 'Net'))), h('tbody', top.map((x) => h('tr', h('td', x.name + (x.variant ? ' · ' + x.variant : '')), h('td.r', String(x.qty)), h('td.r', U.peso(x.net)))))))
              : null
          ),
          h('div.panel.glass', h('div.panel-title', h('h3', 'Categories')), hbars(Object.entries(r.byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ name: (S.cats.find((c) => c.id === k) || { name: 'Custom items' }).name, value: v })), U.peso0))
        )
      );

      if (!single) {
        const hrs = [];
        for (let i = 9; i < 20; i++) hrs.push(i);
        parts.push(
          h(
            'div.split.even',
            h('section.panel.glass', h('div.panel-title', h('h3', 'Busy hours'), h('span.sub', 'average sales per day')), M.charts.heatmap(heat, hrs, { fmt: U.peso0, label: 'Average sales by weekday and hour' })),
            h(
              'section.panel.glass',
              h('div.panel-title', h('h3', 'Menu engineering'), ui().seg([['food', 'Food'], ['drink', 'Drinks']], view.eng || 'food', (v) => ((view.eng = v), drawEng(v)), 'Menu group')),
              engBox,
              h('p.muted', { style: { fontSize: '12.5px', marginTop: '8px' } }, 'Figures: sold · margin per serving. Split at the menu average.')
            )
          )
        );
      }

      /* controls: discounts, voids, refunds */
      const voids = orders.filter((o) => o.status === 'voided');
      const refunds = orders.filter((o) => (o.refunds || []).length);
      parts.push(
        h(
          'div.split.even',
          h(
            'div.panel.glass',
            h('div.panel-title', h('h3', 'Senior citizen & PWD discounts'), r.scpwd.length ? h('button.btn.sm', { type: 'button', onclick: () => scpwdCsv(r.scpwd, from, to) }, ui().icon('download', 18), 'CSV') : null),
            r.scpwd.length
              ? h(
                  'div.tbl-wrap',
                  h(
                    'table.tbl',
                    h('thead', h('tr', h('th', 'Receipt'), h('th', 'Name / ID'), h('th.r', 'Discount'))),
                    h('tbody', r.scpwd.slice(0, 50).map((o) => h('tr', h('td', o.no, h('div.muted', { style: { fontSize: '12px' } }, U.fmtDay(o.day))), h('td', (o.disc.people || []).map((x) => h('div', x.type + ' · ' + x.name + ' · ' + x.idNo))), h('td.r', U.peso(o.totals.orderDisc + o.totals.vatRemoved)))))
                  )
                )
              : h('p.muted', 'None in this period.'),
            h('dl.kv', { style: { marginTop: '12px' } }, h('dt', 'All discounts given'), h('dd', U.peso(r.discounts)), h('dt', 'Other discounted orders'), h('dd', String(r.discounted.length)))
          ),
          h(
            'div.panel.glass',
            h('div.panel-title', h('h3', 'Voids & refunds')),
            h('dl.kv', h('dt', 'Voided orders'), h('dd', r.voids.count + ' · ' + U.peso(r.voids.amount)), h('dt', 'Refunds'), h('dd', U.peso(r.refunds))),
            voids.concat(refunds).length
              ? h(
                  'div.list',
                  { style: { marginTop: '8px' } },
                  voids
                    .map((o) => ({ at: o.voidInfo.at, o, t: 'Void', amt: o.totals.total, why: o.voidInfo.reason, who: o.voidInfo.approver }))
                    .concat(refunds.flatMap((o) => o.refunds.map((x) => ({ at: x.at, o, t: 'Refund', amt: x.amount, why: x.reason, who: x.approver }))))
                    .sort((a, b) => b.at - a.at)
                    .slice(0, 20)
                    .map((x) => h('button.row', { type: 'button', style: { minHeight: '52px' }, onclick: () => M.ordersView.detail(x.o) }, h('div.grow', h('div.t', x.t + ' · ' + x.o.no), h('div.s', U.fmtDateTime(x.at) + ' · ' + x.why + (x.who ? ' · ok ' + x.who.name : ''))), h('span.amt', U.peso(x.amt))))
                )
              : h('p.muted', { style: { marginTop: '8px' } }, 'None in this period.')
          )
        )
      );

      /* inventory: waste and count variance */
      const waste = {};
      let wasteTotal = 0;
      let received = 0;
      for (const m of moves) {
        if (m.type === 'waste') {
          const v = -m.qty * (m.cost || 0);
          const key = (m.note || 'Other').replace(/^Voided after kitchen: .*/, 'Voided after kitchen');
          waste[key] = (waste[key] || 0) + v;
          wasteTotal += v;
        } else if (m.type === 'receive') received += m.qty * (m.cost || 0);
      }
      const variance = counts.reduce((t, c) => t + c.value, 0);
      parts.push(
        h(
          'div.split.even',
          h(
            'div.panel.glass',
            h('div.panel-title', h('h3', 'Waste'), h('span.sub', U.peso(Math.round(wasteTotal)))),
            Object.keys(waste).length ? hbars(Object.entries(waste).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ name: k, value: Math.round(v) })), U.peso0) : h('p.muted', 'No waste logged.')
          ),
          h(
            'div.panel.glass',
            h('div.panel-title', h('h3', 'Stock control')),
            h(
              'dl.kv',
              h('dt', 'Theoretical food cost (recipes)'),
              h('dd', U.peso(r.cogs)),
              h('dt', 'Logged waste'),
              h('dd', U.peso(Math.round(wasteTotal))),
              h('dt', 'Count variance'),
              h('dd', { style: { color: variance < 0 ? 'var(--bad)' : null } }, U.peso(Math.round(variance))),
              h('dt', 'Deliveries received'),
              h('dd', U.peso(Math.round(received)))
            ),
            h('p.muted', { style: { fontSize: '12.5px', marginTop: '10px' } }, 'A count variance below ' + U.peso(-Math.round(r.cogs * 0.05)) + ' (5% of food cost) usually means over-portioning, unlogged waste or missing stock.')
          )
        )
      );
      U.mount(body, ...parts);
    }
    draw();
    const offs = [M.bus.on('change', () => view.range === 'today' && draw())];
    return () => offs.forEach((f) => f());
  }

  M.views = M.views || {};
  M.views.reports = { title: 'Reports', icon: 'reports', perm: 'reports', mount };
})((window.M = window.M || {}));
