# Mogoba POS

Point of sale, kitchen queue, inventory and sales tracking for **Mogoba Korean Food House**
(Rizal St, Aparri, Cagayan). Offline-first: every sale, refund, stock movement and shift is
stored on the device and keeps working with no internet. Optional online sync pushes the same
events to a server when a connection is available.

Status: **demo build** — feature-complete web app, packaged as one offline HTML file. The
Android APK (Capacitor) is the next step, after the demo is approved.

## Try it

| How | Command |
|---|---|
| One offline file | `npm run build`, then open `dist/mogoba-pos.html` in Chrome (phone, tablet or laptop). No server, no internet. |
| Local server (installable PWA) | `npm start` → http://127.0.0.1:8123 |

First run offers **Explore with sample data** (two weeks of made-up trading) or **Start Mogoba
for real** (real menu and recipes, stock at zero, your owner PIN).
Sample PINs: Owner `1234` · Mark, manager `2580` · Joy, cashier `0000`.

## What it does

- **Register** — Mogoba's full menu board (50 items, 12 categories, bilingual Korean/English),
  photos, flavours and sizes, add-ons, kitchen notes, custom items, dine-in / take-out /
  delivery (own rider, Foodpanda, GrabFood), held tickets for tables, "Popular" tab from the
  last 14 days of sales, sold-out and "n left" badges driven by live stock.
- **Payments** — cash with one-tap tender and change, GCash, Maya, card, Foodpanda, GrabFood,
  split tender. Order number (#queue) and receipt number per device.
- **Discounts** — Senior Citizen / PWD per RA 9994 and RA 10754 (20% of the eligible share,
  group meals pro-rated by diners, VAT exemption when VAT-registered, name + ID captured and
  printed for signature), percent and peso discounts with reason and manager approval.
- **Controls** — role-based staff (owner / manager / cashier) with 4-digit PINs; manager PIN
  approval for discounts, voids, refunds, pay-outs and removing items the kitchen already has;
  every sensitive action in an activity log; auto-lock; wrong-PIN lockout.
- **Orders** — kitchen queue (preparing → ready → picked up), today, past days, reprint,
  partial refunds (pro-rata with discounts), whole-order voids, restock or count-as-waste.
- **Stock** — recipe-based depletion (base + option + add-on), append-only movement ledger,
  receiving with moving-average cost, waste log, blind counts with variance, par / reorder
  points, days of cover from 14-day usage, reorder list you can paste to a supplier.
- **Drawer** — open shift with float, cash in / out, X-reading, blind close by denomination,
  over / short, Z-reading history.
- **Reports** — net sales, orders, average order, gross profit and food cost %, sales by hour
  or day, payments, order types, top items, categories, SC/PWD log (CSV), voids and refunds,
  waste and count variance; CSV export of sales and line items.
- **Data** — backup / restore (JSON), stock-vs-ledger integrity check, persistent storage
  request, single-tab guard so two tabs can never double-count.

## Architecture

```
www/
  index.html, css/app.css         glass UI, brand tokens, dark + light, "lite glass" mode
  js/logic.js                     pure business rules (money in centavos) — unit tested
  js/db.js                        IndexedDB; db.write() = one atomic transaction
  js/core.js                      state + builders (pure) + live operations
  js/seed.js                      Mogoba menu, ingredients, recipes (starting values)
  js/demo.js                      sample history built with the same builders
  js/sync.js                      outbox → server, idempotent by event id, backoff
  js/print.js                     receipt / kitchen / X / Z text, browser print, ESC/POS bytes
  js/ui.js, js/views/*, js/lock.js, js/app.js
  sw.js, manifest.webmanifest     offline cache + install
tools/build.mjs                   sw.js file list + dist/mogoba-pos.html (single file)
tools/fonts.sh                    rebuild Korean font subsets (all Hangul used in the app)
tests/logic.test.js               pricing, SC/PWD (VAT and non-VAT), payments, refunds, recipes, drawer
tests/e2e.js                      real-browser flows: sale, void, refund, approvals, tickets,
                                  shift close, every screen, reload, offline, phone layout
```

Design rules that keep the numbers right:

1. **Money is integer centavos** everywhere; rounding happens once, half away from zero.
2. **One transaction per business event.** An order, its stock moves, the shift totals, the
   audit entry and the sync event commit together or not at all.
3. **Stock is a ledger.** On-hand is a cached sum of movements; Settings → *Check stock ledger*
   proves they agree. Ledgers merge cleanly across devices, which is what makes multi-device
   sync safe.
4. **Snapshots at sale time.** Each line stores its name, price, options, ingredient use and
   unit cost, so later menu or cost edits never rewrite history.
5. **Sales never wait for the network.** Sync is an outbox drained in the background.

## Tests

```
npm test                      # 17 unit tests (logic)
npm start & npm run e2e       # 31 browser checks (needs Playwright + Chromium)
```

## Android APK (next phase)

Plan: Capacitor wraps `www/` unchanged (local assets → offline from first launch, ~4–6 MB APK).
Native additions: Bluetooth ESC/POS printing for 58/80 mm printers (bytes already produced by
`print.escpos()`), automatic daily backup file to device storage, keep-screen-on, and a
signed release build. Online sync target: an endpoint on the existing VPS that stores events
by `eid` (idempotent).

## Compliance note

This register is **not BIR-accredited**. Receipts print as order slips with "This is not an
official receipt or invoice." Keep issuing BIR-registered invoices until the system has a
Permit to Use.

Ingredient costs, portions and par levels in `seed.js` are starting values to be corrected
from Mogoba's real suppliers and kitchen portions. Soft-drink prices (Coke/Sprite ₱35, water
₱20) are not on the menu board and are placeholders. Food photos are the licensed stock
placeholders from the website draft.
