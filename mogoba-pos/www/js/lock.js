/* Mogoba POS: first-run setup and the staff sign-in screen. */
(function (M) {
  'use strict';
  const U = M.util;
  const C = M.core;
  const S = M.state;
  const h = U.h;
  const ui = () => M.ui;

  function brand(sub) {
    const clock = h('div.clock');
    const tick = () => {
      if (!document.contains(clock) && clock.dataset.on) return clearInterval(timer);
      clock.dataset.on = '1';
      clock.textContent = new Intl.DateTimeFormat('en-PH', { weekday: 'long', hour: 'numeric', minute: '2-digit' }).format(new Date());
    };
    const timer = setInterval(tick, 15000);
    tick();
    return h(
      'section.lock-brand',
      h('div.hangul', { 'aria-hidden': 'true' }, h('span', '먹'), h('span.r', '어'), h('span', '봐')),
      h('img', { src: M.asset('logo.png'), alt: 'Mogoba Korean Food House logo', width: 88, height: 88 }),
      h('h1', 'Mogoba', h('br'), 'Korean Food House'),
      h('p', sub || 'Register, kitchen, stock and reports. Works with or without internet.'),
      clock
    );
  }

  /* ---------- first run ---------- */
  function mountSetup(el, onDone) {
    const card = h('div.lock-card.glass');
    U.mount(el, h('div.lock', brand('Set up this tablet as Mogoba’s register. Data stays on the device and works offline.'), h('section.lock-panel', card)));

    function choose() {
      U.mount(
        card,
        h('h2', 'Set up the register'),
        h('button.choice', { type: 'button', onclick: () => run(true) }, ui().icon('sparkle', 26), h('div', h('b', 'Explore with sample data'), h('span', 'Two weeks of made-up sales, stock and shifts. Remove it from Settings when ready.'))),
        h('button.choice', { type: 'button', onclick: owner }, ui().icon('pos', 26), h('div', h('b', 'Start Mogoba for real'), h('span', 'Mogoba’s full menu and recipes, stock at zero, and your own owner PIN.'))),
        h('p.hint', 'You can switch later in Settings.')
      );
    }
    function owner() {
      const name = h('input.input', { placeholder: 'Your name', 'aria-label': 'Owner name', maxlength: 30, autocomplete: 'off' });
      const pin = h('input.input', { type: 'password', inputmode: 'numeric', maxlength: 4, placeholder: '4-digit PIN', 'aria-label': 'PIN', autocomplete: 'new-password' });
      const pin2 = h('input.input', { type: 'password', inputmode: 'numeric', maxlength: 4, placeholder: 'Repeat PIN', 'aria-label': 'Repeat PIN', autocomplete: 'new-password' });
      U.mount(
        card,
        h('div.row-gap', h('button.icon-btn', { type: 'button', 'aria-label': 'Back', onclick: choose }, ui().icon('left')), h('h2', 'Owner account')),
        h('p.lead', { style: { margin: 0 } }, 'The owner PIN unlocks prices, staff, reports and backups. Add staff later in Settings.'),
        ui().field('Name', name),
        h('div.form-grid', ui().field('PIN', pin), ui().field('Repeat PIN', pin2)),
        h(
          'button.btn.primary.lg.block',
          {
            type: 'button',
            onclick: () => {
              if (!name.value.trim()) return ui().toast('Enter your name.', 'err');
              if (!/^\d{4}$/.test(pin.value)) return ui().toast('The PIN must be 4 digits.', 'err');
              if (pin.value !== pin2.value) return ui().toast('The two PINs do not match.', 'err');
              run(false, { name: name.value.trim(), pin: pin.value });
            },
          },
          'Create register'
        )
      );
      setTimeout(() => name.focus(), 50);
    }
    async function run(demo, ownerInfo) {
      const bar = h('i');
      U.mount(card, h('h2', demo ? 'Cooking up two weeks of sales…' : 'Setting up…'), h('div.progress', bar), h('p.hint', 'This takes a few seconds.'));
      try {
        await C.setup({ demo, owner: ownerInfo, onProgress: (p) => (bar.style.width = Math.round(p * 100) + '%') });
        bar.style.width = '100%';
        onDone();
      } catch (e) {
        console.error(e);
        ui().toast('Setup failed: ' + e.message, 'err', 6000);
        choose();
      }
    }
    choose();
  }

  /* ---------- sign in ---------- */
  function mountLock(el, onDone) {
    const card = h('div.lock-card.glass');
    U.mount(el, h('div.lock', brand(), h('section.lock-panel', card)));
    const users = S.users.filter((u) => u.active !== false);

    function pick() {
      U.mount(
        card,
        h('h2', 'Who’s on the register?'),
        h(
          'div.users',
          users.map((u) =>
            h(
              'button.user-card',
              { type: 'button', onclick: () => pin(u) },
              h('span.avatar.lg', { class: 'r-' + u.role }, u.name.slice(0, 1).toUpperCase()),
              h('span.nm', u.name),
              h('span.rl', C.ROLES[u.role])
            )
          )
        ),
        S.meta.demo ? h('p.hint', 'Sample PINs: Owner 1234 · Mark, manager 2580 · Joy, cashier 0000') : null
      );
    }
    function pin(u) {
      const err = h('p.err-text', { role: 'alert' });
      U.mount(
        card,
        h('div.row-gap', h('button.icon-btn', { type: 'button', 'aria-label': 'Back to staff list', onclick: pick }, ui().icon('left')), h('span.avatar', { class: 'r-' + u.role }, u.name.slice(0, 1).toUpperCase()), h('h2.grow', u.name)),
        h('p.hint', 'Enter your 4-digit PIN'),
        ui().pinPad(async (p) => {
          try {
            await C.login(u.id, p);
            onDone();
            return true;
          } catch (e) {
            err.textContent = e.message;
            return false;
          }
        }),
        err
      );
    }
    if (users.length === 1) pin(users[0]);
    else pick();
  }

  M.lock = { mountSetup, mountLock };
})((window.M = window.M || {}));
