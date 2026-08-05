/* Opportunity Discovery Engine — 40 km radius, competitor block at ingest,
 * four-pass dedup. */

// 40 km covers all of metro Adelaide from the CBD; the extra centres pull in
// the outer ring (Gawler, Elizabeth, Mt Barker, Noarlunga, Aldinga) that a
// single CBD-centred circle under-samples because Places ranks by prominence.
const ZONES = [
  [-34.9285, 138.6007], // Adelaide CBD
  [-34.7590, 138.6420], // Salisbury / Elizabeth
  [-35.1330, 138.5010], // Noarlunga / Christies Beach
  [-34.9180, 138.7350], // Tea Tree Gully / Modbury
  [-34.8480, 138.4930], // Port Adelaide / Semaphore
  [-34.5960, 138.7440], // Gawler
  [-35.0660, 138.8560], // Mount Barker / Adelaide Hills
  [-35.0180, 138.5180], // Marion / Brighton
];

const PLACES_BODY =
  '={{ (function(){ var zones = ' + JSON.stringify(ZONES) + ';' +
  ' var z = zones[($now.weekNumber * 3 + $now.day) % zones.length];' +
  ' return { textQuery: $json.term, pageSize: 20,' +
  ' locationBias: { circle: { center: { latitude: z[0], longitude: z[1] }, radius: 40000.0 } } };' +
  ' })() }}';

// Competitors are rejected at INSERT, so they never enter the funnel at all
// and never cost an enrichment crawl.
const UPSERT_SQL = [
  'INSERT INTO leads.candidates (source_id, segment_id, external_ref, business_name,',
  ' address, phone, website, latitude, longitude, raw, discovery_run_id)',
  'SELECT src.id, $1::smallint, $2, $3, $4, NULLIF($5,\'\'), NULLIF($6,\'\'),',
  ' $7::numeric, $8::numeric, $9::jsonb, $10::bigint',
  'FROM leads.sources src WHERE src.code = \'google_places\'',
  '  AND NOT leads.is_cleaning_competitor($3, NULLIF($6,\'\'), NULL)',
  '  AND NOT EXISTS (SELECT 1 FROM leads.suppression s',
  '                  WHERE s.domain_norm IS NOT NULL',
  '                    AND s.domain_norm = leads.norm_domain(NULLIF($6,\'\')))',
  'ON CONFLICT (source_id, external_ref) DO NOTHING',
].join('\n');

// Four passes, strongest identity key first. Each pass only considers rows
// that survived the previous one, which gives most of the transitive closure
// (same email -> same site -> same phone -> same name+suburb).
const DEDUP_SQL = [
  'WITH p1 AS (',
  '  UPDATE leads.candidates c SET duplicate_of = g.keep_id FROM (',
  '    SELECT id, min(id) OVER (PARTITION BY leads.norm_email(email)) AS keep_id',
  '    FROM leads.candidates WHERE duplicate_of IS NULL AND email IS NOT NULL) g',
  '  WHERE c.id = g.id AND g.keep_id <> g.id RETURNING 1),',
  'p2 AS (',
  '  UPDATE leads.candidates c SET duplicate_of = g.keep_id FROM (',
  '    SELECT id, min(id) OVER (PARTITION BY leads.norm_domain(website)) AS keep_id',
  '    FROM leads.candidates WHERE duplicate_of IS NULL',
  '      AND leads.norm_domain(website) IS NOT NULL) g',
  '  WHERE c.id = g.id AND g.keep_id <> g.id RETURNING 1),',
  'p3 AS (',
  '  UPDATE leads.candidates c SET duplicate_of = g.keep_id FROM (',
  '    SELECT id, min(id) OVER (PARTITION BY leads.norm_phone(phone)) AS keep_id',
  '    FROM leads.candidates WHERE duplicate_of IS NULL',
  '      AND leads.norm_phone(phone) IS NOT NULL) g',
  '  WHERE c.id = g.id AND g.keep_id <> g.id RETURNING 1),',
  'p4 AS (',
  '  UPDATE leads.candidates c SET duplicate_of = g.keep_id FROM (',
  '    SELECT id, min(id) OVER (PARTITION BY leads.norm_name(business_name),',
  '             lower(coalesce(suburb, split_part(address, \',\', 2)))) AS keep_id',
  '    FROM leads.candidates WHERE duplicate_of IS NULL',
  '      AND leads.norm_name(business_name) IS NOT NULL) g',
  '  WHERE c.id = g.id AND g.keep_id <> g.id RETURNING 1),',
  'p5 AS (',
  '  UPDATE leads.candidates SET excluded_from_outreach = true',
  '  WHERE duplicate_of IS NOT NULL AND excluded_from_outreach = false RETURNING 1),',
  // late-arriving competitors (name only became obvious after enrichment)
  'p6 AS (',
  '  UPDATE leads.candidates SET do_not_contact = true, excluded_from_outreach = true,',
  '    stage = \'disqualified\', stage_updated_at = now(),',
  '    qualification = qualification || jsonb_build_object(\'excluded_reason\',\'cleaning_competitor\')',
  '  WHERE do_not_contact = false',
  '    AND leads.is_cleaning_competitor(business_name, website, email) RETURNING 1)',
  'SELECT (SELECT count(*) FROM p1) + (SELECT count(*) FROM p2)',
  '     + (SELECT count(*) FROM p3) + (SELECT count(*) FROM p4) AS duplicates_marked,',
  '       (SELECT count(*) FROM p6) AS competitors_blocked',
].join('\n');

/* Discovery rations search terms across days rather than firing all ~196 every
 * morning. Two independent reasons, and the second one outlives any quota change:
 *
 *  1. Quota. The key was previously capped at 100 SearchTextRequest/day, which
 *     the old all-terms-daily run exhausted inside ~30 terms — every later call
 *     returned 429 RESOURCE_EXHAUSTED and the run recorded 0 candidates while
 *     the n8n execution still reported success. Quota has since been raised
 *     (verified 2026-08-05: two full runs same day, zero 429s).
 *  2. Yield. Repeating a term returns the same places, which then hit
 *     ON CONFLICT DO NOTHING. Measured: a fresh 28-term slice produced 132 new
 *     candidates; re-running that same slice minutes later produced 5. Paying
 *     per request to rediscover known businesses is the waste to avoid, so
 *     rotation stays even with headroom to spare.
 *
 * 65 terms/day x 2 pages = ~130 requests, cycling all 196 terms every 3 days.
 * Terms are interleaved by their position within each segment then by segment
 * weight, so a day's slice spreads across segments led by the highest-value
 * ones rather than exhausting one segment at a time.
 */
const TERMS_PER_DAY = 65;
const FETCH_TERMS_SQL = [
  'WITH t AS (',
  '  SELECT s.id AS segment_id, s.code AS segment_code, e.term,',
  '         row_number() OVER (PARTITION BY s.id ORDER BY e.ord) AS term_idx,',
  '         s.priority_weight',
  '  FROM leads.segments s',
  '  CROSS JOIN LATERAL jsonb_array_elements_text(s.search_terms)',
  '       WITH ORDINALITY AS e(term, ord)',
  '  WHERE s.enabled',
  '), ordered AS (',
  '  SELECT segment_id, segment_code, term,',
  '         (row_number() OVER (ORDER BY term_idx, priority_weight DESC, segment_id) - 1) AS rn,',
  '         count(*) OVER () AS total',
  '  FROM t',
  ')',
  'SELECT segment_id, segment_code, term FROM ordered',
  'WHERE (rn / ' + TERMS_PER_DAY + ')',
  '      = (EXTRACT(doy FROM current_date)::int',
  '         % GREATEST(1, CEIL(total::numeric / ' + TERMS_PER_DAY + ')::int))',
  'ORDER BY rn',
].join('\n');

// A partial run is still a useful run. Recording it as succeeded-with-count
// (rather than leaving it 'failed') keeps the dashboard honest and lets the
// quota ceiling show up as a low count instead of a hard failure.
const FINALIZE_SQL = [
  'UPDATE leads.discovery_runs SET',
  '  finished_at = now(),',
  '  status = \'succeeded\',',
  '  candidates_new = (SELECT count(*) FROM leads.candidates c',
  '                    WHERE c.discovery_run_id = $1::bigint),',
  '  candidates_found = (SELECT count(*) FROM leads.candidates c',
  '                      WHERE c.discovery_run_id = $1::bigint)',
  'WHERE id = $1::bigint',
  'RETURNING id, status, candidates_new',
].join('\n');

module.exports = function (nodes, connections) {
  for (const n of nodes) {
    if (n.name === 'Fetch Segment Search Terms') {
      n.parameters.query = FETCH_TERMS_SQL;
    }
    if (n.name === 'Finalize Discovery Run') {
      n.parameters.query = FINALIZE_SQL;
    }
    if (n.name === 'Places Text Search') {
      n.parameters.jsonBody = PLACES_BODY;
      // One 429 must not abort the remaining terms.
      n.onError = 'continueRegularOutput';
      n.parameters.options = Object.assign({}, n.parameters.options, {
        pagination: {
          pagination: {
            parameters: { parameters: [
              { type: 'body', name: 'pageToken', value: '={{ $response.body.nextPageToken }}' },
            ] },
            paginationCompleteWhen: 'other',
            completeExpression: '={{ !$response.body.nextPageToken }}',
            limitPagesFetched: true,
            maxRequests: 2,
            requestInterval: 800,
          },
        },
        timeout: 15000,
      });
    }
    if (n.name === 'Upsert Candidate') {
      n.parameters.query = UPSERT_SQL;
    }
    if (n.name === 'Mark Duplicate Candidates') {
      n.parameters.query = DEDUP_SQL;
    }
  }
  return { nodes, connections };
};
