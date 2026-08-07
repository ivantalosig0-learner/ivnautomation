/*
 * replyclass.js — inbound reply classification and referral extraction (§5.4).
 *
 * Two things here earn money. The first is wrong_person: a gatekeeper who
 * names the right person has just done the enrichment work for us, and that
 * referral opener converts better than any cold first touch. The second is
 * simply detecting a positive reply fast — time-to-first-human-response is the
 * highest-leverage variable in the whole system, so this feeds an alert, not
 * a report.
 *
 * Order matters: bounce and out-of-office are tested before sentiment, because
 * an auto-reply saying "I will respond on my return" is not interest.
 */
module.exports.REPLYCLASS_SRC = String.raw`
// ---------- KQuality reply classifier v1 ----------

var KQ_RC = {
  bounce: [
    /\b(delivery (status notification|has failed|failure)|undeliverable|returned to sender)\b/i,
    /\b(mailbox (is )?(full|unavailable|does not exist)|user unknown|recipient (address )?rejected)\b/i,
    /\b(550|551|552|553|554)[ -]\d?\.?\d?\.?\d?\b/,
    /\bpostmaster@/i,
    /\bmail delivery (subsystem|system)\b/i
  ],
  ooo: [
    /\b(out of (the )?office|on (annual )?leave|away from (my|the) (desk|office))\b/i,
    /\b(auto(matic)?[- ]?(reply|response|generated))\b/i,
    /\bi (am|'m) currently (away|on leave|out)\b/i,
    /\bwill (be )?(return|be back)(ing)? (on|to the office)\b/i,
    /\bmaternity leave|parental leave|long service leave\b/i
  ],
  unsubscribe: [
    /\b(unsubscribe|remove me|take me off|opt.?out|stop (emailing|contacting) me)\b/i,
    /\bdo not (contact|email) (me|us) again\b/i,
    /\b(delete|remove) (my|our) (details|email|address) from your (list|database)\b/i
  ],
  wrong_person: [
    /\b(wrong person|not (the right|my) (person|area|department)|i do not (handle|look after|manage))\b/i,
    /\b(you (should|would be better|need to) (speak|talk|contact))\b/i,
    /\b(please (contact|speak to|direct this to)|best (person|contact) (is|would be))\b/i,
    /\b(forward(ing|ed)? (this|your email) (on )?to)\b/i,
    /\b(that would be|try) [A-Z][a-z]+\b/,
    /\bi (have )?(passed|forwarded) (this|it) on\b/i,
    /\bno longer (work|with)\b/i
  ],
  not_interested: [
    /\b(not interested|no thanks|no thank you|we are (all )?(sorted|covered|fine))\b/i,
    /\b(happy with (our|the) (current|existing)|already have a cleaner|we have a (contract|provider))\b/i,
    /\b(please stop|not for us|we will pass|we'?ll pass)\b/i,
    /\bno (need|requirement) (for|at) (this|the moment)\b/i
  ],
  not_now: [
    /\b(not (right now|at the moment|currently)|maybe (later|next)|check back)\b/i,
    /\b(revisit|circle back|touch base|follow up) (in|next|after|around)\b/i,
    /\b(budget|contract) (is|runs) (locked|until|through|to)\b/i,
    /\b(our contract (expires|ends|is up))\b/i,
    /\b(try (me|us) (again )?(in|next|after))\b/i
  ],
  positive: [
    /\b(yes|sure|sounds good|happy to|interested|keen)\b/i,
    /\b(send (it |that |the quote|through|me)|please send|go ahead)\b/i,
    /\b(what (are|would) your (rates|prices)|how much|can you quote|quote for)\b/i,
    /\b(book|arrange|organise|set up) (a|the)? ?(time|call|walkthrough|inspection|visit|meeting)\b/i,
    /\b(when (can|could) you (come|visit|attend))\b/i,
    /\b(give me a call|call me|phone me|ring me)\b/i
  ]
};

var KQ_BOOKED = [
  /\b(booked|confirmed|see you (on|at)|that time works|works for (me|us))\b/i,
  /\b(walkthrough|site (visit|inspection)) (is )?(booked|confirmed|scheduled)\b/i
];

function kqrcMatch(list, text) {
  for (var i = 0; i < list.length; i++) if (list[i].test(text)) return true;
  return false;
}

/*
 * Strip the quoted original before classifying. Our own email contains the
 * word "quote" and a question mark; leaving it in makes every reply look
 * positive. This is the single most common way a reply classifier goes wrong.
 */
function kqrcStripQuoted(body) {
  var t = String(body == null ? '' : body);
  var cuts = [
    /\n\s*On .{0,80}wrote:\s*\n/i,
    /\n\s*-{2,}\s*Original Message\s*-{2,}/i,
    /\n\s*From:\s.+\n\s*Sent:\s/i,
    /\n\s*_{10,}\s*\n/,
    /\n\s*>{1,}\s?/
  ];
  var end = t.length;
  for (var i = 0; i < cuts.length; i++) {
    var m = cuts[i].exec(t);
    if (m && m.index < end) end = m.index;
  }
  return t.slice(0, end).trim();
}

/*
 * kqrcClassify(msg) -> { classification, confidence, referral, followup_date, booked }
 * msg: { subject, body_text, sender, headers }
 */
function kqrcClassify(msg) {
  msg = msg || {};
  var subject = String(msg.subject || '');
  var raw = String(msg.body_text || '');
  var body = kqrcStripQuoted(raw);
  var hay = (subject + '\n' + body).replace(/\s+/g, ' ').trim();
  var headers = msg.headers || {};

  // Headers are decisive when present, so they are tested before any text.
  if (headers['auto-submitted'] && String(headers['auto-submitted']).toLowerCase() !== 'no') {
    if (kqrcMatch(KQ_RC.bounce, hay)) return kqrcResult('bounce', 0.95, msg, body);
    return kqrcResult('ooo', 0.90, msg, body);
  }
  if (headers['x-autoreply'] || headers['x-autorespond'] || headers['precedence'] === 'auto_reply') {
    return kqrcResult('ooo', 0.90, msg, body);
  }
  if (/mailer-daemon|postmaster/i.test(String(msg.sender || ''))) {
    return kqrcResult('bounce', 0.95, msg, body);
  }

  if (kqrcMatch(KQ_RC.bounce, hay))         return kqrcResult('bounce', 0.90, msg, body);
  if (kqrcMatch(KQ_RC.ooo, hay))            return kqrcResult('ooo', 0.85, msg, body);
  if (kqrcMatch(KQ_RC.unsubscribe, hay))    return kqrcResult('unsubscribe', 0.92, msg, body);
  if (kqrcMatch(KQ_RC.wrong_person, hay))   return kqrcResult('wrong_person', 0.80, msg, body);
  if (kqrcMatch(KQ_RC.not_interested, hay)) return kqrcResult('not_interested', 0.85, msg, body);
  if (kqrcMatch(KQ_RC.not_now, hay))        return kqrcResult('not_now', 0.80, msg, body);
  if (kqrcMatch(KQ_RC.positive, hay))       return kqrcResult('positive', 0.75, msg, body);

  // A short human-written reply with no negative marker is worth a human's
  // eyes. Defaulting to 'unknown' and alerting beats guessing wrong either way.
  return kqrcResult('unknown', 0.30, msg, body);
}

function kqrcResult(cls, conf, msg, body) {
  var out = {
    classification: cls,
    confidence: conf,
    referral: null,
    followup_date: null,
    booked: false
  };
  if (cls === 'wrong_person') out.referral = kqrcExtractReferral(body, msg);
  if (cls === 'not_now') out.followup_date = kqrcExtractDate(body);
  if (cls === 'positive') out.booked = kqrcMatch(KQ_BOOKED, body);
  return out;
}

/*
 * Pull the referred person out of a "you want Sarah in facilities" reply.
 * An address in the body is the strongest signal; otherwise a capitalised name
 * near a routing verb. Never returns one of our own addresses.
 */
var KQ_EMAIL_IN_TEXT = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;
var KQ_ROUTE_VERB = /\b(contact|speak to|talk to|email|try|ask for|that would be|best (person|contact) is|forwarded (this )?to|passed (this )?on to|reach out to)\b/i;
var KQ_NAME_IN_TEXT = /\b([A-Z][a-z]{1,15}(?: [A-Z][a-z]{1,20})?)\b/g;

function kqrcExtractReferral(body, msg) {
  var t = String(body || '');
  var ours = String((msg && msg.our_domain) || 'kqualitycleaningservices.com.au').toLowerCase();

  var email = null;
  var found = t.match(KQ_EMAIL_IN_TEXT) || [];
  for (var i = 0; i < found.length; i++) {
    var e = found[i].toLowerCase();
    if (e.indexOf('@' + ours) !== -1) continue;
    if (/^(no-?reply|postmaster|mailer-daemon)@/.test(e)) continue;
    email = e; break;
  }

  var name = null, title = null;
  var vm = KQ_ROUTE_VERB.exec(t);
  if (vm) {
    var after = t.slice(vm.index, vm.index + 160);
    KQ_NAME_IN_TEXT.lastIndex = 0;
    var nm;
    while ((nm = KQ_NAME_IN_TEXT.exec(after)) !== null) {
      var cand = nm[1];
      if (/^(Contact|Speak|Talk|Email|Try|Ask|That|Best|Please|Thanks|Regards|Kind|Hi|Hello|Dear|Our|The|We|I)$/.test(cand)) continue;
      name = cand; break;
    }
    var tm = /\b(facilit(y|ies)|operations?|property|practice|business|site|venue|office|procurement|contracts?|maintenance)\b[^.,;\n]{0,20}(manager|coordinator|officer|lead)?/i.exec(after);
    if (tm) title = tm[0].replace(/\s+/g, ' ').trim();
  }
  if (!name && !email) return null;
  return { full_name: name, job_title: title, email: email, source: 'reply_referral' };
}

/*
 * "check back in March", "our contract runs to June 2027", "try us in 3 months".
 * Returns an ISO date to requeue on, or null.
 */
var KQ_MONTH_NAMES = ['january','february','march','april','may','june','july',
                      'august','september','october','november','december'];

function kqrcExtractDate(body) {
  var t = String(body || '').toLowerCase();
  var now = new Date();

  var rel = /\b(?:in|after)\s+(a|one|two|three|four|five|six|nine|twelve|\d{1,2})\s+(week|month|year)s?\b/.exec(t);
  if (rel) {
    var words = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, nine: 9, twelve: 12 };
    var n = words[rel[1]] != null ? words[rel[1]] : parseInt(rel[1], 10);
    if (n > 0 && n < 60) {
      var d = new Date(now.getTime());
      if (rel[2] === 'week') d.setUTCDate(d.getUTCDate() + n * 7);
      else if (rel[2] === 'month') d.setUTCMonth(d.getUTCMonth() + n);
      else d.setUTCFullYear(d.getUTCFullYear() + n);
      return d.toISOString().slice(0, 10);
    }
  }

  var explicit = /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/.exec(t);
  if (explicit) {
    var yy = Number(explicit[3]);
    if (yy < 100) yy += 2000;
    var iso = yy + '-' + kqrcPad(Number(explicit[2])) + '-' + kqrcPad(Number(explicit[1]));
    if (!isNaN(Date.parse(iso))) return iso;
  }

  for (var m = 0; m < KQ_MONTH_NAMES.length; m++) {
    var re = new RegExp('\\b' + KQ_MONTH_NAMES[m].slice(0, 3) + '[a-z]*\\b(?:\\s+(\\d{4}))?');
    var mm = re.exec(t);
    if (!mm) continue;
    var year = mm[1] ? Number(mm[1]) : now.getUTCFullYear();
    // A bare month already past this year means next year.
    if (!mm[1] && m < now.getUTCMonth()) year += 1;
    return year + '-' + kqrcPad(m + 1) + '-01';
  }
  // Named but undated: three months is the shortest interval that does not
  // read as ignoring what they said.
  var fallback = new Date(now.getTime());
  fallback.setUTCMonth(fallback.getUTCMonth() + 3);
  return fallback.toISOString().slice(0, 10);
}

function kqrcPad(n) { return (n < 10 ? '0' : '') + n; }

// What the sequence should do next, given a classification (§5.4).
function kqrcAction(cls) {
  switch (cls) {
    case 'positive':       return { stop_sequence: true,  suppress: false, alert: true,  crm_stage: 'replied' };
    case 'wrong_person':   return { stop_sequence: true,  suppress: false, alert: true,  crm_stage: 'replied', restart_on_referral: true };
    case 'not_now':        return { stop_sequence: true,  suppress: false, alert: false, crm_stage: 'replied', requeue: true };
    case 'not_interested': return { stop_sequence: true,  suppress: true,  alert: false, crm_stage: 'lost' };
    case 'unsubscribe':    return { stop_sequence: true,  suppress: true,  alert: false, crm_stage: 'lost' };
    case 'bounce':         return { stop_sequence: true,  suppress: true,  alert: false, crm_stage: null };
    case 'ooo':            return { stop_sequence: false, suppress: false, alert: false, crm_stage: null };
    default:               return { stop_sequence: true,  suppress: false, alert: true,  crm_stage: 'replied' };
  }
}
// ---------- end reply classifier ----------
`;
