# Hermes v3 — Claude Desktop as the Only Reasoning Engine

Architecture: **Claude Desktop → (MCP over SSH) → qmd retrieval → only relevant
files → Claude reasons.** Hermes does NO inference; it indexes, searches, and
returns minimal context. Qwen/llama.cpp are fully severed and serve production only.

## Token-efficiency model
- Claude calls the qmd MCP `query`/`search` tools first, gets back doc IDs + snippets.
- Claude then pulls only specific files/line-ranges via `get` — never the whole repo.
- The index is incremental (`qmd update` only re-reads changed files).
- Engineering docs (docs/*.md) are first-class, high-signal retrieval targets.

## Connect Claude Desktop (MCP over SSH, stdio — most token-efficient transport)

### 1. Lock the SSH channel to read-only retrieval (recommended)
On the VPS, the wrapper `/home/ivan/hermes/qmd-mcp-forced.sh` runs ONLY the qmd MCP
server. Install your Claude Desktop machine's PUBLIC key with a forced command so
that key can do nothing else:

```
# in /home/ivan/.ssh/authorized_keys, one line:
command="/home/ivan/hermes/qmd-mcp-forced.sh",no-port-forwarding,no-x11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 AAAA...yourDesktopKey claude-desktop
```

Generate a key on your Desktop machine if needed:
`ssh-keygen -t ed25519 -f ~/.ssh/hermes_mcp -C claude-desktop`
Then send me the contents of `~/.ssh/hermes_mcp.pub` and I'll install it hardened.

### 2. Add the MCP server to Claude Desktop
Edit `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "hermes-repo": {
      "command": "ssh",
      "args": [
        "-i", "C:\\Users\\<you>\\.ssh\\hermes_mcp",
        "-o", "StrictHostKeyChecking=accept-new",
        "ivan@187.127.207.38",
        "docker exec -i hermes-agent qmd mcp"
      ]
    }
  }
}
```
(With the forced command installed, the trailing `docker exec…` is ignored — the key
can only launch qmd mcp. Keep it for clarity.)

### 3. Choose the reasoning model IN Claude Desktop
Reasoning model selection lives in Claude Desktop, not on the VPS:
- Default: **Claude Sonnet 5** (medium reasoning).
- When you want deeper reasoning, say "use Opus" and switch the model to **Opus** for
  that session. Hermes/qmd are model-agnostic — they just return context.

## What Claude can retrieve
qmd tools exposed over MCP: `query`, `search` (BM25), `vsearch` (semantic), `get`,
`multi-get`, `status`, `ls` — over **three** collections:

- `repo` — IVNautomation lead-gen (workflows, gateway, schema, website, dashboard)
- `workforce` — KQuality Workforce (backend, Treasury Core, manager console, mobile)
- `infra` — a secret-redacted hourly snapshot of what is actually deployed on the VPS

Read-only. No writes, no production access. Each collection and its major
subdirectories carry a human-written `context` blurb that qmd returns alongside
results, so Claude can tell which platform a hit belongs to without opening it.

Scope a search when you already know the area — `qmd search "payout" -c workforce`
— it is both faster and more precise than searching all three.
