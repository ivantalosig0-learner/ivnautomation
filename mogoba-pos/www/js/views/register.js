/* Mogoba POS — Register: menu grid + live ticket. */
(function (M) {
  'use strict';
  const U = M.util;
  const L = M.logic;
  const C = M.core;
  const S = M.state;
  const h = U.h;
  const ui = () => M.ui;

  const view = { cat: null, q: '' };

  function catOf(id) {
    return S.cats.find((c) => c.id === id) || { tone: 'gold', kind: 'food' };
  }

  function tileFor(item, inCart) {
    const cat = catOf(item.cat);
    const n = L.itemAvailability(item, S.ings);
    const [lo, hi] = M.seed.priceRange(item);
    const price = lo === hi ? U.peso(lo, true) : U.peso(lo, true) + '–' + U.trim(hi / 100);
    const pic = item.img
      ? h('div.tile-img', { style: { backgroundImage: 'url("' + M.asset('food/' + item.img + '.jpg') + '")' } })
      : h('div.tile-mono', { class: (item.ko || '').length > 3 ? 'small' : '' }, item.ko || item.name.slice(0, 2));
    const badges = h('div.badges');
    if (n === 0) badges.appendChild(ui().badge('out', 'Sold out'));
    else if (n <= 5) badges.appendChild(ui().badge('low', n + ' left'));
    else if (item.badge) badges.appendChild(ui().badge('solid', item.badge));
    return h(
      'button.tile',
      { type: 'button', class: 'tone-' + cat.tone + (n === 0 ? ' out' : ''), 'aria-label': item.name + ', ' + price + (inCart ? ', ' + inCart + ' in order' : '') + (n === 0 ? ', sold out' : ''), onclick: () => tapItem(item) },
      pic,
      badges,
      inCart ? h('span.incart', String(inCart)) : null,
      h('div.tile-body', h('div.tile-name', item.name), h('div.tile-foot', h('span.tile-price', price), item.variants ? h('span.opts-n', item.variants.length + (item.variantLabel === 'Size' ? ' sizes' : ' options')) : null))
    );
  }

  function tapItem(item) {
    const n = L.itemAvailability(item, S.ings);
    if (n === 0 && S.settings.sales.blockOutOfStock) {
      ui().toast(item.name + ' is out of stock. Receive or count stock to sell it.', 'err');
      return;
    }
    if (item.variants || (item.addons || []).length) return M.checkout.itemSheet(item);
    C.addLine(item, null, [], 1, '');
    if (navigator.vibrate) navigator.vibrate(8);
    if (n === 0) ui().toast('Heads up: stock shows no ' + item.name + ' left.', 'err');
  }

  function cartCounts() {
    const m = {};
    for (const l of S.cart.lines) if (l.itemId) m[l.itemId] = (m[l.itemId] || 0) + l.qty;
    return m;
  }

  function visibleItems() {
    const all = Object.values(S.items).filter((i) => i.active !== false);
    const q = view.q.trim().toLowerCase();
    if (q) return all.filter((i) => (i.name + ' ' + (i.ko || '') + ' ' + catOf(i.cat).name).toLowerCase().includes(q)).sort((a, b) => a.sort - b.sort);
    if (view.cat === 'popular') return (S.popular || []).map((id) => S.items[id]).filter((i) => i && i.active !== false);
    return all.filter((i) => i.cat === view.cat).sort((a, b) => a.sort - b.sort);
  }

  /* ---------- ticket (shared by the side panel and the phone sheet) ---------- */
  function renderTicket(box, opts) {
    const c = S.cart;
    const t = C.cartTotals();
    const o = opts || {};

    const typeSeg = ui().seg(
      [['dine', 'Dine-in', 'dine'], ['take', 'Take-out', 'take'], ['delivery', 'Delivery', 'delivery']],
      c.type,
      (v) => C.setCart({ type: v }),
      'Order type'
    );
    const metaInput = (ph, key, mode) => {
      const inp = h('input.input', { value: c[key] || '', placeholder: ph, 'aria-label': ph, maxlength: 40, inputmode: mode || 'text', enterkeyhint: 'done' });
      inp.addEventListener('input', () => {
        S.cart[key] = inp.value;
        S.cart.updatedAt = Date.now();
        C.persistCart();
      });
      return inp;
    };
    const meta = h('div.ticket-meta');
    if (c.type === 'dine') meta.append(metaInput('Table no.', 'table', 'numeric'), metaInput('Name (optional)', 'customer'));
    else if (c.type === 'take') meta.append(metaInput('Customer name (optional)', 'customer'));
    else {
      const ch = h('select.input', { 'aria-label': 'Delivery channel', onchange: (e) => C.setCart({ channel: e.target.value }) }, [['own', 'Own rider'], ['foodpanda', 'Foodpanda'], ['grab', 'GrabFood']].map(([k, n]) => h('option', { value: k, selected: (c.channel || 'own') === k }, n)));
      meta.append(ch, metaInput('Name / phone', 'customer'));
    }

    const openCount = S.open.filter((x) => x.id !== c.id).length;
    const head = h(
      'div.ticket-head',
      h(
        'div.ticket-title',
        h('h2', c.held ? (c.table ? 'Table ' + c.table : c.customer || 'Open ticket') : 'New order'),
        h('button.btn.sm', { type: 'button', onclick: () => M.checkout.openTickets(), 'aria-label': 'Open tickets, ' + openCount + ' waiting' }, ui().icon('clock', 18), 'Tickets', openCount ? h('span.badge.solid', String(openCount)) : null),
        h('button.icon-btn', { type: 'button', 'aria-label': 'More order actions', onclick: () => M.checkout.orderMenu() }, ui().icon('more'))
      ),
      typeSeg,
      meta
    );

    const lines = h('div.ticket-lines', { role: 'list', 'aria-label': 'Items in this order' });
    if (!c.lines.length) {
      lines.append(h('div.ticket-empty', h('div.k', '먹어봐'), h('b', 'No items yet'), h('span', 'Tap a dish on the menu to add it.')));
    } else {
      for (const l of c.lines) {
        const sub = [];
        if (l.variantName) sub.push(l.variantName);
        for (const m of l.mods) sub.push('+ ' + m.name);
        const gross = L.lineGross(l);
        const net = L.lineNet(l);
        lines.append(
          h(
            'button.tline',
            { type: 'button', role: 'listitem', onclick: () => M.checkout.lineSheet(l.id) },
            h('div.tline-name', h('span.q', l.qty + '×'), h('span', l.name)),
            h('div.tline-amt', net !== gross ? h('s', U.peso(gross)) : null, U.peso(net)),
            sub.length || l.note || l.sent || l.disc
              ? h('div.tline-sub', sub.join(' · '), l.note ? h('div.note', '“' + l.note + '”') : null, l.disc ? h('div', 'Discount ' + (l.disc.kind === 'pct' ? l.disc.value + '%' : U.peso(l.disc.value)) + (l.disc.reason ? ' · ' + l.disc.reason : '')) : null, l.sent ? h('div.sent', 'Sent to kitchen') : null)
              : null
          )
        );
      }
    }

    const foot = h('div.ticket-foot');
    if (c.disc) {
      foot.append(
        h(
          'div.disc-chip',
          ui().icon('tag', 18),
          h('span.grow', C.discLabel(c.disc)),
          h('span.num', '−' + U.peso(t.orderDisc + t.vatRemoved)),
          h('button.icon-btn', { type: 'button', style: { width: '32px', height: '32px' }, 'aria-label': 'Remove discount', onclick: () => C.setCart({ disc: null }) }, ui().icon('x', 16))
        )
      );
    }
    if (t.discountTotal) {
      foot.append(h('div.sumrow', h('span', 'Subtotal'), h('span', U.peso(t.gross))));
      foot.append(h('div.sumrow.disc', h('span', 'Discounts'), h('span', '−' + U.peso(t.discountTotal))));
    }
    if (S.settings.business.vat && t.total) foot.append(h('div.sumrow', h('span', 'incl. VAT 12%'), h('span', U.peso(t.vat))));
    foot.append(h('div.sumrow.total', h('span.lbl', t.items + (t.items === 1 ? ' item' : ' items')), h('span.val', U.peso(t.total))));
    foot.append(
      h(
        'div.ticket-actions',
        h('button.btn.lg', { type: 'button', disabled: !c.lines.length, onclick: () => M.checkout.hold(), 'aria-label': 'Hold ticket' }, ui().icon('pause', 20), h('span.hide-phone.lbl-wide', 'Hold')),
        h('button.btn.lg', { type: 'button', disabled: !c.lines.length, onclick: () => M.checkout.discountSheet(), 'aria-label': 'Discount' }, ui().icon('tag', 20)),
        h('button.btn.primary.charge', { type: 'button', disabled: !c.lines.length, onclick: () => M.checkout.pay(o.sheet) }, 'Charge ', h('span.amt', U.peso(t.total)))
      )
    );
    U.mount(box, head, lines, foot);
  }

  function mount(el) {
    if (!view.cat) view.cat = S.popular && S.popular.length ? 'popular' : S.cats[0] && S.cats[0].id;
    const search = h('input.input', { type: 'search', placeholder: 'Search the menu', 'aria-label': 'Search the menu', value: view.q, enterkeyhint: 'search' });
    const cats = h('div.cats', { role: 'toolbar', 'aria-label': 'Menu categories' });
    const grid = h('div.grid', { 'aria-label': 'Menu items' });
    const ticket = h('section.ticket.glass', { 'aria-label': 'Current order' });
    const cartbar = h('div.cartbar');
    const pane = h('section.menu-pane.glass', h('div.menu-tools', h('div.search', ui().icon('search', 20), search)), cats, grid, cartbar);
    const gate = h('div.gate');
    U.mount(el, h('div.reg', pane, ticket), gate);

    search.addEventListener('input', () => {
      view.q = search.value;
      drawGrid();
    });

    function drawCats() {
      const list = [];
      if (S.popular && S.popular.length) list.push({ id: 'popular', name: 'Popular', ko: '인기', tone: 'red' });
      list.push(...S.cats.filter((c) => Object.values(S.items).some((i) => i.cat === c.id && i.active !== false)));
      U.mount(
        cats,
        list.map((c) =>
          h(
            'button.cat',
            {
              type: 'button',
              class: 'tone-' + c.tone,
              'aria-pressed': String(!view.q && view.cat === c.id),
              onclick: () => {
                view.cat = c.id;
                view.q = '';
                search.value = '';
                drawCats();
                drawGrid();
                grid.scrollTop = 0;
              },
            },
            h('span.ko', c.ko || ''),
            h('span.en', c.name)
          )
        )
      );
    }
    function drawGrid() {
      const counts = cartCounts();
      const items = visibleItems();
      if (!items.length) {
        U.mount(grid, h('div', { style: { gridColumn: '1/-1' } }, ui().empty(view.q ? 'Nothing matches “' + view.q + '”' : 'No items here yet', view.q ? 'Try the Korean or English name.' : 'Add dishes in Menu.')));
        return;
      }
      U.mount(grid, items.map((i) => tileFor(i, counts[i.id])));
      grid.append(h('button.tile.custom', { type: 'button', onclick: () => M.checkout.customItem() }, ui().icon('plus', 26), 'Custom item'));
    }
    function drawCartbar() {
      const t = C.cartTotals();
      U.mount(cartbar, S.cart.lines.length ? h('button.btn.primary', { type: 'button', onclick: () => M.checkout.ticketSheet() }, h('span', t.items + (t.items === 1 ? ' item' : ' items') + ' · View order'), h('span.num', U.peso(t.total))) : null);
    }
    function drawGate() {
      if (S.shift) {
        gate.hidden = true;
        return;
      }
      gate.hidden = false;
      U.mount(
        gate,
        h(
          'div.gate-card.glass',
          h('div.empty-mark', '먹어봐'),
          h('h2', 'Open the shift to start selling'),
          h('p.lead', { style: { margin: 0 } }, 'Count the cash in the drawer first. Every sale, refund and pay-out is tracked against it until you close the shift.'),
          h('button.btn.primary.lg.block', { type: 'button', onclick: () => M.drawerView.openShiftFlow() }, ui().icon('drawer'), 'Open shift')
        )
      );
    }
    const drawTicket = () => {
      renderTicket(ticket);
      drawCartbar();
    };
    drawCats();
    drawGrid();
    drawTicket();
    drawGate();
    const offs = [
      M.bus.on('cart', () => {
        drawTicket();
        drawGrid();
      }),
      M.bus.on('change', () => {
        drawTicket();
        drawGrid();
        drawGate();
      }),
      M.bus.on('stock', drawGrid),
      M.bus.on('menu', () => {
        drawCats();
        drawGrid();
      }),
      M.bus.on('settings', drawTicket),
    ];
    return () => offs.forEach((f) => f());
  }

  M.views = M.views || {};
  M.views.register = { title: 'Register', icon: 'pos', perm: 'sell', mount };
  M.register = { renderTicket };
})((window.M = window.M || {}));
