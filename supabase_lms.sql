-- CMGC — LMS: subject-wise material a teacher publishes to her students
-- Paste this WHOLE file into Supabase Dashboard -> SQL Editor and press Run.
-- Safe to run more than once.
--
-- One row per item a teacher puts up for a subject: an old paper, the paper
-- scheme, a recorded lecture, a useful link, or just something she has written
-- out. Every student of that group and subject sees it in her LMS tab.
--
-- A row can carry a file, a link, written text, or any combination — a lecture
-- is usually a YouTube link, a paper scheme is usually a PDF, and a note may be
-- nothing but text.


-- ============================================================
-- 1. The table
-- ============================================================
create table if not exists lms_materials (
  id            uuid primary key default gen_random_uuid(),

  -- Same shape as class_tests: `program` holds a single group or the literal
  -- 'All Programs', and `programs` holds the concrete groups it covers. Always
  -- read `programs` first — reading `program` alone shows a combined item to
  -- nobody.
  program       text not null,
  programs      text[] not null default '{}',
  subject       text not null,
  year_of_study text,                        -- null = both years

  category      text not null,               -- see LMS_CATEGORIES in src/lib/lms.js
  title         text not null,
  body          text,                        -- what the teacher writes out
  link_url      text,                        -- YouTube, Drive, any URL
  file_url      text,                        -- uploaded into the lms-materials bucket
  file_name     text,                        -- original name, for the download label

  teacher_id    uuid references teachers(id) on delete set null,
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index if not exists lms_materials_lookup_idx
  on lms_materials (subject, created_at desc)
  where deleted_at is null;

create index if not exists lms_materials_programs_idx
  on lms_materials using gin (programs);

alter table lms_materials enable row level security;


-- ============================================================
-- 2. Who may read
-- ============================================================
-- Students have no auth account, so this is open to anon exactly like
-- attendance and results are. The portal narrows it to her own group and
-- subjects; the database cannot, because it cannot tell one student from
-- another. Nothing here is private — it is course material meant to be handed
-- out — so that is an acceptable place to land.

drop policy if exists "lms_select_anon" on lms_materials;
create policy "lms_select_anon" on lms_materials for select to anon
using (deleted_at is null);

drop policy if exists "lms_select_staff" on lms_materials;
create policy "lms_select_staff" on lms_materials for select to authenticated
using (is_staff());


-- ============================================================
-- 3. Who may publish
-- ============================================================
-- Unlike class_tests — which settle for a bare is_staff() and leave the scoping
-- to the UI — this checks the publisher is actually entitled to every group the
-- item is aimed at. That "every" matters: a combined item must not be a way to
-- reach a group you were never assigned.

-- Which groups a row is really for. Same rule the app uses: `programs` when it
-- has anything in it, otherwise the single `program`.
create or replace function lms_covered(prog text, progs text[])
returns text[] language sql immutable as $$
  select case when coalesce(array_length(progs, 1), 0) > 0 then progs else array[prog] end;
$$;

-- An admin needs the `lms` permission (or super admin), and the groups must all
-- fall inside her allowed_programs. `<@` is "contained by", and an empty
-- allowed_programs means unrestricted — the same convention the rest of the
-- admin model uses.
create or replace function admin_can_lms(progs text[])
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from admin_profiles ap
    where ap.user_id = auth.uid()
      and (ap.is_super_admin or 'lms' = any(ap.permissions))
      and (coalesce(array_length(ap.allowed_programs, 1), 0) = 0
           or progs <@ ap.allowed_programs)
  );
$$;

drop policy if exists "lms_write_staff" on lms_materials;
create policy "lms_write_staff" on lms_materials for all to authenticated
using (
  admin_can_lms(lms_covered(program, programs))
  or (select bool_and(teacher_can('lms', p))
        from unnest(lms_covered(program, programs)) as p)
)
with check (
  admin_can_lms(lms_covered(program, programs))
  or (select bool_and(teacher_can('lms', p))
        from unnest(lms_covered(program, programs)) as p)
);


-- Existing admins keep working: super admins already pass, and everyone who
-- manages teachers is given the matching LMS permission.
update admin_profiles
   set permissions = array_append(permissions, 'lms')
 where not is_super_admin
   and not ('lms' = any(coalesce(permissions, '{}')))
   and 'teachers' = any(coalesce(permissions, '{}'));


-- ============================================================
-- 4. Give existing teachers the new right
-- ============================================================
-- `rights` is a plain text[], so nothing had to change on the teachers table —
-- but every teacher created before today has no 'lms' in her list and would
-- find the tab missing. This hands it to everyone who can already set class
-- tests; adjust or drop this statement if you would rather grant it by hand
-- from the admin's Teachers tab.

update teachers
   set rights = array_append(rights, 'lms')
 where not ('lms' = any(coalesce(rights, '{}')))
   and 'class_tests' = any(coalesce(rights, '{}'));


-- ============================================================
-- 5. Storage bucket — create this in the dashboard, not here
-- ============================================================
-- Storage -> New bucket
--   Name:   lms-materials
--   Public: yes   (same as admission-documents and assignments)
--
-- Without it, links and written notes still work; only file uploads fail.


-- ============================================================
-- Verify (run separately, after the above)
-- ============================================================
-- select policyname, roles, cmd from pg_policies where tablename = 'lms_materials';
-- select name, rights from teachers order by name;
