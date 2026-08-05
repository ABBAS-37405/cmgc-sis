-- CMGC — 1st Year fee revision (2026)
-- Paste this WHOLE file into Supabase Dashboard -> SQL Editor and press Run.
-- Safe to run more than once.
--
-- supabase_fee_plans.sql seeds with `on conflict do nothing`, so re-running it
-- never touches amounts already in the table. This file is the explicit update
-- for the revised 1st Year structure.
--
-- What changes (1st Year only — 2nd Year is deliberately left untouched):
--
--                      Humanities    every other group
--   admission fee      5,000         4,000
--   monthly fee        2,500         3,000   (unchanged)
--   due at admission   15,000        16,000  (admission fee + 4 months)
--   Sep–Apr            2,500/month   3,000/month  (8 separate charges)
--   year total         35,000        40,000
--
-- The "15,000 / 16,000 at admission" is two rows, not one: the admission fee
-- row plus the 4-month instalment, both dated a week after enrolment. Itemised
-- on the student's Fee tab, same sum at the counter.
--
-- The remaining 8 months are one charge per month so a family pays month by
-- month, exactly like the 2nd Year plan already does.


-- ============================================================
-- 1. Everything except Humanities — 4,000 admission, 3,000/month
-- ============================================================

update fee_plans
   set admission_fee = 4000,
       monthly_fee   = 3000,
       total_fee     = 40000,   -- 4000 + 12 x 3000
       installments  = '[{"label":"1st Installment (4 months)","months":4,"due_month":null},
                         {"label":"September","months":1,"due_month":9},
                         {"label":"October","months":1,"due_month":10},
                         {"label":"November","months":1,"due_month":11},
                         {"label":"December","months":1,"due_month":12},
                         {"label":"January","months":1,"due_month":1},
                         {"label":"February","months":1,"due_month":2},
                         {"label":"March","months":1,"due_month":3},
                         {"label":"April","months":1,"due_month":4}]'::jsonb,
       updated_at    = now()
 where year_of_study = '1st Year'
   and program <> 'Humanities';


-- ============================================================
-- 2. Humanities — 5,000 admission, 2,500/month
-- ============================================================

update fee_plans
   set admission_fee = 5000,
       monthly_fee   = 2500,
       total_fee     = 35000,   -- 5000 + 12 x 2500
       installments  = '[{"label":"1st Installment (4 months)","months":4,"due_month":null},
                         {"label":"September","months":1,"due_month":9},
                         {"label":"October","months":1,"due_month":10},
                         {"label":"November","months":1,"due_month":11},
                         {"label":"December","months":1,"due_month":12},
                         {"label":"January","months":1,"due_month":1},
                         {"label":"February","months":1,"due_month":2},
                         {"label":"March","months":1,"due_month":3},
                         {"label":"April","months":1,"due_month":4}]'::jsonb,
       updated_at    = now()
 where year_of_study = '1st Year'
   and program = 'Humanities';


-- ============================================================
-- Verify (run separately, after the above)
-- ============================================================
-- select year_of_study, program, admission_fee, monthly_fee, total_fee,
--        jsonb_array_length(installments) as charges,
--        admission_fee + 4 * monthly_fee  as due_at_admission
--   from fee_plans
--  where year_of_study = '1st Year'
--  order by program;
--
-- Expected: 6 rows, 9 charges each.
--   Humanities            5000 / 2500 / 35000, 15000 due at admission
--   all five other groups 4000 / 3000 / 40000, 16000 due at admission
--
-- 2nd Year must still read 12500 / 2500 / 32500 (2000 / 28500 for Humanities)
-- with 8 charges — this file does not touch it.


-- ============================================================
-- Students already enrolled
-- ============================================================
-- A fee plan only generates charges at enrolment, so nothing above rewrites a
-- schedule already on record. Girls enrolled under the old plan keep their old
-- charges; adjust those from Fee Verification → Unpaid Fees if the college is
-- applying the new rates to them too.
--
-- Note that Fee Settings → "Missing Fee Schedules" will now offer to create the
-- eight new monthly charges for every existing 1st Year student, because it
-- matches by label and "September".."April" are labels they do not have. Only
-- press it if the new plan really applies to them — for a girl already billed
-- under the old three-instalment plan it would bill her twice.
