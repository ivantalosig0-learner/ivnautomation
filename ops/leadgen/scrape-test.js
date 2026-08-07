#!/usr/bin/env node
/*
 * scrape-test.js — measures the Tier A decision-maker hit rate against real
 * Adelaide businesses (§7). Not a unit test: it fetches live sites and reports
 * what the extractor actually found, so the 40% gate is measured rather than
 * asserted.
 *
 *   docker exec -w /tmp/lg ivnautomation-n8n node scrape-test.js sample-sites.json
 *
 * Crawls each site's homepage plus the highest-yield contact paths, depth 1,
 * stopping early once a rank-1 contact with a personal email is found — which
 * is also the production stop condition, so the measured cost is the real one.
 */
const fs = require('fs');
const vm = require('vm');

const SRC = require('./contacts.js').CONTACTS_SRC;
const ctx = vm.createContext({ JSON, console, RegExp, Number, String, Object, Array, Math, isNaN, parseInt });
vm.runInContext(SRC, ctx);
const call = (fn, ...args) => { ctx.__a = args; return vm.runInContext(`${fn}.apply(null,__a)`, ctx); };

const SEGMENT_TITLES = {
  STRATA: ['strata manager', 'body corporate manager', 'portfolio manager', 'community manager'],
  COMMERCIAL_RE: ['facilities manager', 'property manager', 'building manager', 'asset manager'],
  NDIS: ['operations manager', 'quality and safeguards manager', 'service manager'],
  AGED_CARE: ['facility manager', 'hotel services manager', 'care manager', 'operations manager'],
  HEALTH: ['practice manager', 'clinic manager', 'principal dentist'],
  EDU: ['business manager', 'bursar', 'nominated supervisor', 'centre director'],
  HOSPITALITY: ['venue manager', 'general manager', 'housekeeping manager']
};

const PATHS = ['/', '/contact', '/contact-us', '/about', '/about-us', '/our-team', '/team', '/our-people', '/staff', '/people'];
const TIMEOUT_MS = 9000;
const CONCURRENCY = 6;

function origin(site) {
  let s = String(site || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  const m = /^(https?:\/\/[^\/]+)/i.exec(s);
  return m ? m[1] : null;
}

async function get(url) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      signal: ac.signal, redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; KQualityLeadBot/1.0; +https://kqualitycleaningservices.com.au)' }
    });
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || '';
    if (ct && !/text\/html|application\/xhtml/i.test(ct)) return null;
    const t = await r.text();
    return t.length > 900000 ? t.slice(0, 900000) : t;
  } catch (e) { return null; }
  finally { clearTimeout(timer); }
}

async function crawl(lead) {
  const o = origin(lead.website);
  const res = { id: lead.id, name: lead.business_name, segment: lead.segment_code,
                origin: o, pages: 0, contacts: [], emails: [], pattern: null, error: null };
  if (!o) { res.error = 'no_origin'; return res; }

  const titles = SEGMENT_TITLES[lead.segment_code] || [];
  const merged = {};
  const emails = {};
  const emailedNames = [];

  for (const p of PATHS) {
    const html = await get(o + (p === '/' ? '/' : p));
    if (!html) continue;
    res.pages++;
    const out = call('kqcExtractContacts', html, o + p, { segmentTitles: titles, orgDomain: o });
    for (const c of out.contacts) {
      const k = c.full_name.toLowerCase();
      if (!merged[k]) merged[k] = c;
      else {
        merged[k].job_title = merged[k].job_title || c.job_title;
        merged[k].email = merged[k].email || c.email;
        merged[k].title_rank = Math.min(merged[k].title_rank, c.title_rank);
      }
      if (c.email) emailedNames.push({ email: c.email, name: c.full_name });
    }
    for (const e of out.emails) emails[e] = true;
    const all = Object.values(merged);
    if (call('kqcSatisfied', all)) break;
  }

  res.contacts = Object.values(merged).sort((a, b) => a.title_rank - b.title_rank);
  res.emails = Object.keys(emails);
  res.pattern = call('kqcLearnEmailPattern', emailedNames);
  return res;
}

(async () => {
  const leads = JSON.parse(fs.readFileSync(process.argv[2] || 'sample-sites.json', 'utf8'));
  const results = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < leads.length) {
      const lead = leads[cursor++];
      results.push(await crawl(lead));
    }
  }));

  results.sort((a, b) => (a.segment || '').localeCompare(b.segment || '') || a.id - b.id);

  let named = 0, rank12 = 0, rank12Email = 0, anyEmail = 0, patterned = 0, reachable = 0;
  console.log('id      segment        pages  named  best  email                          business');
  console.log('-'.repeat(112));
  for (const r of results) {
    if (r.pages > 0) reachable++;
    const best = r.contacts[0];
    const withEmail = r.contacts.find(c => c.email && c.title_rank <= 2);
    if (r.contacts.length) named++;
    if (best && best.title_rank <= 2) rank12++;
    if (withEmail) rank12Email++;
    if (r.emails.length) anyEmail++;
    if (r.pattern) patterned++;
    console.log(
      String(r.id).padEnd(7),
      (r.segment || '').padEnd(14),
      String(r.pages).padEnd(6),
      String(r.contacts.length).padEnd(6),
      (best ? ('r' + best.title_rank + ' ' + (best.job_title || '?').slice(0, 22)) : '-').padEnd(26),
      (withEmail ? withEmail.email : (r.emails[0] || '-')).slice(0, 30).padEnd(31),
      String(r.name).slice(0, 28));
  }

  const n = results.length;
  const pct = (x) => (100 * x / n).toFixed(1) + '%';
  console.log('\n' + '='.repeat(70));
  console.log('sites attempted                 ' + n);
  console.log('sites reachable                 ' + reachable + '  (' + pct(reachable) + ')');
  console.log('any named person found          ' + named + '  (' + pct(named) + ')');
  console.log('DECISION MAKER (rank 1-2)       ' + rank12 + '  (' + pct(rank12) + ')   <- the 40% gate');
  console.log('rank 1-2 with a published email ' + rank12Email + '  (' + pct(rank12Email) + ')');
  console.log('any email address on site       ' + anyEmail + '  (' + pct(anyEmail) + ')');
  console.log('domain email pattern learned    ' + patterned + '  (' + pct(patterned) + ')');
  fs.writeFileSync('scrape-test-results.json', JSON.stringify(results, null, 1));
})();
