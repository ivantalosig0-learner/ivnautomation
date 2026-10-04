/* Mogoba POS — UI kit: icons, sheets, dialogs, PIN approval, keypads, toasts. */
(function (M) {
  'use strict';
  const U = M.util;
  const h = U.h;

  const ICONS = {
    pos: '<rect x="3" y="10" width="18" height="11" rx="2"/><path d="M7 10V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v5M7 14h2M11 14h2M15 14h2M7 17.5h10"/>',
    orders: '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    stock: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8M12 13v8"/>',
    reports: '<path d="M3 21h18M6 17v-6M11 17V5M16 17v-9M21 17v-3"/>',
    drawer: '<rect x="2" y="6" width="20" height="13" rx="2"/><circle cx="12" cy="12.5" r="2.5"/><path d="M6 10h.01M18 15h.01"/>',
    menu: '<path d="M7 3v8a2 2 0 0 0 2 2v8M11 3v8a2 2 0 0 1-2 2M9 3v6"/><path d="M17 21V3c-2 1.5-3 4-3 7.5S15 14 17 14"/>',
    settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    right: '<path d="M9 6l6 6-6 6"/>',
    left: '<path d="M15 6l-6 6 6 6"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    print: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
    tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    cloud: '<path d="M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 9.4 4.3 4.3 0 0 0 7 18z"/>',
    cloudOff: '<path d="M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 9.4 4.3 4.3 0 0 0 7 18z"/><path d="M3 3l18 18"/>',
    device: '<rect x="5" y="2" width="14" height="20" rx="3"/><path d="M11 18h2"/>',
    alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
    refund: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    ban: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    upload: '<path d="M12 21V9M7 14l5-5 5 5M5 3h14"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>',
    truck: '<path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
    count: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9zM9 13l2 2 4-4"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
    more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
    note: '<path d="M4 5h16v11H8l-4 4z"/>',
    dine: '<path d="M4 3v7a2 2 0 0 0 2 2v9M8 3v7a2 2 0 0 1-2 2M6 3v5"/><circle cx="16" cy="12" r="5"/>',
    take: '<path d="M5 8h14l-1 13H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
    delivery: '<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M6 17h6l3-7h3M14 6h3"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/>',
    in: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12l4 4 4-4"/>',
    out: '<circle cx="12" cy="12" r="9"/><path d="M12 16V8M8 12l4-4 4 4"/>',
    fire: '<path d="M12 21c-4 0-7-2.7-7-6.5 0-3.2 2.4-5.4 3.7-7.7.4 1.6 1.4 2.7 2.4 3.2C11 7 12.4 4.6 14.5 3c-.2 2.8 4.5 6 4.5 11.5 0 3.8-3 6.5-7 6.5z"/>',
    sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  };

  function icon(name, size) {
    const s = size || 22;
    const span = document.createElement('span');
    span.className = 'ic';
    span.setAttribute('aria-hidden', 'true');
    span.innerHTML = '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || '') + '</svg>';
    return span;
  }

  /* ---------- toasts ---------- */
  let toastBox = null;
  function toast(msg, kind, ms) {
    if (!toastBox) {
      toastBox = h('div.toasts', { role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(toastBox);
    }
    const el = h('div.toast', { class: kind || '' }, kind === 'err' ? icon('alert', 18) : kind === 'ok' ? icon('check', 18) : null, h('span', msg));
    toastBox.appendChild(el);
    setTimeout(() => {
      el.classList.add('bye');
      setTimeout(() => el.remove(), 250);
    }, ms || (kind === 'err' ? 4200 : 2400));
  }

  /* ---------- sheets ---------- */
  const stack = [];
  function sheet(o) {
    const opts = o || {};
    const titleId = 'sh-' + U.uid();
    const closeBtn = h('button.icon-btn', { 'aria-label': 'Close', onclick: () => close() }, icon('x'));
    const head = h('div.sheet-head', opts.icon ? icon(opts.icon) : null, h('h2', { id: titleId }, opts.title || ''), opts.headExtra || null, opts.closable === false ? null : closeBtn);
    const body = h('div.sheet-body');
    const foot = h('div.sheet-foot');
    const box = h('div.sheet', { class: (opts.wide ? 'wide ' : '') + (opts.cls || ''), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId }, head, body, foot);
    const scrim = h('div.scrim', box);
    let closed = false;
    function close(val) {
      if (closed) return;
      closed = true;
      const i = stack.indexOf(api);
      if (i >= 0) stack.splice(i, 1);
      scrim.classList.add('bye');
      setTimeout(() => scrim.remove(), 160);
      if (opts.onClose) opts.onClose(val);
      if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
    }
    scrim.addEventListener('pointerdown', (e) => {
      if (e.target === scrim && opts.closable !== false && !opts.sticky) close();
    });
    const api = {
      el: box,
      body,
      foot,
      close,
      closable: opts.closable !== false,
      setBody(...kids) {
        U.mount(body, ...kids);
      },
      setFoot(...kids) {
        U.mount(foot, ...kids);
        foot.hidden = !kids.filter(Boolean).length;
      },
      setTitle(t) {
        head.querySelector('h2').textContent = t;
      },
    };
    const lastFocus = document.activeElement;
    if (opts.body) api.setBody(...[].concat(opts.body));
    api.setFoot(...[].concat(opts.foot || []));
    document.body.appendChild(scrim);
    stack.push(api);
    requestAnimationFrame(() => {
      const f = box.querySelector('[autofocus]') || (opts.closable === false ? null : closeBtn);
      if (f) f.focus({ preventScroll: true });
    });
    return api;
  }
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && stack.length) {
      const top = stack[stack.length - 1];
      if (top.closable) top.close();
    }
  });
  const closeAll = () => {
    while (stack.length) stack[stack.length - 1].close();
  };

  function confirm(o) {
    return new Promise((res) => {
      const s = sheet({
        title: o.title,
        cls: 'narrow',
        body: [h('p.lead', o.message || ''), o.extra || null],
        onClose: (v) => res(!!v),
      });
      s.setFoot(h('button.btn', { onclick: () => s.close(false) }, o.cancel || 'Cancel'), h('button.btn', { class: o.danger ? 'danger-solid' : 'primary', onclick: () => s.close(true), autofocus: true }, o.ok || 'OK'));
    });
  }

  /* ---------- PIN pad ---------- */
  function pinPad(onDone, opts) {
    let pin = '';
    const len = (opts && opts.length) || 4;
    const dots = h('div.pindots', { 'aria-hidden': 'true' });
    const live = h('div.sr', { 'aria-live': 'polite' });
    const draw = () => {
      U.mount(dots, ...Array.from({ length: len }, (_, i) => h('i', { class: i < pin.length ? 'on' : '' })));
      live.textContent = pin.length + ' of ' + len + ' digits';
    };
    const press = async (k) => {
      if (k === 'del') pin = pin.slice(0, -1);
      else if (k === 'clr') pin = '';
      else if (pin.length < len) pin += k;
      draw();
      if (pin.length === len) {
        const ok = await onDone(pin);
        if (!ok) {
          wrap.classList.remove('shake');
          void wrap.offsetWidth;
          wrap.classList.add('shake');
          pin = '';
          setTimeout(draw, 180);
        }
      }
    };
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clr', '0', 'del'];
    const pad = h(
      'div.pinpad',
      keys.map((k) =>
        h('button', { type: 'button', class: k.length > 1 ? 'fn' : '', 'aria-label': k === 'del' ? 'Delete digit' : k === 'clr' ? 'Clear' : k, onclick: () => press(k) }, k === 'del' ? icon('left', 26) : k === 'clr' ? 'C' : k)
      )
    );
    const wrap = h('div.pinwrap', dots, live, pad);
    const onKey = (e) => {
      if (!document.contains(wrap)) return removeEventListener('keydown', onKey);
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('del');
    };
    addEventListener('keydown', onKey);
    draw();
    return wrap;
  }

  /* Approval: the current user if allowed, otherwise any manager/owner PIN. */
  function approve(perm, title, why) {
    if (M.core.can(perm)) return Promise.resolve(M.state.user);
    return new Promise((res) => {
      let done = false;
      const err = h('p.err-text', { role: 'alert' });
      const s = sheet({
        title: title || 'Manager approval',
        cls: 'narrow',
        icon: 'lock',
        onClose: () => {
          if (!done) res(null);
        },
      });
      s.setBody(
        h('p.lead', why || 'A manager or the owner needs to enter their PIN to allow this.'),
        pinPad(async (pin) => {
          try {
            const u = M.core.approverByPin(pin, perm);
            done = true;
            res(u);
            s.close();
            return true;
          } catch (e) {
            err.textContent = e.message;
            return false;
          }
        }),
        err
      );
    });
  }

  /* ---------- amount keypad ---------- */
  function keypad(onChange, initial, opts) {
    let s = initial ? String(initial / 100) : '';
    const disp = h('output.keypad-display', { 'aria-live': 'polite' });
    const draw = () => {
      disp.textContent = s ? '₱' + (s.includes('.') ? s : Number(s).toLocaleString('en-PH')) : opts && opts.placeholder ? opts.placeholder : '₱0';
      disp.classList.toggle('ph', !s);
      onChange(s ? U.toCents(s) : 0);
    };
    const press = (k) => {
      if (k === 'del') s = s.slice(0, -1);
      else if (k === '.') {
        if (!s.includes('.')) s = (s || '0') + '.';
      } else {
        if (/\.\d\d$/.test(s)) return;
        if (s.replace('.', '').length >= 8) return;
        s = s === '0' ? k : s + k;
      }
      draw();
    };
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'];
    const pad = h('div.keypad', keys.map((k) => h('button', { type: 'button', 'aria-label': k === 'del' ? 'Delete' : k, onclick: () => press(k) }, k === 'del' ? icon('left', 24) : k)));
    const api = {
      el: h('div.keypad-wrap', disp, pad),
      set(c) {
        s = c ? String(Math.round(c) / 100) : '';
        draw();
      },
    };
    draw();
    return api;
  }

  /* Ask for a peso amount with quick picks. Resolves centavos or null. */
  function askAmount(o) {
    return new Promise((res) => {
      let val = o.initial || 0;
      let done = false;
      const s = sheet({ title: o.title, cls: 'narrow', onClose: () => !done && res(null) });
      const okBtn = h('button.btn.primary.lg.block', { onclick: () => finish() }, o.ok || 'Done');
      const kp = keypad((c) => {
        val = c;
        okBtn.disabled = !(val > 0) && !o.allowZero;
      }, o.initial);
      const reason = o.reason ? h('input.input', { placeholder: o.reason, maxlength: 60, 'aria-label': o.reason }) : null;
      const finish = () => {
        if (!(val > 0) && !o.allowZero) return;
        if (reason && !reason.value.trim()) {
          reason.focus();
          toast('Add a reason so the drawer report makes sense later.', 'err');
          return;
        }
        done = true;
        res(reason ? { amount: val, reason: reason.value.trim() } : val);
        s.close();
      };
      s.setBody(
        o.lead ? h('p.lead', o.lead) : null,
        o.quick ? h('div.chips', o.quick.map((q) => h('button.chip', { type: 'button', onclick: () => kp.set(q) }, U.peso(q, true)))) : null,
        kp.el,
        o.reasons ? h('div.chips', o.reasons.map((r) => h('button.chip', { type: 'button', onclick: () => (reason.value = r) }, r))) : null,
        reason
      );
      s.setFoot(okBtn);
      okBtn.disabled = !(val > 0) && !o.allowZero;
    });
  }

  /* ---------- small controls ---------- */
  function seg(options, value, onChange, label) {
    const el = h('div.seg', { role: 'group', 'aria-label': label || '' });
    const draw = (v) =>
      U.mount(
        el,
        options.map(([k, text, ic]) =>
          h(
            'button',
            {
              type: 'button',
              'aria-pressed': String(k === v),
              onclick: () => {
                draw(k);
                onChange(k);
              },
            },
            ic ? icon(ic, 18) : null,
            text
          )
        )
      );
    draw(value);
    return el;
  }

  function stepper(value, onChange, opts) {
    const o = opts || {};
    const min = o.min == null ? 0 : o.min;
    const out = h('output', String(value));
    const set = (v) => {
      v = Math.max(min, Math.min(o.max || 999, v));
      out.textContent = String(v);
      onChange(v);
    };
    return h(
      'div.stepper',
      h('button', { type: 'button', 'aria-label': 'Less', onclick: () => set(Number(out.textContent) - 1) }, icon(Number(value) <= 1 && o.trash ? 'trash' : 'minus', 18)),
      out,
      h('button', { type: 'button', 'aria-label': 'More', onclick: () => set(Number(out.textContent) + 1) }, icon('plus', 18))
    );
  }

  function field(label, input, hint) {
    return h('label.field', h('span', label), input, hint ? h('small', hint) : null);
  }

  function empty(title, text, action) {
    return h('div.empty', h('div.empty-mark', '먹어봐'), h('h3', title), text ? h('p', text) : null, action || null);
  }

  function badge(kind, text) {
    return h('span.badge', { class: kind }, text);
  }

  const STOCK_BADGE = { ok: ['ok', 'In stock'], low: ['low', 'Low'], out: ['out', 'Out'] };

  M.ui = { icon, toast, sheet, closeAll, confirm, pinPad, approve, keypad, askAmount, seg, stepper, field, empty, badge, STOCK_BADGE };
})((window.M = window.M || {}));
