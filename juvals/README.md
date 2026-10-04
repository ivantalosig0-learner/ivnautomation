# Juval's Grill & Restaurant (and Lucia's)

Client: Juval's Grill & Restaurant, Dacal la Fugu, Camalaniugan, Cagayan. One garden venue with
three kitchens (Juval's Grill, Don Jose Pizza & Pasta, Rosalina Café), plus the sister business
Lucia's. Their website is live at https://ivnautomation.xyz/juvals/ (Hetzner VPS, not in this repo).

Status: **pitch stage**. Nothing is built for them beyond the website. This folder holds the
research and the presentation for the first meeting.

## Contents

| Path | What it is |
|---|---|
| `REVIEWER.md` / `REVIEWER.pdf` | **Read before the meeting.** Meeting plan, discovery questions, slide-by-slide talk track, about 100 likely questions with answers, objections, what not to promise, numbers cheat sheet with sources. |
| `HAPAG.md` / `HAPAG.pdf` | The Hapag blueprint, business half: problems with numbers, modules, shared records, roadmap, packages and hardware, KPIs, BIR / Google / privacy / DOLE rules, risks, and the "not now" list that keeps it from being over-engineered. |
| `HAPAG-TECH.md` | The build half: what already exists from Mogoba, what Juval's needs on top with day estimates, BIR safeguards, what we deliberately do not build. |
| `RESEARCH.md` | The six research briefs (reviews, ads, web, POS, staff, loyalty) with every source. |
| `pitch/index.html` | The deck. Open it in a browser: arrow keys or the road bar to move, F for full screen, N for speaker notes. On a phone the slides stack for scrolling. |
| `pitch/Juvals-Growth-Plan.pdf` | Client copy of the deck, one 16:9 page per slide. No prices: the packages slide and the ad budget line are left out on purpose. |
| `pitch/Juvals-Growth-Plan.pptx` | Presenter copy for PowerPoint, every slide with speaker notes. The packages slide (17) is hidden in the slideshow; type 17 and Enter to show it if they ask. |
| `pitch/figures.json` | Every researched number on the slides, with sources. `python3 pitch/fill.py pitch/figures.json` fills a fresh copy of the deck from it. |
| `pitch/export.cjs` | `node pitch/export.cjs pdf` rebuilds the client PDF, `presenter` includes prices, `shots <dir>` renders PNGs. Needs Playwright with Chromium. |
| `pitch/pptx.cjs` | Rebuilds the PowerPoint from the deck (needs pptxgenjs and pdftoppm). |
| `pitch/qa.cjs` | Layout check at three screen sizes and in print: text off the slide or clipped, overlaps, anything touching a slide edge, leftover placeholders, dashes. |
| `render-doc.cjs` | Turns `REVIEWER.md` or `HAPAG.md` into a phone-friendly PDF. |
| `pitch/img/` | Their own photos and logo, taken from the live website, plus screenshots of it. |
| `pitch/fonts/` | Zilla Slab, Figtree and Rye (the website's fonts), bundled so the deck and PDF render offline. |

## Message to send with the PDF

Short, warm, no prices. Send on Facebook Messenger to both pages with the PDF attached.

**Juval's**

> Hi An, thank you so much for the kind reply! 😊 I've attached a short look at what we have in mind
> for Juval's and Lucia's, so you can browse it before we meet. Just let me know what day and time
> works best for you and I'll come by. Looking forward to meeting you! God bless, Ivan

**Lucia's**

> Hi! This is Ivan from IVNautomation. I've been talking with Juval's about their website and put
> together a short plan that includes Lucia's too, so I'm sharing it here for you to look through.
> I'd love to walk you through it in person. Let me know a day and time that suits you. Looking
> forward to meeting you! God bless, Ivan
