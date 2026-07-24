# Hermes Console (auth-gated engineering dashboard)

- Page: https://n8n.kqualitycleaningservices.com.au/webhook/hermes-console
- API:  /webhook/hermes-console-api  (login + status; reuses dashboard_users/sessions)
- n8n workflow: "Hermes Console" (sFh2SNdR7ojyklx5)
- Live data: leads.hermes_status, refreshed every 2 min by collect_status.sh (host cron).
- Read-only. Shows index status, repo/git, recent files, health, workflow inventory,
  Claude engine status, estimated tokens saved, and a clickable galaxy architecture graph.
