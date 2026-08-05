/* Lead Qualification Engine — qual_v2.
 *
 * qual_v1 scored only contactability: email 40 + phone 15 + website 10 +
 * linkedin 10 = 75 before any judgement about whether the business can
 * actually buy recurring commercial cleaning. Everything reachable looked
 * "hot", so the shortlist was sorted by how findable a business was rather
 * than how likely it was to pay. v2 splits the score into reach, fit and
 * intent, and hard-blocks anything on the suppression list.
 */

const FETCH_SQL = [
  'SELECT c.id, c.email, c.phone, c.website, c.linkedin_url, c.stage, c.enrichment,',
  '       c.business_name, c.address, c.suburb,',
  '       COALESCE(s.priority_weight, 5) AS priority_weight,',
  '       s.code AS segment_code,',
  '       EXISTS (SELECT 1 FROM leads.suppression sp',
  '               WHERE (sp.email_norm IS NOT NULL AND sp.email_norm = leads.norm_email(c.email))',
  '                  OR (sp.domain_norm IS NOT NULL AND sp.domain_norm = leads.norm_domain(c.website)))',
  '         AS suppressed',
  'FROM leads.candidates c',
  'LEFT JOIN leads.segments s ON s.id = c.segment_id',
  'WHERE c.duplicate_of IS NULL',
  '  AND c.do_not_contact = false',
  '  AND c.stage IN (\'enriched\',\'qualified\')',
  'ORDER BY c.id',
].join('\n');

const SCORE_JS = String.raw`
const SCORING_VERSION = 'qual_v2';
// The threshold is an ELIGIBILITY floor, not a priority signal. Only 15 leads
// a day are sent and they come off the top of shortlist_rank, which sorts by
// score then segment weight — so a strict threshold buys nothing but starves
// the pool. At 60 only 121 leads survived (eight days of sending); at 50 the
// pool is ~380 while the same high-value leads still go out first.
const QUALIFY_MIN_SCORE = 50;

// --- reach: can we actually land in a human inbox? (max 45) ---
const ROLE_EMAIL_RE   = /^(info|contact|admin|hello|enquiries|enquiry|office|sales|reception|bookings|mail|team)@/i;
const GENERIC_MBOX_RE = /@(gmail|hotmail|outlook|yahoo|bigpond|live|icloud|optusnet)\./i;

// --- fit: signals that the business has premises and a budget ---
const MULTISITE_RE = /\b(branches?|locations?|offices across|sites across|our (centres|clinics|branches|offices|stores)|portfolio|nationwide|statewide|multiple sites)\b/i;
const BIG_PREMISES_RE = /\b(warehouse|facility|campus|complex|premises|head office|showroom|clinic|centre|building)\b/i;

const rows = $input.all().map(i => i.json);

const scored = rows.map(r => {
  const enrichment = r.enrichment || {};
  const profile = enrichment.profile || {};
  const socials = enrichment.socials || {};
  const ai = enrichment.ai || {};
  const analysis = (ai && typeof ai.analysis === 'object') ? (ai.analysis || {}) : {};
  const opps = (ai && typeof ai.opportunities === 'object') ? (ai.opportunities || {}) : {};
  const text = String(profile.description || '') + ' ' + String(profile.title || '') + ' ' + String(profile.page_text || '').slice(0, 3000);

  const hasEmail = !!r.email;
  const isRole   = hasEmail && ROLE_EMAIL_RE.test(r.email);
  const isFreeMb = hasEmail && GENERIC_MBOX_RE.test(r.email);

  const factors = {
    // reach
    email:        hasEmail ? (isRole ? 22 : 28) : 0,
    phone:        r.phone ? 7 : 0,
    website:      r.website ? 5 : 0,
    linkedin:     (r.linkedin_url || socials.linkedin) ? 5 : 0,

    // fit — segment weight is doubled so it dominates raw contactability
    segment_fit:  Number(r.priority_weight || 0) * 2,
    multi_site:   MULTISITE_RE.test(text) ? 8 : 0,
    premises:     BIG_PREMISES_RE.test(text) ? 5 : 0,
    size_signal:  ({ large: 8, medium: 6, small: 3 })[String(analysis.company_size_signal || '')] || 0,

    // intent — only present on the ~11% of records where AI analysis succeeded
    ai_fit:       ({ strong: 10, moderate: 5, weak: 0 })[String(opps.overall_fit || '')] || 0,
    professional: Number(analysis.professionalism_score || 0) >= 7 ? 4 : 0,

    // penalties
    free_mailbox: isFreeMb ? -10 : 0,          // sole trader, no premises budget
    enrich_error: enrichment.error ? -5 : 0,
    thin_site:    (String(profile.page_text || '').length < 400) ? -5 : 0,
    suppressed:   r.suppressed ? -200 : 0      // already contacted / bounced / competitor
  };

  const score = Math.max(0, Object.values(factors).reduce((a, b) => a + b, 0));

  let new_stage;
  if (r.suppressed)                                new_stage = 'disqualified';
  else if (!hasEmail && !r.phone)                  new_stage = 'disqualified';
  else if (hasEmail && score >= QUALIFY_MIN_SCORE) new_stage = 'qualified';
  else                                             new_stage = 'enriched';

  const band = score >= 85 ? 'hot' : (score >= 65 ? 'warm' : 'cold');

  return {
    id: r.id, score, new_stage,
    qual: { version: SCORING_VERSION, threshold: QUALIFY_MIN_SCORE, band, factors, decision: new_stage }
  };
});

return [{ json: { payload: JSON.stringify(scored), scored_count: scored.length } }];
`;

// Persist must MERGE the qualification jsonb. The v1 query replaced it
// wholesale, which would erase the excluded_reason markers that record why a
// competitor or junk-email lead was blocked — and a later run would then
// happily re-qualify them.
const PERSIST_SQL = [
  'UPDATE leads.candidates c SET',
  '  qualification_score = s.score,',
  '  qualification = c.qualification || s.qual,',
  '  qualified_at = CASE WHEN s.new_stage = \'qualified\'',
  '                      THEN COALESCE(c.qualified_at, now()) ELSE NULL END,',
  '  stage = s.new_stage,',
  '  stage_updated_at = CASE WHEN c.stage IS DISTINCT FROM s.new_stage',
  '                          THEN now() ELSE c.stage_updated_at END',
  'FROM jsonb_to_recordset($1::jsonb)',
  '  AS s(id bigint, score integer, new_stage text, qual jsonb)',
  'WHERE c.id = s.id',
  '  AND c.do_not_contact = false',
].join('\n');

// Shortlist ranks by score, but breaks ties toward higher-weight segments so
// a strata lead outranks an equally-scored cafe.
const RANK_SQL = [
  'WITH cleared AS (',
  '  UPDATE leads.candidates SET shortlist_rank = NULL',
  '  WHERE (stage <> \'qualified\' OR duplicate_of IS NOT NULL OR do_not_contact)',
  '    AND shortlist_rank IS NOT NULL RETURNING id),',
  'ranked AS (',
  '  SELECT c.id, row_number() OVER (',
  '    ORDER BY c.qualification_score DESC, COALESCE(s.priority_weight,5) DESC, c.id ASC) AS rn',
  '  FROM leads.candidates c LEFT JOIN leads.segments s ON s.id = c.segment_id',
  '  WHERE c.stage = \'qualified\' AND c.duplicate_of IS NULL AND c.do_not_contact = false)',
  'UPDATE leads.candidates c SET shortlist_rank = r.rn FROM ranked r',
  'WHERE c.id = r.id AND c.shortlist_rank IS DISTINCT FROM r.rn',
].join('\n');

module.exports = function (nodes, connections) {
  for (const n of nodes) {
    if (n.name === 'Fetch Scorable Candidates') n.parameters.query = FETCH_SQL;
    if (n.name === 'Score Candidates')          n.parameters.jsCode = SCORE_JS;
    if (n.name === 'Persist Scores')            n.parameters.query = PERSIST_SQL;
    if (n.name === 'Recompute Shortlist Rank')  n.parameters.query = RANK_SQL;
  }
  return { nodes, connections };
};
