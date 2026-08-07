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
| Opportunity Discovery Engine | daily 07:30 PHT | Finds candidate businesses, writes `leads.candidates` (stage `discovered`) |
| Lead Intelligence Engine | every 30 min | Crawls websites (homepage/contact/about + Browserless fallback), extracts emails/socials/profile, advances stage to `enriched`. Timeout 3000s |
| Lead Qualification Engine | hourly | Deterministic qual_v1 scoring (email 40, phone 15, website 10, linkedin 10, social 5, clean 5, preferred-email 5, + segment weight). `qualified` >= 55 with email. Hot >= 80, warm >= 55. Recomputes `shortlist_rank`. Timeout 900s |
| Personalized Outreach Engine | every 30 min | Qwen renews 15 template drafts/run into AI drafts, hot leads first. Draft-only, never sends |
| Daily Automated Outreach Engine | 9:00am PHT (guarded) | Sends up to cap/day from shortlist. Kill switch + quiet-skip guard: chain invocations before 9am or after a completed daily run no-op silently |
| Outreach Follow-up Engine | scheduled | Follow-ups for non-repliers; stops automatically when CRM stage = `replied` |
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
