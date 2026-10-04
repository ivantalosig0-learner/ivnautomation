/* Mogoba POS — Stock: live on-hand from the ledger, receiving, waste, blind counts, reorder. */
(function (M) {
  'use strict';
  const U = M.util;
  const L = M.logic;
  const C = M.core;
  const S = M.state;
  const h = U.h;
  const ui = () => M.ui;

  const view = { group: 'all', q: '' };
  let usage = {};
  const MOVE = { sale: 'Sold', receive: 'Received', waste: 'Waste', count: 'Count adjust', void: 'Void return', refund: 'Refund return' };

  /* Counting unit: kg / L for bulk, pieces otherwise. */
  const cu = (ing) => (ing.unit === 'g' ? ['kg', 1000] : ing.unit === 'ml' ? ['L', 1000] : ['pc', 1]);
  const groups = () => Array.from(new Set(Object.values(S.ings).filter((i) => i.active !== false).map((i) => i.group)));
  const ingList = () => Object.values(S.ings).filter((i) => i.active !== false).sort((a, b) => (a.sort || 0) - (b.sort || 0));
  const value = (ing) => Math.max(0, ing.onHand) * (ing.cost || 0);
  const perBuy = (ing) => (ing.cost || 0) * (ing.buyFactor || 1);
  const daysLeft = (ing) => {
    const u = usage[ing.id];
    if (!u || u <= 0) return null;
    return Math.max(0, ing.onHand) / u;
  };

  function coverText(dl) {
    if (dl < 1) return 'under a day left';
    const d = dl < 3 ? Math.floor(dl * 10) / 10 : Math.floor(dl);
    return U.trim(d) + (d === 1 ? ' day left' : ' days left');
  }

  function ingSelect(selected) {
    const sel = h('select.input', { 'aria-label': 'Item' }, h('option', { value: '' }, 'Choose an item…'));
    for (const g of groups()) {
      const og = h('optgroup', { label: g });
      for (const i of ingList().filter((x) => x.group === g)) og.append(h('option', { value: i.id, selected: i.id === selected }, i.name));
      sel.append(og);
    }
    return sel;
  }
  const numIn = (val, label) => h('input.input.num', { type: 'text', inputmode: 'decimal', value: val == null ? '' : String(val), 'aria-label': label, placeholder: '0' });
  const parseNum = (s) => {
    const v = parseFloat(String(s).replace(/,/g, ''));
    return isFinite(v) ? v : NaN;
  };

  /* ---------- receive ---------- */
  function receiveSheet(prefill) {
    const rows = [];
    const s = ui().sheet({ title: 'Receive delivery', wide: true, icon: 'truck' });
    const supplier = h('input.input', { placeholder: 'Supplier', 'aria-label': 'Supplier', maxlength: 60 });
    const ref = h('input.input', { placeholder: 'Invoice / DR no.', 'aria-label': 'Invoice number', maxlength: 40 });
    const list = h('div.stack-sm');
    const totalEl = h('b.num');
    const addRow = (ingId, buyQty) => {
      const ing = S.ings[ingId];
      const r = { ing: ingId || '', qty: buyQty || '', cost: ing ? (perBuy(ing) / 100).toFixed(2) : '' };
      rows.push(r);
      draw();
    };
    const recalc = () => {
      let t = 0;
      for (const r of rows) {
        const q = parseNum(r.qty);
        const c = U.toCents(r.cost);
        if (q > 0 && c >= 0) t += q * c;
      }
      totalEl.textContent = U.peso(Math.round(t));
    };
    function draw() {
      U.mount(
        list,
        rows.map((r, i) => {
          const ing = S.ings[r.ing];
          const sel = ingSelect(r.ing);
          sel.addEventListener('change', () => {
            r.ing = sel.value;
            const n = S.ings[r.ing];
            if (n) r.cost = (perBuy(n) / 100).toFixed(2);
            draw();
          });
          const q = numIn(r.qty, 'Quantity');
          q.addEventListener('input', () => ((r.qty = q.value), recalc()));
          const c = numIn(r.cost, 'Cost per unit');
          c.addEventListener('input', () => ((r.cost = c.value), recalc()));
          return h(
            'div.form-grid',
            { style: { gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) auto', alignItems: 'end' } },
            h('label.field', h('span', 'Item'), sel),
            h('label.field', h('span', 'Qty' + (ing ? ' (' + ing.buyUnit + ')' : '')), q),
            h('label.field', h('span', '₱ per ' + (ing ? ing.buyUnit : 'unit')), c),
            h('button.icon-btn', { type: 'button', 'aria-label': 'Remove row', onclick: () => (rows.splice(i, 1), draw()) }, ui().icon('x', 18))
          );
        }),
        h('button.btn.sm', { type: 'button', style: { alignSelf: 'flex-start' }, onclick: () => addRow('') }, ui().icon('plus', 18), 'Add item')
      );
      recalc();
    }
    for (const p of prefill || [{}]) addRow(p.ing || '', p.buyQty || '');
    s.setBody(h('div.form-grid', supplier, ref), h('div.group-label', 'Items received'), list, h('div.sumrow.total', { style: { marginTop: '14px' } }, h('span.lbl', 'Delivery total'), totalEl));
    s.setFoot(
      h(
        'button.btn.go.lg.block',
        {
          type: 'button',
          onclick: async () => {
            const out = [];
            for (const r of rows) {
              const ing = S.ings[r.ing];
              const q = parseNum(r.qty);
              if (!ing || !(q > 0)) continue;
              const c = U.toCents(r.cost);
              if (!(c >= 0)) return ui().toast('Check the cost for ' + ing.name + '.', 'err');
              out.push({ ing: ing.id, qty: q * ing.buyFactor, unitCost: c / ing.buyFactor });
            }
            if (!out.length) return ui().toast('Enter a quantity for at least one item.', 'err');
            try {
              await C.receive(out, { supplier: supplier.value.trim(), ref: ref.value.trim() });
              s.close();
              ui().toast('Received ' + out.length + ' item' + (out.length > 1 ? 's' : '') + '. Stock updated.', 'ok');
            } catch (e) {
              ui().toast(e.message, 'err');
            }
          },
        },
        ui().icon('check', 20),
        'Add to stock'
      )
    );
  }

  /* ---------- waste ---------- */
  function wasteSheet(ingId) {
    const rows = [{ ing: ingId || '', qty: '' }];
    let reason = '';
    const s = ui().sheet({ title: 'Log waste', icon: 'trash' });
    const list = h('div.stack-sm');
    const inp = h('input.input', { placeholder: 'Reason', 'aria-label': 'Reason', maxlength: 60 });
    inp.addEventListener('input', () => (reason = inp.value));
    function draw() {
      U.mount(
        list,
        rows.map((r, i) => {
          const ing = S.ings[r.ing];
          const sel = ingSelect(r.ing);
          sel.addEventListener('change', () => ((r.ing = sel.value), draw()));
          const q = numIn(r.qty, 'Quantity');
          q.addEventListener('input', () => (r.qty = q.value));
          return h('div.form-grid', { style: { gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr) auto', alignItems: 'end' } }, h('label.field', h('span', 'Item'), sel), h('label.field', h('span', 'Qty' + (ing ? ' (' + cu(ing)[0] + ')' : '')), q), h('button.icon-btn', { type: 'button', 'aria-label': 'Remove row', onclick: () => (rows.splice(i, 1), draw()) }, ui().icon('x', 18)));
        }),
        h('button.btn.sm', { type: 'button', style: { alignSelf: 'flex-start' }, onclick: () => (rows.push({ ing: '', qty: '' }), draw()) }, ui().icon('plus', 18), 'Add item')
      );
    }
    draw();
    s.setBody(
      h('div.chips', ['Spoiled', 'Expired', 'Dropped / spilled', 'Over-prepared', 'Oil change', 'Staff meal'].map((r) => h('button.chip', { type: 'button', onclick: () => ((inp.value = r), (reason = r)) }, r))),
      h('div', { style: { margin: '10px 0 6px' } }, inp),
      list
    );
    s.setFoot(
      h(
        'button.btn.danger-solid.lg.block',
        {
          type: 'button',
          onclick: async () => {
            if (!reason.trim()) return ui().toast('Pick or type a reason.', 'err');
            const out = [];
            for (const r of rows) {
              const ing = S.ings[r.ing];
              const q = parseNum(r.qty);
              if (ing && q > 0) out.push({ ing: ing.id, qty: q * cu(ing)[1] });
            }
            if (!out.length) return ui().toast('Enter a quantity for at least one item.', 'err');
            try {
              await C.waste(out, reason.trim());
              s.close();
              ui().toast('Waste logged.', 'ok');
            } catch (e) {
              ui().toast(e.message, 'err');
            }
          },
        },
        'Log waste'
      )
    );
  }

  /* ---------- blind count ---------- */
  function countSheet(onlyId) {
    const vals = {};
    let group = onlyId ? 'all' : groups()[0];
    let showExpected = false;
    const s = ui().sheet({ title: onlyId ? 'Count ' + S.ings[onlyId].name : 'Stock count', wide: !onlyId, icon: 'count' });
    function draw() {
      const items = onlyId ? [S.ings[onlyId]] : ingList().filter((i) => i.group === group);
      const filled = Object.keys(vals).filter((k) => vals[k] !== '').length;
      s.setBody(
        onlyId ? null : h('p.lead', 'Count what is physically on the shelf. Expected amounts stay hidden so the count is honest — you will see the differences after saving.'),
        onlyId ? null : h('div.tabs', groups().map((g) => h('button.chip', { type: 'button', 'aria-pressed': String(g === group), onclick: () => ((group = g), draw()) }, g, h('span.count', String(ingList().filter((i) => i.group === g && vals[i.id] != null && vals[i.id] !== '').length || ''))))),
        h(
          'div.list',
          { style: { marginTop: '8px' } },
          items.map((ing) => {
            const [u, f] = cu(ing);
            const inp = numIn(vals[ing.id] == null ? '' : vals[ing.id], 'Counted ' + ing.name + ' in ' + u);
            inp.style.maxWidth = '140px';
            inp.addEventListener('input', () => {
              vals[ing.id] = inp.value;
              s.setTitle(onlyId ? 'Count ' + ing.name : 'Stock count · ' + Object.values(vals).filter((v) => v !== '').length + ' counted');
            });
            return h('div.row', h('div.grow', h('div.t', ing.name), h('div.s', showExpected || onlyId ? 'System: ' + U.trim(ing.onHand / f) + ' ' + u : u)), inp, h('span.muted', { style: { width: '24px' } }, u));
          })
        ),
        onlyId ? null : h('label.switch', { style: { marginTop: '8px' } }, h('input', { type: 'checkbox', checked: showExpected, onchange: (e) => ((showExpected = e.target.checked), draw()) }), h('span.track'), h('span.txt', h('b', 'Show system amounts'), h('small', 'Off for blind counts')))
      );
      if (!onlyId) s.setTitle('Stock count' + (filled ? ' · ' + filled + ' counted' : ''));
    }
    draw();
    s.setFoot(
      h(
        'button.btn.go.lg.block',
        {
          type: 'button',
          onclick: async () => {
            const rows = [];
            for (const k in vals) {
              if (vals[k] === '') continue;
              const v = parseNum(vals[k]);
              if (!(v >= 0)) return ui().toast('Check the amount for ' + S.ings[k].name + '.', 'err');
              rows.push({ ing: k, counted: Math.round(v * cu(S.ings[k])[1] * 1000) / 1000 });
            }
            if (!rows.length) return ui().toast('Enter at least one counted amount.', 'err');
            try {
              const b = await C.count(rows, onlyId ? 'Spot count' : 'Full count');
              s.close();
              varianceSheet(b.count);
            } catch (e) {
              ui().toast(e.message, 'err');
            }
          },
        },
        ui().icon('check', 20),
        'Save count'
      )
    );
  }

  function varianceSheet(count) {
    const s = ui().sheet({ title: 'Count saved', icon: 'count' });
    const off = count.entries.filter((e) => Math.abs(e.delta) > 0.0005);
    s.setBody(
      h('p.lead', count.entries.length + ' items counted. ' + (off.length ? off.length + ' differ from the system. Stock now matches your count.' : 'Everything matched the system.')),
      off.length
        ? h(
            'div.tbl-wrap',
            h(
              'table.tbl',
              h('thead', h('tr', h('th', 'Item'), h('th.r', 'System'), h('th.r', 'Counted'), h('th.r', 'Difference'), h('th.r', 'Value'))),
              h(
                'tbody',
                off.map((e) => {
                  const ing = S.ings[e.ing];
                  return h('tr', h('td', ing.name), h('td.r', U.fmtQty(e.expected, ing.unit)), h('td.r', U.fmtQty(e.counted, ing.unit)), h('td.r', { style: { color: e.delta < 0 ? 'var(--bad)' : 'var(--ok)' } }, (e.delta > 0 ? '+' : '') + U.fmtQty(e.delta, ing.unit)), h('td.r', U.peso(Math.round(e.delta * e.cost))));
                })
              )
            )
          )
        : null,
      off.length ? h('div.sumrow.total', { style: { marginTop: '12px' } }, h('span.lbl', 'Net variance'), h('b.num', U.peso(count.value))) : null
    );
    s.setFoot(h('button.btn.primary.lg.block', { type: 'button', onclick: () => s.close() }, 'Done'));
  }

  /* ---------- reorder ---------- */
  function reorderSheet() {
    const items = ingList()
      .filter((i) => L.stockStatus(i) !== 'ok')
      .map((i) => ({ ing: i, units: L.suggestOrder(i) }))
      .filter((x) => x.units > 0);
    const s = ui().sheet({ title: 'Reorder list', icon: 'list' });
    if (!items.length) {
      s.setBody(ui().empty('Nothing to reorder', 'Every item is above its reorder point.'));
      return;
    }
    const est = items.reduce((t, x) => t + x.units * perBuy(x.ing), 0);
    const listBox = h('textarea.input', { readonly: true, hidden: true, rows: 6, 'aria-label': 'Reorder list text', style: { marginTop: '12px' } });
    const text = 'Order for ' + S.settings.business.name + ' (' + U.fmtDate(Date.now()) + '):\n' + items.map((x) => '- ' + x.ing.name + ': ' + x.units + ' ' + x.ing.buyUnit).join('\n');
    listBox.value = text;
    s.setBody(
      h('p.lead', 'Brings each item back up to its par level. Copy it into Messenger or SMS for your supplier.'),
      h(
        'div.tbl-wrap',
        h(
          'table.tbl',
          h('thead', h('tr', h('th', 'Item'), h('th.r', 'On hand'), h('th.r', 'Order'), h('th.r', 'Est. cost'))),
          h('tbody', items.map((x) => h('tr', h('td', x.ing.name, ' ', ui().badge(L.stockStatus(x.ing), ui().STOCK_BADGE[L.stockStatus(x.ing)][1])), h('td.r', U.fmtQty(x.ing.onHand, x.ing.unit)), h('td.r', x.units + ' ' + x.ing.buyUnit), h('td.r', U.peso(Math.round(x.units * perBuy(x.ing)))))))
        )
      ),
      h('div.sumrow.total', { style: { marginTop: '12px' } }, h('span.lbl', 'Estimated total'), h('b.num', U.peso(Math.round(est)))),
      listBox
    );
    s.setFoot(
      h(
        'button.btn.lg',
        {
          type: 'button',
          onclick: async () => {
            try {
              await navigator.clipboard.writeText(text);
              ui().toast('Copied. Paste it to your supplier.', 'ok');
            } catch (e) {
              listBox.hidden = false;
              listBox.select();
              ui().toast('Copy was blocked here. The list is selected below — copy it from there.', 'err', 4500);
            }
          },
        },
        ui().icon('copy', 20),
        'Copy list'
      ),
      C.can('stock') ? h('button.btn.go.lg', { type: 'button', onclick: () => (s.close(), receiveSheet(items.map((x) => ({ ing: x.ing.id, buyQty: x.units })))) }, ui().icon('truck', 20), 'Receive these') : null
    );
  }

  /* ---------- edit ingredient ---------- */
  function editSheet(ing) {
    const isNew = !ing;
    const d = ing ? Object.assign({}, ing) : { name: '', group: groups()[0] || 'Dry goods', unit: 'g', buyUnit: 'kg', buyFactor: 1000, cost: 0, par: 0, reorder: 0 };
    const s = ui().sheet({ title: isNew ? 'New stock item' : 'Edit ' + d.name, icon: 'edit' });
    const name = h('input.input', { value: d.name, maxlength: 60, 'aria-label': 'Name' });
    const group = h('input.input', { value: d.group, maxlength: 40, list: 'grp-list', 'aria-label': 'Group' });
    const dl = h('datalist#grp-list', groups().map((g) => h('option', { value: g })));
    const unit = h('select.input', { disabled: !isNew && d.onHand !== 0, 'aria-label': 'Base unit' }, [['g', 'grams (g)'], ['ml', 'millilitres (ml)'], ['pc', 'pieces (pc)']].map(([k, t]) => h('option', { value: k, selected: d.unit === k }, t)));
    const buyUnit = h('input.input', { value: d.buyUnit, maxlength: 20, 'aria-label': 'Buying unit' });
    const factor = numIn(d.buyFactor, 'Base units per buying unit');
    const cost = numIn((perBuy(d) / 100).toFixed(2), 'Cost per buying unit');
    const par = numIn(U.trim(d.par / d.buyFactor), 'Par level');
    const reorder = numIn(U.trim(d.reorder / d.buyFactor), 'Reorder point');
    s.setBody(
      dl,
      h(
        'div.form-grid',
        h('label.field.span2', h('span', 'Name'), name),
        ui().field('Group', group),
        ui().field('Base unit', unit, !isNew && d.onHand !== 0 ? 'Locked while stock is on hand' : 'Recipes use this unit'),
        ui().field('Buying unit', buyUnit, 'e.g. kg, L, pack (50)'),
        ui().field('Base units per buying unit', factor, 'kg = 1000 g, pack (50) = 50 pc'),
        ui().field('Cost per buying unit (₱)', cost, 'Receiving updates it as a moving average'),
        ui().field('Par level (buying units)', par, 'What a full shelf looks like'),
        ui().field('Reorder point (buying units)', reorder, 'Flagged Low at or below this')
      )
    );
    s.setFoot(
      !isNew && C.usedIn(d.id).length === 0 ? h('button.btn.danger', { type: 'button', onclick: async () => (await C.saveIngredient(Object.assign({}, d, { active: false })), s.close(), ui().toast(d.name + ' archived.')) }, 'Archive') : null,
      h(
        'button.btn.primary.lg',
        {
          type: 'button',
          onclick: async () => {
            const f = parseNum(factor.value);
            const c = U.toCents(cost.value);
            const p = parseNum(par.value);
            const r = parseNum(reorder.value);
            if (!name.value.trim()) return ui().toast('Enter a name.', 'err');
            if (!(f > 0)) return ui().toast('Base units per buying unit must be above zero.', 'err');
            if (!(c >= 0) || !(p >= 0) || !(r >= 0)) return ui().toast('Check the numbers.', 'err');
            const rec = Object.assign({}, ing || {}, { name: name.value.trim(), group: group.value.trim() || 'Other', unit: unit.value, buyUnit: buyUnit.value.trim() || unit.value, buyFactor: f, cost: c / f, par: p * f, reorder: r * f });
            try {
              await C.saveIngredient(rec);
              s.close();
              ui().toast('Saved.', 'ok');
            } catch (e) {
              ui().toast(e.message, 'err');
            }
          },
        },
        'Save'
      )
    );
  }

  /* ---------- detail ---------- */
  async function detailSheet(ing) {
    const s = ui().sheet({ title: ing.name, wide: true, icon: 'stock' });
    const moves = (await C.movesFor(ing.id)).slice(0, 60);
    const st = L.stockStatus(ing);
    const dl = daysLeft(ing);
    const used = C.usedIn(ing.id);
    s.setBody(
      h(
        'div.split.even',
        h(
          'div.stack',
          h(
            'dl.kv',
            h('dt', 'On hand'),
            h('dd.big', U.fmtQty(ing.onHand, ing.unit), ' ', ui().badge(ui().STOCK_BADGE[st][0], ui().STOCK_BADGE[st][1])),
            h('dt', 'Par / reorder at'),
            h('dd', U.fmtQty(ing.par, ing.unit) + ' / ' + U.fmtQty(ing.reorder, ing.unit)),
            h('dt', 'Avg cost'),
            h('dd', U.peso(Math.round(perBuy(ing))) + ' per ' + ing.buyUnit),
            h('dt', 'Stock value'),
            h('dd', U.peso(Math.round(value(ing)))),
            h('dt', 'Avg daily use (14 d)'),
            h('dd', usage[ing.id] ? U.fmtQty(usage[ing.id], ing.unit) : '—'),
            h('dt', 'Days of cover'),
            h('dd', dl == null ? '—' : dl < 1 ? 'under a day' : U.trim(Math.floor(dl * 10) / 10) + ' days'),
            h('dt', 'Last counted'),
            h('dd', ing.countedAt ? U.fmtDateTime(ing.countedAt) : 'never')
          ),
          h('div', h('div.group-label', 'Used in'), h('div.chips', used.length ? used.slice(0, 18).map((i) => h('span.badge.muted', i.name)) : h('span.muted', 'Not in any recipe')))
        ),
        h(
          'div',
          h('div.group-label', 'Recent movements'),
          moves.length
            ? h(
                'div.list',
                moves.map((m) => h('div.row', { style: { minHeight: '48px', padding: '8px 4px' } }, h('div.grow', h('div.t', MOVE[m.type] || m.type), h('div.s', U.fmtDateTime(m.at) + (m.note ? ' · ' + m.note : ''))), h('span.amt', { style: { color: m.qty < 0 ? 'var(--ink-2)' : 'var(--ok)' } }, (m.qty > 0 ? '+' : '') + U.fmtQty(m.qty, ing.unit))))
              )
            : h('p.muted', 'No movements yet.')
        )
      )
    );
    if (C.can('stock'))
      s.setFoot(
        h('button.btn', { type: 'button', onclick: () => (s.close(), editSheet(ing)) }, ui().icon('edit', 20), 'Edit'),
        h('button.btn', { type: 'button', onclick: () => (s.close(), wasteSheet(ing.id)) }, ui().icon('trash', 20), 'Waste'),
        h('button.btn', { type: 'button', onclick: () => (s.close(), countSheet(ing.id)) }, ui().icon('count', 20), 'Count'),
        h('button.btn.go', { type: 'button', onclick: () => (s.close(), receiveSheet([{ ing: ing.id }])) }, ui().icon('truck', 20), 'Receive')
      );
  }

  function mount(el) {
    const head = h('div.page-head', h('h2', 'Stock'));
    const edit = C.can('stock');
    if (edit) {
      head.append(
        h('button.btn', { type: 'button', onclick: () => receiveSheet() }, ui().icon('truck', 20), h('span', 'Receive')),
        h('button.btn', { type: 'button', onclick: () => countSheet() }, ui().icon('count', 20), h('span', 'Count')),
        h('button.btn', { type: 'button', onclick: () => wasteSheet() }, ui().icon('trash', 20), h('span.hide-phone', 'Waste')),
        h('button.icon-btn.boxed', { type: 'button', 'aria-label': 'New stock item', onclick: () => editSheet(null) }, ui().icon('plus'))
      );
    }
    const cards = h('div.cards');
    const alert = h('div');
    const chips = h('div.tabs');
    const search = h('input.input', { type: 'search', placeholder: 'Search stock', 'aria-label': 'Search stock', value: view.q });
    const table = h('div.list');
    U.mount(el, h('div.page', head, alert, cards, h('div.panel.glass.stack', h('div.search', ui().icon('search', 20), search), chips, table)));
    search.addEventListener('input', () => {
      view.q = search.value;
      drawTable();
    });

    function drawTop() {
      const all = ingList();
      const out = all.filter((i) => L.stockStatus(i) === 'out');
      const low = all.filter((i) => L.stockStatus(i) === 'low');
      const val = all.reduce((t, i) => t + value(i), 0);
      U.mount(
        alert,
        out.length || low.length
          ? h('button.banner', { type: 'button', style: { width: '100%', textAlign: 'left' }, class: out.length ? 'bad' : '', onclick: reorderSheet }, ui().icon('alert'), h('div.grow', h('b', (out.length ? out.length + ' out of stock' : '') + (out.length && low.length ? ' · ' : '') + (low.length ? low.length + ' running low' : '')), h('div.s', out.concat(low).slice(0, 5).map((i) => i.name).join(', ') + (out.length + low.length > 5 ? '…' : ''))), h('span.link', 'Reorder list'))
          : null
      );
      U.mount(
        cards,
        h('div.stat.glass', h('span.label', 'Stock value'), h('span.value', U.peso(Math.round(val), true)), h('span.sub', all.length + ' items at average cost')),
        h('div.stat.glass', h('span.label', 'Out of stock'), h('span.value', { style: out.length ? { color: 'var(--bad)' } : null }, String(out.length)), h('span.sub', 'menu items using them show Sold out')),
        h('div.stat.glass', h('span.label', 'Running low'), h('span.value', { style: low.length ? { color: 'var(--warn)' } : null }, String(low.length)), h('span.sub', 'at or below reorder point'))
      );
    }
    function drawChips() {
      const list = [['all', 'All'], ['alert', 'Low & out']].concat(groups().map((g) => [g, g]));
      U.mount(chips, list.map(([k, t]) => h('button.chip', { type: 'button', 'aria-pressed': String(view.group === k), onclick: () => ((view.group = k), drawChips(), drawTable()) }, t)));
    }
    function drawTable() {
      const q = view.q.trim().toLowerCase();
      let list = ingList();
      if (view.group === 'alert') list = list.filter((i) => L.stockStatus(i) !== 'ok');
      else if (view.group !== 'all') list = list.filter((i) => i.group === view.group);
      if (q) list = list.filter((i) => (i.name + ' ' + i.group).toLowerCase().includes(q));
      if (!list.length) return U.mount(table, ui().empty('Nothing here', q ? 'No stock item matches “' + view.q + '”.' : 'No items in this group.'));
      U.mount(
        table,
        list.map((ing) => {
          const st = L.stockStatus(ing);
          const pct = ing.par > 0 ? Math.max(0, Math.min(1, ing.onHand / ing.par)) : 0;
          const dl = daysLeft(ing);
          return h(
            'button.row',
            { type: 'button', onclick: () => detailSheet(ing) },
            h('div.grow', h('div.t', ing.name), h('div.s', ing.group + (dl != null ? ' · ' + coverText(dl) : ''))),
            h('div.hide-phone', { style: { width: '120px' } }, h('div.meter', { class: st, role: 'img', 'aria-label': Math.round(pct * 100) + '% of par' }, h('i', { style: { width: pct * 100 + '%' } }))),
            h('span.amt', { style: { minWidth: '84px' } }, U.fmtQty(ing.onHand, ing.unit)),
            ui().badge(ui().STOCK_BADGE[st][0], ui().STOCK_BADGE[st][1])
          );
        })
      );
    }
    const all = () => {
      drawTop();
      drawChips();
      drawTable();
    };
    all();
    C.usage(14).then((u) => {
      usage = u;
      drawTable();
    });
    const offs = [M.bus.on('stock', all), M.bus.on('change', all)];
    return () => offs.forEach((f) => f());
  }

  M.views = M.views || {};
  M.views.stock = { title: 'Stock', icon: 'stock', perm: 'orders', mount };
  M.stockView = { receiveSheet, wasteSheet, countSheet, reorderSheet };
})((window.M = window.M || {}));
