-- ============================================================
-- CMGC — a third employment type: "Fix Pay"
-- ============================================================
--
-- Run this in the Supabase SQL editor on a database that has already run
-- `supabase_staff_payroll.sql`. On a fresh database it is unnecessary: that file
-- now carries all three values itself, and this one is a no-op there.
--
-- WHAT CHANGES: nothing but two check constraints. No new column, no new table,
-- no policy touched. `employment_type` on `teachers` and on `staff` accepts
-- 'Fix Pay' alongside 'Regular' and 'Visiting'.
--
-- WHY IT IS ONLY A CONSTRAINT: there are three employment types but still only
-- two pay shapes, and Fix Pay is on the one that already exists.
--
--   Regular   monthly salary; the first leave/absence each month is free, every
--   Fix Pay   day after costs monthly_salary / that month's working days.
--             The two are priced by the SAME code and read the SAME column
--             (`monthly_salary`). Fix Pay records the terms someone is engaged
--             on — fixed pay rather than the regular establishment — and the
--             college asked for it as a status, not as a different salary rule.
--
--   Visiting  present days x per_day_salary. No deduction, because nothing was
--             owed for a day not worked.
--
-- So `src/lib/payroll.js` branches on `isPerDayType()`, never on the type name,
-- and adding this value changed no arithmetic anywhere. `EMPLOYMENT_TYPES` in
-- that file and the allow-list in `server.js` (POST /api/teacher/create) are the
-- other two places these three strings are written down; all three must agree.
--
-- `staff_salaries.employment_type` is a plain text snapshot of what was used to
-- price a month and deliberately carries no constraint, so it needs nothing.

-- ------------------------------------------------------------
-- 1. Teaching staff
-- ------------------------------------------------------------
alter table teachers drop constraint if exists teachers_employment_type_check;
alter table teachers add constraint teachers_employment_type_check
  check (employment_type in ('Regular', 'Visiting', 'Fix Pay'));

-- ------------------------------------------------------------
-- 2. Non-teaching staff
-- ------------------------------------------------------------
-- The original constraint here was written inline in `create table`, so Postgres
-- named it for us — `staff_employment_type_check`. `if exists` keeps this safe
-- if it was ever named something else by hand.
alter table staff drop constraint if exists staff_employment_type_check;
alter table staff add constraint staff_employment_type_check
  check (employment_type in ('Regular', 'Visiting', 'Fix Pay'));

-- ------------------------------------------------------------
-- 3. Check
-- ------------------------------------------------------------
-- Both rows should list all three values.
-- select conrelid::regclass as table_name, pg_get_constraintdef(oid)
-- from pg_constraint
-- where conname in ('teachers_employment_type_check', 'staff_employment_type_check');

-- ------------------------------------------------------------
-- Rollback
-- ------------------------------------------------------------
-- Only safe once nobody is on Fix Pay — move them to Regular first, since the
-- two price identically and nobody's salary changes:
--
--   update teachers set employment_type = 'Regular' where employment_type = 'Fix Pay';
--   update staff    set employment_type = 'Regular' where employment_type = 'Fix Pay';
--   alter table teachers drop constraint if exists teachers_employment_type_check;
--   alter table teachers add constraint teachers_employment_type_check
--     check (employment_type in ('Regular', 'Visiting'));
--   alter table staff drop constraint if exists staff_employment_type_check;
--   alter table staff add constraint staff_employment_type_check
--     check (employment_type in ('Regular', 'Visiting'));
