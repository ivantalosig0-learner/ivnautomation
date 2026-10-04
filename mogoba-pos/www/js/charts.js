/* Mogoba POS: charts drawn as inline SVG and HTML. No library, so the app stays small and
 * offline. Every chart has hover/focus details and a text fallback. */
(function (M) {
  'use strict';
  const U = M.util;
  const h = U.h;
  const NS = 'http://www.w3.org/2000/svg';

  function svg(tag, attrs) {
    const el = document.createElementNS(NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  /* About 4 clean ticks: steps of 1, 2, 2.5 or 5 x 10^k. */
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

  function tooltip(box) {
    const tip = h('div.chart-tip', { hidden: true });
    box.append(tip);
    return {
      show(s, x, y, W, H, kids) {
        tip.hidden = false;
        U.mount(tip, ...kids);
        const rect = s.getBoundingClientRect();
        tip.style.left = Math.max(60, Math.min(rect.width - 60, (x / W) * rect.width)) + 'px';
        tip.style.top = (y / H) * rect.height + 'px';
      },
      hide() {
        tip.hidden = true;
      },
    };
  }

  /* Column chart. data: [{label, full, value, mark, sub, dim}]. mark draws a thin tick at a
   * comparison value (usual day, last week) so "above or below normal" reads at a glance. */
  function columns(data, opts) {
    const o = opts || {};
    const W = 640;
    const H = o.height || 220;
    const pad = { l: 46, r: 8, t: 18, b: 26 };
    const iw = W - pad.l - pad.r;
    const ih = H - pad.t - pad.b;
    const tk = ticks(Math.max(...data.map((d) => Math.max(d.value, d.mark || 0)), 0));
    const max = tk.top;
    const box = h('div.chart');
    const s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': o.label || '' });
    for (let v = 0; v <= max + 1e-6; v += tk.step) {
      const y = pad.t + ih - (ih * v) / max;
      s.appendChild(svg('line', { x1: pad.l, x2: W - pad.r, y1: y, y2: y, class: 'grid-l' }));
      const t = svg('text', { x: pad.l - 8, y: y + 4, 'text-anchor': 'end', class: 'axis-t' });
      t.textContent = (o.tick || tickLabel)(v);
      s.appendChild(t);
    }
    const band = iw / data.length;
    const bw = Math.min(24, band * 0.62);
    const peak = data.reduce((b, d, i) => (d.value > data[b].value ? i : b), 0);
    const every = data.length > 16 ? 3 : data.length > 10 ? 2 : 1;
    const tip = tooltip(box);
    const fmt = o.fmt || U.peso;
    data.forEach((d, i) => {
      const x = pad.l + band * i + (band - bw) / 2;
      const bh = max ? (ih * Math.max(0, d.value)) / max : 0;
      const g = svg('g', { tabindex: '0', role: 'listitem', 'aria-label': (d.full || d.label) + ': ' + fmt(d.value) + (d.mark != null ? ', usual ' + fmt(d.mark) : '') });
      g.appendChild(svg('rect', { x: pad.l + band * i, y: pad.t, width: band, height: ih, class: 'hit' }));
      if (bh > 0) g.appendChild(svg('path', { d: colPath(x, pad.t + ih - bh, bw, bh), class: 'bar' + (d.dim ? ' dim' : '') }));
      if (d.mark != null && d.mark > 0) {
        const my = pad.t + ih - (ih * d.mark) / max;
        g.appendChild(svg('line', { x1: x - 3, x2: x + bw + 3, y1: my, y2: my, class: 'mark-l' }));
      }
      const show = () => {
        g.classList.add('on');
        tip.show(s, x + bw / 2, pad.t + ih - Math.max(bh, d.mark ? (ih * d.mark) / max : 0), W, H, [h('b', fmt(d.value)), d.full || d.label, d.mark != null ? h('div.muted', 'Usual ' + fmt(d.mark)) : null, d.sub ? h('div.muted', d.sub) : null]);
      };
      const hide = () => {
        g.classList.remove('on');
        tip.hide();
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
      if (i === peak && d.value > 0 && o.peakLabel !== false) {
        const t = svg('text', { x: x + bw / 2, y: pad.t + ih - bh - 6, 'text-anchor': 'middle', class: 'val-t' });
        t.textContent = U.peso0(d.value);
        s.appendChild(t);
      }
    });
    box.prepend(s);
    const legend = data.some((d) => d.mark != null) ? h('div.legend', { style: { marginTop: '6px' } }, h('span', h('i.c-gold'), o.seriesLabel || 'Today'), h('span', h('i.mark-key'), o.markLabel || 'Usual')) : null;
    const table = o.table === false ? null : h('details', { style: { marginTop: '6px' } }, h('summary.muted', { style: { fontSize: '12.5px', cursor: 'pointer' } }, 'Table'), h('table.tbl', h('tbody', data.map((d) => h('tr', h('td', d.full || d.label), h('td.r', fmt(d.value)), d.mark != null ? h('td.r.muted', fmt(d.mark)) : null)))));
    return h('div', box, legend, table);
  }

  /* Horizontal bars. rows: [{name, value, sub, cls}] */
  function hbars(rows, fmt, opts) {
    const o = opts || {};
    const max = o.max || Math.max(...rows.map((r) => r.value), 1);
    return h(
      'div.hbars',
      { role: 'list' },
      rows.map((r) =>
        h(
          'div.hbar',
          { role: 'listitem', 'aria-label': r.name + ': ' + fmt(r.value) + (r.sub ? ', ' + r.sub : '') },
          h('span.nm', { title: r.name }, r.name),
          h('span.track', h('i', { class: r.cls || '', style: { width: Math.max(1, (Math.max(0, r.value) / max) * 100) + '%' } })),
          h('span.v', fmt(r.value), r.sub ? h('span.muted', { style: { fontWeight: 600, marginLeft: '6px' } }, r.sub) : null)
        )
      )
    );
  }

  /* Busy-hours heatmap. grid[day 0..6][hour] = value. One gold ramp, light to dark. */
  function heatmap(grid, hours, opts) {
    const o = opts || {};
    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const order = [1, 2, 3, 4, 5, 6, 0];
    const max = Math.max(1, ...order.map((d) => Math.max(...hours.map((hr) => grid[d][hr] || 0))));
    const box = h('div.heat', { role: 'table', 'aria-label': o.label || 'Busy hours' });
    box.style.gridTemplateColumns = '44px repeat(' + hours.length + ', minmax(0, 1fr))';
    box.append(h('span'), ...hours.map((hr) => h('span.heat-h', { role: 'columnheader' }, String(hr % 12 || 12))));
    for (const d of order) {
      box.append(h('span.heat-d', { role: 'rowheader' }, DAYS[d]));
      for (const hr of hours) {
        const v = grid[d][hr] || 0;
        const a = v / max;
        box.append(h('span.heat-c', { role: 'cell', title: DAYS[d] + ' ' + (hr % 12 || 12) + (hr < 12 ? ' AM' : ' PM') + ': ' + (o.fmt ? o.fmt(v) : v), style: { background: v ? 'rgba(232, 163, 61, ' + (0.12 + a * 0.85).toFixed(2) + ')' : 'var(--soft)' } }));
      }
    }
    return h('div', box, h('div.legend', { style: { marginTop: '8px' } }, h('span', 'Quiet'), h('span.heat-ramp'), h('span', 'Busiest')));
  }

  /* Menu engineering: each item is placed by popularity (qty sold) and margin per serving,
   * split at the averages, and listed in its box with the numbers that put it there.
   * points: [{name, qty, margin}] */
  function matrix(points) {
    const avgQ = points.reduce((t, p) => t + p.qty, 0) / (points.length || 1);
    const avgM = points.reduce((t, p) => t + p.margin, 0) / (points.length || 1);
    const boxes = [
      ['star', 'Stars', 'Sell well, earn well. Keep them visible.', (p) => p.qty >= avgQ && p.margin >= avgM],
      ['puzzle', 'Puzzles', 'Earn well, sell less. Promote them.', (p) => p.qty < avgQ && p.margin >= avgM],
      ['horse', 'Workhorses', 'Sell well, earn less. Check portions and price.', (p) => p.qty >= avgQ && p.margin < avgM],
      ['dog', 'Dogs', 'Sell less, earn less. Rethink or drop.', (p) => p.qty < avgQ && p.margin < avgM],
    ];
    return h(
      'div.matrix',
      boxes.map(([cls, title, hint, test]) => {
        const items = points.filter(test).sort((a, b) => b.qty * b.margin - a.qty * a.margin);
        return h(
          'div.mx',
          { class: 'mx-' + cls },
          h('div.mx-head', h('b', title), h('span.muted', String(items.length))),
          h('div.mx-hint', hint),
          items.length
            ? h('ul', items.slice(0, 5).map((p) => h('li', h('span.nm', p.name), h('span.num', p.qty + ' · ' + U.peso0(p.margin)))))
            : h('div.muted', { style: { fontSize: '13px' } }, 'None'),
          items.length > 5 ? h('div.muted', { style: { fontSize: '12px' } }, '+' + (items.length - 5) + ' more') : null
        );
      })
    );
  }

  M.charts = { svg, ticks, tickLabel, columns, hbars, heatmap, matrix };
})((window.M = window.M || {}));
