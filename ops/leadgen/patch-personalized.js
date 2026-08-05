/* Personalized Outreach Engine — draft renewal.
 *
 * Two changes that matter: the pool drops from 15 to 4 per run (the gateway
 * only has 2 inference slots, so 15 simultaneous calls guaranteed that 13 were
 * shed), and a failed AI call now still writes the deterministic draft instead
 * of silently dropping the candidate — which is why 1294 drafts existed but
 * almost none were AI-written.
 */
const { COMPOSER_SRC } = require('./composer.js');

const FETCH_SQL = [
  'SELECT c.id, c.business_name, c.address, c.suburb, c.email, c.phone, c.stage,',
  '       c.qualification_score, s.code AS segment_code, s.name AS segment_name,',
  '       c.enrichment->\'profile\' AS profile',
  'FROM leads.candidates c',
  'LEFT JOIN leads.segments s ON s.id = c.segment_id',
  'LEFT JOIN leads.outreach_drafts d ON d.candidate_id = c.id',
  'WHERE c.duplicate_of IS NULL',
  '  AND c.do_not_contact = false',
  '  AND c.excluded_from_outreach = false',
  '  AND c.stage NOT IN (\'lost\',\'won\',\'disqualified\')',
  '  AND NOT leads.is_cleaning_competitor(c.business_name, c.website, c.email)',
  '  AND NOT EXISTS (SELECT 1 FROM leads.suppression sp',
  '                  WHERE (sp.email_norm IS NOT NULL',
  '                         AND sp.email_norm = leads.norm_email(c.email))',
  '                     OR (sp.domain_norm IS NOT NULL',
  '                         AND sp.domain_norm = leads.norm_domain(c.website)))',
  '  AND (d.candidate_id IS NULL',
  '       OR (d.status = \'draft\' AND d.method NOT LIKE \'ai\\_%\'',
  '           AND d.method NOT LIKE \'composer\\_v3%\'))',
  'ORDER BY (c.qualification_score >= 85) DESC,',
  '         c.qualification_score DESC NULLS LAST, c.id',
  'LIMIT 4',
].join('\n');

const PREPARE_JS = COMPOSER_SRC + String.raw`
return $input.all().map(i => i.json).map(r => {
  const composed = kqCompose({
    id: r.id,
    business_name: r.business_name,
    address: r.address,
    suburb: r.suburb,
    segment_code: r.segment_code,
    qualification_score: r.qualification_score,
    profile: r.profile
  });
  const play = composed.play;
  return { json: {
    candidate_id: r.id,
    fallback_subject: composed.subject,
    fallback_body: composed.body,
    compose_variant: composed.variant,
    request: {
      business: {
        name: kqClean(r.business_name),
        industry: r.segment_name || null,
        location: kqSuburb(r) || kqClean(r.address) || null,
        description: kqClean((r.profile || {}).description) || null
      },
      sender: { name: KQ.sender, company: KQ.company, phone: KQ.phone },
      contact_name: kqFirstName(r.profile || {}),
      notes: 'Service to pitch: ' + play.job + '. Pain to name: ' + play.pain
           + '. Proof point: ' + play.line
           + ' Ask them to let us price: ' + play.ask + '.'
           + ' Adelaide-based, public liability cover, police-checked staff.'
    }
  } };
});
`;

const ASSEMBLE_JS = String.raw`
const BATCH_SIZE = 200;
const prev = $('Prepare AI Request').all();
const items = $input.all();
const drafts = [];

function aiUsable(res) {
  if (!res || res.success !== true || !res.data) return false;
  const body = String(res.data.email_body || '').trim();
  const subj = String(res.data.subject || '').trim();
  if (body.length < 220 || body.length > 1600) return false;
  if (!subj || subj.length > 90) return false;
  if (/\[[A-Za-z ]+\]/.test(body)) return false;
  if (/as an ai|language model|i cannot/i.test(body)) return false;
  if (!/KQuality/i.test(body)) return false;
  const words = body.split(/\s+/).length;
  return words >= 60 && words <= 220;
}

// One output per INPUT candidate, not per successful AI call. When the
// gateway sheds the request we still persist the deterministic draft.
for (let i = 0; i < prev.length; i++) {
  const src = prev[i] && prev[i].json;
  if (!src || !src.candidate_id) continue;
  const res = items[i] && items[i].json;
  const ok = aiUsable(res);
  drafts.push({
    candidate_id: src.candidate_id,
    subject: (ok ? String(res.data.subject) : src.fallback_subject).slice(0, 150),
    body: ok ? String(res.data.email_body).trim() : src.fallback_body,
    method: ok ? ('ai_' + res.capability + '_' + res.prompt_version)
               : ('composer_v3_variant' + src.compose_variant)
  });
}

const out = [];
for (let i = 0; i < drafts.length; i += BATCH_SIZE) {
  const chunk = drafts.slice(i, i + BATCH_SIZE);
  out.push({ json: { payload: JSON.stringify(chunk), batch_index: out.length, batch_count: chunk.length } });
}
if (!out.length) out.push({ json: { payload: '[]', batch_index: 0, batch_count: 0 } });
return out;
`;

module.exports = function (nodes, connections) {
  for (const n of nodes) {
    if (n.name === 'Fetch Lead Pool')      n.parameters.query  = FETCH_SQL;
    if (n.name === 'Prepare AI Request')   n.parameters.jsCode = PREPARE_JS;
    if (n.name === 'Assemble Draft Batch') n.parameters.jsCode = ASSEMBLE_JS;
    if (n.name === 'AI Generate Outreach') {
      n.parameters.options = Object.assign({}, n.parameters.options, { timeout: 40000 });
      n.onError = 'continueRegularOutput';
    }
  }
  return { nodes, connections };
};
