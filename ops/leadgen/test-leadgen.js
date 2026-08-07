#!/usr/bin/env node
/*
 * test-leadgen.js — validation for the decision-maker targeting work (§7).
 * Runs inside the n8n container, which is the only node runtime on this box:
 *
 *   docker cp ops/leadgen ivnautomation-n8n:/tmp/lg
 *   docker exec -w /tmp/lg ivnautomation-n8n node test-leadgen.js
 *
 * Pure: no DB, no network. Proves the guards actually block, rather than
 * asserting that they exist.
 */
const vm = require('vm');

const SRC =
  require('./contacts.js').CONTACTS_SRC +
  require('./scoring.js').SCORING_SRC +
  require('./sendguard.js').SENDGUARD_SRC +
  require('./deliverability.js').DELIVERABILITY_SRC +
  require('./replyclass.js').REPLYCLASS_SRC +
  require('./registries.js').REGISTRIES_SRC;

const ctx = vm.createContext({ Intl, Date, Math, JSON, console, RegExp, Number, String, Object, Array, isNaN, parseInt, encodeURIComponent });
vm.runInContext(SRC, ctx);
const run = (expr) => vm.runInContext(expr, ctx);
const call = (fn, ...args) => {
  ctx.__args = args;
  return vm.runInContext(`${fn}.apply(null, __args)`, ctx);
};

let pass = 0, fail = 0;
function t(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); }
}
function section(s) { console.log('\n== ' + s + ' =='); }

// ---------------------------------------------------------------------
section('title ranking (§4.3)');
// ---------------------------------------------------------------------
t('Facilities Manager = 1',    call('kqcTitleRank', 'Facilities Manager') === 1);
t('Strata Manager = 1',        call('kqcTitleRank', 'Strata Manager') === 1);
t('Practice Manager = 1',      call('kqcTitleRank', 'Practice Manager') === 1);
t('Nominated Supervisor = 1',  call('kqcTitleRank', 'Nominated Supervisor') === 1);
t('Managing Director = 2',     call('kqcTitleRank', 'Managing Director') === 2);
t('Procurement Officer = 2',   call('kqcTitleRank', 'Procurement Officer') === 2);
t('CEO = 3',                   call('kqcTitleRank', 'Chief Executive Officer') === 3);
t('Office Manager = 4',        call('kqcTitleRank', 'Office Manager') === 4);
t('empty title = 5',           call('kqcTitleRank', '') === 5);
t('FM outranks CEO',           call('kqcTitleRank', 'Facilities Manager') < call('kqcTitleRank', 'CEO'));
t('segment list lifts to 1',   call('kqcTitleRankFor', 'Hotel Services Manager', ['hotel services manager']) === 1);

// ---------------------------------------------------------------------
section('person-name validation — the junk that polluted people[]');
// ---------------------------------------------------------------------
t('accepts Matt Smith',        call('kqcValidPersonName', 'Matt Smith') === true);
t('accepts Oren Klemich',      call('kqcValidPersonName', 'Oren Klemich') === true);
t('rejects Owner Occupier',    call('kqcValidPersonName', 'Owner Occupier') === false);
t('rejects Assistant Assistant', call('kqcValidPersonName', 'Assistant Assistant') === false);
t('rejects Investor Guide',    call('kqcValidPersonName', 'Investor Guide') === false);
t('rejects Angelique Operations', call('kqcValidPersonName', 'Angelique Operations') === false);
t('rejects Member Success',    call('kqcValidPersonName', 'Member Success') === false);
t('rejects Licensed Agent',    call('kqcValidPersonName', 'Licensed Agent') === false);
t('rejects Senior Property',   call('kqcValidPersonName', 'Senior Property') === false);
t('rejects Smith Pty Ltd',     call('kqcValidPersonName', 'Smith Pty Ltd') === false);
t('rejects single word',       call('kqcValidPersonName', 'Michelle') === false);

// ---------------------------------------------------------------------
section('email pattern learning and guessing (§4.4)');
// ---------------------------------------------------------------------
t('no pattern from 1 sample', call('kqcLearnEmailPattern', [
  { email: 'jane.doe@acme.com.au', name: 'Jane Doe' }]) === null);
t('first.last from 2 samples', call('kqcLearnEmailPattern', [
  { email: 'jane.doe@acme.com.au', name: 'Jane Doe' },
  { email: 'bob.lee@acme.com.au',  name: 'Bob Lee' }]) === 'first.last');
t('flast detected', call('kqcLearnEmailPattern', [
  { email: 'jdoe@acme.com.au', name: 'Jane Doe' },
  { email: 'blee@acme.com.au', name: 'Bob Lee' }]) === 'flast');
t('role addresses do not vote', call('kqcLearnEmailPattern', [
  { email: 'info@acme.com.au',     name: 'Jane Doe' },
  { email: 'jane.doe@acme.com.au', name: 'Jane Doe' }]) === null);
t('split vote yields no pattern', call('kqcLearnEmailPattern', [
  { email: 'jane.doe@acme.com.au', name: 'Jane Doe' },
  { email: 'blee@acme.com.au',     name: 'Bob Lee' },
  { email: 'sam@acme.com.au',      name: 'Sam Ray' }]) === null);
t('builds first.last', call('kqcBuildEmail', 'first.last', 'Sarah Nguyen', 'acme.com.au') === 'sarah.nguyen@acme.com.au');
t('builds flast',      call('kqcBuildEmail', 'flast', 'Sarah Nguyen', 'acme.com.au') === 'snguyen@acme.com.au');
t('info@ is a role address',   call('kqcIsRoleAddress', 'info@acme.com.au') === true);
t('sarah@ is not',             call('kqcIsRoleAddress', 'sarah@acme.com.au') === false);
t('disposable detected',       call('kqcIsDisposable', 'x@mailinator.com') === true);

// ---------------------------------------------------------------------
section('Tier A extraction');
// ---------------------------------------------------------------------
const JSONLD_PAGE = `<html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization",
"name":"Adelaide Facility Group","employee":[
 {"@type":"Person","name":"Rachel Ashby","jobTitle":"Facilities Manager","email":"rachel.ashby@afg.com.au"},
 {"@type":"Person","name":"Tom Brennan","jobTitle":"Building Manager","email":"tom.brennan@afg.com.au"}]}</script>
</head><body><a href="mailto:info@afg.com.au">Contact us</a></body></html>`;
const jl = call('kqcExtractContacts', JSONLD_PAGE, 'https://afg.com.au/about', { segmentTitles: [] });
t('json-ld finds 2 people', jl.contacts.length === 2, jl.contacts.map(c => c.full_name));
t('json-ld ranks FM as 1', jl.contacts[0].title_rank === 1, jl.contacts[0]);
t('json-ld learns first.last', jl.pattern === 'first.last', jl.pattern);
t('json-ld collects role address', jl.emails.indexOf('info@afg.com.au') !== -1, jl.emails);
t('stop condition satisfied', call('kqcSatisfied', jl.contacts) === true);

const TEAMCARD_PAGE = `<html><body><div class="team">
<h3>Priya Raman</h3><p>Practice Manager</p>
<h3>Angelique</h3><p>Operations Manager</p>
<h3>Owner Occupier</h3><p>Owner</p>
</div></body></html>`;
const tc = call('kqcExtractContacts', TEAMCARD_PAGE, 'https://clinic.com.au/team', { segmentTitles: [] });
t('team card finds the real person', tc.contacts.length === 1 && tc.contacts[0].full_name === 'Priya Raman',
  tc.contacts.map(c => c.full_name));
t('team card rejects the heading artefacts', tc.contacts.every(c => c.full_name !== 'Owner Occupier'));
t('no pattern without emails', tc.pattern === null);
t('not satisfied without an email', call('kqcSatisfied', tc.contacts) === false);

// ---------------------------------------------------------------------
section('lead score (§4.5)');
// ---------------------------------------------------------------------
const perfect = call('kqsScore', {
  contacts: [{ title_rank: 1, email: 'a@b.com.au', email_type: 'personal', email_verification_status: 'valid' }],
  segment_code: 'AGED_CARE', segment_confidence: 0.95,
  signals: [{ signal_type: 'contract_expiry', expires_at: new Date(Date.now() + 60 * 864e5).toISOString() }],
  postcode: '5000', site_count_estimate: 12, employee_band: '50-199'
});
t('perfect lead scores 100', perfect.score === 100, perfect.breakdown);
t('perfect lead not needing enrichment', perfect.needs_enrichment === false);
t('estimated value present', perfect.estimated_monthly_value > 0, perfect.estimated_monthly_value);

const roleOnly = call('kqsScore', {
  contacts: [{ title_rank: 5, email: 'info@b.com.au', email_type: 'role', email_verification_status: 'unverified' }],
  segment_code: 'RETAIL_OFFICE', segment_confidence: 0.78, signals: [], postcode: '5169'
});
t('rank-5-only flagged needs_enrichment', roleOnly.needs_enrichment === true);
t('rank-5-only scores low', roleOnly.score < 30, roleOnly.score);
t('breakdown explains every component',
  ['decision_maker','segment','trigger','service_fit','proximity','multi_site']
    .every(k => roleOnly.breakdown[k] && typeof roleOnly.breakdown[k].points === 'number'));
t('expired trigger scores 0',
  call('kqsScore', { contacts: [], segment_code: 'EDU', segment_confidence: 0.9,
    signals: [{ signal_type: 'contract_expiry', expires_at: new Date(Date.now() - 864e5).toISOString() }],
    postcode: '5000' }).breakdown.trigger.points === 0);

// ---------------------------------------------------------------------
section('classifier (§3.2)');
// ---------------------------------------------------------------------
t('registry hit wins', call('kqsClassify', { registry: { ndis: true }, business_name: 'Anything' }).code === 'NDIS');
t('registry confidence 0.98', call('kqsClassify', { registry: { acecqa: true } }).confidence === 0.98);
t('places type beats keyword',
  call('kqsClassify', { places_types: ['dentist'], business_name: 'Warehouse Holdings' }).code === 'HEALTH');
t('keyword strata', call('kqsClassify', { business_name: 'Eastside Strata Management' }).code === 'STRATA');
t('keyword aged care', call('kqsClassify', { business_name: 'Rosewood Retirement Village' }).code === 'AGED_CARE');
t('legacy fallback used',
  call('kqsClassify', { business_name: 'Zzz', legacy_code: 'INDUSTRIAL', legacy_confidence: 0.9 }).code === 'INDUSTRIAL');
t('no match = UNCLASSIFIED', call('kqsClassify', { business_name: 'Zzz' }).code === 'UNCLASSIFIED');
t('llm parse extracts code', call('kqsParseLlm', 'The answer is HOSPITALITY.').code === 'HOSPITALITY');
t('llm garbage is UNCLASSIFIED', call('kqsParseLlm', 'I cannot tell').code === 'UNCLASSIFIED');

// ---------------------------------------------------------------------
section('pre-send guard (§7) — each block proved');
// ---------------------------------------------------------------------
const baseCtx = () => ({
  contact: { id: 1, email: 'rachel.ashby@afg.com.au', email_type: 'personal',
             email_verification_status: 'valid', source_url: 'https://afg.com.au/about',
             discovered_at: '2026-08-01T00:00:00Z', title_rank: 1, unsubscribe_token: 'tok123' },
  lead: { id: 9, business_name: 'AFG', do_not_contact: false, excluded_from_outreach: false, is_competitor: false },
  suppressed: false,
  mailbox: { id: 1, address: 'michelle@outreach.example', status: 'active', sent_today: 3, daily_cap: 40 },
  sends_today: 3, guessed_sent_today: 0, guessed_share_cap: 0.10,
  in_send_window: true,
  template: { subject: 'quick question about {{suburb}}', body: 'Hi {{first_name}},\n\n{{observation}}\n\nWorth a look?' },
  vars: { suburb: 'Kent Town', first_name: 'Rachel', observation: 'Saw the Kent Town site listing.' },
  footer: { legal_entity: 'KQuality Cleaning Services', abn: '12 345 678 901',
            postal_address: '1 Example St, Adelaide SA 5000', phone: '0439 489 630',
            unsubscribe_base_url: 'https://n8n.example/webhook/unsubscribe', sender_name: 'Michelle' }
});
const ok = call('kqgPreSend', baseCtx());
t('clean context is allowed', ok.allowed === true, ok.reasons);
t('footer carries ABN', ok.rendered.body.indexOf('ABN 12 345 678 901') !== -1);
t('footer carries address', ok.rendered.body.indexOf('1 Example St, Adelaide SA 5000') !== -1);
t('footer carries unsubscribe link', /Unsubscribe: https:\/\/n8n\.example\/webhook\/unsubscribe\?t=tok123/.test(ok.rendered.body));
t('footer carries provenance', ok.rendered.body.indexOf('https://afg.com.au/about') !== -1);
t('subject rendered', ok.rendered.subject === 'quick question about Kent Town', ok.rendered.subject);

const c1 = baseCtx(); c1.suppressed = true;
const r1 = call('kqgPreSend', c1);
t('(a) suppressed address blocked', r1.allowed === false && r1.reasons.indexOf('suppressed') !== -1, r1.reasons);

const c2 = baseCtx(); c2.contact.source_url = '';
const r2 = call('kqgPreSend', c2);
t('(b) missing source_url blocked', r2.allowed === false && r2.reasons.indexOf('no_source_url') !== -1, r2.reasons);

const c3 = baseCtx(); delete c3.vars.first_name;
const r3 = call('kqgPreSend', c3);
t('(c) unresolved variable blocked', r3.allowed === false &&
  r3.reasons.some(x => x.indexOf('unresolved_body_vars:first_name') === 0), r3.reasons);
t('(c) blank is never rendered', r3.rendered.body.indexOf('{{first_name}}') !== -1);

const c4 = baseCtx(); c4.mailbox.sent_today = 40;
const r4 = call('kqgPreSend', c4);
t('(d) mailbox over cap blocked', r4.allowed === false && r4.reasons.indexOf('mailbox_cap_reached') !== -1, r4.reasons);

const c5 = baseCtx(); c5.contact.email_type = 'guessed'; c5.contact.email_verification_status = 'unverified';
t('guessed + unverified blocked', call('kqgPreSend', c5).reasons.indexOf('guessed_unverified') !== -1);

const c6 = baseCtx(); c6.contact.email_type = 'guessed'; c6.contact.email_verification_status = 'valid';
c6.sends_today = 10; c6.guessed_sent_today = 2;
t('guessed share cap enforced', call('kqgPreSend', c6).reasons.indexOf('guessed_share_exceeded') !== -1);

const c7 = baseCtx(); c7.footer.abn = '';
t('missing ABN blocks the send', call('kqgPreSend', c7).reasons.some(x => x.indexOf('footer_incomplete') === 0));

const c8 = baseCtx(); c8.in_send_window = false;
t('outside send window blocked', call('kqgPreSend', c8).reasons.indexOf('outside_send_window') !== -1);

// ---------------------------------------------------------------------
section('copy linter (§5.3)');
// ---------------------------------------------------------------------
t('good copy passes',
  call('kqgLint', 'quick question about Kent Town',
    'Hi Rachel,\n\nSaw the {{suburb}} listing.\n\nWorth a fixed price for your site?', { step_no: 1, max_words: 90 }).ok === true,
  call('kqgLint', 'quick question about Kent Town',
    'Hi Rachel,\n\nSaw the {{suburb}} listing.\n\nWorth a fixed price for your site?', { step_no: 1, max_words: 90 }).errors);
t('long subject rejected',
  call('kqgLint', 'this subject line is far too long to survive a mobile preview pane', 'Body? {{suburb}}', { step_no: 1 })
    .errors.some(e => e.indexOf('subject_too_long') === 0));
t('exclamation rejected',
  call('kqgLint', 'quick question!', 'Body? {{suburb}}', { step_no: 1 })
    .errors.indexOf('subject_has_exclamation') !== -1);
t('spam word rejected',
  call('kqgLint', 'free quote today', 'Body? {{suburb}}', { step_no: 1 })
    .errors.some(e => e.indexOf('subject_spam_word') === 0));
t('ALL CAPS rejected',
  call('kqgLint', 'URGENT cleaning', 'Body? {{suburb}}', { step_no: 1 })
    .errors.some(e => e.indexOf('subject_all_caps') === 0));
t('NDIS acronym allowed',
  call('kqgLint', 'NDIS cleaning question', 'Body? {{suburb}}', { step_no: 1 })
    .errors.every(e => e.indexOf('subject_all_caps') !== 0));
t('no-question CTA rejected',
  call('kqgLint', 'a subject', 'Book a walkthrough. {{suburb}}', { step_no: 1 })
    .errors.indexOf('no_question_cta') !== -1);
t('demand CTA rejected',
  call('kqgLint', 'a subject', 'Book now? {{suburb}}', { step_no: 1 })
    .errors.indexOf('demand_cta') !== -1);
t('banned opener rejected',
  call('kqgLint', 'a subject', 'Hi,\n\nI hope this email finds you well. Worth a look? {{suburb}}', { step_no: 1 })
    .errors.indexOf('banned_opener') !== -1);
t('step 1 without a specific token rejected',
  call('kqgLint', 'a subject', 'Hi {{first_name}},\n\nWorth a look?', { step_no: 1 })
    .errors.indexOf('email1_no_specific_token') !== -1);
t('word budget enforced',
  call('kqgLint', 'a subject', 'word '.repeat(50) + '? {{suburb}}', { step_no: 5, max_words: 40 })
    .errors.some(e => e.indexOf('too_long') === 0));
t('US spelling rejected',
  call('kqgLint', 'a subject', 'We specialize in this? {{suburb}}', { step_no: 1 })
    .errors.some(e => e.indexOf('us_spelling') === 0));
t('attachment before step 4 rejected',
  call('kqgLint', 'a subject', 'Worth a look? {{suburb}}', { step_no: 2, has_attachment: true })
    .errors.indexOf('attachment_not_allowed_before_step_4') !== -1);

// ---------------------------------------------------------------------
section('variant assignment (§5.5)');
// ---------------------------------------------------------------------
t('deterministic per lead+step',
  call('kqgVariantIndex', 12345, 1, 2) === call('kqgVariantIndex', 12345, 1, 2));
t('different step can differ',
  [0, 1].indexOf(call('kqgVariantIndex', 12345, 2, 2)) !== -1);
const dist = { 0: 0, 1: 0 };
for (let i = 1; i <= 4000; i++) dist[call('kqgVariantIndex', i, 1, 2)]++;
t('two arms split within 5%', Math.abs(dist[0] - dist[1]) / 4000 < 0.05, dist);

// ---------------------------------------------------------------------
section('timezone and send window (§7) — across the DST boundary');
// ---------------------------------------------------------------------
// SA: ACDT (+10:30) until the first Sunday in April, ACST (+9:30) until the
// first Sunday in October. 2026: 5 April and 4 October.
t('Jan is ACDT (+630)',  call('kqdOffsetMinutes', new Date('2026-01-15T00:00:00Z')) === 630);
t('Jul is ACST (+570)',  call('kqdOffsetMinutes', new Date('2026-07-15T00:00:00Z')) === 570);
t('4 Apr 2026 still ACDT', call('kqdOffsetMinutes', new Date('2026-04-04T00:00:00Z')) === 630);
t('6 Apr 2026 now ACST',   call('kqdOffsetMinutes', new Date('2026-04-06T00:00:00Z')) === 570);
t('3 Oct 2026 still ACST', call('kqdOffsetMinutes', new Date('2026-10-03T00:00:00Z')) === 570);
t('5 Oct 2026 now ACDT',   call('kqdOffsetMinutes', new Date('2026-10-05T00:00:00Z')) === 630);

// 2026-08-07 is a Friday. 09:00 ACST = 23:30Z on 2026-08-06.
t('Fri 09:00 ACST is in window',
  call('kqdInSendWindow', new Date('2026-08-06T23:30:00Z'), '08:00', '16:30') === true);
t('Fri 07:00 ACST is not',
  call('kqdInSendWindow', new Date('2026-08-06T21:30:00Z'), '08:00', '16:30') === false);
t('Fri 17:00 ACST is not',
  call('kqdInSendWindow', new Date('2026-08-07T07:30:00Z'), '08:00', '16:30') === false);
// 2026-08-08 is a Saturday.
t('Saturday is never in window',
  call('kqdInSendWindow', new Date('2026-08-07T23:30:00Z'), '08:00', '16:30') === false);

const slotSat = call('kqdNextSendSlot', new Date('2026-08-07T23:30:00Z'), '08:00', '16:30');
t('Saturday rolls to Monday 08:00 ACST',
  new Date(slotSat).toISOString() === '2026-08-09T22:30:00.000Z', new Date(slotSat).toISOString());
// Straddle the October change: step scheduled from Fri 2 Oct 2026 + 3 days.
const dstStep = call('kqdStepDueAt', new Date('2026-10-02T00:00:00Z'), 3, '08:00', '16:30');
t('step across the Oct DST change lands in window',
  call('kqdInSendWindow', dstStep, '08:00', '16:30') === true, new Date(dstStep).toISOString());
t('jitter inside 90-600s', (() => {
  for (let i = 0; i < 200; i++) { const j = call('kqdJitterSeconds', 90, 600); if (j < 90 || j > 600) return false; }
  return true;
})());

// ---------------------------------------------------------------------
section('warmup ramp and circuit breaker (§5.2)');
// ---------------------------------------------------------------------
t('day 0 cap = 10', call('kqdWarmupCap', '2026-08-07', '2026-08-07', 10, 5, 40) === 10);
t('day 1 cap = 15', call('kqdWarmupCap', '2026-08-07', '2026-08-08', 10, 5, 40) === 15);
t('day 6 cap = 40', call('kqdWarmupCap', '2026-08-07', '2026-08-13', 10, 5, 40) === 40);
t('never exceeds 40', call('kqdWarmupCap', '2026-08-07', '2026-12-07', 10, 5, 40) === 40);
t('breaker holds below sample',
  call('kqdBreaker', { sent_7d: 10, hard_bounce_7d: 2, complaint_7d: 0 }, {}).trip === false);
t('breaker trips at 4% bounce',
  call('kqdBreaker', { sent_7d: 100, hard_bounce_7d: 4, complaint_7d: 0 }, {}).trip === true);
t('breaker holds at 2% bounce',
  call('kqdBreaker', { sent_7d: 100, hard_bounce_7d: 2, complaint_7d: 0 }, {}).trip === false);
t('breaker trips on 2 complaints',
  call('kqdBreaker', { sent_7d: 500, hard_bounce_7d: 0, complaint_7d: 2 }, {}).trip === true);
t('paused mailbox has 0 remaining',
  call('kqdRemainingToday', { status: 'paused', daily_cap_max: 40 }, 0) === 0);

// ---------------------------------------------------------------------
section('reply classification (§5.4)');
// ---------------------------------------------------------------------
const rc = (body, extra) => call('kqrcClassify', Object.assign({ subject: '', body_text: body }, extra || {}));
t('bounce detected', rc('Delivery Status Notification (Failure) 550 5.1.1 user unknown').classification === 'bounce');
t('ooo detected', rc('I am currently out of the office and will return on Monday.').classification === 'ooo');
t('unsubscribe detected', rc('Please remove me from your list.').classification === 'unsubscribe');
t('not interested detected', rc('No thanks, we are happy with our current cleaner.').classification === 'not_interested');
t('positive detected', rc('Yes please send the quote through.').classification === 'positive');
t('booked detected', rc('Yes, Tuesday 10am works for us, walkthrough confirmed.').booked === true);
const wp = rc('I do not look after that. You should contact Sarah Nguyen, our Facilities Manager - sarah.nguyen@site.com.au');
t('wrong_person detected', wp.classification === 'wrong_person', wp);
t('referral email extracted', wp.referral && wp.referral.email === 'sarah.nguyen@site.com.au', wp.referral);
t('referral name extracted', wp.referral && /Sarah/.test(wp.referral.full_name || ''), wp.referral);
const nn = rc('Not right now - our contract runs to March 2027, try us in 6 months.');
t('not_now detected', nn.classification === 'not_now', nn);
t('not_now returns a date', /^\d{4}-\d{2}-\d{2}$/.test(nn.followup_date || ''), nn.followup_date);
t('quoted original is stripped',
  rc('No thanks.\n\nOn Tue, Michelle wrote:\n> Want a fixed price? Yes please send the quote').classification === 'not_interested');
t('positive stops the sequence and alerts',
  call('kqrcAction', 'positive').stop_sequence === true && call('kqrcAction', 'positive').alert === true);
t('unsubscribe suppresses', call('kqrcAction', 'unsubscribe').suppress === true);
t('ooo does not stop the sequence', call('kqrcAction', 'ooo').stop_sequence === false);

// ---------------------------------------------------------------------
section('registry adapters (§4.2)');
// ---------------------------------------------------------------------
t('no GUID = no ABN request', call('kqrAbnSearchUrl', 'Acme', '', null) === null);
t('GUID builds a request', /abr\.business\.gov\.au\/json\/MatchingNames/.test(call('kqrAbnSearchUrl', 'Acme', 'GUID-1', '5000')));
t('jsonp unwrapped', call('kqrUnwrapJsonp', 'callback({"Names":[{"Abn":"11 222 333 444"}]})').Names.length === 1);
t('exact ABN match accepted', (() => {
  const m = call('kqrPickAbnMatch', { Names: [{ Abn: '11 222 333 444', Name: 'Adelaide Facility Group Pty Ltd',
    Postcode: '5000', State: 'SA', AbnStatus: 'Active' }] }, 'Adelaide Facility Group', '5000');
  return m && m.abn === '11222333444';
})());
t('poor ABN match rejected',
  call('kqrPickAbnMatch', { Names: [{ Abn: '1', Name: 'Totally Different Business', AbnStatus: 'Active' }] },
    'Adelaide Facility Group', '5000') === null);
t('csv with quoted commas parsed', (() => {
  const rows = call('kqrCsvToObjects', 'Name,State\n"Smith, John and Co",SA\n');
  return rows.length === 1 && rows[0].Name === 'Smith, John and Co';
})());
t('non-SA registry rows dropped',
  call('kqrNormalizeRow', { code: 'x', segment: 'EDU', name_field: 'Name', state_field: 'State', postcode_field: 'Postcode' },
    { Name: 'Sydney Preschool', State: 'NSW', Postcode: '2000' }) === null);
const tender = call('kqrParseTenderPage',
  'Contract 12345 Provision of cleaning services for council depots. Contract end date 30/06/2027. ' +
  'Contract 99 Road resurfacing. Contract end date 01/01/2027.', 'https://tenders.sa.gov.au/x');
t('tender parser finds the cleaning contract only', tender.length === 1, tender);
t('tender expiry parsed to ISO', tender[0] && tender[0].expires_at.indexOf('2027-06-30') === 0, tender[0]);
t('tender confidence high when labelled', tender[0] && tender[0].confidence === 0.85);
t('no verifier key = skipped stage', call('kqrVerifierRequest', 'a@b.com', {}) === null);
t('verifier vendor mapped', call('kqrVerifierParse', 'zerobounce', { status: 'valid' }) === 'valid');
t('catch-all mapped', call('kqrVerifierParse', 'neverbounce', { result: 'catchall' }) === 'catch_all');
t('no places key = no request', call('kqrPlacesSearchUrl', 'Acme', {}) === null);
t('multi-site counted', call('kqrCountSites', { places: [
  { displayName: { text: 'Acme Childcare' }, formattedAddress: '1 A St, Adelaide SA' },
  { displayName: { text: 'Acme Childcare' }, formattedAddress: '2 B St, Prospect SA' },
  { displayName: { text: 'Other Co' },       formattedAddress: '3 C St, Unley SA' }] }, 'Acme Childcare') === 2);

console.log('\n' + '='.repeat(50));
console.log('PASS ' + pass + '   FAIL ' + fail);
process.exit(fail ? 1 : 0);
