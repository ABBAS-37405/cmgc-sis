-- ============================================================
-- Notices: an attachment, a body, and an audience
-- ============================================================
--
-- Run this whole file once in the Supabase SQL editor.
--
-- Three things the notice board could not do before:
--
--   1. Carry a file. A notice saying "the date sheet is out" is only half the
--      message; the date sheet itself was being sent round on WhatsApp by hand,
--      photographed off a wall. `file_url` / `file_name` and the `notice-files`
--      bucket below put the PDF on the notice itself.
--
--   2. Say anything longer than a title. `notices` had exactly one text column,
--      so every announcement had to be compressed into a headline. `body` is the
--      optional paragraph under it.
--
--   3. Be addressed to the staff rather than to the college. The office needs to
--      send teachers an instruction — a meeting, a marks deadline, an invigilation
--      duty — that is nobody's business on the public board.
--
-- On (3): CLAUDE.md records "notices has no audience column" as a design decision,
-- and it was the right one while every notice really did go to the college. The
-- column added here is deliberately the smallest possible retreat from it:
-- `audience` is 'all' by default, so every row that already exists, and every
-- ordinary notice posted from now on, behaves exactly as it always has. The only
-- new value is 'teachers'. There is still no per-group or per-student audience,
-- and there should not be one — that is what the LMS and the class screens are for.
--
-- **The scoping is in the database, not in the browser.** A teachers-only
-- instruction must not be readable by an anonymous visitor, and until now the
-- select policy on `notices` was open to anon with no condition at all — which was
-- correct when every row was public and is a leak the moment one is not. The
-- policies are therefore rebuilt below: anon sees `audience = 'all'`, signed-in
-- staff see everything.


-- ------------------------------------------------------------
-- 1. Columns
-- ------------------------------------------------------------

alter table notices add column if not exists body       text;
alter table notices add column if not exists file_url   text;
alter table notices add column if not exists file_name  text;
alter table notices add column if not exists audience   text not null default 'all';

-- Only two audiences exist and the app depends on that: 'teachers' is what the
-- public board and the student portal filter out, and anything else would be
-- filtered out of both and visible to nobody.
alter table notices drop constraint if exists notices_audience_check;
alter table notices add  constraint notices_audience_check
  check (audience in ('all', 'teachers'));

-- The board is always read newest-first and now always with an audience filter.
create index if not exists notices_audience_created_idx
  on notices (audience, created_at desc);


-- ------------------------------------------------------------
-- 2. Who may post
-- ------------------------------------------------------------
--
-- The `notices` permission key, same one the sidebar gates the tab on. Not
-- program-scoped: a notice goes to the college, so `allowed_programs` has nothing
-- to say about it (SUPABASE_ADMIN_ROLES.md notes the same for `fee`).
--
-- Teachers are deliberately NOT included. `is_staff()` would have been the shorter
-- policy, but it would let any teacher post to the public notice board and to every
-- other teacher's portal, which is the office's job and not hers.

create or replace function admin_can_notices()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from admin_profiles ap
    where ap.user_id = auth.uid()
      and (ap.is_super_admin or 'notices' = any(ap.permissions))
  );
$$;


-- ------------------------------------------------------------
-- 3. RLS
-- ------------------------------------------------------------
--
-- Every existing policy on `notices` is dropped first. Their names differ between
-- databases (this table predates the SQL files in this repo), so they are read out
-- of pg_policies rather than guessed at — a `drop policy if exists` on a name that
-- was never used would silently leave the old wide-open policy in place, and an
-- extra permissive policy is OR'd in, so one survivor undoes all of this.

alter table notices enable row level security;

do $$
declare pol record;
begin
  for pol in select policyname from pg_policies where schemaname = 'public' and tablename = 'notices'
  loop
    execute format('drop policy %I on public.notices', pol.policyname);
  end loop;
end $$;

-- Students and the public landing page. Students have no auth account at all, so
-- this is the anon role — the same posture as students_select. The condition is
-- the whole point: a teachers-only instruction is not on the board.
create policy "notices_select_public" on notices
  for select to anon
  using (audience = 'all');

-- Signed in means staff here: an admin or a teacher. Both see everything,
-- because 'teachers' rows are addressed to exactly this set of people.
create policy "notices_select_staff" on notices
  for select to authenticated
  using (true);

create policy "notices_write_admin" on notices
  for all to authenticated
  using (admin_can_notices())
  with check (admin_can_notices());


-- ------------------------------------------------------------
-- 4. The bucket
-- ------------------------------------------------------------
--
-- Created here rather than by hand in the dashboard, for the reason written up in
-- supabase_lms.sql: the by-hand step is the one that gets missed, and the first
-- person to attach a date sheet gets "Bucket not found" with nothing on screen
-- able to explain it.

insert into storage.buckets (id, name, public)
values ('notice-files', 'notice-files', true)
on conflict (id) do update set public = true;

drop policy if exists "notice_files_read"   on storage.objects;
drop policy if exists "notice_files_upload" on storage.objects;
drop policy if exists "notice_files_delete" on storage.objects;

-- Read is open, like every other bucket a student has to reach: she has no auth
-- account to check. Note the consequence, which is the same trade the reports
-- bucket makes and is recorded at the bottom of supabase_monthly_reports.sql —
-- a file attached to a teachers-only notice is not readable *from the notice*,
-- but its URL, if it leaks, opens. Do not attach anything to a staff notice that
-- would matter in a stranger's hands; the notice text itself is properly scoped.
create policy "notice_files_read" on storage.objects
  for select to anon, authenticated using (bucket_id = 'notice-files');

create policy "notice_files_upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'notice-files' and admin_can_notices());

-- Deleting a notice deletes its file. Without this policy that delete would come
-- back a plain success having freed nothing — see supabase_storage_cleanup.sql.
create policy "notice_files_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'notice-files' and admin_can_notices());


-- ============================================================
-- Verify (run separately, after the above)
-- ============================================================
-- select column_name, data_type, column_default from information_schema.columns
--  where table_name = 'notices' order by ordinal_position;
-- select policyname, roles, cmd, qual from pg_policies where tablename = 'notices';
-- select id, public from storage.buckets where id = 'notice-files';
-- select policyname, cmd from pg_policies
--  where tablename = 'objects' and policyname like 'notice_files%';
--
-- Every pre-existing row should read 'all':
-- select audience, count(*) from notices group by audience;
