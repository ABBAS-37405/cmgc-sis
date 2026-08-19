-- =====================================================================
-- Teacher password vault: the only way a super admin can ever quote a
-- teacher's portal password back to her.
-- =====================================================================
--
-- Run this once in the Supabase Dashboard -> SQL Editor. Safe to re-run.
--
-- WHY THIS EXISTS, AND WHAT IT CANNOT DO
--
-- A teacher's login is a real Supabase Auth account. Auth stores a bcrypt
-- hash and nothing else, so a password that has already been set is gone --
-- not hidden, not encrypted somewhere else, gone. No table, no function and
-- no service-role key can read it back. This file therefore does NOT recover
-- anything: it records each password at the moment it is set, from this point
-- on. Every teacher whose login was created before this migration ran shows
-- as "not recorded" until her password is reset.
--
-- WHAT THIS COSTS, STATED PLAINLY
--
-- A working password in plain text is the strongest credential in the system
-- after the service role key: a teacher login reaches student records, marks
-- and attendance. Two things keep it as narrow as it can be made:
--
--   1. It is its own table, not a column on `teachers`. `teachers` is readable
--      by every signed-in teacher (the portal loads her own row, and staff
--      policies read the roster), so a password column there would hand every
--      teacher every other teacher's password. A separate table with its own
--      policy is the only shape where "super admin only" is actually true.
--
--   2. Nobody can write it through the API. There is no insert, update or
--      delete policy below -- not even for a super admin. The only writer is
--      server.js using the service role key, which bypasses RLS, and that
--      happens on exactly two routes: /api/teacher/create and
--      /api/teacher/password. So the stored value can never disagree with the
--      password Auth was actually given.
--
-- The students side needed no migration at all: `students.password` has always
-- been a plain-text column, because a student has no Auth account.


-- ---------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------
-- One row per teacher, keyed by her teachers.id, so there is never a second
-- stale password lying around for the same person. `on delete cascade` is what
-- makes removing a teacher remove her password with her -- server.js deletes
-- the `teachers` row before the auth user, so this goes at the same moment.
create table if not exists teacher_login_passwords (
  teacher_id uuid primary key references teachers(id) on delete cascade,
  password   text not null,
  set_at     timestamptz not null default now(),
  set_by     uuid
);

comment on table teacher_login_passwords is
  'Plain-text copy of the password last set for a teacher''s Supabase Auth login. '
  'Readable only by a super admin; writable only by the service role (server.js).';


-- ---------------------------------------------------------------------
-- 2. Row level security
-- ---------------------------------------------------------------------
alter table teacher_login_passwords enable row level security;

-- Reading is the whole feature, and it is one role wide.
-- is_super_admin() is defined in SUPABASE_ADMIN_ROLES.md; a sub-admin holding
-- the `teachers` permission can still SET a password (through server.js) but
-- can never read one back.
drop policy if exists "super admin reads teacher passwords" on teacher_login_passwords;
create policy "super admin reads teacher passwords"
  on teacher_login_passwords
  for select
  to authenticated
  using (is_super_admin());

-- Deliberately no insert/update/delete policy. RLS denies what no policy
-- allows, so the only writer left is the service role key in server.js.
-- Adding a write policy here would let the browser store a password Auth was
-- never given, which is worse than storing none: the office would read it out
-- to a teacher who then cannot sign in.

-- Defence in depth: the student portal and the public site run as `anon`, and
-- nothing there has any business with this table.
revoke all on teacher_login_passwords from anon;


-- ---------------------------------------------------------------------
-- 3. What to check after running it
-- ---------------------------------------------------------------------
-- As a super admin, the Teachers tab shows a "Password" line on each card:
-- hidden behind an eye button, with Copy next to it. Teachers whose login
-- predates this migration read "Not recorded - use Reset Password". Reset one
-- and the new password appears there immediately.
--
-- As a sub-admin with the `teachers` permission, that line does not render at
-- all, and a direct select returns zero rows rather than an error -- RLS
-- refuses a read as silently as it refuses a write.
