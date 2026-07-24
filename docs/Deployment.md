# Deployment & Operations

## Hosts / containers
docker compose stacks under `/opt/ivnautomation` (infra) and `/opt/ivnautomation-ai` (gateway).
Containers: ivnautomation-n8n, -postgres, -ai-gateway, -llama, browserless; plus hermes-agent.

## Common operations
- DB: `docker exec ivnautomation-postgres psql -U ivan -d ivnautomation -c "..."`
- Gateway config: edit `/opt/ivnautomation-ai/gateway/.env`, then `docker compose up -d` in that dir.
- n8n after significant edits: `docker restart ivnautomation-n8n` (triggers can go quiet after in-place edits).
- Workflow changes: via n8n MCP `update_workflow` + `publish_workflow`. Verify trigger->first-node connection.

## Backups
- Repo: github.com/ivantalosig0-learner/ivnautomation (private), tag v1.0-stable.
- Workflow/schema archive: `~/ivnautomation-backups/`.

## Mail hygiene
Outreach BCCs +outreach@gmail.com -> Gmail filter labels "KQuality Outreach" + skips inbox.
Replies (subject Re:) -> label "KQuality Replies", NOT archived (stay in inbox).
