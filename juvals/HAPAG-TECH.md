# Hapag: how it is built

The technical half of the Hapag blueprint, for us. The business half (what each module does
for the owner, packages, roadmap, KPIs) is in `HAPAG.md`.

**Design rule: reuse before building, and build only what one provincial restaurant with a
sister business will use every week.** Everything below is either already built for Mogoba,
a small extension of it, or a free service we configure.

## What already exists (built for Mogoba, Aparri)

| Piece | Where | State |
|---|---|---|
| Register app (offline-first, vanilla JS, IndexedDB) | `mogoba-pos/www/` | Built, demo stage (not yet in daily use). 22 unit tests, full browser e2e. |
| One-file build (`dist/mogoba-pos.html`) and installable PWA | `mogoba-pos/tools/build.mjs` | Built |
| Kitchen queue, held tickets, SC/PWD, manager PIN, audit log | `www/js/core.js`, `views/orders.js` | Built |
| Stock ledger with lots, expiry, FEFO, recipes, counts, reorder | `www/js/logic.js`, `views/stock.js` | Built |
| Shift and drawer, X and Z readings, e-wallet totals | `views/drawer.js` | Built |
| Reports: sales by hour/day, payments, menu engineering, CSV | `views/reports.js` | Built |
| Customer ordering site (menu, cart, GCash/Maya QR, tracking) | `mogoba-pos/order/` | Built and tested (98 checks) |
| Small Node server (API, store snapshot, orders, sync endpoint) | `mogoba-pos/server/` | Built and tested (39 tests), not yet deployed |
| Juval's public website | ivnautomation.xyz/juvals (Hetzner VPS) | Live |

## What Juval's needs on top (small extensions, not rewrites)

1. **Kitchen routing.** Each menu item and add-on gets a `station` (Grill kitchen, Don Jose
   oven, Rosalina bar) and a `brand` tag. One order, one bill; each station prints only its own
   lines ("1 of 3"), plus a full runner slip at the cashier. Scheduled bilao and event orders get
   a "fire later" time. Order discounts are spread across brands by share, so per-brand sales
   and food cost are honest. Same idea as Toast prep stations and revenue centers. Est. 1 to 2 weeks.
2. **Printing to three kitchens with no internet.** Browsers cannot talk to network printers,
   so the counter tablet runs the same web app inside the Capacitor wrapper planned for
   Mogoba's Bluetooth printing (not built yet), and sends each station's ESC/POS lines straight to that
   station's LAN printer over the restaurant's own router. One tablet, three printers, no
   server on site. Router and tablet on a small UPS. Est. 5 to 8 days, including the wrapper.
   *Only later, if waiters take orders on their own phones or tablets:* a small always-on hub
   on the router (the existing Mogoba Node server on a mini PC) so several devices share open
   orders offline. Est. 2 to 3 weeks; not in the first build.
3. **Branches.** A `branch` field on device, menu, stock, staff and orders (Juval's, Lucia's).
   Each branch runs its own tablet offline; the server merges events by branch. The owner
   dashboard switches Juval's, Lucia's, or both. Est. 4 to 6 days.
4. **Staff time clock.** A clock-in screen on the POS tablet: 4-digit PIN plus an automatic
   front-camera photo (the Galaxy Tab A11 has no NFC, so a card tap needs a USB
   keyboard-style reader, under ₱1,000), shifts per kitchen, a weekly timesheet with
   regular, overtime, night and holiday hours, and a CSV for the bookkeeper. Daily rate stored with an effective date (a new
   Region II wage order is expected in November 2026), a yearly holiday table the manager can
   edit, a 7th-straight-day and unapproved overtime flag, simple payslips and a 13th month
   accrual. No payroll filing. Est. 7 to 9 days.
5. **Guests and consent.** A guest record keyed by mobile number with consent date and
   source, visits, stamps and birthday month. Stamp card at the register; birthday list each
   month. Est. 3 to 5 days.
6. **Feedback and review hooks.** Receipt footer with the review QR; an optional 1 to 5
   feedback page on the receipt QR that always shows the Google link; owner alert on 1 or 2
   stars; one review request message after events and bilao orders to consenting guests.
   Est. 2 to 4 days.
7. **Events board.** Inquiry, quoted, deposit, done; deposits recorded as payments; bilao
   pre-order capacity per day. Est. 3 to 4 days.
8. **Owner dashboard.** A phone page on the server: today by kitchen and branch, labor %,
   food cost %, reviews waiting for a reply, online orders and bookings waiting, plus a
   morning summary message. Est. 4 to 5 days.
9. **Website ordering for three kitchens.** The Mogoba ordering site already supports
   categories and variants; add kitchen grouping, bilao prepay (already in contract v1.1)
   and deposits for bookings. Est. 3 to 4 days.

Rough total: about 36 to 55 working days (7 to 11 weeks) of build for items 1 to 9, spread over the roadmap, because most of the system already exists. The
waiter-device hub (2 to 3 weeks) and BIR accreditation work are extra and only on request.

## Shared records (the "one table")

Plain words, no new database product:

- **Guest**: mobile number (key), name, consent date and source, visits, stamps, birthday month, notes.
- **Order**: the POS order as today, plus kitchen per line, branch, source (counter, online,
  event), guest mobile if given, server.
- **Item and recipe**: as today, plus kitchen.
- **Staff**: as today (PIN, role), plus branch, kitchen, card id (optional), daily rate with effective date, rest day, managerial yes or no.
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

## BIR: what the software must never do

- Hapag is not a BIR-accredited POS yet. Until it is, it prints kitchen tickets and a bill
  marked "not an invoice", and Juval's keeps issuing invoices from its registered booklets or
  machine (RR 7-2024 and RMC 77-2024: order slips are only supplementary documents).
- Section 264-A of the Tax Code punishes software that is designed for, *or capable of*,
  hiding, modifying or deleting sales records (₱500,000 to ₱10,000,000 and prison). So before
  Hapag records any taxable sale: no sale delete, no editing a closed sale, voids and refunds
  only as append-only entries with a reason and PIN, and a restore can never roll back sales
  history. The Mogoba backup-restore and wipe paths must be locked for production use.
- Accreditation path, when the owners want Hapag as their invoicing machine: IVNautomation
  applies as the developer under RMO 24-2023 (free; demo within 3 working days; certificate
  within 20 working days after the demo), after building the 13 required features (accumulated
  grand total, MIN, invoice series, e-journal, Z counter, reprint control, backend reports, sales
  data transmission and the rest). Then each terminal gets a Permit to Use from the RDO. One
  accreditation also covers Mogoba and future clients.
- E-invoicing (EIS): POS users are in a later group under RR 11-2025 and micro taxpayers are
  exempt, so nothing to build now. The owners' accountant should confirm whether online orders
  put Juval's in the e-commerce group.
- Senior and PWD: the 20% applies only to the cardholder's own share. Hapag needs a
  most-expensive-meal (MEMC) base mode for bilao, online and phone orders (RMC 71-2022,
  DOJ Opinion 45-2024), on top of the per-person pro-rata mode Mogoba already has.
- Service charge (only if they charge one): 100% to non-managerial staff, equally by hours
  worked, at least every two weeks (RA 11360, DO 242-2024). Hapag keeps it out of revenue.

## What we deliberately do not build (over-engineering for now)

- A customer mobile app or loyalty app. The mobile number is the card.
- A Messenger chatbot through the Meta API (needs app review, adds little over saved replies).
- Integrations with Foodpanda or GrabFood. GrabFood does not operate in Cagayan, and Foodpanda
  lists one restaurant in Aparri; key the odd app order in by hand.
- Paid reputation suites (Birdeye, Podium, Yext) and AI auto-posting of review replies.
- A full payroll engine that files SSS, PhilHealth, Pag-IBIG or BIR returns. We prepare the
  numbers; the bookkeeper files.
- Kitchen display screens on day one. Printers first (an impact printer at the hot grill);
  one small screen at the Rosalina counter later if they want drink timing.
- BIR e-invoicing transmission (later regulation; micro taxpayers exempt).
- Payment gateway checkout (PayMongo, Maya Checkout) until manual QR checks take more than about
  15 minutes of staff time a day. Business QR at about 1% is enough to start.
- Biometric fingerprint or face-template hardware, GPS tracking and a staff app. PIN plus a photo at the counter tablet is enough.
- A separate native app. The one web app runs in the browser for staff screens and inside the thin
  Capacitor wrapper on the counter tablet only for printing.
- BIR CAS/CRM-POS accreditation work before the owners decide they want the POS as their
  official invoicing system. Until then the POS prints order slips and they keep their
  BIR-registered invoices.

## Risks on the build side

| Risk | What we do |
|---|---|
| Internet drops | The register and time clock work offline and sync later. |
| A tablet breaks or is stolen | Data is synced to the server; a new tablet restores in minutes. Daily backups. |
| Two tablets in one branch | Each device numbers its receipts with its own prefix; the server merges by event id. |
| A kitchen printer is off or out of paper | The tablet shows the failed station ticket and reprints it; the runner slip at the cashier lists every line, so nothing is lost. |
| Staff misuse (voids, discounts) | Manager PIN and audit log, blind drawer counts. |
| Scope creep | Each stage starts only when the previous stage is used every day by the staff. |
| Dependence on us | Owners own domain, pages and data exports; code and backups can be handed over. |
