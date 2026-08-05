/* Outreach Follow-up Engine — slower cadence, each touch carries new value.
 *
 * Old cadence was 2/3/5 days: three emails inside a working week, which reads
 * as pressure and is a common spam-complaint trigger on cold B2B. New cadence
 * is 3/7/14 days, and each follow-up leads with a different reason to reply
 * rather than restating the first email.
 */

const FETCH_SQL = [
  'SELECT d.candidate_id, d.subject AS orig_subject, d.body AS orig_body, d.followup_count,',
  '       EXTRACT(day FROM now() - COALESCE(d.last_followup_at, d.sent_at))::int AS days_since,',
  '       c.business_name, c.email, c.address, c.suburb, c.qualification_score,',
  '       s.code AS segment_code',
  'FROM leads.outreach_drafts d',
  'JOIN leads.candidates c ON c.id = d.candidate_id',
  'JOIN leads.crm_records r ON r.candidate_id = d.candidate_id',
  'LEFT JOIN leads.segments s ON s.id = c.segment_id',
  'WHERE d.status = \'sent\'',
  '  AND d.followup_count < 3',
  '  AND r.stage = \'contacted\'',
  '  AND r.status = \'active\'',
  '  AND c.email IS NOT NULL',
  '  AND c.duplicate_of IS NULL',
  '  AND c.do_not_contact = false',
  '  AND NOT EXISTS (SELECT 1 FROM leads.inbound_replies ir',
  '                  WHERE ir.candidate_id = d.candidate_id)',
  // never follow up an address that has since bounced or opted out
  '  AND NOT EXISTS (SELECT 1 FROM leads.suppression sp',
  '                  WHERE sp.email_norm = leads.norm_email(c.email)',
  '                    AND sp.reason IN (\'hard_bounce\',\'opt_out\',\'cleaning_competitor\'))',
  '  AND (CASE d.followup_count',
  '         WHEN 0 THEN d.sent_at + interval \'3 days\'',
  '         WHEN 1 THEN d.last_followup_at + interval \'7 days\'',
  '         WHEN 2 THEN d.last_followup_at + interval \'14 days\'',
  '       END) <= now()',
  'ORDER BY c.qualification_score DESC NULLS LAST, d.sent_at',
  'LIMIT 10',
].join('\n');

const PREPARE_JS = String.raw`
const KQ = {
  company: 'KQuality Cleaning Services',
  sender: 'Michelle',
  phone: '0439 489 630'
};

// Each follow-up carries a DIFFERENT reason to reply. Repeating the first
// email is what makes a sequence feel automated.
const ANGLE = {
  real_estate_strata: { proof: 'we can usually turn a vacate clean around inside 24 hours, photos sent through when it is done', ask: 'your next vacate clean' },
  property_management:{ proof: 'most managers we work with run the whole rent roll through one number and one monthly invoice', ask: 'a couple of managed properties' },
  strata:             { proof: 'we leave a signed checklist after each common-area visit, so you have something for the committee', ask: 'one building' },
  body_corporate:     { proof: 'we leave a signed checklist after each visit, so there is a record when owners ask', ask: 'one building' },
  builders_construction:{ proof: 'we book builders cleans to your handover date, not ours, and do the final sparkle before walkthrough', ask: 'your next handover' },
  aged_care_facilities:{ proof: 'police-checked staff and documented infection-control sign-off, ready for audit', ask: 'one wing' },
  ndis:               { proof: 'police-checked staff on a fixed schedule, so participants see the same faces each week', ask: 'one or two properties' },
  medical_childcare_gym:{ proof: 'we clean after hours to clinical standards, child-safe products where they are needed', ask: 'your rooms' },
  commercial_office:  { proof: 'the same cleaner every visit and a direct mobile rather than a call centre', ask: 'your office' },
  education_training: { proof: 'lighter cleans during teaching weeks, deep cleans in the breaks, all staff police-checked', ask: 'your classrooms' },
  hospitality_venues: { proof: 'we are in early and out before service, so the room is ready rather than being cleaned around guests', ask: 'front of house' },
  retail_showrooms:   { proof: 'floors and glass done before you open', ask: 'your showroom floor' },
  industrial_warehouse:{ proof: 'site-inducted crew, high-traffic floors and amenities on a set schedule', ask: 'your floors and amenities' },
  community_clubs:    { proof: 'weekend post-function turnarounds, so volunteers are not mopping on a Sunday', ask: 'your next function' },
  automotive_trade:   { proof: 'customer waiting area kept presentable and workshop floors degreased on schedule', ask: 'your waiting area' }
};
const DEFAULT_ANGLE = { proof: 'Adelaide-based, fully insured, every cleaner police-checked', ask: 'your site' };

const r = $json;
const n = Number(r.followup_count) + 1;
const name = String(r.business_name || '').replace(/\s+/g, ' ').trim();
const a = ANGLE[r.segment_code] || DEFAULT_ANGLE;
const greeting = 'Hi ' + name + ' team,';
const signature = 'Thanks,\n' + KQ.sender + '\n' + KQ.company + '\n' + KQ.phone;

let middle = '';
if (n === 1) {
  // Touch 1: shortest possible. One line, one question. Highest reply rate.
  middle = 'Bumping my note from last week in case it slipped past.\n\n'
         + 'Worth me sending a fixed price for ' + a.ask + '? One page, no obligation.';
} else if (n === 2) {
  // Touch 2: new information, not a repeat.
  middle = 'One more from me, then I will leave it.\n\n'
         + 'The part clients usually care about: ' + a.proof + '.\n\n'
         + 'If you already have a cleaner you are happy with, genuinely no problem - '
         + 'a lot of people just like having a second number on file for when one falls through. '
         + 'Want me to send ours?';
} else {
  // Touch 3: permission to close the loop. "No" is an easy, honest reply.
  middle = 'Last note - I will not keep filling your inbox.\n\n'
         + 'If cleaning is not something you are looking at, just reply "not now" and I will close it off. '
         + 'If it becomes useful later, reply to this email any time and I will pick it straight up.';
}

const fallback_body = greeting + '\n\n' + middle + '\n\n' + signature;
const subject = 'Re: ' + String(r.orig_subject || ('Cleaning quote for ' + name));

return { json: {
  candidate_id: r.candidate_id,
  email: r.email,
  subject: subject,
  followup_no: n,
  fallback_body: fallback_body,
  request: {
    business: { name: name, location: r.suburb || null },
    sender: { name: KQ.sender, company: KQ.company, phone: KQ.phone },
    original_email: String(r.orig_body || r.orig_subject || 'first outreach email').slice(0, 4000),
    sequence_number: n,
    days_since_last_contact: Math.max(0, Number(r.days_since) || 0),
    notes: 'Angle for this touch: ' + a.proof + '. Ask to price: ' + a.ask + '.'
  }
} };
`;

module.exports = function (nodes, connections) {
  for (const n of nodes) {
    if (n.name === 'Fetch Due Follow-ups')      n.parameters.query  = FETCH_SQL;
    if (n.name === 'Prepare Follow-up Request') n.parameters.jsCode = PREPARE_JS;
    if (n.name === 'AI Generate Follow-up') {
      n.parameters.options = Object.assign({}, n.parameters.options, { timeout: 20000 });
      n.onError = 'continueRegularOutput';
    }
  }
  return { nodes, connections };
};
