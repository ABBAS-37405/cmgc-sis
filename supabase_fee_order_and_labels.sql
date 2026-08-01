-- CMGC — Fee display order + rename "At Admission" to "1st Installment"
-- Paste this WHOLE file into Supabase Dashboard -> SQL Editor and press Run.
-- Safe to run more than once. Run supabase_fee_plans.sql first.


-- ============================================================
-- 1. fees.sort_order — the display order on the student's Fee tab
-- ============================================================
-- Every row created by one enrolment shares an identical `created_at`: Postgres
-- evaluates now() once per statement, so a multi-row INSERT stamps them all the
-- same. Ordering by it is therefore arbitrary — hence an explicit column.
alter table fees add column if not exists sort_order int;

comment on column fees.sort_order is
  'Position within the student''s schedule: 0 = admission fee, then each instalment in order. Null on rows created before fee plans existed.';


-- ============================================================
-- 2. Rename the first 1st-year instalment
-- ============================================================
-- "At Admission" described *when* it was due, which read oddly next to "2nd
-- Installment" and "3rd Installment". The charge is the first of three.

update fee_plans
   set installments = jsonb_set(installments, '{0,label}', '"1st Installment"'),
       updated_at = now()
 where year_of_study = '1st Year'
   and installments -> 0 ->> 'label' = 'At Admission';

-- Fees already created for enrolled students carry the old label.
update fees
   set label = '1st Installment'
 where label = 'At Admission';


-- ============================================================
-- 3. Backfill sort_order on existing rows
-- ============================================================
-- Only the 1st-year labels need it. Second-year monthly charges and older
-- unlabelled rows sort correctly by due date on their own.
update fees set sort_order = 0 where label = 'Admission Fee'   and sort_order is null;
update fees set sort_order = 1 where label = '1st Installment' and sort_order is null;
update fees set sort_order = 2 where label = '2nd Installment' and sort_order is null;
update fees set sort_order = 3 where label = '3rd Installment' and sort_order is null;


-- ============================================================
-- Verify (run separately, after the above)
-- ============================================================
-- select label, amount_due, due_date, sort_order
--   from fees
--  where label is not null
--  order by due_date, sort_order;
--
-- Expected for a 1st-year student:
--   Admission Fee     0
--   1st Installment   1
--   2nd Installment   2
--   3rd Installment   3
--
-- select year_of_study, program, installments -> 0 ->> 'label' as first_label
--   from fee_plans where year_of_study = '1st Year';
-- Expected: every row says "1st Installment".
