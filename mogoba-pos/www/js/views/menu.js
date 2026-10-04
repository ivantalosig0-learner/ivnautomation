/* Mogoba POS: Menu: prices, options, add-ons, availability and recipes (what each sale uses). */
(function (M) {
  'use strict';
  const U = M.util;
  const L = M.logic;
  const C = M.core;
  const S = M.state;
  const h = U.h;
  const ui = () => M.ui;

  const view = { cat: 'all', q: '' };
  const IMAGES = ['', 'gimbap-dosirak', 'gimbap', 'honeybutter', 'classic', 'spicy', 'prinkle', 'yangnyeom', 'dosirak', 'tteokbokki', 'ramyeon', 'kimchi', 'fishcake', 'suyuk', 'bihon', 'milktea'];

  const unitCost = (rows) => (rows || []).reduce((t, r) => t + (S.ings[r.ing] ? S.ings[r.ing].cost * r.qty : 0), 0);
  function costRange(item) {
    const base = unitCost(item.recipe);
    if (!item.variants || !item.variants.length) return [base, base, item.price];
    const vs = item.variants.map((v) => ({ c: base + unitCost(v.recipe), p: v.price }));
    const worst = vs.reduce((a, b) => (b.p ? b.c / b.p : 0) > (a.p ? a.c / a.p : 0) ? b : a);
    return [Math.min(...vs.map((v) => v.c)), Math.max(...vs.map((v) => v.c)), worst.p, worst.c];
  }

  /* Editable list of {ing, qty} rows. */
  function recipeEditor(rows, onChange) {
    const box = h('div.stack-sm');
    const draw = () => {
      U.mount(
        box,
        rows.map((r, i) => {
          const ing = S.ings[r.ing];
          const sel = h('select.input.sm', { 'aria-label': 'Ingredient' }, h('option', { value: '' }, 'Choose…'));
          const groups = Array.from(new Set(Object.values(S.ings).map((x) => x.group)));
          for (const g of groups) sel.append(h('optgroup', { label: g }, Object.values(S.ings).filter((x) => x.group === g && (x.active !== false || x.id === r.ing)).map((x) => h('option', { value: x.id, selected: x.id === r.ing }, x.name))));
          sel.addEventListener('change', () => {
            r.ing = sel.value;
            draw();
            onChange();
          });
          const q = h('input.input.sm.num', { inputmode: 'decimal', value: r.qty ? String(r.qty) : '', 'aria-label': 'Quantity', placeholder: '0' });
          q.addEventListener('input', () => {
            const v = parseFloat(q.value);
            r.qty = isFinite(v) && v > 0 ? v : 0;
            cost.textContent = ing ? U.peso(Math.round(ing.cost * r.qty)) : '';
            onChange();
          });
          const cost = h('span.muted.num', { style: { minWidth: '64px', textAlign: 'right', fontSize: '13px' } }, ing ? U.peso(Math.round(ing.cost * r.qty)) : '');
          return h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 84px 26px 64px 40px', gap: '6px', alignItems: 'center' } }, sel, q, h('span.muted', { style: { fontSize: '13px' } }, ing ? ing.unit : ''), cost, h('button.icon-btn', { type: 'button', style: { width: '40px', height: '40px' }, 'aria-label': 'Remove ingredient', onclick: () => (rows.splice(i, 1), draw(), onChange()) }, ui().icon('x', 16)));
        }),
        h('button.btn.sm', { type: 'button', style: { alignSelf: 'flex-start' }, onclick: () => (rows.push({ ing: '', qty: 0 }), draw()) }, ui().icon('plus', 16), 'Ingredient')
      );
    };
    draw();
    return box;
  }

  function editor(item) {
    const isNew = !item;
    const d = item ? JSON.parse(JSON.stringify(item)) : { name: '', ko: '', cat: S.cats[0].id, price: 0, img: '', variants: null, variantLabel: 'Size', addons: [], recipe: [], active: true };
    const s = ui().sheet({ title: isNew ? 'New menu item' : d.name, wide: true, icon: 'menu' });
    const costEl = h('div');
    const updCost = () => {
      const [lo, hi, p, c] = costRange(d);
      const price = d.variants && d.variants.length ? p : d.price;
      const cost = d.variants && d.variants.length ? c : lo;
      U.mount(
        costEl,
        h(
          'dl.kv',
          { style: { padding: '14px', borderRadius: '14px', background: 'var(--soft)' } },
          h('dt', 'Ingredient cost per serving'),
          h('dd', lo === hi ? U.peso(Math.round(lo)) : U.peso(Math.round(lo)) + ' to ' + U.peso(Math.round(hi))),
          h('dt', 'Food cost' + (d.variants && d.variants.length ? ' (highest option)' : '')),
          h('dd', { style: { color: price && cost / price > 0.4 ? 'var(--bad)' : 'var(--ok)' } }, price ? U.pct(cost / price) : '-'),
          h('dt', 'Gross margin per serving'),
          h('dd', price ? U.peso(Math.round(price - cost)) : '-')
        )
      );
    };
    const name = h('input.input', { value: d.name, maxlength: 60, 'aria-label': 'Name' });
    name.addEventListener('input', () => (d.name = name.value));
    const ko = h('input.input', { value: d.ko || '', maxlength: 20, 'aria-label': 'Korean name' });
    ko.addEventListener('input', () => (d.ko = ko.value));
    const cat = h('select.input', { 'aria-label': 'Category', onchange: (e) => (d.cat = e.target.value) }, S.cats.map((c) => h('option', { value: c.id, selected: c.id === d.cat }, c.name)));
    const price = h('input.input.num', { inputmode: 'decimal', value: d.price ? U.trim(d.price / 100) : '', 'aria-label': 'Price' });
    price.addEventListener('input', () => {
      d.price = U.toCents(price.value) || 0;
      updCost();
    });
    const img = h('select.input', { 'aria-label': 'Photo', onchange: (e) => (d.img = e.target.value) }, IMAGES.map((x) => h('option', { value: x, selected: (d.img || '') === x }, x ? x.replace(/-/g, ' ') : 'No photo (Korean name tile)')));
    const active = h('label.switch', h('input', { type: 'checkbox', checked: d.active !== false, onchange: (e) => (d.active = e.target.checked) }), h('span.track'), h('span.txt', h('b', 'On the menu'), h('small', 'Turn off to hide it from the register')));
    const variantsBox = h('div.stack');
    const drawVariants = () => {
      if (!d.variants || !d.variants.length) {
        U.mount(variantsBox, h('button.btn.sm', { type: 'button', style: { alignSelf: 'flex-start' }, onclick: () => ((d.variants = [{ id: U.uid().slice(-6).toLowerCase(), name: 'Regular', price: d.price, recipe: [] }]), drawVariants(), updCost()) }, ui().icon('plus', 16), 'Add sizes or flavours'));
        price.disabled = false;
        return;
      }
      price.disabled = true;
      const label = h('select.input.sm', { 'aria-label': 'Option label', style: { maxWidth: '180px' }, onchange: (e) => (d.variantLabel = e.target.value) }, ['Size', 'Flavour', 'Choose'].map((x) => h('option', { value: x, selected: d.variantLabel === x }, x)));
      U.mount(
        variantsBox,
        h('div.row-gap', h('b', 'Options called'), label),
        d.variants.map((v, i) => {
          const vn = h('input.input.sm', { value: v.name, 'aria-label': 'Option name', maxlength: 30 });
          vn.addEventListener('input', () => (v.name = vn.value));
          const vp = h('input.input.sm.num', { value: U.trim(v.price / 100), inputmode: 'decimal', 'aria-label': 'Option price', style: { maxWidth: '110px' } });
          vp.addEventListener('input', () => {
            v.price = U.toCents(vp.value) || 0;
            updCost();
          });
          v.recipe = v.recipe || [];
          return h(
            'div.stack-sm',
            { style: { padding: '12px', borderRadius: '14px', border: '1px solid var(--line)' } },
            h('div.row-gap', vn, h('span.muted', '₱'), vp, h('button.icon-btn', { type: 'button', 'aria-label': 'Remove option', onclick: () => (d.variants.splice(i, 1), d.variants.length || (d.variants = null), drawVariants(), updCost()) }, ui().icon('trash', 18))),
            h('small.muted', 'Extra ingredients for ' + (v.name || 'this option') + ' (on top of the base recipe)'),
            recipeEditor(v.recipe, updCost)
          );
        }),
        h('button.btn.sm', { type: 'button', style: { alignSelf: 'flex-start' }, onclick: () => (d.variants.push({ id: U.uid().slice(-6).toLowerCase(), name: '', price: d.variants[0].price, recipe: [] }), drawVariants()) }, ui().icon('plus', 16), 'Option')
      );
    };
    drawVariants();
    const addons = h(
      'div.chips',
      Object.values(S.mods).map((g) =>
        h(
          'button.chip',
          {
            type: 'button',
            'aria-pressed': String((d.addons || []).includes(g.id)),
            onclick: (e) => {
              d.addons = (d.addons || []).includes(g.id) ? d.addons.filter((x) => x !== g.id) : (d.addons || []).concat([g.id]);
              e.currentTarget.setAttribute('aria-pressed', String(d.addons.includes(g.id)));
            },
          },
          g.name + ' (' + g.options.map((o) => o.name).join(', ') + ')'
        )
      )
    );
    d.recipe = d.recipe || [];
    s.setBody(
      h(
        'div.stack',
        h('div.split.even', h('div.form-grid', h('label.field.span2', h('span', 'Name'), name), ui().field('Korean name', ko), ui().field('Category', cat), ui().field('Price (₱)', price, 'Set per option when it has sizes or flavours'), ui().field('Photo', img)), h('div.stack', active, costEl)),
        h('div.group-label', 'Base recipe, used by every sale'),
        recipeEditor(d.recipe, updCost),
        h('p.muted', { style: { fontSize: '12.5px' } }, 'Quantities are per serving in each ingredient’s base unit (g, ml or pc). Every sale deducts them from Stock, so keep them close to what the kitchen really portions.'),
        h('div.group-label', 'Sizes / flavours'),
        variantsBox,
        h('div.group-label', 'Add-ons offered'),
        addons
      )
    );
    updCost();
    s.setFoot(
      h(
        'button.btn.primary.lg.block',
        {
          type: 'button',
          onclick: async () => {
            if (!d.name.trim()) return ui().toast('Enter a name.', 'err');
            const clean = (rows) => (rows || []).filter((r) => r.ing && r.qty > 0);
            d.recipe = clean(d.recipe);
            if (d.variants) {
              if (d.variants.some((v) => !v.name.trim())) return ui().toast('Name every option.', 'err');
              if (d.variants.some((v) => !(v.price >= 0))) return ui().toast('Check option prices.', 'err');
              for (const v of d.variants) v.recipe = clean(v.recipe);
              d.price = Math.min(...d.variants.map((v) => v.price));
            } else if (!(d.price > 0)) return ui().toast('Enter a price.', 'err');
            d.name = d.name.trim();
            try {
              await C.saveItem(d);
              s.close();
              ui().toast('Saved ' + d.name + '.', 'ok');
            } catch (e) {
              ui().toast(e.message, 'err');
            }
          },
        },
        'Save item'
      )
    );
  }

  function mount(el) {
    const owner = C.can('*') || (S.user && S.user.role === 'owner');
    const head = h('div.page-head', h('h2', 'Menu'), owner ? h('button.btn.primary', { type: 'button', onclick: () => editor(null) }, ui().icon('plus', 20), 'New item') : null);
    const chips = h('div.tabs');
    const search = h('input.input', { type: 'search', placeholder: 'Search the menu', 'aria-label': 'Search the menu', value: view.q });
    const list = h('div.list');
    U.mount(el, h('div.page', head, h('div.panel.glass.stack', h('div.search', ui().icon('search', 20), search), chips, list)));
    search.addEventListener('input', () => ((view.q = search.value), drawList()));
    const drawChips = () => U.mount(chips, [{ id: 'all', name: 'All' }].concat(S.cats).map((c) => h('button.chip', { type: 'button', 'aria-pressed': String(view.cat === c.id), onclick: () => ((view.cat = c.id), drawChips(), drawList()) }, c.name)));
    function drawList() {
      const q = view.q.trim().toLowerCase();
      let items = Object.values(S.items).sort((a, b) => (S.cats.findIndex((c) => c.id === a.cat) - S.cats.findIndex((c) => c.id === b.cat)) || a.sort - b.sort);
      if (view.cat !== 'all') items = items.filter((i) => i.cat === view.cat);
      if (q) items = items.filter((i) => (i.name + ' ' + (i.ko || '')).toLowerCase().includes(q));
      if (!items.length) return U.mount(list, ui().empty('No items', 'Nothing in this category yet.'));
      U.mount(
        list,
        items.map((it) => {
          const [lo, hi] = M.seed.priceRange(it);
          const [clo, chi, wp, wc] = costRange(it);
          const fc = it.variants && it.variants.length ? (wp ? wc / wp : 0) : it.price ? clo / it.price : 0;
          const hasRecipe = (it.recipe || []).length || (it.variants || []).some((v) => (v.recipe || []).length);
          const cat = S.cats.find((c) => c.id === it.cat) || { tone: 'gold' };
          return h(
            'div.row',
            h(
              'button.grow',
              { type: 'button', style: { textAlign: 'left', display: 'flex', gap: '12px', alignItems: 'center' }, disabled: !owner, onclick: () => editor(it) },
              it.img ? h('span', { style: { width: '48px', height: '48px', borderRadius: '12px', flex: 'none', backgroundSize: 'cover', backgroundPosition: 'center', backgroundImage: 'url("' + M.asset('food/' + it.img + '.jpg') + '")' } }) : h('span.tile-mono', { class: 'tone-' + cat.tone, style: { width: '48px', height: '48px', borderRadius: '12px', fontSize: '15px' } }, (it.ko || it.name).slice(0, 2)),
              h('span.grow', h('div.t', it.name, it.active === false ? h('span.badge.muted', { style: { marginLeft: '8px' } }, 'Hidden') : null), h('div.s', (cat.name || '') + ' · ' + (lo === hi ? U.peso(lo, true) : U.peso(lo, true) + ' to ' + U.peso(hi, true)) + (hasRecipe ? ' · food cost ' + U.pct(fc, 0) : '')))
            ),
            hasRecipe ? null : ui().badge('low', 'No recipe'),
            owner
              ? h('label.switch', { title: 'On the menu' }, h('input', { type: 'checkbox', checked: it.active !== false, 'aria-label': it.name + ' on the menu', onchange: async (e) => {
                  await C.saveItem(Object.assign({}, it, { active: e.target.checked }));
                  ui().toast(it.name + (e.target.checked ? ' is back on the menu.' : ' hidden from the register.'));
                } }), h('span.track'))
              : null
          );
        })
      );
    }
    drawChips();
    drawList();
    const offs = [M.bus.on('menu', drawList)];
    return () => offs.forEach((f) => f());
  }

  M.views = M.views || {};
  M.views.menu = { title: 'Menu', icon: 'menu', perm: '*', mount };
})((window.M = window.M || {}));
