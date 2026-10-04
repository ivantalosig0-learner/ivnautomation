/* Mogoba POS — Reports: sales, margin, items, payments, SC/PWD log, waste and count variance. */
(function (M) {
  'use strict';
  const U = M.util;
  const L = M.logic;
  const C = M.core;
  const S = M.state;
  const h = U.h;
  const ui = () => M.ui;
  const NS = 'http://www.w3.org/2000/svg';

  const view = { range: 'today' };
  const RANGES = [['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', '7 days'], ['30d', '30 days'], ['month', 'This month']];

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

  function svg(tag, attrs) {
    const el = document.createElementNS(NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }
  /* 4-ish clean ticks: steps of 1, 2, 2.5 or 5 × 10^k. */
  function ticks(v) {
    if (v <= 0) return { top: 100000, step: 25000 };
    const raw = v / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw);
    return { top: step * Math.ceil(v / step - 1e-9), step };
  }
  const tickLabel = (c) => {
    const p = c / 100;
    if (p >= 1e6) return '₱' + U.trim(p / 1e6) + 'M';
    if (p >= 1000) return '₱' + U.trim(p / 1000) + 'K';
    return '₱' + U.trim(p);
  };
  /* Rounded-top column, square at the baseline. */
  function colPath(x, y, w, hgt) {
    const r = Math.min(4, w / 2, hgt);
    return 'M' + x + ',' + (y + hgt) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + hgt) + 'Z';
  }

  /* Single-series column chart with per-bar hover/focus tooltip and a table fallback. */
  function columns(data, opts) {
    const W = 640;
    const H = 220;
    const pad = { l: 46, r: 8, t: 18, b: 26 };
    const iw = W - pad.l - pad.r;
    const ih = H - pad.t - pad.b;
    const tk = ticks(Math.max(...data.map((d) => d.value), 0));
    const max = tk.top;
    const box = h('div.chart');
    const s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': opts.label });
    for (let v = 0; v <= max + 1e-6; v += tk.step) {
      const y = pad.t + ih - (ih * v) / max;
      s.appendChild(svg('line', { x1: pad.l, x2: W - pad.r, y1: y, y2: y, class: 'grid-l' }));
      const t = svg('text', { x: pad.l - 8, y: y + 4, 'text-anchor': 'end', class: 'axis-t' });
      t.textContent = tickLabel(v);
      s.appendChild(t);
    }
    const band = iw / data.length;
    const bw = Math.min(24, band * 0.62);
    const peak = data.reduce((b, d, i) => (d.value > data[b].value ? i : b), 0);
    const every = data.length > 16 ? 3 : data.length > 10 ? 2 : 1;
    const tip = h('div.chart-tip', { hidden: true });
    data.forEach((d, i) => {
      const x = pad.l + band * i + (band - bw) / 2;
      const bh = max ? (ih * Math.max(0, d.value)) / max : 0;
      const g = svg('g', { tabindex: '0', role: 'listitem', 'aria-label': d.label + ': ' + opts.fmt(d.value) });
      g.appendChild(svg('rect', { x: pad.l + band * i, y: pad.t, width: band, height: ih, class: 'hit' }));
      if (bh > 0) g.appendChild(svg('path', { d: colPath(x, pad.t + ih - bh, bw, bh), class: 'bar' + (d.dim ? ' dim' : '') }));
      const show = () => {
        g.classList.add('on');
        tip.hidden = false;
        U.mount(tip, h('b', opts.fmt(d.value)), d.full || d.label, d.sub ? h('div.muted', d.sub) : null);
        const rect = s.getBoundingClientRect();
        const cx = ((x + bw / 2) / W) * rect.width;
        const cy = ((pad.t + ih - bh) / H) * rect.height;
        tip.style.left = Math.max(60, Math.min(rect.width - 60, cx)) + 'px';
        tip.style.top = cy + 'px';
      };
      const hide = () => {
        g.classList.remove('on');
        tip.hidden = true;
      };
      g.addEventListener('pointerenter', show);
      g.addEventListener('pointerleave', hide);
      g.addEventListener('focus', show);
      g.addEventListener('blur', hide);
      s.appendChild(g);
      if (i % every === 0 || i === data.length - 1) {
        const t = svg('text', { x: pad.l + band * i + band / 2, y: H - 8, 'text-anchor': 'middle', class: 'axis-t' });
        t.textContent = d.label;
        s.appendChild(t);
      }
      if (i === peak && d.value > 0) {
        const t = svg('text', { x: x + bw / 2, y: pad.t + ih - bh - 6, 'text-anchor': 'middle', class: 'val-t' });
        t.textContent = U.peso0(d.value);
        s.appendChild(t);
      }
    });
    box.append(s, tip);
    const table = h('details', { style: { marginTop: '6px' } }, h('summary.muted', { style: { fontSize: '12.5px', cursor: 'pointer' } }, 'Show as table'), h('table.tbl', h('tbody', data.map((d) => h('tr', h('td', d.full || d.label), h('td.r', opts.fmt(d.value)))))));
    return h('div', box, table);
  }

  function hbars(rows, fmt, sub) {
    const max = Math.max(...rows.map((r) => r.value), 1);
    return h(
      'div.hbars',
      { role: 'list' },
      rows.map((r) =>
        h(
          'div.hbar',
          { role: 'listitem', 'aria-label': r.name + ': ' + fmt(r.value) + (r.sub ? ', ' + r.sub : '') },
          h('span.nm', { title: r.name }, r.name),
          h('span.track', h('i', { style: { width: Math.max(1, (r.value / max) * 100) + '%' } })),
          h('span.v', fmt(r.value), sub && r.sub ? h('span.muted', { style: { fontWeight: 600, marginLeft: '6px' } }, r.sub) : null)
        )
      )
    );
  }

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
      U.mount(head, h('h2', 'Reports'), h('span.muted.hide-phone', { style: { fontWeight: 700 } }, single ? U.fmtDay(from) : U.fmtDay(from) + ' – ' + U.fmtDay(to)), orders.length ? h('button.btn', { type: 'button', onclick: () => exportCsv(orders, from, to) }, ui().icon('download', 20), 'Export CSV') : null);
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
        series = hrs.map((i) => ({ label: (i % 12 || 12) + (i < 12 ? 'a' : 'p'), full: (i % 12 || 12) + ':00 ' + (i < 12 ? 'AM' : 'PM'), value: r.byHour[i], sub: r.byHourCount[i] + ' orders' }));
      } else {
        series = [];
        for (let d = from; d <= to; d = U.addDays(d, 1)) series.push({ label: d.slice(8), full: U.fmtDay(d), value: r.byDay[d] || 0 });
      }
      const top = Object.values(r.items).sort((a, b) => b.net - a.net);
      parts.push(
        h(
          'div.split',
          h('div.panel.glass', h('div.panel-title', h('h3', single ? 'Net sales by hour' : 'Net sales by day'), h('span.sub', single ? 'peak hours help plan prep and staff' : '')), columns(series, { label: single ? 'Net sales by hour' : 'Net sales by day', fmt: (v) => U.peso(v) })),
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
