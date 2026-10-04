# Hapag: blueprint for Juval's Grill & Restaurant and Lucia's

Prepared by IVNautomation, Cagayan, on 4 October 2026. This is the business half of the blueprint.
The build notes (what exists, what we extend, BIR safeguards) are in `HAPAG-TECH.md`; the six
research briefs with every source are in `RESEARCH.md`; the meeting guide is `REVIEWER.md`.

How to read the numbers: every figure comes from one of the six research briefs (reviews, ads, web, POS, staff, loyalty), or it is marked **(our estimate)**. The US studies (BrightLocal, Luca, Anderson and Magruder, Proserpio and Zervas) only show direction for a provincial Philippine restaurant. Before we quote any sales figure to the owners, we replace it with their own first-month numbers.

---

## 1. The problem today

Juval's has what most highway restaurants lack: three kitchens under one roof (Juval's Grill, Don Jose Pizza & Pasta, Rosalina Cafe), a garden, a rattan event hall and a bilao trade. The weak points are in how guests find it, choose it, order, come back, and how the place is run behind the counter.

**Being found**
- The website is live and works, but it still sits on our address (ivnautomation.xyz/juvals) until we move it to a domain in the owners' name. Its 21 images weigh 2.97 MB. The hero photo alone is 535 KB, there is no WebP and no cache header, so repeat visitors on weak provincial signal download everything again.
- The structured data uses relative image URLs. It also lists Tuesday closing at 21:30, while the brief says 9 AM to 9 PM daily. The owners need to confirm the real hours.
- The Google Business Profile still needs cleaning up: categories, menu, 30 or more photos, reservation and order links, and weekly posts. Secondary summaries of Whitespark 2026 put profile signals as the largest local ranking group, at a reported 32% (not verified against the primary chart).

**Being chosen**
- There are 27 Google reviews at 4.1 stars. BrightLocal 2026 (US adults) found that 47% will not use a business with fewer than 20 reviews, 68% need at least 4 stars, 31% only use businesses rated 4.5 or higher (up from 17% in 2025), and 74% look for reviews from the last 3 months.
- 80% are more likely to use a business that replies to all its reviews. There is no ask routine and no reply routine today.
- Luca (Harvard Business School, Yelp data): one extra star brought 5 to 9% more revenue, for independent restaurants only.

**Taking the order**
- Bilao, catering and hall bookings come in through Messenger threads and phone calls. There is no shared hall calendar and no deposit record, and deposits can land in personal GCash accounts.
- GCash warned on 14 July 2025 about AI-generated fake payment screenshots.
- Delivery apps do not solve this. GrabFood does not operate anywhere in Cagayan Valley. Foodpanda's Aparri page lists one restaurant, and riders reaching Dacal la Fugu is unverified. Commissions are commonly estimated at 25 to 30% of each order.
- One table ordering sisig, pizza and milk tea touches three kitchens. Whatever Juval's uses today (to be confirmed) does not split that order by kitchen. Our own Mogoba POS (built, at demo stage, not yet in daily use) sends one ticket per order with no station routing yet.

**Bringing guests back**
- There is no list of guests who agreed to be contacted, so promos by SMS or Messenger cannot lawfully go out. Unauthorized processing under the Data Privacy Act carries 1 to 3 years in prison and a PHP 500,000 to 2,000,000 fine.
- Messenger promos are allowed only within 24 hours of the guest's last message.
- There is no private feedback channel, so a bad night becomes a public review.

**Running the place**
- Food cost: the Philippine target is 28 to 35% of revenue, and above 40% signals a problem. Ingredient costs have risen 15 to 25% since 2024, and waste costs 5 to 10% of revenue. Without recipe depletion and counts, nobody sees the leak. On PHP 400,000 of monthly sales, each food cost point recovered is PHP 4,000 a month (illustration from the POS brief).
- Labor: the Region II minimum has been PHP 500 a day since 5 November 2025, and a new order is expected in November 2026. One minimum-wage worker costs about PHP 16,100 a month all-in. The 13th month is due 24 December 2026. 24, 25, 30 and 31 December are premium-pay days in the busiest event month.
- BIR: Mogoba prints an "ORDER SLIP" and is not an accredited invoicing machine. Any Hapag rollout has to respect that from day one.

**Unknowns to confirm in week 1:** covers a day, average check, monthly sales, staff count per business, VAT status, how invoices are issued today, whether the three brands are registered separately, and Lucia's address and ownership. The briefs used these working assumptions: 80 to 100 guests a day, a PHP 300 to 400 average check and about PHP 840,000 a month **(our estimates)**.

---

## 2. Vision in one sentence

Hapag puts every guest, order, kitchen ticket, stock lot, shift and review of Juval's and Lucia's on one table, so the owners read yesterday on their phone at 8 AM, and the restaurant keeps running when the internet does not.

---

## 3. Modules

| # | Module | How it is delivered | Package |
|---|---|---|---|
| 1 | Website and ordering | Built by us (site exists); ordering reused from the Mogoba customer site | Tanaw (site), Hapag Buo (ordering) |
| 2 | Google reviews with NFC cards | Set up on Google (free) plus a locally printed kit; review hooks built in Hapag | Tanaw |
| 3 | Ads and campaigns | Set up on Meta and TikTok; SMS sender and attribution built by us | Suki |
| 4 | POS for three kitchens | Reused from Mogoba (about 70% of what is needed), extended by us | Hapag Buo |
| 5 | Stock and food cost | Reused from Mogoba, extended by us | Hapag Buo |
| 6 | Staff time and payroll prep | Built by us | Hapag Buo |
| 7 | Loyalty and feedback | Built by us on the Mogoba customer record | Suki |
| 8 | Events and catering | Built by us; reuses Mogoba orders and payment checks | Suki |
| 9 | Owner dashboard | Built by us on Mogoba reports | Hapag Buo (simple monthly report in lower tiers) |

### 3.1 Website and ordering
- **Owner gets:** a domain in their own name (juvals.ph at about PHP 2,549 a year), a site fast enough for provincial phones, and orders and inquiries that land in Hapag instead of scattered chats.
- **Guest sees:** a quick menu for all three kitchens, one cart, a pickup time, cash or QR Ph payment, an event inquiry with clear deposit and cancellation terms, and an SC/PWD option.
- **Features that matter:**
  1. Own domain, with a 301 redirect from the old address.
  2. A speed pass: hero under 120 KB, first screen under 300 KB, one-year image caching, LCP within 2.5 s.
  3. Crawlable pages per brand (/grill, /don-jose-pizza, /rosalina-cafe, /bilao) with schema.org Menu data and absolute URLs.
  4. One cart across three kitchens. It has pickup slots, a bilao lead-time rule and an optional flat-fee delivery to Camalaniugan, Aparri and Lal-lo.
  5. QR Ph payment checked by reference number, amount, name and time; a reused reference is blocked. The footer carries the Internet Transactions Act disclosures (business name, address, contact, refund terms).
- **Left out:** a native app (the web app installs to the home screen), a payment gateway, Reserve or Order with Google partner integrations, GrabFood, our own rider app, and table booking for ordinary tables. The gateway waits until manual checks take more than about 15 minutes a day (our rule of thumb).
- **Connects:** every web order is an order record with source "web", tied to the guest by mobile number. Event inquiries become event records.
- **Delivery:** built by us. Ordering reuses the Mogoba customer ordering site and its manual QR verification.

### 3.2 Google reviews with NFC cards
- **Owner gets:** a steady, policy-safe flow of reviews, an alert when a guest rates 1 or 2 stars privately, and a monthly reputation snapshot.
- **Guest sees:** a "Tap or scan" table tent and bill folder, a review QR on every receipt and bilao label, and one polite ask from staff when the bill arrives.
- **Features that matter:**
  1. Clean up the profile: one profile for the venue, with all three kitchens in the menu, description and photos, and a separate profile for Lucia's.
  2. A /review redirect on the site. Printed links never break, and taps are counted per server (for example /review?s=ana) for coaching only.
  3. Table tents and server cards with NTAG213 or NTAG215 chips, written and locked, with a large QR beside every chip. Many budget Android phones lack NFC or have it switched off.
  4. A review QR on the receipt footer. After an event, reservation or bilao order, one message goes to customers who consented.
  5. Replies to every review within 48 hours, in the reviewer's language (Ilocano, Filipino or English). Hapag drafts the reply and the owner approves it.
- **Left out:** Birdeye, Podium, Yext, branded stands at A$27 to 49, on-premises review kiosks, AI auto-posting, separate profiles for Don Jose or Rosalina, and any incentive, raffle or "review night".
- **Connects:** the review record (monthly count, rating and newest review age) and private feedback tied to the order, table and server.
- **Delivery:** set up on Google for PHP 0, plus a kit at about PHP 3,500 to 7,500 one-time. Hooks are built in Hapag in 2 to 4 days.

### 3.3 Ads and campaigns
- **Owner gets:** Messenger conversations that turn into bilao orders and bookings, counted by inbox label and by a "How did you hear?" question at the register.
- **Guest sees:** Click-to-Messenger ads within about 20 to 25 km, weekly posts, short TikTok clips (batil patong pour, sizzling sisig, pizza pull, Rosalina drinks), and SMS only after opting in.
- **Features that matter:**
  1. The Meta Business Suite inbox gets an instant greeting, quick replies (hours, bilao prices, hall, directions) and labels BILAO, EVENT, RESERVE, ASK and LUCIAS.
  2. Click-to-Messenger ads in three budget tiers (section 6). A separate Tuguegarao ad set runs only for trays and the hall.
  3. Organic TikTok, 3 clips a week. Spark-boost only the clips that already work. One or two nano creators a quarter at PHP 1,000 to 5,000.
  4. Consent capture plus a Semaphore SMS sender with a registered sender name, a cost preview and automatic exclusion of opt-outs, at PHP 0.56 a text before VAT. No shortened links.
  5. Attribution at the register (pick list plus a campaign code word). The pre-order calendar tells us when to pause ads because the kitchen is full.
- **Left out:** a Messenger chatbot through the API, the Marketing Messages API, Google search ads, TikTok Shop, a separate Instagram budget, an agency retainer (about PHP 5,800 an hour), text-blaster devices, and share-to-enter raffles.
- **Connects:** guest consent fields, the order's source field, and the event pipeline.
- **Delivery:** set up on existing Meta and TikTok tools. The SMS sender and attribution are built by us (3 to 4 days).

### 3.4 POS for three kitchens
- **Owner gets:** one bill under the registered name, sales split by brand, service that continues through internet outages, and sales records nobody can delete.
- **Guest sees:** one order for sisig, pizza and milk tea, with the items arriving together and the SC/PWD discount applied correctly to their own share.
- **Features that matter:**
  1. Station routing. Each item is assigned to Grill, Don Jose or Rosalina. One order prints one ticket per kitchen ("1 of 3"), plus a runner slip, with "fire later" for scheduled bilao and event orders.
  2. A brand tag on every item. Reports show sales, top items and food cost per brand, and order discounts are spread across brands in proportion.
  3. Printing with no internet. The counter tablet sends each kitchen its own ticket straight to that kitchen's printer over the restaurant's own router; sales sync to the cloud when the internet is back. A small on-site hub is added only later, if waiters take orders on their own devices.
  4. SC/PWD done right: pro-rata to the cardholder's share, an MEMC base for bilao and phone orders, and only the ID number and name recorded.
  5. Append-only voids and refunds with a reason, a manager PIN and a log. There are X and Z readings, a blind drawer close, and GCash or Maya totals checked against the wallet app.
- **Left out:** BIR e-invoicing transmission, delivery-app APIs, handhelds at every table, card terminals, a wall of KDS screens, and AI forecasting.
- **Connects:** order, item, staff, shift and payment.
- **Delivery:** reused from Mogoba and extended. Routing and brand tags take 1 to 2 weeks, and printing to the kitchens 5 to 8 days. Until accreditation, the printed bill says it is not an invoice (section 8).

### 3.5 Stock and food cost
- **Owner gets:** weekly food cost % per brand, the gap between what should have been used and what was used for the top 15 to 20 ingredients, and expiry alerts.
- **Guest sees:** fewer "sorry, sold out" moments and steady portions.
- **Features that matter:**
  1. Recipe depletion with sub-recipes: pizza dough, pancit sauce, milk tea syrup, marinated pork.
  2. Yield factors for cooking loss (crispy pata, lechon kawali trim), and bilao trays as multiples of base recipes.
  3. Stock lots with expiry dates used first-expiring-first, plus a waste ledger and blind counts. These already exist in Mogoba.
  4. A weekly actual-vs-theoretical count for pork, chicken, rice, oil, noodles, cheese, flour, coffee and milk.
- **Left out:** automated purchase orders, central purchasing across branches, accounting-software sync and demand forecasting.
- **Connects:** item, stock lot and order. Event BEOs reserve stock ahead of the event.
- **Delivery:** reused from Mogoba, with 1 to 2 weeks of extensions.

### 3.6 Staff time and payroll prep
- **Owner gets:** labor cost next to each kitchen's sales every day, a payroll register the bookkeeper can use, and the 13th month amount by November.
- **Staff see:** a PIN clock-in on the counter tablet and a payslip (printed, or an image sent by Messenger).
- **Features that matter:**
  1. Clock in with a PIN plus an automatic front-camera photo. It works offline and syncs through the Mogoba outbox. The Galaxy Tab A11 has no NFC, so card taps need a USB reader.
  2. A Philippine pay rules engine covering overtime +25%, night +10% from 10 PM to 6 AM, rest day and special day 130%, and regular holiday 200%, with the worked-the-day-before check. The holiday and wage tables carry effective dates, ready for the November 2026 order.
  3. Flags for a 7th straight day, more than 8 hours without approval, and a meal break under 60 minutes.
  4. A semi-monthly register CSV, payslips, the 13th month report and SSS, PhilHealth and Pag-IBIG lines, all marked "for bookkeeper review".
  5. A service charge split by hours among non-managerial staff, only if one is charged.
- **Left out:** filing or remitting to SSS, PhilHealth, Pag-IBIG or BIR; fingerprint or face templates; GPS; auto-scheduling; a staff app; wage payouts to e-wallets; a full HR module. A simple weekly schedule board comes only after the clock is used daily.
- **Connects:** staff and shift, with the labor cost feeding the dashboard.
- **Delivery:** built by us: 7 to 9 days for the clock, pay rules, payslips and 13th month, then 4 to 6 more for the schedule board, labor % and service charge.

### 3.7 Loyalty and feedback
- **Owner gets:** a suki list with recorded consent, the share of sales from returning guests, and lists of lapsed regulars and this month's birthdays.
- **Guest sees:** a mobile number given at checkout, the stamp balance on the receipt, a birthday treat, and a 20-second private feedback page.
- **Features that matter:**
  1. A guest record keyed by mobile number, with consent date and source, a marketing yes or no, birthday month only, and brands and branch visited.
  2. Stamps: 1 per PHP 300 of net spend, valid across Juval's Grill, Don Jose, Rosalina and Lucia's. 5 stamps earn a Rosalina drink. 10 stamps earn a pizza or a small pancit bilao, a food cost of about 4.5% of qualifying spend.
  3. A birthday-week treat for members who joined at least 7 days before and visited in the last 90 days.
  4. Automatic groups: regulars (3 visits in 6 months) and lapsed (regulars absent 6 weeks).
  5. Private feedback, 1 to 5 stars with tap reasons, tied to the order, table and server. The Google link shows on the same screen for every score, and a 1 or 2 alerts the owner's phone.
- **Left out:** an app, plastic cards, a paid membership, points tiers, drip campaigns, and full birth dates, addresses or ID photos.
- **Connects:** guest, order and review.
- **Delivery:** built by us in 3 to 5 days for the list and stamps, 1 day for birthdays and 2 to 4 days for feedback.

### 3.8 Events and catering
- **Owner gets:** one board for every inquiry, no double-booked hall, deposits recorded against each event, and a BEO that prints to each kitchen.
- **Guest sees:** an inquiry form, a quote within 24 hours with 3 package options, written deposit and cancellation terms, and a thank-you after the event.
- **Features that matter:**
  1. A pipeline: Inquiry, Quoted, Deposit paid, Confirmed, Done, Lost. It shows inquiries, the quote-to-deposit rate and peso value by month.
  2. A 3-day tentative hold. The date is confirmed only when the deposit is recorded.
  3. A 50% deposit by business QR (QR Ph at about 1.0%), checked by reference number. This is our policy suggestion, since no published norm was found.
  4. A BEO sheet per kitchen (menu, headcount, garden or hall setup, timeline). The final headcount is due 3 days before, and the tickets fire later.
  5. A same-day thank-you plus the Google link in the open Messenger thread. One year later, a rebook message goes out if the guest consented.
- **Left out:** e-signatures, card-on-file deposits, a payment gateway and a Perfect Venue style subscription (about PHP 12,000 to 20,000 a month).
- **Connects:** the event links to guest, orders, payments and stock.
- **Delivery:** built by us in 3 to 4 days, reusing Mogoba orders and payment checks.

### 3.9 Owner dashboard
- **Owner gets:** one phone page and one 8 AM message.
- **Contents:**
  - Yesterday's sales by kitchen and by branch, against the same weekday last week.
  - Covers and average check, and the share of sales from suki numbers.
  - New members and lapsed regulars.
  - Google rating, review count and unanswered reviews.
  - Feedback alerts, and this week's events and deposits due.
  - Weekly food cost % and labor %.
- **Left out:** report menus nobody opens, BI tools and custom report builders.
- **Connects:** it reads every shared record and writes none.
- **Delivery:** built by us on Mogoba reports in 4 to 5 days. Tanaw and Suki get a monthly 1-page report instead.

---

## 4. Shared data, in plain words

Hapag keeps a handful of records. Every module reads and writes the same ones, so nothing is typed twice.

- **Guest:** one person, keyed by mobile number. It holds their name, whether and when they agreed to marketing, their birthday month, visits, stamps, the brands and branch they use, and notes. No ID photos and no full birth date.
- **Order:** one visit or one purchase, whether dine-in, pickup, web, phone, bilao or event. It records where it came from (walk-in, ad, Google, friend), the table, the server, the payments with reference numbers, the discounts, and the branch. Voids and refunds are added as new lines and never erase anything.
- **Item:** something on the menu. It belongs to a brand (Grill, Don Jose, Rosalina), prints at a kitchen station, has a price per branch and a recipe.
- **Staff:** one worker, with their branch, home kitchen, role, daily rate with effective date, rest day, and whether they are a manager.
- **Shift:** a clock-in and clock-out with a photo. It is split by the pay rules into regular, overtime, night, rest day and holiday hours, and it carries the drawer count for cashiers.
- **Stock lot:** one delivery of one ingredient, with its quantity, cost, expiry date and branch. Sales, waste and transfers draw it down.
- **Review:** either a monthly Google snapshot (count, rating, newest review age, unanswered) or a private feedback entry tied to an order, table and server.
- **Event:** one booking for the hall, catering or a big bilao order. It links a guest to its quote, deposit, BEO, orders and stock.

---

## 5. Phased roadmap

Today the website is live and the Mogoba POS is built and demo-ready (not yet in daily use).
This matches slide 16 of the deck. Each stage starts only when the one before it is used by the
staff every day.

### Next 2 weeks (5 to 18 October 2026)
- **Discovery:** confirm staff count, VAT status, current invoicing, sales, brand registration and Lucia's details. Record baselines for review count, rating, payroll cutoff time and the competitor review counts in the local pack.
- **Google:** clean up the profile. Set up the review link, QR and /review redirect. Order the NFC and QR table kit.
- **Website:** register the owners' domain (juvals.ph), apply the 301 redirect, do the speed pass and fix the structured data.
- **Meta:** set up the inbox greeting, quick replies and labels, and add the consent checkbox to the inquiry form. Hold one shoot day for photos and clips.
- **Ads:** start Tier A on 12 October with Undas bilao pre-orders.

### By day 90 (about 3 January 2027)
- **Events:** the events board with 3-day holds, deposits by business QR and BEO sheets.
- **Guests:** the suki list with consent, stamps, private feedback with owner alerts, and the opt-in SMS sender.
- **Staff:** the PIN-and-photo time clock and pay rules running before the December holiday payroll and the 24 December 13th month. The new Region II wage rate is loaded on its effective date.
- **Ordering:** bilao pre-orders paid by QR through the website and Messenger.
- **Campaigns:** Undas, Christmas and New Year, moving through Tier B and Tier C, and a scorecard in week 13.
- **Target:** about 72 Google reviews (our base-case projection).

### By month 6 (April 2027)
- **POS:** Hapag POS live at Juval's, one kitchen at a time, with station routing, brand tags, printing to each kitchen and append-only records. Invoices still come from registered booklets or the existing registered machine.
- **Stock:** sub-recipes, yields and the weekly actual-vs-theoretical count. Food cost % per brand is reported weekly.
- **Dashboard:** the owner's phone page and the 8 AM message.
- **Ordering:** direct pickup ordering on the website with one cart and QR Ph, landing in the POS.
- **Campaigns:** Chinese New Year, Holy Week travelers and graduation parties.
- **Target:** about 117 reviews and a rating of about 4.3.

### By month 12 (October 2027)
- **Lucia's:** added as a second branch, with its own Google profile, stock, shifts and Z-readings, plus a shared item catalog and a shared suki list.
- **BIR, only if the owners want Hapag as their invoicing machine:** build the 13 accreditation features (4 to 6 weeks), apply under RMO 24-2023, then a Permit to Use per terminal. Quoted separately.
- **Review the data:** decide on points tiers, a payment gateway, a café screen and foodpanda, using the actual numbers.
- **Target:** about 207 reviews, a rating of about 4.5 and the newest review never more than 2 weeks old.

---

## 6. Packages, fees and hardware

Our fees are proposals priced against the benchmarks in the briefs. Each figure is a point we chose inside the brief's range.

| | Tanaw (be found and trusted) | Suki (bring them back) | Hapag Buo (run the whole place) |
|---|---|---|---|
| Setup | PHP 10,000 (range 8,000 to 12,000) | PHP 30,000 (range 25,000 to 35,000) | PHP 60,000 (range 45,000 to 70,000) |
| Monthly | PHP 5,000 (range 4,000 to 6,000) | PHP 9,000 (range 8,000 to 10,000) | PHP 14,000 (range 12,000 to 15,000) |
| Includes | Domain move and site upkeep, speed pass, Google profile clean-up, review kit setup and reply routine, Messenger inbox setup, 8 Facebook posts a month, monthly 1-page report | Everything in Tanaw, plus the suki list with stamps and birthdays, private feedback with alerts, the events board with deposits and BEO, the SMS sender, and Click-to-Messenger ad management with a monthly scorecard | Everything in Suki, plus the three-kitchen POS with printing to each kitchen, stock and food cost, time clock and payroll prep, and the owner dashboard and 8 AM message. BIR accreditation work is quoted separately, only if wanted |
| For | Owners who want visibility first, with no new system to learn | Owners whose events and bilao trade matter most | Owners ready to run the counter, kitchens and staff on one system |

- Lucia's POS terminals add PHP 1,000 a month once they go live (from the POS brief).
- When upgrading, the setup fee already paid is credited (our offer).
- **Fairness check:** keep the monthly fee under about 1.5 to 2% of monthly sales (our rule of thumb). On the illustrative PHP 840,000 that is PHP 12,600 to 16,800, so we confirm real sales before quoting Hapag Buo.
- **What separate vendors would charge:**

| Need | Vendor price |
|---|---|
| POS | StoreHub PHP 2,249 to 8,999 a month; UTAK about PHP 1,500 after the first 6 months |
| Payroll | Sprout Payroll Starter PHP 15,000 a month on a 1-year contract |
| Reviews | Birdeye about PHP 18,000 to 27,000 a month |
| Events | Perfect Venue about PHP 12,000 to 20,000 a month |
| Restaurant platform | Owner.com about PHP 15,000 to 30,000 a month |

  A stack of separate tools comes to more than PHP 25,000 a month.

### Paid to third parties (separate from our fee)

| Item | Cost | Source |
|---|---|---|
| Domain .ph or .com.ph | PHP 2,549 a year (DomainWink); .com about PHP 888 renewal | web brief |
| Ad spend, Tier A "Bantay" (always on) | PHP 5,000 + 12% VAT = PHP 5,600 a month | ads brief |
| Ad spend, Tier B "Growth" | PHP 13,000 + VAT + one creator, about PHP 16,560 | ads brief |
| Ad spend, Tier C "Season push" (December, Holy Week, fiestas) | about PHP 38,720, max about 4 weeks per creative | ads brief |
| SMS (Semaphore) | PHP 0.56 a text + VAT; about PHP 35 a month for 60 review requests; about PHP 630 per 1,000-person blast | reviews and ads briefs |
| QR Ph payments | about 1.0% (Maya Business; GCash for Business reported at 1.0%) | web brief |
| Review table kit | PHP 3,500 to 7,500 one-time | reviews brief |
| Counter privacy and loyalty signs | PHP 500 to 1,000 (printing unverified) | loyalty brief |
| Optional internet backup | Starlink Residential PHP 4,099 a month | POS brief |

### Hardware list (Hapag Buo, at cost, about PHP 35,000 to 60,000 in total)

| Item | Qty | Peso price |
|---|---|---|
| Samsung Galaxy Tab A11 Wi-Fi (counter POS and clock-in; second unit for Lucia's or as a spare) | 2 | PHP 7,990 each (promo PHP 6,990) |
| Grill: 80 mm LAN printer, impact type if near heat (Xprinter 76IIN) | 1 | PHP 9,980 (thermal D600 PHP 8,200 to 10,880) |
| Don Jose: 80 mm LAN thermal printer | 1 | PHP 1,408 to 10,880 (low end unverified) |
| Rosalina: 58 mm printer (LAN model preferred, so the counter tablet can reach it) | 1 | PHP 1,190 to 3,798 |
| Cashier: 80 mm receipt printer (Xprinter D600) | 1 | PHP 8,200 |
| Cash drawer | 1 | PHP 1,890 to 4,500 |
| Router and small UPS for the counter tablet and printers | 1 set | quote locally (our estimate, not in the briefs) |
| Optional USB card reader for clock-in | 1 | PHP 400 to 900 (unverified) |

For comparison, the UTAK complete bundle is PHP 49,999 and includes only 6 months of software. StoreHub's hardware starts at PHP 21,339, plus PHP 3,571 for the drawer and PHP 6,026 for the printer.

---

## 7. KPIs

| Measure | Today | Month 6 | Month 12 | Why it matters | Basis |
|---|---|---|---|---|---|
| Google reviews | 27 | about 117 | about 207 | 47% skip places under 20 reviews; volume and recency drive Maps rank | our base-case projection |
| Google rating | 4.1 | about 4.3 | about 4.5 | 31% of consumers only use places rated 4.5+ | our projection, if new reviews average about 4.4 then 4.6 |
| Age of newest review | not tracked | under 14 days | under 14 days | 32% look for reviews from the last 2 weeks | our target |
| Reviews answered within 48 h | not tracked | 100% | 100% | 80% favor businesses that reply to all | our target |
| Cost per Messenger conversation | no ads tracked | PHP 20 to 60 | PHP 15 to 50 | Shows which peso of ad spend works | our padded target from the ads brief |
| Event and bilao inquiries on the board with a deposit record | not tracked | 100% | 100%, quoted within 24 h | Stops double-booking and no-shows | our target |
| Food cost % per brand, weekly | not measured | measured weekly | 28 to 35% | PH benchmark; above 40% is a problem | Klikit 2026 |
| Labor % of sales | not measured | baseline set | at or below baseline | Labor runs 25 to 35% in PH rules of thumb | our target on the owners' own baseline |
| Share of sales from returning suki numbers | not measured | baseline set | above the month 3 baseline | Measures whether loyalty works | our target |
| Payroll prep time per cutoff | measured in week 1 | lower than baseline | lower than baseline | Hapag computes, the bookkeeper files | our target |

We will not promise a sales lift. The only figure we use to show direction is Luca's: 5 to 9% revenue per extra star for independents, US data. On illustrative numbers, 4.1 to 4.4 stars (+0.3) would be about PHP 12,600 to 22,700 a month **(our arithmetic)**.

---

## 8. Compliance in plain words

**BIR**
- **What we can claim:** Hapag runs ordering, kitchen tickets, stock, shifts and management reports, and it keeps sales records that cannot be deleted.
- **What we cannot claim:** Hapag is not a BIR-accredited POS today, and its slips are not invoices. Mogoba prints "ORDER SLIP". Order slips and billing statements are only supplementary documents.
- **Until accreditation:** Juval's keeps issuing registered invoices from ATP booklets or its existing registered machine. The Hapag bill carries a "not an invoice" line (exact wording to be confirmed with the RDO). A VAT-registered seller must invoice every sale. A non-VAT seller must invoice sales of PHP 500 or more, when asked, and as one end-of-day invoice for small sales adding past PHP 500.
- **The accreditation path:**
  - A custom POS can be accredited under RMO 24-2023. As developer, IVNautomation applies, and the application is free.
  - BIR sets the demonstration within 3 working days of a complete application and issues the certificate within 20 working days after it.
  - The system needs 13 features, including an accumulated grand total, MIN, e-journal, Z counter, reprint control and sales data transmission.
  - After that, each register needs its own Permit to Use, and invoices must show the TIN with branch code, MIN and a running number.
  - How long BIR takes in practice is unverified. The same accreditation then also covers Mogoba.
- **No delete, ever:** under Sec. 264-A, software that is "capable of" hiding or deleting sales records carries a PHP 500,000 to 10,000,000 fine and 2 to 4 years in prison. Voids and refunds are append-only, and restoring a backup never rolls back sales. Mogoba's restore and wipe paths get locked down before Hapag records taxable sales.
- **E-invoicing:** POS users are scheduled in a later group, and micro taxpayers are exempt. The accountant should check whether web or Messenger orders put Juval's in the e-commerce group due 31 December 2026.
- **Brands and branches:** if the three brands share one registration (their accountant to confirm), brand names appear on invoices for branding only. Lucia's needs its own branch code or its own registration. Books are kept for 5 years.
- **SC/PWD:** 20% off plus VAT exemption, applied only to the cardholder's own share, and also for online and phone orders (JMC 01-2022). Only the ID number and name are kept.

**Google review policy**
- Ask everyone the same way.
- No reward of any kind for a review: no free drink, discount or raffle.
- No gating. The Google link shows to every guest on the feedback page.
- No pressure on the premises, no staff quotas, and no asking guests to name a server.
- No reviews from owners, staff or family.
- Steady flow, not bursts. Google removed 292 million reviews in 2025, and a July 2026 sweep wiped thousands of profiles.

**Data Privacy Act (RA 10173)**
- A phone number given for a booking may be used for that booking. Marketing, stamps and birthday messages need a separate, unticked opt-in with the date and source recorded, and "STOP" is honored before the next send.
- Old order books, GCash histories and staff phones are never used as marketing lists.
- A privacy notice goes at the counter, on the form and in the first message, and the owners name a compliance officer.
- Guest data is PIN-locked, backups are encrypted, and there is a breach plan.
- Staff clock-in photos are seen only by the manager and deleted after a 60-day dispute window (our recommendation). No face templates and no GPS.
- NPC registration is likely not required at Juval's size, but the count of stored SC/PWD ID numbers is worth watching against the 1,000-person line.

**DOLE**
- **Wage:** PHP 500 a day minimum for non-agriculture (RTWPB 2-24, from 5 November 2025). A new order is expected in November 2026. No rate goes below PHP 500 without a written RTWPB exemption or a BMBE certificate.
- **Hours and premiums:**
  - Overtime +25%, night hours from 10 PM to 6 AM +10%.
  - Rest day and special day 130%; special day on a rest day 150%.
  - Regular holiday 200% if worked, 100% if not (with the attendance rule).
- **Rest and leave:** 24 hours off after 6 days. 5 days of service incentive leave after a year, unless the business is exempt under 10 workers. Assume no exemption until the count is confirmed.
- **Pay:** paid at least every 2 weeks. The 13th month (1/12 of basic) is due by 24 December.
- **Service charge, if one is charged:** 100% goes to non-managers, split equally by hours, at least every 2 weeks.
- **Deductions and records:** no automatic deduction for shortages or breakage, and cash advances are signed loans. Time and pay records are kept at least 3 years, ready for inspection.
- **Filing:** the bookkeeper files SSS, PhilHealth, Pag-IBIG and BIR. Hapag only prepares the figures.

**Other rules**
- **Messenger:** promos only inside the 24-hour window.
- **DTI:** raffles and contests need a DTI sales promotion permit, filed about 30 days ahead.
- **Ads VAT:** 12% VAT applies to Meta and TikTok ad spend.
- **Internet Transactions Act:** the online ordering page shows the business name, address, contact, prices and refund terms.

---

## 9. Risks and how we handle them

| Risk | How we handle it |
|---|---|
| BIR accreditation is slow or refused | Registered invoices continue in the meantime, and Hapag never prints anything that looks like an invoice. If BIR timing becomes decisive, a registered invoicing POS such as StoreHub Starter (PHP 2,249) can sit beside Hapag. |
| Sales records judged "suppressible" | No deletes, append-only voids with PIN and log, and backups that cannot roll back sales. Locked down before any taxable use. |
| Internet outages | The counter tablet works offline and prints to the kitchens over the restaurant's own router, on a UPS; an offline outbox syncs later. Starlink backup is optional. |
| Fake GCash or Maya screenshots | Check reference, amount, name and time in the merchant app. Reused references are blocked, and a manager PIN is needed above a set amount. |
| Review habit fades | The ask is built into bill delivery, server cards are logged for coaching, and the monthly snapshot shows the newest review age. No quotas. |
| Review spam sweep | Steady flow only, no event "review nights", and no family or staff reviews. |
| Average rating stalls near 4.3 | Fix the complaints that private feedback surfaces before pushing for volume. |
| Small ad audience gets tired of the same ads | Cap the radius budget, rotate creative every 2 to 3 weeks, and pause when the pre-order calendar is full. |
| NFC fails on budget phones | A QR code beside every chip, and tags written and locked. |
| Wage order or holiday list changes | Rates and holidays are editable tables with effective dates, updated once a year. |
| Staff resistance to new tools | Printers before screens, PIN clock-in, phased rollout, and training at the venue. |
| Data breach or misuse | Collect the minimum, PIN-lock guest data, encrypt backups, name a compliance officer and keep a breach plan. |
| Depending on one small vendor (us) | The owners own the domain, accounts and data. There is a CSV export of every record and written run notes. |
| Scope creep | Each phase must prove itself on the KPIs before the next starts, and the "not now" list is agreed in writing. |
| Kitchen heat ruins hardware | An impact printer at the grill, and tablets kept away from the fryer. |
| Online orders pull Juval's into e-invoicing | The accountant checks before 31 December 2026. |

---

## 10. "Not now" list

| Sounds good | Why not now | When it would make sense |
|---|---|---|
| Native iOS or Android app | The web app installs to the home screen | When web reorders are a large share and guests ask for it |
| Points tiers or a paid membership card | Stamps on a phone number are enough; a 4.1-star provincial venue lacks Shakey's-style pull | After 6 months of stamp data |
| Payment gateway checkout | Manual QR checks are cheap at this volume and gateways need DTI and BIR 2303 | When manual checks exceed about 15 minutes a day (our rule of thumb) |
| BIR e-invoicing transmission | POS users are in a later group and micro taxpayers are exempt | When BIR issues the POS regulation, or if the accountant says online orders trigger it |
| foodpanda or GrabFood integration | GrabFood is absent from Cagayan; foodpanda coverage of Dacal la Fugu is unverified; commissions run 25 to 30% | If foodpanda riders reach the venue and the owners want discovery, with a short delivery menu priced for commission |
| Messenger chatbot or Marketing Messages API | Saved replies and labels handle the volume; the API needs Meta app review | When the inbox is more than staff can answer |
| KDS screens in every kitchen | Printers are cheaper, heat-tolerant and need no training | A café counter screen first, when timing data is wanted |
| Fingerprint or face recognition clock | PIN plus photo deters buddy punching at PHP 0 | Only if photo plus PIN visibly fails |
| Auto-scheduling or AI forecasting | One or two sites and a manager who knows the fiesta calendar | With several branches |
| Payroll filing and remittance | A filing error is the owners' legal exposure | Never by us; the bookkeeper files |
| Review suites (Birdeye, Podium) and branded stands | They cost far more than one restaurant needs | Not planned |
| Separate Google profiles for Don Jose or Rosalina | Google wants one profile per business | Only if each runs as a distinct operation with its own counter and signage |
| Google search ads, Instagram budget, TikTok Shop | Thin local search volume (unverified) and small reach | When profile insights show search demand |
| Central purchasing across branches | Lucia's suppliers are unknown | When Lucia's actually shares suppliers |
| Own rider fleet | Delivery obligations and food-safety risk on a highway | After pickup and flat-fee short-radius delivery prove demand |
| Reserve or Order with Google | Partner-level setup; a plain profile link is enough | If an approved provider covers the area |
| TripAdvisor work | Little presence in Cagayan | Claim the listing if one exists, no ongoing effort |
| On-site hub for waiter phones and tablets | One counter tablet printing to three kitchens is enough to start | If waiters need to take orders at the table |
| BIR accreditation of Hapag | Registered invoices keep working; accreditation is a 4 to 6 week build plus BIR time | When the owners want Hapag to issue their invoices |
