-- CMGC — Assignments
-- Paste this WHOLE file into Supabase Dashboard -> SQL Editor and press Run.
-- Safe to run more than once. Run supabase_teachers_migration.sql first — the
-- policies below use is_staff() / teacher_can() from it.
--
-- A teacher sets an assignment (typed into the portal, or a file she uploads, or
-- both), gives it a window and a total. Students see it on their portal and may
-- upload their solved work. The teacher grades from the same screen: a View
-- button appears beside the marks box for anyone who uploaded, and just the
-- marks box for work handed in on paper.


-- ============================================================
-- 1. assignments — one row per assignment set
-- ============================================================

create table if not exists assignments (
  id             uuid primary key default gen_random_uuid(),
  teacher_id     uuid references teachers(id) on delete set null,
  subject        text not null,
  -- `program` is a readable summary ("ICS", "Multiple Programs"); `programs` is
  -- the authoritative list of groups it was set for. Same split as class_tests.
  program        text not null,
  programs       text[] not null default '{}',
  year_of_study  text not null default '1st Year',
  title          text not null,
  -- The two ways of giving out the work. Either may be null, but not both —
  -- enforced below.
  description    text,
  file_url       text,
  total_marks    numeric not null default 10,
  start_date     date not null default current_date,
  due_date       date not null,
  created_at     timestamptz not null default now(),
  constraint assignments_has_content check (
    coalesce(description, '') <> '' or coalesce(file_url, '') <> ''
  ),
  constraint assignments_dates check (due_date >= start_date)
);


-- ============================================================
-- 2. assignment_submissions — one row per student per assignment
-- ============================================================
-- The row doubles as the grade record: a student who hands in on paper never
-- creates one herself, and the teacher's marks entry creates it for her.

create table if not exists assignment_submissions (
  id             uuid primary key default gen_random_uuid(),
  assignment_id  uuid not null references assignments(id) on delete cascade,
  student_id     uuid not null references students(id) on delete cascade,
  file_url       text,
  submitted_at   timestamptz,
  marks_obtained numeric,
  remarks        text,
  graded_at      timestamptz,
  created_at     timestamptz not null default now(),
  unique (assignment_id, student_id)
);

create index if not exists assignments_lookup_idx    on assignments (year_of_study, subject, due_date desc);
create index if not exists assignments_teacher_idx   on assignments (teacher_id);
create index if not exists submissions_assignment_idx on assignment_submissions (assignment_id);
create index if not exists submissions_student_idx    on assignment_submissions (student_id);


-- ============================================================
-- 3. Storage bucket for assignment files
-- ============================================================
-- Holds both the teacher's question paper and the students' solved work.

insert into storage.buckets (id, name, public)
values ('assignments', 'assignments', true)
on conflict (id) do nothing;

drop policy if exists "assignments_read"   on storage.objects;
drop policy if exists "assignments_upload" on storage.objects;
drop policy if exists "assignments_update" on storage.objects;

-- Students are anonymous sessions, so uploads must allow anon — the same posture
-- the admission-documents and student-profiles buckets already use.
create policy "assignments_read" on storage.objects
  for select to anon, authenticated using (bucket_id = 'assignments');
create policy "assignments_upload" on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'assignments');
create policy "assignments_update" on storage.objects
  for update to anon, authenticated using (bucket_id = 'assignments');


-- ============================================================
-- 4. Row Level Security
-- ============================================================

alter table assignments            enable row level security;
alter table assignment_submissions enable row level security;

drop policy if exists "assignments_select" on assignments;
drop policy if exists "assignments_insert" on assignments;
drop policy if exists "assignments_update" on assignments;
drop policy if exists "assignments_delete" on assignments;

-- Students read assignments from an anonymous session.
create policy "assignments_select" on assignments for select to anon, authenticated using (true);
create policy "assignments_insert" on assignments for insert to authenticated with check (is_staff());
create policy "assignments_update" on assignments for update to authenticated using (is_staff());
create policy "assignments_delete" on assignments for delete to authenticated using (is_staff());

drop policy if exists "submissions_select" on assignment_submissions;
drop policy if exists "submissions_insert" on assignment_submissions;
drop policy if exists "submissions_update" on assignment_submissions;
drop policy if exists "submissions_delete" on assignment_submissions;

create policy "submissions_select" on assignment_submissions for select to anon, authenticated using (true);
-- A student writes her own submission from an anonymous session, so insert and
-- update must allow anon. Marks are written by staff through the same rows —
-- see the security note below.
create policy "submissions_insert" on assignment_submissions for insert to anon, authenticated with check (true);
create policy "submissions_update" on assignment_submissions for update to anon, authenticated using (true);
create policy "submissions_delete" on assignment_submissions for delete to authenticated using (is_staff());


-- ============================================================
-- 5. Security note — please read
-- ============================================================
-- `assignment_submissions` is writable by anon because students have no login of
-- their own (the students table still uses a plaintext password column, not
-- Supabase Auth). RLS therefore cannot tell one student from another, which
-- means in principle someone with the anon key could edit another girl's
-- submission or her marks.
--
-- This is the same weakness the student fee-proof upload already has, and it is
-- a consequence of the student login model rather than of this feature. Closing
-- it properly means moving students onto Supabase Auth, exactly as the teachers
-- migration did for staff — at which point these two policies can be narrowed to
-- `student_id = auth.uid()` for students and is_staff() for marks.


-- ============================================================
-- Verify (run separately, after the above)
-- ============================================================
-- select count(*) from assignments;
-- select count(*) from assignment_submissions;
-- select id, public from storage.buckets where id = 'assignments';
