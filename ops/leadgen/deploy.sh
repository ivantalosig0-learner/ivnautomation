#!/usr/bin/env bash
# deploy.sh <workflowId> <patch.js>
# Reads the LIVE published graph, patches it in the n8n container (only node
# runtime on this box), then publishes via draft + workflow_history + activeVersionId.
set -euo pipefail

WF="$1"; PATCH="$2"
DIR="$HOME/leadgen-refresh-20260805"
PG="docker exec -i ivnautomation-postgres psql -U ivan -d ivnautomation -tAq -v ON_ERROR_STOP=1"

# 1. export the live (published) graph
$PG -c "SELECT json_build_object('nodes', h.nodes, 'connections', h.connections,
          'name', w.name, 'counter', w.\"versionCounter\")::text
        FROM workflow_entity w
        JOIN workflow_history h ON h.\"versionId\" = w.\"activeVersionId\"
        WHERE w.id = '$WF'" > "$DIR/live-$WF.json"

test -s "$DIR/live-$WF.json" || { echo "no active version for $WF"; exit 1; }

# 2. patch + syntax-check inside the container
docker cp "$DIR" ivnautomation-n8n:/tmp/wfbuild >/dev/null
docker exec -w /tmp/wfbuild ivnautomation-n8n \
  node build.js "$WF" "./$PATCH" "live-$WF.json" "publish-$WF.sql"
docker cp "ivnautomation-n8n:/tmp/wfbuild/publish-$WF.sql" "$DIR/publish-$WF.sql" >/dev/null
docker exec ivnautomation-n8n rm -rf /tmp/wfbuild

# 3. publish
$PG -f - < "$DIR/publish-$WF.sql"

# 4. verify against the LIVE row, not the draft
$PG -c "SELECT 'live nodes: ' || json_array_length(h.nodes)
        FROM workflow_entity w JOIN workflow_history h ON h.\"versionId\" = w.\"activeVersionId\"
        WHERE w.id = '$WF'"
echo "published $WF"
