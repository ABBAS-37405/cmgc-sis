-- CMGC — "Left" register for teachers and non-teaching staff
-- Paste this WHOLE file into Supabase Dashboard -> SQL Editor and press Run.
-- Safe to run more than once. See SUPABASE_STAFF_LEFT.md for the reasoning.

alter table teachers add column if not exists left_date date;
alter table staff    add column if not exists left_date date;

comment on column teachers.left_date is
  'Set when the teacher leaves the college. Null = on the active Teachers list.';
comment on column staff.left_date is
  'Set when the employee leaves the college. Null = on the active staff list.';

-- No RLS changes: the existing update policies on `teachers` and `staff`
-- already cover this column, exactly as they do for `is_active`.
