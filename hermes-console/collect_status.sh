#!/bin/bash
# Collects Hermes/qmd + git + repo stats and upserts a JSON snapshot into
# leads.hermes_status for the auth-gated Hermes Dashboard. READ-ONLY collection.
set -e
REPO=/home/ivan/ivnautomation-repo
cd "$REPO"

STATUS_RAW=$(docker exec hermes-agent qmd status 2>/dev/null || echo "")
INDEXED=$(echo "$STATUS_RAW" | grep -iE "Total:" | grep -oE "[0-9]+" | head -1)
VECTORS=$(echo "$STATUS_RAW" | grep -iE "Vectors:" | grep -oE "[0-9]+" | head -1)
IDXSIZE=$(echo "$STATUS_RAW" | grep -iE "Size:" | head -1 | sed 's/.*Size:[[:space:]]*//')

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
COMMIT=$(git log -1 --format='%h' 2>/dev/null)
COMMIT_MSG=$(git log -1 --format='%s' 2>/dev/null | sed 's/"/\\"/g' | cut -c1-100)
COMMIT_AT=$(git log -1 --format='%cI' 2>/dev/null)
TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "none")
REMOTE=$(git remote get-url origin 2>/dev/null | sed 's/"/\\"/g')
REPO_BYTES=$(du -sb "$REPO" --exclude=.git 2>/dev/null | awk '{print $1}')
FILE_COUNT=$(git ls-files 2>/dev/null | wc -l | tr -d ' ')
WF_COUNT=$(ls "$REPO"/workflows/*.json 2>/dev/null | wc -l | tr -d ' ')
DOC_COUNT=$(ls "$REPO"/docs/*.md 2>/dev/null | wc -l | tr -d ' ')

# recently changed files (last 8)
RECENT=$(git log -8 --name-only --format='%x00%h%x1f%cI%x1f%s' 2>/dev/null | python3 -c '
import sys,json
out=[];cur=None
for line in sys.stdin:
    line=line.rstrip("\n")
    if line.startswith("\x00"):
        h,ts,msg=line[1:].split("\x1f"); cur={"commit":h,"ts":ts,"msg":msg[:80]}
    elif line.strip() and cur:
        out.append({"file":line.strip(),**cur})
print(json.dumps(out[:12]))
' 2>/dev/null || echo "[]")

# hermes container health + caps
HMEM=$(docker stats --no-stream --format "{{.MemUsage}}" hermes-agent 2>/dev/null)
HCPU=$(docker stats --no-stream --format "{{.CPUPerc}}" hermes-agent 2>/dev/null)
HUP=$(docker ps --format "{{.Names}} {{.Status}}" | grep hermes-agent | sed 's/hermes-agent //')

# qmd search latency probe (ms) — BM25, no inference
T0=$(date +%s%3N)
docker exec hermes-agent qmd search "outreach" >/dev/null 2>&1 || true
T1=$(date +%s%3N)
LATENCY=$((T1-T0))

python3 - "$INDEXED" "$VECTORS" "$IDXSIZE" "$BRANCH" "$COMMIT" "$COMMIT_MSG" "$COMMIT_AT" "$TAG" "$REMOTE" "$REPO_BYTES" "$FILE_COUNT" "$WF_COUNT" "$DOC_COUNT" "$RECENT" "$HMEM" "$HCPU" "$HUP" "$LATENCY" << 'PY'
import sys,json,datetime
a=sys.argv
def num(x):
    try:return int(x)
    except:return 0
data={
 "generated_at": datetime.datetime.utcnow().isoformat()+"Z",
 "index": {"indexed_files": num(a[1]), "vectors": num(a[2]), "index_size": a[3] or "n/a",
           "search_latency_ms": num(a[18]), "mode": "BM25 keyword (no inference)"},
 "git": {"branch": a[4], "commit": a[5], "commit_msg": a[6], "commit_at": a[7],
         "release": a[8], "remote": a[9]},
 "repo": {"size_bytes": num(a[10]), "tracked_files": num(a[11]),
          "workflows": num(a[12]), "docs": num(a[13])},
 "recent_files": json.loads(a[14]) if a[14] else [],
 "hermes": {"status": a[17], "mem": a[15], "cpu": a[16],
            "reasoning_engine": "Claude Desktop (Sonnet 5 default / Opus on request)",
            "local_inference": False, "qwen_dependency": False},
}
json.dump(data,open("/tmp/hermes_status.json","w"))
import sys as _s; _s.stderr.write("ok\n")
PY

# upsert into DB (base64 = quote-safe)
B64=$(base64 -w0 /tmp/hermes_status.json)
docker exec -i ivnautomation-postgres psql -U ivan -d ivnautomation -q \
  -c "INSERT INTO leads.hermes_status (id,data,updated_at) VALUES (1, convert_from(decode('$B64','base64'),'UTF8')::jsonb, now()) ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data, updated_at=now();" >/dev/null 2>&1

echo "status collected $(date -u +%H:%M:%S)"
