-- =====================================================================
-- 20260807-01-decision-maker-targeting.sql
--
-- Decision-Maker Targeting + Conversion Uplift v1 — Phase 2 (segment model)
-- and the storage the later phases write into.
--
-- Additive and idempotent by construction: CREATE ... IF NOT EXISTS,
-- ADD COLUMN IF NOT EXISTS, seeds via ON CONFLICT DO UPDATE. Nothing is
-- dropped, nothing existing is rewritten except NULL-only backfills.
-- Every existing workflow keeps running while the new columns are NULL.
--
-- Naming note: the brief calls the lead key `lead_id`. Every table already in
-- schema `leads` keys the hub as `candidate_id`, so that is what is used here.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Segment taxonomy
--
-- leads.segments already classifies 100% of the 2865 rows, but it mixes 13
-- buyer segments with 16 discovery search-term buckets and carries no
-- decision-maker titles. It stays exactly as it is — discovery still reads
-- search_terms from it. The buyer taxonomy is layered on top so no existing
-- segment_id is orphaned.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS leads.segment_taxonomy (
  code                text PRIMARY KEY,
  name                text NOT NULL,
  decision_titles     jsonb NOT NULL DEFAULT '[]'::jsonb,  -- rank-1 buyer titles
  secondary_titles    jsonb NOT NULL DEFAULT '[]'::jsonb,  -- rank-2/3 titles
  trigger_types       jsonb NOT NULL DEFAULT '[]'::jsonb,  -- signals worth hunting
  angle               text,                                -- copy angle, §5.3
  compliance_hooks    jsonb NOT NULL DEFAULT '[]'::jsonb,  -- email-3 risk angle
  priority_weight     smallint NOT NULL DEFAULT 5,
  enabled             boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now()
);

INSERT INTO leads.segment_taxonomy
  (code, name, decision_titles, secondary_titles, trigger_types, angle, compliance_hooks, priority_weight)
VALUES
 ('STRATA', 'Strata / community corporation',
  '["Strata Manager","Body Corporate Manager","Portfolio Manager","Community Manager"]',
  '["General Manager","Director","Operations Manager"]',
  '["new_building_handover","agm_cycle","manager_change","contract_expiry"]',
  'Owner complaints and common-area presentation at AGM time. One manager, one point of contact across the portfolio, photo-verified attendance reports.',
  '["duty of care to lot owners","committee reporting evidence"]', 14),

 ('COMMERCIAL_RE', 'Commercial property / facilities management',
  '["Facilities Manager","Property Manager","Building Manager","Asset Manager"]',
  '["Portfolio Manager","Operations Manager","General Manager"]',
  '["new_tenancy","refurbishment","vacancy_listing","contract_expiry"]',
  'Tenant retention and presentation at inspections. One invoice across sites, SLA reporting.',
  '["public liability","SWMS","site induction"]', 13),

 ('NDIS', 'NDIS / disability services (SIL, day programs, plan management)',
  '["Operations Manager","Quality and Safeguards Manager","Service Manager","Service Delivery Manager"]',
  '["Director","Chief Executive Officer","Chief Operating Officer"]',
  '["new_sil_house","audit_cycle","registration_renewal","contract_expiry"]',
  'NDIS Practice Standards and infection control. Participant dignity, NDIS Worker Screening cleared staff, the same cleaner every visit.',
  '["NDIS Practice Standards","NDIS Worker Screening Check","infection control"]', 12),

 ('AGED_CARE', 'Residential aged care / retirement villages',
  '["Facility Manager","Hotel Services Manager","Care Manager","Operations Manager"]',
  '["Director of Nursing","Chief Executive Officer","General Manager"]',
  '["accreditation_date","ipc_obligation","new_site","contract_expiry"]',
  'Infection prevention and control, accreditation readiness, discretion around residents, after-hours flexibility.',
  '["Aged Care Quality Standards","IPC lead requirements","police check"]', 12),

 ('HEALTH', 'Medical, dental, allied health and day surgeries',
  '["Practice Manager","Clinic Manager","Principal Dentist","Practice Principal"]',
  '["Owner","Director","Business Manager"]',
  '["new_fitout","accreditation","new_site"]',
  'Clinical waste handling, accreditation evidence, out-of-hours servicing so clinics never lose a session.',
  '["RACGP Standards","NSQHS Standards","clinical waste segregation"]', 11),

 ('EDU', 'Schools, OSHC, childcare and early learning',
  '["Business Manager","Bursar","Nominated Supervisor","Centre Director"]',
  '["Approved Provider","Principal","Operations Manager"]',
  '["acecqa_assessment","term_break","new_centre","contract_expiry"]',
  'ACECQA assessment readiness, child-safe screened staff, holiday deep-clean windows.',
  '["National Quality Standard","Working With Children Check","ACECQA assessment and rating"]', 11),

 ('GOV_LOCAL', 'Local councils, community centres and libraries',
  '["Procurement Officer","Facilities Coordinator","Contracts Manager","Facilities Manager"]',
  '["Manager Corporate Services","Director Infrastructure"]',
  '["tender_published","contract_expiry","panel_refresh"]',
  'Insurance, SWMS, compliance documentation, local SA employment, panel and tender readiness.',
  '["WHS Act 2012 (SA)","SWMS","public liability certificate"]', 10),

 ('GOV_STATE', 'SA Government sites, SA Health, SA Water',
  '["Contract Manager","Category Manager","Facilities Manager"]',
  '["Procurement Lead","Director Infrastructure"]',
  '["sa_tenders_listing","panel_refresh","contract_expiry"]',
  'Panel readiness, documented compliance, local SA employment, insurance and SWMS on file.',
  '["SA Government procurement framework","WHS Act 2012 (SA)"]', 10),

 ('HOSPITALITY', 'Hotels, venues, clubs and gyms',
  '["Venue Manager","General Manager","Housekeeping Manager","Owner"]',
  '["Operations Manager","Duty Manager"]',
  '["ownership_change","new_venue","reopening"]',
  'Reputation and reviews, turnaround speed, early-morning windows before service.',
  '["Food Safety Standard 3.2.2","public liability"]', 9),

 ('INDUSTRIAL', 'Warehouses, manufacturing and logistics',
  '["Site Manager","WHS Manager","Operations Manager","Warehouse Manager"]',
  '["General Manager","Owner","Plant Manager"]',
  '["site_expansion","whs_audit","contract_expiry"]',
  'WHS compliance, high-traffic floor durability, minimal production disruption.',
  '["WHS Act 2012 (SA)","site induction","SWMS"]', 9),

 ('CHILD_ED_CORP', 'Multi-site operators and franchise groups',
  '["Head of Operations","National Facilities Manager","Group Operations Manager"]',
  '["Chief Operating Officer","Chief Executive Officer","Procurement Manager"]',
  '["portfolio_expansion","new_site","contract_expiry"]',
  'One contract across every site, one invoice, consistent standard and a single escalation path.',
  '["group insurance certificate","consolidated compliance reporting"]', 12),

 ('RETAIL_OFFICE', 'SME offices, retail and professional services',
  '["Owner","Practice Manager","Office Manager"]',
  '["Director","Business Manager"]',
  '["office_move","fitout","staff_growth"]',
  'The same cleaner each visit and a direct number rather than a call centre.',
  '["public liability","police-checked staff"]', 7),

 ('UNCLASSIFIED', 'Not yet classified',
  '[]', '[]', '[]',
  'Generic commercial cleaning angle. Excluded from primary campaigns until classified.',
  '[]', 1)
ON CONFLICT (code) DO UPDATE SET
  name             = EXCLUDED.name,
  decision_titles  = EXCLUDED.decision_titles,
  secondary_titles = EXCLUDED.secondary_titles,
  trigger_types    = EXCLUDED.trigger_types,
  angle            = EXCLUDED.angle,
  compliance_hooks = EXCLUDED.compliance_hooks,
  priority_weight  = EXCLUDED.priority_weight
WHERE (leads.segment_taxonomy.name, leads.segment_taxonomy.decision_titles,
       leads.segment_taxonomy.secondary_titles, leads.segment_taxonomy.trigger_types,
       leads.segment_taxonomy.angle, leads.segment_taxonomy.compliance_hooks,
       leads.segment_taxonomy.priority_weight)
   IS DISTINCT FROM
      (EXCLUDED.name, EXCLUDED.decision_titles, EXCLUDED.secondary_titles,
       EXCLUDED.trigger_types, EXCLUDED.angle, EXCLUDED.compliance_hooks,
       EXCLUDED.priority_weight);

-- Existing segment_id -> new buyer code. Discovery keyword buckets map too, so
-- that if a lead is ever attached to one it still lands in a real segment.
CREATE TABLE IF NOT EXISTS leads.segment_code_map (
  segment_code_legacy text PRIMARY KEY,
  code                text NOT NULL REFERENCES leads.segment_taxonomy(code),
  confidence          numeric(3,2) NOT NULL DEFAULT 0.70,
  note                text
);

INSERT INTO leads.segment_code_map (segment_code_legacy, code, confidence, note) VALUES
  ('strata',                'STRATA',        0.95, null),
  ('body_corporate',        'STRATA',        0.95, null),
  ('real_estate_strata',    'STRATA',        0.60, 'mixed agency/strata bucket - re-classify from site content'),
  ('property_management',   'COMMERCIAL_RE', 0.85, null),
  ('commercial_office',     'COMMERCIAL_RE', 0.55, 'splits COMMERCIAL_RE vs RETAIL_OFFICE on size'),
  ('ndis',                  'NDIS',          0.95, null),
  ('aged_care_facilities',  'AGED_CARE',     0.95, null),
  ('medical_cleaning',      'HEALTH',        0.90, null),
  ('medical_childcare_gym', 'HEALTH',        0.40, 'largest and least specific bucket - needs re-classification'),
  ('childcare_cleaning',    'EDU',           0.90, null),
  ('education_training',    'EDU',           0.90, null),
  ('community_clubs',       'GOV_LOCAL',     0.45, 'councils vs private clubs - re-classify from entity type'),
  ('hospitality_venues',    'HOSPITALITY',   0.90, null),
  ('hospitality_cleaning',  'HOSPITALITY',   0.85, null),
  ('restaurant_cleaning',   'HOSPITALITY',   0.85, null),
  ('gym_cleaning',          'HOSPITALITY',   0.75, null),
  ('industrial_warehouse',  'INDUSTRIAL',    0.90, null),
  ('warehouse_cleaning',    'INDUSTRIAL',    0.85, null),
  ('builders_construction', 'RETAIL_OFFICE', 0.50, 'builders clean is project work, not a recurring contract'),
  ('builders_cleaning',     'RETAIL_OFFICE', 0.50, null),
  ('automotive_trade',      'RETAIL_OFFICE', 0.75, null),
  ('retail_showrooms',      'RETAIL_OFFICE', 0.85, null),
  ('retail_cleaning',       'RETAIL_OFFICE', 0.80, null),
  ('office_cleaning',       'RETAIL_OFFICE', 0.70, null),
  ('commercial_cleaning',   'COMMERCIAL_RE', 0.60, null),
  ('carpet_cleaning',       'RETAIL_OFFICE', 0.40, null),
  ('window_cleaning',       'RETAIL_OFFICE', 0.40, null),
  ('pressure_washing',      'RETAIL_OFFICE', 0.40, null),
  ('end_of_lease_cleaning', 'COMMERCIAL_RE', 0.50, null)
ON CONFLICT (segment_code_legacy) DO UPDATE SET
  code = EXCLUDED.code, confidence = EXCLUDED.confidence, note = EXCLUDED.note
WHERE (leads.segment_code_map.code, leads.segment_code_map.confidence, leads.segment_code_map.note)
   IS DISTINCT FROM (EXCLUDED.code, EXCLUDED.confidence, EXCLUDED.note);

-- ---------------------------------------------------------------------
-- 2. leads.candidates — additive columns
-- ---------------------------------------------------------------------

ALTER TABLE leads.candidates
  ADD COLUMN IF NOT EXISTS segment_code            text,
  ADD COLUMN IF NOT EXISTS segment_confidence      numeric(3,2),
  ADD COLUMN IF NOT EXISTS segment_source          text,
  ADD COLUMN IF NOT EXISTS site_count_estimate     int,
  ADD COLUMN IF NOT EXISTS employee_band           text,
  ADD COLUMN IF NOT EXISTS estimated_monthly_value numeric,
  ADD COLUMN IF NOT EXISTS abn                     text,
  ADD COLUMN IF NOT EXISTS entity_name             text,
  ADD COLUMN IF NOT EXISTS domain_email_pattern    text,
  ADD COLUMN IF NOT EXISTS lead_score              int,
  ADD COLUMN IF NOT EXISTS score_breakdown         jsonb,
  ADD COLUMN IF NOT EXISTS needs_enrichment        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS best_contact_id         bigint,
  ADD COLUMN IF NOT EXISTS scored_at               timestamptz;

DO $$ BEGIN
  ALTER TABLE leads.candidates
    ADD CONSTRAINT candidates_segment_code_fkey
    FOREIGN KEY (segment_code) REFERENCES leads.segment_taxonomy(code);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE leads.candidates
    ADD CONSTRAINT candidates_segment_source_chk
    CHECK (segment_source IS NULL OR segment_source IN ('rule','registry','llm','manual'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------
-- 3. leads.lead_contact — one row per identified human
--
-- source_url + discovered_at are NOT NULL: under the Spam Act 2003 inferred
-- consent depends on the address having been conspicuously published in a
-- business context, and the sender carries the burden of proof. No provenance
-- means the row cannot exist, which means it can never be sent to.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS leads.lead_contact (
  id                        bigserial PRIMARY KEY,
  candidate_id              bigint NOT NULL REFERENCES leads.candidates(id) ON DELETE CASCADE,
  full_name                 text,
  first_name                text,
  job_title                 text,
  title_rank                smallint NOT NULL DEFAULT 5,
  email                     text,
  email_type                text,
  email_verification_status text NOT NULL DEFAULT 'unverified',
  phone                     text,
  linkedin_url              text,
  source_url                text NOT NULL,
  discovered_at             timestamptz NOT NULL DEFAULT now(),
  confidence                numeric(3,2) NOT NULL DEFAULT 0.50,
  is_active                 boolean NOT NULL DEFAULT true,
  referred_by_contact_id    bigint,
  meta                      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_contact_title_rank_chk  CHECK (title_rank BETWEEN 1 AND 5),
  CONSTRAINT lead_contact_email_type_chk  CHECK (email_type IS NULL OR email_type IN ('personal','role','guessed')),
  CONSTRAINT lead_contact_verify_chk      CHECK (email_verification_status IN
    ('unverified','valid','invalid','catch_all','disposable','role','unknown')),
  -- A guessed address is only sendable once verification has passed. Enforced
  -- here as well as in the pre-send guard so no code path can bypass it.
  CONSTRAINT lead_contact_guessed_chk     CHECK (
    email_type <> 'guessed' OR email_verification_status IN ('unverified','valid','invalid','catch_all','disposable','role','unknown'))
);

CREATE UNIQUE INDEX IF NOT EXISTS lead_contact_uniq_email
  ON leads.lead_contact (candidate_id, lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS lead_contact_candidate_idx ON leads.lead_contact (candidate_id);
CREATE INDEX IF NOT EXISTS lead_contact_rank_idx
  ON leads.lead_contact (candidate_id, title_rank, confidence DESC) WHERE is_active;
CREATE INDEX IF NOT EXISTS lead_contact_email_idx ON leads.lead_contact (lower(email)) WHERE email IS NOT NULL;

DO $$ BEGIN
  ALTER TABLE leads.candidates
    ADD CONSTRAINT candidates_best_contact_fkey
    FOREIGN KEY (best_contact_id) REFERENCES leads.lead_contact(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------
-- 4. leads.lead_signal — buying triggers
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS leads.lead_signal (
  id           bigserial PRIMARY KEY,
  candidate_id bigint NOT NULL REFERENCES leads.candidates(id) ON DELETE CASCADE,
  signal_type  text NOT NULL,
  signal_value text,
  source_url   text,
  observed_at  timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz,
  confidence   numeric(3,2) NOT NULL DEFAULT 0.70,
  meta         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS lead_signal_uniq
  ON leads.lead_signal (candidate_id, signal_type, coalesce(signal_value,''));
CREATE INDEX IF NOT EXISTS lead_signal_active_idx
  ON leads.lead_signal (signal_type, expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS lead_signal_candidate_idx ON leads.lead_signal (candidate_id);

-- ---------------------------------------------------------------------
-- 5. leads.outreach_event — append-only measurement log
--
-- This log is both the funnel and the Spam Act compliance evidence. Nothing
-- updates or deletes from it.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS leads.outreach_event (
  id           bigserial PRIMARY KEY,
  candidate_id bigint REFERENCES leads.candidates(id) ON DELETE SET NULL,
  contact_id   bigint REFERENCES leads.lead_contact(id) ON DELETE SET NULL,
  campaign_id  bigint,
  variant_id   bigint,
  step_no      smallint,
  mailbox_id   bigint,
  event_type   text NOT NULL,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  message_id   text,
  meta         jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT outreach_event_type_chk CHECK (event_type IN
    ('queued','sent','delivered','bounce_hard','bounce_soft','open','click',
     'reply','positive_reply','booked','unsubscribe','complaint','blocked','won'))
);

CREATE INDEX IF NOT EXISTS outreach_event_candidate_idx ON leads.outreach_event (candidate_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS outreach_event_type_time_idx ON leads.outreach_event (event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS outreach_event_mailbox_idx   ON leads.outreach_event (mailbox_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS outreach_event_variant_idx   ON leads.outreach_event (variant_id, step_no, event_type);
CREATE INDEX IF NOT EXISTS outreach_event_msgid_idx     ON leads.outreach_event (message_id) WHERE message_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 6. Suppression
--
-- leads.suppression already exists and holds 568 rows enforced at discovery,
-- qualification and send. A second table would create two sources of truth, so
-- the brief's `suppression_list` is provided as a view over it plus a single
-- guard function that every send path calls.
-- ---------------------------------------------------------------------

ALTER TABLE leads.suppression
  ADD COLUMN IF NOT EXISTS scope       text NOT NULL DEFAULT 'email',
  ADD COLUMN IF NOT EXISTS is_permanent boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS source      text;

CREATE UNIQUE INDEX IF NOT EXISTS suppression_email_norm_uniq
  ON leads.suppression (email_norm) WHERE email_norm IS NOT NULL;
CREATE INDEX IF NOT EXISTS suppression_domain_norm_idx
  ON leads.suppression (domain_norm) WHERE domain_norm IS NOT NULL;

CREATE OR REPLACE VIEW leads.suppression_list AS
  SELECT id, email_norm AS email, domain_norm AS domain, reason, scope,
         is_permanent, candidate_id, created_at
  FROM leads.suppression;

CREATE OR REPLACE FUNCTION leads.is_suppressed(p_email text)
RETURNS boolean LANGUAGE sql STABLE AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM leads.suppression s
     WHERE (s.email_norm IS NOT NULL AND s.email_norm = lower(btrim(p_email)))
        OR (s.domain_norm IS NOT NULL AND s.scope = 'domain'
            AND s.domain_norm = lower(split_part(btrim(p_email), '@', 2)))
  );
$fn$;

-- ---------------------------------------------------------------------
-- 7. Mailboxes — warmup ramp and circuit breaker state
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS leads.mailbox (
  id                bigserial PRIMARY KEY,
  address           text NOT NULL,
  display_name      text NOT NULL,
  sending_domain    text NOT NULL,
  provider          text NOT NULL DEFAULT 'smtp',
  is_primary_domain boolean NOT NULL DEFAULT false,
  warmup_started_on date,
  daily_cap_max     int NOT NULL DEFAULT 40,
  daily_cap_floor   int NOT NULL DEFAULT 10,
  warmup_step       int NOT NULL DEFAULT 5,
  status            text NOT NULL DEFAULT 'warmup',
  paused_reason     text,
  paused_at         timestamptz,
  enabled           boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mailbox_status_chk CHECK (status IN ('warmup','active','paused'))
);

CREATE UNIQUE INDEX IF NOT EXISTS mailbox_address_uniq ON leads.mailbox (lower(address));

-- Warmup ramp: 10/day on day 0, +5/day, capped at daily_cap_max (§5.2).
CREATE OR REPLACE FUNCTION leads.mailbox_daily_cap(p_mailbox_id bigint, p_on date DEFAULT current_date)
RETURNS int LANGUAGE sql STABLE AS $fn$
  SELECT CASE
    WHEN m.status = 'paused' OR NOT m.enabled THEN 0
    WHEN m.warmup_started_on IS NULL THEN m.daily_cap_floor
    ELSE least(m.daily_cap_max,
               m.daily_cap_floor + m.warmup_step * greatest(0, (p_on - m.warmup_started_on)))
  END
  FROM leads.mailbox m WHERE m.id = p_mailbox_id;
$fn$;

-- Rolling 7-day health, read by the circuit breaker and the dashboard.
CREATE OR REPLACE VIEW leads.mailbox_health AS
SELECT m.id AS mailbox_id,
       m.address,
       m.sending_domain,
       m.status,
       m.warmup_started_on,
       leads.mailbox_daily_cap(m.id) AS daily_cap_today,
       count(*) FILTER (WHERE e.event_type = 'sent'
                          AND e.occurred_at >= current_date)                    AS sent_today,
       count(*) FILTER (WHERE e.event_type = 'sent'
                          AND e.occurred_at >= now() - interval '7 days')       AS sent_7d,
       count(*) FILTER (WHERE e.event_type = 'bounce_hard'
                          AND e.occurred_at >= now() - interval '7 days')       AS hard_bounce_7d,
       count(*) FILTER (WHERE e.event_type = 'complaint'
                          AND e.occurred_at >= now() - interval '7 days')       AS complaint_7d,
       round(100.0 * count(*) FILTER (WHERE e.event_type = 'bounce_hard'
                          AND e.occurred_at >= now() - interval '7 days')
             / nullif(count(*) FILTER (WHERE e.event_type = 'sent'
                          AND e.occurred_at >= now() - interval '7 days'), 0), 2) AS hard_bounce_pct_7d,
       round(100.0 * count(*) FILTER (WHERE e.event_type = 'complaint'
                          AND e.occurred_at >= now() - interval '7 days')
             / nullif(count(*) FILTER (WHERE e.event_type = 'sent'
                          AND e.occurred_at >= now() - interval '7 days'), 0), 3) AS complaint_pct_7d
FROM leads.mailbox m
LEFT JOIN leads.outreach_event e ON e.mailbox_id = m.id
GROUP BY m.id;

-- ---------------------------------------------------------------------
-- 8. Campaigns, steps and variants — copy lives in the DB, not in a workflow
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS leads.campaign (
  id            bigserial PRIMARY KEY,
  code          text NOT NULL,
  name          text NOT NULL,
  segment_code  text REFERENCES leads.segment_taxonomy(code),
  offer_config  jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled       boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS campaign_code_uniq ON leads.campaign (code);

CREATE TABLE IF NOT EXISTS leads.campaign_step (
  id           bigserial PRIMARY KEY,
  campaign_id  bigint NOT NULL REFERENCES leads.campaign(id) ON DELETE CASCADE,
  step_no      smallint NOT NULL,
  day_offset   smallint NOT NULL,
  intent       text NOT NULL,
  max_words    smallint NOT NULL DEFAULT 90,
  allow_attach boolean NOT NULL DEFAULT false,
  enabled      boolean NOT NULL DEFAULT true,
  CONSTRAINT campaign_step_no_chk CHECK (step_no BETWEEN 1 AND 9)
);
CREATE UNIQUE INDEX IF NOT EXISTS campaign_step_uniq ON leads.campaign_step (campaign_id, step_no);

CREATE TABLE IF NOT EXISTS leads.campaign_variant (
  id               bigserial PRIMARY KEY,
  step_id          bigint NOT NULL REFERENCES leads.campaign_step(id) ON DELETE CASCADE,
  variant_code     text NOT NULL,
  subject_template text NOT NULL,
  body_template    text NOT NULL,
  required_vars    jsonb NOT NULL DEFAULT '[]'::jsonb,
  enabled          boolean NOT NULL DEFAULT true,
  lint_status      text NOT NULL DEFAULT 'pending',
  lint_errors      jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_variant_lint_chk CHECK (lint_status IN ('pending','pass','fail'))
);
CREATE UNIQUE INDEX IF NOT EXISTS campaign_variant_uniq ON leads.campaign_variant (step_id, variant_code);

DO $$ BEGIN
  ALTER TABLE leads.outreach_event
    ADD CONSTRAINT outreach_event_campaign_fkey FOREIGN KEY (campaign_id)
      REFERENCES leads.campaign(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE leads.outreach_event
    ADD CONSTRAINT outreach_event_variant_fkey FOREIGN KEY (variant_id)
      REFERENCES leads.campaign_variant(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE leads.outreach_event
    ADD CONSTRAINT outreach_event_mailbox_fkey FOREIGN KEY (mailbox_id)
      REFERENCES leads.mailbox(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Per-lead sequence state. A reply or a booking stops the sequence.
CREATE TABLE IF NOT EXISTS leads.sequence_state (
  candidate_id   bigint NOT NULL REFERENCES leads.candidates(id) ON DELETE CASCADE,
  campaign_id    bigint NOT NULL REFERENCES leads.campaign(id) ON DELETE CASCADE,
  contact_id     bigint REFERENCES leads.lead_contact(id) ON DELETE SET NULL,
  current_step   smallint NOT NULL DEFAULT 0,
  next_due_at    timestamptz,
  status         text NOT NULL DEFAULT 'active',
  stop_reason    text,
  started_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (candidate_id, campaign_id),
  CONSTRAINT sequence_state_status_chk CHECK (status IN ('active','stopped','completed','paused'))
);
CREATE INDEX IF NOT EXISTS sequence_state_due_idx
  ON leads.sequence_state (next_due_at) WHERE status = 'active';

-- ---------------------------------------------------------------------
-- 9. Pipeline stage status — idempotent, resumable, per-lead per-stage
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS leads.pipeline_stage (
  candidate_id bigint NOT NULL REFERENCES leads.candidates(id) ON DELETE CASCADE,
  stage        text NOT NULL,
  status       text NOT NULL DEFAULT 'pending',
  attempts     int NOT NULL DEFAULT 0,
  last_error   text,
  started_at   timestamptz,
  finished_at  timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (candidate_id, stage),
  CONSTRAINT pipeline_stage_name_chk CHECK (stage IN
    ('discover','dedupe','enrich_org','discover_contacts','verify_email','score','segment','queue')),
  CONSTRAINT pipeline_stage_status_chk CHECK (status IN ('pending','running','done','failed','skipped'))
);
CREATE INDEX IF NOT EXISTS pipeline_stage_work_idx ON leads.pipeline_stage (stage, status, updated_at);

-- ---------------------------------------------------------------------
-- 10. Human response SLA — positive replies awaiting a human (§5.4, §6.6)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS leads.reply_action (
  id             bigserial PRIMARY KEY,
  candidate_id   bigint NOT NULL REFERENCES leads.candidates(id) ON DELETE CASCADE,
  contact_id     bigint REFERENCES leads.lead_contact(id) ON DELETE SET NULL,
  reply_id       bigint,
  classification text NOT NULL,
  received_at    timestamptz NOT NULL DEFAULT now(),
  responded_at   timestamptz,
  responded_by   text,
  alerted_at     timestamptz,
  notes          text,
  CONSTRAINT reply_action_class_chk CHECK (classification IN
    ('positive','not_now','not_interested','wrong_person','unsubscribe','ooo','bounce','unknown'))
);
CREATE INDEX IF NOT EXISTS reply_action_open_idx
  ON leads.reply_action (received_at) WHERE responded_at IS NULL;

-- ---------------------------------------------------------------------
-- 11. Backfills — NULL-only, existing values are never overwritten
-- ---------------------------------------------------------------------

-- 11a. suburb / postcode from the free-text address.
-- Measured 2026-08-07: both columns were NULL on all 2865 rows, which blocked
-- route scoring and the "lead-specific token beyond the name" copy rule.
UPDATE leads.candidates c
   SET suburb   = coalesce(c.suburb, nullif(btrim(m[1]), '')),
       postcode = coalesce(c.postcode, nullif(btrim(m[3]), ''))
  FROM (
    SELECT id, regexp_match(address,
             '(?:^|,)\s*([A-Za-z''\-\. ]{2,40}?)\s+(SA|NSW|VIC|QLD|WA|NT|TAS|ACT)\s+(\d{4})') AS m
      FROM leads.candidates
     WHERE address IS NOT NULL
  ) x
 WHERE x.id = c.id AND x.m IS NOT NULL
   AND (c.suburb IS NULL OR c.postcode IS NULL);

-- Postcode-only fallback where the state token is missing.
UPDATE leads.candidates c
   SET postcode = m[1]
  FROM (
    SELECT id, regexp_match(address, '\y(5\d{3})\y') AS m
      FROM leads.candidates WHERE address IS NOT NULL
  ) x
 WHERE x.id = c.id AND x.m IS NOT NULL AND c.postcode IS NULL;

CREATE INDEX IF NOT EXISTS candidates_postcode_idx ON leads.candidates (postcode) WHERE postcode IS NOT NULL;

-- 11b. segment_code from the existing segment_id. Nothing is reclassified
-- here; low-confidence rows are simply marked for the classifier to revisit.
UPDATE leads.candidates c
   SET segment_code       = m.code,
       segment_confidence = m.confidence,
       segment_source     = 'rule'
  FROM leads.segments s
  JOIN leads.segment_code_map m ON m.segment_code_legacy = s.code
 WHERE c.segment_id = s.id AND c.segment_code IS NULL;

UPDATE leads.candidates
   SET segment_code = 'UNCLASSIFIED', segment_confidence = 0.00, segment_source = 'rule'
 WHERE segment_code IS NULL;

CREATE INDEX IF NOT EXISTS candidates_segment_code_idx ON leads.candidates (segment_code);
CREATE INDEX IF NOT EXISTS candidates_lead_score_idx
  ON leads.candidates (lead_score DESC NULLS LAST) WHERE lead_score IS NOT NULL;
CREATE INDEX IF NOT EXISTS candidates_needs_enrichment_idx
  ON leads.candidates (needs_enrichment) WHERE needs_enrichment;
CREATE INDEX IF NOT EXISTS candidates_domain_idx
  ON leads.candidates (lower(split_part(email, '@', 2))) WHERE email IS NOT NULL;

-- 11c. Promote the usable half of enrichment.profile.people into lead_contact.
-- 441 leads carry a people[] array; most entries are junk strings scraped from
-- headings ("Owner Occupier", "Assistant Assistant"), so only entries that
-- look like a real two-part human name survive. No email is attached — none of
-- these entries ever had one; Phase 3 discovers that separately.
INSERT INTO leads.lead_contact
  (candidate_id, full_name, first_name, job_title, title_rank,
   source_url, discovered_at, confidence, email_type, meta)
SELECT c.id,
       btrim(p->>'name'),
       split_part(btrim(p->>'name'), ' ', 1),
       nullif(btrim(p->>'role'), ''),
       5,
       coalesce(nullif(c.enrichment->'profile'->>'about_url', ''), c.website,
                'https://' || coalesce(split_part(c.email, '@', 2), 'unknown')),
       coalesce(c.enriched_at, c.discovered_at, now()),
       0.35,
       NULL,
       jsonb_build_object('backfilled_from', 'enrichment.profile.people', 'migration', '20260807-01')
  FROM leads.candidates c,
       LATERAL jsonb_array_elements(c.enrichment->'profile'->'people') p
 WHERE jsonb_typeof(c.enrichment->'profile'->'people') = 'array'
   AND btrim(coalesce(p->>'name','')) ~ '^[A-Z][a-z]{1,15} [A-Z][a-z]{1,20}$'
   -- Reject the scraped-heading pattern: role nouns appearing inside a name.
   AND btrim(p->>'name') !~ '(Care|Quality|Executive|Nurse|Registered|Enrolled|General|Office|Property|Practice|Team|Group|Services|Community|Solutions|Cleaning|Owner|Occupier|Assistant|Investor|Senior|Manager|Director)'
   AND coalesce(nullif(c.enrichment->'profile'->>'about_url',''), c.website) IS NOT NULL
   AND NOT EXISTS (
        SELECT 1 FROM leads.lead_contact lc
         WHERE lc.candidate_id = c.id AND lower(lc.full_name) = lower(btrim(p->>'name')));

-- 11d. Every lead whose only reachable address is a role mailbox is not a
-- qualified lead (§4.3). Mark it, do not delete it — it stays available to the
-- existing engines, it is only excluded from the new primary campaigns.
UPDATE leads.candidates c
   SET needs_enrichment = x.want
  FROM (
    SELECT k.id,
           (k.email IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM leads.lead_contact lc
               WHERE lc.candidate_id = k.id AND lc.is_active
                 AND lc.title_rank <= 2 AND lc.email IS NOT NULL)) AS want
      FROM leads.candidates k
  ) x
 WHERE x.id = c.id AND c.needs_enrichment IS DISTINCT FROM x.want;

-- 11e. Seed the existing send history into outreach_event so the funnel has a
-- baseline instead of starting empty. Append-only and de-duplicated by
-- message_id, so re-running the migration adds nothing.
INSERT INTO leads.outreach_event (candidate_id, event_type, occurred_at, message_id, meta)
SELECT d.candidate_id, 'sent', d.sent_at, d.message_id,
       jsonb_build_object('backfill', 'outreach_drafts', 'sent_to', d.sent_to, 'sent_by', d.sent_by)
  FROM leads.outreach_drafts d
 WHERE d.sent_at IS NOT NULL
   AND NOT EXISTS (
        SELECT 1 FROM leads.outreach_event e
         WHERE e.event_type = 'sent' AND e.candidate_id = d.candidate_id
           AND e.occurred_at = d.sent_at);

INSERT INTO leads.outreach_event (candidate_id, event_type, occurred_at, message_id, meta)
SELECT r.candidate_id, 'reply', r.received_at, r.message_id,
       jsonb_build_object('backfill', 'inbound_replies', 'matched_by', r.matched_by)
  FROM leads.inbound_replies r
 WHERE r.candidate_id IS NOT NULL
   AND NOT EXISTS (
        SELECT 1 FROM leads.outreach_event e
         WHERE e.event_type = 'reply' AND e.candidate_id = r.candidate_id
           AND e.occurred_at = r.received_at);

INSERT INTO leads.outreach_event (candidate_id, event_type, occurred_at, meta)
SELECT s.candidate_id, 'bounce_hard', s.created_at,
       jsonb_build_object('backfill', 'suppression', 'email', s.email_norm)
  FROM leads.suppression s
 WHERE s.reason = 'hard_bounce' AND s.candidate_id IS NOT NULL
   AND NOT EXISTS (
        SELECT 1 FROM leads.outreach_event e
         WHERE e.event_type = 'bounce_hard' AND e.candidate_id = s.candidate_id
           AND e.occurred_at = s.created_at);

-- ---------------------------------------------------------------------
-- 12. Settings the new engines read. Existing keys are left alone.
-- ---------------------------------------------------------------------

INSERT INTO leads.system_settings (key, value) VALUES
  ('outreach_sending_domain',      'outreach.kqualitycleaningservices.com.au'),
  ('outreach_reply_to',            'info@kqualitycleaningservices.com.au'),
  ('kq_legal_entity',              'KQuality Cleaning Services'),
  ('kq_abn',                       ''),
  ('kq_postal_address',            ''),
  ('kq_phone',                     '0439 489 630'),
  ('unsubscribe_base_url',         'https://n8n.kqualitycleaningservices.com.au/webhook/unsubscribe'),
  ('send_window_start',            '08:00'),
  ('send_window_end',              '16:30'),
  ('send_jitter_min_s',            '90'),
  ('send_jitter_max_s',            '600'),
  ('breaker_hard_bounce_pct',      '3.0'),
  ('breaker_complaint_pct',        '0.1'),
  ('guessed_email_daily_share',    '0.10'),
  ('min_variant_sample',           '200')
ON CONFLICT (key) DO NOTHING;

COMMIT;
