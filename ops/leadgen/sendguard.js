/*
 * sendguard.js — the send path's compliance and rendering layer (§5.1, §5.3).
 *
 * Australian Spam Act 2003 governs this. B2B cold email is lawful under
 * inferred consent where the address was conspicuously published in a business
 * context and the message is relevant to that person's role — and the sender
 * carries the burden of proof. So provenance is a hard gate, not a convention:
 * lead_contact.source_url is NOT NULL in the schema and re-checked here.
 *
 * Every function is pure. The guard returns a decision, the caller writes the
 * outreach_event row. Nothing here sends anything.
 */
module.exports.SENDGUARD_SRC = String.raw`
// ---------- KQuality send guard + renderer v1 ----------

/*
 * Strict variable resolver. A visible {{first_name}} or "Hi ," destroys the
 * whole program, so an unresolved or empty variable blocks the send instead of
 * rendering a blank. There is no "best effort" mode on purpose.
 */
var KQ_VAR_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

function kqgRender(template, vars) {
  var missing = {};
  var used = {};
  var out = String(template == null ? '' : template).replace(KQ_VAR_RE, function (_m, name) {
    used[name] = true;
    var v = vars ? vars[name] : undefined;
    if (v === undefined || v === null || String(v).trim() === '') {
      missing[name] = true;
      return '{{' + name + '}}';           // left visible so the guard can see it
    }
    return String(v).trim();
  });
  return { text: out, missing: Object.keys(missing), used: Object.keys(used) };
}

function kqgTemplateVars(template) {
  var out = {}, m;
  KQ_VAR_RE.lastIndex = 0;
  while ((m = KQ_VAR_RE.exec(String(template || ''))) !== null) out[m[1]] = true;
  return Object.keys(out);
}

/*
 * Sender identification block, required in every message by s.17 of the Act:
 * who sent it, and how to contact them. ABN and a real postal address are what
 * make it verifiable. Rendered as plain text — plain-text-weighted mail is also
 * what survives spam filtering best (§5.2).
 */
function kqgComplianceFooter(cfg) {
  cfg = cfg || {};
  var lines = [];
  lines.push('--');
  lines.push(cfg.sender_name || 'Michelle');
  lines.push(cfg.legal_entity || 'KQuality Cleaning Services');
  if (cfg.abn) lines.push('ABN ' + cfg.abn);
  if (cfg.postal_address) lines.push(cfg.postal_address);
  if (cfg.phone) lines.push(cfg.phone);
  lines.push('');
  lines.push('You received this because your role and business contact details are');
  lines.push('published at ' + (cfg.source_url || 'your website') + '.');
  lines.push('Unsubscribe: ' + cfg.unsubscribe_url);
  return lines.join('\n');
}

// The footer's required pieces, checked at render time so a half-configured
// system cannot send a non-compliant email.
function kqgFooterComplete(cfg) {
  var missing = [];
  if (!cfg || !cfg.legal_entity) missing.push('legal_entity');
  if (!cfg || !cfg.abn) missing.push('abn');
  if (!cfg || !cfg.postal_address) missing.push('postal_address');
  if (!cfg || !cfg.phone) missing.push('phone');
  if (!cfg || !cfg.unsubscribe_url) missing.push('unsubscribe_url');
  if (!cfg || !cfg.source_url) missing.push('source_url');
  return missing;
}

function kqgUnsubscribeUrl(baseUrl, token) {
  if (!baseUrl || !token) return null;
  return String(baseUrl).replace(/\/+$/, '') + '?t=' + encodeURIComponent(token);
}

/*
 * kqgPreSend(ctx) -> { allowed, reasons[], rendered }
 *
 * ctx: {
 *   contact:  { id, email, email_type, email_verification_status, source_url,
 *               discovered_at, title_rank, unsubscribe_token },
 *   lead:     { id, business_name, do_not_contact, excluded_from_outreach,
 *               is_competitor },
 *   suppressed: bool,              // leads.is_suppressed(), resolved by SQL
 *   mailbox:  { id, address, status, sent_today, daily_cap },
 *   guessed_sent_today: int, sends_today: int, guessed_share_cap: 0.10,
 *   template: { subject, body }, vars: {...}, footer: {...},
 *   now_local: '2026-08-07T09:14:00+09:30', in_send_window: bool
 * }
 *
 * Every rejection is a named reason, because "blocked" with no reason is what
 * makes a send pipeline impossible to debug.
 */
function kqgPreSend(ctx) {
  ctx = ctx || {};
  var reasons = [];
  var c = ctx.contact || {};
  var lead = ctx.lead || {};
  var mb = ctx.mailbox || {};

  // --- 1. suppression, unconditional and first ---
  if (ctx.suppressed) reasons.push('suppressed');
  if (lead.do_not_contact) reasons.push('do_not_contact');
  if (lead.excluded_from_outreach) reasons.push('excluded_from_outreach');
  if (lead.is_competitor) reasons.push('cleaning_competitor');

  // --- 2. consent provenance (§5.1.1) ---
  if (!c.source_url || String(c.source_url).trim() === '') reasons.push('no_source_url');
  if (!c.discovered_at) reasons.push('no_discovered_at');

  // --- 3. address quality ---
  if (!c.email || String(c.email).indexOf('@') < 1) reasons.push('no_email');
  if (c.email_type === 'guessed' && c.email_verification_status !== 'valid') {
    reasons.push('guessed_unverified');
  }
  if (c.email_verification_status === 'invalid') reasons.push('email_invalid');
  if (c.email_verification_status === 'disposable') reasons.push('email_disposable');

  // Guessed addresses are capped at a share of daily volume even when verified,
  // because a run of them is what turns a clean domain into a filtered one.
  if (c.email_type === 'guessed') {
    var cap = Number(ctx.guessed_share_cap == null ? 0.10 : ctx.guessed_share_cap);
    var sends = Number(ctx.sends_today || 0);
    var guessed = Number(ctx.guessed_sent_today || 0);
    if (sends > 0 && (guessed + 1) / (sends + 1) > cap) reasons.push('guessed_share_exceeded');
  }

  // --- 4. mailbox state (§5.2) ---
  if (!mb.id) reasons.push('no_mailbox');
  if (mb.status === 'paused') reasons.push('mailbox_paused');
  if (Number(mb.sent_today || 0) >= Number(mb.daily_cap || 0)) reasons.push('mailbox_cap_reached');

  // --- 5. send window ---
  if (ctx.in_send_window === false) reasons.push('outside_send_window');

  // --- 6. render, then require every variable to have resolved ---
  var tpl = ctx.template || {};
  var subj = kqgRender(tpl.subject, ctx.vars);
  var body = kqgRender(tpl.body, ctx.vars);
  if (subj.missing.length) reasons.push('unresolved_subject_vars:' + subj.missing.join(','));
  if (body.missing.length) reasons.push('unresolved_body_vars:' + body.missing.join(','));

  // --- 7. compliance footer must be complete ---
  var footerCfg = ctx.footer || {};
  if (!footerCfg.source_url) footerCfg.source_url = c.source_url;
  if (!footerCfg.unsubscribe_url && footerCfg.unsubscribe_base_url) {
    footerCfg.unsubscribe_url = kqgUnsubscribeUrl(footerCfg.unsubscribe_base_url, c.unsubscribe_token);
  }
  var footerMissing = kqgFooterComplete(footerCfg);
  if (footerMissing.length) reasons.push('footer_incomplete:' + footerMissing.join(','));

  var fullBody = body.text + '\n\n' + kqgComplianceFooter(footerCfg);

  return {
    allowed: reasons.length === 0,
    reasons: reasons,
    rendered: { subject: subj.text, body: fullBody, body_only: body.text }
  };
}

/*
 * Copy linter, run when a template is saved (§5.3). These are not style
 * preferences — each one is a measured deliverability or reply-rate rule.
 */
var KQ_SPAM_WORDS = [
  'free', 'guarantee', 'guaranteed', 'cheapest', 'act now', 'limited offer',
  'limited time', 'click here', 'buy now', 'risk free', 'no obligation!',
  'special promotion', 'best price', 'lowest price', 'discount', 'save big',
  'urgent', 'winner', 'congratulations', 'cash', '100%'
];
var KQ_BANNED_OPENERS = [
  /^\s*(hi|hello|dear)[^\n]*\n+\s*i hope (this|you)/i,
  /i hope this (email|message) finds you well/i,
  /^\s*my name is\b/im,
  /\bmy name is [a-z]+ and i('| a)m from\b/i
];

function kqgLint(subject, body, opts) {
  opts = opts || {};
  var errors = [];
  var s = String(subject == null ? '' : subject);
  var b = String(body == null ? '' : body);
  var stepNo = Number(opts.step_no || 1);

  // --- subject ---
  if (s.trim().length === 0) errors.push('subject_empty');
  if (s.length > 45) errors.push('subject_too_long:' + s.length + '>45');
  if (/!/.test(s)) errors.push('subject_has_exclamation');
  if (/\$\$|\$\$\$/.test(s)) errors.push('subject_has_money_symbols');
  // ALL CAPS: any word of 3+ letters entirely uppercase, ignoring acronyms we
  // legitimately use (NDIS, ACECQA, WHS, IPC, SA).
  var capWords = s.replace(/\b(NDIS|ACECQA|NSQHS|RACGP|WHS|IPC|SA|AGM|SIL|OSHC)\b/g, '')
                  .match(/\b[A-Z]{3,}\b/g);
  if (capWords && capWords.length) errors.push('subject_all_caps:' + capWords.join(','));
  var sl = s.toLowerCase();
  for (var i = 0; i < KQ_SPAM_WORDS.length; i++) {
    if (sl.indexOf(KQ_SPAM_WORDS[i]) !== -1) errors.push('subject_spam_word:' + KQ_SPAM_WORDS[i]);
  }

  // --- body ---
  if (b.trim().length === 0) errors.push('body_empty');
  for (var o = 0; o < KQ_BANNED_OPENERS.length; o++) {
    if (KQ_BANNED_OPENERS[o].test(b)) errors.push('banned_opener');
  }
  // Word budget applies to the message, not the compliance footer.
  var words = b.replace(/^--[\s\S]*$/m, '').trim().split(/\s+/).filter(Boolean).length;
  var maxWords = Number(opts.max_words || 90);
  if (words > maxWords) errors.push('too_long:' + words + '>' + maxWords);

  // One CTA, and it has to be a question. "Book now" asks for a commitment
  // before any value has been given; "Worth a look?" costs the reader nothing.
  var questions = (b.match(/\?/g) || []).length;
  if (questions === 0) errors.push('no_question_cta');
  if (questions > 2) errors.push('too_many_questions:' + questions);
  if (/\b(book now|call now|sign up now|buy now|act now|don't wait)\b/i.test(b)) {
    errors.push('demand_cta');
  }

  // Email 1 must carry a lead-specific token beyond the name, or it is a blast.
  if (stepNo === 1) {
    var tokens = kqgTemplateVars(b).filter(function (v) {
      return ['suburb', 'observation', 'site_count', 'building_name', 'segment_job',
              'segment_pain', 'compliance_hook'].indexOf(v) !== -1;
    });
    if (!tokens.length) errors.push('email1_no_specific_token');
  }

  // Link discipline: one link in email 1 (§5.2), none of them tracking-heavy.
  var links = (b.match(/https?:\/\/\S+/g) || []).length;
  if (stepNo === 1 && links > 1) errors.push('email1_too_many_links:' + links);

  if (stepNo <= 3 && opts.has_attachment) errors.push('attachment_not_allowed_before_step_4');

  // Australian English. These are the American spellings that actually appear
  // in cleaning copy.
  var usSpellings = b.match(/\b(organiz\w+|realiz\w+|recogniz\w+|program(?!me)\w*me\b|center|centers|licen[sc]e plate|labor\b|favorite|color|behavior|specialize\w*|customiz\w+)\b/gi);
  if (usSpellings && usSpellings.length) errors.push('us_spelling:' + usSpellings.slice(0, 3).join(','));

  return { ok: errors.length === 0, errors: errors, words: words, links: links };
}

/*
 * Deterministic variant assignment (§5.5). hash(lead_id + step_no) % n means a
 * lead always lands in the same arm, so a re-run cannot reshuffle a live test.
 */
function kqgVariantIndex(leadId, stepNo, n) {
  if (!n || n < 1) return 0;
  var s = String(leadId) + ':' + String(stepNo);
  var h = 2166136261;                          // FNV-1a, 32-bit
  for (var i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h % n;
}
// ---------- end send guard ----------
`;
