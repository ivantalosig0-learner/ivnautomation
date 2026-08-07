/*
 * contacts.js — Tier A decision-maker extraction, injected into the n8n
 * Lead Intelligence Engine Code nodes the same way composer.js is.
 *
 * Why this exists: measured 2026-08-07, zero leads in the database had a
 * contactable named person, 62.9% of emailable leads were gatekeeper
 * mailboxes, and the 441 leads that did carry a scraped people[] array were
 * mostly split artefacts — "Angelique Operations / Manager" is one heading
 * ("Angelique — Operations Manager") cut in the wrong place. Everything here
 * is pure: no network, no DB. The n8n HTTP nodes fetch, this parses.
 *
 * Tier A only (the company's own website). Registries are registries.js.
 * LinkedIn is never fetched — a linkedin_url is stored only when the company
 * published it on their own site.
 */
module.exports.CONTACTS_SRC = String.raw`
// ---------- KQuality contact discovery v1 ----------

// Crawled at depth <= 2, in this order. First match wins per pattern, and the
// crawl stops early once a rank-1 contact with a personal email is found.
var KQ_CONTACT_PATHS = [
  '/about', '/about-us', '/our-team', '/team', '/people', '/staff',
  '/leadership', '/management', '/contact', '/contact-us', '/our-people',
  '/who-we-are', '/board', '/governance', '/careers'
];

// Role mailboxes. A lead whose only address is one of these is rank 5 and is
// not a qualified lead.
var KQ_ROLE_LOCALS = [
  'info', 'admin', 'office', 'contact', 'contactus', 'enquiries', 'enquiry',
  'enquire', 'hello', 'reception', 'mail', 'email', 'sales', 'support',
  'accounts', 'accounting', 'bookings', 'booking', 'general', 'team', 'hi',
  'help', 'service', 'customerservice', 'noreply', 'no-reply', 'donotreply',
  'webmaster', 'postmaster', 'abuse', 'privacy', 'marketing', 'careers',
  'jobs', 'hr', 'recruitment', 'orders', 'invoices', 'ap', 'ar', 'finance'
];

var KQ_DISPOSABLE_DOMAINS = [
  'mailinator.com', 'guerrillamail.com', 'yopmail.com', '10minutemail.com',
  'tempmail.com', 'temp-mail.org', 'throwawaymail.com', 'trashmail.com',
  'sharklasers.com', 'getnada.com', 'maildrop.cc', 'dispostable.com',
  'fakeinbox.com', 'mailnesia.com', 'spamgourmet.com', 'mytemp.email'
];

var KQ_FREE_DOMAINS = [
  'gmail.com', 'yahoo.com', 'yahoo.com.au', 'hotmail.com', 'hotmail.com.au',
  'outlook.com', 'outlook.com.au', 'live.com', 'live.com.au', 'bigpond.com',
  'bigpond.net.au', 'optusnet.com.au', 'iinet.net.au', 'internode.on.net',
  'tpg.com.au', 'me.com', 'icloud.com', 'aol.com', 'protonmail.com'
];

/*
 * Title ranking, §4.3. Order matters: the first bucket that matches wins, so
 * rank-1 operational buyers are tested before the generic C-suite patterns.
 * A "Facilities Manager" outranks a "CEO" here on purpose — the FM signs the
 * cleaning contract, the CEO forwards the email and it dies.
 */
var KQ_RANK1 = [
  /\bfacilit(y|ies)\s+(manager|coordinator|lead|officer)\b/i,
  /\bstrata\s+manager\b/i,
  /\bbody\s+corporate\s+manager\b/i,
  /\bcommunity\s+manager\b/i,
  /\bportfolio\s+manager\b/i,
  /\bproperty\s+manager\b/i,
  /\bbuilding\s+manager\b/i,
  /\basset\s+manager\b/i,
  /\bpractice\s+manager\b/i,
  /\bclinic\s+manager\b/i,
  /\bbusiness\s+manager\b/i,
  /\bbursar\b/i,
  /\bnominated\s+supervisor\b/i,
  /\bcentre\s+director\b/i,
  /\boperations?\s+manager\b/i,
  /\bhotel\s+services\s+manager\b/i,
  /\bhousekeeping\s+manager\b/i,
  /\bcare\s+manager\b/i,
  /\bservice\s+(delivery\s+)?manager\b/i,
  /\bquality\s*(&|and)?\s*safeguards?\s+manager\b/i,
  /\bsite\s+manager\b/i,
  /\bwhs\s+manager\b/i,
  /\bvenue\s+manager\b/i,
  /\bwarehouse\s+manager\b/i,
  /\bhead\s+of\s+operations\b/i,
  /\bnational\s+facilities\s+manager\b/i
];
var KQ_RANK2 = [
  /\bprocurement\s+(officer|manager|lead)\b/i,
  /\bcontracts?\s+manager\b/i,
  /\bcategory\s+manager\b/i,
  /\bowner\b/i,
  /\bco-?owner\b/i,
  /\bproprietor\b/i,
  /\bprincipal\b/i,
  /\bpartner\b/i,
  /\bfounder\b/i,
  /\bco-?founder\b/i,
  /\bdirector\b/i,
  /\bmanaging\s+director\b/i,
  /\bgeneral\s+manager\b/i,
  /\bapproved\s+provider\b/i,
  /\bprincipal\s+dentist\b/i,
  /\bpractice\s+principal\b/i
];
var KQ_RANK3 = [
  /\bchief\s+executive\b/i, /\bceo\b/i,
  /\bchief\s+financial\b/i, /\bcfo\b/i,
  /\bchief\s+operating\b/i, /\bcoo\b/i,
  /\bexecutive\s+director\b/i,
  /\bdirector\s+of\s+nursing\b/i,
  /\bhead\s+of\b/i
];
var KQ_RANK4 = [
  /\boffice\s+manager\b/i,
  /\badmin(istration)?\s+manager\b/i,
  /\badministrator\b/i,
  /\bexecutive\s+assistant\b/i,
  /\breceptionist\b/i,
  /\bcoordinator\b/i
];

function kqcTitleRank(title) {
  var t = String(title == null ? '' : title).replace(/\s+/g, ' ').trim();
  if (!t) return 5;
  var i;
  // Rank 2 owner/director patterns are checked after rank 1 but a "Managing
  // Director" must not fall through to the bare /director/ test as rank 1.
  for (i = 0; i < KQ_RANK1.length; i++) if (KQ_RANK1[i].test(t)) return 1;
  for (i = 0; i < KQ_RANK2.length; i++) if (KQ_RANK2[i].test(t)) return 2;
  for (i = 0; i < KQ_RANK3.length; i++) if (KQ_RANK3[i].test(t)) return 3;
  for (i = 0; i < KQ_RANK4.length; i++) if (KQ_RANK4[i].test(t)) return 4;
  return 5;
}

/*
 * Segment-aware promotion. A "Service Manager" is the buyer in NDIS and noise
 * in retail, so the DB title list for the lead's segment can lift a rank.
 * segmentTitles is segment_taxonomy.decision_titles for the lead's segment.
 */
function kqcTitleRankFor(title, segmentTitles) {
  var base = kqcTitleRank(title);
  var t = String(title == null ? '' : title).toLowerCase();
  var list = Array.isArray(segmentTitles) ? segmentTitles : [];
  for (var i = 0; i < list.length; i++) {
    var want = String(list[i] || '').toLowerCase().trim();
    if (want && t.indexOf(want) !== -1) return 1;
  }
  return base;
}

/*
 * Name validation. This is the single highest-leverage filter in the file:
 * without it, page headings become "people". Every token that is a job-title
 * noun disqualifies the string as a personal name, because a real surname
 * being one of these words is far rarer than a mis-split heading.
 */
var KQ_TITLE_NOUNS = new RegExp(
  '\\b(' + [
    'manager', 'managers', 'director', 'directors', 'officer', 'officers',
    'coordinator', 'consultant', 'advisor', 'adviser', 'specialist', 'lead',
    'leader', 'head', 'chief', 'executive', 'assistant', 'administrator',
    'supervisor', 'principal', 'partner', 'associate', 'agent', 'agents',
    'operations', 'operation', 'property', 'properties', 'practice', 'sales',
    'service', 'services', 'support', 'success', 'member', 'membership',
    'client', 'clients', 'customer', 'account', 'accounts', 'finance',
    'financial', 'marketing', 'business', 'facilities', 'facility', 'site',
    'sites', 'venue', 'store', 'branch', 'regional', 'national', 'area',
    'senior', 'junior', 'licensed', 'registered', 'enrolled', 'general',
    'team', 'group', 'office', 'quality', 'care', 'nurse', 'nursing',
    'community', 'solutions', 'cleaning', 'company', 'centre', 'center',
    'compliance', 'safety', 'risk', 'people', 'talent', 'project', 'projects',
    'development', 'delivery', 'digital', 'design', 'strata', 'investor',
    'owner', 'occupier', 'tenant', 'landlord', 'contact', 'enquiries',
    'reception', 'welcome', 'about', 'home', 'our', 'meet', 'read', 'more'
  ].join('|') + ')\\b', 'i');

var KQ_NAME_SHAPE = /^[A-Z][a-z''\-]{1,15}(?: [A-Z][a-z''\-]{1,20}){1,2}$/;

function kqcValidPersonName(name) {
  var n = String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
  if (n.length < 5 || n.length > 45) return false;
  if (!KQ_NAME_SHAPE.test(n)) return false;
  if (KQ_TITLE_NOUNS.test(n)) return false;
  // "John Smith Pty Ltd", "Smith And Sons"
  if (/\b(pty|ltd|inc|llc|and|the|of|for)\b/i.test(n)) return false;
  return true;
}

function kqcFirstName(full) {
  return String(full || '').trim().split(/\s+/)[0] || null;
}
function kqcLastName(full) {
  var p = String(full || '').trim().split(/\s+/);
  return p.length > 1 ? p[p.length - 1] : null;
}

// ---------- email helpers ----------

// No backtick in the class: it is legal in a local part and never seen in one,
// and this whole file is carried inside a String.raw template.
var KQ_EMAIL_RE = /[A-Za-z0-9!#%&'*+\/=?^_{|}~.\-]+@[A-Za-z0-9](?:[A-Za-z0-9\-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9\-]{0,61}[A-Za-z0-9])?)+/g;

function kqcNormEmail(e) {
  return String(e == null ? '' : e).trim().toLowerCase().replace(/^mailto:/, '').split('?')[0];
}
function kqcEmailLocal(e) { return kqcNormEmail(e).split('@')[0] || ''; }
function kqcEmailDomain(e) { return kqcNormEmail(e).split('@')[1] || ''; }

function kqcIsRoleAddress(e) {
  var l = kqcEmailLocal(e).replace(/[._\-]/g, '');
  return KQ_ROLE_LOCALS.indexOf(l) !== -1;
}
function kqcIsDisposable(e) {
  return KQ_DISPOSABLE_DOMAINS.indexOf(kqcEmailDomain(e)) !== -1;
}
function kqcIsFreeMailbox(e) {
  return KQ_FREE_DOMAINS.indexOf(kqcEmailDomain(e)) !== -1;
}
function kqcEmailType(e) {
  if (!e) return null;
  return kqcIsRoleAddress(e) ? 'role' : 'personal';
}

/*
 * Placeholder and asset addresses. These are not hypothetical: the diagnostic
 * found user@domain.com sitting in 26 lead rows and being mailed, and the
 * first live extraction run harvested CDN paths as addresses.
 */
var KQ_JUNK_DOMAINS = [
  'domain.com', 'example.com', 'example.com.au', 'example.org', 'yourdomain.com',
  'yoursite.com', 'email.com', 'sentry.io', 'sentry.wixpress.com', 'wixpress.com',
  'w3.org', 'schema.org', 'jsdelivr.net', 'bootstrapcdn.com', 'googleapis.com',
  'gstatic.com', 'cloudflare.com', 'cdnjs.com', 'unpkg.com', 'placeholder.com'
];
var KQ_JUNK_LOCALS = ['user', 'name', 'youremail', 'email', 'your', 'test', 'sample', 'someone'];

function kqcJunkEmail(e) {
  var em = kqcNormEmail(e);
  if (!em || em.indexOf('@') < 1) return true;
  var dom = kqcEmailDomain(em);
  var loc = kqcEmailLocal(em);
  if (!dom || dom.indexOf('.') === -1) return true;
  if (kqcIsDisposable(em)) return true;
  if (/\.(png|jpe?g|gif|svg|webp|css|js|mjs|json|woff2?|ico|map)$/i.test(em)) return true;
  if (/^[0-9a-f]{16,}$/.test(loc)) return true;              // sentry/analytics ids
  if (KQ_JUNK_LOCALS.indexOf(loc) !== -1) return true;
  for (var i = 0; i < KQ_JUNK_DOMAINS.length; i++) {
    if (dom === KQ_JUNK_DOMAINS[i] || dom.slice(-(KQ_JUNK_DOMAINS[i].length + 1)) === '.' + KQ_JUNK_DOMAINS[i]) return true;
  }
  if (/^(cdn|static|assets|fonts|analytics)\./.test(dom)) return true;
  return false;
}

/*
 * Learn the domain's address format from addresses actually published on the
 * site. Requires >= 2 real personal addresses that resolve against a known
 * name, otherwise returns null and no guessing is permitted (§4.4).
 *
 * pairs: [{ email, name }] where name is the person the address belongs to.
 */
function kqcLearnEmailPattern(pairs) {
  var votes = {};
  var total = 0;
  for (var i = 0; i < (pairs || []).length; i++) {
    var em = kqcNormEmail(pairs[i] && pairs[i].email);
    var nm = String((pairs[i] && pairs[i].name) || '').trim();
    if (!em || !nm || kqcIsRoleAddress(em)) continue;
    var f = (kqcFirstName(nm) || '').toLowerCase().replace(/[^a-z]/g, '');
    var l = (kqcLastName(nm) || '').toLowerCase().replace(/[^a-z]/g, '');
    if (!f) continue;
    var local = kqcEmailLocal(em);
    var pat = null;
    if (l && local === f + '.' + l) pat = 'first.last';
    else if (l && local === f + l) pat = 'firstlast';
    else if (l && local === f.charAt(0) + l) pat = 'flast';
    else if (l && local === f + '.' + l.charAt(0)) pat = 'first.l';
    else if (l && local === f + '_' + l) pat = 'first_last';
    else if (l && local === l + '.' + f) pat = 'last.first';
    else if (local === f) pat = 'first';
    if (!pat) continue;
    votes[pat] = (votes[pat] || 0) + 1;
    total++;
  }
  if (total < 2) return null;
  var best = null, bestN = 0;
  for (var k in votes) { if (votes[k] > bestN) { best = k; bestN = votes[k]; } }
  // A split vote means the domain has no consistent format worth guessing on.
  return bestN >= 2 && bestN / total >= 0.6 ? best : null;
}

function kqcBuildEmail(pattern, fullName, domain) {
  if (!pattern || !domain) return null;
  var f = (kqcFirstName(fullName) || '').toLowerCase().replace(/[^a-z]/g, '');
  var l = (kqcLastName(fullName) || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!f) return null;
  var local;
  switch (pattern) {
    case 'first.last':  local = l ? f + '.' + l : null; break;
    case 'firstlast':   local = l ? f + l : null; break;
    case 'flast':       local = l ? f.charAt(0) + l : null; break;
    case 'first.l':     local = l ? f + '.' + l.charAt(0) : null; break;
    case 'first_last':  local = l ? f + '_' + l : null; break;
    case 'last.first':  local = l ? l + '.' + f : null; break;
    case 'first':       local = f; break;
    default:            local = null;
  }
  return local ? local + '@' + String(domain).toLowerCase() : null;
}

// ---------- extraction ----------

/*
 * Entity decoding has to happen before any name or title is validated.
 * Measured on the first live run: "Chairman &amp; CEO" and "O&#39;Brien" both
 * failed validation purely because the entity was still encoded.
 */
var KQ_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '-', mdash: '-', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"',
  hellip: '...', middot: '-', bull: '-'
};
function kqcDecodeEntities(s) {
  return String(s == null ? '' : s)
    .replace(/&#x([0-9a-f]+);/gi, function (_m, h) {
      var n = parseInt(h, 16); return n ? String.fromCharCode(n) : _m;
    })
    .replace(/&#(\d+);/g, function (_m, d) {
      var n = parseInt(d, 10); return n ? String.fromCharCode(n) : _m;
    })
    .replace(/&([a-z]+);/gi, function (m, name) {
      var v = KQ_ENTITIES[String(name).toLowerCase()];
      return v === undefined ? m : v;
    });
}

function kqcStripTags(html) {
  return kqcDecodeEntities(String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/*
 * 1. Structured data first. JSON-LD Organization/Person and the employee /
 *    member / founder arrays are authored by the site owner, so they are the
 *    highest-trust source on the page and need no heuristics at all.
 */
function kqcFromJsonLd(html, pageUrl) {
  var out = [];
  var re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  var m;
  while ((m = re.exec(String(html || ''))) !== null) {
    var data;
    try { data = JSON.parse(m[1].trim()); } catch (e) { continue; }
    var stack = [data];
    while (stack.length) {
      var node = stack.pop();
      if (!node || typeof node !== 'object') continue;
      if (Array.isArray(node)) { for (var a = 0; a < node.length; a++) stack.push(node[a]); continue; }
      var type = node['@type'];
      var types = Array.isArray(type) ? type : [type];
      if (types.indexOf('Person') !== -1) {
        var nm = node.name ||
          [node.givenName, node.familyName].filter(Boolean).join(' ');
        if (kqcValidPersonName(nm)) {
          out.push({
            full_name: String(nm).trim(),
            job_title: node.jobTitle || node.role || null,
            email: node.email ? kqcNormEmail(node.email) : null,
            phone: node.telephone || null,
            linkedin_url: kqcPickLinkedIn(node.sameAs),
            source_url: pageUrl,
            confidence: 0.90,
            method: 'jsonld'
          });
        }
      }
      for (var key in node) {
        if (node[key] && typeof node[key] === 'object') stack.push(node[key]);
      }
    }
  }
  return out;
}

function kqcPickLinkedIn(sameAs) {
  var arr = Array.isArray(sameAs) ? sameAs : (sameAs ? [sameAs] : []);
  for (var i = 0; i < arr.length; i++) {
    if (/linkedin\.com\//i.test(String(arr[i]))) return String(arr[i]);
  }
  return null;
}

/*
 * 2. Microdata (itemprop). Same idea, older sites.
 */
function kqcFromMicrodata(html, pageUrl) {
  var out = [];
  var blocks = String(html || '').split(/itemtype=["'][^"']*schema\.org\/Person["']/i);
  for (var i = 1; i < blocks.length; i++) {
    var seg = blocks[i].slice(0, 1200);
    var nm = kqcItemprop(seg, 'name');
    var jt = kqcItemprop(seg, 'jobTitle');
    if (kqcValidPersonName(nm)) {
      out.push({
        full_name: nm, job_title: jt, email: kqcItemprop(seg, 'email'),
        phone: kqcItemprop(seg, 'telephone'), linkedin_url: null,
        source_url: pageUrl, confidence: 0.80, method: 'microdata'
      });
    }
  }
  return out;
}
function kqcItemprop(seg, prop) {
  var re = new RegExp('itemprop=["\']' + prop + '["\'][^>]*>([^<]{2,80})<', 'i');
  var m = re.exec(seg);
  if (m) return kqcStripTags(m[1]);
  var re2 = new RegExp('itemprop=["\']' + prop + '["\'][^>]*content=["\']([^"\']{2,80})["\']', 'i');
  var m2 = re2.exec(seg);
  return m2 ? m2[1].trim() : null;
}

/*
 * 3. mailto: links. The anchor text or the surrounding block often carries the
 *    person's name, which is what makes the address attributable — and an
 *    attributable address is what lets kqcLearnEmailPattern work at all.
 */
function kqcFromMailto(html, pageUrl) {
  var out = [];
  var re = /<a[^>]+href=["']mailto:([^"'?]+)[^"']*["'][^>]*>([\s\S]{0,200}?)<\/a>/gi;
  var m;
  var src = String(html || '');
  while ((m = re.exec(src)) !== null) {
    var email = kqcNormEmail(m[1]);
    if (!email || email.indexOf('@') === -1) continue;
    var text = kqcStripTags(m[2]);
    var name = kqcValidPersonName(text) ? text : null;
    if (!name) {
      // Look back up to 240 chars for a name in the same card.
      var before = kqcStripTags(src.slice(Math.max(0, m.index - 240), m.index));
      var words = before.split(' ');
      for (var w = words.length - 3; w >= 0 && w > words.length - 12; w--) {
        var cand = words.slice(w, w + 2).join(' ');
        if (kqcValidPersonName(cand)) { name = cand; break; }
      }
    }
    out.push({
      full_name: name, job_title: null, email: email, phone: null,
      linkedin_url: null, source_url: pageUrl,
      confidence: name ? 0.75 : 0.45, method: 'mailto'
    });
  }
  return out;
}

/*
 * 4. Team-card DOM heuristic, last resort. A person is a name string with a
 *    title string within ~120 characters of it. Both halves must validate, so
 *    the "Angelique Operations / Manager" split that polluted the old
 *    people[] array cannot recur: "Angelique Operations" fails the name test.
 */
var KQ_TITLE_LINE = /\b(manager|managing|director|officer|coordinator|co-ordinator|principal|partner|founder|owner|proprietor|supervisor|bursar|administrator|administration|ceo|cfo|coo|cio|chairman|chair|president|treasurer|secretary|head of|team leader|leader|superintendent|registrar|dentist|doctor|practitioner|physiotherapist|chiropractor|podiatrist|optometrist|pharmacist|nurse|therapist|psychologist|dietitian|consultant|associate|adviser|advisor|specialist|agent|representative|receptionist|accountant|bookkeeper|solicitor|lawyer|paralegal|architect|engineer|technician|analyst|educator|teacher|principal|chef|concierge|housekeeper|nominated supervisor|responsible person|executive)\b/i;

/*
 * Same-line separators. "Jane Smith - Practice Manager" and
 * "Practice Manager: Jane Smith" are both extremely common and both were
 * missed by the first version, which only ever looked at the following line.
 * Measured on 28 live Adelaide sites: line-adjacency alone found a title for
 * fewer than half the names it discovered.
 */
var KQ_NAME_TITLE_SEP = /\s+[–—\-\|·•:]\s+|,\s+/;

/*
 * A bare two-capitalised-word string is not evidence of a person. The second
 * live run proved it: accepting untitled names turned "Rundle Mall" and
 * "Free Wifi" into staff and pushed one hotel homepage to 19 "people" while
 * the decision-maker rate did not move at all. A team-card person must come
 * with a title; names without one are left to the structured-data and mailto
 * paths, which carry their own evidence.
 */
function kqcPushCard(out, name, title, pageUrl) {
  if (!kqcValidPersonName(name)) return false;
  var t = title ? String(title).replace(/\s+/g, ' ').trim() : null;
  if (t && t.length > 70) t = null;
  if (t && !KQ_TITLE_LINE.test(t)) t = null;
  if (!t) return false;
  out.push({
    full_name: String(name).replace(/\s+/g, ' ').trim(), job_title: t,
    email: null, phone: null, linkedin_url: null, source_url: pageUrl,
    confidence: 0.68, method: 'team_card'
  });
  return true;
}

// Lines that sit between a name and its role on card layouts: phone numbers,
// addresses, "View profile", social handles. Skipping them lets the look-ahead
// reach further without picking up noise.
function kqcFillerLine(s) {
  var t = String(s || '').trim();
  if (!t) return true;
  if (t.length < 3) return true;
  if (/^[\d\s()+\-.]{6,}$/.test(t)) return true;              // phone
  if (t.indexOf('@') !== -1) return true;                     // email
  if (/^(view|read|more|contact|email|call|phone|mobile|m:|p:|t:|e:|profile|bio|linkedin|facebook|instagram)\b/i.test(t)) return true;
  return false;
}

function kqcFromTeamCards(html, pageUrl) {
  var out = [];
  var text = kqcDecodeEntities(String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    // Turn block boundaries into separators so a name and its title stay apart.
    .replace(/<\/(h[1-6]|p|div|li|td|tr|span|strong|b|em|a|figcaption)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t ]+/g, ' ');
  var lines = text.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
  var claimed = {};

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line.length > 90) continue;

    // Case A: name and title share a line, in either order.
    var parts = line.split(KQ_NAME_TITLE_SEP);
    if (parts.length >= 2) {
      var left = parts[0].trim(), right = parts.slice(1).join(' - ').trim();
      if (kqcValidPersonName(left) && KQ_TITLE_LINE.test(right)) {
        if (!claimed[left.toLowerCase()] && kqcPushCard(out, left, right, pageUrl)) {
          claimed[left.toLowerCase()] = true; continue;
        }
      }
      if (kqcValidPersonName(right) && KQ_TITLE_LINE.test(left)) {
        if (!claimed[right.toLowerCase()] && kqcPushCard(out, right, left, pageUrl)) {
          claimed[right.toLowerCase()] = true; continue;
        }
      }
    }

    // Case B: the line is just a name. The title sits on one of the next two
    // lines, or — on card layouts that put the role above the photo — the
    // line before it.
    if (!kqcValidPersonName(line)) continue;
    if (claimed[line.toLowerCase()]) continue;
    var title = null;
    for (var j = i + 1; j <= i + 4 && j < lines.length; j++) {
      if (kqcValidPersonName(lines[j])) break;                 // next card started
      if (kqcFillerLine(lines[j])) continue;
      if (lines[j].length <= 70 && KQ_TITLE_LINE.test(lines[j])) { title = lines[j]; break; }
      break;                                                   // real prose, not a role
    }
    for (var k = i - 1; !title && k >= i - 2 && k >= 0; k--) {
      if (kqcValidPersonName(lines[k])) break;
      if (kqcFillerLine(lines[k])) continue;
      if (lines[k].length <= 70 && KQ_TITLE_LINE.test(lines[k])) { title = lines[k]; break; }
      break;
    }
    if (kqcPushCard(out, line, title, pageUrl)) claimed[line.toLowerCase()] = true;
  }
  return out;
}

/*
 * kqcExtractContacts(html, pageUrl, opts) -> { contacts, emails, pattern }
 *
 * opts.segmentTitles — segment_taxonomy.decision_titles, lifts matching titles
 * to rank 1. opts.orgDomain — the company's own domain; addresses on other
 * domains are kept but never pattern-guessed against.
 */
function kqcExtractContacts(html, pageUrl, opts) {
  opts = opts || {};
  var found = []
    .concat(kqcFromJsonLd(html, pageUrl))
    .concat(kqcFromMicrodata(html, pageUrl))
    .concat(kqcFromMailto(html, pageUrl))
    .concat(kqcFromTeamCards(html, pageUrl));

  // Merge: same person discovered by two methods keeps the best of each.
  var byName = {};
  var anonymous = [];
  for (var i = 0; i < found.length; i++) {
    var c = found[i];
    // A junk address loses the address, not the person: the name is still
    // worth having, and the domain pattern can supply an address later.
    if (c.email && kqcJunkEmail(c.email)) c.email = null;
    if (!c.full_name) { if (c.email) anonymous.push(c); continue; }
    var key = c.full_name.toLowerCase();
    if (!byName[key]) { byName[key] = c; continue; }
    var e = byName[key];
    e.job_title    = e.job_title    || c.job_title;
    e.email        = e.email        || c.email;
    e.phone        = e.phone        || c.phone;
    e.linkedin_url = e.linkedin_url || c.linkedin_url;
    e.confidence   = Math.max(e.confidence, c.confidence);
    e.method       = e.method + '+' + c.method;
  }

  var contacts = [];
  for (var k in byName) {
    var p = byName[k];
    p.first_name = kqcFirstName(p.full_name);
    p.title_rank = kqcTitleRankFor(p.job_title, opts.segmentTitles);
    p.email_type = p.email ? kqcEmailType(p.email) : null;
    contacts.push(p);
  }

  // Every address seen on the page, named or not — this is what the send path
  // falls back to and what the pattern learner votes on.
  //
  // Harvest from the stripped text plus explicit mailto hrefs, never from raw
  // markup: the first live run pulled "//cdn.jsdelivr.net/npm/popper.js" out of
  // a script tag and treated it as an address.
  var allEmails = {};
  var raw = (kqcStripTags(html).match(KQ_EMAIL_RE) || [])
    .concat((String(html || '').match(/mailto:([^"'?>\s]+)/gi) || []));
  for (var r = 0; r < raw.length; r++) {
    var em = kqcNormEmail(raw[r]);
    if (kqcJunkEmail(em)) continue;
    allEmails[em] = true;
  }
  for (var q = 0; q < anonymous.length; q++) allEmails[anonymous[q].email] = true;
  for (var t = 0; t < contacts.length; t++) if (contacts[t].email) allEmails[contacts[t].email] = true;

  var pattern = kqcLearnEmailPattern(contacts.filter(function (c) { return c.email; })
    .map(function (c) { return { email: c.email, name: c.full_name }; }));

  contacts.sort(function (a, b) {
    return (a.title_rank - b.title_rank) ||
           ((b.email ? 1 : 0) - (a.email ? 1 : 0)) ||
           (b.confidence - a.confidence);
  });

  return { contacts: contacts, emails: Object.keys(allEmails), pattern: pattern };
}

/*
 * Stop condition for the crawler (§4.2): a rank-1 contact with a published
 * personal address is as good as Tier A gets, so stop paying for more pages.
 */
function kqcSatisfied(contacts) {
  for (var i = 0; i < (contacts || []).length; i++) {
    var c = contacts[i];
    if (c.title_rank === 1 && c.email && c.email_type === 'personal') return true;
  }
  return false;
}

// Absolute URLs for the Tier A crawl, deduped, same-origin only.
function kqcCrawlUrls(website) {
  var base = String(website || '').trim();
  if (!base) return [];
  if (!/^https?:\/\//i.test(base)) base = 'https://' + base;
  var origin;
  try {
    var m = /^(https?:\/\/[^\/]+)/i.exec(base);
    origin = m ? m[1] : null;
  } catch (e) { origin = null; }
  if (!origin) return [];
  var urls = [origin + '/'];
  for (var i = 0; i < KQ_CONTACT_PATHS.length; i++) urls.push(origin + KQ_CONTACT_PATHS[i]);
  return urls;
}

// Same-origin depth-2 links that look like people pages, harvested from the
// homepage so sites using /our-story or /meet-the-team are still reachable.
var KQ_LINK_HINT = /(about|team|people|staff|leader|management|contact|who-we-are|our-story|meet)/i;
function kqcDiscoverLinks(html, origin, limit) {
  var out = {};
  var re = /<a[^>]+href=["']([^"'#]+)["']/gi;
  var m;
  while ((m = re.exec(String(html || ''))) !== null) {
    var href = m[1];
    if (/^(mailto:|tel:|javascript:)/i.test(href)) continue;
    if (!KQ_LINK_HINT.test(href)) continue;
    var abs = href;
    if (/^\//.test(href)) abs = origin + href;
    else if (!/^https?:\/\//i.test(href)) abs = origin + '/' + href;
    if (abs.indexOf(origin) !== 0) continue;          // same origin only
    if (abs.length > 200) continue;
    out[abs.replace(/\/$/, '')] = true;
  }
  return Object.keys(out).slice(0, limit || 6);
}
// ---------- end contact discovery ----------
`;
