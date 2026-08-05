#!/usr/bin/env node
/*
 * build.js <workflowId> <patch.js> <live.json> <out.sql>
 *
 * Pure transform — no docker, so it can run inside the n8n container which is
 * the only place with a node runtime on this box.
 *
 * n8n 2.30.5 executes public.workflow_history WHERE versionId =
 * workflow_entity."activeVersionId". Writing workflow_entity.nodes alone only
 * edits the draft, so the emitted SQL writes the draft AND inserts a new
 * history row AND moves activeVersionId onto it.
 */
const fs = require('fs');
const crypto = require('crypto');
const vm = require('vm');

const [, , workflowId, patchPath, livePath, outPath] = process.argv;
if (!workflowId || !patchPath || !livePath || !outPath) {
  console.error('usage: build.js <workflowId> <patch.js> <live.json> <out.sql>');
  process.exit(1);
}

const live = JSON.parse(fs.readFileSync(livePath, 'utf8'));
const patch = require(patchPath.startsWith('/') ? patchPath : process.cwd() + '/' + patchPath);

const before = JSON.stringify(live.nodes).length;
const out = patch(live.nodes, live.connections);
if (!out || !Array.isArray(out.nodes)) { console.error('patch returned no nodes'); process.exit(1); }

// Every Code node must parse, or the workflow ships broken and the engine
// fails silently at runtime.
let checked = 0;
for (const n of out.nodes) {
  if (n.type === 'n8n-nodes-base.code' && n.parameters && n.parameters.jsCode) {
    try { new vm.Script('(async function(){' + n.parameters.jsCode + '\n})'); checked++; }
    catch (e) { console.error('SYNTAX ERROR in Code node "' + n.name + '": ' + e.message); process.exit(1); }
  }
}

const versionId = crypto.randomUUID();
const nodesJson = JSON.stringify(out.nodes);
const connsJson = JSON.stringify(out.connections || live.connections);
if (nodesJson.includes('$wfdoc$') || connsJson.includes('$wfdoc$')) {
  console.error('payload collides with the dollar-quote tag'); process.exit(1);
}
const Q = (s) => '$wfdoc$' + s + '$wfdoc$';

fs.writeFileSync(outPath, `BEGIN;
UPDATE workflow_entity SET
  nodes = ${Q(nodesJson)}::json,
  connections = ${Q(connsJson)}::json,
  "versionId" = '${versionId}',
  "versionCounter" = ${(live.counter || 1) + 1},
  "updatedAt" = now()
WHERE id = '${workflowId}';

INSERT INTO workflow_history ("versionId","workflowId",authors,nodes,connections,name,autosaved)
SELECT '${versionId}', '${workflowId}', 'leadgen-refresh-20260805',
       ${Q(nodesJson)}::json, ${Q(connsJson)}::json, name, false
FROM workflow_entity WHERE id = '${workflowId}';

UPDATE workflow_entity SET "activeVersionId" = '${versionId}' WHERE id = '${workflowId}';
COMMIT;
`);

console.log('built ' + workflowId + ' v' + versionId +
            ' | nodes ' + out.nodes.length +
            ' | code nodes checked ' + checked +
            ' | bytes ' + before + ' -> ' + nodesJson.length);
