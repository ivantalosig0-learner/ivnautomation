#!/usr/bin/env bash
# Export the LIVE (published) graph of each refreshed workflow back into the
# repo snapshot, so re-importing the repo cannot silently revert the refresh.
set -euo pipefail
REPO="$HOME/ivnautomation-repo/workflows"
PG="docker exec -i ivnautomation-postgres psql -U ivan -d ivnautomation -tAq"

declare -A WF=(
  [YLP4NPutkGPwlhkA]=opportunity-discovery-engine.json
  [mwHCwOBO9RuyDNGs]=lead-qualification-engine.json
  [3bNNqQehDJdK8onH]=daily-automated-outreach-engine.json
  [HJB5HhkSbi1Qozrr]=personalized-outreach-engine.json
  [Lib5FMwNDcgaX3qv]=outreach-follow-up-engine.json
)

for id in "${!WF[@]}"; do
  f="${WF[$id]}"
  $PG -c "SELECT jsonb_pretty(jsonb_build_object(
            'id', w.id, 'name', w.name, 'active', w.active,
            'settings', w.settings, 'nodes', h.nodes::jsonb,
            'connections', h.connections::jsonb))
          FROM workflow_entity w
          JOIN workflow_history h ON h.\"versionId\" = w.\"activeVersionId\"
          WHERE w.id = '$id'" > "$REPO/$f"
  echo "exported $f ($(wc -c < "$REPO/$f") bytes)"
done
