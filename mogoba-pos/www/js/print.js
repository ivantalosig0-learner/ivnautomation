/* Mogoba POS — receipts, kitchen tickets and shift reports as fixed-width text.
 * The same text drives the on-screen preview, browser printing (58/80 mm) and the ESC/POS
 * byte stream used by Bluetooth thermal printers in the Android build. */
(function (M) {
  'use strict';
  const U = M.util;
  const L = M.logic;

  const width = () => (M.state.settings && M.state.settings.print.paper === 80 ? 48 : 32);
  const amt = (c) => U.num2(c);

  function lr(left, right, w) {
    left = String(left);
    right = String(right);
    const space = w - right.length;
    if (left.length > space - 1) {
      const head = wrap(left, w);
      const last = head.pop();
      if (last.length <= space - 1) return head.concat([last + ' '.repeat(space - last.length) + right]).join('\n');
      return head.concat([last, ' '.repeat(Math.max(0, w - right.length)) + right]).join('\n');
    }
    return left + ' '.repeat(space - left.length) + right;
  }
  function wrap(s, w) {
    const out = [];
    for (const para of String(s).split('\n')) {
      let line = '';
      for (const word of para.split(' ')) {
        if (!line) line = word;
        else if ((line + ' ' + word).length <= w) line += ' ' + word;
        else {
          out.push(line);
          line = word;
        }
        while (line.length > w) {
          out.push(line.slice(0, w));
          line = line.slice(w);
        }
      }
      out.push(line);
    }
    return out;
  }
  const center = (s, w) =>
    wrap(s, w)
      .map((x) => ' '.repeat(Math.max(0, Math.floor((w - x.length) / 2))) + x)
      .join('\n');
  const rule = (w, ch) => (ch || '-').repeat(w);

  function header(w) {
    const b = M.state.settings.business;
    const out = [center(b.name.toUpperCase(), w)];
    if (b.address) out.push(center(b.address, w));
    if (b.phone) out.push(center('Tel ' + b.phone, w));
    if (b.tin) out.push(center((b.vat ? 'VAT Reg TIN ' : 'NON-VAT Reg TIN ') + b.tin, w));
    return out;
  }

  function lineBlock(l, w) {
    const out = [lr(l.qty + ' ' + l.name, amt(L.lineGross(l)), w)];
    const sub = [];
    if (l.variantName) sub.push(l.variantName);
    for (const m of l.mods || []) sub.push('+ ' + m.name);
    if (l.qty > 1 || (l.mods || []).length) sub.push('@ ' + amt(l.unit));
    for (const s of sub) out.push('   ' + s);
    if (l.note) out.push('   * ' + l.note);
    const d = L.lineDiscount(l);
    if (d) out.push(lr('   Less ' + (l.disc.reason || 'discount'), '-' + amt(d), w));
    return out;
  }

  function receipt(order, opts) {
    const w = (opts && opts.width) || width();
    const b = M.state.settings.business;
    const t = order.totals || L.totals(order, { vat: !!b.vat });
    const out = header(w);
    out.push(rule(w));
    out.push(lr(b.receiptTitle || 'ORDER SLIP', order.queue ? 'Order #' + order.queue : '', w));
    if (order.no) out.push('No. ' + order.no);
    out.push(U.fmtDateTime(order.paidAt || Date.now()));
    out.push(M.core.TYPES[order.type] + (order.table ? ' · Table ' + order.table : '') + (order.channel && order.channel !== 'own' ? ' · ' + M.core.PAY[order.channel] : ''));
    if (order.customer) out.push('Name: ' + order.customer);
    if (order.by) out.push('Cashier: ' + order.by.name);
    out.push(rule(w));
    for (const l of order.lines) out.push(...lineBlock(l, w));
    out.push(rule(w));
    out.push(lr('Items', String(t.items), w));
    if (t.lineDisc || t.orderDisc || t.vatRemoved) out.push(lr('Subtotal', amt(t.gross), w));
    if (t.lineDisc) out.push(lr('Less item discounts', '-' + amt(t.lineDisc), w));
    if (order.disc && order.disc.kind === 'scpwd') {
      if (t.vatRemoved) out.push(lr('Less VAT (exempt share)', '-' + amt(t.vatRemoved), w));
      out.push(lr('Less SC/PWD 20%', '-' + amt(t.orderDisc), w));
    } else if (t.orderDisc) out.push(lr('Less ' + (order.disc.reason || 'discount'), '-' + amt(t.orderDisc), w));
    out.push(lr('TOTAL', '₱' + amt(t.total), w));
    if (b.vat) {
      out.push(lr('VATable sales', amt(t.vatable), w));
      out.push(lr('VAT 12%', amt(t.vat), w));
      out.push(lr('VAT-exempt sales', amt(t.vatExempt), w));
    }
    for (const p of order.payments || []) {
      if (p.method === 'none') continue;
      out.push(lr(M.core.PAY[p.method] + (p.ref ? ' ' + p.ref : ''), amt(p.method === 'cash' ? p.tendered : p.amount), w));
    }
    const ch = L.changeDue(order.payments);
    if (ch) out.push(lr('Change', amt(ch), w));
    for (const r of order.refunds || []) out.push(lr('Refunded ' + U.fmtTime(r.at), '-' + amt(r.amount), w));
    if (order.status === 'voided') out.push('', center('*** VOIDED ***', w));
    if (order.disc && order.disc.kind === 'scpwd') {
      out.push(rule(w));
      out.push('SC/PWD discount ' + order.disc.count + ' of ' + order.disc.diners + ' diners');
      for (const p of order.disc.people || []) {
        out.push(p.type + ' ' + p.name);
        out.push('ID ' + p.idNo);
      }
      out.push('', 'Signature: ' + '_'.repeat(Math.max(4, w - 11)));
    }
    out.push(rule(w));
    if (b.footer) out.push(center(b.footer, w));
    if (opts && opts.copy) out.push('', center('— REPRINT ' + U.fmtDateTime(Date.now()) + ' —', w));
    return out.join('\n');
  }

  function kitchen(order) {
    const w = width();
    const out = [center('KITCHEN', w), rule(w, '=')];
    out.push(lr(order.queue ? '#' + order.queue : order.table ? 'Table ' + order.table : 'Ticket', U.fmtTime(order.paidAt || order.heldAt || Date.now()), w));
    out.push(M.core.TYPES[order.type] + (order.table ? ' · Table ' + order.table : '') + (order.customer ? ' · ' + order.customer : ''));
    out.push(rule(w));
    for (const l of order.lines) {
      out.push(...wrap(l.qty + ' x ' + l.name + (l.variantName ? ' — ' + l.variantName : ''), w));
      for (const m of l.mods || []) out.push('    + ' + m.name);
      if (l.note) out.push('    ** ' + l.note.toUpperCase());
    }
    out.push(rule(w, '='));
    return out.join('\n');
  }

  function shiftReport(shift, cash, kind) {
    const w = width();
    const d = L.drawer(shift);
    const t = shift.tot;
    const out = header(w);
    out.push(rule(w));
    out.push(center(kind === 'Z' ? 'Z-READING  #' + shift.zNo : 'X-READING (shift so far)', w));
    out.push('Opened ' + U.fmtDateTime(shift.openedAt) + (shift.openedBy ? ' by ' + shift.openedBy.name : ''));
    if (shift.closedAt) out.push('Closed ' + U.fmtDateTime(shift.closedAt) + (shift.closedBy ? ' by ' + shift.closedBy.name : ''));
    out.push(rule(w));
    out.push(lr('Orders', String(t.orders), w));
    out.push(lr('Net sales', amt(t.net), w));
    out.push(lr('Discounts given', amt(t.disc), w));
    out.push(lr('Voided orders', String(t.voids), w));
    out.push(rule(w));
    out.push('Payments');
    for (const k of Object.keys(t.sales)) out.push(lr('  ' + M.core.PAY[k], amt(t.sales[k]), w));
    for (const k of Object.keys(t.refunds)) if (t.refunds[k]) out.push(lr('  Refunded ' + M.core.PAY[k], '-' + amt(t.refunds[k]), w));
    out.push(rule(w));
    out.push('Cash drawer');
    out.push(lr('  Opening float', amt(d.float), w));
    out.push(lr('  Cash sales', amt(d.cash), w));
    if (d.refunds) out.push(lr('  Cash refunds', '-' + amt(d.refunds), w));
    if (d.voids) out.push(lr('  Voided cash', '-' + amt(d.voids), w));
    for (const c of cash || []) out.push(lr('  ' + (c.type === 'in' ? 'In: ' : 'Out: ') + c.reason, (c.type === 'in' ? '' : '-') + amt(c.amount), w));
    out.push(lr('  Expected in drawer', amt(d.expected), w));
    if (kind === 'Z') {
      out.push(lr('  Counted', amt(shift.counted), w));
      out.push(lr(shift.overShort === 0 ? '  Balanced' : shift.overShort > 0 ? '  Over' : '  Short', amt(Math.abs(shift.overShort)), w));
      if (shift.note) out.push('  Note: ' + shift.note);
    }
    out.push(rule(w));
    out.push(center('Printed ' + U.fmtDateTime(Date.now()), w));
    return out.join('\n');
  }

  /* Browser printing through a hidden frame, sized for the receipt roll. */
  function printText(text) {
    if (M.ENV === 'preview') {
      M.ui.toast('Printing is turned off in this web preview. It works in the Android app and in Chrome.', 'err', 5000);
      return;
    }
    const paper = M.state.settings.print.paper === 80 ? 80 : 58;
    const f = document.createElement('iframe');
    f.setAttribute('aria-hidden', 'true');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(f);
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const d = f.contentDocument;
    d.open();
    d.write('<!doctype html><html><head><meta charset="utf-8"><title>Receipt</title><style>@page{size:' + paper + 'mm auto;margin:0}html,body{margin:0;background:#fff}body{padding:3mm 2mm;font:' + (paper === 80 ? 12 : 11) + 'px/1.25 ui-monospace,Menlo,Consolas,"Courier New",monospace;white-space:pre;color:#000}</style></head><body>' + esc(text) + '</body></html>');
    d.close();
    setTimeout(() => {
      try {
        f.contentWindow.focus();
        f.contentWindow.print();
      } catch (e) {
        M.ui.toast('Printing is not available here.', 'err');
      }
      setTimeout(() => f.remove(), 3000);
    }, 60);
  }

  /* ESC/POS bytes for 58/80 mm Bluetooth printers (used by the Android build). */
  function escpos(text) {
    const ascii = text.replace(/₱/g, 'P').replace(/[—–]/g, '-').replace(/·/g, '-').replace(/[^\x20-\x7e\n]/g, '');
    const bytes = [0x1b, 0x40, 0x1b, 0x74, 0x00];
    for (const ch of ascii) bytes.push(ch === '\n' ? 0x0a : ch.charCodeAt(0));
    bytes.push(0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x42, 0x00);
    return new Uint8Array(bytes);
  }

  M.print = { receipt, kitchen, shiftReport, printText, escpos, width, wrap };
})((window.M = window.M || {}));
