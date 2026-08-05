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
