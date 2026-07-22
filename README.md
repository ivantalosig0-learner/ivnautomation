# IVNautomation — KQuality Cleaning Services

AI-powered lead generation, outreach, and CRM platform for Quality Cleaning
Services Australia. Snapshot repository of the production system: n8n workflow
exports, worker dashboard, AI gateway source, database schema, and the public
website.

See **CLAUDE.md** for the full architecture, engine pipeline, operational
conventions, and production lessons. The live system runs on a VPS — this repo
is documentation and disaster-recovery source, not a deployment artifact.

## Contents

| Path | What it is |
|---|---|
| `workflows/` | All 19 n8n workflows (JSON exports, credentials referenced by ID only) |
| `dashboard/` | Served snapshot of the team dashboard single-page app |
| `gateway/` | FastAPI AI Gateway (Qwen3-8B via llama.cpp) source |
| `database/` | `leads` schema DDL |
| `website/` | kqualitycleaningservices.com.au static site |
| `docs/` | Infrastructure docker-compose (secrets via env vars, not included) |

## Restore notes

- Workflows: import JSON via n8n UI or API, re-attach credentials (SMTP, IMAP, Postgres), re-publish, verify each schedule trigger is connected to its first node.
- Database: `psql -f database/schema.sql` creates the `leads` schema.
- Gateway: `docker compose up -d` in `gateway/` after creating `.env` (see CLAUDE.md).
