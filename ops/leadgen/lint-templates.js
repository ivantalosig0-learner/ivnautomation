#!/usr/bin/env node
/*
 * lint-templates.js — lint every seeded campaign variant and render one full
 * email per segment, so the copy rules (§5.3) and the compliance block (§5.1)
 * are verified against what is actually in the database, not against samples.
 *
 *   docker exec ivnautomation-postgres psql -U ivan -d ivnautomation -Atc "<export query>" > templates.json
 *   docker cp ops/leadgen ivnautomation-n8n:/tmp/lg && docker cp templates.json ivnautomation-n8n:/tmp/lg/
 *   docker exec -w /tmp/lg ivnautomation-n8n node lint-templates.js
 *
 * Writes lint_status back as SQL on stdout when --sql is passed.
 */
const fs = require('fs');
const vm = require('vm');

const SRC = require('./sendguard.js').SENDGUARD_SRC;
const ctx = vm.createContext({ JSON, console, RegExp, Number, String, Object, Array, Math, encodeURIComponent });
vm.runInContext(SRC, ctx);
const call = (fn, ...args) => { ctx.__a = args; return vm.runInContext(`${fn}.apply(null,__a)`, ctx); };

const data = JSON.parse(fs.readFileSync(process.argv[2] || 'templates.json', 'utf8'));
const emitSql = process.argv.indexOf('--sql') !== -1;

// One representative lead per segment. Real shape, deliberately ordinary
// values — if the copy only works for a flattering example it does not work.
const LEAD = {
  first_name: 'Rachel',
  short_name: 'Kent Town Medical',
  business_name: 'Kent Town Medical Centre',
  suburb: 'Kent Town',
  observation: 'Saw on your site - "open six days with on-site pathology".'
};

const FOOTER = {
  sender_name: 'Michelle',
  legal_entity: 'KQuality Cleaning Services',
  abn: '00 000 000 000',
  postal_address: 'PO Box 000, Adelaide SA 5000',
  phone: '0439 489 630',
  unsubscribe_base_url: 'https://n8n.kqualitycleaningservices.com.au/webhook/unsubscribe',
  source_url: 'https://example.com.au/our-team'
};

let lintFail = 0, lintPass = 0;
const failures = [];
const sql = [];

for (const v of data.variants) {
  const res = call('kqgLint', v.subject_template, v.body_template,
    { step_no: v.step_no, max_words: v.max_words, has_attachment: false });
  if (res.ok) { lintPass++; } else { lintFail++; failures.push({ v, errors: res.errors }); }
  if (emitSql) {
    sql.push(`UPDATE leads.campaign_variant SET lint_status='${res.ok ? 'pass' : 'fail'}', ` +
      `lint_errors='${JSON.stringify(res.errors).replace(/'/g, "''")}'::jsonb, updated_at=now() WHERE id=${v.id};`);
  }
}

console.log('LINT  pass=' + lintPass + '  fail=' + lintFail + '  (of ' + data.variants.length + ' variants)');
const byErr = {};
for (const f of failures) for (const e of f.errors) byErr[e.split(':')[0]] = (byErr[e.split(':')[0]] || 0) + 1;
if (lintFail) {
  console.log('  failure kinds: ' + JSON.stringify(byErr));
  for (const f of failures.slice(0, 6)) {
    console.log('  - ' + f.v.campaign_code + ' step ' + f.v.step_no + f.v.variant_code + ': ' + f.errors.join(', '));
  }
}

// --- render one email per segment and check the compliance block ---
console.log('\nRENDER one step-1 email per segment');
let renderFail = 0;
const wordCounts = [];
for (const c of data.copy) {
  const variant = data.variants.find(v =>
    v.campaign_code === 'DM_' + c.segment_code && v.step_no === 1 && v.variant_code === 'A');
  if (!variant) { console.log('  MISS  ' + c.segment_code + ' has no step-1 variant'); renderFail++; continue; }

  const out = call('kqgPreSend', {
    contact: { id: 1, email: 'rachel.ashby@example.com.au', email_type: 'personal',
      email_verification_status: 'valid', source_url: FOOTER.source_url,
      discovered_at: '2026-08-01T00:00:00Z', title_rank: 1, unsubscribe_token: 'tok-' + c.segment_code },
    lead: { id: 1, do_not_contact: false, excluded_from_outreach: false, is_competitor: false },
    suppressed: false,
    mailbox: { id: 1, status: 'active', sent_today: 0, daily_cap: 40 },
    sends_today: 0, guessed_sent_today: 0, in_send_window: true,
    template: { subject: variant.subject_template, body: variant.body_template },
    vars: Object.assign({}, LEAD, {
      segment_job: c.segment_job, segment_pain: c.segment_pain, segment_line: c.segment_line,
      segment_ask: c.segment_ask, proof_case: c.proof_case, compliance_hook: c.compliance_hook
    }),
    footer: Object.assign({}, FOOTER)
  });

  const b = out.rendered.body;
  const checks = {
    allowed: out.allowed,
    legal_entity: b.indexOf('KQuality Cleaning Services') !== -1,
    abn: /ABN \d{2} \d{3} \d{3} \d{3}/.test(b),
    address: b.indexOf('Adelaide SA 5000') !== -1,
    unsub: b.indexOf('Unsubscribe: https://') !== -1 && b.indexOf('?t=tok-' + c.segment_code) !== -1,
    provenance: b.indexOf(FOOTER.source_url) !== -1,
    no_unresolved: b.indexOf('{{') === -1,
    subject_len: out.rendered.subject.length <= 45
  };
  const bad = Object.keys(checks).filter(k => !checks[k]);
  const words = out.rendered.body_only.trim().split(/\s+/).length;
  wordCounts.push(words);
  if (bad.length) { renderFail++; console.log('  FAIL  ' + c.segment_code + ' missing: ' + bad.join(',') + '  reasons=' + JSON.stringify(out.reasons)); }
  else console.log('  OK    ' + c.segment_code.padEnd(14) + ' subj=' + out.rendered.subject.length + 'ch  body=' + words + 'w');
}
console.log('\nRENDER pass=' + (data.copy.length - renderFail) + ' fail=' + renderFail +
            '  body words min/max=' + Math.min(...wordCounts) + '/' + Math.max(...wordCounts));

if (emitSql) fs.writeFileSync('lint-status.sql', sql.join('\n') + '\n');
process.exit((lintFail || renderFail) ? 1 : 0);
