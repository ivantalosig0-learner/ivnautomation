# Tablet → VPS connectors

One-command setup that gives Claude Code on a tablet (Termux) SSH access to the
two VPSs, as `ssh-mcp` connectors plus plain-SSH aliases.

## Why the hosts are not in this file

`ivnautomation` is a **public** repository. The private key, the host addresses,
the login users and the host-key pins all live in the setup document that is
handed over out of band (`VPS-CONNECTOR-SETUP.docx`) — never here. The script
reads everything it needs from that document at run time, so this repo carries
tooling only.

## Run it on the tablet

```bash
pkg install openssh unzip nodejs      # Termux prerequisites
git -C ~/ivnautomation pull
~/ivnautomation/ops/tablet/setup-vps-connectors.sh ~/storage/downloads/VPS-CONNECTOR-SETUP.docx
```

Without a checkout, fetch the script alone:

```bash
curl -fsSLO https://raw.githubusercontent.com/ivantalosig0-learner/ivnautomation/main/ops/tablet/setup-vps-connectors.sh
bash setup-vps-connectors.sh ~/storage/downloads/VPS-CONNECTOR-SETUP.docx
```

Then restart Claude Code and confirm `claude mcp list` reports both connectors
connected.

## What it does

1. Checks tooling (`ssh`, `ssh-keygen`, `unzip`; `node`/`npx` and `claude` for MCP).
2. Converts the `.docx` to text (a plain-text or markdown copy works too).
3. Installs the private key to `~/.ssh/vps_ed25519` (`0600`, trailing newline) and
   the public key alongside it, **aborting if the key's fingerprint does not match
   the one the document states**.
4. Appends the document's host-key pins to `~/.ssh/known_hosts`, skipping hosts
   already pinned — so the first connection neither prompts nor trusts blindly.
5. Reads the connector definitions from the document's JSON block and rewrites
   `--key=` to the absolute path on this device (`~` is not expanded by ssh-mcp).
6. Verifies a real login to every host with `StrictHostKeyChecking=yes` and stops
   if any host fails to answer — connectors are never registered against a host
   that does not work.
7. Writes a marker-delimited block in `~/.ssh/config` so `ssh ivn-vps` / `ssh vps`
   (plus the document's own aliases) work.
8. Registers each connector with `claude mcp add-json` at user scope.

Re-running is safe: key, pins, config block and MCP entries are replaced in place.

## Options

| Flag | Effect |
|---|---|
| `--key-name NAME` | key basename under `~/.ssh` (default `vps_ed25519`) |
| `--scope user\|local\|project` | `claude mcp` scope (default `user`) |
| `--no-mcp` | key, pins and ssh config only |
| `--no-ssh-config` | skip the `~/.ssh/config` block |
| `--shred` | delete the setup document once the run succeeds |

## No node on the tablet

The script detects it, skips MCP registration and still installs the key, the
pins and the ssh aliases — full access over plain SSH from the Bash tool, one
round trip per call:

```bash
ssh ivn-vps 'uptime'
ssh vps 'uptime'
```

## After a successful run

- Delete the document — it holds a live private key (`--shred` does it for you),
  and clear it from the Downloads/chat history it arrived through.
- Never commit the key. `.gitignore` blocks the usual filenames, but the only
  real guard is not copying it into a working tree.
- Rotation, if the key is ever exposed: generate a new pair, append the new
  `.pub` to `~/.ssh/authorized_keys` on **both** hosts, confirm login with it,
  then remove the old line from both.

## Operating rules on these boxes

The document's own section 4 is authoritative. In short: retrieve sections, not
whole files; prefer the Hetzner box for anything read repeatedly; `sudo` on the
Hostinger box eats stdin, so stage to `/tmp` and `install` it; that box has 16 GB
with 12 GB held by Qwen — do not restart it or start anything large without
checking free memory first.
