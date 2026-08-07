/*
 * patch-dashboard.js — Phase 5 conversion panels for the Worker Lead Dashboard
 * (workflow pC85wHkQPzwh8dhd).
 *
 * Purely additive. Every existing node, view, style and injector is left
 * exactly as it is; this appends one Postgres node and one injector to the end
 * of the existing injector chain and re-points the last hop at Respond With
 * Page. Re-running the patch replaces the two named nodes rather than adding
 * duplicates, so it is idempotent like the others in this directory.
 *
 * All six panels read from leads.outreach_event + leads.lead_contact through
 * the views created in 20260807-01/02. No new storage layer (§6).
 */

const METRICS_SQL = `
SELECT json_build_object(
  'generated_at', now(),
  'goals', json_build_object(
    'deliverability_pct', 97, 'open_pct', 40, 'reply_pct', 6,
    'positive_pct', 2, 'booked_pct', 0.8, 'complaint_pct', 0.1),
  'funnel', (
    SELECT row_to_json(t) FROM (
      SELECT sum(scraped) AS scraped, sum(enriched) AS enriched,
             sum(decision_maker_found) AS decision_maker, sum(queued) AS queued,
             sum(sent) AS sent, sum(delivered) AS delivered, sum(opened) AS opened,
             sum(replied) AS replied, sum(positive) AS positive,
             sum(booked) AS booked, sum(won) AS won
        FROM leads.v_funnel_by_segment) t),
  'segments', (
    SELECT COALESCE(json_agg(s ORDER BY s.scraped DESC), '[]'::json)
      FROM leads.v_funnel_by_segment s),
  'coverage', (
    SELECT COALESCE(json_agg(c ORDER BY c.leads DESC), '[]'::json)
      FROM leads.v_enrichment_coverage c),
  'mailboxes', (
    SELECT COALESCE(json_agg(m ORDER BY m.address), '[]'::json)
      FROM leads.mailbox_health m),
  'variants', (
    SELECT COALESCE(json_agg(v ORDER BY v.step_no, v.variant_code), '[]'::json)
      FROM (SELECT step_no, variant_code, lint_status,
                   sum(sent) AS sent, sum(opened) AS opened, sum(replied) AS replied,
                   sum(positive) AS positive, sum(booked) AS booked,
                   bool_and(below_min_sample) AS below_min_sample
              FROM leads.v_variant_performance
             GROUP BY step_no, variant_code, lint_status) v),
  'actions', (
    SELECT COALESCE(json_agg(a ORDER BY a.received_at), '[]'::json)
      FROM (SELECT * FROM leads.v_action_queue LIMIT 50) a),
  'signals', (
    SELECT COALESCE(json_agg(x ORDER BY x.n DESC), '[]'::json)
      FROM (SELECT signal_type, count(*) AS n
              FROM leads.lead_signal
             WHERE expires_at IS NULL OR expires_at > now()
             GROUP BY 1) x)
) AS result`.replace(/\s+/g, ' ').trim();

const PANEL_HTML = [
'<div id="convSection" style="margin-top:22px">',
  '<h2 class="opsh2">Conversion funnel</h2>',
  '<div id="convFunnel" class="stats" style="margin-bottom:6px"></div>',
  '<div id="convFunnelRates" style="font-size:12px;opacity:.75;margin-bottom:18px"></div>',
  '<h2 class="opsh2">Enrichment coverage</h2>',
  '<div id="convCoverage" style="margin-bottom:18px;overflow-x:auto"></div>',
  '<h2 class="opsh2">Funnel by segment</h2>',
  '<div id="convSegments" style="margin-bottom:18px;overflow-x:auto"></div>',
  '<h2 class="opsh2">Deliverability</h2>',
  '<div id="convMailboxes" style="margin-bottom:18px;overflow-x:auto"></div>',
  '<h2 class="opsh2">Variant performance</h2>',
  '<div id="convVariants" style="margin-bottom:18px;overflow-x:auto"></div>',
  '<h2 class="opsh2">Action queue - positive replies awaiting a human</h2>',
  '<div id="convActions" style="margin-bottom:8px;overflow-x:auto"></div>',
  '<div id="convStamp" style="font-size:11px;opacity:.6"></div>',
'</div>'
].join('');

/*
 * Rendered from a constant embedded at build time rather than fetched, so the
 * panels cannot add a request to the page load and cannot fail separately from
 * it. Every renderer handles an empty array — an empty result set has to look
 * like "nothing yet", not like a broken page (§7).
 */
const PANEL_JS = `
(function(){
  var M = window.__CONV_METRICS__ || {};
  function cesc(s){ return String(s==null?'':s).replace(/[&<>"]/g, function(c){
    return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]; }); }
  function cel(id){ return document.getElementById(id); }
  function num(v){ return (v===null||v===undefined||v==='') ? 0 : Number(v); }
  function pct(a,b){ return num(b) ? (100*num(a)/num(b)).toFixed(1)+'%' : '-'; }
  function stat(n,l){ return '<div class="stat"><div class="n">'+cesc(n)+'</div><div class="l">'+cesc(l)+'</div></div>'; }
  function table(cols, rows, rowFn){
    if(!rows || !rows.length) return '<div class="empty">No data yet.</div>';
    var head = '<tr>'+cols.map(function(c){ return '<th style="text-align:left;padding:4px 10px 4px 0;font-size:11px;opacity:.7;white-space:nowrap">'+cesc(c)+'</th>'; }).join('')+'</tr>';
    var body = rows.map(rowFn).join('');
    return '<table style="border-collapse:collapse;font-size:12px;width:100%">'+head+body+'</table>';
  }
  function td(v, style){ return '<td style="padding:3px 10px 3px 0;white-space:nowrap;'+(style||'')+'">'+cesc(v)+'</td>'; }

  // --- funnel ---
  var f = M.funnel || {};
  var order = [['scraped','Scraped'],['enriched','Enriched'],['decision_maker','DM found'],
               ['queued','Queued'],['sent','Sent'],['delivered','Delivered'],['opened','Opened'],
               ['replied','Replied'],['positive','Positive'],['booked','Booked'],['won','Won']];
  var fe = cel('convFunnel');
  if(fe) fe.innerHTML = order.map(function(o){ return stat(num(f[o[0]]), o[1]); }).join('') || '<div class="empty">No data yet.</div>';
  var fr = cel('convFunnelRates');
  if(fr){
    var g = M.goals || {};
    var parts = [];
    for(var i=1;i<order.length;i++){
      parts.push(order[i][1]+' ' + pct(f[order[i][0]], f[order[i-1][0]]));
    }
    var sent = num(f.sent);
    parts.push('| reply/send ' + pct(f.replied, sent) + ' (goal ' + num(g.reply_pct) + '%)');
    parts.push('positive/send ' + pct(f.positive, sent) + ' (goal ' + num(g.positive_pct) + '%)');
    parts.push('booked/send ' + pct(f.booked, sent) + ' (goal ' + num(g.booked_pct) + '%)');
    fr.textContent = parts.join('  ');
  }

  // --- enrichment coverage: the leading indicator for everything else ---
  var ce = cel('convCoverage');
  if(ce) ce.innerHTML = table(
    ['Segment','Leads','Any email','Rank 1-2','Personal email','Verified','Active signal','Needs enrichment','DM coverage'],
    M.coverage || [],
    function(r){
      var cov = pct(r.with_personal_email, r.leads);
      return '<tr>'+td(r.segment_code)+td(r.leads)+td(r.with_any_email)+td(r.with_rank12_contact)+
             td(r.with_personal_email)+td(r.with_verified_email)+td(r.with_active_signal)+
             td(r.needs_enrichment)+td(cov, 'font-weight:600')+'</tr>';
    });

  // --- funnel by segment ---
  var cs = cel('convSegments');
  if(cs) cs.innerHTML = table(
    ['Segment','Scraped','Enriched','DM','Queued','Sent','Delivered','Opened','Replied','Positive','Booked','Won','Reply %'],
    M.segments || [],
    function(r){
      return '<tr>'+td(r.segment_code)+td(r.scraped)+td(r.enriched)+td(r.decision_maker_found)+
             td(r.queued)+td(r.sent)+td(r.delivered)+td(r.opened)+td(r.replied)+td(r.positive)+
             td(r.booked)+td(r.won)+td(pct(r.replied, r.sent),'font-weight:600')+'</tr>';
    });

  // --- deliverability ---
  var cm = cel('convMailboxes');
  if(cm) cm.innerHTML = table(
    ['Mailbox','Domain','Status','Warmup from','Cap today','Sent today','Sent 7d','Hard bounce 7d','Bounce %','Complaint %','Breaker'],
    M.mailboxes || [],
    function(r){
      var bp = r.hard_bounce_pct_7d, cp = r.complaint_pct_7d;
      var tripped = (num(bp) > 3) || (num(cp) > 0.1) || r.status === 'paused';
      return '<tr'+(tripped?' style="color:#c0392b;font-weight:600"':'')+'>'+
             td(r.address)+td(r.sending_domain)+td(r.status)+td(r.warmup_started_on||'-')+
             td(r.daily_cap_today)+td(r.sent_today)+td(r.sent_7d)+td(r.hard_bounce_7d)+
             td(bp===null||bp===undefined?'-':bp+'%')+td(cp===null||cp===undefined?'-':cp+'%')+
             td(r.status==='paused'?'PAUSED':(tripped?'AT LIMIT':'ok'))+'</tr>';
    });

  // --- variants ---
  var cv = cel('convVariants');
  if(cv) cv.innerHTML = table(
    ['Step','Variant','Lint','Sent','Opened','Replied','Positive','Booked','Reply %','Sample'],
    M.variants || [],
    function(r){
      return '<tr>'+td(r.step_no)+td(r.variant_code)+td(r.lint_status)+td(r.sent)+td(r.opened)+
             td(r.replied)+td(r.positive)+td(r.booked)+td(pct(r.replied,r.sent))+
             td(r.below_min_sample ? 'n<200 - do not promote' : 'ok',
                r.below_min_sample ? 'opacity:.7' : '')+'</tr>';
    });

  // --- action queue ---
  var ca = cel('convActions');
  if(ca) ca.innerHTML = table(
    ['Age (h)','Business','Segment','Contact','Title','Email','Phone','Class','Received'],
    M.actions || [],
    function(r){
      return '<tr'+(r.overdue?' style="color:#c0392b;font-weight:600"':'')+'>'+
             td(r.age_hours)+td(r.business_name)+td(r.segment_code)+td(r.full_name||'-')+
             td(r.job_title||'-')+td(r.email||'-')+td(r.phone||'-')+td(r.classification)+
             td(String(r.received_at||'').slice(0,16).replace('T',' '))+'</tr>';
    });

  var st = cel('convStamp');
  if(st) st.textContent = 'Conversion metrics generated ' + String(M.generated_at || '').slice(0,19).replace('T',' ') +
    '  -  overdue = positive reply unanswered for more than 4 hours';
})();
`;

const INJECTOR_JS_TEMPLATE = `
const before = ($json.html || '').length;
let html = String($('__PREV_NODE__').first().json.html || '');
const applied = [];

// The Postgres node returns one row, one json column. An empty or failed query
// must still render the page: the panels are additive, they are not allowed to
// take the dashboard down.
let metrics = {};
try {
  const row = $input.first().json;
  metrics = (row && (row.result || row)) || {};
  if (typeof metrics === 'string') metrics = JSON.parse(metrics);
} catch (e) { metrics = { _error: String(e && e.message || e) }; }

function inject(needle, replacement, label) {
  if (html.indexOf(needle) === -1) { applied.push(label + ':MISSING'); return; }
  // Function form: the metrics payload is arbitrary JSON and a literal $& or
  // $1 inside it would otherwise be interpreted as a replacement pattern.
  html = html.replace(needle, function () { return replacement; });
  applied.push(label + ':ok');
}

const PANEL_HTML = ${JSON.stringify(PANEL_HTML)};
const PANEL_JS   = ${JSON.stringify(PANEL_JS)};
const DATA_TAG = '<script>window.__CONV_METRICS__=' +
  JSON.stringify(metrics).replace(/</g, '\\\\u003c') + ';<\\/script>';

inject('</body>', PANEL_HTML + DATA_TAG + '<script>' + PANEL_JS + '<\\/script></body>', 'conv-panels');

return { json: { html, _injectLog: applied.join('|'), grew_by: html.length - before } };
`;

const PG_NODE = {
  id: 'a1c0f4d2-7e5b-4f10-9c33-0d1e2f3a4b50',
  name: 'Fetch Conversion Metrics',
  type: 'n8n-nodes-base.postgres',
  position: [1560, 300],
  parameters: { query: METRICS_SQL, options: {}, operation: 'executeQuery' },
  credentials: { postgres: { id: 'jqlh240FlAgCW2po', name: 'Postgres account' } },
  executeOnce: true,
  // The dashboard must render even if a view is missing after a partial
  // migration; the injector already tolerates an empty metrics object.
  onError: 'continueRegularOutput',
  typeVersion: 2.6
};

const INJECT_NODE = {
  id: 'b2d1e5c3-8f6a-4021-ad44-1e2f3a4b5c61',
  name: 'Inject Conversion Panels UI',
  type: 'n8n-nodes-base.code',
  position: [1760, 300],
  parameters: { jsCode: '' },          // filled in below, once the tail is known
  typeVersion: 2
};

const RESPOND = 'Respond With Page';

module.exports = function (nodes, connections) {
  const out = nodes.filter(n => n.name !== PG_NODE.name && n.name !== INJECT_NODE.name);
  const live = new Set(out.map(n => n.name));

  const conns = JSON.parse(JSON.stringify(connections || {}));

  /*
   * The draft and the published graph diverge on this box — Inject Source
   * Category Breakdown UI exists only in the draft — so the tail of the
   * injector chain has to be discovered from the graph being patched rather
   * than hardcoded. A connection key naming a node that is not in the graph
   * makes n8n throw inside getParentNodes and the whole page 500s, so those
   * are dropped as well.
   */
  for (const src of Object.keys(conns)) {
    if (!live.has(src) && src !== PG_NODE.name && src !== INJECT_NODE.name) delete conns[src];
  }

  // Skip this patch's own nodes: on a re-run they already feed Respond With
  // Page, and picking one of them as the tail wires the chain into itself and
  // silently orphans the panels.
  let prev = null;
  for (const src of Object.keys(conns)) {
    if (src === PG_NODE.name || src === INJECT_NODE.name) continue;
    const groups = (conns[src] && conns[src].main) || [];
    for (const g of groups) {
      for (const link of (g || [])) {
        if (link && link.node === RESPOND) prev = src;
      }
    }
  }
  if (!prev) throw new Error('no node feeds ' + RESPOND + '; refusing to guess the chain tail');

  INJECT_NODE.parameters.jsCode = INJECTOR_JS_TEMPLATE.replace('__PREV_NODE__', prev);
  out.push(PG_NODE, INJECT_NODE);

  conns[prev] = { main: [[{ node: PG_NODE.name, type: 'main', index: 0 }]] };
  conns[PG_NODE.name] = { main: [[{ node: INJECT_NODE.name, type: 'main', index: 0 }]] };
  conns[INJECT_NODE.name] = { main: [[{ node: RESPOND, type: 'main', index: 0 }]] };

  return { nodes: out, connections: conns };
};
