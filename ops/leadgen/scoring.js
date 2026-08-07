/*
 * scoring.js — segment classification (§3.2) and the 0-100 lead score (§4.5).
 * Injected into the n8n Code nodes like composer.js and contacts.js.
 *
 * Deterministic first, always. The LLM is a fallback for the residue only, and
 * it can never block: on any failure the lead is UNCLASSIFIED and the pipeline
 * continues. That matters here specifically — the AI gateway on this box sheds
 * roughly 89% of calls (Qwen3-8B, CPU, 2 slots), so anything that waits on it
 * is effectively broken.
 */
module.exports.SCORING_SRC = String.raw`
// ---------- KQuality segment classifier + lead score v1 ----------

/*
 * Google Places types -> buyer segment. Places types are authored by Google
 * from the business's own category, so they beat keyword guessing.
 */
var KQ_PLACES_MAP = [
  ['hospital',              'HEALTH',        0.92],
  ['doctor',                'HEALTH',        0.92],
  ['dentist',               'HEALTH',        0.94],
  ['physiotherapist',       'HEALTH',        0.90],
  ['medical_lab',           'HEALTH',        0.90],
  ['veterinary_care',       'HEALTH',        0.85],
  ['pharmacy',              'RETAIL_OFFICE', 0.80],
  ['school',                'EDU',           0.94],
  ['primary_school',        'EDU',           0.95],
  ['secondary_school',      'EDU',           0.95],
  ['university',            'EDU',           0.92],
  ['child_care',            'EDU',           0.93],
  ['preschool',             'EDU',           0.93],
  ['local_government_office','GOV_LOCAL',    0.93],
  ['city_hall',             'GOV_LOCAL',     0.94],
  ['library',               'GOV_LOCAL',     0.90],
  ['courthouse',            'GOV_STATE',     0.88],
  ['lodging',               'HOSPITALITY',   0.90],
  ['hotel',                 'HOSPITALITY',   0.92],
  ['motel',                 'HOSPITALITY',   0.90],
  ['restaurant',            'HOSPITALITY',   0.85],
  ['bar',                   'HOSPITALITY',   0.85],
  ['night_club',            'HOSPITALITY',   0.85],
  ['gym',                   'HOSPITALITY',   0.82],
  ['real_estate_agency',    'STRATA',        0.70],
  ['storage',               'INDUSTRIAL',    0.85],
  ['moving_company',        'INDUSTRIAL',    0.75],
  ['car_repair',            'RETAIL_OFFICE', 0.80],
  ['car_dealer',            'RETAIL_OFFICE', 0.82],
  ['furniture_store',       'RETAIL_OFFICE', 0.80],
  ['clothing_store',        'RETAIL_OFFICE', 0.80],
  ['store',                 'RETAIL_OFFICE', 0.65],
  ['accounting',            'RETAIL_OFFICE', 0.85],
  ['lawyer',                'RETAIL_OFFICE', 0.85],
  ['insurance_agency',      'RETAIL_OFFICE', 0.82]
];

/*
 * Name/domain/description keywords. Ordered most specific first — "retirement
 * village" must beat "village", "day surgery" must beat "surgery".
 */
var KQ_KEYWORD_RULES = [
  [/\b(strata|body corporate|community corporation|owners corporation)\b/i, 'STRATA',       0.92],
  [/\bstrata manag/i,                                                        'STRATA',       0.95],
  [/\b(facilities management|facility management|building management)\b/i,   'COMMERCIAL_RE',0.90],
  [/\b(commercial (property|real estate)|property management|rent roll)\b/i, 'COMMERCIAL_RE',0.85],
  [/\b(ndis|supported independent living|\bsil\b|disability (support|services)|plan management)\b/i, 'NDIS', 0.93],
  [/\b(aged care|retirement (village|living)|nursing home|residential care)\b/i, 'AGED_CARE', 0.93],
  [/\b(day surgery|medical centre|medical center|dental|dentist|physiotherap|chiropract|podiatr|optometr|radiolog|pathology|general practice|\bgp clinic\b|allied health)\b/i, 'HEALTH', 0.90],
  [/\b(childcare|child care|early learning|kindergarten|preschool|pre-school|oshc|outside school hours|long day care)\b/i, 'EDU', 0.92],
  [/\b(primary school|secondary school|high school|college|campus|\btafe\b|registered training)\b/i, 'EDU', 0.88],
  [/\b(city of |district council|regional council|shire of |council of)\b/i,  'GOV_LOCAL',    0.92],
  [/\b(community centre|community center|neighbourhood house|public library)\b/i, 'GOV_LOCAL', 0.85],
  [/\b(sa health|sa water|department for|government of south australia|sa government)\b/i, 'GOV_STATE', 0.90],
  [/\b(hotel|motel|tavern|hotel group|function centre|conference centre|bowling club|golf club|sports club|licensed club|gymnasium|fitness)\b/i, 'HOSPITALITY', 0.85],
  [/\b(warehouse|logistics|distribution centre|manufactur|fabricat|cold storage|freight|industrial)\b/i, 'INDUSTRIAL', 0.87],
  [/\b(group|holdings|franchise|national|australia wide|multi-?site)\b/i,     'CHILD_ED_CORP',0.55],
  [/\b(law|legal|solicitor|accountant|accounting|bookkeep|financial planning|insurance broker|architect|engineering consult|showroom|retail)\b/i, 'RETAIL_OFFICE', 0.78]
];

/*
 * kqsClassify(input) -> { code, confidence, source, evidence }
 *
 * input: {
 *   business_name, website, description, headings[],
 *   places_types[], registry, legacy_code, legacy_confidence
 * }
 * registry is a Tier B hit: { ndis:bool, acecqa:bool, acnc:bool, aged_care:bool,
 * sa_gov:bool, council:bool } — a registry hit is authoritative and wins.
 */
function kqsClassify(input) {
  input = input || {};
  var reg = input.registry || {};
  if (reg.ndis)      return { code: 'NDIS',      confidence: 0.98, source: 'registry', evidence: 'ndis_provider_register' };
  if (reg.acecqa)    return { code: 'EDU',       confidence: 0.98, source: 'registry', evidence: 'acecqa_register' };
  if (reg.aged_care) return { code: 'AGED_CARE', confidence: 0.98, source: 'registry', evidence: 'aged_care_service_list' };
  if (reg.sa_gov)    return { code: 'GOV_STATE', confidence: 0.95, source: 'registry', evidence: 'sa_gov_entity' };
  if (reg.council)   return { code: 'GOV_LOCAL', confidence: 0.95, source: 'registry', evidence: 'council_entity' };

  var types = Array.isArray(input.places_types) ? input.places_types : [];
  for (var i = 0; i < KQ_PLACES_MAP.length; i++) {
    if (types.indexOf(KQ_PLACES_MAP[i][0]) !== -1) {
      return {
        code: KQ_PLACES_MAP[i][1], confidence: KQ_PLACES_MAP[i][2],
        source: 'rule', evidence: 'places_type:' + KQ_PLACES_MAP[i][0]
      };
    }
  }

  var hay = [
    input.business_name || '',
    input.website || '',
    input.description || '',
    (Array.isArray(input.headings) ? input.headings.slice(0, 2).join(' ') : '')
  ].join(' ');
  for (var k = 0; k < KQ_KEYWORD_RULES.length; k++) {
    if (KQ_KEYWORD_RULES[k][0].test(hay)) {
      return {
        code: KQ_KEYWORD_RULES[k][1], confidence: KQ_KEYWORD_RULES[k][2],
        source: 'rule', evidence: 'keyword'
      };
    }
  }

  // Whatever the legacy segment says, at the confidence recorded in
  // segment_code_map. Never worse than what the row already had.
  if (input.legacy_code) {
    return {
      code: input.legacy_code,
      confidence: Number(input.legacy_confidence || 0.5),
      source: 'rule', evidence: 'legacy_segment'
    };
  }
  return { code: 'UNCLASSIFIED', confidence: 0, source: 'rule', evidence: 'no_rule_matched' };
}

/*
 * Prompt for the LLM fallback. Deliberately tiny: business name, meta
 * description, two headings. Nothing else is worth the tokens, and a big
 * prompt is what gets a request shed.
 */
function kqsLlmPrompt(input) {
  var codes = ['STRATA','COMMERCIAL_RE','NDIS','AGED_CARE','HEALTH','EDU','GOV_LOCAL',
               'GOV_STATE','HOSPITALITY','INDUSTRIAL','CHILD_ED_CORP','RETAIL_OFFICE','UNCLASSIFIED'];
  return 'Classify this Australian business into exactly one code.\n' +
    'Codes: ' + codes.join(', ') + '\n' +
    'Name: ' + String(input.business_name || '').slice(0, 100) + '\n' +
    'Description: ' + String(input.description || '').slice(0, 200) + '\n' +
    'Headings: ' + (Array.isArray(input.headings) ? input.headings.slice(0, 2).join(' | ').slice(0, 120) : '') + '\n' +
    'Answer with the code only.';
}

function kqsParseLlm(text) {
  var codes = ['STRATA','COMMERCIAL_RE','NDIS','AGED_CARE','HEALTH','EDU','GOV_LOCAL',
               'GOV_STATE','HOSPITALITY','INDUSTRIAL','CHILD_ED_CORP','RETAIL_OFFICE'];
  var t = String(text || '').toUpperCase();
  for (var i = 0; i < codes.length; i++) {
    if (t.indexOf(codes[i]) !== -1) {
      return { code: codes[i], confidence: 0.65, source: 'llm', evidence: 'llm_fallback' };
    }
  }
  return { code: 'UNCLASSIFIED', confidence: 0, source: 'llm', evidence: 'llm_unparseable' };
}

// ---------- lead score ----------

/*
 * Adelaide metro postcodes we actually service, grouped by how close they sit
 * to an existing run. Proximity is worth real money on a cleaning contract:
 * a site 40 minutes off-route costs more to service than it earns.
 */
var KQ_ROUTE_CORE = [        // CBD + inner ring, existing runs
  '5000','5006','5007','5008','5031','5032','5033','5034','5035','5061',
  '5062','5063','5064','5065','5066','5067','5068','5069','5070','5072'
];
var KQ_ROUTE_NEAR = [        // 20-30 min, still economic
  '5009','5010','5011','5012','5013','5014','5015','5016','5017','5018',
  '5019','5020','5021','5022','5023','5024','5025','5037','5038','5039',
  '5040','5041','5042','5043','5044','5045','5046','5047','5048','5049',
  '5071','5073','5074','5075','5076','5081','5082','5083','5084','5085',
  '5086','5087','5088','5089','5090','5091','5092','5093','5094','5095','5096'
];

var KQ_SERVICE_FIT = {       // how well the segment matches what KQuality sells
  STRATA: 15, COMMERCIAL_RE: 15, NDIS: 15, AGED_CARE: 15, HEALTH: 14,
  EDU: 14, GOV_LOCAL: 12, GOV_STATE: 12, HOSPITALITY: 11, INDUSTRIAL: 11,
  CHILD_ED_CORP: 15, RETAIL_OFFICE: 8, UNCLASSIFIED: 0
};

var KQ_MONTHLY_VALUE = {     // indicative contract value, drives estimated_monthly_value
  STRATA: 1800, COMMERCIAL_RE: 2600, NDIS: 1600, AGED_CARE: 4200, HEALTH: 1400,
  EDU: 2800, GOV_LOCAL: 3200, GOV_STATE: 3800, HOSPITALITY: 2200,
  INDUSTRIAL: 2400, CHILD_ED_CORP: 6500, RETAIL_OFFICE: 900, UNCLASSIFIED: 0
};

/*
 * kqsScore(lead) -> { score, breakdown }
 *
 * lead: {
 *   contacts: [{ title_rank, email, email_type, email_verification_status }],
 *   segment_code, segment_confidence, signals: [{signal_type, expires_at}],
 *   postcode, site_count_estimate, employee_band
 * }
 *
 * Weights are exactly §4.5 and sum to 100. Every component is written into
 * score_breakdown so any score can be explained to a human without re-running
 * anything.
 */
function kqsScore(lead) {
  lead = lead || {};
  var b = {};
  var contacts = Array.isArray(lead.contacts) ? lead.contacts : [];

  // 1. Decision maker identified with a verified personal email — 30
  var best = null;
  for (var i = 0; i < contacts.length; i++) {
    var c = contacts[i];
    if (!c || !c.email) continue;
    if (best === null || c.title_rank < best.title_rank) best = c;
  }
  var dm = 0;
  if (best && best.title_rank <= 2) {
    if (best.email_type === 'personal' && best.email_verification_status === 'valid') dm = 30;
    else if (best.email_type === 'personal') dm = 22;
    else if (best.email_verification_status === 'valid') dm = 16;
    else dm = 12;
  } else if (best && best.title_rank <= 4) {
    dm = 6;
  }
  b.decision_maker = { points: dm, max: 30,
    detail: best ? ('rank ' + best.title_rank + ' / ' + (best.email_type || 'no-type') +
                    ' / ' + (best.email_verification_status || 'unverified'))
                 : 'no contact with an email' };

  // 2. Segment matched with confidence >= 0.8 — 15
  var sc = Number(lead.segment_confidence || 0);
  var segPts = lead.segment_code && lead.segment_code !== 'UNCLASSIFIED'
    ? (sc >= 0.8 ? 15 : sc >= 0.6 ? 9 : sc >= 0.4 ? 4 : 0) : 0;
  b.segment = { points: segPts, max: 15,
    detail: (lead.segment_code || 'UNCLASSIFIED') + ' @ ' + sc.toFixed(2) };

  // 3. Active buying trigger — 20. A dated contract expiry inside 120 days is
  //    the only signal that carries a deadline, so it takes the full weight.
  var sig = Array.isArray(lead.signals) ? lead.signals : [];
  var trigPts = 0, trigWhat = 'none';
  var now = Date.now();
  for (var s = 0; s < sig.length; s++) {
    var t = sig[s] || {};
    var exp = t.expires_at ? Date.parse(t.expires_at) : NaN;
    var days = isNaN(exp) ? null : Math.round((exp - now) / 86400000);
    var p = 0;
    // An expiry already in the past is not a buying window, it is a contract
    // someone else won. It must score zero, not fall through to the generic
    // "has a signal" bucket.
    if (t.signal_type === 'contract_expiry') {
      if (days === null) p = 4;
      else if (days < 0) p = 0;
      else if (days <= 120) p = 20;
      else if (days <= 240) p = 10;
      else p = 4;
    }
    else if (t.signal_type === 'tender_published') p = 18;
    else if (t.signal_type === 'new_sil_house' || t.signal_type === 'new_site' ||
             t.signal_type === 'new_building_handover' || t.signal_type === 'new_centre') p = 15;
    else if (t.signal_type === 'audit_cycle' || t.signal_type === 'accreditation_date' ||
             t.signal_type === 'acecqa_assessment' || t.signal_type === 'whs_audit') p = 12;
    else if (t.signal_type === 'manager_change' || t.signal_type === 'ownership_change') p = 10;
    else if (t.signal_type) p = 6;
    if (p > trigPts) { trigPts = p; trigWhat = t.signal_type + (days !== null ? ' (' + days + 'd)' : ''); }
  }
  b.trigger = { points: trigPts, max: 20, detail: trigWhat };

  // 4. Fits the service profile — 15
  var fit = KQ_SERVICE_FIT[lead.segment_code] || 0;
  b.service_fit = { points: fit, max: 15, detail: lead.segment_code || 'UNCLASSIFIED' };

  // 5. Route proximity — 10
  var pc = String(lead.postcode || '').trim();
  var geo = 0, geoWhat = 'unknown postcode';
  if (KQ_ROUTE_CORE.indexOf(pc) !== -1) { geo = 10; geoWhat = pc + ' core route'; }
  else if (KQ_ROUTE_NEAR.indexOf(pc) !== -1) { geo = 7; geoWhat = pc + ' near route'; }
  else if (/^5[0-1]\d{2}$/.test(pc)) { geo = 4; geoWhat = pc + ' metro fringe'; }
  else if (/^5\d{3}$/.test(pc)) { geo = 1; geoWhat = pc + ' regional SA'; }
  b.proximity = { points: geo, max: 10, detail: geoWhat };

  // 6. Multi-site operator — 10
  var sites = Number(lead.site_count_estimate || 0);
  var multi = sites >= 10 ? 10 : sites >= 5 ? 8 : sites >= 3 ? 6 : sites >= 2 ? 4 : 0;
  b.multi_site = { points: multi, max: 10, detail: sites ? sites + ' sites' : 'single site' };

  var total = dm + segPts + trigPts + fit + geo + multi;
  return {
    score: Math.max(0, Math.min(100, total)),
    breakdown: b,
    estimated_monthly_value: kqsEstimateValue(lead),
    // §4.3: rank-5-only is not a qualified lead.
    needs_enrichment: !(best && best.title_rank <= 2 && best.email)
  };
}

function kqsEstimateValue(lead) {
  var base = KQ_MONTHLY_VALUE[lead && lead.segment_code] || 0;
  if (!base) return null;
  var sites = Math.max(1, Number((lead && lead.site_count_estimate) || 1));
  var bandMult = { '1-4': 0.5, '5-19': 0.8, '20-49': 1.0, '50-199': 1.5, '200+': 2.2 };
  var mult = bandMult[lead && lead.employee_band] || 1.0;
  // Multi-site does not scale linearly: a group negotiates a rate.
  return Math.round(base * mult * (1 + Math.log(sites) / Math.log(4)));
}

function kqsEmployeeBand(n) {
  var v = Number(n || 0);
  if (!v) return null;
  if (v < 5) return '1-4';
  if (v < 20) return '5-19';
  if (v < 50) return '20-49';
  if (v < 200) return '50-199';
  return '200+';
}
// ---------- end classifier + score ----------
`;
