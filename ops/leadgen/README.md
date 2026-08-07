# ops/leadgen — lead-gen refresh tooling (2026-08-05)

Everything here exists because **n8n 2.30.5 runs the published graph, not the
draft**. The live executor reads `public.workflow_history` where
`versionId = workflow_entity."activeVersionId"`. Editing `workflow_entity.nodes`
— which is what a naive DB update or the n8n public API does — changes only the
draft, and the old graph keeps running even after a container restart.

## Deploying a workflow change

```bash
./deploy.sh <workflowId> <patch.js>
docker restart ivnautomation-n8n
```

`deploy.sh` exports the live graph, runs `build.js` inside the n8n container
(the only node runtime on this box), syntax-checks every Code node, then writes
the draft, inserts a new `workflow_history` row and moves `activeVersionId`
onto it in one transaction.

A patch module is `(nodes, connections) => ({ nodes, connections })`. Patches
are **idempotent** — they replace named nodes' parameters, so re-running one is
safe and the file stays the source of truth for that node's contents.

| Workflow | Id | Patch |
|---|---|---|
| Opportunity Discovery Engine | `YLP4NPutkGPwlhkA` | `patch-discovery.js`, `patch-discovery-trigger.js` |
| Lead Qualification Engine | `mwHCwOBO9RuyDNGs` | `patch-qualification.js` |
| Daily Automated Outreach Engine | `3bNNqQehDJdK8onH` | `patch-daily.js` |
| Personalized Outreach Engine | `HJB5HhkSbi1Qozrr` | `patch-personalized.js` |
| Outreach Follow-up Engine | `Lib5FMwNDcgaX3qv` | `patch-followup.js` |

After deploying, `./export-live.sh` writes the live graphs back into
`workflows/*.json` so the repo snapshot cannot silently revert the change.

## Changing outreach copy

**Edit `composer.js`, not the n8n UI.** `COMPOSER_SRC` is injected verbatim into
the `Prepare Daily Outreach` and `Prepare AI Request` Code nodes; a UI edit is
overwritten by the next deploy.

Preview against real leads before shipping:

```bash
# writes sample.json from the DB first, then:
docker cp . ivnautomation-n8n:/tmp/prev && docker exec -w /tmp/prev ivnautomation-n8n node preview.js
```

The composer is the **primary** send path, not a fallback. The AI gateway sheds
roughly 89% of `generate_outreach` calls (Qwen3-8B, CPU-only, 2 inference
slots), so for months every recipient received the same hardcoded template.
AI output is now accepted only if it passes a quality gate (60–220 words, no
`[Name]` placeholders, still names KQuality); otherwise the composed email ships.

## Migrations

`database/migrations/20260805-01-leadgen-refresh.sql` — normalisation helpers
(`leads.norm_email/norm_domain/norm_phone/norm_name`), the competitor and
junk-email detectors, four-pass dedup, the `leads.suppression` table and the
CRM refresh. Idempotent; the section-4 onward blocks assume the functions exist.

`20260805-02-segment-retargeting.sql` — buyer-only segments and conversion-
weighted priorities.

**`leads.is_cleaning_competitor()` is load-bearing.** KQuality is a cleaning
company, so other cleaning providers must never be contacted. It is enforced in
three places: at discovery insert, in the qualification fetch, and again in the
daily send query.

---

## Decision-maker targeting (2026-08-07)

Everything below is additive. The existing discovery / intelligence /
qualification / composer / daily-send path is untouched and still the live
sender; the new campaign rows are seeded `enabled = false` and the outreach
mailbox is seeded `paused`, so nothing new sends until it is switched on
deliberately.

Read `docs/DIAGNOSTIC_2026-08.md` first — every design choice here traces to a
measured number in it.

### Injected sources (same pattern as `composer.js`)

| file | exports | what it does |
|---|---|---|
| `contacts.js` | `CONTACTS_SRC` | Tier A extraction: JSON-LD, microdata, `mailto:`, team cards. Title ranking 1-5, domain email-pattern learning, junk-address rejection. |
| `scoring.js` | `SCORING_SRC` | Segment classifier (registry > Places types > keywords > legacy) and the explainable 0-100 lead score. |
| `registries.js` | `REGISTRIES_SRC` | Tier B adapters: ABN Lookup, open-data registry CSVs, SA Tenders contract-expiry parsing, verification and Places behind swappable interfaces. |
| `sendguard.js` | `SENDGUARD_SRC` | Strict variable resolver, compliance footer, pre-send guard, copy linter, deterministic variant assignment. |
| `deliverability.js` | `DELIVERABILITY_SRC` | ACST/ACDT send window, warmup ramp, jitter, circuit breaker. |
| `replyclass.js` | `REPLYCLASS_SRC` | Reply classification and referral extraction. |

These are `String.raw` templates, so **a stray backtick anywhere in the file —
including inside a comment — silently truncates the source.** Every file must
contain exactly two backticks. `grep -c '`' *.js` is the check.

### Validation

```bash
docker cp ops/leadgen ivnautomation-n8n:/tmp/lg
docker exec -w /tmp/lg ivnautomation-n8n node test-leadgen.js        # 140 assertions
docker exec -w /tmp/lg ivnautomation-n8n node lint-templates.js templates.json --sql
docker exec -w /tmp/lg ivnautomation-n8n node scrape-test.js sample-sites.json
```

`test-leadgen.js` proves the guards block rather than asserting they exist:
suppressed address, missing `source_url`, unresolved template variable, mailbox
over cap, guessed-and-unverified address, incomplete compliance footer, outside
send window. It also checks the ACST/ACDT boundary on both 2026 transition
dates.

### Migrations

- `20260807-01-decision-maker-targeting.sql` — segment taxonomy layered over
  the existing `leads.segments` (no `segment_id` is touched), `lead_contact`,
  `lead_signal`, `outreach_event`, `mailbox`, `campaign*`, `sequence_state`,
  `pipeline_stage`, `reply_action`; backfills `suburb`/`postcode` from
  `address` (they were NULL on all 2865 rows) and seeds the funnel from the
  existing send history.
- `20260807-02-campaigns-registries.sql` — registry storage, unsubscribe
  tokens, per-segment copy, 12 campaigns x 5 steps x 2 variants, and the six
  dashboard views.

Both are idempotent: a second run reports `INSERT 0 0` / `UPDATE 0` on every
statement. Run them twice before believing a change.

### Deployed workflows

| workflow | id | patch |
|---|---|---|
| Worker Lead Dashboard | `pC85wHkQPzwh8dhd` | `patch-dashboard.js` — six conversion panels |
| Outreach Compliance API | `KQcompliance01` | `build-compliance-workflow.js` |

**The draft and the published graph diverge on this box.** `Inject Source
Category Breakdown UI` exists in `workflow_entity.nodes` and not in the live
`workflow_history` row. `patch-dashboard.js` therefore discovers the tail of the
injector chain from the graph it is handed and drops connection keys naming
nodes that do not exist — a dangling key makes n8n throw inside
`getParentNodes` and the whole dashboard 500s.

`$env` is denied inside Code nodes on this build ("access to env vars denied").
Shared secrets go in `leads.system_settings`, which is also easier to rotate.

The Postgres node splits `queryReplacement` on commas, so a JSON argument loses
parameters and the statement fails with "there is no parameter $4". Pass scalars
and build the jsonb in SQL, or use the array expression form.

### Not switched on

- `leads.campaign.enabled = false` on all 12.
- `michelle@outreach.kqualitycleaningservices.com.au` is `paused` until its DNS
  is verified — see `dns/OUTREACH-DOMAIN.md`. `leads.mailbox_daily_cap()`
  returns 0 for a paused mailbox, so the dispatcher cannot send from it.
- The send-path switchover (Daily Automated Outreach Engine calling
  `kqgPreSend` before every send) is written but not deployed. It changes what
  actually leaves the building and wants a human on the first run.
