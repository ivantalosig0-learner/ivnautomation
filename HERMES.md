# Hermes — Sandboxed Code Intelligence for IVNautomation

Hermes Agent (Nous Research) runs on the VPS as a **read-only** code-intelligence
assistant that indexes this repository so the team can search and reason about the
whole system. It is deliberately walled off from production.

## What it can and cannot do
- ✅ Read + search the repo (workflows, dashboard, gateway, schema, docs, website)
- ✅ Answer "where is X / how does Y work" using the local Qwen3-8B model
- ❌ Cannot reach the production database, n8n, or mail (network-isolated)
- ❌ Cannot modify the repo (mounted read-only) or the live system
- ❌ Cannot exhaust the host — hard-capped at 1.5 GB RAM / 1.5 CPU

## Where it lives
- Compose + Dockerfile + guardrail context: `/home/ivan/hermes/`
- Container: `hermes-agent` (image `hermes-agent-local`)
- Goal + hard rules the agent must follow: `/home/ivan/hermes/HERMES_CONTEXT.md`
- Search index (qmd): persistent Docker volume `hermes_hermes_state`

## How to use it (keyword search — always available)
```bash
docker exec hermes-agent qmd search "reply detection imap matching"
docker exec hermes-agent qmd search "daily outreach cron"
docker exec hermes-agent qmd ls repo            # list indexed files
docker exec hermes-agent qmd get qmd://repo/CLAUDE.md   # read a file
```

## Chat with the agent about the codebase
```bash
docker exec -it hermes-agent hermes
```
It uses the local LLM at http://host.docker.internal:8080/v1 (shared with
production inference, so responses are slower while outreach is running).

## Re-index after repo changes
```bash
cd /home/ivan/ivnautomation-repo && git pull      # if pulling from GitHub
docker exec hermes-agent qmd update               # re-index (keyword, instant)
```

## Semantic (vector) search — optional, run in a quiet window
Vector embeddings use extra CPU. Because the host's 4 cores are usually saturated
by the production Qwen model, run the embed only when outreach is paused:
```bash
docker exec -d hermes-agent bash -lc 'nice -n 19 qmd embed --max-docs-per-batch 4 --max-batch-mb 2'
docker exec hermes-agent qmd vsearch "how are leads scored"   # once embedded
```
Keyword search (`qmd search`) needs no models and works at all times.

## Safety model
Even if the agent misbehaves, it is confined to its container: read-only repo,
no production network, no docker socket, dropped Linux capabilities,
no-new-privileges, and hard RAM/CPU limits. It cannot break the live system.
