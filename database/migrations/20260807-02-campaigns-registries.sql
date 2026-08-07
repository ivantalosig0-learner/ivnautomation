-- =====================================================================
-- 20260807-02-campaigns-registries.sql
--
-- Phase 3 storage (Tier B registry records) and Phase 4 copy (campaigns,
-- steps, variants, segment copy). Additive and idempotent.
--
-- Copy lives in the database so it can be edited without redeploying a
-- workflow — the existing composer.js path is untouched and keeps running as
-- the primary sender until a campaign is switched on.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Tier B registry records
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS leads.registry_record (
  id            bigserial PRIMARY KEY,
  registry_code text NOT NULL,
  entity_name   text NOT NULL,
  name_norm     text NOT NULL,
  abn           text,
  postcode      text,
  suburb        text,
  segment_code  text REFERENCES leads.segment_taxonomy(code),
  source_url    text,
  meta          jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS registry_record_uniq
  ON leads.registry_record (registry_code, name_norm, coalesce(postcode, ''));
CREATE INDEX IF NOT EXISTS registry_record_name_idx ON leads.registry_record (name_norm);
CREATE INDEX IF NOT EXISTS registry_record_abn_idx  ON leads.registry_record (abn) WHERE abn IS NOT NULL;

CREATE TABLE IF NOT EXISTS leads.registry_sync (
  id            bigserial PRIMARY KEY,
  registry_code text NOT NULL,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  status        text NOT NULL DEFAULT 'running',
  rows_seen     int NOT NULL DEFAULT 0,
  rows_upserted int NOT NULL DEFAULT 0,
  error         text,
  CONSTRAINT registry_sync_status_chk CHECK (status IN ('running','completed','failed','skipped'))
);
CREATE INDEX IF NOT EXISTS registry_sync_recent_idx ON leads.registry_sync (registry_code, started_at DESC);

-- ---------------------------------------------------------------------
-- 2. Unsubscribe token
--
-- A stored random token, not a hash of the address: it cannot be guessed from
-- the email, and revoking one is a single UPDATE. The link has to stay live at
-- least 30 days, so tokens are never rotated on send.
-- ---------------------------------------------------------------------

ALTER TABLE leads.lead_contact
  ADD COLUMN IF NOT EXISTS unsubscribe_token text;

UPDATE leads.lead_contact
   SET unsubscribe_token = md5(gen_random_uuid()::text || id::text)
 WHERE unsubscribe_token IS NULL;

ALTER TABLE leads.lead_contact
  ALTER COLUMN unsubscribe_token SET DEFAULT md5(gen_random_uuid()::text);

CREATE UNIQUE INDEX IF NOT EXISTS lead_contact_unsub_uniq
  ON leads.lead_contact (unsubscribe_token) WHERE unsubscribe_token IS NOT NULL;

-- ---------------------------------------------------------------------
-- 3. Segment copy — the per-segment nouns the shared templates render with.
--
-- Seeded from the wording already running in ops/leadgen/composer.js, remapped
-- onto the 12 buyer codes. proof_case is deliberately capability-based rather
-- than a named client: a fabricated case study is worse than no case study,
-- and the strict renderer would happily ship one.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS leads.segment_copy (
  segment_code     text PRIMARY KEY REFERENCES leads.segment_taxonomy(code),
  segment_job      text NOT NULL,
  segment_pain     text NOT NULL,
  segment_line     text NOT NULL,
  segment_ask      text NOT NULL,
  proof_case       text NOT NULL,
  compliance_hook  text NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

INSERT INTO leads.segment_copy
  (segment_code, segment_job, segment_pain, segment_line, segment_ask, proof_case, compliance_hook)
VALUES
 ('STRATA',
  'common areas, bin rooms and carparks',
  'owner complaints about common areas',
  'We run scheduled common-area cleans with a checklist signed off each visit, so there is a record when the committee asks.',
  'common-area cleaning for one of your buildings',
  'Our strata work runs to a fixed schedule with photo-verified attendance, so a manager can answer an owner complaint from the record instead of from memory.',
  'duty of care to lot owners'),

 ('COMMERCIAL_RE',
  'end-of-lease and common-area cleans',
  'juggling different cleaners across a rent roll',
  'Managers we work with use one number for the whole portfolio and get a single invoice at month end instead of chasing five contractors.',
  'a couple of your managed properties',
  'One contact across the portfolio, one invoice at month end, and presentation held to the same standard before every inspection.',
  'public liability and SWMS on file'),

 ('NDIS',
  'cleaning for SIL and supported housing',
  'finding cleaners who are reliable and respectful with participants',
  'Our staff hold NDIS Worker Screening clearances and work to a set schedule, so participants see the same faces each week.',
  'one or two of your properties',
  'Same cleaner each visit, screened staff, and infection-control routines documented so the evidence exists before an audit asks for it.',
  'NDIS Practice Standards'),

 ('AGED_CARE',
  'facility and common-area cleaning',
  'keeping cleaning evidence ready for accreditation',
  'All staff are police-checked and we work to infection-control routines with documented sign-off, so the paperwork is there when you are assessed.',
  'one wing or common area',
  'Documented IPC routines, sign-off per visit, and after-hours flexibility so residents are not worked around.',
  'Aged Care Quality Standards'),

 ('HEALTH',
  'after-hours clinical cleaning',
  'cleaning that has to happen outside consulting hours',
  'We clean after hours to clinical standards with correct waste segregation, so you open to rooms that are genuinely ready.',
  'your consulting rooms and common areas',
  'Out-of-hours servicing so no session is lost, correct clinical waste handling, and cleaning records you can hand to an accreditation surveyor.',
  'accreditation evidence'),

 ('EDU',
  'classroom and facility cleaning',
  'fitting deep cleans around term dates',
  'We work to the term calendar - lighter during teaching weeks, deep cleans in the breaks - and every staff member holds a Working With Children Check.',
  'your classrooms and amenities',
  'Term-calendar scheduling, screened staff, and holiday deep-clean windows booked ahead so nothing is rushed before an assessment visit.',
  'National Quality Standard'),

 ('GOV_LOCAL',
  'community facility and amenities cleaning',
  'contractors who cannot produce documentation when asked',
  'We hold public liability cover, provide SWMS per site, and employ locally in Adelaide - the documentation is ready before it is requested.',
  'one of your facilities',
  'Full compliance documentation, SWMS per site, and local SA employment - the things a procurement officer has to evidence anyway.',
  'WHS Act 2012 (SA)'),

 ('GOV_STATE',
  'site and amenities cleaning',
  'panel and tender documentation that has to be current',
  'We hold public liability cover, provide SWMS per site, and employ locally in Adelaide - current documentation, not documentation we will get to.',
  'one of your sites',
  'Current insurance and SWMS, local employment, and reporting shaped for a contract manager rather than for us.',
  'procurement documentation'),

 ('HOSPITALITY',
  'early-morning venue cleans',
  'the room not being ready before service',
  'We come in early and are out before service, so the room is ready rather than being cleaned around your first guests.',
  'your front of house',
  'Early-morning turnarounds finished before doors, so the first review of the day is about the food and not the floors.',
  'food safety and public liability'),

 ('INDUSTRIAL',
  'warehouse and amenities cleaning',
  'high-traffic floors and staff amenities slipping',
  'We handle high-traffic floors and staff amenities on a set schedule, and the team is site-inducted before they start.',
  'your floors and amenities',
  'Site-inducted crews working around production, with amenities held to a standard that survives a WHS walkthrough.',
  'WHS Act 2012 (SA)'),

 ('CHILD_ED_CORP',
  'multi-site cleaning across your locations',
  'a different cleaner and a different standard at every site',
  'One contract across every site, one invoice, one escalation path - and the same checklist at each location.',
  'two or three of your sites',
  'One agreement across the group, consolidated invoicing, and the same documented standard at every location.',
  'consolidated compliance reporting'),

 ('RETAIL_OFFICE',
  'office and retail cleaning',
  'a cleaner who changes every few weeks',
  'You get the same cleaner each visit and a direct number rather than a call centre, which is usually the thing offices tell us was missing.',
  'your premises',
  'The same cleaner each visit and a direct number - the two things clients say were missing from the last arrangement.',
  'public liability cover'),

 ('UNCLASSIFIED',
  'commercial cleaning',
  'a cleaner who actually turns up',
  'We are Adelaide-based, fully insured, and every cleaner is police-checked - documentation available on request.',
  'your site',
  'Adelaide-based, insured, police-checked staff, and documentation available on request.',
  'public liability cover')
ON CONFLICT (segment_code) DO UPDATE SET
  segment_job = EXCLUDED.segment_job, segment_pain = EXCLUDED.segment_pain,
  segment_line = EXCLUDED.segment_line, segment_ask = EXCLUDED.segment_ask,
  proof_case = EXCLUDED.proof_case, compliance_hook = EXCLUDED.compliance_hook,
  updated_at = now()
WHERE (leads.segment_copy.segment_job, leads.segment_copy.segment_pain,
       leads.segment_copy.segment_line, leads.segment_copy.segment_ask,
       leads.segment_copy.proof_case, leads.segment_copy.compliance_hook)
   IS DISTINCT FROM
      (EXCLUDED.segment_job, EXCLUDED.segment_pain, EXCLUDED.segment_line,
       EXCLUDED.segment_ask, EXCLUDED.proof_case, EXCLUDED.compliance_hook);

-- ---------------------------------------------------------------------
-- 4. Mailboxes
--
-- The existing primary-domain mailbox is registered as-is so current sends
-- stay attributable and capped at today's 15/day. The cold-outreach mailbox is
-- seeded paused: it must not send a single email until its DNS is live and
-- verified, which is the whole point of separating it.
-- ---------------------------------------------------------------------

INSERT INTO leads.mailbox
  (address, display_name, sending_domain, provider, is_primary_domain,
   warmup_started_on, daily_cap_max, daily_cap_floor, warmup_step, status, paused_reason, enabled)
VALUES
  ('info@kqualitycleaningservices.com.au', 'Michelle',
   'kqualitycleaningservices.com.au', 'smtp', true,
   NULL, 15, 15, 0, 'active', NULL, true),
  ('michelle@outreach.kqualitycleaningservices.com.au', 'Michelle',
   'outreach.kqualitycleaningservices.com.au', 'smtp', false,
   NULL, 40, 10, 5, 'paused',
   'awaiting SPF/DKIM/DMARC verification on the outreach subdomain', true)
ON CONFLICT (lower(address)) DO NOTHING;

-- ---------------------------------------------------------------------
-- 5. Campaigns — one per buyer segment, 5 steps over 18 days, 2 variants each.
--
-- The step and variant text is shared and rendered with the segment's own
-- nouns from leads.segment_copy, so an A/B arm accumulates sample across all
-- segments and can actually reach n=200 (§5.5) instead of 12 arms of 17.
-- Every row stays individually editable after seeding.
-- ---------------------------------------------------------------------

INSERT INTO leads.campaign (code, name, segment_code, offer_config, enabled)
SELECT 'DM_' || t.code,
       'Decision-maker outreach - ' || t.name,
       t.code,
       jsonb_build_object(
         'primary_cta',      'free 15-minute on-site walkthrough',
         'deliverable',      'written scope and fixed quote within 24 hours',
         'trial',            '4-week trial, no lock-in',
         'response_sla_hrs', 24,
         'walkthrough_mins', 15
       ),
       false                                  -- switched on deliberately, never by a migration
  FROM leads.segment_taxonomy t
 WHERE t.code <> 'UNCLASSIFIED'
   AND NOT EXISTS (SELECT 1 FROM leads.campaign c WHERE c.code = 'DM_' || t.code);

INSERT INTO leads.campaign_step (campaign_id, step_no, day_offset, intent, max_words, allow_attach)
SELECT c.id, s.step_no, s.day_offset, s.intent, s.max_words, s.allow_attach
  FROM leads.campaign c
  CROSS JOIN (VALUES
    (1::smallint,  0::smallint, 'relevance + one specific observation + soft ask', 90::smallint, false),
    (2::smallint,  3::smallint, 'proof: same-segment Adelaide capability, one concrete metric', 70::smallint, false),
    (3::smallint,  7::smallint, 'risk and compliance angle specific to the segment', 80::smallint, false),
    (4::smallint, 12::smallint, 'low-friction offer: 15-min walkthrough, written scope and quote', 60::smallint, true),
    (5::smallint, 18::smallint, 'polite close-out, door left open, no guilt', 40::smallint, false)
  ) AS s(step_no, day_offset, intent, max_words, allow_attach)
 WHERE c.code LIKE 'DM\_%'
   AND NOT EXISTS (
     SELECT 1 FROM leads.campaign_step cs
      WHERE cs.campaign_id = c.id AND cs.step_no = s.step_no);

INSERT INTO leads.campaign_variant
  (step_id, variant_code, subject_template, body_template, required_vars, lint_status)
SELECT cs.id, v.variant_code, v.subject_template, v.body_template, v.required_vars, 'pending'
  FROM leads.campaign_step cs
  JOIN leads.campaign c ON c.id = cs.campaign_id
  JOIN (VALUES
   -- ---- step 1: relevance ----
   (1::smallint, 'A',
    'quick question about {{suburb}}',
    E'Hi {{first_name}},\n\n{{observation}}\n\nWe handle {{segment_job}} for {{suburb}} businesses. The thing that comes up first is usually {{segment_pain}} - {{segment_line}}\n\nWorth me putting a fixed price together for {{segment_ask}}?',
    '["first_name","observation","suburb","segment_job","segment_pain","segment_line","segment_ask"]'::jsonb),
   (1::smallint, 'B',
    'cleaning at {{short_name}}',
    E'Hi {{first_name}},\n\n{{observation}}\n\nMost of what we do around {{suburb}} is {{segment_job}}. {{segment_line}}\n\nNot asking for a meeting - should I send a one-page price for {{segment_ask}} so it is on file?',
    '["first_name","observation","suburb","segment_job","segment_line","segment_ask"]'::jsonb),

   -- ---- step 2: proof ----
   (2::smallint, 'A',
    'one thing {{suburb}} sites ask',
    E'Hi {{first_name}},\n\nFollowing on from last week. {{proof_case}}\n\nThat is the part most people want to see before they change anything. Should I send the one-page price for {{segment_ask}}?',
    '["first_name","proof_case","segment_ask"]'::jsonb),
   (2::smallint, 'B',
    'how this usually works',
    E'Hi {{first_name}},\n\nShort version of how we run {{segment_job}}: {{proof_case}}\n\nNo lock-in, and the first four weeks are a trial. Want the numbers for {{segment_ask}}?',
    '["first_name","segment_job","proof_case","segment_ask"]'::jsonb),

   -- ---- step 3: risk and compliance ----
   (3::smallint, 'A',
    'the compliance side',
    E'Hi {{first_name}},\n\nOne angle worth raising: {{compliance_hook}}. Cleaning is usually the part with the least evidence behind it when someone asks.\n\n{{segment_line}}\n\nHappy to show you what our records look like - want me to send a sample with the price for {{segment_ask}}?',
    '["first_name","compliance_hook","segment_line","segment_ask"]'::jsonb),
   (3::smallint, 'B',
    '{{suburb}} - one for the file',
    E'Hi {{first_name}},\n\nMost operators we speak to are comfortable with the cleaning itself and less comfortable with the paperwork behind it - {{compliance_hook}} in particular.\n\n{{segment_line}}\n\nWould a written scope for {{segment_ask}} be useful to have on file?',
    '["first_name","compliance_hook","segment_line","segment_ask"]'::jsonb),

   -- ---- step 4: the offer ----
   (4::smallint, 'A',
    '15 minutes and a fixed price',
    E'Hi {{first_name}},\n\nSimplest next step: 15 minutes on site, and you get a written scope and a fixed quote back within 24 hours. No charge and no obligation.\n\nWorth a look at {{segment_ask}}?',
    '["first_name","segment_ask"]'::jsonb),
   (4::smallint, 'B',
    'want a written scope?',
    E'Hi {{first_name}},\n\nOffer stands: a 15-minute walkthrough, then a written scope and fixed quote within 24 hours, and a four-week trial with no lock-in.\n\nShall I put a time to you for {{segment_ask}}?',
    '["first_name","segment_ask"]'::jsonb),

   -- ---- step 5: close-out ----
   (5::smallint, 'A',
    'closing this off',
    E'Hi {{first_name}},\n\nI will leave it there - clearly not the right time.\n\nIf {{segment_ask}} ever comes up for review, would you keep us in mind?',
    '["first_name","segment_ask"]'::jsonb),
   (5::smallint, 'B',
    'last one from me',
    E'Hi {{first_name}},\n\nNo reply needed. Closing this out my end.\n\nIf the arrangement for {{segment_ask}} changes, would a one-page price be worth having then?',
    '["first_name","segment_ask"]'::jsonb)
  ) AS v(step_no, variant_code, subject_template, body_template, required_vars)
    ON v.step_no = cs.step_no
 WHERE c.code LIKE 'DM\_%'
   AND NOT EXISTS (
     SELECT 1 FROM leads.campaign_variant cv
      WHERE cv.step_id = cs.id AND cv.variant_code = v.variant_code);

-- ---------------------------------------------------------------------
-- 6. Views the dashboard reads. No new storage layer (§6).
-- ---------------------------------------------------------------------

-- Funnel, whole-of-program and per segment. One scan of outreach_event.
CREATE OR REPLACE VIEW leads.v_funnel_by_segment AS
WITH ev AS (
  SELECT e.candidate_id, e.event_type
    FROM leads.outreach_event e
),
per_lead AS (
  SELECT c.id,
         coalesce(c.segment_code, 'UNCLASSIFIED') AS segment_code,
         (c.stage IN ('enriched','qualified','disqualified'))                        AS enriched,
         EXISTS (SELECT 1 FROM leads.lead_contact lc
                  WHERE lc.candidate_id = c.id AND lc.is_active
                    AND lc.title_rank <= 2 AND lc.email IS NOT NULL)                 AS dm_found,
         EXISTS (SELECT 1 FROM ev WHERE ev.candidate_id = c.id AND ev.event_type = 'queued')         AS queued,
         EXISTS (SELECT 1 FROM ev WHERE ev.candidate_id = c.id AND ev.event_type = 'sent')           AS sent,
         EXISTS (SELECT 1 FROM ev WHERE ev.candidate_id = c.id AND ev.event_type = 'delivered')      AS delivered,
         EXISTS (SELECT 1 FROM ev WHERE ev.candidate_id = c.id AND ev.event_type = 'open')           AS opened,
         EXISTS (SELECT 1 FROM ev WHERE ev.candidate_id = c.id AND ev.event_type = 'reply')          AS replied,
         EXISTS (SELECT 1 FROM ev WHERE ev.candidate_id = c.id AND ev.event_type = 'positive_reply') AS positive,
         EXISTS (SELECT 1 FROM ev WHERE ev.candidate_id = c.id AND ev.event_type = 'booked')         AS booked,
         EXISTS (SELECT 1 FROM ev WHERE ev.candidate_id = c.id AND ev.event_type = 'won')            AS won
    FROM leads.candidates c
   WHERE c.duplicate_of IS NULL
)
SELECT segment_code,
       count(*)                              AS scraped,
       count(*) FILTER (WHERE enriched)      AS enriched,
       count(*) FILTER (WHERE dm_found)      AS decision_maker_found,
       count(*) FILTER (WHERE queued)        AS queued,
       count(*) FILTER (WHERE sent)          AS sent,
       count(*) FILTER (WHERE delivered)     AS delivered,
       count(*) FILTER (WHERE opened)        AS opened,
       count(*) FILTER (WHERE replied)       AS replied,
       count(*) FILTER (WHERE positive)      AS positive,
       count(*) FILTER (WHERE booked)        AS booked,
       count(*) FILTER (WHERE won)           AS won
  FROM per_lead
 GROUP BY segment_code;

-- Per-step variant performance with the sample-size flag (§5.5).
CREATE OR REPLACE VIEW leads.v_variant_performance AS
SELECT c.code            AS campaign_code,
       cs.step_no,
       cv.id             AS variant_id,
       cv.variant_code,
       cv.lint_status,
       count(*) FILTER (WHERE e.event_type = 'sent')           AS sent,
       count(*) FILTER (WHERE e.event_type = 'open')           AS opened,
       count(*) FILTER (WHERE e.event_type = 'reply')          AS replied,
       count(*) FILTER (WHERE e.event_type = 'positive_reply') AS positive,
       count(*) FILTER (WHERE e.event_type = 'booked')         AS booked,
       (count(*) FILTER (WHERE e.event_type = 'sent') < 200)   AS below_min_sample
  FROM leads.campaign_variant cv
  JOIN leads.campaign_step cs ON cs.id = cv.step_id
  JOIN leads.campaign c       ON c.id = cs.campaign_id
  LEFT JOIN leads.outreach_event e ON e.variant_id = cv.id
 GROUP BY c.code, cs.step_no, cv.id, cv.variant_code, cv.lint_status;

-- Enrichment coverage: the leading indicator for everything downstream (§6.5).
CREATE OR REPLACE VIEW leads.v_enrichment_coverage AS
SELECT coalesce(c.segment_code, 'UNCLASSIFIED') AS segment_code,
       count(*)                                                              AS leads,
       count(*) FILTER (WHERE c.email IS NOT NULL)                           AS with_any_email,
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM leads.lead_contact lc
          WHERE lc.candidate_id = c.id AND lc.is_active AND lc.title_rank <= 2))       AS with_rank12_contact,
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM leads.lead_contact lc
          WHERE lc.candidate_id = c.id AND lc.is_active AND lc.title_rank <= 2
            AND lc.email IS NOT NULL AND lc.email_type = 'personal'))                  AS with_personal_email,
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM leads.lead_contact lc
          WHERE lc.candidate_id = c.id AND lc.is_active AND lc.title_rank <= 2
            AND lc.email_verification_status = 'valid'))                               AS with_verified_email,
       count(*) FILTER (WHERE c.needs_enrichment)                            AS needs_enrichment,
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM leads.lead_signal s
          WHERE s.candidate_id = c.id
            AND (s.expires_at IS NULL OR s.expires_at > now())))             AS with_active_signal
  FROM leads.candidates c
 WHERE c.duplicate_of IS NULL
 GROUP BY 1;

-- Positive replies awaiting a human, oldest first. Ageing past 4 business
-- hours is the number that actually moves booked inspections (§5.4).
CREATE OR REPLACE VIEW leads.v_action_queue AS
SELECT ra.id,
       ra.candidate_id,
       c.business_name,
       coalesce(c.segment_code, 'UNCLASSIFIED') AS segment_code,
       c.suburb,
       lc.full_name,
       lc.job_title,
       lc.email,
       lc.phone,
       ra.classification,
       ra.received_at,
       ra.alerted_at,
       round(extract(epoch FROM (now() - ra.received_at)) / 3600.0, 1) AS age_hours,
       (now() - ra.received_at) > interval '4 hours'                   AS overdue
  FROM leads.reply_action ra
  JOIN leads.candidates c ON c.id = ra.candidate_id
  LEFT JOIN leads.lead_contact lc ON lc.id = ra.contact_id
 WHERE ra.responded_at IS NULL
   AND ra.classification IN ('positive','wrong_person','unknown')
 ORDER BY ra.received_at;

COMMIT;
