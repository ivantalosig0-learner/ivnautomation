# Database Schema (`leads`)

Full DDL: `database/schema.sql`. Access:
`docker exec ivnautomation-postgres psql -U ivan -d ivnautomation -c "..."`

## Core tables
- **candidates** — hub. stage: discovered->enriched->qualified/disqualified. `duplicate_of` (dedup), `enrichment` jsonb, `qualification_score`, `shortlist_rank`.
- **segments / sources** — classification + provenance; `segments.priority_weight` feeds scoring.
- **outreach_drafts** — one per candidate. status draft/approved/rejected/sent; `message_id` after send.
- **outreach_followups** — follow-up sends; also used to record dashboard replies.
- **inbound_replies** — matched_by: message_id | references | email_fallback | subject | unmatched.
- **crm_records** — stage new/contacted/replied/won/lost + notes/next_action.
- **crm_stage_history** — stage transitions.
- **notifications** — severity info/warning/error; dashboard feed.
- **outreach_runs** — one row/day (idempotent daily guard).
- **system_settings** — kill switch, cap, threshold.
- **dashboard_users / dashboard_sessions** — salted SHA-256 auth, 7-day sessions.

## Scoring (qual_v1)
email 40, preferred-email +5, phone 15, website 10, linkedin 10, social 5,
clean-enrichment 5, + segment weight. qualified >= 55 with email. Bands: hot>=80, warm>=55.
