-- CMGC — Taking a girl out of the attendance register (and putting her back)
-- Paste this WHOLE file into Supabase Dashboard -> SQL Editor and press Run.
-- Safe to run more than once.
--
-- Some enrolled girls stop being part of the daily register while their record
-- stays live: a long medical leave, a girl studying privately, one who has
-- effectively stopped coming but is not to be deleted or marked passout. Left in
-- the register she is marked Absent every day by whoever fills it in, and her
-- percentage — the number her parents are sent — collapses for a reason that has
-- nothing to do with her.
--
-- This is NOT a delete and NOT a passout:
--   * `deleted_at`  hides her from every screen (recycle bin).
--   * `is_passout`  says she finished college.
--   * this          says she is enrolled but not in the daily register.
--
-- Her attendance already recorded is never touched. Taking her out stops new
-- marks, it does not rewrite the ones she has.


-- ============================================================
-- 1. The columns — null means she is in the register
-- ============================================================

alter table students add column if not exists attendance_excluded_at     timestamptz;
alter table students add column if not exists attendance_excluded_reason text;

comment on column students.attendance_excluded_at is
  'Set when a super admin takes the student out of the daily attendance register. '
  'Null = she appears in Mark Attendance like everyone else. Her existing attendance rows are kept either way.';
comment on column students.attendance_excluded_reason is
  'Optional note the super admin typed when taking her out — shown on the "Out of Attendance" tab.';

-- The register reads `deleted_at is null and attendance_excluded_at is null`
-- (students_live_idx from supabase_soft_delete.sql covers the first); this one
-- serves the much smaller Out of Attendance list.
create index if not exists students_attendance_excluded_idx
  on students (name) where attendance_excluded_at is not null;


-- ============================================================
-- 2. Only a super admin may set them — enforced here, not in the UI
-- ============================================================
-- protect_student_fields_on_update() already does this for passout / delete /
-- year_of_study (supabase_protect_student_fields.sql). This replaces that
-- function with the same one plus the two new columns, so a sub-admin who
-- reached the endpoint directly is refused by the database rather than by a
-- hidden button. Unlike an RLS refusal, this raises — the UI shows the message.

create or replace function protect_student_fields_on_update()
returns trigger
language plpgsql
security definer
as $$
begin
  -- If caller is super admin, allow everything
  if is_super_admin() then
    return new;
  end if;

  -- For non-super-admins, disallow changes to these columns:
  if (new.is_passout is distinct from old.is_passout)
     or (new.passout_at is distinct from old.passout_at)
     or (new.deleted_at is distinct from old.deleted_at)
     or (new.year_of_study is distinct from old.year_of_study)
  then
    raise exception 'Only super admin may change passout/promote/delete fields on students';
  end if;

  if (new.attendance_excluded_at is distinct from old.attendance_excluded_at)
     or (new.attendance_excluded_reason is distinct from old.attendance_excluded_reason)
  then
    raise exception 'Only super admin may take a student out of the attendance register';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_student_fields on students;
create trigger protect_student_fields
before update on students
for each row
execute function protect_student_fields_on_update();

-- No grant is added for `anon`. The student self-service edit path
-- (supabase_profile_edit_requests.sql) can only write the columns named in its
-- column-level grant, and these two are deliberately not among them — a girl may
-- not take herself out of the register.


-- ============================================================
-- Verify (run separately, after the above)
-- ============================================================
--   select count(*) from students where attendance_excluded_at is not null;   -- 0 to begin with
--
-- As a sub-admin, this must fail with the message above:
--   update students set attendance_excluded_at = now() where id = '<some uuid>';
