/* Mogoba POS: Stock. On-hand comes from the movement ledger; lots carry expiry dates and
 * leave first-expiry-first-out. */
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
  const MOVE = { sale: 'Sold', receive: 'Received', waste: 'Waste', count: 'Count', void: 'Void return', refund: 'Refund return', adjust: 'Adjusted' };
  /* Remove reasons that are waste show up in waste reports; the rest are corrections. */
  /* [label, kind, rule]: rule 'note' needs a note, 'pin' needs a manager PIN. */
  const REASONS = {
    remove: [['Expired', 'waste'], ['Spoiled', 'waste'], ['Dropped or damaged', 'waste'], ['Cooking error', 'waste'], ['Remake', 'waste'], ['Staff meal', 'waste'], ['Sample', 'waste'], ['Return to supplier', 'adjust'], ['Lost or theft', 'adjust', 'pin'], ['Correction', 'adjust', 'note']],
    add: [['Transfer in', 'adjust'], ['Found in storage', 'adjust'], ['Free goods', 'adjust'], ['Correction', 'adjust', 'note']],
  };
  const PIN_OVER = 50000;

  /* Counting unit: kg / L for bulk, pieces otherwise. */
  const cu = (ing) => (ing.unit === 'g' ? ['kg', 1000] : ing.unit === 'ml' ? ['L', 1000] : ['pc', 1]);
  const groups = () => Array.from(new Set(Object.values(S.ings).filter((i) => i.active !== false).map((i) => i.group)));
  const ingList = () => Object.values(S.ings).filter((i) => i.active !== false).sort((a, b) => (a.sort || 0) - (b.sort || 0));
  const value = (ing) => Math.max(0, ing.onHand) * (ing.cost || 0);
  const perBuy = (ing) => (ing.cost || 0) * (ing.buyFactor || 1);
  const today = () => U.dayKey();
  const daysLeft = (ing) => {
    const u = usage[ing.id];
    return u > 0 ? Math.max(0, ing.onHand) / u : null;
  };
  const coverDays = (dl) => (dl < 1 ? 'under 1 day' : (dl < 3 ? U.trim(Math.floor(dl * 10) / 10) : Math.floor(dl)) + (dl >= 1 && dl < 2 ? ' day' : ' days'));
  const coverText = (dl) => (dl < 1 ? 'under 1 day' : (dl < 3 ? U.trim(Math.floor(dl * 10) / 10) : Math.floor(dl)) + ' d cover');
  const expiryDefault = (ing) => (ing && ing.shelfLife ? U.addDays(today(), ing.shelfLife) : '');

  function ingSelect(selected) {
    const sel = h('select.input', { 'aria-label': 'Item' }, h('option', { value: '' }, 'Choose item'));
    for (const g of groups()) sel.append(h('optgroup', { label: g }, ingList().filter((x) => x.group === g).map((i) => h('option', { value: i.id, selected: i.id === selected }, i.name))));
    return sel;
  }
  const numIn = (val, label) => h('input.input.num', { type: 'text', inputmode: 'decimal', value: val == null ? '' : String(val), 'aria-label': label, placeholder: '0' });
  const parseNum = (s) => {
    const v = parseFloat(String(s).replace(/,/g, ''));
    return isFinite(v) ? v : NaN;
  };
  const dateIn = (val, label) => h('input.input', { type: 'date', value: val || '', 'aria-label': label, min: U.addDays(today(), -30) });

  /* Every expiring or expired lot across stock, most urgent first. */
  function expiringLots() {
    const t = today();
    const out = [];
    for (const ing of ingList()) {
      for (const lot of L.lotsOf(ing)) {
        if (!lot.exp || !(lot.qty > 0)) continue;
        const state = L.expiryState(lot.exp, t, L.soonWindow(ing));
        if (state === 'soon' || state === 'expired') out.push({ ing, lot, state, days: L.daysUntil(lot.exp, t) });
      }
    }
    return out.sort((a, b) => a.days - b.days);
  }

  async function writeOff(entries) {
    try {
      await C.waste(entries.map((x) => ({ ing: x.ing.id, qty: x.lot.qty, lot: x.lot.id })), 'Expired');
      ui().toast('Written off ' + entries.length + (entries.length === 1 ? ' lot.' : ' lots.'), 'ok');
    } catch (e) {
      ui().toast(e.message, 'err');
    }
  }

  /* ---------- receive ---------- */
  function receiveSheet(prefill) {
    const rows = [];
    const s = ui().sheet({ title: 'Receive delivery', wide: true, icon: 'truck' });
    const supplier = h('input.input', { placeholder: 'Supplier', 'aria-label': 'Supplier', maxlength: 60 });
    const ref = h('input.input', { placeholder: 'Invoice or DR no.', 'aria-label': 'Invoice number', maxlength: 40 });
    const list = h('div.stack-sm');
    const totalEl = h('b.num');
    const addRow = (ingId, buyQty) => {
      const ing = S.ings[ingId];
      rows.push({ ing: ingId || '', qty: buyQty || '', cost: ing ? (perBuy(ing) / 100).toFixed(2) : '', exp: expiryDefault(ing) });
      if (ing && ing.supplier && !supplier.value) supplier.value = ing.supplier;
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
            if (n) {
              r.cost = (perBuy(n) / 100).toFixed(2);
              r.exp = expiryDefault(n);
            }
            draw();
          });
          const q = numIn(r.qty, 'Quantity');
          q.addEventListener('input', () => ((r.qty = q.value), recalc()));
          const c = numIn(r.cost, 'Cost per unit');
          c.addEventListener('input', () => ((r.cost = c.value), recalc()));
          const e = dateIn(r.exp, 'Expiry date');
          e.addEventListener('change', () => (r.exp = e.value));
          const quick = h('span.quick-exp', [1, 3, 7].map((d) => h('button', { type: 'button', 'aria-label': d === 1 ? 'Expires tomorrow' : 'Expires in ' + d + ' days', onclick: () => ((r.exp = U.addDays(today(), d)), (e.value = r.exp)) }, '+' + d + 'd')));
          return h(
            'div.recv-row',
            h('label.field', h('span', 'Item'), sel),
            h('label.field', h('span', 'Qty' + (ing ? ' (' + ing.buyUnit + ')' : '')), q),
            h('label.field', h('span', '₱ per ' + (ing ? ing.buyUnit : 'unit')), c),
            h('div.field', h('span', 'Expires', quick), e),
            h('button.icon-btn', { type: 'button', 'aria-label': 'Remove row', onclick: () => (rows.splice(i, 1), draw()) }, ui().icon('x', 18))
          );
        }),
        h('button.btn.sm', { type: 'button', style: { alignSelf: 'flex-start' }, onclick: () => addRow('') }, ui().icon('plus', 18), 'Add item')
      );
      recalc();
    }
    for (const p of prefill || [{}]) addRow(p.ing || '', p.buyQty || '');
    s.setBody(h('div.form-grid', supplier, ref), h('div.group-label', 'Items'), list, h('div.sumrow.total', { style: { marginTop: '14px' } }, h('span.lbl', 'Total'), totalEl));
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
              if (r.exp && r.exp < today()) return ui().toast(ing.name + ' is already past its expiry date.', 'err');
              out.push({ ing: ing.id, qty: q * ing.buyFactor, unitCost: c / ing.buyFactor, exp: r.exp || '' });
            }
            if (!out.length) return ui().toast('Enter a quantity for at least one item.', 'err');
            const up = out.filter((x) => S.ings[x.ing].cost > 0 && x.unitCost > S.ings[x.ing].cost * 1.1).map((x) => S.ings[x.ing].name + ' +' + Math.round((x.unitCost / S.ings[x.ing].cost - 1) * 100) + '%');
            try {
              await C.receive(out, { supplier: supplier.value.trim(), ref: ref.value.trim() });
              s.close();
              if (up.length) ui().toast('Stock received. Cost up: ' + up.join(', ') + '. Check menu prices.', 'err', 6000);
              else ui().toast('Stock received.', 'ok');
            } catch (e) {
              ui().toast(e.message, 'err');
            }
          },
        },
        ui().icon('check', 20),
        'Receive'
      )
    );
  }

  /* ---------- correct a lot's use-by date ---------- */
  function lotDateSheet(ing, lot, done) {
    const s = ui().sheet({ title: 'Use-by date', cls: 'narrow', icon: 'clock' });
    const e = dateIn(lot.exp, 'Use-by date');
    s.setBody(
      h('p.lead', { style: { margin: '0 0 12px' } }, ing.name + ' · ' + U.fmtQty(lot.qty, ing.unit)),
      h('label.field', h('span', 'Use by'), e),
      h('span.quick-exp', { style: { marginTop: '10px' } }, [1, 3, 7].map((d) => h('button', { type: 'button', onclick: () => (e.value = U.addDays(today(), d)) }, d === 1 ? 'Tomorrow' : 'In ' + d + ' days')))
    );
    s.setFoot(
      h('button.btn', { type: 'button', onclick: () => (e.value = '') }, 'No date'),
      h('button.btn.primary', {
        type: 'button',
        onclick: async () => {
          try {
            await C.setLotExpiry(ing.id, lot.id, e.value);
            s.close();
            ui().toast('Use-by date saved.', 'ok');
            done();
          } catch (err) {
            ui().toast(err.message, 'err');
          }
        },
      }, 'Save')
    );
  }

  /* ---------- add or remove ---------- */
  function adjustSheet(ingId, startDir) {
    let dir = startDir || 'remove';
    let reason = '';
    let note = '';
    const rows = [{ ing: ingId || '', qty: '', exp: expiryDefault(S.ings[ingId]) }];
    const s = ui().sheet({ title: 'Add or remove stock', icon: 'stock' });
    function draw() {
      const reasons = REASONS[dir];
      if (!reasons.some((r) => r[0] === reason)) reason = '';
      s.setBody(
        ui().seg([['remove', 'Remove'], ['add', 'Add']], dir, (v) => ((dir = v), draw()), 'Direction'),
        h('div.group-label', 'Reason'),
        h('div.chips', reasons.map(([r]) => h('button.chip', { type: 'button', 'aria-pressed': String(reason === r), onclick: () => ((reason = r), draw()) }, r))),
        (reasons.find((x) => x[0] === reason) || [])[2] === 'note'
          ? (() => {
              const n = h('input.input', { value: note, placeholder: 'What happened', 'aria-label': 'Note', maxlength: 120, style: { marginTop: '8px' } });
              n.addEventListener('input', () => (note = n.value));
              return n;
            })()
          : null,
        h('div.group-label', 'Items'),
        h(
          'div.stack-sm',
          rows.map((r, i) => {
            const ing = S.ings[r.ing];
            const sel = ingSelect(r.ing);
            sel.addEventListener('change', () => ((r.ing = sel.value), (r.exp = expiryDefault(S.ings[r.ing])), draw()));
            const q = numIn(r.qty, 'Quantity');
            q.addEventListener('input', () => (r.qty = q.value));
            const e = dateIn(r.exp, 'Expiry date');
            e.addEventListener('change', () => (r.exp = e.value));
            return h(
              'div.adj-row',
              { class: dir === 'add' ? 'with-exp' : '' },
              h('label.field', h('span', 'Item'), sel),
              h('label.field', h('span', 'Qty' + (ing ? ' (' + cu(ing)[0] + ')' : '')), q),
              dir === 'add' ? h('label.field', h('span', 'Expires'), e) : null,
              h('button.icon-btn', { type: 'button', 'aria-label': 'Remove row', onclick: () => (rows.splice(i, 1), rows.length || rows.push({ ing: '', qty: '', exp: '' }), draw()) }, ui().icon('x', 18))
            );
          }),
          h('button.btn.sm', { type: 'button', style: { alignSelf: 'flex-start' }, onclick: () => (rows.push({ ing: '', qty: '', exp: '' }), draw()) }, ui().icon('plus', 18), 'Add item')
        )
      );
      s.setFoot(h('button.btn.lg.block', { type: 'button', class: dir === 'remove' ? 'danger-solid' : 'go', onclick: save }, dir === 'remove' ? 'Remove from stock' : 'Add to stock'));
    }
    async function save() {
      if (!reason) return ui().toast('Pick a reason.', 'err');
      const out = [];
      for (const r of rows) {
        const ing = S.ings[r.ing];
        const q = parseNum(r.qty);
        if (!ing || !(q > 0)) continue;
        const qty = q * cu(ing)[1];
        if (dir === 'remove' && qty > Math.max(0, ing.onHand) + 1e-6) return ui().toast('Only ' + U.fmtQty(Math.max(0, ing.onHand), ing.unit) + ' of ' + ing.name + ' on hand.', 'err');
        out.push({ ing: ing.id, qty, exp: dir === 'add' ? r.exp || '' : '' });
      }
      if (!out.length) return ui().toast('Enter a quantity.', 'err');
      const [, kind, rule] = REASONS[dir].find((x) => x[0] === reason);
      if (rule === 'note' && !note.trim()) return ui().toast('Add a note for the correction.', 'err');
      const worth = out.reduce((t, x) => t + x.qty * (S.ings[x.ing].cost || 0), 0);
      if (rule || worth > PIN_OVER) {
        const ap = await ui().approve('stock', 'Approve stock change', 'Corrections, losses and changes over ' + U.peso0(PIN_OVER) + ' need a manager PIN.');
        if (!ap) return;
      }
      const why = reason + (note.trim() ? ': ' + note.trim() : '');
      try {
        if (dir === 'remove' && kind === 'waste') await C.waste(out, why);
        else await C.adjust(out.map((x) => Object.assign({}, x, { qty: dir === 'remove' ? -x.qty : x.qty })), why);
        s.close();
        ui().toast(dir === 'remove' ? 'Removed from stock.' : 'Added to stock.', 'ok');
      } catch (e) {
        ui().toast(e.message, 'err');
      }
    }
    draw();
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
        onlyId ? null : h('p.lead', 'Count what is on the shelf. System amounts stay hidden until you save.'),
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
              if (!onlyId) s.setTitle('Stock count · ' + Object.values(vals).filter((v) => v !== '').length + ' counted');
            });
            return h('div.row', h('div.grow', h('div.t', ing.name), h('div.s', showExpected || onlyId ? 'System ' + U.trim(ing.onHand / f) + ' ' + u : u)), inp, h('span.muted', { style: { width: '24px' } }, u));
          })
        ),
        onlyId ? null : h('label.switch', { style: { marginTop: '8px' } }, h('input', { type: 'checkbox', checked: showExpected, onchange: (e) => ((showExpected = e.target.checked), draw()) }), h('span.track'), h('span.txt', h('b', 'Show system amounts')))
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
            if (!rows.length) return ui().toast('Enter at least one amount.', 'err');
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
      h('p.lead', count.entries.length + ' counted · ' + (off.length ? off.length + ' differ' : 'all matched')),
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
    const bySupplier = {};
    for (const x of items) (bySupplier[x.ing.supplier || 'No supplier set'] = bySupplier[x.ing.supplier || 'No supplier set'] || []).push(x);
    const est = items.reduce((t, x) => t + x.units * perBuy(x.ing), 0);
    const text =
      'Order for ' + S.settings.business.name + ', ' + U.fmtDate(Date.now()) + '\n' +
      Object.entries(bySupplier).map(([sup, xs]) => sup + ':\n' + xs.map((x) => '- ' + x.ing.name + ': ' + x.units + ' ' + x.ing.buyUnit).join('\n')).join('\n\n');
    const listBox = h('textarea.input', { readonly: true, hidden: true, rows: 6, 'aria-label': 'Reorder list text', style: { marginTop: '12px' } });
    listBox.value = text;
    s.setBody(
      Object.entries(bySupplier).map(([sup, xs]) =>
        h(
          'div',
          h('div.group-label', sup),
          h(
            'div.tbl-wrap',
            h(
              'table.tbl',
              h('thead', h('tr', h('th', 'Item'), h('th.r', 'On hand'), h('th.r', 'Order'), h('th.r', 'Est. cost'))),
              h('tbody', xs.map((x) => h('tr', h('td', x.ing.name, ' ', ui().badge(L.stockStatus(x.ing), ui().STOCK_BADGE[L.stockStatus(x.ing)][1])), h('td.r', U.fmtQty(x.ing.onHand, x.ing.unit)), h('td.r', x.units + ' ' + x.ing.buyUnit), h('td.r', U.peso(Math.round(x.units * perBuy(x.ing)))))))
            )
          )
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
              ui().toast('Copy is blocked here. Select the text below.', 'err', 4500);
            }
          },
        },
        ui().icon('copy', 20),
        'Copy list'
      ),
      C.can('stock') ? h('button.btn.go.lg', { type: 'button', onclick: () => (s.close(), receiveSheet(items.map((x) => ({ ing: x.ing.id, buyQty: x.units })))) }, ui().icon('truck', 20), 'Receive these') : null
    );
  }

  /* ---------- edit item ---------- */
  function editSheet(ing) {
    const isNew = !ing;
    const d = ing ? Object.assign({}, ing) : { name: '', group: groups()[0] || 'Dry goods', unit: 'g', buyUnit: 'kg', buyFactor: 1000, cost: 0, par: 0, reorder: 0, shelfLife: 0, supplier: '' };
    const s = ui().sheet({ title: isNew ? 'New stock item' : 'Edit ' + d.name, icon: 'edit' });
    const name = h('input.input', { value: d.name, maxlength: 60, 'aria-label': 'Name' });
    const group = h('input.input', { value: d.group, maxlength: 40, list: 'grp-list', 'aria-label': 'Group' });
    const dl = h('datalist#grp-list', groups().map((g) => h('option', { value: g })));
    const locked = !isNew && d.onHand !== 0;
    const unit = h('select.input', { disabled: locked, 'aria-label': 'Base unit' }, [['g', 'grams (g)'], ['ml', 'millilitres (ml)'], ['pc', 'pieces (pc)']].map(([k, t]) => h('option', { value: k, selected: d.unit === k }, t)));
    const buyUnit = h('input.input', { value: d.buyUnit, maxlength: 20, 'aria-label': 'Buying unit' });
    const factor = numIn(d.buyFactor, 'Base units per buying unit');
    const cost = numIn((perBuy(d) / 100).toFixed(2), 'Cost per buying unit');
    const par = numIn(U.trim(d.par / d.buyFactor), 'Par level');
    const reorder = numIn(U.trim(d.reorder / d.buyFactor), 'Reorder point');
    const life = numIn(d.shelfLife || '', 'Shelf life in days');
    const supplier = h('input.input', { value: d.supplier || '', maxlength: 60, 'aria-label': 'Supplier', placeholder: 'Optional' });
    const usedBy = isNew ? [] : C.usedIn(d.id);
    s.setBody(
      dl,
      h(
        'div.form-grid',
        h('label.field.span2', h('span', 'Name'), name),
        ui().field('Group', group),
        ui().field('Supplier', supplier),
        ui().field('Base unit', unit, locked ? 'Locked while in stock' : 'Recipes use this unit'),
        ui().field('Shelf life (days)', life, 'Sets the default expiry when receiving. Blank = no expiry.'),
        ui().field('Buying unit', buyUnit, 'kg, L, pack (50)'),
        ui().field('Base units per buying unit', factor, '1 kg = 1000 g'),
        ui().field('Cost per buying unit (₱)', cost, 'Updated by receiving'),
        ui().field('Par level (buying units)', par, 'A full shelf'),
        ui().field('Reorder point (buying units)', reorder, 'Low at or below this')
      ),
      !isNew && usedBy.length ? h('p.muted', { style: { fontSize: '13px', marginTop: '12px' } }, 'Used in ' + usedBy.length + ' recipe' + (usedBy.length > 1 ? 's' : '') + '. Remove it from those recipes before archiving.') : null
    );
    s.setFoot(
      !isNew ? h('button.btn.danger', { type: 'button', disabled: usedBy.length > 0, onclick: async () => {
        if (!(await ui().confirm({ title: 'Archive ' + d.name + '?', message: 'It leaves the stock list. History stays in reports.', ok: 'Archive', danger: true }))) return;
        await C.saveIngredient(Object.assign({}, d, { active: false }));
        s.close();
        ui().toast(d.name + ' archived.');
      } }, 'Archive') : null,
      h(
        'button.btn.primary.lg',
        {
          type: 'button',
          onclick: async () => {
            const f = parseNum(factor.value);
            const c = U.toCents(cost.value);
            const p = parseNum(par.value);
            const r = parseNum(reorder.value);
            const lifeDays = life.value.trim() === '' ? 0 : parseNum(life.value);
            if (!name.value.trim()) return ui().toast('Enter a name.', 'err');
            if (!(f > 0)) return ui().toast('Base units per buying unit must be above zero.', 'err');
            if (!(c >= 0) || !(p >= 0) || !(r >= 0) || !(lifeDays >= 0)) return ui().toast('Check the numbers.', 'err');
            const rec = Object.assign({}, ing || {}, { name: name.value.trim(), group: group.value.trim() || 'Other', unit: unit.value, buyUnit: buyUnit.value.trim() || unit.value, buyFactor: f, cost: c / f, par: p * f, reorder: r * f, shelfLife: Math.round(lifeDays), supplier: supplier.value.trim() });
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

  /* ---------- item detail ---------- */
  async function detailSheet(ing) {
    const s = ui().sheet({ title: ing.name, wide: true, icon: 'stock' });
    const moves = (await C.movesFor(ing.id)).slice(0, 60);
    const st = L.stockStatus(ing);
    const dl = daysLeft(ing);
    const used = C.usedIn(ing.id);
    const t = today();
    const lots = L.sortLots(L.lotsOf(ing)).filter((l) => l.qty > 0);
    const canEdit = C.can('stock');
    s.setBody(
      h(
        'div.split.even',
        h(
          'div.stack',
          h('div.stat-inline', h('span.big', U.fmtQty(ing.onHand, ing.unit)), ui().badge(ui().STOCK_BADGE[st][0], ui().STOCK_BADGE[st][1])),
          ui().level(ing.onHand, Math.max(ing.par, ing.onHand), { state: st, marker: ing.reorder, markerLabel: 'Reorder point', label: 'On hand against par' }),
          h('div.legend', h('span', 'Par ', h('b', U.fmtQty(ing.par, ing.unit))), h('span', 'Reorder at ', h('b', U.fmtQty(ing.reorder, ing.unit))), h('span', 'Use per day ', h('b', usage[ing.id] ? U.fmtQty(usage[ing.id], ing.unit) : '-'))),
          h(
            'dl.kv',
            h('dt', 'Cover'),
            h('dd', dl == null ? '-' : coverDays(dl)),
            h('dt', 'Avg cost'),
            h('dd', U.peso(Math.round(perBuy(ing))) + ' / ' + ing.buyUnit),
            h('dt', 'Value'),
            h('dd', U.peso(Math.round(value(ing)))),
            h('dt', 'Shelf life'),
            h('dd', ing.shelfLife ? ing.shelfLife + ' d' : 'No expiry'),
            ing.supplier ? [h('dt', 'Supplier'), h('dd', ing.supplier)] : null,
            h('dt', 'Last count'),
            h('dd', ing.countedAt ? U.fmtDateTime(ing.countedAt) : 'Never')
          ),
          h('div.group-label', 'Lots'),
          lots.length
            ? h(
                'div.list',
                lots.map((l) => {
                  const state = L.expiryState(l.exp, t, L.soonWindow(ing));
                  return h(
                    'div.row',
                    { style: { minHeight: '48px', padding: '8px 2px' } },
                    h('div.grow', h('div.t', U.fmtQty(l.qty, ing.unit)), h('div.s', l.exp ? 'Use by ' + U.fmtDay(l.exp) : 'No date')),
                    l.exp ? ui().expiryChip(L.daysUntil(l.exp, t), state) : null,
                    canEdit ? h('button.btn.sm', { type: 'button', 'aria-label': 'Change use-by date', onclick: () => lotDateSheet(ing, l, () => (s.close(), detailSheet(ing.id))) }, ui().icon('edit', 16), 'Date') : null,
                    canEdit && state === 'expired' ? h('button.btn.sm.danger', { type: 'button', onclick: async () => (await writeOff([{ ing, lot: l }]), s.close()) }, 'Write off') : null
                  );
                })
              )
            : h('p.muted', 'Nothing on hand.'),
          h('div.group-label', 'Used in'),
          h('div.chips', used.length ? used.slice(0, 18).map((i) => h('span.badge.muted', i.name)) : h('span.muted', 'No recipe'))
        ),
        h(
          'div',
          h('div.group-label', 'Recent movements'),
          moves.length
            ? h('div.list', moves.map((m) => h('div.row', { style: { minHeight: '48px', padding: '8px 4px' } }, h('div.grow', h('div.t', MOVE[m.type] || m.type), h('div.s', U.fmtDateTime(m.at) + (m.note ? ' · ' + m.note : '') + (m.exp ? ' · use by ' + U.fmtDay(m.exp) : ''))), h('span.amt', { style: { color: m.qty < 0 ? 'var(--ink-2)' : 'var(--ok)' } }, (m.qty > 0 ? '+' : '') + U.fmtQty(m.qty, ing.unit)))))
            : h('p.muted', 'No movements yet.')
        )
      )
    );
    if (canEdit)
      s.setFoot(
        h('button.btn', { type: 'button', onclick: () => (s.close(), editSheet(ing)) }, ui().icon('edit', 20), 'Edit'),
        h('button.btn', { type: 'button', onclick: () => (s.close(), adjustSheet(ing.id, 'remove')) }, ui().icon('minus', 20), 'Remove'),
        h('button.btn', { type: 'button', onclick: () => (s.close(), adjustSheet(ing.id, 'add')) }, ui().icon('plus', 20), 'Add'),
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
        h('button.btn', { type: 'button', onclick: () => adjustSheet() }, ui().icon('stock', 20), h('span', 'Add / remove')),
        h('button.btn', { type: 'button', onclick: () => countSheet() }, ui().icon('count', 20), h('span', 'Count')),
        h('button.btn', { type: 'button', onclick: () => reorderSheet() }, ui().icon('list', 20), h('span', 'Reorder')),
        h('button.icon-btn.boxed', { type: 'button', 'aria-label': 'New stock item', onclick: () => editSheet(null) }, ui().icon('plus'), h('span.show-phone', 'New item'))
      );
    }
    const top = h('div.cards.cards-3');
    const expiring = h('div');
    const chips = h('div.tabs');
    const search = h('input.input', { type: 'search', placeholder: 'Search stock', 'aria-label': 'Search stock', value: view.q });
    const table = h('div.list');
    U.mount(el, h('div.page', head, top, expiring, h('div.panel.glass.stack', h('div.search', ui().icon('search', 20), search), chips, table)));
    search.addEventListener('input', () => {
      view.q = search.value;
      drawTable();
    });

    function drawTop() {
      const all = ingList();
      const by = { ok: 0, low: 0, out: 0 };
      for (const i of all) by[L.stockStatus(i)]++;
      const val = all.reduce((t, i) => t + value(i), 0);
      const dailyCost = all.reduce((t, i) => t + (usage[i.id] || 0) * (i.cost || 0), 0);
      const exp = expiringLots();
      const expired = exp.filter((x) => x.state === 'expired');
      U.mount(
        top,
        h(
          'button.stat.glass',
          { type: 'button', onclick: () => ((view.group = 'alert'), drawChips(), drawTable()) },
          h('span.label', 'Stock health'),
          h('span.value', by.low + by.out ? by.out + ' out · ' + by.low + ' low' : 'All good'),
          ui().stackBar([{ value: by.ok, cls: 'c-ok', label: 'OK' }, { value: by.low, cls: 'c-low', label: 'Low' }, { value: by.out, cls: 'c-out', label: 'Out' }])
        ),
        h(
          'div.stat.glass',
          h('span.label', 'Expiring'),
          h('span.value', { style: expired.length ? { color: 'var(--bad)' } : exp.length ? { color: 'var(--warn)' } : null }, exp.length ? (expired.length ? expired.length + ' expired · ' : '') + (exp.length - expired.length) + ' soon' : 'Nothing soon'),
          h('span.sub', exp.length ? U.peso(Math.round(exp.reduce((t, x) => t + x.lot.qty * (x.ing.cost || 0), 0)), true) + ' at risk' : 'Lots are within date')
        ),
        h('div.stat.glass', h('span.label', 'Stock value'), h('span.value', U.peso(Math.round(val), true)), h('span.sub', dailyCost > 0 ? '≈ ' + Math.round(val / dailyCost) + ' days of use' : all.length + ' items'))
      );
      U.mount(
        expiring,
        exp.length
          ? h(
              'section.panel.glass',
              h('div.panel-title', h('h3', 'Use first'), expired.length && edit ? h('button.btn.sm.danger', { type: 'button', onclick: () => writeOff(expired) }, 'Write off ' + expired.length + ' expired') : null),
              h(
                'div.exp-list',
                exp.slice(0, 8).map((x) =>
                  h(
                    'button.exp-item',
                    { type: 'button', onclick: () => detailSheet(x.ing) },
                    h('b', x.ing.name),
                    h('span.exp-meta', h('span.muted', U.fmtQty(x.lot.qty, x.ing.unit)), ui().expiryChip(x.days, x.state))
                  )
                )
              )
            )
          : null
      );
    }
    function drawChips() {
      const list = [['all', 'All'], ['alert', 'Low and out'], ['expiry', 'Expiring']].concat(groups().map((g) => [g, g]));
      U.mount(chips, list.map(([k, t]) => h('button.chip', { type: 'button', 'aria-pressed': String(view.group === k), onclick: () => ((view.group = k), drawChips(), drawTable()) }, t)));
    }
    function drawTable() {
      const q = view.q.trim().toLowerCase();
      const t = today();
      let list = ingList();
      if (view.group === 'alert') list = list.filter((i) => L.stockStatus(i) !== 'ok');
      else if (view.group === 'expiry') list = list.filter((i) => {
        const n = L.nextExpiry(i, t);
        return n && n.state !== 'ok';
      });
      else if (view.group !== 'all') list = list.filter((i) => i.group === view.group);
      if (q) list = list.filter((i) => (i.name + ' ' + i.group + ' ' + (i.supplier || '')).toLowerCase().includes(q));
      if (!list.length) return U.mount(table, ui().empty('Nothing here', q ? 'No item matches "' + view.q + '".' : 'No items in this view.'));
      U.mount(
        table,
        list.map((ing) => {
          const st = L.stockStatus(ing);
          const dl = daysLeft(ing);
          const n = L.nextExpiry(ing, t);
          return h(
            'button.row.stock-row',
            { type: 'button', onclick: () => detailSheet(ing) },
            h('div.grow', h('div.t', ing.name), h('div.s', ing.group + (dl != null ? ' · ' + coverText(dl) : ''))),
            h('div.stock-level.hide-phone', ui().level(ing.onHand, Math.max(ing.par, ing.onHand), { state: st, marker: ing.reorder, thin: true, label: ing.name + ' against par' })),
            h('span.amt', { style: { minWidth: '84px' } }, U.fmtQty(ing.onHand, ing.unit)),
            h('span.exp-slot', n && n.state !== 'ok' ? ui().expiryChip(n.days, n.state) : null),
            h('span.st-slot', ui().badge(ui().STOCK_BADGE[st][0], ui().STOCK_BADGE[st][1]))
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
      drawTop();
      drawTable();
    });
    const offs = [M.bus.on('stock', all), M.bus.on('change', all)];
    return () => offs.forEach((f) => f());
  }

  M.views = M.views || {};
  M.views.stock = { title: 'Stock', icon: 'stock', perm: 'orders', mount };
  M.stockView = { receiveSheet, adjustSheet, countSheet, reorderSheet, expiringLots };
})((window.M = window.M || {}));
