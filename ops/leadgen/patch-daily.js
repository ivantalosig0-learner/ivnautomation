/* Daily Automated Outreach Engine — suppression, one-per-domain, new copy. */
const { COMPOSER_SRC } = require('./composer.js');

/* Selection now enforces three things the old query did not:
 *   1. never mail anyone on the suppression list (contacted / bounced / competitor)
 *   2. never mail two businesses at the same email domain inside the cooldown
 *      window — raywhite.com had 20 candidates and got 20 separate cold emails
 *   3. never mail a competitor, even one that slipped in before enrichment
 * The DISTINCT ON collapses a domain to its single best-scoring lead.
 */
const SELECT_SQL = [
  'WITH eligible AS (',
  '  SELECT c.id, c.business_name, c.address, c.suburb, c.email, c.phone, c.website,',
  '         c.qualification_score, c.duplicate_of, c.do_not_contact, c.excluded_from_outreach,',
  '         s.code AS segment_code, c.enrichment->\'profile\' AS profile,',
  '         split_part(lower(c.email), \'@\', 2) AS email_domain',
  '  FROM leads.candidates c',
  '  LEFT JOIN leads.segments s ON s.id = c.segment_id',
  '  LEFT JOIN leads.outreach_drafts d ON d.candidate_id = c.id',
  '  LEFT JOIN leads.crm_records cr ON cr.candidate_id = c.id',
  '  WHERE c.duplicate_of IS NULL',
  '    AND c.stage = \'qualified\'',
  '    AND c.do_not_contact = false',
  '    AND c.excluded_from_outreach = false',
  '    AND c.email IS NOT NULL AND c.email <> \'\'',
  '    AND NOT leads.is_junk_email(c.email)',
  '    AND NOT leads.is_cleaning_competitor(c.business_name, c.website, c.email)',
  '    AND c.qualification_score >= $1',
  '    AND (d.candidate_id IS NULL OR d.status <> \'sent\')',
  '    AND (cr.candidate_id IS NULL OR (cr.status = \'active\' AND cr.stage = \'new\'))',
  // suppression: email or web domain already burned
  '    AND NOT EXISTS (SELECT 1 FROM leads.suppression sp',
  '                    WHERE (sp.email_norm IS NOT NULL',
  '                           AND sp.email_norm = leads.norm_email(c.email))',
  '                       OR (sp.domain_norm IS NOT NULL',
  '                           AND sp.domain_norm = leads.norm_domain(c.website)))',
  // domain cooldown: nobody else at this email domain contacted recently
  '    AND NOT EXISTS (SELECT 1 FROM leads.outreach_drafts d2',
  '                    WHERE d2.sent_at > now() - interval \'90 days\'',
  '                      AND split_part(lower(d2.sent_to), \'@\', 2)',
  '                          = split_part(lower(c.email), \'@\', 2))',
  ')',
  // DISTINCT ON requires its ORDER BY to lead with the partition key, which
  // hands back domains alphabetically — the daily send would work A-to-Z and
  // never reach the high-scoring leads. Collapse per domain first, then
  // re-sort the survivors by score.
  'SELECT * FROM (',
  '  SELECT DISTINCT ON (email_domain) *',
  '  FROM eligible',
  '  ORDER BY email_domain, qualification_score DESC NULLS LAST, id ASC',
  ') best_per_domain',
  'ORDER BY qualification_score DESC NULLS LAST, id ASC',
  'LIMIT 45',
].join('\n');

const PREPARE_JS = COMPOSER_SRC + String.raw`
const r = $json;
const composed = kqCompose({
  id: r.id,
  business_name: r.business_name,
  address: r.address,
  suburb: r.suburb,
  segment_code: r.segment_code,
  qualification_score: r.qualification_score,
  profile: r.profile
});

// The AI request is still built, but it is now an OPTIONAL enhancement.
// The gateway sheds most calls under CPU inference; when it does, the
// deterministic email above ships unchanged rather than a degraded one.
const play = composed.play;
return { json: Object.assign({}, r, {
  fallback_subject: composed.subject,
  fallback_body: composed.body,
  compose_variant: composed.variant,
  ai_request: {
    business: {
      name: kqClean(r.business_name),
      industry: r.segment_code || null,
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
}) };
`;

/* AI output only wins if it is genuinely better: right length, no placeholder
 * brackets, no "As an AI", and it must not have dropped the sender identity.
 * Otherwise the deterministic email ships. */
const COMPOSE_JS = String.raw`
const prep = $('Prepare Daily Outreach').item.json;
const res  = $json;

function aiUsable(res) {
  if (!res || res.success !== true || !res.data) return false;
  const body = String(res.data.email_body || '').trim();
  const subj = String(res.data.subject || '').trim();
  if (body.length < 220 || body.length > 1600) return false;
  if (!subj || subj.length > 90) return false;
  if (/\[[A-Za-z ]+\]/.test(body)) return false;          // [Name] placeholders
  if (/as an ai|language model|i cannot/i.test(body)) return false;
  if (!/KQuality/i.test(body)) return false;              // lost our identity
  const words = body.split(/\s+/).length;
  return words >= 60 && words <= 220;
}

const ok = aiUsable(res);
const out = Object.assign({}, prep);
delete out.ai_request; delete out.fallback_subject; delete out.fallback_body;

out.subject = ok ? String(res.data.subject).slice(0, 150) : prep.fallback_subject;
out.body    = ok ? String(res.data.email_body).trim()     : prep.fallback_body;
out.method  = ok ? ('ai_generate_outreach_' + res.prompt_version)
                 : ('composer_v3_variant' + prep.compose_variant);
out.compose_valid = !!(out.subject && out.subject.trim() && out.body && out.body.trim() && prep.email);
return { json: out };
`;

module.exports = function (nodes, connections) {
  for (const n of nodes) {
    if (n.name === 'Select Todays Best Leads') n.parameters.query  = SELECT_SQL;
    if (n.name === 'Prepare Daily Outreach')   n.parameters.jsCode = PREPARE_JS;
    if (n.name === 'Compose Daily Outreach')   n.parameters.jsCode = COMPOSE_JS;
    // The gateway takes 150-300s to shed a request; 25s keeps the daily run
    // moving and lets the deterministic email ship instead of stalling.
    if (n.name === 'AI Generate Daily Outreach') {
      n.parameters.options = Object.assign({}, n.parameters.options, { timeout: 25000 });
      n.onError = 'continueRegularOutput';
    }
  }
  return { nodes, connections };
};
