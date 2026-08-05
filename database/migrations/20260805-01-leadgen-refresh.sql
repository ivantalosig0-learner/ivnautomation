-- ============================================================
-- KQuality lead-gen refresh — 2026-08-05
-- Data layer: competitor exclusion, junk-email purge, hard dedup,
--             CRM refresh + suppression, segment retargeting.
-- Idempotent. Backup: ~/leadgen-refresh-20260805/leads-preRefresh.dump
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1. Normalisation helpers
-- ------------------------------------------------------------

-- Registrable-ish host from a URL: strips scheme, www., path, port.
CREATE OR REPLACE FUNCTION leads.norm_domain(url text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(
    regexp_replace(
      split_part(
        regexp_replace(
          regexp_replace(lower(coalesce(url,'')), '^[a-z]+://', ''),
          '^www\.', ''),
        '/', 1),
      ':\d+$', ''),
    '');
$$;

-- Email normalised for identity comparison (gmail dots/plus folded).
CREATE OR REPLACE FUNCTION leads.norm_email(e text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN e IS NULL OR e = '' THEN NULL
    WHEN split_part(lower(trim(e)),'@',2) IN ('gmail.com','googlemail.com')
      THEN replace(split_part(split_part(lower(trim(e)),'@',1),'+',1), '.', '')
           || '@gmail.com'
    ELSE split_part(lower(trim(e)),'@',1) || '@' || split_part(lower(trim(e)),'@',2)
  END;
$$;

-- Last 9 significant digits of an AU phone number.
CREATE OR REPLACE FUNCTION leads.norm_phone(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(right(regexp_replace(coalesce(p,''), '\D', '', 'g'), 9), '');
$$;

-- Business name stripped of legal suffixes / punctuation for fuzzy identity.
CREATE OR REPLACE FUNCTION leads.norm_name(n text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(trim(regexp_replace(
    regexp_replace(
      regexp_replace(lower(coalesce(n,'')),
        '\m(pty\.?|ltd\.?|limited|inc\.?|incorporated|llc|group|holdings|australia|adelaide|sa|the|and|co\.?)\M', ' ', 'g'),
      '[^a-z0-9 ]', ' ', 'g'),
    '\s+', ' ', 'g')), '');
$$;

-- ------------------------------------------------------------
-- 2. Competitor detector — KQuality is a cleaning company;
--    never contact another cleaning/hygiene services provider.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION leads.is_cleaning_competitor(
  p_name text, p_website text, p_email text
) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT
    -- explicit non-competitor rescues (real SA businesses with "clean" in name)
    NOT (coalesce(p_name,'') ~* '(clean energy|clean seas|cleanskin|clean ?tech|cleanaway|dr\.? *clean *skin)')
    AND (
      -- provider words in the trading name
      coalesce(p_name,'') ~* '(\m(cleaning|cleaners?|cleans|janitorial|janitors?|housekeeping|maids?|sanitation|sanitisers?)\M)'
      OR coalesce(p_name,'') ~* '(pressure ?wash|power ?wash|window ?wash|carpet ?care|steam ?clean|bond ?clean|vacate ?clean|end of lease|tile *(and|&) *grout|washroom services|hygiene services|commercial hygiene|facility services|facilities services|strata clean|jetwash|chem-?dry)'
      -- provider words in the web domain
      OR coalesce(leads.norm_domain(p_website),'') ~* '(clean|janitor|maid|hygiene|washroom|pressurewash|carpetcare|chemdry)'
      -- provider words in the email domain
      OR coalesce(split_part(lower(coalesce(p_email,'')),'@',2),'') ~* '(clean|janitor|maid|hygiene|washroom|chemdry)'
    );
$$;

-- ------------------------------------------------------------
-- 3. Junk / undeliverable email detector
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION leads.is_junk_email(e text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT
    e IS NULL
    OR e = ''
    -- syntax
    OR e !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
    -- placeholder / template domains scraped off website boilerplate
    OR split_part(lower(e),'@',2) IN (
         'domain.com','example.com','example.org','example.net','yourdomain.com',
         'yourcompany.com','email.com','test.com','mydomain.com','company.com',
         'website.com','localhost','sentry.io','wixpress.com','wix.com',
         'squarespace.com','godaddy.com','placeholder.com','yoursite.com')
    -- placeholder local parts
    OR split_part(lower(e),'@',1) IN (
         'user','username','youremail','your-email','your.email','email','example',
         'test','name','firstname','someone','noreply','no-reply','no_reply',
         'donotreply','do-not-reply','mailer-daemon','postmaster','abuse',
         'bounce','bounces','notifications','notification','automated')
    -- asset-scraper artefacts
    OR lower(e) ~ '(\.png|\.jpe?g|\.gif|\.svg|\.webp|@2x|sentry|wixpress|\.min\.)';
$$;

COMMIT;

-- ============================================================
-- 4. Apply exclusions to the existing pool
-- ============================================================
BEGIN;

-- 4a. Competitors -> permanently do-not-contact
UPDATE leads.candidates c
SET do_not_contact = true,
    excluded_from_outreach = true,
    stage = 'disqualified',
    stage_updated_at = now(),
    qualification = c.qualification || jsonb_build_object(
      'excluded_reason','cleaning_competitor',
      'excluded_at', now()::text)
WHERE leads.is_cleaning_competitor(c.business_name, c.website, c.email)
  AND (c.do_not_contact = false OR c.stage <> 'disqualified');

-- 4b. Junk / undeliverable emails -> clear the address, disqualify
UPDATE leads.candidates c
SET email = NULL,
    excluded_from_outreach = true,
    stage = 'disqualified',
    stage_updated_at = now(),
    qualification = c.qualification || jsonb_build_object(
      'excluded_reason','invalid_email',
      'excluded_email', c.email,
      'excluded_at', now()::text)
WHERE c.email IS NOT NULL
  AND leads.is_junk_email(c.email);

COMMIT;

-- ============================================================
-- 5. Hard deduplication — four passes, strongest key first.
--    Winner = lowest id with duplicate_of IS NULL.
-- ============================================================
BEGIN;

-- Pass 1: identical normalised email
WITH g AS (
  SELECT id, min(id) OVER (PARTITION BY leads.norm_email(email)) AS keep_id
  FROM leads.candidates
  WHERE duplicate_of IS NULL AND email IS NOT NULL
)
UPDATE leads.candidates c SET duplicate_of = g.keep_id
FROM g WHERE c.id = g.id AND g.keep_id <> g.id;

-- Pass 2: identical website host
WITH g AS (
  SELECT id, min(id) OVER (PARTITION BY leads.norm_domain(website)) AS keep_id
  FROM leads.candidates
  WHERE duplicate_of IS NULL AND leads.norm_domain(website) IS NOT NULL
)
UPDATE leads.candidates c SET duplicate_of = g.keep_id
FROM g WHERE c.id = g.id AND g.keep_id <> g.id;

-- Pass 3: identical phone
WITH g AS (
  SELECT id, min(id) OVER (PARTITION BY leads.norm_phone(phone)) AS keep_id
  FROM leads.candidates
  WHERE duplicate_of IS NULL AND leads.norm_phone(phone) IS NOT NULL
)
UPDATE leads.candidates c SET duplicate_of = g.keep_id
FROM g WHERE c.id = g.id AND g.keep_id <> g.id;

-- Pass 4: same normalised trading name in the same suburb
WITH g AS (
  SELECT id, min(id) OVER (
           PARTITION BY leads.norm_name(business_name),
                        lower(coalesce(suburb, split_part(address, ',', 2)))
         ) AS keep_id
  FROM leads.candidates
  WHERE duplicate_of IS NULL AND leads.norm_name(business_name) IS NOT NULL
)
UPDATE leads.candidates c SET duplicate_of = g.keep_id
FROM g WHERE c.id = g.id AND g.keep_id <> g.id;

-- Duplicates never go to outreach
UPDATE leads.candidates
SET excluded_from_outreach = true
WHERE duplicate_of IS NOT NULL AND excluded_from_outreach = false;

COMMIT;

-- ============================================================
-- 6. Suppression list — anyone already mailed, bounced, replied,
--    opted out or won. Consulted at send time forever after.
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS leads.suppression (
  id            bigserial PRIMARY KEY,
  email_norm    text,
  domain_norm   text,
  reason        text NOT NULL,
  candidate_id  bigint,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_suppression_email
  ON leads.suppression (email_norm) WHERE email_norm IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_suppression_domain
  ON leads.suppression (domain_norm) WHERE domain_norm IS NOT NULL;

-- everyone we have already emailed (pre-refresh history)
INSERT INTO leads.suppression (email_norm, domain_norm, reason, candidate_id)
SELECT DISTINCT ON (leads.norm_email(d.sent_to))
       leads.norm_email(d.sent_to),
       split_part(lower(d.sent_to),'@',2),
       'contacted_pre_refresh', d.candidate_id
FROM leads.outreach_drafts d
WHERE d.sent_at IS NOT NULL AND d.sent_to IS NOT NULL
ORDER BY leads.norm_email(d.sent_to), d.sent_at DESC
ON CONFLICT (email_norm) DO NOTHING;

-- hard bounces detected in the inbox
INSERT INTO leads.suppression (email_norm, domain_norm, reason)
SELECT DISTINCT leads.norm_email(m[1]), split_part(lower(m[1]),'@',2), 'hard_bounce'
FROM leads.inbound_replies r,
     LATERAL regexp_matches(coalesce(r.body_text,''),
             '([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})', 'g') AS m
WHERE r.subject ILIKE '%Delivery Status Notification%'
   OR r.subject ILIKE '%Undeliverable%'
   OR r.subject ILIKE '%Mail delivery failed%'
ON CONFLICT (email_norm) DO NOTHING;

-- competitors, permanently
INSERT INTO leads.suppression (email_norm, domain_norm, reason, candidate_id)
SELECT DISTINCT ON (leads.norm_email(c.email))
       leads.norm_email(c.email), leads.norm_domain(c.website),
       'cleaning_competitor', c.id
FROM leads.candidates c
WHERE c.email IS NOT NULL
  AND c.qualification->>'excluded_reason' = 'cleaning_competitor'
ORDER BY leads.norm_email(c.email), c.id
ON CONFLICT (email_norm) DO NOTHING;

-- competitor domains with no email still block by domain
INSERT INTO leads.suppression (domain_norm, reason, candidate_id)
SELECT DISTINCT ON (leads.norm_domain(c.website))
       leads.norm_domain(c.website), 'cleaning_competitor_domain', c.id
FROM leads.candidates c
WHERE leads.norm_domain(c.website) IS NOT NULL
  AND c.qualification->>'excluded_reason' = 'cleaning_competitor'
  AND NOT EXISTS (SELECT 1 FROM leads.suppression s
                  WHERE s.domain_norm = leads.norm_domain(c.website))
ORDER BY leads.norm_domain(c.website), c.id;

COMMIT;

-- ============================================================
-- 7. CRM refresh — keep real commercial history, clear the rest.
--    Preserved stages: won, replied, negotiation, meeting.
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS leads.crm_records_archive_20260805
  AS SELECT * FROM leads.crm_records WHERE false;
INSERT INTO leads.crm_records_archive_20260805
SELECT * FROM leads.crm_records
WHERE stage NOT IN ('won','replied','negotiation','meeting');

DELETE FROM leads.crm_stage_history h
USING leads.crm_records r
WHERE h.candidate_id = r.candidate_id
  AND r.stage NOT IN ('won','replied','negotiation','meeting');

DELETE FROM leads.crm_records
WHERE stage NOT IN ('won','replied','negotiation','meeting');

-- clear stale pipeline artefacts (drafts/queue/followups/notifications)
DELETE FROM leads.outreach_queue;
DELETE FROM leads.outreach_followups
WHERE candidate_id NOT IN (SELECT candidate_id FROM leads.crm_records);
DELETE FROM leads.outreach_drafts
WHERE candidate_id NOT IN (SELECT candidate_id FROM leads.crm_records);
DELETE FROM leads.notifications WHERE read_at IS NOT NULL OR created_at < now() - interval '3 days';

-- reset every non-preserved candidate back into the funnel
UPDATE leads.candidates c
SET stage = CASE WHEN c.stage IN ('disqualified') THEN 'disqualified'
                 WHEN c.enriched_at IS NOT NULL THEN 'enriched'
                 ELSE 'discovered' END,
    stage_updated_at = now(),
    qualification_score = NULL,
    qualified_at = NULL,
    shortlist_rank = NULL
WHERE c.duplicate_of IS NULL
  AND c.do_not_contact = false
  AND NOT EXISTS (SELECT 1 FROM leads.crm_records r WHERE r.candidate_id = c.id);

COMMIT;

-- ============================================================
-- 8. Segments — buyers only. Provider-intent search terms removed.
-- ============================================================
BEGIN;

-- retire every segment whose search terms hunt for cleaning providers
UPDATE leads.segments SET enabled = false
WHERE code IN ('commercial_cleaning','office_cleaning','medical_cleaning',
               'childcare_cleaning','aged_care_cleaning','gym_cleaning',
               'industrial_cleaning','warehouse_cleaning','hospitality_cleaning',
               'restaurant_cleaning','retail_cleaning','pressure_washing',
               'window_cleaning','carpet_cleaning','end_of_lease_cleaning',
               'builders_cleaning');

COMMIT;

-- ============================================================
-- 9. Settings
-- ============================================================
INSERT INTO leads.system_settings (key, value) VALUES
  ('daily_send_cap','15'),
  ('qualification_threshold','60'),
  ('discovery_radius_m','40000'),
  ('domain_contact_cooldown_days','90')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
