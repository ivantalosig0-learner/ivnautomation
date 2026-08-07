/*
 * registries.js — Tier B: Australian public registries (§4.2).
 *
 * Free, authoritative, and compliant to use. Pure request-builders and
 * response-parsers; the n8n HTTP nodes do the fetching. Every adapter is
 * env-gated and degrades to a no-op rather than failing the pipeline, because
 * a missing GUID must never stop enrichment for the other 2864 leads.
 *
 * Nothing here touches LinkedIn or any source whose terms prohibit automated
 * access. A linkedin_url is only ever stored when the company published it on
 * their own website (contacts.js, Tier A).
 */
module.exports.REGISTRIES_SRC = String.raw`
// ---------- KQuality Tier B registry adapters v1 ----------

/*
 * ABN Lookup (ABR web services). Free, requires a registered GUID in
 * ABN_LOOKUP_GUID. Used for two things: confirming the legal entity behind a
 * trading name, and giving dedupe a key that survives rebrands — measured
 * 2026-08-07, no ABN was stored anywhere, so 484 leads sharing an email domain
 * could not be collapsed.
 *
 * The service answers JSONP, so the body has to be unwrapped before JSON.parse.
 */
function kqrAbnSearchUrl(name, guid, postcode) {
  if (!guid || !name) return null;
  var u = 'https://abr.business.gov.au/json/MatchingNames.aspx' +
          '?name=' + encodeURIComponent(String(name).slice(0, 100)) +
          '&guid=' + encodeURIComponent(guid) +
          '&maxResults=10';
  if (postcode) u += '&postcode=' + encodeURIComponent(postcode);
  return u;
}

function kqrAbnDetailsUrl(abn, guid) {
  if (!guid || !abn) return null;
  return 'https://abr.business.gov.au/json/AbnDetails.aspx' +
         '?abn=' + encodeURIComponent(String(abn).replace(/\s/g, '')) +
         '&guid=' + encodeURIComponent(guid);
}

// callback({...}) or callback({...});
function kqrUnwrapJsonp(body) {
  var s = String(body == null ? '' : body).trim();
  var open = s.indexOf('(');
  var close = s.lastIndexOf(')');
  if (open === -1 || close <= open) { try { return JSON.parse(s); } catch (e) { return null; } }
  try { return JSON.parse(s.slice(open + 1, close)); } catch (e) { return null; }
}

/*
 * Pick the best ABR match for a business. Exact normalised name wins; a
 * postcode match breaks ties. Anything below 0.75 similarity is rejected —
 * a wrong ABN is worse than no ABN, because it poisons dedupe.
 */
function kqrPickAbnMatch(payload, businessName, postcode) {
  var data = payload && payload.Names ? payload.Names : [];
  if (!data.length) return null;
  var want = kqrNormName(businessName);
  var best = null, bestScore = 0;
  for (var i = 0; i < data.length; i++) {
    var row = data[i] || {};
    var got = kqrNormName(row.Name);
    if (!got) continue;
    var score = kqrNameSimilarity(want, got);
    if (postcode && String(row.Postcode || '') === String(postcode)) score += 0.10;
    if (String(row.AbnStatus || '').toLowerCase() === 'active') score += 0.05;
    if (score > bestScore) { bestScore = score; best = row; }
  }
  if (!best || bestScore < 0.75) return null;
  return {
    abn: String(best.Abn || '').replace(/\s/g, ''),
    entity_name: best.Name || null,
    entity_type: best.NameType || null,
    state: best.State || null,
    postcode: best.Postcode || null,
    status: best.AbnStatus || null,
    confidence: Math.min(1, Number(bestScore.toFixed(2))),
    source_url: 'https://abr.business.gov.au/ABN/View?abn=' + String(best.Abn || '').replace(/\s/g, '')
  };
}

function kqrNormName(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/\b(pty\.?|ltd\.?|limited|proprietary|inc\.?|incorporated|the|and|&)\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Token-overlap similarity. Cheap, and good enough to separate "Adelaide
// Dental Care" from "Adelaide Dental Care Group" without a fuzzy library.
function kqrNameSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  var A = a.split(' '), B = b.split(' ');
  var setB = {}, i;
  for (i = 0; i < B.length; i++) setB[B[i]] = true;
  var hit = 0;
  for (i = 0; i < A.length; i++) if (setB[A[i]]) hit++;
  return (2 * hit) / (A.length + B.length);
}

/*
 * Registry datasets that publish as CSV. All of them are open data, all of
 * them land in leads.registry_record, and matching is by normalised name +
 * postcode (and by ABN once ABN Lookup has run, which is much stronger).
 *
 * The URLs are the stable data.gov.au / agency endpoints. Where an agency
 * rotates its resource id, the env override is read first so the workflow does
 * not need redeploying.
 */
var KQ_REGISTRY_SOURCES = [
  { code: 'ndis_provider',  segment: 'NDIS',      env: 'NDIS_REGISTER_URL',
    url: 'https://data.gov.au/data/dataset/ndis-registered-provider-list',
    name_field: 'Provider Legal Name', state_field: 'State', postcode_field: 'Postcode' },
  { code: 'acecqa_service', segment: 'EDU',       env: 'ACECQA_REGISTER_URL',
    url: 'https://www.acecqa.gov.au/resources/national-registers',
    name_field: 'ServiceName', state_field: 'State', postcode_field: 'Postcode' },
  { code: 'acnc_charity',   segment: null,        env: 'ACNC_REGISTER_URL',
    url: 'https://data.gov.au/data/dataset/acnc-register',
    name_field: 'Charity_Legal_Name', state_field: 'State', postcode_field: 'Postcode' },
  { code: 'aged_care',      segment: 'AGED_CARE', env: 'AGED_CARE_SERVICE_URL',
    url: 'https://www.gen-agedcaredata.gov.au/resources/access-data',
    name_field: 'Service Name', state_field: 'State', postcode_field: 'Postcode' },
  { code: 'sa_schools',     segment: 'EDU',       env: 'SA_SCHOOLS_URL',
    url: 'https://data.sa.gov.au/data/dataset/schools-and-preschools-location',
    name_field: 'School Name', state_field: 'State', postcode_field: 'Postcode' }
];

function kqrSourceUrl(source, env) {
  env = env || {};
  return (source.env && env[source.env]) ? env[source.env] : source.url;
}

/*
 * Minimal RFC4180 CSV parser. Registry exports quote inconsistently and one
 * unescaped comma in a charity's legal name silently shifts every column, so
 * this handles quoted fields and doubled quotes properly rather than splitting
 * on commas.
 */
function kqrParseCsv(text, maxRows) {
  var s = String(text == null ? '' : text);
  var rows = [], row = [], field = '', inQ = false, i = 0;
  while (i < s.length) {
    var ch = s.charAt(i);
    if (inQ) {
      if (ch === '"') {
        if (s.charAt(i + 1) === '"') { field += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQ = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') {
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      if (maxRows && rows.length >= maxRows) return rows;
      i++; continue;
    }
    field += ch; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function kqrCsvToObjects(text, maxRows) {
  var rows = kqrParseCsv(text, maxRows ? maxRows + 1 : 0);
  if (rows.length < 2) return [];
  var head = rows[0].map(function (h) { return String(h).replace(/^﻿/, '').trim(); });
  var out = [];
  for (var r = 1; r < rows.length; r++) {
    var o = {};
    for (var c = 0; c < head.length; c++) o[head[c]] = rows[r][c] == null ? '' : rows[r][c].trim();
    out.push(o);
  }
  return out;
}

// A registry row reduced to what leads.registry_record stores.
function kqrNormalizeRow(source, row) {
  var name = row[source.name_field] || row.Name || row.name || '';
  if (!name) return null;
  var state = row[source.state_field] || row.State || '';
  if (state && !/^(SA|South Australia)$/i.test(state)) return null;  // SA only
  return {
    registry_code: source.code,
    segment_code: source.segment,
    entity_name: String(name).trim(),
    name_norm: kqrNormName(name),
    postcode: String(row[source.postcode_field] || row.Postcode || '').trim().slice(0, 4),
    abn: String(row.ABN || row.Abn || row.abn || '').replace(/\s/g, '') || null,
    meta: row
  };
}

/*
 * SA Tenders + council portals. This is the highest-value adapter in the file:
 * a published cleaning contract with an expiry date is a dated buying window,
 * and it is the only signal in the system that carries a deadline. Everything
 * else is a guess about timing.
 */
var KQ_TENDER_DATE_RE = /\b(\d{1,2})[\/\-\s](\d{1,2}|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\/\-\s](\d{4})\b/i;
var KQ_MONTHS = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
var KQ_CLEANING_CONTRACT_RE = /\b(cleaning|janitorial|hygiene services|facilities? (services|maintenance)|housekeeping)\b/i;
var KQ_EXPIRY_LABEL_RE = /(contract\s+(end|expiry|expiration)|expiry\s+date|end\s+date|contract\s+period\s+(ends|to)|valid\s+until|term\s+ends)/i;

/*
 * kqrParseTenderPage(text, sourceUrl) -> [{ signal_type, signal_value,
 *   expires_at, source_url, confidence, title }]
 *
 * text is the stripped page text. Only rows that mention cleaning are kept —
 * a road-resurfacing contract expiry is not a buying window for KQuality.
 */
function kqrParseTenderPage(text, sourceUrl) {
  var s = String(text == null ? '' : text).replace(/\s+/g, ' ');
  var out = [];
  /*
   * Anchor on the cleaning mention and read forward, rather than splitting the
   * page into records. Listings put the expiry under a label ("Contract end
   * date") that is itself preceded by the word "Contract", so splitting on
   * record keywords separates a contract from its own date — and then the next
   * record's date is the nearest one, which is how you end up chasing a road
   * resurfacing contract.
   */
  var re = new RegExp(KQ_CLEANING_CONTRACT_RE.source, 'gi');
  var m;
  var seen = {};
  while ((m = re.exec(s)) !== null) {
    var window = s.slice(m.index, m.index + 400);
    var labelled = KQ_EXPIRY_LABEL_RE.exec(window);
    var dateZone = labelled ? window.slice(labelled.index, labelled.index + 160) : window;
    var d = KQ_TENDER_DATE_RE.exec(dateZone);
    if (!d) continue;
    var iso = kqrToIso(d[1], d[2], d[3]);
    if (!iso) continue;
    // One signal per expiry date: a listing repeats "cleaning" several times.
    if (seen[iso]) continue;
    seen[iso] = true;
    var start = Math.max(0, m.index - 60);
    out.push({
      signal_type: 'contract_expiry',
      signal_value: s.slice(start, start + 140).trim(),
      expires_at: iso,
      source_url: sourceUrl,
      confidence: labelled ? 0.85 : 0.55,
      title: s.slice(start, start + 90).trim()
    });
  }
  return out;
}

function kqrToIso(d, m, y) {
  var day = parseInt(d, 10);
  var mon = /^\d+$/.test(m) ? parseInt(m, 10) : KQ_MONTHS[String(m).slice(0, 3).toLowerCase()];
  var yr = parseInt(y, 10);
  if (!day || !mon || !yr || day > 31 || mon > 12 || yr < 2020 || yr > 2040) return null;
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  return yr + '-' + pad(mon) + '-' + pad(day) + 'T00:00:00+09:30';
}

/*
 * Tier C — commercial enrichment behind one adapter so the vendor is
 * swappable and an unset key is a skipped stage, never an error (§4.2).
 */
function kqrVerifierRequest(email, env) {
  env = env || {};
  var key = env.EMAIL_VERIFY_API_KEY;
  var vendor = (env.EMAIL_VERIFY_VENDOR || '').toLowerCase();
  if (!key || !email) return null;
  if (vendor === 'zerobounce') {
    return { method: 'GET', url: 'https://api.zerobounce.net/v2/validate?api_key=' +
      encodeURIComponent(key) + '&email=' + encodeURIComponent(email) };
  }
  if (vendor === 'neverbounce') {
    return { method: 'GET', url: 'https://api.neverbounce.com/v4/single/check?key=' +
      encodeURIComponent(key) + '&email=' + encodeURIComponent(email) };
  }
  if (vendor === 'millionverifier') {
    return { method: 'GET', url: 'https://api.millionverifier.com/api/v3/?api=' +
      encodeURIComponent(key) + '&email=' + encodeURIComponent(email) };
  }
  return null;
}

// Map every vendor's answer onto lead_contact.email_verification_status.
function kqrVerifierParse(vendor, payload) {
  var v = String(vendor || '').toLowerCase();
  var p = payload || {};
  var raw = '';
  if (v === 'zerobounce') raw = String(p.status || '');
  else if (v === 'neverbounce') raw = String(p.result || '');
  else if (v === 'millionverifier') raw = String(p.result || '');
  else return 'unverified';
  var t = raw.toLowerCase();
  if (t === 'valid' || t === 'ok' || t === 'deliverable') return 'valid';
  if (t === 'invalid' || t === 'bad' || t === 'undeliverable') return 'invalid';
  if (t === 'catch-all' || t === 'catchall' || t === 'accept_all' || t === 'catch_all') return 'catch_all';
  if (t === 'do_not_mail' || t === 'disposable' || t === 'abuse') return 'disposable';
  if (t === 'role' || t === 'role_based') return 'role';
  return 'unknown';
}

/*
 * Google Places detail request, used for multi-site detection and category.
 * Key is env-gated; without it the stage is skipped and site_count_estimate
 * stays NULL rather than the pipeline erroring.
 */
function kqrPlacesSearchUrl(businessName, env) {
  env = env || {};
  if (!env.GOOGLE_PLACES_API_KEY || !businessName) return null;
  return 'https://places.googleapis.com/v1/places:searchText';
}
function kqrPlacesSearchBody(businessName, suburb) {
  return {
    textQuery: String(businessName || '') + (suburb ? ' ' + suburb : '') + ' South Australia',
    maxResultCount: 10,
    regionCode: 'AU'
  };
}
// Same brand across several addresses is a multi-site operator, which is worth
// 10 points and a different pitch (one contract, one invoice).
function kqrCountSites(places, businessName) {
  var want = kqrNormName(businessName);
  var seen = {};
  var arr = (places && places.places) || [];
  for (var i = 0; i < arr.length; i++) {
    var p = arr[i] || {};
    var nm = kqrNormName((p.displayName && p.displayName.text) || '');
    if (!nm || kqrNameSimilarity(want, nm) < 0.8) continue;
    var addr = String(p.formattedAddress || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (addr) seen[addr] = true;
  }
  return Object.keys(seen).length || null;
}
// ---------- end registry adapters ----------
`;
