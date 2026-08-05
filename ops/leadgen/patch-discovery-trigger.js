/* Adds a manual Execute-Workflow trigger to the Discovery engine.
 * Discovery sits at the head of the chain so it only ever had a schedule
 * trigger, which means it could not be re-run on demand — a failed morning run
 * meant waiting a full day. The new trigger feeds the same first node as the
 * schedule trigger, so both paths are identical.
 */
const TRIGGER_NAME = 'Manual Trigger (on demand)';

module.exports = function (nodes, connections) {
  if (nodes.some(n => n.name === TRIGGER_NAME)) return { nodes, connections };

  const sched = nodes.find(n => n.type === 'n8n-nodes-base.scheduleTrigger');
  if (!sched) throw new Error('no schedule trigger to mirror');

  // whatever the schedule trigger feeds, the manual trigger feeds too
  const downstream = (connections[sched.name] && connections[sched.name].main) || [];
  if (!downstream.length) throw new Error('schedule trigger has no downstream node');

  nodes.push({
    parameters: {},
    type: 'n8n-nodes-base.executeWorkflowTrigger',
    typeVersion: 1,
    position: [(sched.position?.[0] ?? 0), (sched.position?.[1] ?? 0) + 200],
    id: 'a7f3c1d2-0b44-4e91-9c66-manualdiscov1',
    name: TRIGGER_NAME,
  });

  connections[TRIGGER_NAME] = { main: JSON.parse(JSON.stringify(downstream)) };
  return { nodes, connections };
};
