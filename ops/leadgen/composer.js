/*
 * composer.js — shared source injected into the n8n outreach Code nodes.
 *
 * Why this exists: the AI gateway sheds ~89% of generate_outreach calls
 * (Qwen3-8B, CPU-only, concurrency 2), so the old "fallback" template was in
 * practice the ONLY thing that ever sent. Every recipient got the same
 * "{Business} - cleaning support in {Suburb} (quick quote offer)" shape.
 * This composer is therefore built as the PRIMARY path: deterministic,
 * instant, and varied enough that no two recipients on a domain see the
 * same skeleton. AI output is used only when it comes back and beats it.
 */
module.exports.COMPOSER_SRC = String.raw`
// ---------- KQuality outreach composer v3 (deterministic) ----------
var KQ = {
  company: 'KQuality Cleaning Services',
  sender: 'Michelle',
  phone: '0439 489 630',
  email: 'info@kqualitycleaningservices.com.au'
};

// Segment playbook: the specific job we want, the pain it removes, and the
// noun we ask to price. Written for the buyer, never about us.
var PLAYBOOK = {
  real_estate_strata: {
    job: 'vacate and bond cleans',
    pain: 'getting a property re-listed without waiting on a cleaner',
    line: 'We turn vacate cleans around inside 24 hours and send photos through when it is done, so you can re-list without chasing anyone.',
    ask: 'your next vacate clean'
  },
  property_management: {
    job: 'end-of-lease and common-area cleans',
    pain: 'juggling different cleaners across a rent roll',
    line: 'Most managers we work with use one number for the whole rent roll and get a single invoice at month end instead of chasing five contractors.',
    ask: 'a couple of your managed properties'
  },
  strata: {
    job: 'common areas, bin rooms and carparks',
    pain: 'owner complaints about common areas',
    line: 'We run scheduled common-area cleans with a signed-off checklist each visit, so you have something to show the committee when someone asks.',
    ask: 'common-area cleaning for one of your buildings'
  },
  body_corporate: {
    job: 'common property cleaning',
    pain: 'committee complaints and inconsistent contractors',
    line: 'We run scheduled common-property cleans with a checklist signed off each visit, so there is a record when the committee asks.',
    ask: 'one of your buildings'
  },
  builders_construction: {
    job: 'builders and handover cleans',
    pain: 'a handover date slipping because the clean was not ready',
    line: 'We do builders cleans and final sparkle before client walkthrough, and we book to your handover date rather than the other way around.',
    ask: 'your next handover'
  },
  aged_care_facilities: {
    job: 'facility cleaning',
    pain: 'keeping cleaning evidence ready for an audit',
    line: 'All our staff are police-checked and we work to infection-control routines with documented sign-off, so the paperwork is there when you are audited.',
    ask: 'one wing or common area'
  },
  ndis: {
    job: 'cleaning for SIL and supported housing',
    pain: 'finding cleaners who are reliable and respectful with residents',
    line: 'Our staff are police-checked and used to working around residents, on a set schedule so participants see the same faces.',
    ask: 'one or two of your properties'
  },
  medical_childcare_gym: {
    job: 'after-hours cleaning and sanitising',
    pain: 'cleaning that has to happen outside opening hours',
    line: 'We clean after hours to clinical standards with child-safe products where they are needed, so you open to a room that is genuinely ready.',
    ask: 'your rooms and common areas'
  },
  commercial_office: {
    job: 'office cleaning',
    pain: 'a cleaner who changes every few weeks',
    line: 'You get the same cleaner each visit and a direct number rather than a call centre, which is usually the thing offices tell us was missing.',
    ask: 'your office'
  },
  education_training: {
    job: 'classroom and facility cleaning',
    pain: 'fitting deep cleans around term dates',
    line: 'We work to the term calendar - lighter during teaching weeks, deep cleans in the breaks - and every staff member is police-checked.',
    ask: 'your classrooms and amenities'
  },
  hospitality_venues: {
    job: 'early-morning venue cleans',
    pain: 'the room not being ready before service',
    line: 'We come in early and are out before service, so the room is ready rather than being cleaned around your first guests.',
    ask: 'your front of house'
  },
  retail_showrooms: {
    job: 'floors, glass and showroom presentation',
    pain: 'stock looking tired because the space does',
    line: 'We do floors and glass before you open so the first thing a customer sees is the stock, not the fingerprints.',
    ask: 'your showroom floor'
  },
  industrial_warehouse: {
    job: 'warehouse and amenities cleaning',
    pain: 'high-traffic floors and staff amenities slipping',
    line: 'We handle high-traffic floors and staff amenities on a set schedule, and our team is site-inducted before they start.',
    ask: 'your floors and amenities'
  },
  community_clubs: {
    job: 'post-event and weekend cleans',
    pain: 'volunteers cleaning up after functions',
    line: 'We do post-function turnarounds on weekends so your volunteers are not the ones mopping the hall on a Sunday morning.',
    ask: 'your next function turnaround'
  },
  automotive_trade: {
    job: 'workshop and customer-area cleaning',
    pain: 'a waiting area that does not match the workmanship',
    line: 'We keep the customer waiting area and amenities presentable and degrease the workshop floors on a schedule.',
    ask: 'your waiting area and workshop'
  }
};
var DEFAULT_PLAY = {
  job: 'commercial cleaning',
  pain: 'a cleaner who actually turns up',
  line: 'We are Adelaide-based, fully insured, and every cleaner is police-checked - documentation available on request.',
  ask: 'your site'
};

// ---- text helpers ----
function kqClean(t) { return String(t == null ? '' : t).replace(/\s+/g, ' ').trim(); }
function kqTitleCase(s) {
  return kqClean(s).toLowerCase().replace(/\b[a-z]/g, function (m) { return m.toUpperCase(); });
}
// Stable per-candidate variant index so the same lead always gets the same
// email, but neighbouring leads (and leads on one domain) do not match.
function kqVariant(id, n) { return Math.abs(Number(id) || 0) % n; }

var KQ_AU_TAIL = /,\s*Australia\s*$/i;
var KQ_STATE = /\s+(SA|NSW|VIC|QLD|WA|NT|TAS|ACT)\s+\d{4}.*$/i;
function kqSuburb(r) {
  if (r.suburb) return kqTitleCase(r.suburb);
  var a = String(r.address || '').replace(KQ_AU_TAIL, '');
  var p = a.split(',');
  if (p.length < 2) return '';
  return kqTitleCase(p[p.length - 1].replace(KQ_STATE, '').trim());
}
// "Adelaide" is the whole market, so it carries no signal in a subject line -
// a subject that could have been sent to anyone reads as bulk mail.
function kqSpecificSuburb(r) {
  var s = kqSuburb(r);
  return (/^(adelaide|adelaide cbd|south australia|sa)$/i.test(s)) ? '' : s;
}
// Subjects have to survive a phone preview pane, so long trading names get
// clipped at a word boundary rather than mid-word.
function kqShortName(name) {
  var n = kqClean(name).replace(/\s+(pty\.?\s*)?ltd\.?$/i, '').replace(/\s*\|.*$/, '');
  if (n.length <= 28) return n;
  var words = n.split(' ');
  var acc = '';
  for (var i = 0; i < words.length; i++) {
    if ((acc + ' ' + words[i]).trim().length > 28) break;
    acc = (acc + ' ' + words[i]).trim();
  }
  return acc || n.slice(0, 28);
}

// A contact first name, only when we are confident it is a real person.
var KQ_ROLE_OK = /^(Owner|Co-?Owner|Director|Managing Director|CEO|Founder|Co-?Founder|Principal|General Manager|Practice Manager|Operations Manager|Facilities Manager)$/i;
var KQ_NAME_BLOCK = /(Care|Quality|Executive|Nurse|Registered|Enrolled|General|Office|Property|Practice|Team|Group|Services|Community|Heart|Solutions|Cleaning)/i;
function kqFirstName(profile) {
  var people = (profile && Array.isArray(profile.people)) ? profile.people : [];
  for (var i = 0; i < people.length; i++) {
    var p = people[i];
    if (!p) continue;
    var name = String(p.name || '');
    if (!KQ_ROLE_OK.test(String(p.role || ''))) continue;
    if (!/^[A-Z][a-z]{1,15} [A-Z][a-z]{1,20}$/.test(name)) continue;
    if (KQ_NAME_BLOCK.test(name)) continue;
    return name.split(' ')[0];
  }
  return null;
}

// One verifiable detail about them, drawn from their own website.
// Returns null rather than inventing anything.
function kqObservation(r, profile) {
  var desc = kqClean(profile && profile.description);
  var title = kqClean(profile && profile.title);
  var name = kqClean(r.business_name);
  var suburb = kqSuburb(r);

  // Prefer their own words, trimmed to one clean clause. Quoting them back is
  // the cheapest possible proof that this was not a blast.
  if (desc && desc.length > 25 && desc.toLowerCase().indexOf('lorem') === -1) {
    var snip = desc.slice(0, 95);
    if (desc.length > 95) {
      var cut = snip.lastIndexOf(' ');
      snip = (cut > 40 ? snip.slice(0, cut) : snip).replace(/[,;:\-\s]+$/, '');
    }
    // Neutral lead-in: their description may start with a verb ("Discover..."),
    // so anything of the form "you are <desc>" reads broken.
    return 'Saw on your site - "' + snip + '".';
  }
  // Otherwise anchor on something factual: their site title or their suburb.
  if (title && title.length > 8 && title.toLowerCase().indexOf(name.toLowerCase()) === -1) {
    return 'Came across ' + kqShortName(name) + ' looking at ' + (suburb || 'Adelaide') + ' businesses.';
  }
  if (suburb) return 'I am working through ' + suburb + ' at the moment and ' + kqShortName(name) + ' came up.';
  return null;
}

/*
 * kqCompose(row) -> { subject, body, variant }
 * row: { id, business_name, address, suburb, segment_code, qualification_score, profile }
 */
function kqCompose(r) {
  var profile = r.profile || {};
  var play = PLAYBOOK[r.segment_code] || DEFAULT_PLAY;
  var name = kqClean(r.business_name);
  var shortName = kqShortName(name);
  var suburb = kqSuburb(r);
  var subLoc = kqSpecificSuburb(r);
  var first = kqFirstName(profile);
  var v = kqVariant(r.id, 4);
  var score = Number(r.qualification_score || 0);

  // --- subject: short, specific, no company-name stuffing, no "(offer)" ---
  // Four families so one domain never sees the same shape twice. The old
  // "{Business} - cleaning support in {Suburb} (quick quote offer)" was a
  // visible mail-merge; these are shaped like something a person typed.
  var subjects = [
    'Quick question about ' + (subLoc || shortName),
    play.job.charAt(0).toUpperCase() + play.job.slice(1) + ' for ' + shortName,
    (first ? first + ', quick one' : 'Quick one') + ' about ' + (subLoc ? 'your ' + subLoc + ' site' : shortName),
    'Cleaning quote for ' + shortName + '?'
  ];
  var subject = subjects[v].slice(0, 72);

  // --- greeting ---
  var greeting = first ? ('Hi ' + first + ',') : (shortName ? ('Hi ' + shortName + ' team,') : 'Hello,');

  // --- opening: about them, not about us ---
  var opener = kqObservation(r, profile);
  if (!opener) {
    opener = 'I look after the commercial side at ' + KQ.company + ' here in Adelaide.';
  }

  // --- the offer: their job, their pain, our specific proof ---
  // One sentence of context, one of proof. Anything longer stops being read.
  var offerVariants = [
    'We do ' + play.job + ' for Adelaide businesses - the thing clients raise first is ' + play.pain + '. ' + play.line,
    play.line + ' That is most of what we do here: ' + play.job + ' for Adelaide businesses.',
    'We handle ' + play.job + '. ' + play.line,
    'If ' + play.pain + ' sounds familiar, that is the bit we fix. ' + play.line
  ];
  var offer = offerVariants[v];

  // --- CTA: a yes/no question, not a request for time ---
  // "Do you have 10 minutes" asks for a commitment before any value has been
  // given. A one-page price is a much cheaper yes.
  var asks = [
    'Want me to put a fixed price together for ' + play.ask + '? No obligation - if the number does not work, that is a fair answer.',
    'Happy to price up ' + play.ask + ' so you have something to compare against. Worth sending through?',
    'Should I send a fixed quote for ' + play.ask + '? Takes me ten minutes.',
    'Want a price for ' + play.ask + '? I will keep it to one page.'
  ];
  var ask = asks[v];

  if (score >= 85) {
    ask = 'Want me to put a fixed price together for ' + play.ask + '? I can have it over today, and if the number does not work that is a fair answer.';
  } else if (score && score < 65) {
    ask = 'Not asking for a meeting - happy to send a one-page price for ' + play.ask + ' so it is on file for when the timing suits.';
  }

  // --- trust: concrete and checkable, no adjectives ---
  var trust = 'Adelaide-based, public liability cover, every cleaner police-checked - documentation on request.';

  var signoff = 'Thanks,\n' + KQ.sender + '\n' + KQ.company + '\n' + KQ.phone;

  // Only worth the extra lines when we could not find a named contact - it is
  // a routing request, and it earns forwards to the person who actually buys.
  var ps = first ? '' : '\n\nP.S. If premises are not your area, a pointer to whoever looks after them would be appreciated.';

  var body = greeting + '\n\n' + opener + '\n\n' + offer + '\n\n' + ask + '\n\n' + trust + '\n\n' + signoff + ps;

  return { subject: subject, body: body, variant: v, play: play };
}
// ---------- end composer ----------
`;
