-- =====================================================================
-- 20260807-03-contact-cleanup.sql
--
-- The 943 contacts backfilled by 20260807-01 were filtered with an early,
-- looser name test. Measuring the extractor against 28 live sites showed that
-- test was wrong in a specific way: a mis-split heading ("Angelique — Operations
-- Manager") survives as the "name" Angelique Operations. contacts.js now
-- rejects any name containing a job-title noun; this applies the same rule to
-- what is already stored.
--
-- Rows are deactivated, never deleted: the source_url and discovered_at on them
-- are consent provenance, and a deleted row cannot be audited. is_active=false
-- is already what every send query and the coverage view filter on.
--
-- Idempotent and additive.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION leads.is_person_name(p_name text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $fn$
  SELECT p_name IS NOT NULL
     AND length(btrim(p_name)) BETWEEN 5 AND 45
     -- Two or three capitalised words, the shape a real name takes.
     AND btrim(p_name) ~ '^[A-Z][a-z''\-]{1,15}( [A-Z][a-z''\-]{1,20}){1,2}$'
     -- Any job-title noun in the string means it is a heading, not a person.
     AND btrim(p_name) !~* '\y(manager|managers|director|directors|officer|officers|coordinator|consultant|advisor|adviser|specialist|lead|leader|head|chief|executive|assistant|administrator|supervisor|principal|partner|associate|agent|agents|operations|operation|property|properties|practice|sales|service|services|support|success|member|membership|client|clients|customer|account|accounts|finance|financial|marketing|business|facilities|facility|site|sites|venue|store|branch|regional|national|area|senior|junior|licensed|registered|enrolled|general|team|group|office|quality|care|nurse|nursing|community|solutions|cleaning|company|centre|center|compliance|safety|risk|people|talent|project|projects|development|delivery|digital|design|strata|investor|owner|occupier|tenant|landlord|contact|enquiries|reception|welcome|about|home|our|meet|read|more)\y'
     AND btrim(p_name) !~* '\y(pty|ltd|inc|llc|and|the|of|for)\y';
$fn$;

/*
 * Two passes, and the second one is the important one.
 *
 * First: anything whose name fails the person test outright.
 *
 * Second: the whole cohort backfilled from enrichment.profile.people. Widening
 * the blocklist was catching "Angelique Operations" and still passing "Menu
 * Overview", "What We" and "Physiotherapist Rhiannon", because the defect is
 * not spelling — it is provenance. Those rows were produced by a scraper that
 * split headings on whitespace with no title adjacency and no email, so there
 * is no evidence any of them is a person. None of them can be emailed anyway
 * (title_rank 5, email NULL), so their only value was as re-crawl seeds, and
 * contacts.js now finds better seeds from the same pages.
 *
 * Deactivating the cohort leaves lead_contact honestly near-empty. That is the
 * true state of the database and it is what the coverage panel should show —
 * a table that looks populated with unverifiable rows is worse than an empty
 * one, because it hides the work still to do.
 */
UPDATE leads.lead_contact lc
   SET is_active = false,
       meta = lc.meta || jsonb_build_object('deactivated_reason', 'name_failed_person_test',
                                            'deactivated_by', '20260807-03')
 WHERE lc.is_active
   AND NOT leads.is_person_name(lc.full_name);

UPDATE leads.lead_contact lc
   SET is_active = false,
       meta = lc.meta || jsonb_build_object('deactivated_reason', 'unsound_provenance_people_array',
                                            'deactivated_by', '20260807-03')
 WHERE lc.is_active
   AND lc.meta->>'backfilled_from' = 'enrichment.profile.people';

-- needs_enrichment is derived from active rank 1-2 contacts, so it has to be
-- recomputed after any change to is_active. Same self-correcting form as 11d.
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

COMMIT;
