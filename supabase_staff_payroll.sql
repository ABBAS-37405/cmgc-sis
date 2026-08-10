-- =====================================================================
-- CMGC — Staff payroll: employment type, attendance register, salary
-- =====================================================================
-- Paste this whole file into Supabase Dashboard -> SQL Editor and run it.
-- Safe to run twice. See SUPABASE_STAFF_PAYROLL.md for the explanation.
--
-- Covers EVERYONE the college pays:
--   * teaching staff  -> the existing `teachers` table
--   * everyone else   -> the new `staff` table (accounts, office, security,
--                        maintenance, transport — guards and peons included)
--
-- Adds:
--   0. Upgrade path from the earlier teacher-only payroll migration
--   1. Employment type + salary columns on `teachers`
--   2. `staff`             — one row per non-teaching employee
--   3. `staff_attendance`  — one row per person per day (teacher OR staff)
--   4. `college_holidays`  — days the college is closed
--   5. `staff_salaries`    — one row per person per month
--   6. Helper function + RLS for all of it
--
-- This file REPLACES the earlier `supabase_teacher_payroll.sql`. If you already
-- ran that one, section 0 carries your data forward; if you never ran it, this
-- file on its own is everything you need.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. Upgrade path from the teacher-only version
-- ---------------------------------------------------------------------
-- The two payroll tables now serve teachers AND non-teaching staff, so their
-- names no longer say "teacher". `if exists` makes this a no-op both on a fresh
-- database and on a second run.
alter table if exists teacher_attendance rename to staff_attendance;
alter table if exists teacher_salaries   rename to staff_salaries;


-- ---------------------------------------------------------------------
-- 1. Employment type and pay on `teachers`
-- ---------------------------------------------------------------------
alter table teachers add column if not exists employment_type text not null default 'Regular';
alter table teachers add column if not exists monthly_salary  numeric;
alter table teachers add column if not exists per_day_salary  numeric;
alter table teachers add column if not exists joining_date    date;
alter table teachers add column if not exists whatsapp        text;

-- Only the two shapes the payroll code knows how to price.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'teachers_employment_type_check') then
    alter table teachers add constraint teachers_employment_type_check
      check (employment_type in ('Regular', 'Visiting'));
  end if;
end $$;

-- A teacher already on the register with no type set is Regular.
update teachers set employment_type = 'Regular'
where employment_type is null or employment_type = '';


-- ---------------------------------------------------------------------
-- 2. `staff` — the non-teaching register
-- ---------------------------------------------------------------------
-- Deliberately NOT rows in `teachers`. A guard has no subjects, no programs, no
-- portal rights and no login; putting him in `teachers` would drop him into
-- every teacher dropdown in the app — class tests, LMS, assignments, the
-- class-test report. Two rosters, one payroll.
--
-- There is no `user_id` here and no Supabase Auth account: non-teaching staff do
-- not sign in to anything. If that ever changes, copy the `teachers.user_id`
-- pattern rather than inventing a second one.
create table if not exists staff (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  father_name        text,
  cnic               text,
  designation        text not null,          -- 'Accountant', 'Security Guard', ...
  department         text,                   -- must match STAFF_DEPARTMENTS in src/lib/staff.js
  phone              text,
  whatsapp           text,
  address            text,
  emergency_contact  text,
  employment_type    text not null default 'Regular'
                     check (employment_type in ('Regular', 'Visiting')),
  monthly_salary     numeric,
  per_day_salary     numeric,
  joining_date       date,
  is_active          boolean not null default true,
  notes              text,
  created_at         timestamptz not null default now()
);

create index if not exists staff_department_idx on staff (department);
create index if not exists staff_active_idx     on staff (is_active);


-- ---------------------------------------------------------------------
-- 3. Daily attendance register, for teachers and staff alike
-- ---------------------------------------------------------------------
-- Deliberately NOT the students' `attendance` table: that one is keyed to
-- student_id with its own RLS, and mixing staff rows into it would put every
-- salary record behind policies written for a student's percentage.
--
-- Exactly one of `teacher_id` / `staff_id` is set on each row — enforced below,
-- not merely assumed. `ownerColumnFor()` in src/lib/payroll.js picks which.
create table if not exists staff_attendance (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid references teachers(id) on delete cascade,
  staff_id    uuid references staff(id)    on delete cascade,
  date        date not null,
  status      text not null default 'Present'
              check (status in ('Present', 'Absent', 'Leave', 'Half Day')),
  remarks     text,
  created_at  timestamptz not null default now(),
  unique (teacher_id, date)
);

-- Present only when upgrading: the teacher-only table had these two different.
alter table staff_attendance add column if not exists staff_id uuid references staff(id) on delete cascade;
alter table staff_attendance alter column teacher_id drop not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'staff_attendance_owner_check') then
    alter table staff_attendance add constraint staff_attendance_owner_check
      check ((teacher_id is not null) <> (staff_id is not null));
  end if;
end $$;

-- The two unique keys the app upserts against; both are required. NULLs are
-- distinct in a unique index, so teacher rows never collide on (staff_id, date)
-- and staff rows never collide on (teacher_id, date).
create unique index if not exists staff_attendance_staff_date_key on staff_attendance (staff_id, date);

create index if not exists staff_attendance_teacher_idx on staff_attendance (teacher_id, date);
create index if not exists staff_attendance_date_idx    on staff_attendance (date);


-- ---------------------------------------------------------------------
-- 4. College holidays
-- ---------------------------------------------------------------------
-- One row per closed day, college-wide. A day listed here is not a working
-- day: it never deducts from a Regular salary, and a Visiting employee is
-- simply not present so it is unpaid. Sundays are treated as the weekly off in
-- code (`WEEKLY_OFF_DAY` in src/lib/payroll.js) and do NOT need a row here.
create table if not exists college_holidays (
  date        date primary key,
  title       text,
  created_at  timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 5. Monthly salary sheet
-- ---------------------------------------------------------------------
-- Every figure below is recomputed from `staff_attendance` each time the Salary
-- screen opens — the row exists to hold the three things that cannot be
-- recomputed (bonus, other_deduction, notes) and the record of payment. The
-- computed columns are stored as a snapshot of what was actually shown and
-- sent, exactly like report_log snapshots the percentages it messaged.
create table if not exists staff_salaries (
  id                 uuid primary key default gen_random_uuid(),
  teacher_id         uuid references teachers(id) on delete cascade,
  staff_id           uuid references staff(id)    on delete cascade,
  month              text not null,               -- 'YYYY-MM'
  employment_type    text,
  per_day_rate       numeric default 0,
  working_days       numeric default 0,
  holiday_days       numeric default 0,
  present_days       numeric default 0,
  absent_days        numeric default 0,
  leave_days         numeric default 0,
  half_days          numeric default 0,
  chargeable_days    numeric default 0,
  base_amount        numeric default 0,
  absence_deduction  numeric default 0,
  bonus              numeric default 0,
  other_deduction    numeric default 0,
  net_payable        numeric default 0,
  paid_amount        numeric default 0,
  status             text not null default 'Unpaid'
                     check (status in ('Unpaid', 'Partially Paid', 'Paid')),
  paid_on            date,
  payment_method     text,
  notes              text,
  recorded_by        uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (teacher_id, month)
);

alter table staff_salaries add column if not exists staff_id uuid references staff(id) on delete cascade;
alter table staff_salaries alter column teacher_id drop not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'staff_salaries_owner_check') then
    alter table staff_salaries add constraint staff_salaries_owner_check
      check ((teacher_id is not null) <> (staff_id is not null));
  end if;
end $$;

create unique index if not exists staff_salaries_staff_month_key on staff_salaries (staff_id, month);

create index if not exists staff_salaries_month_idx   on staff_salaries (month);
create index if not exists staff_salaries_teacher_idx on staff_salaries (teacher_id);


-- ---------------------------------------------------------------------
-- 6. Helper: is this the signed-in teacher's own row?
-- ---------------------------------------------------------------------
-- security definer, like every other helper in SUPABASE_TEACHERS_CLASS_TESTS.md,
-- so reading `teachers` here does not re-trigger that table's own RLS.
-- There is no staff equivalent: staff have no login, so there is no "own row"
-- for them to read.
create or replace function is_this_teacher(tid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from teachers t
    where t.id = tid and t.user_id = auth.uid()
  );
$$;


-- ---------------------------------------------------------------------
-- 7. Row Level Security
-- ---------------------------------------------------------------------
alter table staff             enable row level security;
alter table staff_attendance  enable row level security;
alter table staff_salaries    enable row level security;
alter table college_holidays  enable row level security;

-- Policy names from the teacher-only version, if that migration was applied.
drop policy if exists "teacher_attendance_select" on staff_attendance;
drop policy if exists "teacher_attendance_insert" on staff_attendance;
drop policy if exists "teacher_attendance_update" on staff_attendance;
drop policy if exists "teacher_attendance_delete" on staff_attendance;
drop policy if exists "teacher_salaries_select"   on staff_salaries;
drop policy if exists "teacher_salaries_insert"   on staff_salaries;
drop policy if exists "teacher_salaries_update"   on staff_salaries;
drop policy if exists "teacher_salaries_delete"   on staff_salaries;

-- The non-teaching register is admin-only end to end: nobody in it has a login.
drop policy if exists "staff_select" on staff;
create policy "staff_select" on staff for select to authenticated
using (can_manage_teachers());

drop policy if exists "staff_write" on staff;
create policy "staff_write" on staff for all to authenticated
using (can_manage_teachers()) with check (can_manage_teachers());

-- Pay is not roster data: a teacher may read her OWN attendance and her OWN
-- salary and nobody else's, and a staff row is readable only by whoever may
-- manage staff. Writing is limited to that same gate throughout — the one the
-- Teachers & Staff tab already sits behind.
drop policy if exists "staff_attendance_select" on staff_attendance;
create policy "staff_attendance_select" on staff_attendance for select to authenticated
using (can_manage_teachers() or (teacher_id is not null and is_this_teacher(teacher_id)));

drop policy if exists "staff_attendance_insert" on staff_attendance;
create policy "staff_attendance_insert" on staff_attendance for insert to authenticated
with check (can_manage_teachers());

drop policy if exists "staff_attendance_update" on staff_attendance;
create policy "staff_attendance_update" on staff_attendance for update to authenticated
using (can_manage_teachers()) with check (can_manage_teachers());

drop policy if exists "staff_attendance_delete" on staff_attendance;
create policy "staff_attendance_delete" on staff_attendance for delete to authenticated
using (can_manage_teachers());

drop policy if exists "staff_salaries_select" on staff_salaries;
create policy "staff_salaries_select" on staff_salaries for select to authenticated
using (can_manage_teachers() or (teacher_id is not null and is_this_teacher(teacher_id)));

drop policy if exists "staff_salaries_insert" on staff_salaries;
create policy "staff_salaries_insert" on staff_salaries for insert to authenticated
with check (can_manage_teachers());

drop policy if exists "staff_salaries_update" on staff_salaries;
create policy "staff_salaries_update" on staff_salaries for update to authenticated
using (can_manage_teachers()) with check (can_manage_teachers());

drop policy if exists "staff_salaries_delete" on staff_salaries;
create policy "staff_salaries_delete" on staff_salaries for delete to authenticated
using (can_manage_teachers());

-- Holidays are not secret and every signed-in member of staff needs to read
-- them; only an admin sets them.
drop policy if exists "college_holidays_select" on college_holidays;
create policy "college_holidays_select" on college_holidays for select to anon, authenticated
using (true);

drop policy if exists "college_holidays_write" on college_holidays;
create policy "college_holidays_write" on college_holidays for all to authenticated
using (is_admin_user()) with check (is_admin_user());


-- ---------------------------------------------------------------------
-- 8. Verifying it worked  (read-only — not part of the migration)
-- ---------------------------------------------------------------------
-- select column_name from information_schema.columns
-- where table_name = 'staff_attendance' order by ordinal_position;
-- -- expect both teacher_id and staff_id, both nullable
--
-- select conname, pg_get_constraintdef(oid) from pg_constraint
-- where conname in ('staff_attendance_owner_check', 'staff_salaries_owner_check');
--
-- select tablename, policyname, cmd, roles from pg_policies
-- where tablename in ('staff', 'staff_attendance', 'staff_salaries', 'college_holidays')
-- order by tablename, policyname;
--
-- -- Nothing should ever come back from this: it is the invariant the check
-- -- constraint exists to protect.
-- select count(*) from staff_attendance
-- where (teacher_id is null) = (staff_id is null);


-- ---------------------------------------------------------------------
-- 9. Rollback
-- ---------------------------------------------------------------------
-- drop table if exists staff_salaries;
-- drop table if exists staff_attendance;
-- drop table if exists staff;
-- drop table if exists college_holidays;
-- drop function if exists is_this_teacher(uuid);
-- alter table teachers drop constraint if exists teachers_employment_type_check;
-- alter table teachers drop column if exists employment_type;
-- alter table teachers drop column if exists monthly_salary;
-- alter table teachers drop column if exists per_day_salary;
-- alter table teachers drop column if exists joining_date;
-- alter table teachers drop column if exists whatsapp;
