-- CMGC — Teachers & Class Tests migration
-- Paste this WHOLE file into Supabase Dashboard -> SQL Editor and press Run.
-- Safe to run more than once. Explanation of every part: SUPABASE_TEACHERS_CLASS_TESTS.md
--
-- The only part you may want to remove is the clearly marked OPTIONAL block at the very
-- bottom, which is only needed if you give a teacher the Attendance or Results rights.


-- ============================================================
-- 1. Extend the teachers table
-- ============================================================

alter table teachers add column if not exists user_id    uuid references auth.users(id) on delete set null;
alter table teachers add column if not exists email      text;
alter table teachers add column if not exists subjects   text[] not null default '{}';
alter table teachers add column if not exists programs   text[] not null default '{}';
alter table teachers add column if not exists phone      text;
alter table teachers add column if not exists rights     text[] not null default '{class_tests}';
alter table teachers add column if not exists is_active  boolean not null default true;

create unique index if not exists teachers_user_id_key on teachers (user_id);

-- Carry any existing single `subject` value into the new subjects array
update teachers
set subjects = array[subject]
where subject is not null and subject <> '' and coalesce(array_length(subjects, 1), 0) = 0;


-- ============================================================
-- 2. Class test tables
-- ============================================================

create table if not exists class_tests (
  id             uuid primary key default gen_random_uuid(),
  teacher_id     uuid references teachers(id) on delete set null,
  subject        text not null,
  program        text not null,
  year_of_study  text not null default '1st Year',
  title          text not null,
  test_date      date not null default current_date,
  total_marks    numeric not null default 10,
  created_at     timestamptz not null default now()
);

create table if not exists class_test_marks (
  id             uuid primary key default gen_random_uuid(),
  class_test_id  uuid not null references class_tests(id) on delete cascade,
  student_id     uuid not null references students(id) on delete cascade,
  marks_obtained numeric,
  is_absent      boolean not null default false,
  remarks        text,
  created_at     timestamptz not null default now(),
  unique (class_test_id, student_id)
);

-- Which groups a test actually covered. A normal test holds one program; a combined
-- "All Programs" test holds every group it was conducted for, so the marks list stays
-- correct even if the teacher's assigned programs change later.
alter table class_tests add column if not exists programs text[] not null default '{}';

update class_tests
set programs = array[program]
where coalesce(array_length(programs, 1), 0) = 0 and program is not null and program <> 'All Programs';

create index if not exists class_tests_teacher_idx      on class_tests (teacher_id);
create index if not exists class_tests_lookup_idx       on class_tests (program, year_of_study, subject, test_date desc);
create index if not exists class_test_marks_student_idx on class_test_marks (student_id);
create index if not exists class_test_marks_test_idx    on class_test_marks (class_test_id);


-- ============================================================
-- 3. Helper functions used by the policies below
-- ============================================================

create or replace function is_admin_user()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from admin_profiles where user_id = auth.uid());
$$;

create or replace function can_manage_teachers()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce(
    (select is_super_admin or 'teachers' = any(permissions)
     from admin_profiles where user_id = auth.uid()),
    false
  );
$$;

create or replace function is_staff()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from admin_profiles where user_id = auth.uid())
      or exists (select 1 from teachers where user_id = auth.uid() and coalesce(is_active, true));
$$;

create or replace function teacher_sees_program(prog text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from teachers t
    where t.user_id = auth.uid()
      and coalesce(t.is_active, true)
      and (coalesce(array_length(t.programs, 1), 0) = 0 or prog = any(t.programs))
  );
$$;

create or replace function teacher_can(right_key text, prog text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from teachers t
    where t.user_id = auth.uid()
      and coalesce(t.is_active, true)
      and right_key = any(t.rights)
      and (coalesce(array_length(t.programs, 1), 0) = 0 or prog = any(t.programs))
  );
$$;


-- ============================================================
-- 4. Row Level Security
-- ============================================================

alter table teachers         enable row level security;
alter table class_tests      enable row level security;
alter table class_test_marks enable row level security;

-- teachers: a teacher reads her own row, admins read all; only teacher-managers write
drop policy if exists "teachers_select" on teachers;
drop policy if exists "teachers_insert" on teachers;
drop policy if exists "teachers_update" on teachers;
drop policy if exists "teachers_delete" on teachers;

create policy "teachers_select" on teachers for select to authenticated
using (user_id = auth.uid() or is_admin_user());
create policy "teachers_insert" on teachers for insert to authenticated with check (can_manage_teachers());
create policy "teachers_update" on teachers for update to authenticated using (can_manage_teachers());
create policy "teachers_delete" on teachers for delete to authenticated using (can_manage_teachers());

-- class tests: students read anonymously, only signed-in staff write
drop policy if exists "class_tests_select"      on class_tests;
drop policy if exists "class_tests_insert"      on class_tests;
drop policy if exists "class_tests_update"      on class_tests;
drop policy if exists "class_tests_delete"      on class_tests;
drop policy if exists "class_test_marks_select" on class_test_marks;
drop policy if exists "class_test_marks_insert" on class_test_marks;
drop policy if exists "class_test_marks_update" on class_test_marks;
drop policy if exists "class_test_marks_delete" on class_test_marks;

create policy "class_tests_select"      on class_tests      for select to anon, authenticated using (true);
create policy "class_test_marks_select" on class_test_marks for select to anon, authenticated using (true);

create policy "class_tests_insert" on class_tests for insert to authenticated with check (is_staff());
create policy "class_tests_update" on class_tests for update to authenticated using (is_staff());
create policy "class_tests_delete" on class_tests for delete to authenticated using (is_staff());

create policy "class_test_marks_insert" on class_test_marks for insert to authenticated with check (is_staff());
create policy "class_test_marks_update" on class_test_marks for update to authenticated using (is_staff());
create policy "class_test_marks_delete" on class_test_marks for delete to authenticated using (is_staff());

-- REQUIRED: students_select is scoped to anon only, so without this a teacher sees an
-- empty roster everywhere in her portal.
drop policy if exists "teacher read students" on students;
create policy "teacher read students" on students for select to authenticated
using (teacher_sees_program(students.program));


-- ============================================================
-- OPTIONAL — only if you grant a teacher the Attendance or Results rights.
-- Delete everything below this line if you are not using those two rights.
-- ============================================================

drop policy if exists "teacher scoped write on attendance" on attendance;
create policy "teacher scoped write on attendance" on attendance for all to authenticated
using (
  exists (select 1 from students s where s.id = attendance.student_id and teacher_can('attendance', s.program))
)
with check (
  exists (select 1 from students s where s.id = attendance.student_id and teacher_can('attendance', s.program))
);

drop policy if exists "teacher scoped write on results" on results;
create policy "teacher scoped write on results" on results for all to authenticated
using (
  exists (select 1 from students s where s.id = results.student_id and teacher_can('results', s.program))
)
with check (
  exists (select 1 from students s where s.id = results.student_id and teacher_can('results', s.program))
);
