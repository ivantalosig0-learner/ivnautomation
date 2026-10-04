# Mogoba POS

Point of sale, kitchen queue, inventory, sales tracking and online ordering for
**Mogoba Korean Food House** (Rizal St, Aparri, Cagayan). Offline-first: every sale, refund,
stock movement and shift is stored on the device and keeps working with no internet.

Status: **demo build**. The register is feature-complete as a web app and as one offline HTML
file. The customer ordering site and its server are built and tested. The Android APK
(Capacitor) is the next step, after the demo is approved.

## Try it

| What | How |
|---|---|
| Register, one offline file | `npm run build`, then open `dist/mogoba-pos.html` in Chrome. No server, no internet. |
| Register, local server (installable) | `npm start` → http://127.0.0.1:8123 |
| Customer ordering site, demo | Open `order/index.html` from the same place as the register. Orders reach the register's **Orders → Online** tab in the same browser. |
| Everything on one server | `POS_KEY=... node server/server.mjs` → `/order/` for customers, `/pos/` for the register. See [server/README.md](server/README.md). |

First run offers **Explore with sample data** (two weeks of made-up trading) or **Start Mogoba
for real** (real menu and recipes, stock at zero, your owner PIN).

Sample PINs: Owner `1234` · Mark, manager `2580` · Joy, cashier `0000`.

## The register

- **Overview**: today's net sales against the daily target (bullet graph with projected
  close), orders and average order with 7-day sparklines, food cost against target, sales by
  hour against a usual same weekday, and one list of what needs attention: kitchen waits,
  online orders to confirm, out and low stock, lots expiring, open tickets, overdue backup.
- **Register**: full menu board (50 items, 12 categories, Korean and English), photos,
  flavours and sizes, add-ons, kitchen notes, dine-in, take-out and delivery (own rider,
  Foodpanda, GrabFood), held tickets, live "n left" and sold-out badges from stock.
- **Payments**: cash with one-tap tender and change, GCash, Maya, card, Foodpanda, GrabFood,
  split tender.
- **Discounts**: Senior Citizen and PWD per RA 9994 and RA 10754 (20% of the eligible share,
  group meals pro-rated, VAT exemption when VAT-registered, name and ID captured), percent
  and peso discounts with reason and manager approval.
- **Orders**: kitchen queue with wait timers, online inbox, today, past days, reprint,
  partial refunds, voids with restock or waste.
- **Stock**: recipe-based depletion, append-only movement ledger, **lots with expiry dates**
  used first-expiring-first, receiving with expiry and cost, **add or remove** with reasons
  (expired, spoiled, staff meal, transfer in, found, correction), blind counts with variance,
  level bars against par, days of cover, "use first" list, reorder list by supplier.
- **Menu**: item editor, recipes, food cost per item against the target.
- **Drawer**: open shift with float, cash in and out, X-reading, blind close by denomination,
  GCash and Maya totals checked against the wallet apps, Z-reading history.
- **Reports**: net sales, orders, gross profit and food cost, sales by hour or day against
  the previous period, busy-hours heatmap, menu engineering (stars, puzzles, workhorses,
  dogs), payments, order types, top items, SC/PWD log, voids, refunds, waste, CSV export.
- **Controls**: owner, manager and cashier roles with 4-digit PINs; manager approval for
  discounts, voids, refunds, pay-outs and large stock removals; activity log; auto-lock.
- **Data**: backup and restore (JSON), stock-vs-ledger check, persistent storage request,
  single-tab guard.

## Online ordering

Customers order and pay from their phone; the register confirms.

1. The register publishes the menu, sold-out items, hours, prep time, delivery terms and the
   GCash and Maya QR codes (**Settings → Online ordering**, upload the QR images there).
2. The customer picks items, pickup or delivery, now or later today, and pays by GCash or
   Maya (scan the QR, enter the reference number, attach the screenshot) or cash on pickup.
3. The register chimes until someone opens **Orders → Online**. Staff check the money in the
   wallet app, type the amount received, and accept with a ready time. A paid order becomes a
   sale; a cash order becomes an open ticket charged at pickup.
4. The customer's tracking page follows each step: confirmed, preparing, ready, out for
   delivery, completed.

Payment checks that stop the common GCash and Maya scams: reference numbers are usable once,
forever; the amount is what staff typed from the wallet app, never the screenshot; a reused
screenshot is flagged by its fingerprint; underpaid orders cannot be accepted; orders of
₱1,000 and up need a manager PIN. Bilao trays and orders above ₱1,000 must be prepaid.
Orders pause automatically when the register has been offline for 5 minutes.

The full contract between site, server and register is in
[docs/online-ordering.md](docs/online-ordering.md).

## Layout

```
www/                 register app (vanilla JS, no framework)
  js/logic.js        pure business rules, money in centavos, unit tested
  js/db.js           IndexedDB; db.write() = one atomic transaction
  js/core.js         state, builders and live operations
  js/online.js       menu publishing, order inbox, payment verification
  js/charts.js       bars, heatmap, menu engineering matrix
  js/views/*         screens
order/               customer ordering site (static, works in demo or server mode)
server/              zero-dependency Node server: API, static hosting, sync endpoint
docs/                online ordering contract
tools/build.mjs      copy lint, sw.js, single-file build, customer site assets
tools/gen-store.mjs  customer site fallback menu from www/js/seed.js
tests/               unit, register e2e, server, customer site e2e
```

Rules that keep the numbers right:

1. **Money is integer centavos** everywhere; rounding happens once.
2. **One transaction per business event.** An order, its stock moves, the shift totals, the
   audit entry and the sync event commit together or not at all.
3. **Stock is a ledger.** On-hand is a cached sum of movements and lots always add up to it;
   Settings → *Check stock ledger* proves both.
4. **Snapshots at sale time.** Each line keeps its name, price, options, ingredient use and
   unit cost, so later edits never rewrite history.
5. **Sales never wait for the network.** Sync and online orders run in the background.

## Tests

```
npm test                          # logic unit tests
npm start & npm run e2e           # register in a real browser (Playwright + Chromium)
node --test tests/server.test.mjs # server API
node tests/order-e2e.js           # customer site in a real browser
node tests/online-e2e.js          # server + register + customer API together
```

## Android APK (next phase)

Capacitor wraps `www/` unchanged (about 4 to 6 MB). Native additions: Bluetooth ESC/POS
printing (bytes already produced by `print.escpos()`), daily backup file, keep-screen-on,
signed release build.

## Compliance

The register is **not BIR-accredited**. Receipts print as order slips with "This is not an
official receipt or invoice." Keep issuing BIR-registered invoices until the system has a
Permit to Use. Online payments go straight to Mogoba's own GCash and Maya accounts; nothing
here holds customer money.

Ingredient costs, portions and par levels in `seed.js` are starting values to be corrected
from real suppliers. Soft-drink prices are not on the menu board and are placeholders. Food
photos are the licensed stock placeholders from the website draft.
