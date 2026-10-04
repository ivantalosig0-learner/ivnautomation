# Juval's Grill & Restaurant (and Lucia's)

Client: Juval's Grill & Restaurant, Dacal la Fugu, Camalaniugan, Cagayan. One garden venue with
three kitchens (Juval's Grill, Don Jose Pizza & Pasta, Rosalina Café), plus the sister business
Lucia's. Their website is live at https://ivnautomation.xyz/juvals/ (Hetzner VPS, not in this repo).

Status: **pitch stage**. Nothing is built for them beyond the website. This folder holds the
research and the presentation for the first meeting.

## Contents

| Path | What it is |
|---|---|
| `pitch/index.html` | The deck. Open it in a browser: arrow keys or the road bar to move, F for full screen, N for speaker notes. On a phone the slides stack for scrolling. |
| `pitch/Juvals-Growth-Plan.pdf` | Client copy of the deck, one 16:9 page per slide. The packages slide (prices) is left out on purpose: prices are for the meeting. |
| `pitch/export.cjs` | `node pitch/export.cjs pdf` rebuilds the PDF; `node pitch/export.cjs shots <dir>` renders every slide to PNG for review. Needs Playwright with Chromium. |
| `pitch/img/` | Their own photos and logo, taken from the live website, plus screenshots of it. |
| `pitch/fonts/` | Zilla Slab, Figtree and Rye (the website's fonts), bundled so the deck and PDF render offline. |
| `RESEARCH.md` | The research behind the deck, with sources. |

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
