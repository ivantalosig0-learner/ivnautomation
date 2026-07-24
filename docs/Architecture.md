# IVNautomation — System Architecture

## Purpose
AI-powered lead-generation, outreach, and CRM platform for Quality Cleaning
Services Australia. Reusable automation foundation; cleaning is the first vertical.

## High-level flow
Opportunity Discovery -> Lead Intelligence (web enrichment) -> Lead Qualification
(scoring) -> Personalized/Daily Outreach (email) -> Follow-up -> Reply Detection ->
CRM. Each stage also chain-triggers the next (fire-and-forget).

## Components
- **n8n** (`ivnautomation-n8n`) — workflow engine, https://n8n.kqualitycleaningservices.com.au
- **PostgreSQL 17** (`ivnautomation-postgres`) — app schema `leads`; n8n tables in `public`. Bound to 127.0.0.1.
- **AI Gateway** (`ivnautomation-ai-gateway`, :8000) — FastAPI fronting the model, INFERENCE_TIMEOUT_S=300
- **llama.cpp** (`ivnautomation-llama`, :8080) — Qwen3-8B-Q5_K_M, CPU-only, --parallel 2. PRODUCTION ONLY.
- **Browserless** (`browserless:3000`) — JS render fallback for enrichment
- **Worker dashboard** — served via n8n webhook `worker-leads-k7m2x9q4`; API webhook `worker-api-x9q2k4m7`
- **Public website** — `/opt/ivnautomation/www/kqualitycleaningservices`
- **Caddy** — reverse proxy / TLS on the host
- **Mail** — Gmail kqualitycleaningservices@gmail.com (SMTP send + IMAP watch)
- **Hermes** (`hermes-agent`) — sandboxed READ-ONLY code intelligence; reasoning via Claude Desktop (no local inference)

## Timezones
Business logic PHT (Asia/Manila); n8n workflow tz Australia/Adelaide. Do not assume they match.

## Isolation boundaries
- postgres/n8n bound to 127.0.0.1 — unreachable from off-network containers.
- Hermes: read-only repo, 1.5GB/1.5CPU cap, no docker socket, no production-AI route.
- Production Qwen/gateway serve production workflows only and are independent of Hermes.
