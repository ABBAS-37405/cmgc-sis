-- CMGC — One B-Form number, one girl
-- Paste this WHOLE file into Supabase Dashboard -> SQL Editor and press Run.
-- Safe to run more than once.
--
-- Nothing stopped the same B-Form being entered twice: a family could submit the
-- admission form again, or the office could add a student who was already
-- enrolled, and end up with two records for one person — two roll numbers, two
-- fee schedules, attendance split across both.
--
-- The roll number already has a unique index (students_roll_no_key). This gives
-- the B-Form the same protection, in the database itself, so it holds no matter
-- which screen the entry came from.


-- ============================================================
-- 0. Look before you leap — run this FIRST, on its own
-- ============================================================
-- If either query returns rows, the indexes below will fail. Merge or delete the
-- duplicates first, then run the rest of the file.
--
-- select regexp_replace(bform, '[^0-9]', '', 'g') as bform_digits,
--        count(*), string_agg(student_name, ' | ')
--   from applications
--  where deleted_at is null and coalesce(bform, '') <> ''
--    and status is distinct from 'Rejected'
--  group by 1 having count(*) > 1;
--
-- select regexp_replace(cnic, '[^0-9]', '', 'g') as bform_digits,
--        count(*), string_agg(name, ' | ')
--   from students
--  where deleted_at is null and coalesce(cnic, '') <> ''
--  group by 1 having count(*) > 1;


-- ============================================================
-- 1. Applications
-- ============================================================
-- Indexed on the digits alone, so "37407-0651551-0" and "3740706515510" are
-- recognised as the same number however the applicant typed it.
--
-- Two deliberate exemptions:
--   * deleted_at is not null  — a soft-deleted application must not keep the
--     number hostage; deleting it is the admin's way of freeing it up.
--   * status = 'Rejected'     — a rejected applicant is allowed to apply again.

create unique index if not exists applications_bform_unique
  on applications (regexp_replace(bform, '[^0-9]', '', 'g'))
  where deleted_at is null
    and coalesce(bform, '') <> ''
    and status is distinct from 'Rejected';


-- ============================================================
-- 2. Enrolled students
-- ============================================================
-- students.cnic holds the B-Form (the column predates the name). Stricter than
-- the one above: an enrolled girl has no reason to be enrolled twice, whatever
-- her status. Soft-deleted rows are still exempt so a mistaken delete can be
-- undone and a permanent delete genuinely releases the number.

create unique index if not exists students_cnic_unique
  on students (regexp_replace(cnic, '[^0-9]', '', 'g'))
  where deleted_at is null
    and coalesce(cnic, '') <> '';


-- ============================================================
-- Verify (run separately, after the above)
-- ============================================================
-- select indexname from pg_indexes
--  where indexname in ('applications_bform_unique', 'students_cnic_unique');
--
-- Expect 2 rows. The app turns the resulting 23505 errors into a readable
-- message, but it also checks up-front so the applicant is told before she
-- uploads her documents.
