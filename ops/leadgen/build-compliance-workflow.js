#!/usr/bin/env node
/*
 * build-compliance-workflow.js — emits the SQL that creates (or re-publishes)
 * the "Outreach Compliance API" workflow.
 *
 * Two public endpoints the send path cannot be lawful without:
 *
 *   GET  /webhook/unsubscribe?t=<token>   one-click opt-out, honoured instantly
 *   POST /webhook/outreach-event?k=<key>  ESP feedback: delivery, bounce,
 *                                         complaint, open, click
 *
 * The second one is what the diagnostic found missing entirely: the only 31
 * hard bounces on record were a manual backfill matching no send, so bounce
 * rate could not be computed and the circuit breaker had nothing to read.
 *
 * Idempotent: same workflow id every time, publishes through workflow_history
 * and activeVersionId exactly like ops/leadgen/deploy.sh.
 *
 *   docker exec -w /tmp/lg ivnautomation-n8n node build-compliance-workflow.js > publish-compliance.sql
 */
const crypto = require('crypto');

const WF_ID = 'KQcompliance01';
const PG_CRED = { id: 'jqlh240FlAgCW2po', name: 'Postgres account' };
const PROJECT_ID = 'KOHgUGR0BRjv8pcN';

// ---------------------------------------------------------------------
// Unsubscribe. One statement so the opt-out, the audit event and the stopped
// sequence either all happen or none do — a suppression that is not logged is
// a compliance gap, and a logged opt-out that did not suppress is worse.
// ---------------------------------------------------------------------
const UNSUB_SQL = `
WITH c AS (
  SELECT lc.id, lc.candidate_id, lc.email
    FROM leads.lead_contact lc
   WHERE lc.unsubscribe_token = $1 AND lc.email IS NOT NULL
),
sup AS (
  INSERT INTO leads.suppression (email_norm, domain_norm, reason, candidate_id, scope, is_permanent, source)
  SELECT lower(btrim(c.email)), NULL, 'unsubscribe', c.candidate_id, 'email', true, 'unsubscribe_link'
    FROM c
  ON CONFLICT (email_norm) WHERE email_norm IS NOT NULL DO NOTHING
  RETURNING 1
),
ev AS (
  INSERT INTO leads.outreach_event (candidate_id, contact_id, event_type, occurred_at, meta)
  SELECT c.candidate_id, c.id, 'unsubscribe', now(),
         jsonb_build_object('via', 'unsubscribe_link')
    FROM c
  RETURNING 1
),
seq AS (
  UPDATE leads.sequence_state s
     SET status = 'stopped', stop_reason = 'unsubscribe', updated_at = now()
    FROM c WHERE s.candidate_id = c.candidate_id AND s.status = 'active'
  RETURNING 1
)
SELECT (SELECT count(*) FROM c) AS matched, (SELECT email FROM c) AS email`;

// ---------------------------------------------------------------------
// ESP feedback ingestion. Writes the event, suppresses on a hard bounce or a
// complaint, and pauses the mailbox the moment the rolling 7-day rate crosses
// the threshold — the circuit breaker has to act on the write, not on a later
// scheduled pass, or the next 39 sends still go out.
// ---------------------------------------------------------------------
const EVENT_SQL = `
WITH input AS (
  -- Five scalar parameters, never a JSON blob: the Postgres node splits its
  -- queryReplacement on commas, so a jsonb argument silently loses arguments
  -- and the statement fails with "there is no parameter $4".
  SELECT lower(btrim($1::text)) AS event_type,
         lower(btrim($2::text)) AS email,
         nullif(btrim($3::text), '') AS message_id,
         nullif(btrim($4::text), '') AS mailbox,
         nullif(btrim($5::text), '') AS raw_event,
         jsonb_build_object('raw_event', $5::text, 'mailbox', $4::text) AS meta
),
mb AS (
  SELECT m.id FROM leads.mailbox m, input i
   WHERE i.mailbox IS NOT NULL AND lower(m.address) = lower(i.mailbox)
   LIMIT 1
),
tgt AS (
  SELECT lc.id AS contact_id, lc.candidate_id
    FROM leads.lead_contact lc, input i
   WHERE lower(lc.email) = i.email
   LIMIT 1
),
ev AS (
  INSERT INTO leads.outreach_event (candidate_id, contact_id, mailbox_id, event_type, occurred_at, message_id, meta)
  SELECT t.candidate_id, t.contact_id, (SELECT id FROM mb), i.event_type, now(), i.message_id, i.meta
    FROM input i LEFT JOIN tgt t ON true
   WHERE i.event_type IN ('delivered','bounce_hard','bounce_soft','open','click','complaint','unsubscribe')
  RETURNING 1
),
sup AS (
  INSERT INTO leads.suppression (email_norm, domain_norm, reason, candidate_id, scope, is_permanent, source)
  SELECT i.email, NULL,
         CASE WHEN i.event_type = 'complaint' THEN 'complaint' ELSE 'hard_bounce' END,
         (SELECT candidate_id FROM tgt), 'email', true, 'esp_webhook'
    FROM input i
   WHERE i.event_type IN ('bounce_hard','complaint','unsubscribe') AND i.email <> ''
  ON CONFLICT (email_norm) WHERE email_norm IS NOT NULL DO NOTHING
  RETURNING 1
),
breaker AS (
  UPDATE leads.mailbox m
     SET status = 'paused',
         paused_reason = 'circuit breaker: ' || h.reason,
         paused_at = now()
    FROM (
      SELECT mh.mailbox_id,
             CASE WHEN coalesce(mh.hard_bounce_pct_7d, 0) > 3.0 THEN
                    'hard bounce ' || mh.hard_bounce_pct_7d || '% over 3% on ' || mh.sent_7d || ' sends'
                  ELSE 'complaints ' || coalesce(mh.complaint_pct_7d, 0) || '% over 0.1%' END AS reason,
             mh.sent_7d, mh.hard_bounce_pct_7d, mh.complaint_pct_7d
        FROM leads.mailbox_health mh
    ) h
   WHERE m.id = h.mailbox_id
     AND m.status <> 'paused'
     AND h.sent_7d >= 20
     AND (coalesce(h.hard_bounce_pct_7d, 0) > 3.0 OR coalesce(h.complaint_pct_7d, 0) > 0.1)
  RETURNING m.id, m.address, m.paused_reason
),
alert AS (
  INSERT INTO leads.notifications (type, severity, title, message, created_at)
  SELECT 'deliverability', 'error', 'Mailbox paused by circuit breaker',
         b.address || ' - ' || b.paused_reason, now()
    FROM breaker b
  RETURNING 1
)
SELECT (SELECT count(*) FROM ev) AS events_written,
       (SELECT count(*) FROM sup) AS suppressed,
       (SELECT count(*) FROM breaker) AS mailboxes_paused`;

const UNSUB_PAGE = `
const matched = Number(($json && $json.matched) || 0);
const email = ($json && $json.email) || '';
const page = '<!doctype html><html lang="en-AU"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Unsubscribed - KQuality Cleaning Services</title>' +
  '<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:34rem;' +
  'margin:8vh auto;padding:0 1.2rem;color:#1c2430;line-height:1.55}' +
  'h1{font-size:1.35rem;margin:0 0 .6rem}p{margin:.5rem 0}.muted{color:#5b6672;font-size:.9rem}</style>' +
  '</head><body>' +
  (matched
    ? '<h1>You have been unsubscribed</h1><p>' + String(email).replace(/[<>&]/g, '') +
      ' will not receive any further outreach from us.</p>'
    : '<h1>Link not recognised</h1><p>That unsubscribe link is not valid. ' +
      'Reply to any of our emails with the word <strong>unsubscribe</strong> and we will remove you.</p>') +
  '<p class="muted">KQuality Cleaning Services, Adelaide SA. ' +
  'Requests are actioned immediately and permanently.</p>' +
  '</body></html>';
return { json: { page } };
`;

const nodes = [
  {
    id: 'c3f1a001-0000-4000-8000-000000000001',
    name: 'GET /unsubscribe',
    type: 'n8n-nodes-base.webhook',
    position: [0, 0],
    webhookId: 'c3f1a001-0000-4000-8000-0000000000a1',
    parameters: { path: 'unsubscribe', options: {}, responseMode: 'responseNode' },
    typeVersion: 2
  },
  {
    id: 'c3f1a001-0000-4000-8000-000000000002',
    name: 'Suppress By Token',
    type: 'n8n-nodes-base.postgres',
    position: [220, 0],
    parameters: {
      query: UNSUB_SQL,
      options: { queryReplacement: '={{ $json.query && $json.query.t ? $json.query.t : "" }}' },
      operation: 'executeQuery'
    },
    credentials: { postgres: PG_CRED },
    onError: 'continueRegularOutput',
    typeVersion: 2.6
  },
  {
    id: 'c3f1a001-0000-4000-8000-000000000003',
    name: 'Build Unsubscribe Page',
    type: 'n8n-nodes-base.code',
    position: [440, 0],
    parameters: { jsCode: UNSUB_PAGE },
    typeVersion: 2
  },
  {
    id: 'c3f1a001-0000-4000-8000-000000000004',
    name: 'Respond Unsubscribe',
    type: 'n8n-nodes-base.respondToWebhook',
    position: [660, 0],
    parameters: {
      respondWith: 'text',
      responseBody: '={{ $json.page }}',
      options: { responseHeaders: { entries: [{ name: 'content-type', value: 'text/html; charset=utf-8' }] } }
    },
    typeVersion: 1.1
  },
  {
    id: 'c3f1a001-0000-4000-8000-000000000005',
    name: 'POST /outreach-event',
    type: 'n8n-nodes-base.webhook',
    position: [0, 220],
    webhookId: 'c3f1a001-0000-4000-8000-0000000000a2',
    parameters: { path: 'outreach-event', options: {}, httpMethod: 'POST', responseMode: 'responseNode' },
    typeVersion: 2
  },
  {
    id: 'c3f1a001-0000-4000-8000-00000000000b',
    name: 'Fetch Webhook Key',
    type: 'n8n-nodes-base.postgres',
    position: [220, 220],
    parameters: {
      // This n8n build denies $env inside Code nodes ("access to env vars
      // denied"), so the shared secret lives in system_settings instead. It is
      // also the better home: rotating it is an UPDATE, not a container
      // recreate, and the stack stays untouched.
      query: "SELECT coalesce(max(value), '') AS expected FROM leads.system_settings WHERE key = 'outreach_webhook_key'",
      options: {},
      operation: 'executeQuery'
    },
    credentials: { postgres: PG_CRED },
    executeOnce: true,
    typeVersion: 2.6
  },
  {
    id: 'c3f1a001-0000-4000-8000-000000000006',
    name: 'Normalise Event',
    type: 'n8n-nodes-base.code',
    position: [440, 220],
    parameters: {
      jsCode: `
/*
 * One shape for every provider. ESPs disagree about names — "bounce" with a
 * "permanent" flag, "hardbounce", "spamreport", "abuse" — and the DB constraint
 * only accepts the canonical set, so anything unmapped is dropped rather than
 * inserted as a lie.
 */
const hook = $('POST /outreach-event').first().json || {};
const body = hook.body || {};
const secret = (hook.query && hook.query.k) || '';
const expected = String(($json && $json.expected) || '');
const raw = String(body.event || body.type || body.Event || '').toLowerCase().replace(/[\\s_-]/g, '');
const permanent = body.permanent === true || /permanent|hard|5\\.\\d\\.\\d/.test(String(body.reason || body.diagnostic || ''));
const MAP = {
  delivered: 'delivered', delivery: 'delivered', deliver: 'delivered',
  hardbounce: 'bounce_hard', bouncehard: 'bounce_hard', dropped: 'bounce_hard',
  softbounce: 'bounce_soft', bouncesoft: 'bounce_soft', deferred: 'bounce_soft',
  open: 'open', opened: 'open',
  click: 'click', clicked: 'click',
  complaint: 'complaint', spamreport: 'complaint', abuse: 'complaint', complained: 'complaint',
  unsubscribe: 'unsubscribe', unsubscribed: 'unsubscribe',
  bounce: permanent ? 'bounce_hard' : 'bounce_soft'
};
const event_type = MAP[raw] || null;
const email = String(body.email || body.recipient || body.to || '').trim().toLowerCase();
return [{ json: {
  authorised: Boolean(expected) && secret === expected,
  event_type,
  email,
  message_id: String(body.message_id || body.messageId || body['message-id'] || ''),
  mailbox: String(body.mailbox || body.sender || ''),
  raw_event: raw
} }];
`
    },
    typeVersion: 2
  },
  {
    id: 'c3f1a001-0000-4000-8000-000000000007',
    name: 'Authorised And Mapped?',
    type: 'n8n-nodes-base.if',
    position: [660, 220],
    parameters: {
      conditions: {
        options: { version: 2, caseSensitive: true, typeValidation: 'strict' },
        combinator: 'and',
        conditions: [
          { id: 'k1', operator: { type: 'boolean', operation: 'true', singleValue: true },
            leftValue: '={{ $json.authorised }}', rightValue: '' },
          { id: 'k2', operator: { type: 'string', operation: 'notEmpty', singleValue: true },
            leftValue: '={{ $json.event_type }}', rightValue: '' }
        ]
      },
      options: {}
    },
    typeVersion: 2.2
  },
  {
    id: 'c3f1a001-0000-4000-8000-000000000008',
    name: 'Record Event',
    type: 'n8n-nodes-base.postgres',
    position: [880, 140],
    parameters: {
      query: EVENT_SQL,
      options: {
        queryReplacement:
          '={{ [$json.event_type, $json.email, $json.message_id, $json.mailbox, $json.raw_event] }}'
      },
      operation: 'executeQuery'
    },
    credentials: { postgres: PG_CRED },
    onError: 'continueRegularOutput',
    typeVersion: 2.6
  },
  {
    id: 'c3f1a001-0000-4000-8000-000000000009',
    name: 'Respond Event OK',
    type: 'n8n-nodes-base.respondToWebhook',
    position: [1100, 140],
    parameters: { respondWith: 'json', responseBody: '={{ JSON.stringify($json) }}', options: {} },
    typeVersion: 1.1
  },
  {
    id: 'c3f1a001-0000-4000-8000-00000000000a',
    name: 'Respond Event Rejected',
    type: 'n8n-nodes-base.respondToWebhook',
    position: [880, 340],
    parameters: {
      respondWith: 'json',
      responseBody: '={{ JSON.stringify({ ok: false, reason: "unauthorised or unmapped event" }) }}',
      // responseCode lives under options on this node version; as a top-level
      // parameter it is ignored and every rejection answers 200.
      options: { responseCode: 400 }
    },
    typeVersion: 1.1
  }
];

const connections = {
  'GET /unsubscribe': { main: [[{ node: 'Suppress By Token', type: 'main', index: 0 }]] },
  'Suppress By Token': { main: [[{ node: 'Build Unsubscribe Page', type: 'main', index: 0 }]] },
  'Build Unsubscribe Page': { main: [[{ node: 'Respond Unsubscribe', type: 'main', index: 0 }]] },
  'POST /outreach-event': { main: [[{ node: 'Fetch Webhook Key', type: 'main', index: 0 }]] },
  'Fetch Webhook Key': { main: [[{ node: 'Normalise Event', type: 'main', index: 0 }]] },
  'Normalise Event': { main: [[{ node: 'Authorised And Mapped?', type: 'main', index: 0 }]] },
  'Authorised And Mapped?': {
    main: [
      [{ node: 'Record Event', type: 'main', index: 0 }],
      [{ node: 'Respond Event Rejected', type: 'main', index: 0 }]
    ]
  },
  'Record Event': { main: [[{ node: 'Respond Event OK', type: 'main', index: 0 }]] }
};

const settings = {
  executionOrder: 'v1',
  errorWorkflow: '39Vcvm1lkmQZXFpS',
  timezone: 'Australia/Adelaide',
  executionTimeout: 60,
  saveDataSuccessExecution: 'all'
};

// Syntax-check every Code node before emitting SQL, same guarantee build.js gives.
const vm = require('vm');
for (const n of nodes) {
  if (n.type === 'n8n-nodes-base.code') {
    try { new vm.Script('(async function(){' + n.parameters.jsCode + '\n})'); }
    catch (e) { console.error('SYNTAX ERROR in "' + n.name + '": ' + e.message); process.exit(1); }
  }
}

const versionId = crypto.randomUUID();
const Q = (s) => '$kqdoc$' + s + '$kqdoc$';
const nodesJson = JSON.stringify(nodes);
const connsJson = JSON.stringify(connections);
if ((nodesJson + connsJson).includes('$kqdoc$')) { console.error('dollar-quote collision'); process.exit(1); }

process.stdout.write(`BEGIN;

INSERT INTO workflow_entity (id, name, active, nodes, connections, settings, "versionId", "versionCounter", "createdAt", "updatedAt")
VALUES ('${WF_ID}', 'Outreach Compliance API', true,
        ${Q(nodesJson)}::json, ${Q(connsJson)}::json, ${Q(JSON.stringify(settings))}::json,
        '${versionId}', 1, now(), now())
ON CONFLICT (id) DO UPDATE SET
  nodes = EXCLUDED.nodes, connections = EXCLUDED.connections, settings = EXCLUDED.settings,
  active = true, "versionId" = EXCLUDED."versionId",
  "versionCounter" = workflow_entity."versionCounter" + 1, "updatedAt" = now();

INSERT INTO workflow_history ("versionId", "workflowId", authors, nodes, connections, name, autosaved)
VALUES ('${versionId}', '${WF_ID}', 'decision-maker-targeting-20260807',
        ${Q(nodesJson)}::json, ${Q(connsJson)}::json, 'Outreach Compliance API', false);

UPDATE workflow_entity SET "activeVersionId" = '${versionId}' WHERE id = '${WF_ID}';

INSERT INTO shared_workflow ("workflowId", "projectId", role, "createdAt", "updatedAt")
VALUES ('${WF_ID}', '${PROJECT_ID}', 'workflow:owner', now(), now())
ON CONFLICT DO NOTHING;

COMMIT;
`);
