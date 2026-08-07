# Cold-outreach sending identity

Measured 2026-08-07: every outreach email leaves on the primary business domain
`kqualitycleaningservices.com.au` from one mailbox, with no warmup, no bounce
feedback and a daily cap that was exceeded 3.3x on 2026-08-06. A single bad list
on that domain costs KQuality its ordinary business email, not just its
outreach. Everything here exists to isolate that risk.

## The decision, and why it is a subdomain

Cold outreach moves to **`outreach.kqualitycleaningservices.com.au`** with its
own SPF, DKIM, DMARC and its own reputation history.

A separate *registrable* domain (`kqualityclean.com.au`) isolates reputation
more completely, because DMARC organisational alignment still ties a subdomain
to the parent. It also costs money and needs to be bought and aged. That
purchase has not been made — this stack was set up without it — so the
subdomain is what ships now:

- it is free and available immediately,
- SPF/DKIM/DMARC on the subdomain are evaluated independently, so a spam
  complaint against the outreach stream does not directly affect mail from
  `info@kqualitycleaningservices.com.au`,
- `sp=none` on the parent's DMARC policy is not required, because the record
  below is published *at the subdomain*, which takes precedence,
- if a separate domain is bought later, `SUB` and `ZONE_NAME` in
  `apply-cloudflare-dns.sh` are the only two things that change.

**Trade-off, stated plainly:** a receiver that has decided the organisational
domain sends unwanted mail can still penalise the subdomain. If outreach volume
is ever going past ~40/day sustained, buy the separate domain and age it for
30 days before switching. That is a purchase decision, not an engineering one.

## Records

Apply with `ops/leadgen/dns/apply-cloudflare-dns.sh` (dry run by default):

```bash
export CLOUDFLARE_API_TOKEN=...   # Zone:DNS:Edit on kqualitycleaningservices.com.au
./apply-cloudflare-dns.sh          # shows what it would do
./apply-cloudflare-dns.sh --apply  # writes it
```

| Type | Name | Value | Why |
|---|---|---|---|
| MX | `outreach.kqualitycleaningservices.com.au` | `smtp.google.com` (pri 1) | Bounces have to land somewhere. Without this the circuit breaker has no bounce data and the whole deliverability panel stays at zero. |
| TXT | `outreach.kqualitycleaningservices.com.au` | `v=spf1 include:_spf.google.com -all` | `-all`, not `~all`: a hard fail is the point of a dedicated sending identity. |
| TXT | `_dmarc.outreach.kqualitycleaningservices.com.au` | `v=DMARC1; p=none; sp=none; adkim=r; aspf=r; fo=1; pct=100; rua=mailto:dmarc@…; ruf=mailto:dmarc@…` | Starts at `p=none` so reports arrive before anything is enforced. Move to `p=quarantine` after 2 clean weeks of aggregate reports. |
| TXT | `google._domainkey.outreach.…` | from the sending provider | **Cannot be generated here.** The private half lives with whoever signs the mail. |

### DKIM

Google Workspace: Admin console → Apps → Google Workspace → Gmail →
Authenticate email → select the outreach domain → Generate new record
(2048-bit) → copy the TXT value, then:

```bash
export DKIM_VALUE='v=DKIM1; k=rsa; p=MIIBIjANBg...'
./apply-cloudflare-dns.sh --apply
```

Another provider (Postmark, SendGrid, Amazon SES) publishes its own selector —
set `DKIM_SELECTOR` to match and the script handles the rest.

## Verify before a single email is sent

```bash
dig +short TXT outreach.kqualitycleaningservices.com.au
dig +short TXT _dmarc.outreach.kqualitycleaningservices.com.au
dig +short MX  outreach.kqualitycleaningservices.com.au
dig +short TXT google._domainkey.outreach.kqualitycleaningservices.com.au
```

Then send one message to a checker and confirm `spf=pass`, `dkim=pass`,
`dmarc=pass` in the received headers.

## Only then, start the warmup

The mailbox is seeded **paused** on purpose — `leads.mailbox` has
`paused_reason = 'awaiting SPF/DKIM/DMARC verification on the outreach
subdomain'`, and `leads.mailbox_daily_cap()` returns 0 for a paused mailbox, so
the dispatcher physically cannot send from it.

```sql
UPDATE leads.mailbox
   SET status = 'warmup', warmup_started_on = current_date,
       paused_reason = NULL, paused_at = NULL
 WHERE address = 'michelle@outreach.kqualitycleaningservices.com.au';
```

Ramp is 10 on day one, +5 each day, hard cap 40/mailbox/day. It is enforced in
two places that must agree: `leads.mailbox_daily_cap()` in SQL and
`kqdWarmupCap()` in `ops/leadgen/deliverability.js`.

## Feedback loop

The ESP must POST delivery events to:

```
POST https://n8n.kqualitycleaningservices.com.au/webhook/outreach-event?k=<key>
{ "event": "hardbounce", "email": "...", "mailbox": "michelle@outreach...", "message_id": "..." }
```

The key is `leads.system_settings['outreach_webhook_key']`. Rotating it is an
`UPDATE`, not a container restart. Accepted events: `delivered`, `bounce`
(+`permanent` flag), `hardbounce`, `softbounce`, `open`, `click`, `complaint`,
`spamreport`, `unsubscribe`. Anything else is rejected with 400 rather than
written as a lie.

A hard bounce or complaint suppresses the address permanently and, if the
rolling 7-day rate crosses 3% bounces or 0.1% complaints on 20+ sends, pauses
the mailbox in the same statement and writes an alert row the dashboard shows.
The breaker acts on the write, not on a later scheduled pass — otherwise the
next 39 emails still go out.
