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


-- ============================================================
-- Correction, Aug 2026 — Humanities combination 1
-- ============================================================
-- The first Humanities combination was recorded here as
--   'Economics, Education, Mathematics'
-- and the college's actual combination is
--   'Sociology, Education, Mathematics'.
-- GROUP_COMBINATIONS in src/lib/academics.js is fixed, so the admission form,
-- the admin dropdowns and the public Programs section all offer the right one
-- from now on. Rows already written with the old line are NOT touched by that:
-- the string is what her marks screens read, so it has to be corrected here.
--
-- Read the rows first, and only then run the update — a girl who genuinely
-- studies Economics rather than Sociology would be one of these too, and only
-- the office can tell:
--
--   select id, roll_no, name, year_of_study from students
--    where program = 'Humanities'
--      and subject_combination = 'Economics, Education, Mathematics';
--
--   select id, name, status from applications
--    where program = 'Humanities'
--      and subject_combination = 'Economics, Education, Mathematics';
--
-- Then, for the ones that really are the combination that was mislabelled:
--
--   update students
--      set subject_combination = 'Sociology, Education, Mathematics'
--    where program = 'Humanities'
--      and subject_combination = 'Economics, Education, Mathematics';
--
--   update applications
--      set subject_combination = 'Sociology, Education, Mathematics'
--    where program = 'Humanities'
--      and subject_combination = 'Economics, Education, Mathematics';
--
-- Nothing breaks while these rows are still uncorrected: the old line parses to
-- three subjects Humanities does offer, so she keeps appearing on exactly the
-- sheets she has been appearing on. What changes is that Students -> Edit now
-- shows it as "not one of Humanities's combinations", which is where the office
-- can correct one girl at a time instead of running the update above.
