#!/usr/bin/env bash
# Install the VPS SSH key and register the ssh-mcp connectors on this device.
#
# Every host-specific value — private key, host key pins, hostnames, users,
# ports, connector names — is read from the setup document passed in, which is
# handed over out of band and never lives in this repo. The script itself
# contains no secrets and no host identities.
#
# Usage:
#   ops/tablet/setup-vps-connectors.sh ~/storage/downloads/VPS-CONNECTOR-SETUP.docx
#
# Accepts the .docx or a plain-text/markdown copy of the same document.
#
# Options:
#   --key-name NAME   basename of the key under ~/.ssh   (default: vps_ed25519)
#   --scope SCOPE     claude mcp scope: user|local|project (default: user)
#   --no-mcp          install key + known_hosts + ssh config only
#   --no-ssh-config   skip the managed ~/.ssh/config block
#   --shred           delete the setup document after a successful run
#
# Re-running is safe: the key, host pins, ssh config block and MCP entries are
# all replaced in place rather than duplicated.

set -euo pipefail

KEY_NAME=vps_ed25519
SCOPE=user
DO_MCP=1
DO_SSH_CONFIG=1
DO_SHRED=0
DOC=""

die()  { printf '\nFAILED: %s\n' "$*" >&2; exit 1; }
step() { printf '\n== %s\n' "$*"; }
ok()   { printf '   ok  %s\n' "$*"; }
warn() { printf '   !!  %s\n' "$*"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --key-name)      KEY_NAME=${2:?--key-name needs a value}; shift 2 ;;
    --scope)         SCOPE=${2:?--scope needs a value}; shift 2 ;;
    --no-mcp)        DO_MCP=0; shift ;;
    --no-ssh-config) DO_SSH_CONFIG=0; shift ;;
    --shred)         DO_SHRED=1; shift ;;
    -h|--help)       sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*)              die "unknown option: $1" ;;
    *)               [ -z "$DOC" ] || die "pass exactly one setup document"; DOC=$1; shift ;;
  esac
done

[ -n "$DOC" ] || die "pass the setup document, e.g. $0 ~/storage/downloads/VPS-CONNECTOR-SETUP.docx"
[ -r "$DOC" ] || die "cannot read $DOC"

SSH_DIR=$HOME/.ssh
KEY=$SSH_DIR/$KEY_NAME
PUB=$KEY.pub
KNOWN=$SSH_DIR/known_hosts
CONFIG=$SSH_DIR/config

umask 077
WORK=$(mktemp -d "${TMPDIR:-/tmp}/vpsconn.XXXXXX")
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------- 1. tooling
step "Checking tooling"
for c in ssh ssh-keygen sed grep awk; do
  command -v "$c" >/dev/null 2>&1 || die "$c not found. On Termux: pkg install openssh"
done
ok "ssh $(ssh -V 2>&1 | head -1)"

HAVE_NODE=0
command -v node >/dev/null 2>&1 && command -v npx >/dev/null 2>&1 && HAVE_NODE=1
HAVE_CLAUDE=0
command -v claude >/dev/null 2>&1 && HAVE_CLAUDE=1

if [ "$DO_MCP" = 1 ]; then
  [ "$HAVE_NODE" = 1 ]   || { warn "node/npx missing — MCP connectors skipped (Termux: pkg install nodejs)"; DO_MCP=0; }
  [ "$HAVE_CLAUDE" = 1 ] || { warn "claude CLI missing — MCP connectors skipped"; DO_MCP=0; }
fi

# ---------------------------------------------------- 2. document -> plain text
step "Reading $DOC"
TXT=$WORK/doc.txt
if head -c 2 "$DOC" | grep -q PK; then
  command -v unzip >/dev/null 2>&1 || die "unzip not found and the document is a .docx (Termux: pkg install unzip)"
  unzip -p "$DOC" word/document.xml \
    | sed -e 's|<w:p[ >]|\n&|g; s|<w:p/>|\n|g' \
          -e 's|<w:br[^>]*>|\n|g' \
          -e 's|<w:tab[^>]*>|\t|g' \
          -e 's|<[^>]*>||g' \
    | sed -e 's|&lt;|<|g; s|&gt;|>|g; s|&quot;|"|g; s|&apos;|'\''|g; s|&amp;|\&|g' \
    > "$TXT"
  ok "extracted $(wc -l < "$TXT") lines from the .docx"
else
  cp "$DOC" "$TXT"
  ok "read $(wc -l < "$TXT") lines of plain text"
fi

# ------------------------------------------------------------ 3. the key pair
step "Installing the key pair"
mkdir -p "$SSH_DIR"; chmod 700 "$SSH_DIR"

sed -n '/-----BEGIN OPENSSH PRIVATE KEY-----/,/-----END OPENSSH PRIVATE KEY-----/p' "$TXT" > "$WORK/key"
grep -q 'END OPENSSH PRIVATE KEY' "$WORK/key" || die "no private key block found in the document"
# OpenSSH rejects a key file without a trailing newline; sed output always has one.
chmod 600 "$WORK/key"

FP_DOC=$(grep -o 'SHA256:[A-Za-z0-9+/=]\{20,\}' "$TXT" | head -1 || true)
FP_KEY=$(ssh-keygen -lf "$WORK/key" 2>/dev/null | awk '{print $2}' || true)
[ -n "$FP_KEY" ] || die "the extracted private key does not parse — the document may be damaged"
if [ -n "$FP_DOC" ]; then
  [ "$FP_KEY" = "$FP_DOC" ] || die "fingerprint mismatch: key is $FP_KEY, document states $FP_DOC"
  ok "fingerprint verified against the document: $FP_KEY"
else
  warn "document states no fingerprint; installed key is $FP_KEY"
fi

install -m 600 "$WORK/key" "$KEY"
ok "$KEY (0600)"

if grep -m1 -E '^ssh-(ed25519|rsa) AAAA' "$TXT" > "$WORK/key.pub"; then
  install -m 644 "$WORK/key.pub" "$PUB"
else
  ssh-keygen -y -f "$KEY" > "$PUB"; chmod 644 "$PUB"
fi
ok "$PUB (0644)"

# ------------------------------------------------------------ 4. host key pins
step "Pinning host keys"
touch "$KNOWN"; chmod 600 "$KNOWN"
PINNED=0
grep -E '^[0-9]{1,3}(\.[0-9]{1,3}){3}[ ,][^ ]* ssh-(ed25519|rsa|ecdsa)[^ ]* AAAA' "$TXT" > "$WORK/pins" || true
grep -E '^[0-9]{1,3}(\.[0-9]{1,3}){3} ssh-(ed25519|rsa|ecdsa)[^ ]* AAAA' "$TXT" >> "$WORK/pins" || true
sort -u "$WORK/pins" -o "$WORK/pins"
while IFS= read -r line; do
  [ -n "$line" ] || continue
  h=${line%% *}
  if ssh-keygen -F "$h" -f "$KNOWN" >/dev/null 2>&1; then
    ok "$h already pinned"
  else
    printf '%s\n' "$line" >> "$KNOWN"
    ok "$h pinned"
  fi
  PINNED=$((PINNED+1))
done < "$WORK/pins"
[ "$PINNED" -gt 0 ] || warn "no host key lines found — first connection will prompt for yes/no"

# ------------------------------------------------------- 5. connector definitions
step "Reading connector definitions"
awk '/^```json/{f=1;next} f&&/^```/{exit} f{print}' "$TXT" > "$WORK/mcp.json"
[ -s "$WORK/mcp.json" ] || die "no json connector block found in the document"

if [ "$HAVE_NODE" = 1 ]; then
  node -e '
    const fs = require("fs");
    const cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const keyPath = process.argv[2];
    const servers = cfg.mcpServers || cfg;
    for (const [name, def] of Object.entries(servers)) {
      const args = (def.args || []).map(a => a.startsWith("--key=") ? "--key=" + keyPath : a);
      const get = p => { const a = args.find(x => x.startsWith(p)); return a ? a.slice(p.length) : ""; };
      const out = Object.assign({}, def, { args });
      process.stdout.write([name, get("--host="), get("--port=") || "22", get("--user="),
                            JSON.stringify(out)].join("\t") + "\n");
    }
  ' "$WORK/mcp.json" "$KEY" > "$WORK/servers.tsv"
else
  # no node: recover names/host/user with sed so ssh verification still runs
  sed -n 's/^[[:space:]]*"\([^"]*\)"[[:space:]]*:[[:space:]]*{.*/\1/p' "$WORK/mcp.json" \
    | grep -v '^mcpServers$' > "$WORK/names" || true
  sed -n 's/.*"--host=\([^"]*\)".*/\1/p' "$WORK/mcp.json" > "$WORK/hosts"
  sed -n 's/.*"--user=\([^"]*\)".*/\1/p' "$WORK/mcp.json" > "$WORK/users"
  sed -n 's/.*"--port=\([^"]*\)".*/\1/p' "$WORK/mcp.json" > "$WORK/ports"
  if [ "$(wc -l < "$WORK/names")" != "$(wc -l < "$WORK/hosts")" ]; then
    awk '{print "host"NR}' "$WORK/hosts" > "$WORK/names"
  fi
  [ "$(wc -l < "$WORK/ports")" = "$(wc -l < "$WORK/hosts")" ] || awk '{print 22}' "$WORK/hosts" > "$WORK/ports"
  paste -d'\t' "$WORK/names" "$WORK/hosts" "$WORK/ports" "$WORK/users" \
    | awk -F'\t' '{print $0"\t"}' > "$WORK/servers.tsv"
fi
[ -s "$WORK/servers.tsv" ] || die "the json connector block defines no servers"
ok "$(wc -l < "$WORK/servers.tsv") connector(s): $(cut -f1 "$WORK/servers.tsv" | tr '\n' ' ')"

# aliases the document declares in its ssh config block (Host x / HostName ip)
awk '/^[Hh]ost /{a=$2} /^[[:space:]]*HostName /{print $2"\t"a}' "$TXT" | sort -u > "$WORK/aliases" || true

# ------------------------------------------------------------- 6. verify login
step "Verifying SSH login"
FAIL=0
while IFS=$'\t' read -r name host port user json; do
  [ -n "$host" ] || continue
  if out=$(ssh -i "$KEY" -p "${port:-22}" \
                -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15 \
                -o StrictHostKeyChecking=yes \
                "$user@$host" 'hostname' 2>&1); then
    ok "$name -> $user@$host:$port is $out"
  else
    warn "$name -> $user@$host:$port FAILED: $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-200)"
    FAIL=1
  fi
done < "$WORK/servers.tsv"
[ "$FAIL" = 0 ] || die "at least one host did not answer — fix SSH before the connectors will work"

# ------------------------------------------------------------- 7. ssh config
if [ "$DO_SSH_CONFIG" = 1 ]; then
  step "Writing the managed ~/.ssh/config block"
  BEGIN='# >>> ivn vps connectors (managed by ops/tablet/setup-vps-connectors.sh) >>>'
  END='# <<< ivn vps connectors <<<'
  touch "$CONFIG"; chmod 600 "$CONFIG"
  awk -v b="$BEGIN" -v e="$END" '
    $0==b{s=1} !s{print} $0==e{s=0}' "$CONFIG" > "$WORK/config.new"
  {
    printf '%s\n' "$BEGIN"
    while IFS=$'\t' read -r name host port user json; do
      [ -n "$host" ] || continue
      alias=$(awk -F'\t' -v h="$host" '$1==h{printf " %s", $2}' "$WORK/aliases")
      printf 'Host %s%s\n' "$name" "$alias"
      printf '    HostName %s\n    User %s\n    Port %s\n' "$host" "$user" "${port:-22}"
      printf '    IdentityFile %s\n    IdentitiesOnly yes\n' "$KEY"
    done < "$WORK/servers.tsv"
    printf '%s\n' "$END"
  } >> "$WORK/config.new"
  install -m 600 "$WORK/config.new" "$CONFIG"
  ok "aliases: $(awk '/^Host /{for(i=2;i<=NF;i++)printf "%s ", $i}' "$WORK/config.new")"
fi

# ---------------------------------------------------------- 8. mcp connectors
if [ "$DO_MCP" = 1 ]; then
  step "Registering MCP connectors (scope: $SCOPE)"
  while IFS=$'\t' read -r name host port user json; do
    [ -n "$name" ] && [ -n "$json" ] || continue
    claude mcp remove "$name" -s "$SCOPE" >/dev/null 2>&1 || true
    if claude mcp add-json "$name" "$json" -s "$SCOPE" >/dev/null 2>&1; then
      ok "$name registered"
    else
      claude mcp add-json "$name" "$json" -s "$SCOPE" || die "could not register $name"
    fi
  done < "$WORK/servers.tsv"
  printf '\n'
  claude mcp list || true
fi

# -------------------------------------------------------------- 9. the document
step "Done"
if [ "$DO_SHRED" = 1 ]; then
  if command -v shred >/dev/null 2>&1; then shred -u "$DOC"; else rm -f "$DOC"; fi
  ok "deleted $DOC"
else
  cat <<MSG
   !!  The setup document still holds the live private key. Delete it now:
           shred -u "$DOC"  ||  rm -f "$DOC"
       Also clear it from the chat/Downloads history it arrived through.
MSG
fi

cat <<'MSG'

   Next: restart Claude Code so it picks up the connectors, then check
   `claude mcp list` reports them connected. Plain SSH also works now:
   `ssh <connector-name> 'uptime'`.
MSG
