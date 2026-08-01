-- CMGC — Student asks, admin approves, student edits her own form
-- Paste this WHOLE file into Supabase Dashboard -> SQL Editor and press Run.
-- Safe to run more than once.
--
-- A student can see her admission record but not change it. If something on it
-- is wrong she raises a request saying what and why; the admin approves it; that
-- opens a time-limited window in which she may correct a fixed set of contact
-- and personal fields herself.
--
-- Read this before changing anything below: students do NOT use Supabase Auth.
-- Every request from the student portal arrives as the anonymous `anon` role, so
-- the database cannot tell one student from another. Two things keep that
-- honest, and both matter:
--
--   1. The policy opens only while an approved, unexpired request exists for
--      THAT student — not for students in general.
--   2. A column-level GRANT caps what may ever be written. Her roll number,
--      password, program, year, B-Form, marks and documents are not in the list,
--      so no request and no policy can reach them.
--
-- Residual risk, stated plainly: during her open window, anyone who knows that
-- student's UUID could write those same contact fields. The window is short and
-- the columns are harmless, which is the trade being made. Closing it properly
-- means giving students real auth accounts.


-- ============================================================
-- 1. The requests table
-- ============================================================
create table if not exists profile_edit_requests (
  id             uuid primary key default gen_random_uuid(),
  student_id     uuid not null references students(id) on delete cascade,
  reason         text not null,
  status         text not null default 'Pending',   -- Pending | Approved | Rejected
  admin_note     text,
  approved_until timestamptz,                       -- how long she may edit for
  reviewed_at    timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists profile_edit_requests_student_idx
  on profile_edit_requests (student_id, created_at desc);

-- One open request at a time — stops the form being used as a message spammer.
create unique index if not exists profile_edit_requests_one_pending
  on profile_edit_requests (student_id)
  where status = 'Pending';

alter table profile_edit_requests enable row level security;


-- ============================================================
-- 2. Who may do what with a request
-- ============================================================
drop policy if exists "student raises edit request" on profile_edit_requests;
create policy "student raises edit request"
on profile_edit_requests for insert
to anon
with check (status = 'Pending');

drop policy if exists "student reads edit requests" on profile_edit_requests;
create policy "student reads edit requests"
on profile_edit_requests for select
to anon
using (true);

-- Same shape as the scoped write policies on students/attendance: a sub-admin
-- only sees requests from girls in the programs assigned to her.
drop policy if exists "admin manages edit requests" on profile_edit_requests;
create policy "admin manages edit requests"
on profile_edit_requests for all
to authenticated
using (
  is_super_admin()
  or exists (
    select 1 from admin_profiles ap
    join students s on s.id = profile_edit_requests.student_id
    where ap.user_id = auth.uid()
      and 'students' = any(ap.permissions)
      and (array_length(ap.allowed_programs, 1) is null or s.program = any(ap.allowed_programs))
  )
)
with check (
  is_super_admin()
  or exists (
    select 1 from admin_profiles ap
    join students s on s.id = profile_edit_requests.student_id
    where ap.user_id = auth.uid()
      and 'students' = any(ap.permissions)
      and (array_length(ap.allowed_programs, 1) is null or s.program = any(ap.allowed_programs))
  )
);

-- The student portal inserts with the anon key, so it needs the table grants too.
grant select, insert on profile_edit_requests to anon;


-- ============================================================
-- 3. The ceiling: which columns a student may ever write
-- ============================================================
-- This is the important half of the design. RLS decides *when* she may write;
-- this decides *what*, and no policy can widen it.
--
-- Deliberately absent: roll_no and password (her login), cnic (her identity),
-- program / year_of_study / subject_combination (enrolment decisions), every
-- matric and board field (academic record), every *_url document, deleted_at.

revoke update on students from anon;

grant update (
  phone,
  phone2,
  whatsapp,
  email,
  address,
  dob,
  nationality,
  religion,
  father_name,
  father_cnic,
  father_occupation,
  monthly_income,
  family_members,
  orphan,
  financial_assistance
) on students to anon;


-- ============================================================
-- 4. The window: when that grant is actually usable
-- ============================================================
-- Without this policy the grant above does nothing at all — anon still has no
-- UPDATE policy on students, so every write is silently dropped.

drop policy if exists "student edits own form while approved" on students;
create policy "student edits own form while approved"
on students for update
to anon
using (
  deleted_at is null
  and exists (
    select 1 from profile_edit_requests r
    where r.student_id = students.id
      and r.status = 'Approved'
      and r.approved_until > now()
  )
)
with check (
  deleted_at is null
  and exists (
    select 1 from profile_edit_requests r
    where r.student_id = students.id
      and r.status = 'Approved'
      and r.approved_until > now()
  )
);


-- ============================================================
-- Verify (run separately, after the above)
-- ============================================================
-- select policyname, roles, cmd from pg_policies
--  where tablename in ('students', 'profile_edit_requests') order by tablename, policyname;
--
-- Which columns anon may write (expect only the 15 granted above):
-- select column_name from information_schema.column_privileges
--  where table_name = 'students' and grantee = 'anon' and privilege_type = 'UPDATE'
--  order by column_name;
