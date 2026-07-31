# Hermes — Sandboxed Code & Systems Intelligence

Hermes runs on the VPS as a **read-only** intelligence layer over the whole
engineering estate. It indexes; it does not reason and it does not touch
production. Reasoning happens in Claude, which talks to Hermes over MCP and pulls
only the files it needs.

## What it indexes — three collections

| Collection | Source | What it covers |
|---|---|---|
| `repo` | `/home/ivan/ivnautomation-repo` | IVNautomation lead-gen: n8n workflow exports, AI Gateway, `leads` schema, marketing website, worker dashboard |
| `workforce` | `/home/ivan/kquality-workforce-repo` | KQuality Workforce: FastAPI backend, Treasury Core, manager console, Expo mobile app, ops runbooks |
| `infra` | `/home/ivan/hermes/infra` (generated hourly) | What is actually deployed: containers + ports, Caddy hostnames, compose files, host cron |

`infra` is a **secret-redacted snapshot of the live VPS**, not source code. Ask it
"what is deployed / what URL serves what / what runs on a schedule" instead of
inferring from a repo that may have drifted from production.

## What it can and cannot do
- ✅ Search and read all three collections, and answer "where is X / how does Y work"
- ❌ Cannot reach the production database, n8n, mail, or the payment rails (network-isolated)
- ❌ Cannot modify anything — every mount is read-only
- ❌ Cannot exhaust the host — hard-capped at 1.5 GB RAM / 1.5 CPU

### Deliberately NOT indexed
Masked with empty read-only mounts so Hermes physically cannot read them:
the treasury root key (`backend/secrets/`), the WORM audit sink (`backend/worm/`),
worker photo and signature uploads (`backend/media/`), and all `.env` files.

## Where it lives
- Compose, Dockerfile, guardrails, maintenance scripts: `/home/ivan/hermes/`
- Container: `hermes-agent` (image `hermes-agent-local`)
- Operating context and hard rules the agent follows: `/home/ivan/hermes/HERMES_CONTEXT.md`
- Index (qmd): persistent Docker volume `hermes_hermes_state`
- Maintenance log: `/home/ivan/hermes/maintain.log`

## Using it from the shell
```bash
docker exec hermes-agent qmd query "how are leads scored"      # hybrid, best quality
docker exec hermes-agent qmd search "dual control payout" -c workforce
docker exec hermes-agent qmd ls infra
docker exec hermes-agent qmd get qmd://repo/CLAUDE.md
docker exec hermes-agent qmd status
```

## Staying current — automatic
Cron keeps the index true to the VPS; there is nothing to run by hand:
- **hourly** (`:17`) — regenerate the `infra` snapshot, reassert the collection
  registry, re-index changed files
- **nightly** (`03:40`) — the above plus refresh vector embeddings (CPU-heavy)

Force a run now:
```bash
/home/ivan/hermes/bin/hermes-maintain.sh          # fast
/home/ivan/hermes/bin/hermes-maintain.sh --embed  # slow, includes embeddings
```

## Why Hermes lost the repo before — and what now prevents it

Two separate qmd behaviours combined into a silent failure:

1. **The collection registry lived in the container's writable layer.**
   `~/.config/qmd/index.yml` is qmd's source of truth for which collections exist,
   but `~/.config` was **not** part of the `hermes_state` volume — only `~/.hermes`
   was. Every `docker compose up --force-recreate` therefore destroyed the
   registry. The indexed *documents* survived in sqlite, so nothing looked broken;
   Hermes simply no longer knew the repo existed.
2. **`qmd collection add` rewrites that whole file**, keeping only the collections
   that invocation knows about and deleting the rest — with no warning.

Fixes now in place:

- `index.yml` is a **host** bind mount (`/home/ivan/hermes/qmd-config/`), so it
  survives container recreates and can be backed up and edited directly.
- `bin/index.yml.canonical` is the known-good copy. The hourly job runs
  `bin/verify_qmd_config.sh`, which restores it and restarts the container if any
  of the three collections goes missing — so a drop self-heals within the hour.

**When adding a collection, edit `qmd-config/index.yml` by hand and run
`qmd update`.** Avoid `qmd collection add`; it will delete the others. Update
`bin/index.yml.canonical` to match afterwards.

Symptom to watch for: `qmd status` showing fewer than three collections.

## Safety model
Even if the agent misbehaves it is confined to its container: read-only mounts,
no production network, no docker socket, dropped Linux capabilities,
no-new-privileges, and hard RAM/CPU limits. It cannot break the live system.
