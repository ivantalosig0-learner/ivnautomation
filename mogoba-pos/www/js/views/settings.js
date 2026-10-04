/* Mogoba POS: Settings: business & receipt, register rules, printing, look, staff, sync, data. */
(function (M) {
  'use strict';
  const U = M.util;
  const C = M.core;
  const S = M.state;
  const h = U.h;
  const ui = () => M.ui;

  const VERSION = '1.0.0';

  function sw(label, sub, checked, onChange) {
    return h('label.switch', h('input', { type: 'checkbox', checked, onchange: (e) => onChange(e.target.checked) }), h('span.track'), h('span.txt', h('b', label), sub ? h('small', sub) : null));
  }
  function panel(title, sub, ...kids) {
    return h('section.panel.glass.stack', h('div.panel-title', h('h3', title), sub ? h('span.sub', sub) : null), ...kids);
  }
  async function save(patch, msg) {
    try {
      await C.saveSettings(patch);
      if (msg !== false) ui().toast(msg || 'Saved.', 'ok');
    } catch (e) {
      ui().toast(e.message, 'err');
    }
  }

  function userSheet(u) {
    const isNew = !u;
    const s = ui().sheet({ title: isNew ? 'Add staff' : u.name, cls: 'narrow', icon: 'user' });
    const name = h('input.input', { value: u ? u.name : '', maxlength: 30, 'aria-label': 'Name' });
    let role = u ? u.role : 'cashier';
    const pin = h('input.input', { type: 'password', inputmode: 'numeric', maxlength: 4, autocomplete: 'new-password', placeholder: isNew ? '4 digits' : 'Leave blank to keep', 'aria-label': 'PIN' });
    let active = u ? u.active !== false : true;
    s.setBody(
      h(
        'div.stack',
        ui().field('Name', name),
        h('div.field', h('span', 'Role'), ui().seg([['cashier', 'Cashier'], ['manager', 'Manager'], ['owner', 'Owner']], role, (v) => (role = v), 'Role')),
        h('small.muted', 'Cashiers sell and open/close shifts. Managers also approve discounts, voids, refunds and pay-outs, and manage stock. Owners can change everything.'),
        ui().field('PIN', pin),
        u ? sw('Active', 'Inactive staff cannot sign in', active, (v) => (active = v)) : null
      )
    );
    s.setFoot(
      h(
        'button.btn.primary.lg.block',
        {
          type: 'button',
          onclick: async () => {
            if (pin.value && !/^\d{4}$/.test(pin.value)) return ui().toast('The PIN must be 4 digits.', 'err');
            try {
              await C.saveUser({ id: u && u.id, name: name.value.trim(), role, pin: pin.value, active });
              s.close();
              ui().toast('Saved.', 'ok');
              M.bus.emit('users');
            } catch (e) {
              ui().toast(e.message, 'err');
            }
          },
        },
        'Save'
      )
    );
  }

  async function auditSheet() {
    const rows = await C.auditLog(400);
    const s = ui().sheet({ title: 'Activity log', wide: true, icon: 'history' });
    const LBL = { login: 'Signed in', void: 'Void', refund: 'Refund', discount: 'Discount', 'line.void': 'Removed sent item', 'ticket.delete': 'Deleted ticket', 'ticket.clear': 'Cleared ticket', 'shift.open': 'Opened shift', 'shift.close': 'Closed shift', 'cash.in': 'Cash in', 'cash.out': 'Cash out', 'stock.receive': 'Received stock', 'stock.waste': 'Logged waste', 'stock.count': 'Stock count', 'menu.edit': 'Edited menu', 'menu.add': 'Added menu item', settings: 'Changed settings', 'user.add': 'Added staff', 'user.edit': 'Edited staff', backup: 'Backup', restore: 'Restored backup' };
    s.setBody(
      rows.length
        ? h('div.list', rows.map((a) => h('div.row', { style: { minHeight: '52px', padding: '8px 4px' } }, h('div.grow', h('div.t', LBL[a.action] || a.action, h('span.muted', { style: { fontWeight: 600 } }, ' · ' + (a.by ? a.by.name : '-') + (a.approver && (!a.by || a.approver.id !== a.by.id) ? ', approved by ' + a.approver.name : ''))), h('div.s', U.fmtDateTime(a.at) + (a.detail ? ' · ' + a.detail : ''))))))
        : ui().empty('Nothing yet', 'Sign-ins, voids, refunds, discounts and stock changes appear here.')
    );
  }

  async function backup() {
    const data = await M.db.dump();
    U.download('mogoba-backup-' + U.dayKey() + '-' + U.pad(new Date().getHours()) + U.pad(new Date().getMinutes()) + '.json', JSON.stringify(data));
    await C.saveMeta({ lastBackup: Date.now() });
    ui().toast('Backup downloaded. Keep a copy off this device (Drive, Messenger, laptop).', 'ok', 4500);
    M.bus.emit('change');
  }

  function restore() {
    const inp = h('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' } });
    document.body.appendChild(inp);
    inp.addEventListener('change', async () => {
      const f = inp.files && inp.files[0];
      inp.remove();
      if (!f) return;
      let data;
      try {
        data = JSON.parse(await f.text());
      } catch (e) {
        return ui().toast('That file is not a readable backup.', 'err');
      }
      if (!data || data.app !== 'mogoba-pos') return ui().toast('That file is not a Mogoba POS backup.', 'err');
      const n = (data.stores.orders || []).length;
      if (!(await ui().confirm({ title: 'Replace everything on this device?', message: 'The backup from ' + U.fmtDateTime(data.exportedAt) + ' (' + n + ' orders) replaces all current data here. Download a backup of the current data first if you might need it.', ok: 'Restore backup', danger: true }))) return;
      try {
        await M.db.restore(data);
        ui().toast('Restored. Reloading…', 'ok');
        setTimeout(() => location.reload(), 700);
      } catch (e) {
        ui().toast(e.message, 'err');
      }
    });
    inp.click();
  }

  async function startFresh() {
    const demo = S.meta.demo;
    const ok = await ui().confirm({
      title: demo ? 'Remove the sample data?' : 'Erase everything on this device?',
      message: demo ? 'Sample sales, stock movements and demo staff are deleted. You keep Mogoba’s menu and recipes and set up your owner PIN. Stock starts at zero. Count it before opening.' : 'All sales, stock history, staff and settings on this device are deleted. This cannot be undone. Download a backup first.',
      ok: demo ? 'Remove sample data' : 'Erase everything',
      danger: true,
    });
    if (!ok) return;
    if (!demo) {
      const ap = await ui().approve('*', 'Owner PIN', 'Enter the owner PIN to erase this device.');
      if (!ap) return;
    }
    await M.db.wipe();
    location.reload();
  }

  async function integrity() {
    const r = await C.verifyStock();
    if (!r.diffs.length) return ui().toast('Stock matches the ledger (' + r.moves + ' movements checked).', 'ok', 4000);
    ui().toast(r.diffs.length + ' items differ from the ledger: ' + r.diffs.map((d) => d.name).slice(0, 3).join(', '), 'err', 6000);
  }

  /* QR images are resized in the browser so settings stay small and the code stays sharp. */
  function readQr(file) {
    return new Promise((res, rej) => {
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return rej(new Error('Use a PNG or JPG image of the QR code.'));
      const fr = new FileReader();
      fr.onerror = () => rej(new Error('Could not read that file.'));
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => rej(new Error('That file is not a readable image.'));
        img.onload = () => {
          const k = Math.min(1, 900 / Math.max(img.width, img.height));
          const cv = document.createElement('canvas');
          cv.width = Math.round(img.width * k);
          cv.height = Math.round(img.height * k);
          const cx = cv.getContext('2d');
          cx.imageSmoothingEnabled = k < 1;
          cx.fillStyle = '#fff';
          cx.fillRect(0, 0, cv.width, cv.height);
          cx.drawImage(img, 0, 0, cv.width, cv.height);
          res(cv.toDataURL('image/png'));
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  function onlinePanel(st) {
    const o = JSON.parse(JSON.stringify(st.online || {}));
    const put = (msg) => save({ online: o }, msg);
    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const hours = o.hours || [];
    const first = hours[0] || { open: '09:00', close: '20:00' };
    const openDays = new Set(hours.map((x) => x.day));
    const setHours = (open, close, days) => {
      o.hours = [0, 1, 2, 3, 4, 5, 6].filter((d) => days.has(d)).map((day) => ({ day, open, close }));
      put();
    };
    const openIn = h('input.input', { type: 'time', value: first.open, 'aria-label': 'Opens at' });
    const closeIn = h('input.input', { type: 'time', value: first.close, 'aria-label': 'Closes at' });
    openIn.addEventListener('change', () => setHours(openIn.value, closeIn.value, openDays));
    closeIn.addEventListener('change', () => setHours(openIn.value, closeIn.value, openDays));
    const field = (label, val, onSave, extra) => {
      const i = h('input.input', Object.assign({ value: val == null ? '' : val, 'aria-label': label, maxlength: 80 }, extra || {}));
      i.addEventListener('change', () => onSave(i.value.trim()));
      return ui().field(label, i);
    };
    const wallet = (key, label) => {
      const w = (o.payments[key] = Object.assign({ enabled: false, accountName: '', number: '', qr: '' }, o.payments[key] || {}));
      const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true });
      file.addEventListener('change', async () => {
        const f = file.files && file.files[0];
        if (!f) return;
        try {
          w.qr = await readQr(f);
          put(label + ' QR saved.');
        } catch (e) {
          ui().toast(e.message, 'err');
        }
      });
      return h(
        'div.wallet',
        h('div.wallet-qr', w.qr ? h('img', { src: w.qr, alt: label + ' QR code' }) : h('span.muted', 'No QR yet')),
        h(
          'div.stack-sm.grow',
          sw(label, w.qr ? 'Customers scan this QR' : 'Upload the QR to turn this on', !!w.enabled && !!w.qr, (v) => {
            if (v && !w.qr) return ui().toast('Upload the ' + label + ' QR first.', 'err');
            w.enabled = v;
            put();
          }),
          h('div.form-grid', field('Account name', w.accountName, (v) => ((w.accountName = v), put())), field('Number', w.number, (v) => ((w.number = v), put()), { inputmode: 'tel' })),
          h('div.row-gap', file, h('button.btn.sm', { type: 'button', onclick: () => file.click() }, ui().icon('upload', 18), w.qr ? 'Replace QR' : 'Upload QR'), w.qr ? h('button.btn.sm.danger', { type: 'button', onclick: () => ((w.qr = ''), (w.enabled = false), put('QR removed.')) }, 'Remove') : null)
        )
      );
    };
    o.payments = o.payments || {};
    o.delivery = Object.assign({ enabled: false, fee: 0, minOrder: 0, area: '' }, o.delivery || {});
    const link = M.online ? M.online.siteUrl() : '';
    return panel(
      'Online ordering',
      o.enabled ? (o.accepting ? 'taking orders' : 'paused') : 'off',
      sw('Take orders from the website', 'Orders arrive in Orders → Online with a sound.', !!o.enabled, (v) => ((o.enabled = v), put())),
      h('div.field', h('span', 'Connection'), ui().seg([['demo', 'This device (demo)'], ['server', 'Mogoba server']], o.mode || 'demo', (v) => ((o.mode = v), put()), 'Connection')),
      (o.mode || 'demo') === 'server' ? h('div.form-grid', field('Server address', o.url, (v) => ((o.url = v), put()), { type: 'url', placeholder: 'https://…/mogoba/api' }), field('Register key', o.key, (v) => ((o.key = v), put()), { type: 'password', autocomplete: 'off' })) : h('small.muted', 'Demo: the website and this register share one browser. Use the server for real customers.'),
      link ? h('div.row-gap', h('span.muted', 'Customer site'), h('code.selectable', { style: { fontSize: '12.5px', wordBreak: 'break-all' } }, link)) : null,
      h('div.group-label', 'Hours and timing'),
      h('div.form-grid', ui().field('Opens', openIn), ui().field('Closes', closeIn)),
      h('div.chips', DAYS.map((d, i) => h('button.chip', { type: 'button', 'aria-pressed': String(openDays.has(i)), onclick: (e) => {
        if (openDays.has(i)) openDays.delete(i);
        else openDays.add(i);
        e.currentTarget.setAttribute('aria-pressed', String(openDays.has(i)));
        setHours(openIn.value, closeIn.value, openDays);
      } }, d))),
      h('div.field', h('span', 'Usual prep time'), ui().seg([[15, '15 min'], [20, '20 min'], [30, '30 min'], [45, '45 min']], o.prepMinutes || 20, (v) => ((o.prepMinutes = v), put()), 'Prep time')),
      h('div.group-label', 'Pickup and delivery'),
      sw('Pickup', null, o.pickup !== false, (v) => ((o.pickup = v), put())),
      sw('Delivery', null, !!o.delivery.enabled, (v) => ((o.delivery.enabled = v), put())),
      h(
        'div.form-grid',
        field('Delivery fee (₱)', U.trim(o.delivery.fee / 100), (v) => {
          const c = U.toCents(v);
          if (c >= 0) (o.delivery.fee = c), put();
        }, { inputmode: 'decimal' }),
        field('Minimum order (₱)', U.trim(o.delivery.minOrder / 100), (v) => {
          const c = U.toCents(v);
          if (c >= 0) (o.delivery.minOrder = c), put();
        }, { inputmode: 'decimal' }),
        h('div.span2', field('Delivery area', o.delivery.area, (v) => ((o.delivery.area = v), put())))
      ),
      h('div.group-label', 'Payments'),
      wallet('gcash', 'GCash'),
      wallet('maya', 'Maya'),
      sw('Cash on pickup or delivery', null, !(o.payments.cash && o.payments.cash.enabled === false), (v) => ((o.payments.cash = { enabled: v }), put()))
    );
  }

  function mount(el) {
    const body = h('div.stack');
    U.mount(el, h('div.page', h('div.page-head', h('h2', 'Settings')), body));
    async function draw() {
      const st = S.settings;
      const b = st.business;
      const inp = (val, label, onSave, opts) => {
        const i = h('input.input', Object.assign({ value: val || '', 'aria-label': label, maxlength: 80 }, opts || {}));
        i.addEventListener('change', () => onSave(i.value.trim()));
        return ui().field(label, i);
      };
      const est = await M.db.estimate();
      const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted().catch(() => false) : false;
      const pending = await M.db.count('outbox');
      const sy = M.sync.status;
      const parts = [];
      const owner = C.can('*');
      if (S.meta.demo && owner)
        parts.push(h('div.banner', ui().icon('sparkle'), h('div.grow', h('b', 'You are exploring with sample data'), h('div.s', 'Two weeks of made-up sales so every screen has something to show. Remove it before Mogoba starts trading on this device.')), h('button.btn.sm', { type: 'button', onclick: startFresh }, 'Remove sample data')));

      if (owner) parts.push(
        panel(
          'Business & receipt',
          'prints on every receipt',
          h(
            'div.form-grid',
            inp(b.name, 'Business name', (v) => v && save({ business: { name: v } })),
            inp(b.phone, 'Phone', (v) => save({ business: { phone: v } })),
            h('div.span2', inp(b.address, 'Address', (v) => save({ business: { address: v } }))),
            inp(b.tin, 'TIN', (v) => save({ business: { tin: v } }), { placeholder: '000-000-000-00000' }),
            inp(b.receiptTitle, 'Receipt title', (v) => save({ business: { receiptTitle: v || 'ORDER SLIP' } })),
            h(
              'label.field.span2',
              h('span', 'Receipt footer'),
              (() => {
                const t = h('textarea.input', { 'aria-label': 'Receipt footer', maxlength: 240 }, b.footer || '');
                t.addEventListener('change', () => save({ business: { footer: t.value.trim() } }));
                return t;
              })()
            )
          ),
          sw('VAT-registered', 'Prices include 12% VAT. Receipts show VATable / VAT-exempt sales and SC/PWD orders get the VAT exemption.', !!b.vat, (v) => save({ business: { vat: v } })),
          h('div.banner', ui().icon('alert'), h('div', h('b', 'This register is not BIR-accredited yet.'), h('div.s', 'Keep issuing your BIR-registered invoices. Receipts here print as order slips until the system gets a Permit to Use.')))
        )
      );

      if (owner) parts.push(
        panel(
          'Register',
          null,
          h('div.form-grid', inp(st.device.name, 'Device name', (v) => save({ device: { name: v || 'Counter 1' } })), inp(st.device.prefix, 'Receipt prefix', (v) => save({ device: { prefix: (v || 'A').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) || 'A' } }), { maxlength: 3 })),
          h('small.muted', 'Give every tablet its own prefix (A, B…) so receipt numbers never collide when you add a second register.'),
          h(
            'div.field',
            h('span', 'Lock the screen after'),
            ui().seg([[0, 'Never'], [2, '2 min'], [5, '5 min'], [10, '10 min'], [30, '30 min']], st.sales.autoLockMin, (v) => save({ sales: { autoLockMin: v } }, false), 'Auto-lock')
          ),
          sw('Stop sales when stock runs out', 'When off, the register warns and still sells.', !!st.sales.blockOutOfStock, (v) => save({ sales: { blockOutOfStock: v } })),
          sw('Require a table number for dine-in', null, !!st.sales.tableForDineIn, (v) => save({ sales: { tableForDineIn: v } })),
          h(
            'div.form-grid',
            inp(U.trim((st.sales.dailyTarget || 0) / 100), 'Daily sales target (₱)', (v) => {
              const c = U.toCents(v);
              if (c >= 0) save({ sales: { dailyTarget: c } });
            }, { inputmode: 'decimal' }),
            inp(String(st.sales.foodCostTarget || 40), 'Food cost target (%)', (v) => {
              const n = parseFloat(v);
              if (n > 0 && n < 100) save({ sales: { foodCostTarget: n } });
            }, { inputmode: 'decimal' })
          )
        )
      );
      if (owner) parts.push(onlinePanel(st));

      parts.push(
        panel(
          'Printing',
          null,
          h('div.field', h('span', 'Receipt paper'), ui().seg([[58, '58 mm'], [80, '80 mm']], st.print.paper, (v) => save({ print: { paper: v } }, false), 'Paper width')),
          sw('Print the receipt after every sale', null, !!st.print.autoReceipt, (v) => save({ print: { autoReceipt: v } })),
          sw('Print kitchen tickets', 'For take-out and delivery after payment, and when a dine-in ticket is held.', !!st.print.kitchenTicket, (v) => save({ print: { kitchenTicket: v } })),
          h('button.btn', { type: 'button', style: { alignSelf: 'flex-start' }, onclick: () => M.print.printText(M.print.receipt({ type: 'take', lines: [{ id: 'x', name: 'Test print', unit: 100, qty: 1, mods: [] }], payments: [], refunds: [], paidAt: Date.now(), queue: 0, no: 'TEST' })) }, ui().icon('print', 20), 'Test print')
        )
      );

      parts.push(
        panel(
          'Look',
          null,
          h('div.field', h('span', 'Theme'), ui().seg([['dark', 'Dark'], ['light', 'Light'], ['auto', 'Match device']], st.ui.theme, (v) => save({ ui: { theme: v } }, false), 'Theme')),
          h('div.field', h('span', 'Glass effect'), ui().seg([['full', 'Full glass'], ['lite', 'Lite (faster on older tablets)']], st.ui.glass, (v) => save({ ui: { glass: v } }, false), 'Glass effect'))
        )
      );

      if (C.can('*')) {
        parts.push(
          panel(
            'Staff',
            S.users.filter((u) => u.active !== false).length + ' active',
            h(
              'div.list',
              S.users.map((u) =>
                h(
                  'button.row',
                  { type: 'button', onclick: () => userSheet(u) },
                  h('span.avatar', { class: 'r-' + u.role }, u.name.slice(0, 1).toUpperCase()),
                  h('div.grow', h('div.t', u.name), h('div.s', C.ROLES[u.role] + (u.active === false ? ' · inactive' : ''))),
                  ui().icon('right', 18)
                )
              )
            ),
            h('button.btn', { type: 'button', style: { alignSelf: 'flex-start' }, onclick: () => userSheet(null) }, ui().icon('plus', 20), 'Add staff')
          )
        );
      }

      const syncInfo = { demo: 'Off while sample data is loaded', local: 'Off. Everything stays on this device', offline: 'Offline, ' + pending + ' changes waiting', syncing: 'Sending…', error: 'Retrying: ' + (sy.error || 'server error'), pending: pending + ' changes waiting', ok: 'Up to date' + (sy.lastOk ? ' · ' + U.ago(sy.lastOk) : '') }[sy.state];
      const url = h('input.input', { value: st.sync.url, placeholder: 'https://…', 'aria-label': 'Sync address', type: 'url', disabled: S.meta.demo });
      url.addEventListener('change', () => save({ sync: { url: url.value.trim() } }));
      const key = h('input.input', { value: st.sync.key, placeholder: 'Access key', 'aria-label': 'Access key', type: 'password', autocomplete: 'off', disabled: S.meta.demo });
      key.addEventListener('change', () => save({ sync: { key: key.value.trim() } }));
      if (owner) parts.push(
        panel(
          'Online sync',
          syncInfo,
          h('p.muted', { style: { fontSize: '13.5px' } }, 'The register works offline. With sync on, every sale, refund, stock change and shift goes to the server when there is internet.'),
          sw('Sync to the server', S.meta.demo ? 'Remove the sample data first' : null, !!st.sync.enabled && !S.meta.demo, async (v) => {
            if (S.meta.demo) return ui().toast('Remove the sample data before turning on sync.', 'err');
            await save({ sync: { enabled: v } }, false);
            M.sync.kick();
          }),
          h('div.form-grid', ui().field('Server address', url), ui().field('Access key', key)),
          h('div.row-gap', h('button.btn', { type: 'button', disabled: S.meta.demo || !st.sync.enabled, onclick: () => M.sync.run() }, ui().icon('cloud', 20), 'Sync now'), h('span.muted', { style: { fontSize: '13px' } }, pending + ' change' + (pending === 1 ? '' : 's') + ' in the outbox'))
        )
      );

      const lb = S.meta.lastBackup;
      if (!owner && C.can('reports')) parts.push(panel('Activity log', null, h('button.btn', { type: 'button', style: { alignSelf: 'flex-start' }, onclick: auditSheet }, ui().icon('history', 20), 'Open activity log')));
      if (owner) parts.push(
        panel(
          'Data & backup',
          lb ? 'last backup ' + U.ago(lb) : 'never backed up',
          h('div.row-gap', h('button.btn.go', { type: 'button', onclick: backup }, ui().icon('download', 20), 'Download backup'), h('button.btn', { type: 'button', onclick: restore }, ui().icon('upload', 20), 'Restore backup'), h('button.btn', { type: 'button', onclick: integrity }, ui().icon('check', 20), 'Check stock ledger'), h('button.btn', { type: 'button', onclick: auditSheet }, ui().icon('history', 20), 'Activity log')),
          h(
            'dl.kv',
            h('dt', 'Storage used'),
            h('dd', est && est.usage != null ? (est.usage / 1048576).toFixed(1) + ' MB' : '-'),
            h('dt', 'Protected from clean-up'),
            h('dd', persisted ? 'Yes' : 'Not granted. Keep regular backups'),
            h('dt', 'Device ID'),
            h('dd.selectable', { style: { fontFamily: 'var(--mono)', fontSize: '12px' } }, S.meta.deviceId),
            h('dt', 'Version'),
            h('dd', VERSION)
          ),
          C.can('*') ? h('button.btn.danger', { type: 'button', style: { alignSelf: 'flex-start' }, onclick: startFresh }, ui().icon('trash', 20), S.meta.demo ? 'Remove sample data' : 'Erase this device') : null
        )
      );
      U.mount(body, ...parts);
    }
    draw();
    const offs = [M.bus.on('settings', draw), M.bus.on('users', draw)];
    return () => offs.forEach((f) => f());
  }

  M.views = M.views || {};
  M.views.settings = { title: 'Settings', icon: 'settings', perm: 'sell', mount };
  M.settingsView = { backup, VERSION };
})((window.M = window.M || {}));
