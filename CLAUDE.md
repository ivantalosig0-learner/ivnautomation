# IVNautomation — KQuality Cleaning Services Lead Generation Platform

This repository is the source-of-truth snapshot of the IVNautomation platform: an
AI-powered lead generation, outreach, and CRM system built for Quality Cleaning
Services Australia (Adelaide, SA). The platform is designed as a reusable
enterprise automation foundation; cleaning is the first production vertical.

**The live system runs on a VPS, not from this repo.** n8n workflows here are
exported JSON snapshots of the production database. Edits to files in
`workflows/` do nothing until imported/applied to the live n8n instance.

## Production topology

| Component | Where | Notes |
|---|---|---|
| n8n (workflow engine) | Docker `ivnautomation-n8n` | https://n8n.kqualitycleaningservices.com.au |
| PostgreSQL 17 | Docker `ivnautomation-postgres` | DB `ivnautomation`, user `ivan`; app schema `leads`, n8n tables in `public` |
| AI Gateway (FastAPI) | Docker `ivnautomation-ai-gateway`, port 8000 | `/opt/ivnautomation-ai/gateway`; INFERENCE_TIMEOUT_S=300 |
| LLM backend | Docker `ivnautomation-llama` | llama.cpp, Qwen3-8B-Q5_K_M.gguf, CPU-only, `--parallel 2` |
| Browserless | Docker `browserless:3000` | JS rendering for enrichment fallback |
| Public website | `/opt/ivnautomation/www/kqualitycleaningservices` | mirrored in `website/` |
| Mail | Gmail `kqualitycleaningservices@gmail.com` | SMTP send + IMAP watch. n8n credential IDs: SMTP `91G0HwEy1X4Eu1Qm`, IMAP `02fJOib7pcIJljyU`, Postgres `jqlh240FlAgCW2po` |

DB access pattern used throughout ops:
`docker exec ivnautomation-postgres psql -U ivan -d ivnautomation -c "..."`

## The engine pipeline (times are Australia/Adelaide workflow tz; business ops in Asia/Manila PHT)

Discovery (7:30am PHT cron) -> Intelligence (every 30 min) -> Qualification (hourly)
-> Daily Automated Outreach (9:00am PHT window). Each stage ALSO chain-triggers the
next via Execute-Workflow nodes, ALL with `waitForSubWorkflow: false` — see
Hard-won lessons below before changing that.

| Workflow | Schedule | Purpose |
|---|---|---|
| Opportunity Discovery Engine | daily 07:30 PHT | Finds candidate businesses, writes `leads.candidates` (stage `discovered`). **40 km** radius over 8 zone centres. Rations a rotating **65 search terms/day** (full 196-term cycle every 3 days) — repeating a term just re-finds known places. Rejects cleaning competitors at INSERT. Has a manual Execute-Workflow trigger for on-demand runs |
| Lead Intelligence Engine | every 30 min | Crawls websites (homepage/contact/about + Browserless fallback), extracts emails/socials/profile, advances stage to `enriched`. Timeout 3000s |
| Lead Qualification Engine | hourly | Deterministic **qual_v2** scoring, split into reach (email 22-28, phone 7, website 5, linkedin 5), fit (segment weight x2, multi-site 8, premises 5, size 0-8) and intent (AI fit 0-10, professionalism 4), minus penalties (free mailbox -10, thin site -5, **suppressed -200**). `qualified` >= 50 with email. Hot >= 85, warm >= 65. Threshold is an eligibility floor only — `shortlist_rank` (score, then segment weight) decides send order. Persists with `qualification || s.qual` so exclusion markers survive. Timeout 900s |
| Personalized Outreach Engine | every 30 min | Renews **4** drafts/run (gateway has 2 inference slots; 15 guaranteed 13 were shed), hot leads first. Writes the deterministic composer draft when AI is unavailable. Draft-only, never sends |
| Daily Automated Outreach Engine | 9:00am PHT (guarded) | Sends up to cap/day from shortlist. Kill switch + quiet-skip guard: chain invocations before 9am or after a completed daily run no-op silently |
| Outreach Follow-up Engine | scheduled | Follow-ups for non-repliers on a **3/7/14 day** cadence (was 2/3/5 — three emails inside a working week reads as pressure). Each touch carries a different angle. Stops automatically when CRM stage = `replied`, and skips anything suppressed |
| Reply Detection Engine | IMAP trigger | Matches inbound replies (message-id > references > email > subject), sets CRM `replied`, notifies. IMAP node MUST stay `format: resolved` |
| Lead Gen Error Handler | error trigger | Notifications + email alerts. Suppresses IMAP reconnect noise entirely |
| Worker Dashboard API | webhook `worker-api-x9q2k4m7` | POST JSON `{action, token, ...}`. Actions: login, leads, draft, save, send, crm_add/list/stage/timeline/notes/next_action, crm_replies, crm_reply_send, system_status, notifications_list/mark_read, stats |
| Worker Lead Dashboard | webhook `worker-leads-k7m2x9q4` | Single-page dashboard. Built by a 74KB Code node; `Inject Reply UI` node patches in the CRM conversation/reply feature — extend via injector, do not edit the big node |
| Outreach Control API / Opportunity Conversion API | webhooks | Settings (kill switch, cap, threshold) and conversion scoring endpoints |

Dashboard login (`leads.dashboard_users`): salted SHA-256 —
`password_hash = encode(digest(pw || salt, 'sha256'), 'hex')`. Sessions 7 days.
Login body field is `name`, NOT `user`.

## Database (schema `leads` — full DDL in `database/schema.sql`)

`candidates` is the hub (stage: discovered -> enriched -> qualified/disqualified;
`duplicate_of` for dedup; `enrichment` jsonb; `qualification_score`;
`shortlist_rank`). Around it: `segments`, `sources`, `outreach_drafts` (one per
candidate, status draft/approved/rejected/sent, `message_id` after send),
`outreach_followups`, `inbound_replies` (matched_by: message_id | references |
email_fallback | subject | unmatched), `crm_records` (stage: new/contacted/
replied/won/lost + notes/next_action), `crm_stage_history`, `notifications`
(severity info/warning/error), `outreach_runs` (one row per day),
`system_settings` (kill switch, cap, threshold), `dashboard_users`,
`dashboard_sessions`.

## Email hygiene (deliberate design — do not "simplify")

- Every outreach sender BCCs `kqualitycleaningservices+outreach@gmail.com`.
- Gmail filter 1: `to:(+outreach)` -> Skip Inbox + label **KQuality Outreach** (archive of all sent outreach, inbox stays clean).
- Gmail filter 2: `to:(main) subject:(Re:)` -> label **KQuality Replies**, deliberately NOT archived so real replies hit the inbox.
- Reply Detection reads UNSEEN in INBOX only; BCC copies skip the inbox so it never re-ingests our own mail. It also drops messages where from == self.

## Hard-won production lessons (each cost real downtime — read before touching)

1. **Chain triggers must be fire-and-forget.** `waitForSubWorkflow: true` made parent timeouts cascade-cancel children across Intelligence/Qualification/Outreach (the July 20 red-health incident). Keep `false`; each engine reads its own work from the DB, no return value is needed.
2. **Editing a workflow can silently disconnect its schedule trigger from the first node.** The trigger "fires" with empty runData and the engine does nothing while looking alive. After edits, verify the trigger->first-node connection and check executions do real work.
3. **`saveDataSuccessExecution: 'none'` makes healthy engines look stalled.** Keep `'all'` on engines the dashboard health panel watches (it reads `execution_entity`).
4. **IMAP node `format: 'simple'` provides no sender/messageId** — the parser needs `resolved` (mailparser shape). With `simple`, every reply lands unmatched with empty sender.
5. **Fallback message-ids must hash full content.** `base64(subject+date+from).slice(0,64)` truncated before the date; an entire thread collapsed to one id and `ON CONFLICT DO NOTHING` silently discarded every later message (the lost Michael Brown thread).
6. **HTTP fetch nodes in enrichment need `onError: continueRegularOutput`** or one 404 contact page hard-fails a 60-candidate run.
7. **Error Trigger payloads vary.** Node errors: `execution.error.lastNodeExecuted` (string; `.node.name` does NOT exist here). Trigger errors: `trigger.error.message`, no `execution` key. Timeouts may have no attributable node.
8. **Qwen on CPU is slow (40–90s+/call).** Gateway INFERENCE_TIMEOUT_S=300; single n8n executions that loop AI calls need generous executionTimeout.
9. **After significant workflow edits, `docker restart ivnautomation-n8n`** — triggers have gone quiet after in-place edits until restart.
10. **The dashboard page builder is one 74KB Code node.** Do not hand-edit; extend via the `Inject Reply UI` pattern (anchor-string patch between builder and respond node) and syntax-check the served page's inline JS (`node --check`) after any change — a single unescaped quote once took the whole dashboard down.

## Lead-gen refresh — 2026-08-05

Outreach replies had decayed from 5.1% to 2.4%. Three compounding causes, all fixed:

1. **Discovery had been dead for days.** The Places key was capped at 100
   searches/day; the engine fired ~196 terms x 3 pages, exhausted quota in the
   first ~30 terms and 429'd the rest. It reported `success` in n8n while
   `leads.discovery_runs` recorded `failed / 0`. Quota has since been raised;
   term rotation stays because re-running a term only re-finds known places
   (measured: fresh slice 132 new candidates, same slice again 5).
2. **The AI has effectively never written the outreach.** The gateway sheds
   ~89% of `generate_outreach` calls, so every recipient got one hardcoded
   template. The deterministic composer in `ops/leadgen/composer.js` is now the
   primary path; AI must pass a quality gate to be used instead.
3. **18 competitor-hunting segments** added 2026-07-27 (`commercial cleaning
   Adelaide`, `carpet cleaning`, ...) filled the funnel with other cleaners.
   Retired; `leads.is_cleaning_competitor()` now blocks them at discovery
   insert, at qualification and again at send.

Also: 500 duplicates collapsed (4-pass on email/domain/phone/name+suburb — one
email domain had 20 separate cold emails going out), 34 junk addresses purged
(`user@domain.com` appeared 26 times and was being mailed), `leads.suppression`
added and enforced, CRM reduced to the 22 records with real commercial history.

**Tooling and the copy source of truth live in `ops/leadgen/` — read its README
before editing any outreach wording or workflow node.**

## Conventions

- Timestamps in PHT for business logic; workflow tz is Australia/Adelaide — do not assume they match.
- All engines report to error workflow `39Vcvm1lkmQZXFpS` (Lead Gen Error Handler).
- Sends are idempotent-guarded: `outreach_runs` unique per day; drafts flip to `sent` with `message_id` recorded.
- Never commit: `.env` files, `gateway/.venv`, n8n encryption key, credential values. Workflow exports reference credentials by n8n ID only (verified clean).
- Verification standard: production evidence over structural claims — check `execution_entity` status, query the DB, curl the live endpoint.

## Repo layout

workflows/ 19 n8n workflow exports (JSON: id, name, active, settings, nodes, connections)
dashboard/ served snapshot of the worker dashboard page
gateway/ AI Gateway FastAPI source (no .env)
database/ schema.sql — full `leads` schema DDL
website/ public marketing site (kqualitycleaningservices.com.au)
docs/ infra docker-compose (env-var references only)
mogoba-pos/ offline-first POS + inventory for Mogoba Korean Food House (separate client project — see mogoba-pos/README.md)
juvals/ pitch deck and research for Juval's Grill & Restaurant and Lucia's (client prospect; see juvals/README.md)

---

## Laptop working files were moved here — 2026-08-02

Everything Claude had been building on the Windows laptop now lives on this VPS at
`~/claude-workspace/`. Read `~/claude-workspace/README.md` for the full map.

Relevant to *this* repo: `~/claude-workspace/website/ivn-workflows/` and
`~/claude-workspace/website/ivn-site/` **overlap** with `workflows/` and `website/`
here. They were deliberately **not** merged — the transferred copy is a faithful
snapshot of laptop state and the two trees may have diverged. **Diff before
promoting anything.** This repo stays the deployable source of truth.

Also preserved there: the original 1.73 GB laptop n8n `database.sqlite`
(`~/claude-workspace/laptop-n8n-db/n8n_data/database.sqlite`) — the only copy of the
retired laptop n8n's workflows and execution history.

`~/claude-workspace` is `0700`, files `0600`, credentials isolated in `secrets/` and
gitignored. It is **not** mounted into Hermes, so none of it reaches the search index.
Given the Treasury module on this stack, do not add such a mount without masking
`secrets/` via the `hermes/empty` bind, the same way the workforce repo masks its own.

## Decision-maker targeting — 2026-08-07

Baseline that motivated it is `docs/DIAGNOSTIC_2026-08.md` (measured, not
assumed): 0 leads had a contactable named person, 62.9% of emailable leads were
role mailboxes, 106 sends all time, 0 follow-ups ever sent, 82.5% of replies
unattributable, no delivery/open/bounce tracking at all, `suburb`/`postcode`
NULL on all 2865 rows, and the composed email had no unsubscribe, ABN or
postal address.

Added, all additive — the existing engines and `composer.js` send path are
unchanged and still live:

- **Schema** — `leads.segment_taxonomy` (12 buyer codes layered over the
  existing `leads.segments`; no `segment_id` was touched), `lead_contact`,
  `lead_signal`, `outreach_event` (append-only; this log *is* the Spam Act
  evidence), `mailbox`, `campaign`/`campaign_step`/`campaign_variant`,
  `sequence_state`, `pipeline_stage`, `reply_action`, `registry_record`.
  `leads.suppression` was kept as the single suppression source of truth;
  `leads.suppression_list` is a view over it plus `leads.is_suppressed()`.
- **Six injected sources** in `ops/leadgen/` — `contacts.js`, `scoring.js`,
  `registries.js`, `sendguard.js`, `deliverability.js`, `replyclass.js`.
- **Dashboard** — six conversion panels on `pC85wHkQPzwh8dhd`.
- **`Outreach Compliance API`** (`KQcompliance01`) — public `/unsubscribe`
  and authenticated `/outreach-event` for ESP delivery/bounce/complaint
  feedback, with the circuit breaker firing inside the same statement.

Four traps found the hard way, each cost a deploy cycle:

1. **The draft and published graphs diverge on this box.** `Inject Source
   Category Breakdown UI` is in `workflow_entity.nodes` and not in the live
   `workflow_history` row. A connection key naming a node that is not in the
   graph makes n8n throw in `getParentNodes` and the dashboard 500s. Patches
   must discover the chain from the graph they are handed.
2. **`$env` is denied inside Code nodes** ("access to env vars denied").
   Shared secrets live in `leads.system_settings`.
3. **The Postgres node splits `queryReplacement` on commas**, so a jsonb
   argument loses parameters — "there is no parameter $4". Pass scalars and
   build the jsonb in SQL.
4. **The injected sources are `String.raw` templates**, so one backtick in a
   comment truncates the file silently. Each must contain exactly two.

Not switched on: all 12 campaigns are `enabled = false`, the outreach mailbox
is `paused` pending DNS (`ops/leadgen/dns/OUTREACH-DOMAIN.md`), and the
send-path switchover is written but not deployed.

**Tier A tops out at 21.4% decision-maker coverage** — measured on 28 live
Adelaide sites, unchanged across three parser iterations, because on half the
sample no person is published. Tier B registries are the lever, and
`ABN_LOOKUP_GUID` is the first key to obtain.
