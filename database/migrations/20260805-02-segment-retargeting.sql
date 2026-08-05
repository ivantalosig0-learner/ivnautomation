-- ============================================================
-- Segment retargeting — 2026-08-05
-- Buyer-intent only. Weights set from observed conversion:
--   real_estate/strata  -> both wins + meeting + negotiation
--   builders            -> 3 in negotiation
--   medical / office    -> replies but no closes  (down-weighted)
-- Terms widened for the 40 km radius (outer metro suburbs).
-- No term may name a cleaning service — that finds competitors.
-- ============================================================
BEGIN;

-- 1. Commercial offices ---------------------------------------
UPDATE leads.segments SET priority_weight = 7, enabled = true, search_terms = '[
  "office building Adelaide CBD","corporate office Adelaide","coworking space Adelaide",
  "serviced offices Adelaide","business centre Adelaide","business park Mawson Lakes SA",
  "accounting firm Adelaide","law firm Adelaide","insurance broker Adelaide",
  "engineering consultancy Adelaide","architecture firm Adelaide","IT company Adelaide",
  "financial planner Adelaide","recruitment agency Adelaide",
  "offices Norwood SA","offices Unley SA","offices Glenelg SA","offices Salisbury SA",
  "offices Modbury SA","offices Marion SA","offices Port Adelaide SA",
  "offices Elizabeth SA","offices Gawler SA","offices Noarlunga SA",
  "offices Golden Grove SA","offices Burnside SA","offices Hindmarsh SA"
]'::jsonb WHERE code = 'commercial_office';

-- 2. Real estate / strata — HIGHEST VALUE, both closed deals ---
UPDATE leads.segments SET priority_weight = 14, enabled = true, search_terms = '[
  "property management Adelaide","strata management Adelaide","body corporate management Adelaide",
  "commercial property management Adelaide","rental property management Adelaide",
  "community title management Adelaide","facilities manager Adelaide",
  "commercial real estate agency Adelaide","real estate agency Adelaide CBD",
  "real estate agency Norwood SA","real estate agency Glenelg SA","real estate agency Prospect SA",
  "real estate agency Salisbury SA","real estate agency Marion SA","real estate agency Modbury SA",
  "real estate agency Unley SA","real estate agency Port Adelaide SA","real estate agency Gawler SA",
  "real estate agency Elizabeth SA","real estate agency Noarlunga SA","real estate agency Mount Barker SA",
  "real estate agency Golden Grove SA","real estate agency Henley Beach SA",
  "apartment building manager Adelaide","retirement village Adelaide"
]'::jsonb WHERE code = 'real_estate_strata';

-- 3. Medical / childcare / gyms — replies but no closes --------
UPDATE leads.segments SET priority_weight = 6, enabled = true, search_terms = '[
  "medical centre Adelaide CBD","medical clinic Salisbury SA","medical clinic Marion SA",
  "medical centre Elizabeth SA","medical centre Gawler SA","medical centre Noarlunga SA",
  "dental clinic Adelaide","dental clinic Norwood SA","specialist consulting rooms Adelaide",
  "radiology clinic Adelaide","pathology collection centre Adelaide","day surgery Adelaide",
  "childcare centre Adelaide","childcare centre Mawson Lakes SA","childcare centre Golden Grove SA",
  "childcare centre Aldinga SA","early learning centre Adelaide","out of school hours care Adelaide",
  "gym Adelaide CBD","gym Glenelg SA","gym Salisbury SA","gym Mount Barker SA",
  "fitness studio Adelaide","pilates studio Adelaide","physiotherapy clinic Adelaide",
  "veterinary clinic Adelaide","allied health clinic Adelaide","psychology clinic Adelaide"
]'::jsonb WHERE code = 'medical_childcare_gym';

-- 4. Builders / construction — 3 deals in negotiation ----------
UPDATE leads.segments SET priority_weight = 12, enabled = true, search_terms = '[
  "commercial builder Adelaide","construction company Adelaide","home builder Adelaide",
  "display homes Adelaide","project home builder Adelaide","renovation builder Adelaide",
  "office fitout company Adelaide","shopfitting Adelaide","civil construction Adelaide",
  "property developer Adelaide","building company Salisbury SA","building company Marion SA",
  "building company Gawler SA","building company Mount Barker SA",
  "construction company Port Adelaide SA","commercial fitout Adelaide",
  "apartment developer Adelaide","land developer Adelaide","builder Aldinga SA",
  "builder Golden Grove SA","construction site office Adelaide"
]'::jsonb WHERE code = 'builders_construction';

-- 5. Hospitality --------------------------------------------
UPDATE leads.segments SET priority_weight = 5, enabled = true, search_terms = '[
  "hotel Adelaide","motel Adelaide","function venue Adelaide","conference centre Adelaide",
  "hotel Glenelg SA","motel Gawler SA","winery cellar door Adelaide Hills",
  "reception venue Adelaide","serviced apartments Adelaide"
]'::jsonb WHERE code = 'hospitality_venues';

-- 6. Education / training -------------------------------------
UPDATE leads.segments SET priority_weight = 7, enabled = true, search_terms = '[
  "private school Adelaide","kindergarten Adelaide","preschool Adelaide",
  "training college Adelaide","registered training organisation Adelaide",
  "driving school Adelaide","tutoring centre Adelaide","private school Mount Barker SA",
  "school Elizabeth SA","school Noarlunga SA","language school Adelaide"
]'::jsonb WHERE code = 'education_training';

-- 7. Retail / showrooms ---------------------------------------
UPDATE leads.segments SET priority_weight = 4, enabled = true, search_terms = '[
  "car dealership Adelaide","furniture showroom Adelaide","bathroom showroom Adelaide",
  "kitchen showroom Adelaide","tile showroom Adelaide","car dealership Elizabeth SA",
  "car dealership Noarlunga SA","homemaker centre Adelaide"
]'::jsonb WHERE code = 'retail_showrooms';

-- 8. NDIS / disability providers (recurring SIL housing) -------
UPDATE leads.segments SET priority_weight = 9, enabled = true, search_terms = '[
  "NDIS provider Adelaide SA","disability support services Adelaide",
  "supported independent living Adelaide","disability accommodation Adelaide",
  "community services organisation Adelaide","respite care Adelaide",
  "disability day program Adelaide","NDIS provider Elizabeth SA","NDIS provider Noarlunga SA"
]'::jsonb WHERE code = 'ndis';

-- 9. Strata (buildings, not cleaners) -------------------------
UPDATE leads.segments SET priority_weight = 12, enabled = true, search_terms = '[
  "strata management Adelaide SA","owners corporation Adelaide",
  "apartment complex Adelaide","residential tower Adelaide",
  "community corporation manager Adelaide","strata manager Glenelg SA",
  "strata manager Norwood SA","strata manager Port Adelaide SA"
]'::jsonb WHERE code = 'strata';

-- 26. Body corporate ------------------------------------------
UPDATE leads.segments SET priority_weight = 11, enabled = true, search_terms = '[
  "body corporate Adelaide","owners corporation management Adelaide SA",
  "community title manager Adelaide","building manager Adelaide"
]'::jsonb WHERE code = 'body_corporate';

-- 27. Property management -------------------------------------
UPDATE leads.segments SET priority_weight = 11, enabled = true, search_terms = '[
  "property manager Adelaide SA","commercial property manager Adelaide",
  "asset management property Adelaide","landlord services Adelaide",
  "property management Gawler SA","property management Mount Barker SA",
  "property management Noarlunga SA"
]'::jsonb WHERE code = 'property_management';

-- 14 -> repurposed: aged care FACILITIES are buyers, not cleaners
UPDATE leads.segments SET code = 'aged_care_facilities', name = 'Aged Care Facilities',
  priority_weight = 10, enabled = true, search_terms = '[
  "aged care facility Adelaide","nursing home Adelaide SA","residential aged care Adelaide",
  "retirement living Adelaide","aged care Elizabeth SA","aged care Marion SA",
  "aged care Golden Grove SA","aged care Mount Barker SA","home care provider Adelaide"
]'::jsonb WHERE code = 'aged_care_cleaning';

-- 16 -> repurposed: industrial / warehouse OCCUPIERS are buyers
UPDATE leads.segments SET code = 'industrial_warehouse', name = 'Industrial / Warehouse',
  priority_weight = 8, enabled = true, search_terms = '[
  "warehouse Adelaide SA","distribution centre Adelaide","logistics company Adelaide",
  "manufacturing company Adelaide","food manufacturer Adelaide","freight company Adelaide",
  "industrial estate Wingfield SA","industrial estate Lonsdale SA",
  "industrial estate Regency Park SA","cold storage Adelaide","packaging company Adelaide"
]'::jsonb WHERE code = 'industrial_cleaning';

-- new: clubs, councils and community facilities ---------------
INSERT INTO leads.segments (code, name, enabled, priority_weight, search_terms) VALUES
 ('community_clubs','Clubs / Community Facilities', true, 8, '[
   "sports club Adelaide","football club Adelaide SA","bowling club Adelaide",
   "community centre Adelaide","community hall Adelaide SA","RSL club Adelaide",
   "golf club Adelaide","swimming centre Adelaide","recreation centre Adelaide",
   "church Adelaide SA","place of worship Adelaide","library Adelaide SA"
 ]'::jsonb),
 ('automotive_trade','Automotive / Trade Premises', true, 6, '[
   "mechanic workshop Adelaide","panel beater Adelaide","tyre shop Adelaide SA",
   "auto service centre Adelaide","trade supplies Adelaide","plumbing supplies Adelaide",
   "electrical wholesaler Adelaide"
 ]'::jsonb)
ON CONFLICT (code) DO UPDATE
  SET enabled = true, priority_weight = EXCLUDED.priority_weight,
      search_terms = EXCLUDED.search_terms;

COMMIT;

-- report
SELECT id, code, priority_weight AS w, jsonb_array_length(search_terms) AS terms
FROM leads.segments WHERE enabled ORDER BY priority_weight DESC, id;
