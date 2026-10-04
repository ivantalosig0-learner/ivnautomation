# Hapag: how it is built

The technical half of the Hapag blueprint, for us. The business half (what each module does
for the owner, packages, roadmap, KPIs) is in `HAPAG.md`.

**Design rule: reuse before building, and build only what one provincial restaurant with a
sister business will use every week.** Everything below is either already running at Mogoba,
a small extension of it, or a free service we configure.

## What already exists (built for Mogoba, Aparri)

| Piece | Where | State |
|---|---|---|
| Register app (offline-first, vanilla JS, IndexedDB) | `mogoba-pos/www/` | Running. 22 unit tests, full browser e2e. |
| One-file build (`dist/mogoba-pos.html`) and installable PWA | `mogoba-pos/tools/build.mjs` | Running |
| Kitchen queue, held tickets, SC/PWD, manager PIN, audit log | `www/js/core.js`, `views/orders.js` | Running |
| Stock ledger with lots, expiry, FEFO, recipes, counts, reorder | `www/js/logic.js`, `views/stock.js` | Running |
| Shift and drawer, X and Z readings, e-wallet totals | `views/drawer.js` | Running |
| Reports: sales by hour/day, payments, menu engineering, CSV | `views/reports.js` | Running |
| Customer ordering site (menu, cart, GCash/Maya QR, tracking) | `mogoba-pos/order/` | Built and tested (98 checks) |
| Small Node server (API, store snapshot, orders, sync endpoint) | `mogoba-pos/server/` | Built and tested (39 tests), not yet deployed |
| Juval's public website | ivnautomation.xyz/juvals (Hetzner VPS) | Live |

## What Juval's needs on top (small extensions, not rewrites)

1. **Kitchen routing.** Each menu item gets a `kitchen` field (grill, pizza, cafe). One order,
   one bill; the POS prints or shows one ticket per kitchen with only its lines. Reports split
   sales by kitchen. Est. 3 to 4 days.
2. **Branches.** A `branch` field on device, menu, stock, staff and orders (Juval's, Lucia's).
   Each branch runs its own tablet offline; the server merges events by branch. The owner
   dashboard switches Juval's, Lucia's, or both. Est. 4 to 6 days.
3. **Staff time clock.** A clock-in screen on the POS tablet (PIN or NFC staff card, optional
   photo), shifts per kitchen, a weekly timesheet with regular, overtime, night and holiday
   hours, and a CSV for the bookkeeper. No payroll filing. Est. 5 to 7 days.
4. **Guests and consent.** A guest record keyed by mobile number with consent date and
   source, visits, stamps and birthday month. Stamp card at the register; birthday list each
   month. Est. 3 to 5 days.
5. **Feedback and review hooks.** Receipt footer with the review QR; an optional 1 to 5
   feedback page on the receipt QR that always shows the Google link; owner alert on 1 or 2
   stars; one review request message after events and bilao orders to consenting guests.
   Est. 2 to 4 days.
6. **Events board.** Inquiry, quoted, deposit, done; deposits recorded as payments; bilao
   pre-order capacity per day. Est. 3 to 4 days.
7. **Owner dashboard.** A phone page on the server: today by kitchen and branch, labor %,
   food cost %, reviews waiting for a reply, online orders and bookings waiting, plus a
   morning summary message. Est. 4 to 5 days.
8. **Website ordering for three kitchens.** The Mogoba ordering site already supports
   categories and variants; add kitchen grouping, bilao prepay (already in contract v1.1)
   and deposits for bookings. Est. 3 to 4 days.

Rough total: 6 to 8 weeks of build spread over the roadmap, because most of the system
already exists.

## Shared records (the "one table")

Plain words, no new database product:

- **Guest**: mobile number (key), name, consent date and source, visits, stamps, birthday month, notes.
- **Order**: the POS order as today, plus kitchen per line, branch, source (counter, online,
  event), guest mobile if given, server.
- **Item and recipe**: as today, plus kitchen.
- **Staff**: as today (PIN, role), plus branch, kitchen, NFC card id, rate.
- **Time entry**: staff, clock in, clock out, branch, photo reference (optional).
- **Stock lot**: as today.
- **Event**: guest, date, guests count, package, status, deposit payments.
- **Review snapshot**: date, count, rating, unanswered count (entered or pulled weekly).
- **Campaign**: name, code word, dates, spend (entered from Ads Manager), orders tagged.

Every change is an event with an id, written on the device first and synced to the server
when there is internet (the Mogoba outbox). The server keeps one JSON or SQLite store per
branch. Nothing needs a cloud database subscription.

## Where it runs

- **Tablets** at the counter (one per branch, plus optional kitchen screens): the register
  works with no internet and syncs when it can.
- **Server**: the existing Hetzner VPS, behind Caddy, as a small Node service with daily
  backups. One server can host Juval's, Lucia's and Mogoba separately.
- **Website**: the existing static site, moved to Juval's own domain.
- **Free services we configure, not build**: Google Business Profile, Meta Business Suite
  inbox and Ads Manager, TikTok, Semaphore SMS (pay per text) for consenting guests only.

## What we deliberately do not build (over-engineering for now)

- A customer mobile app or loyalty app. The mobile number is the card.
- A Messenger chatbot through the Meta API (needs app review, adds little over saved replies).
- Integrations with Foodpanda or GrabFood.
- Paid reputation suites (Birdeye, Podium, Yext) and AI auto-posting of review replies.
- A full payroll engine that files SSS, PhilHealth, Pag-IBIG or BIR returns. We prepare the
  numbers; the bookkeeper files.
- Kitchen display screens on day one. Printers first; screens only if tickets get lost.
- Biometric fingerprint hardware. PIN or NFC card plus an optional photo is enough.
- Native Android apps. The web app installs on the tablet and works offline.
- BIR CAS/CRM-POS accreditation work before the owners decide they want the POS as their
  official invoicing system. Until then the POS prints order slips and they keep their
  BIR-registered invoices.

## Risks on the build side

| Risk | What we do |
|---|---|
| Internet drops | The register and time clock work offline and sync later. |
| A tablet breaks or is stolen | Data is synced to the server; a new tablet restores in minutes. Daily backups. |
| Two tablets in one branch | Each device numbers its receipts with its own prefix; the server merges by event id. |
| Staff misuse (voids, discounts) | Manager PIN and audit log, blind drawer counts. |
| Scope creep | Each stage starts only when the previous stage is used every day by the staff. |
| Dependence on us | Owners own domain, pages and data exports; code and backups can be handed over. |
