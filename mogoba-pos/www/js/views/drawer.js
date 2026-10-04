/* Mogoba POS: Drawer: open/close shift, cash in/out, X and Z readings. */
(function (M) {
  'use strict';
  const U = M.util;
  const L = M.logic;
  const C = M.core;
  const S = M.state;
  const h = U.h;
  const ui = () => M.ui;

  async function openShiftFlow() {
    if (S.shift) return;
    const v = await ui().askAmount({ title: 'Open shift', lead: 'Count the starting cash (float) in the drawer.', quick: [50000, 100000, 150000, 200000], allowZero: true, ok: 'Open shift', initial: 100000 });
    if (v == null) return;
    try {
      await C.openShift(v);
      ui().toast('Shift open with ' + U.peso(v) + ' float. Ready to sell.', 'ok');
    } catch (e) {
      ui().toast(e.message, 'err');
    }
  }

  async function cashFlow(type) {
    const ap = await ui().approve('cash', type === 'out' ? 'Approve pay-out' : 'Approve cash in', 'Taking cash in or out of the drawer needs a manager or the owner.');
    if (!ap) return;
    const r = await ui().askAmount({
      title: type === 'out' ? 'Cash out' : 'Cash in',
      lead: type === 'out' ? 'Cash taken from the drawer.' : 'Cash added to the drawer.',
      reason: 'Reason',
      reasons: type === 'out' ? ['Ice', 'LPG refill', 'Supplier payment', 'Rider fee', 'Owner withdrawal'] : ['Extra change', 'Owner top-up'],
      ok: type === 'out' ? 'Take out' : 'Put in',
    });
    if (!r) return;
    try {
      await C.cashMove(type, r.amount, r.reason, ap);
      ui().toast((type === 'out' ? 'Paid out ' : 'Added ') + U.peso(r.amount) + '.', 'ok');
    } catch (e) {
      ui().toast(e.message, 'err');
    }
  }

  async function xReport() {
    const cash = await C.cashFor(S.shift.id);
    reportSheet('X-reading', M.print.shiftReport(S.shift, cash, 'X'));
  }

  function reportSheet(title, text) {
    const s = ui().sheet({ title, icon: 'print' });
    s.setBody(h('pre.paper', { class: S.settings.print.paper === 80 ? 'w80' : 'w58', style: { margin: '0 auto' } }, text));
    s.setFoot(h('button.btn.lg.block', { type: 'button', onclick: () => M.print.printText(text) }, ui().icon('print', 20), 'Print'));
  }

  const DEN_LABEL = { 100000: '₱1,000', 50000: '₱500', 20000: '₱200', 10000: '₱100', 5000: '₱50', 2000: '₱20', 1000: '₱10', 500: '₱5', 100: '₱1' };

  async function closeShiftFlow() {
    if (!S.shift) return;
    if (S.cart.lines.length && !S.cart.held) {
      ui().toast('Finish or hold the order on the register first.', 'err');
      return;
    }
    const counts = {};
    let note = '';
    const s = ui().sheet({ title: 'Close shift', icon: 'drawer', wide: true });
    const totalEl = h('span.val');
    const upd = () => (totalEl.textContent = U.peso(L.countTotal(counts)));
    const rows = L.DENOMS.map((d) => {
      const inp = h('input.input.num', { inputmode: 'numeric', placeholder: '0', 'aria-label': DEN_LABEL[d] + ' count', style: { maxWidth: '110px' } });
      const sub = h('span.amt', { style: { minWidth: '110px' } }, '₱0.00');
      inp.addEventListener('input', () => {
        const n = parseInt(inp.value.replace(/\D/g, ''), 10);
        counts[d] = isFinite(n) ? n : 0;
        sub.textContent = U.peso(counts[d] * d);
        upd();
      });
      return h('div.row', { style: { minHeight: '56px', padding: '6px 4px' } }, h('b.grow', DEN_LABEL[d]), h('span.muted', '×'), inp, sub);
    });
    const centsIn = h('input.input.num', { inputmode: 'decimal', placeholder: '0.00', 'aria-label': 'Centavo coins total', style: { maxWidth: '110px' } });
    centsIn.addEventListener('input', () => {
      const c = U.toCents(centsIn.value);
      counts.cents = c > 0 && c < 10000 ? c : 0;
      upd();
    });
    rows.push(h('div.row', { style: { minHeight: '56px', padding: '6px 4px' } }, h('b.grow', 'Centavo coins'), h('span.muted', '₱'), centsIn, h('span.amt', { style: { minWidth: '110px' } }, 'total')));
    const noteIn = h('input.input', { placeholder: 'Note (optional)', 'aria-label': 'Note', maxlength: 120 });
    noteIn.addEventListener('input', () => (note = noteIn.value));
    const wallets = {};
    const sold = S.shift.tot.sales;
    const walletRows = ['gcash', 'maya']
      .filter((k) => sold[k])
      .map((k) => {
        const i = h('input.input.num', { inputmode: 'decimal', placeholder: 'Total in the app', 'aria-label': C.PAY[k] + ' total in the app', style: { maxWidth: '160px' } });
        i.addEventListener('input', () => {
          const c = U.toCents(i.value);
          if (c >= 0) wallets[k] = c;
          else delete wallets[k];
        });
        return h('div.row', { style: { minHeight: '56px', padding: '6px 4px' } }, h('b.grow', C.PAY[k]), h('span.muted', '₱'), i);
      });
    const expired = M.stockView ? M.stockView.expiringLots().filter((x) => x.state === 'expired') : [];
    s.setBody(
      S.open.length ? h('div.banner', { style: { marginBottom: '12px' } }, ui().icon('alert'), h('div', S.open.length + ' open ticket' + (S.open.length > 1 ? 's stay' : ' stays') + ' open into the next shift')) : null,
      expired.length ? h('div.banner.bad', { style: { marginBottom: '12px' } }, ui().icon('alert'), h('div.grow', expired.length + ' expired ' + (expired.length === 1 ? 'lot is' : 'lots are') + ' still in stock'), h('button.btn.sm', { type: 'button', onclick: () => (s.close(), M.app.go('stock')) }, 'Review')) : null,
      h('p.lead', 'Count the drawer. The expected amount stays hidden until you close.'),
      h('div.split.even', h('div.list', rows.slice(0, 5)), h('div.list', rows.slice(5))),
      h('div.sumrow.total', { style: { marginTop: '14px' } }, h('span.lbl', 'Counted'), totalEl),
      walletRows.length ? h('div', h('div.group-label', 'E-wallet totals in each app (optional)'), h('div.list', walletRows)) : null,
      h('div', { style: { marginTop: '10px' } }, noteIn)
    );
    upd();
    s.setFoot(
      h(
        'button.btn.primary.lg.block',
        {
          type: 'button',
          onclick: async () => {
            if (!(await ui().confirm({ title: 'Close the shift with ' + U.peso(L.countTotal(counts)) + '?', message: 'You cannot change the count after closing.', ok: 'Close shift' }))) return;
            try {
              const sh = await C.closeShift(counts, note.trim(), wallets);
              s.close();
              closedSheet(sh);
            } catch (e) {
              ui().toast(e.message, 'err');
            }
          },
        },
        'Close shift'
      )
    );
  }

  /* A short end-of-day message for the owner (Messenger or SMS). */
  async function copySummary(sh) {
    const t = sh.tot;
    const pays = Object.entries(t.sales).filter(([, v]) => v > 0).map(([k, v]) => C.PAY[k] + ' ' + U.peso0(v)).join(', ');
    const lines = [
      S.settings.business.name + ', Z' + sh.zNo + ', ' + U.fmtDate(sh.closedAt),
      'Net sales ' + U.peso(t.net) + ' from ' + t.orders + ' orders',
      'Payments: ' + (pays || 'none'),
      'Drawer ' + (sh.overShort === 0 ? 'balanced' : (sh.overShort > 0 ? 'over ' : 'short ') + U.peso(Math.abs(sh.overShort))),
    ];
    for (const [k, v] of Object.entries(sh.wallets || {})) lines.push(C.PAY[k] + ' ' + (v.diff === 0 ? 'matches app' : (v.diff > 0 ? 'over ' : 'short ') + U.peso(Math.abs(v.diff))));
    if (t.voids) lines.push('Voids: ' + t.voids);
    if (t.disc) lines.push('Discounts: ' + U.peso(t.disc));
    const text = lines.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      ui().toast('Summary copied.', 'ok');
    } catch (e) {
      const s = ui().sheet({ title: 'Summary', cls: 'narrow' });
      const ta = h('textarea.input', { readonly: true, rows: 8, 'aria-label': 'Summary' });
      ta.value = text;
      s.setBody(ta);
      ta.select();
    }
  }

  async function closedSheet(sh) {
    const cash = await C.cashFor(sh.id);
    const text = M.print.shiftReport(sh, cash, 'Z');
    const s = ui().sheet({ title: 'Shift closed · Z' + sh.zNo, icon: 'drawer', wide: true });
    const os = sh.overShort;
    s.setBody(
      h(
        'div.done-grid',
        h(
          'div.stack',
          h('div.change-hero', h('div.lbl', os === 0 ? 'Drawer balanced' : os > 0 ? 'Drawer over' : 'Drawer short'), h('div.big', { style: { color: os === 0 ? 'var(--ok)' : os > 0 ? 'var(--warn)' : 'var(--bad)' } }, U.peso(Math.abs(os)))),
          h('dl.kv', h('dt', 'Expected'), h('dd', U.peso(sh.expected)), h('dt', 'Counted'), h('dd', U.peso(sh.counted)), h('dt', 'Net sales'), h('dd', U.peso(sh.tot.net)), h('dt', 'Orders'), h('dd', String(sh.tot.orders))),
          Object.keys(sh.wallets || {}).length ? h('div.stack-sm', Object.entries(sh.wallets).map(([k, v]) => h('div.row-gap', h('b.grow', C.PAY[k]), v.diff === 0 ? ui().badge('ok', 'Matches app') : ui().badge(v.diff > 0 ? 'low' : 'out', (v.diff > 0 ? 'Over ' : 'Short ') + U.peso(Math.abs(v.diff)))))) : null,
          h('div.row-gap', h('button.btn.lg.grow', { type: 'button', onclick: () => M.print.printText(text) }, ui().icon('print', 20), 'Print'), h('button.btn.lg.grow', { type: 'button', onclick: () => copySummary(sh) }, ui().icon('copy', 20), 'Copy summary'))
        ),
        h('pre.paper', { class: S.settings.print.paper === 80 ? 'w80' : 'w58' }, text)
      )
    );
    s.setFoot(h('button.btn.primary.lg.block', { type: 'button', onclick: () => s.close() }, 'Done'));
  }

  function mount(el) {
    const body = h('div.stack');
    U.mount(el, h('div.page', h('div.page-head', h('h2', 'Drawer')), body));
    async function draw() {
      const past = (await C.shifts()).filter((x) => x.status === 'closed').slice(0, 30);
      const parts = [];
      if (S.shift) {
        const d = L.drawer(S.shift);
        const t = S.shift.tot;
        const nonCash = Object.entries(t.sales).filter(([k]) => k !== 'cash').reduce((a, [, v]) => a + v, 0);
        const cash = await C.cashFor(S.shift.id);
        parts.push(
          h(
            'div.cards',
            h('div.stat.glass.hero', h('span.label', 'Expected in drawer'), h('span.value', U.peso(d.expected)), h('span.sub', 'Shift opened ' + U.fmtTime(S.shift.openedAt) + ' by ' + (S.shift.openedBy ? S.shift.openedBy.name : '-'))),
            h('div.stat.glass', h('span.label', 'Net sales this shift'), h('span.value', U.peso(t.net, true)), h('span.sub', t.orders + ' orders')),
            h('div.stat.glass', h('span.label', 'Cash / non-cash'), h('span.value', U.peso(d.cash, true)), h('span.sub', U.peso(nonCash) + ' GCash, Maya, card & apps'))
          ),
          h(
            'div.split',
            h(
              'div.panel.glass',
              h('div.panel-title', h('h3', 'Drawer breakdown')),
              h(
                'dl.kv',
                h('dt', 'Opening float'),
                h('dd', U.peso(d.float)),
                h('dt', 'Cash sales'),
                h('dd', '+' + U.peso(d.cash)),
                h('dt', 'Cash refunds'),
                h('dd', '−' + U.peso(d.refunds)),
                h('dt', 'Voided cash returned'),
                h('dd', '−' + U.peso(d.voids)),
                h('dt', 'Cash in'),
                h('dd', '+' + U.peso(d.ins)),
                h('dt', 'Cash out'),
                h('dd', '−' + U.peso(d.outs)),
                h('dt', 'Expected'),
                h('dd.big', U.peso(d.expected))
              ),
              cash.length ? h('div', h('div.group-label', 'Cash in / out'), h('div.list', cash.map((c) => h('div.row', { style: { minHeight: '48px', padding: '8px 2px' } }, ui().icon(c.type === 'in' ? 'in' : 'out', 20), h('div.grow', h('div.t', c.reason), h('div.s', U.fmtTime(c.at) + ' · ' + (c.by ? c.by.name : '') + (c.approver && c.approver.id !== (c.by && c.by.id) ? ' · ok ' + c.approver.name : ''))), h('span.amt', (c.type === 'in' ? '+' : '−') + U.peso(c.amount)))))) : null
            ),
            h(
              'div.panel.glass.stack',
              h('div.panel-title', h('h3', 'Actions')),
              h('button.btn.lg.block', { type: 'button', onclick: () => cashFlow('in') }, ui().icon('in', 20), 'Cash in'),
              h('button.btn.lg.block', { type: 'button', onclick: () => cashFlow('out') }, ui().icon('out', 20), 'Cash out'),
              h('button.btn.lg.block', { type: 'button', onclick: xReport }, ui().icon('print', 20), 'X-reading'),
              h('button.btn.primary.lg.block', { type: 'button', onclick: closeShiftFlow }, ui().icon('lock', 20), 'Count & close shift')
            )
          )
        );
      } else {
        parts.push(h('div.panel.glass', ui().empty('No open shift', 'Open a shift with the starting cash to begin selling.', h('button.btn.primary.lg', { type: 'button', onclick: openShiftFlow }, ui().icon('drawer', 20), 'Open shift'))));
      }
      if (past.length) {
        parts.push(
          h(
            'div.panel.glass',
            h('div.panel-title', h('h3', 'Closed shifts'), h('span.sub', 'tap for the Z-reading')),
            h(
              'div.list',
              past.map((p) =>
                h(
                  'button.row',
                  {
                    type: 'button',
                    onclick: async () => reportSheet('Z-reading #' + p.zNo, M.print.shiftReport(p, await C.cashFor(p.id), 'Z')),
                  },
                  h('div.grow', h('div.t', U.fmtDay(U.dayKey(p.openedAt)) + ' · Z' + p.zNo), h('div.s', U.fmtTime(p.openedAt) + ' to ' + U.fmtTime(p.closedAt) + ' · ' + (p.closedBy ? p.closedBy.name : '') + ' · ' + p.tot.orders + ' orders')),
                  h('span.amt.hide-phone', U.peso(p.tot.net)),
                  ui().badge(p.overShort === 0 ? 'ok' : p.overShort > 0 ? 'low' : 'out', p.overShort === 0 ? 'Balanced' : (p.overShort > 0 ? 'Over ' : 'Short ') + U.peso(Math.abs(p.overShort)))
                )
              )
            )
          )
        );
      }
      U.mount(body, ...parts);
    }
    draw();
    const offs = [M.bus.on('change', draw)];
    return () => offs.forEach((f) => f());
  }

  M.views = M.views || {};
  M.views.drawer = { title: 'Drawer', icon: 'drawer', perm: 'shift', mount };
  M.drawerView = { openShiftFlow, closeShiftFlow, cashFlow, xReport };
})((window.M = window.M || {}));
