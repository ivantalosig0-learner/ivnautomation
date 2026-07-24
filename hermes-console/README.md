# Hermes Console (auth-gated engineering dashboard)

- Page: https://n8n.kqualitycleaningservices.com.au/webhook/hermes-console
- API:  /webhook/hermes-console-api  (login + status; reuses dashboard_users/sessions)
- n8n workflow: "Hermes Console" (sFh2SNdR7ojyklx5)
- Live data: leads.hermes_status, refreshed every 2 min by collect_status.sh (host cron).
- Read-only. Shows index status, repo/git, recent files, health, workflow inventory,
  Claude engine status, estimated tokens saved, and a clickable galaxy architecture graph.

## Ask Hermes (in-dashboard search)
The "Ask Hermes" tab queries the qmd index (keyword/BM25, no inference) and returns
relevant files + snippets. Backend: a read-only search service in the hermes
container (search_server.py, :8899), reached by n8n over a dedicated `hermes-link`
network. Postgres stays off that network — verified unreachable from Hermes.
For reasoning over results, use Claude Desktop (same index via MCP).

## Architecture Galaxy fix
The D3 force graph now builds only when its tab is visible and has real dimensions
(prevents the zero-size invisible render).
