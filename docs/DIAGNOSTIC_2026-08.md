# Lead-gen conversion diagnostic — 2026-08-07

Read-only baseline taken against production `ivnautomation` / schema `leads`
(container `ivnautomation-postgres`, srv1828825) before any Phase 2–5 work.
Every number below is a query result, not an estimate. Source of truth is the
database and `~/ivnautomation-repo`; the Hermes MCP server referenced in the
program brief was removed 2026-08-06 and no longer exists.

## 1. Contactability

| metric | n | % of 2865 |
|---|---|---|
| total lead rows (`leads.candidates`) | 2865 | 100.0 |
| non-duplicate | 2278 | 79.5 |
| duplicate-flagged (`duplicate_of` set) | 587 | 20.5 |
| valid email address | 1660 | 57.9 |
| role-based mailbox (`info@`,`admin@`,`office@`,`contact@`,`enquiries@`,`hello@`,`reception@`,`mail@`,`sales@`,`accounts@`,`bookings@`) | 1045 | 62.9% of emailable |
| personal-format mailbox | 615 | 37.0% of emailable |
| free-mailbox domain (gmail/bigpond/optusnet/…) | 55 | 3.3% of emailable |
| `do_not_contact` | 96 | 3.4 |
| `excluded_from_outreach` | 628 | 21.9 |

Stage: `enriched` 1494 · `qualified` 666 · `disqualified` 528 · `discovered` 177.

## 2. Decision-maker coverage

| metric | n |
|---|---|
| lead rows with a person name **and** job title in a queryable column | **0** (no such column exists) |
| leads with a non-empty `enrichment.profile.people[]` | 441 (15.4%) |
| people entries carrying an email address | **0** |
| people entries carrying a ranked/segment-matched title | **0** |
| contacts with published-source provenance (`source_url` + `discovered_at`) | **0** |

Extraction quality of the 441 is low. Verbatim samples:
`[{"name":"Owner Occupier","role":"Owner"},{"name":"Occupier Owner","role":"Owner"}]`,
`[{"name":"Investor Guide","role":"Property Manager"}]`,
`[{"name":"Assistant Assistant","role":"Director"}]`,
`[{"name":"Senior Property","role":"Manager"}]`.
One clean row in the sample: `[{"name":"Matt Smith","role":"Managing Director"},…,{"name":"Oren Klemich","role":"Founder"}]`.

**Effective decision-maker addressability across the whole database is 0%.**

## 3. Outreach volume and outcomes, last 6 months

| month | initial sends | follow-up sends | replies received | distinct leads replying |
|---|---|---|---|---|
| 2026-08 | 86 | 0 | 71 | 4 |
| 2026-07 | 20 | 0 | 197 | 27 |
| 2026-06 and earlier | 0 recorded | 0 | 0 recorded | — |

Pre-refresh history was archived on 2026-08-05 into
`leads.crm_records_archive_20260805` (619 rows); 465 addresses carry suppression
reason `contacted_pre_refresh`. The send log for that era no longer exists, so
the 6-month series above starts effectively at 2026-07.

Delivered / opened / clicked / unsubscribed / complained: **not tracked** —
no column, no table, no event log anywhere in the schema.

Hard bounces: 31 rows in `leads.suppression`, **all** created 2026-08-05, and
**0** of them match any address in `outreach_drafts.sent_to`. They are a manual
backfill from the pre-refresh era, not a feedback loop. There is no automated
bounce ingestion in any workflow (`grep -ri bounce ops/` returns only
suppression-reason string literals).

Reply attribution (`inbound_replies.matched_by`):

| matched_by | n | % |
|---|---|---|
| unmatched | 221 | 82.5 |
| email_fallback | 32 | 11.9 |
| subject | 15 | 5.6 |
| message_id | 0 | 0.0 |
| references | 0 | 0.0 |

## 4. Sending infrastructure

| metric | value |
|---|---|
| distinct senders in `outreach_drafts.sent_by` | 2 — `Michelle` (66), `daily_auto_engine` (40) |
| distinct cold-outreach sending domains | 0 (outreach goes out on the primary business mailbox) |
| `daily_send_cap` in `system_settings` | 15 |
| actual sends 2026-08-06 / 2026-08-07 | 50 / 35 |
| other days with sends | 1–5 per day |
| `outreach_runs.sent_count` 2026-07-27 → 2026-08-07 | 15/day × 12 days = 180 |
| `outreach_drafts` rows with `sent_at` (all time) | 106 |

Two independent defects here: the configured daily cap was exceeded 3.3× on
2026-08-06, and the run ledger reports ~1.7× more sends than the draft table
records.

## 5. Duplication

| metric | n |
|---|---|
| `duplicate_of` already set | 587 |
| distinct email domains across 1660 emailable leads | 1293 |
| lead rows still sharing an email domain with another lead | 484 |
| lead rows still sharing a normalised phone with another lead | 307 |
| exact duplicate `business_name` | 49 |
| ABN recorded | **0** — no ABN column exists in any table in schema `leads` |

`domain_contact_cooldown_days = 90` limits the send-side damage but does not
merge the records.

## 6. Geographic coverage

| metric | value |
|---|---|
| `state = 'SA'` | 2865 (100%) |
| distinct non-null `suburb` values | **0** |
| distinct non-null `postcode` values | **0** |
| rows with any postcode | **0** |
| rows inside Adelaide metro 5000–5199 | **0** (unmeasurable) |

The `suburb` and `postcode` columns exist and are NULL on every one of the 2865
rows. Locality text sits inside `address` only. Route-proximity scoring and
suburb personalisation tokens are therefore impossible today, and
`composer.js:199` already falls back to the literal string "Adelaide" for every
lead.

## 7. Existing segment field

`leads.segments` holds 29 rows. 13 carry leads; 16 carry zero.

| code | leads | | code | leads |
|---|---|---|---|---|
| medical_childcare_gym | 852 | | industrial_warehouse | 67 |
| commercial_office | 523 | | automotive_trade | 41 |
| builders_construction | 357 | | strata | 31 |
| real_estate_strata | 289 | | aged_care_facilities | 26 |
| hospitality_venues | 229 | | body_corporate | 1 |
| education_training | 159 | | office_cleaning, carpet_cleaning, | 0 |
| retail_showrooms | 145 | | window_cleaning, builders_cleaning, | 0 |
| community_clubs | 77 | | medical_cleaning, end_of_lease_cleaning, | 0 |
| ndis | 68 | | warehouse_cleaning, property_management, | 0 |
| | | | childcare_cleaning, restaurant_cleaning, | 0 |
| | | | pressure_washing, retail_cleaning, | 0 |
| | | | hospitality_cleaning, gym_cleaning | 0 |

Every lead is classified, so coverage is 100% — but the table conflates two
different things: 13 buyer segments and 16 *discovery search-term* buckets that
can never hold a lead. No segment carries decision-maker titles, and there is no
`segment_confidence` or `segment_source`.

## 8. Ranked conversion blockers (measured)

**1. Zero decision-maker addressability.** 0 leads have a contactable named
person; 62.9% of emailable leads are gatekeeper mailboxes; the 441 `people[]`
rows that exist carry no email and are largely junk strings.

```sql
select count(*) from leads.candidates
 where jsonb_typeof(enrichment->'profile'->'people')='array'
   and jsonb_array_length(enrichment->'profile'->'people')>0;                -- 441
select count(*) filter (where lower(split_part(email,'@',1)) in
  ('info','admin','office','contact','enquiries','hello','reception','mail',
   'sales','accounts','bookings')), count(*)
 from leads.candidates where email ~ '^[^@ ]+@[^@ ]+\.[^@ ]{2,}$';           -- 1045 / 1660
```

**2. Outcome measurement is broken, so copy cannot be improved.** 82.5% of
inbound replies are unattributable, zero delivery/open/bounce events are
captured, and the run ledger overstates sends by ~1.7×.

```sql
select matched_by, count(*) from leads.inbound_replies group by 1;
  -- unmatched 221 | email_fallback 32 | subject 15 | message_id 0 | references 0
select (select sum(sent_count) from leads.outreach_runs) run_ledger,
       (select count(*) from leads.outreach_drafts where sent_at is not null) drafts;
  -- 180 vs 106
```

**3. The follow-up sequence has never fired.** Every lead has received exactly
one touch. The Follow-up Engine and its 3/7/14 cadence are deployed but
`leads.outreach_followups` is empty.

```sql
select count(*) from leads.outreach_followups where sent_at is not null;      -- 0
select count(*) from leads.outreach_drafts   where sent_at is not null;       -- 106
```

**4. No compliance or deliverability foundation.** `ops/leadgen/composer.js`
(282 lines) contains no unsubscribe link, no ABN and no physical address —
Spam Act 2003 s.18 requires both a functional unsubscribe facility and sender
identification. There is no separate cold-outreach domain, no warmup ramp, no
circuit breaker, no bounce ingestion, and the one cap that does exist was
breached 3.3× on 2026-08-06.

```sql
select date(sent_at), count(*) from leads.outreach_drafts
 where sent_at is not null group by 1 order by 1 desc limit 3;  -- 08-07:35, 08-06:50 (cap 15)
select count(*) from leads.suppression s where s.reason='hard_bounce'
 and exists (select 1 from leads.outreach_drafts d where lower(d.sent_to)=s.email_norm); -- 0
```

**5. No buying-trigger signal and no geographic targeting.** There is no table,
column or jsonb key anywhere holding a contract expiry, audit date, new-site or
growth event; and `suburb`/`postcode` are NULL on 100% of rows, so neither
route proximity nor a suburb personalisation token is available.

```sql
select count(distinct suburb), count(distinct postcode),
       count(*) filter (where postcode is not null) from leads.candidates;    -- 0 | 0 | 0
```

*(6, just below the cut: the segment taxonomy conflates buyer segments with
discovery keywords and carries no decision-maker titles — §7 above.)*

## 9. Where the data contradicts the program brief

- **"No segment classification" — false.** 100% of leads carry a segment. The
  defect is taxonomy shape (keywords mixed with buyer types, no titles, no
  confidence), not absence. Phase 2 should **map and extend the existing 13
  segments**, not seed a parallel taxonomy — otherwise 2865 classified rows are
  orphaned. Recommended mapping: `real_estate_strata`+`strata`+`body_corporate`
  → `STRATA`; `commercial_office` → `COMMERCIAL_RE`/`RETAIL_OFFICE` split by
  size; `medical_childcare_gym` → split across `HEALTH`/`EDU`/`HOSPITALITY`
  (852 rows, the largest single bucket and the least specific — it needs a
  re-classification pass, not a rename); `ndis` → `NDIS`;
  `aged_care_facilities` → `AGED_CARE`; `education_training` → `EDU`;
  `hospitality_venues` → `HOSPITALITY`; `industrial_warehouse` → `INDUSTRIAL`;
  `community_clubs` → `GOV_LOCAL`/`HOSPITALITY` by entity type;
  `builders_construction` + `automotive_trade` + `retail_showrooms` →
  `RETAIL_OFFICE`. No lead loses its current `segment_id`.

- **"Deliverability may be the problem" — unprovable, and that is the finding.**
  Bounce rate cannot be computed: the only 31 hard bounces on record are a
  manual backfill that matches no send. Deliverability instrumentation must be
  built before any deliverability claim (good or bad) can be made.

- **Not anticipated in the brief, and material:** the follow-up engine has sent
  nothing at all (blocker 3), the daily cap is not enforced (blocker 4), and
  `suburb`/`postcode` are empty on every row (blocker 5). The last one blocks
  the Email-1 "lead-specific token beyond the name" rule the brief mandates, so
  address parsing has to land in Phase 3 rather than being assumed present.

---

## 10. Measured after building: Tier A decision-maker hit rate (2026-08-07)

`ops/leadgen/scrape-test.js` against 28 live Adelaide business websites, 4 per
segment across 7 segments, crawling homepage + up to 9 contact/about/team paths
and stopping early on a rank-1 contact with a personal email — the same stop
condition the production pipeline uses.

Three iterations of the Tier A extractor, each re-measured on the same 28 sites:

| | reachable | any named person | **rank 1-2 (the §7 gate)** | rank 1-2 with a published email | domain email pattern |
|---|---|---|---|---|---|
| v1 structured data + line-adjacent titles | 96.4% | 46.4% | **21.4%** | 3.6% | 0% |
| v2 + entity decoding, same-line `Name - Title`, junk-address filter | 96.4% | 96.4% | **21.4%** | 3.6% | 0% |
| v3 + a title is required before a name counts as a person | 89.3% | 50.0% | **21.4%** | 3.6% | 0% |

v2 looked like a large improvement and was not one. Accepting untitled
two-capitalised-word strings turned page furniture into staff — one hotel
homepage yielded 19 "people" — while the decision-maker rate did not move at
all. v3 requires a title before a name counts, which is why "any named person"
falls back to 50%: that 50% is now real people with real roles, and the 130
contacts extracted across the sample all carry a job title.

Best-rank distribution across the 28 sites after v3:

| best contact found | sites |
|---|---|
| rank 1 (operational buyer) | 2 |
| rank 2 (owner/director/procurement) | 4 |
| rank 3 (C-suite) | 2 |
| rank 4 (office/admin) | 1 |
| rank 5 (role mailbox only) | 5 |
| nothing at all | 14 |

**The 40% gate is not met by Tier A, and further parser work will not meet it.**
Three iterations moved the named-person rate from 46% to 96% to a precise 50%
and left the decision-maker rate at exactly 6/28 every time. On half the sample
there is no person published to find: hotels (ibis, Sofitel, Haven Marina,
Aurora Skydeck) publish no staff at all, and NDIS providers scored 0 of 4.

Where the gate is actually closed is Tier B, and specifically in the segments
that scored zero here:

| segment | rank 1-2 from Tier A | Tier B source that carries named decision makers |
|---|---|---|
| NDIS | 0 / 4 | ACNC Responsible Persons; NDIS Commission provider register |
| AGED_CARE | 0 / 4 | ACNC Responsible Persons; GEN aged care service data |
| EDU | 1 / 4 | ACECQA nominated supervisors; SA Dept for Education school directory |
| HOSPITALITY | 0 / 4 | ASIC officeholders (single-venue operators only) |
| STRATA | 2 / 4 | SCA(SA) member directory, then Tier A per agency |
| COMMERCIAL_RE | 2 / 4 | Tier A is already the right source here |
| HEALTH | 1 / 4 | Tier A plus ABN Lookup entity confirmation |

The adapters for all of these are built and unit-tested in
`ops/leadgen/registries.js`; each is env-gated and skips cleanly when its URL or
key is absent, so they are inert until configured. `ABN_LOOKUP_GUID` is the
first one to obtain — it is free, and it also supplies the ABN that 484
domain-sharing leads need before they can be deduplicated.
