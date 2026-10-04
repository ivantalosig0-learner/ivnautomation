/* Mogoba POS: order-taking flows: item options, line edits, discounts, payment, tickets. */
(function (M) {
  'use strict';
  const U = M.util;
  const L = M.logic;
  const C = M.core;
  const S = M.state;
  const h = U.h;
  const ui = () => M.ui;

  const catOf = (id) => S.cats.find((c) => c.id === id) || { tone: 'gold', kind: 'food' };

  /* ---------- item options ---------- */
  function itemSheet(item) {
    const cat = catOf(item.cat);
    const fast = !!item.variants && !(item.addons || []).length;
    let variant = null;
    let qty = 1;
    const mods = new Map();
    const notes = new Set();
    let other = '';
    const s = ui().sheet({ title: item.name, cls: (item.addons || []).length ? 'medium' : '' });
    const addBtn = h('button.btn.primary.lg.block', { type: 'button', onclick: () => add() });

    const unit = () => (variant ? variant.price : item.price) + Array.from(mods.values()).reduce((t, m) => t + m.price, 0);
    function add() {
      if (item.variants && !variant) {
        ui().toast('Pick a ' + (item.variantLabel || 'option').toLowerCase() + ' first.', 'err');
        return;
      }
      if (variant && S.settings.sales.blockOutOfStock && L.makeable(item, variant.id, S.ings) === 0) {
        ui().toast(variant.name + ' is out of stock.', 'err');
        return;
      }
      const note = Array.from(notes).concat(other.trim() ? [other.trim()] : []).join(', ');
      C.addLine(item, variant, Array.from(mods.values()), qty, note);
      if (navigator.vibrate) navigator.vibrate(8);
      s.close();
    }
    function draw() {
      const hero = h(
        'div.item-hero',
        { class: 'tone-' + cat.tone },
        item.img ? h('div.pic', { style: { backgroundImage: 'url("' + M.asset('food/' + item.img + '.jpg') + '")' } }) : h('div.pic.mono', item.ko ? item.ko.slice(0, 2) : item.name.slice(0, 2)),
        h('div', item.ko ? h('div.ko', item.ko) : null, h('div.nm', item.name), h('div.muted', item.unitNote || (item.variants ? (item.variantLabel === 'Size' ? 'Small · Medium · Large' : item.variants.length + ' options') : U.peso(item.price))))
      );
      const parts = [hero];
      if (item.variants) {
        parts.push(h('div.group-label', item.variantLabel || 'Options', fast ? h('span.badge.muted', 'tap to add') : null));
        parts.push(
          h(
            'div.opts',
            item.variants.map((v) => {
              const n = L.makeable(item, v.id, S.ings);
              return h(
                'button.opt',
                {
                  type: 'button',
                  class: n === 0 ? 'sold' : '',
                  'aria-pressed': String(variant === v),
                  onclick: () => {
                    variant = v;
                    if (fast) return add();
                    draw();
                  },
                },
                h('span.n', v.name),
                h('span.p', U.peso(v.price, true)),
                n === 0 ? h('span.left', 'Sold out') : n <= 5 ? h('span.left', n + ' left') : null
              );
            })
          )
        );
      }
      for (const gid of item.addons || []) {
        const g = S.mods[gid];
        if (!g) continue;
        parts.push(h('div.group-label', g.name));
        parts.push(
          h(
            'div.opts',
            g.options.map((o) => {
              const k = g.id + ':' + o.id;
              return h(
                'button.opt',
                {
                  type: 'button',
                  'aria-pressed': String(mods.has(k)),
                  onclick: () => {
                    if (mods.has(k)) mods.delete(k);
                    else mods.set(k, { gid: g.id, oid: o.id, name: o.name, price: o.price });
                    draw();
                  },
                },
                h('span.n', o.name),
                h('span.p', '+' + U.peso(o.price, true))
              );
            })
          )
        );
      }
      if (!fast) {
        parts.push(h('div.group-label', 'Notes for the kitchen'));
        parts.push(
          h(
            'div.chips',
            (M.seed.NOTES[cat.kind] || M.seed.NOTES.food).map((n) =>
              h(
                'button.chip',
                {
                  type: 'button',
                  'aria-pressed': String(notes.has(n)),
                  onclick: (e) => {
                    if (notes.has(n)) notes.delete(n);
                    else notes.add(n);
                    e.currentTarget.setAttribute('aria-pressed', String(notes.has(n)));
                  },
                },
                n
              )
            )
          )
        );
        const otherIn = h('input.input', { placeholder: 'Other note', 'aria-label': 'Other note', value: other, maxlength: 80, style: { marginTop: '8px' } });
        otherIn.addEventListener('input', () => (other = otherIn.value));
        parts.push(otherIn);
        parts.push(
          h(
            'div.row-gap',
            { style: { marginTop: '16px', justifyContent: 'space-between' } },
            h('b', 'Quantity'),
            ui().stepper(qty, (v) => {
              qty = v;
              addBtn.lastChild.textContent = U.peso(unit() * qty);
            }, { min: 1 })
          )
        );
      } else {
        parts.push(h('p.hint', { style: { marginTop: '14px', textAlign: 'left' } }, 'Need “less sugar” or “no ice”? Tap the drink in the order to add a note.'));
      }
      s.setBody(...parts);
      U.mount(addBtn, 'Add to order · ', h('span.num', U.peso(unit() * qty)));
      addBtn.disabled = !!item.variants && !variant;
      s.setFoot(fast ? null : addBtn);
    }
    draw();
  }

  /* ---------- reason picker for taking back things the kitchen started ---------- */
  function askVoidReason(title, withWaste, okLabel, lead) {
    return new Promise((res) => {
      let done = false;
      let reason = '';
      let wasted = true;
      const s = ui().sheet({ title, cls: 'narrow', onClose: () => !done && res(null) });
      const inp = h('input.input', { placeholder: 'Reason', 'aria-label': 'Reason', maxlength: 80 });
      inp.addEventListener('input', () => (reason = inp.value));
      const reasons = ['Customer changed their mind', 'Entered by mistake', 'Kitchen mistake', 'Took too long'];
      s.setBody(
        h('p.lead', lead || 'This item was already sent to the kitchen. The removal is logged with your name.'),
        h('div.chips', reasons.map((r) => h('button.chip', { type: 'button', onclick: () => ((inp.value = r), (reason = r)) }, r))),
        h('div', { style: { marginTop: '10px' } }, inp),
        withWaste
          ? h('div', { style: { marginTop: '14px' } }, h('div.group-label', 'Was it already prepared?'), ui().seg([['yes', 'Yes, count as waste'], ['no', 'No, nothing used']], 'yes', (v) => (wasted = v === 'yes'), 'Was it prepared'))
          : null
      );
      s.setFoot(
        h(
          'button.btn.danger-solid.lg.block',
          {
            type: 'button',
            onclick: () => {
              if (!reason.trim()) {
                inp.focus();
                ui().toast('Pick or type a reason.', 'err');
                return;
              }
              done = true;
              res({ reason: reason.trim(), wasted });
              s.close();
            },
          },
          okLabel || 'Remove item'
        )
      );
    });
  }

  /* ---------- line editor ---------- */
  function lineSheet(lineId) {
    const l = S.cart.lines.find((x) => x.id === lineId);
    if (!l) return;
    const cat = catOf(l.cat);
    let qty = l.qty;
    let disc = l.disc ? Object.assign({}, l.disc) : null;
    const chipsList = M.seed.NOTES[cat.kind] || M.seed.NOTES.food;
    const notes = new Set();
    let other = '';
    for (const part of (l.note || '').split(', ').filter(Boolean)) {
      if (chipsList.includes(part)) notes.add(part);
      else other = other ? other + ', ' + part : part;
    }
    const s = ui().sheet({ title: l.name });
    const discRow = h('div.chips');
    const drawDisc = () =>
      U.mount(
        discRow,
        [[null, 'None'], [10, '10%'], [20, '20%'], [50, '50%'], [100, 'Free']].map(([v, t]) =>
          h(
            'button.chip',
            {
              type: 'button',
              'aria-pressed': String(v === null ? !disc : !!disc && disc.kind === 'pct' && disc.value === v),
              onclick: () => {
                disc = v === null ? null : { kind: 'pct', value: v, reason: v === 100 ? 'On the house' : 'Item discount' };
                drawDisc();
              },
            },
            t
          )
        )
      );
    drawDisc();
    const otherIn = h('input.input', { placeholder: 'Other note', 'aria-label': 'Other note', value: other, maxlength: 80, style: { marginTop: '8px' } });
    otherIn.addEventListener('input', () => (other = otherIn.value));
    const sub = [l.variantName].concat(l.mods.map((m) => '+ ' + m.name)).filter(Boolean).join(' · ');
    s.setBody(
      h('p.lead', (sub ? sub + ' · ' : '') + U.peso(l.unit) + ' each' + (l.sent ? ' · sent to kitchen' : '')),
      h('div.row-gap', { style: { justifyContent: 'space-between' } }, h('b', 'Quantity'), ui().stepper(qty, (v) => (qty = v), { min: 0, trash: true })),
      h('div.group-label', 'Notes for the kitchen'),
      h(
        'div.chips',
        chipsList.map((n) =>
          h(
            'button.chip',
            {
              type: 'button',
              'aria-pressed': String(notes.has(n)),
              onclick: (e) => {
                if (notes.has(n)) notes.delete(n);
                else notes.add(n);
                e.currentTarget.setAttribute('aria-pressed', String(notes.has(n)));
              },
            },
            n
          )
        )
      ),
      otherIn,
      h('div.group-label', 'Item discount', !C.can('discount') ? h('span.badge.muted', 'needs manager') : null),
      discRow
    );
    const save = async (removeAll) => {
      const target = removeAll ? 0 : qty;
      const discChanged = JSON.stringify(disc && { k: disc.kind, v: disc.value }) !== JSON.stringify(l.disc && { k: l.disc.kind, v: l.disc.value });
      if (discChanged && disc) {
        const ap = await ui().approve('discount', 'Approve discount', 'Item discounts need a manager or the owner.');
        if (!ap) return;
        disc.approver = { id: ap.id, name: ap.name };
      }
      if (l.sent && target < l.qty) {
        const ap = await ui().approve('void', 'Approve removal', 'Removing food the kitchen already started needs a manager or the owner.');
        if (!ap) return;
        const why = await askVoidReason('Why remove it?', true);
        if (!why) return;
        try {
          await C.removeSent(l.id, l.qty - target, ap, why.reason, why.wasted);
        } catch (e) {
          ui().toast(e.message, 'err');
          return;
        }
      } else if (l.sent && target > l.qty) {
        C.addMore(l.id, target - l.qty);
      } else {
        C.setQty(l.id, target);
      }
      if (target > 0 && S.cart.lines.includes(l)) {
        const note = Array.from(notes).concat(other.trim() ? [other.trim()] : []).join(', ');
        C.patchLine(l.id, { note, disc });
      }
      s.close();
    };
    s.setFoot(h('button.btn.danger.lg', { type: 'button', onclick: () => save(true) }, ui().icon('trash', 20), 'Remove'), h('button.btn.primary.lg', { type: 'button', onclick: () => save(false) }, 'Save'));
  }

  /* ---------- discounts ---------- */
  function discountSheet() {
    const c = S.cart;
    const vat = !!S.settings.business.vat;
    let tab = c.disc ? (c.disc.kind === 'scpwd' ? 'sc' : c.disc.kind) : 'sc';
    const sc = c.disc && c.disc.kind === 'scpwd' ? JSON.parse(JSON.stringify(c.disc)) : { kind: 'scpwd', count: 1, diners: 1, people: [] };
    let pct = c.disc && c.disc.kind === 'pct' ? c.disc.value : 10;
    let amt = c.disc && c.disc.kind === 'amt' ? c.disc.value : 0;
    let reason = c.disc && c.disc.kind !== 'scpwd' ? c.disc.reason || '' : '';
    const s = ui().sheet({ title: 'Discount', icon: 'tag' });

    const preview = (d) => {
      const t = L.totals({ lines: c.lines, disc: d }, { vat });
      return h(
        'dl.kv',
        { style: { marginTop: '16px', padding: '14px', borderRadius: '14px', background: 'var(--soft)' } },
        h('dt', 'Order subtotal'),
        h('dd', U.peso(t.subtotal)),
        d && d.kind === 'scpwd' ? [h('dt', 'Eligible share (' + Math.min(d.count, d.diners) + ' of ' + d.diners + ')'), h('dd', U.peso(t.eligible))] : null,
        t.vatRemoved ? [h('dt', 'VAT exempted'), h('dd', '−' + U.peso(t.vatRemoved))] : null,
        h('dt', d && d.kind === 'scpwd' ? '20% discount' : 'Discount'),
        h('dd', '−' + U.peso(t.orderDisc)),
        h('dt', 'New total'),
        h('dd.big', U.peso(t.total))
      );
    };
    const reasonBlock = () => {
      const inp = h('input.input', { value: reason, placeholder: 'Reason (shows on reports)', 'aria-label': 'Reason', maxlength: 60 });
      inp.addEventListener('input', () => (reason = inp.value));
      return h(
        'div',
        h('div.group-label', 'Reason'),
        h('div.chips', ['Suki discount', 'Staff meal', 'Promo', 'Service recovery'].map((r) => h('button.chip', { type: 'button', onclick: () => ((reason = r), (inp.value = r)) }, r))),
        h('div', { style: { marginTop: '8px' } }, inp)
      );
    };

    function draw() {
      const tabs = ui().seg([['sc', 'Senior / PWD'], ['pct', 'Percent'], ['amt', 'Amount']], tab, (v) => {
        tab = v;
        draw();
      }, 'Discount type');
      const parts = [tabs];
      if (tab === 'sc') {
        while (sc.people.length < sc.count) sc.people.push({ type: 'SC', name: '', idNo: '' });
        sc.people.length = sc.count;
        parts.push(
          h('p.lead', { style: { marginTop: '14px' } }, '20% off the eligible share' + (vat ? ', VAT-exempt,' : '') + ' under RA 9994 / RA 10754. Group meals are shared equally across diners. Record each ID. It prints on the receipt for signature.'),
          h(
            'div.form-grid',
            h('div.field', h('span', 'Senior / PWD diners'), ui().stepper(sc.count, (v) => {
              sc.count = v;
              if (sc.diners < v) sc.diners = v;
              draw();
            }, { min: 1, max: 30 })),
            h('div.field', h('span', 'Total diners on this bill'), ui().stepper(sc.diners, (v) => {
              sc.diners = Math.max(v, sc.count);
              draw();
            }, { min: 1, max: 30 }))
          )
        );
        sc.people.forEach((p, i) => {
          const nm = h('input.input', { value: p.name, placeholder: 'Full name', 'aria-label': 'Full name ' + (i + 1), maxlength: 60 });
          nm.addEventListener('input', () => (p.name = nm.value));
          const id = h('input.input', { value: p.idNo, placeholder: 'OSCA / PWD ID no.', 'aria-label': 'ID number ' + (i + 1), maxlength: 30 });
          id.addEventListener('input', () => (p.idNo = id.value));
          parts.push(
            h(
              'div.stack-sm',
              { style: { marginTop: '14px', padding: '12px', borderRadius: '14px', border: '1px solid var(--line)' } },
              h('div.row-gap', h('b.grow', 'Diner ' + (i + 1)), ui().seg([['SC', 'Senior'], ['PWD', 'PWD']], p.type, (v) => (p.type = v), 'ID type')),
              h('div.form-grid', nm, id)
            )
          );
        });
        parts.push(preview(sc));
      } else if (tab === 'pct') {
        const custom = h('input.input.num', { value: String(pct), inputmode: 'decimal', 'aria-label': 'Percent', style: { maxWidth: '120px' } });
        custom.addEventListener('input', () => {
          const v = parseFloat(custom.value);
          pct = isFinite(v) ? Math.max(0, Math.min(100, v)) : 0;
          prev.replaceWith((prev = preview({ kind: 'pct', value: pct })));
        });
        let prev = preview({ kind: 'pct', value: pct });
        parts.push(
          h('div.group-label', 'Percent off the whole order'),
          h('div.row-gap', h('div.chips', [5, 10, 15, 20, 50].map((v) => h('button.chip', { type: 'button', 'aria-pressed': String(pct === v), onclick: () => ((pct = v), draw()) }, v + '%'))), custom, h('span', '%')),
          reasonBlock(),
          prev
        );
      } else {
        let prev = preview({ kind: 'amt', value: amt });
        const kp = ui().keypad((v) => {
          amt = v;
          const next = preview({ kind: 'amt', value: amt });
          if (prev.parentNode) prev.replaceWith(next);
          prev = next;
        }, amt);
        parts.push(h('div.group-label', 'Peso amount off'), kp.el, reasonBlock(), prev);
      }
      s.setBody(...parts);
      s.setFoot(
        c.disc ? h('button.btn.danger', { type: 'button', onclick: () => (C.setCart({ disc: null }), s.close()) }, 'Remove discount') : null,
        h('button.btn.primary.lg', { type: 'button', onclick: apply }, 'Apply discount')
      );
    }
    async function apply() {
      if (tab === 'sc') {
        const bad = sc.people.findIndex((p) => !p.name.trim() || !p.idNo.trim());
        if (bad >= 0) {
          ui().toast('Enter the name and ID number for diner ' + (bad + 1) + '.', 'err');
          return;
        }
        C.setCart({ disc: { kind: 'scpwd', count: sc.count, diners: sc.diners, people: sc.people.map((p) => ({ type: p.type, name: p.name.trim(), idNo: p.idNo.trim() })) } });
        s.close();
        return;
      }
      const value = tab === 'pct' ? pct : amt;
      if (!(value > 0)) {
        ui().toast('Enter a discount above zero.', 'err');
        return;
      }
      if (!reason.trim()) {
        ui().toast('Add a reason for the discount.', 'err');
        return;
      }
      const ap = await ui().approve('discount', 'Approve discount', 'Order discounts need a manager or the owner.');
      if (!ap) return;
      C.setCart({ disc: { kind: tab, value, reason: reason.trim(), approver: { id: ap.id, name: ap.name } } });
      s.close();
    }
    draw();
  }

  /* ---------- payment ---------- */
  function cashSuggestions(r) {
    const out = [r];
    for (const step of [5000, 10000, 50000, 100000]) {
      const v = Math.ceil(r / step) * step;
      if (v > r && !out.includes(v)) out.push(v);
    }
    for (const bill of [20000, 50000, 100000]) if (bill > r && !out.includes(bill)) out.push(bill);
    return out.sort((a, b) => a - b).slice(0, 5);
  }

  function pay(fromPhoneSheet) {
    if (!S.shift) {
      ui().toast('Open the shift before taking payment.', 'err');
      return M.drawerView.openShiftFlow();
    }
    const c = S.cart;
    if (!c.lines.length) return;
    if (S.settings.sales.blockOutOfStock) {
      const use = L.consumption(c.lines, C.menu());
      const short = Object.keys(use).filter((k) => S.ings[k] && S.ings[k].onHand < use[k]);
      if (short.length) {
        ui().toast('Not enough ' + short.map((k) => S.ings[k].name).join(', ') + ' in stock.', 'err');
        return;
      }
    }
    if (c.type === 'dine' && S.settings.sales.tableForDineIn && !c.table) {
      ui().toast('Enter the table number for dine-in.', 'err');
      return;
    }
    if (fromPhoneSheet) ui().closeAll();
    const total = C.cartTotals().total;
    const payments = [];
    let method = 'cash';
    let entered = 0;
    let ref = '';
    let busy = false;
    const s = ui().sheet({ title: 'Charge ' + U.peso(total), wide: true, icon: 'drawer' });

    async function finish() {
      if (busy) return;
      busy = true;
      try {
        const order = await C.completeSale(payments);
        done(order);
      } catch (e) {
        busy = false;
        ui().toast(e.message, 'err');
        draw();
      }
    }
    function tender(m, amount) {
      try {
        payments.push(L.makePayment(total, payments, { method: m, tendered: amount, ref }));
      } catch (e) {
        ui().toast(e.message, 'err');
        return;
      }
      ref = '';
      entered = 0;
      if (L.due(total, payments) <= 0) finish();
      else draw();
    }
    function draw() {
      const remaining = L.due(total, payments);
      const left = h(
        'div.stack',
        h(
          'div.pay-due',
          h('span.lbl', payments.length ? 'Still to pay' : 'Amount due'),
          h('span.big', { class: remaining <= 0 ? 'done' : '' }, U.peso(Math.max(0, remaining))),
          payments.length ? h('span.muted', 'of ' + U.peso(total)) : h('span.muted', C.TYPES[c.type] + (c.table ? ' · Table ' + c.table : '') + ' · ' + C.cartTotals().items + (C.cartTotals().items === 1 ? ' item' : ' items'))
        ),
        payments.length
          ? h(
              'div.pay-list',
              payments.map((p, i) =>
                h(
                  'div.pay-item',
                  h('span.grow', C.PAY[p.method] + (p.ref ? ' · ' + p.ref : '')),
                  h('span', U.peso(p.method === 'cash' ? p.tendered : p.amount)),
                  h('button.icon-btn', { type: 'button', style: { width: '36px', height: '36px' }, 'aria-label': 'Remove payment', onclick: () => (payments.splice(i, 1), draw()) }, ui().icon('x', 16))
                )
              )
            )
          : null,
        total === 0 ? h('button.btn.go.lg.block', { type: 'button', onclick: finish }, 'Complete, no charge') : null
      );
      const methods = h(
        'div.methods',
        { role: 'group', 'aria-label': 'Payment method' },
        ['cash', 'gcash', 'maya', 'card', 'foodpanda', 'grab', 'other'].map((m) =>
          h(
            'button',
            {
              type: 'button',
              'aria-pressed': String(method === m),
              onclick: () => {
                method = m;
                entered = 0;
                ref = '';
                draw();
              },
            },
            C.PAY[m]
          )
        )
      );
      const right = h('div.stack', methods);
      if (remaining > 0) {
        if (method === 'cash') {
          right.append(
            h('div.group-label', { style: { margin: '4px 0 0' } }, 'Cash received'),
            h('div.chips', cashSuggestions(remaining).map((v, i) => h('button.chip', { type: 'button', style: { minHeight: '52px', fontSize: '16px' }, onclick: () => tender('cash', v) }, i === 0 ? 'Exact ' + U.peso(v) : U.peso(v, true))))
          );
          const go = h('button.btn.go.lg.block', { type: 'button', disabled: true, onclick: () => tender('cash', entered) }, 'Type an amount');
          const kp = ui().keypad((v) => {
            entered = v;
            go.disabled = !(entered > 0);
            U.mount(go, entered >= remaining ? 'Take ' + U.peso(entered) + ' · change ' + U.peso(entered - remaining) : entered > 0 ? 'Take ' + U.peso(entered) + ' (part)' : 'Type an amount');
          }, 0, { placeholder: 'Other amount' });
          right.append(kp.el, go);
        } else {
          const needsRef = method === 'gcash' || method === 'maya' || method === 'card';
          const refIn = h('input.input', { placeholder: needsRef ? 'Reference no. (from the customer’s screen)' : 'Reference (optional)', 'aria-label': 'Reference number', inputmode: method === 'card' ? 'text' : 'numeric', maxlength: 40, value: ref });
          refIn.addEventListener('input', () => (ref = refIn.value));
          entered = entered || remaining;
          const go = h('button.btn.go.lg.block', { type: 'button', onclick: () => tender(method, entered) }, 'Record');
          const kp = ui().keypad((v) => {
            entered = v;
            go.disabled = !(entered > 0) || entered > remaining;
            U.mount(go, entered > remaining ? 'More than due. Use cash for change.' : 'Record ' + U.peso(entered) + ' ' + C.PAY[method]);
          }, entered);
          right.append(refIn, kp.el, go);
        }
      }
      s.setBody(h('div.pay', left, right));
    }
    draw();

    function done(order) {
      s.setTitle('Paid · Order #' + order.queue);
      const change = L.changeDue(order.payments);
      const text = M.print.receipt(order);
      const paper = h('pre.paper', { class: S.settings.print.paper === 80 ? 'w80' : 'w58', tabindex: '0', 'aria-label': 'Receipt preview' }, text);
      const newBtn = h('button.btn.primary.lg', { type: 'button', autofocus: true, onclick: () => s.close() }, 'New order');
      s.setBody(
        h(
          'div.done-grid',
          h(
            'div.stack',
            h(
              'div.change-hero',
              change > 0 ? [h('div.lbl', 'Change'), h('div.big', U.peso(change))] : [h('div.lbl', 'Paid in full'), h('div.big', { style: { color: 'var(--ok)' } }, U.peso(order.totals.total))],
              h('div.q', 'Order #' + order.queue),
              h('div.muted', order.no + ' · ' + order.payments.map((p) => C.PAY[p.method]).join(' + '))
            ),
            h(
              'div.stack-sm',
              h('button.btn.lg.block', { type: 'button', onclick: () => M.print.printText(M.print.receipt(order)) }, ui().icon('print', 20), 'Print receipt'),
              h('button.btn.block', { type: 'button', onclick: () => M.print.printText(M.print.kitchen(order)) }, ui().icon('fire', 20), 'Kitchen ticket')
            )
          ),
          paper
        )
      );
      s.setFoot(newBtn);
      requestAnimationFrame(() => newBtn.focus());
      if (S.settings.print.autoReceipt) M.print.printText(text);
      if (S.settings.print.kitchenTicket && order.type !== 'dine') setTimeout(() => M.print.printText(M.print.kitchen(order)), 900);
    }
  }

  /* ---------- tickets ---------- */
  function nameTicket() {
    return new Promise((res) => {
      let done = false;
      const c = S.cart;
      const s = ui().sheet({ title: 'Name this ticket', cls: 'narrow', onClose: () => !done && res(false) });
      const tbl = h('input.input', { value: c.table || '', placeholder: 'Table no.', 'aria-label': 'Table number', inputmode: 'numeric', maxlength: 10 });
      const nm = h('input.input', { value: c.customer || '', placeholder: 'Customer name', 'aria-label': 'Customer name', maxlength: 40 });
      s.setBody(
        h('p.lead', 'So you can find it again when they are ready to pay.'),
        h('div.chips', ['1', '2', '3', '4', '5', '6', '7', '8'].map((n) => h('button.chip', { type: 'button', style: { minWidth: '52px', justifyContent: 'center' }, onclick: () => (tbl.value = n) }, 'T' + n))),
        h('div.form-grid', { style: { marginTop: '12px' } }, tbl, nm)
      );
      s.setFoot(
        h(
          'button.btn.primary.lg.block',
          {
            type: 'button',
            onclick: () => {
              if (!tbl.value.trim() && !nm.value.trim()) {
                ui().toast('Enter a table number or a name.', 'err');
                return;
              }
              C.setCart({ table: tbl.value.trim(), customer: nm.value.trim() });
              done = true;
              res(true);
              s.close();
            },
          },
          'Hold ticket'
        )
      );
    });
  }

  async function hold() {
    const c = S.cart;
    if (!c.lines.length) return;
    if (!c.table && !c.customer && !(await nameTicket())) return;
    try {
      const held = await C.holdCart();
      ui().toast('Held ' + (held.table ? 'Table ' + held.table : held.customer) + '. Find it under Tickets.', 'ok');
      if (S.settings.print.kitchenTicket) M.print.printText(M.print.kitchen(held));
      ui().closeAll();
    } catch (e) {
      ui().toast(e.message, 'err');
    }
  }

  function openTickets() {
    const s = ui().sheet({ title: 'Open tickets', icon: 'clock' });
    const draw = () => {
      const list = S.open.filter((o) => o.id !== S.cart.id);
      if (!list.length) {
        s.setBody(ui().empty('No open tickets', 'Hold a dine-in order to keep it open until the table pays.'));
        return;
      }
      s.setBody(
        h(
          'div.list',
          list.map((o) => {
            const t = L.totals(o, { vat: !!S.settings.business.vat });
            return h(
              'button.row',
              {
                type: 'button',
                onclick: async () => {
                  await C.resume(o.id);
                  s.close();
                  if (matchMedia('(max-width: 760px)').matches) ticketSheet();
                },
              },
              ui().icon(o.type === 'dine' ? 'dine' : o.type === 'take' ? 'take' : 'delivery'),
              h('div.grow', h('div.t', (o.table ? 'Table ' + o.table : '') + (o.table && o.customer ? ' · ' : '') + (o.customer || '')), h('div.s', t.items + ' items · held ' + U.ago(o.heldAt || o.createdAt))),
              h('span.amt', U.peso(t.total)),
              ui().icon('right', 18)
            );
          })
        )
      );
    };
    draw();
  }

  function orderMenu() {
    const c = S.cart;
    const s = ui().sheet({ title: 'Order actions', cls: 'narrow' });
    const act = (icon, title, sub, fn, danger) => h('button.row', { type: 'button', class: danger ? 'danger' : '', onclick: fn }, ui().icon(icon), h('div.grow', h('div.t', { style: danger ? { color: 'var(--bad)' } : null }, title), sub ? h('div.s', sub) : null));
    s.setBody(
      h(
        'div.list',
        act('plus', 'Custom item', 'Off-menu dish or delivery fee', () => (s.close(), customItem())),
        act('fire', 'Print kitchen ticket', 'Send this order to the kitchen printer', () => {
          if (!c.lines.length) return ui().toast('Add items first.', 'err');
          M.print.printText(M.print.kitchen(c));
          s.close();
        }),
        act('trash', c.held ? 'Delete this ticket' : 'Clear order', c.lines.some((l) => l.sent) ? 'Needs a manager: the kitchen has it' : 'Start over', async () => {
          if (!c.lines.length && !c.held) return s.close();
          let ap = null;
          let why = null;
          if (c.lines.some((l) => l.sent)) {
            ap = await ui().approve('void', 'Approve clearing', 'This ticket was sent to the kitchen.');
            if (!ap) return;
            why = await askVoidReason(c.held ? 'Why delete this ticket?' : 'Why clear this order?', true, c.held ? 'Delete ticket' : 'Clear order', 'The kitchen already has it. This is logged with your name.');
            if (!why) return;
          } else if (!(await ui().confirm({ title: 'Clear this order?', message: 'All ' + c.lines.length + ' items will be removed.', ok: 'Clear order', danger: true }))) return;
          await C.clearCart(ap, why);
          s.close();
          ui().closeAll();
        }, true)
      )
    );
  }

  function customItem() {
    let amount = 0;
    const s = ui().sheet({ title: 'Custom item', cls: 'narrow' });
    const nm = h('input.input', { placeholder: 'What is it? e.g. Delivery fee', 'aria-label': 'Item name', maxlength: 40 });
    const kp = ui().keypad((v) => (amount = v), 0);
    s.setBody(h('div.stack', nm, kp.el));
    s.setFoot(
      h(
        'button.btn.primary.lg.block',
        {
          type: 'button',
          onclick: () => {
            if (!nm.value.trim()) return ui().toast('Name the item.', 'err');
            if (!(amount > 0)) return ui().toast('Enter a price.', 'err');
            C.addCustom(nm.value.trim(), amount, 1);
            s.close();
          },
        },
        'Add to order'
      )
    );
    setTimeout(() => nm.focus(), 50);
  }

  function ticketSheet() {
    const s = ui().sheet({ title: 'Current order', cls: 'ticket-sheet full', onClose: () => off() });
    const box = h('section.ticket.as-sheet', { style: { width: '100%' } });
    s.setBody(box);
    s.el.querySelector('.sheet-head').style.display = 'none';
    const draw = () => M.register.renderTicket(box, { sheet: true });
    const close = h('button.btn.ghost.block', { type: 'button', onclick: () => s.close() }, ui().icon('down', 20), 'Back to menu');
    s.setFoot(close);
    draw();
    const off = M.bus.on('cart', draw);
  }

  function receiptSheet(order) {
    const s = ui().sheet({ title: 'Receipt ' + order.no, icon: 'orders' });
    s.setBody(h('pre.paper', { class: S.settings.print.paper === 80 ? 'w80' : 'w58', style: { margin: '0 auto' } }, M.print.receipt(order, { copy: true })));
    s.setFoot(h('button.btn.lg', { type: 'button', onclick: () => M.print.printText(M.print.receipt(order, { copy: true })) }, ui().icon('print', 20), 'Print copy'));
  }

  M.checkout = { itemSheet, lineSheet, discountSheet, pay, hold, openTickets, orderMenu, customItem, ticketSheet, receiptSheet };
})((window.M = window.M || {}));
