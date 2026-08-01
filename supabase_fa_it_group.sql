-- CMGC — FA-IT group + subject combinations
-- Paste this WHOLE file into Supabase Dashboard -> SQL Editor and press Run.
-- Safe to run more than once.
--
-- Background: FA-IT is a new group, and both FA-IT and Humanities let the
-- applicant pick one elective combination out of several. That choice needs
-- somewhere to live — hence the two columns below.
--
-- The group NAME itself needs no migration: `students.program`,
-- `admin_profiles.allowed_programs` and `teachers.programs` are plain text /
-- text[] columns with no CHECK constraint, and every RLS policy compares them by
-- value. "FA-IT" starts working the moment the app writes it.


-- The combination the student chose, stored as a readable list, e.g.
-- 'Economics, Computer Science, Civics'. NULL for the groups that offer only one
-- combination (Pre-Engineering, Pre-Medical, ICS, General Science) — there is no
-- choice to record there.
alter table applications add column if not exists subject_combination text;
alter table students     add column if not exists subject_combination text;

comment on column applications.subject_combination is
  'Elective combination picked on the admission form. NULL for single-combination groups.';
comment on column students.subject_combination is
  'Copied from the approved application. NULL for single-combination groups.';


-- ============================================================
-- Verify (run separately, after the above)
-- ============================================================
-- select column_name from information_schema.columns
--  where table_name = 'students' and column_name = 'subject_combination';
--
-- Existing Humanities students predate the choice, so their combination is NULL.
-- To backfill one once you know what she actually studies:
--   update students
--      set subject_combination = 'Economics, Education, Civics'
--    where roll_no = 'CMGC-2026-XXXXX';
