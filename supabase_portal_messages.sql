-- ============================================================
-- Portal messages: what the office needs everyone to read now
-- ============================================================
--
-- Run this whole file once in the Supabase SQL editor.
--
-- A notice waits on a board until somebody goes and looks at it. This is the
-- other thing the office needs: a short message that opens as a dialog in front
-- of whoever it is addressed to, the next time they open their portal. "Fee
-- collection closes at 1pm today." "All teachers report to the hall at 11."
--
-- It is a **separate table from `notices` on purpose.** A notice has a category,
-- an attachment, a public board, a permanent home in three screens and a life of
-- months. This has one audience, one paragraph, and it is finished the moment it
-- has been read. Folding it into `notices` would mean a `popup` flag on a table
-- whose every other row is not one, and a public board that has to remember to
-- filter it out.
--
--
-- WHO CAN READ WHAT — and the one honest limit
-- --------------------------------------------
--
-- 'teachers' is genuinely private: teachers and admins are real Supabase Auth
-- accounts, so `authenticated` is exactly the staff and the policy below hands
-- those rows to nobody else.
--
-- 'students' is **not** private in the same sense, and it cannot be made so.
-- Students have no auth account at all — every request from a student portal is
-- the `anon` role, the same role the public website uses — so the database has no
-- way to tell a girl reading her portal from a visitor reading the home page.
-- A student message is therefore hidden from every public screen (nothing on the
-- landing page reads this table), but it is not hidden from someone who queries
-- the table directly with the anon key. That is the same posture the whole
-- student side of this app already has: `students_select` is scoped to `anon`,
-- and the reports and notice-files buckets are public for the same reason.
--
-- So: do not put anything in a student message that would matter in a stranger's
-- hands. A marks deadline, a timing change, a fee reminder — yes. Anything about
-- one named girl — no; that is what her own portal screens are for. Closing this
-- properly means giving students real auth accounts, which is written up as the
-- residual risk in supabase_profile_edit_requests.sql too.


-- ------------------------------------------------------------
-- 1. The table
-- ------------------------------------------------------------

create table if not exists portal_messages (
  id          uuid primary key default gen_random_uuid(),
  title       text,
  body        text not null,
  audience    text not null default 'all',
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users on delete set null
);

-- Exactly three, and the app depends on it: anything else would be filtered out
-- of both portals and shown to nobody.
alter table portal_messages drop constraint if exists portal_messages_audience_check;
alter table portal_messages add  constraint portal_messages_audience_check
  check (audience in ('all', 'students', 'teachers'));

-- Both portals read newest-first, always with an audience filter.
create index if not exists portal_messages_audience_created_idx
  on portal_messages (audience, created_at desc);


-- ------------------------------------------------------------
-- 2. Who may send one
-- ------------------------------------------------------------
--
-- The same `notices` permission that gates the tab this lives in, and the same
-- function the notices policies use. Repeated here with `create or replace` so
-- this file can be run on a database where supabase_notices_upgrade.sql has not
-- been, and so that neither file silently depends on the other.
--
-- Teachers are deliberately not included: a message that opens in front of every
-- student in the college is the office's to send.

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

alter table portal_messages enable row level security;

drop policy if exists "portal_messages_select_anon"  on portal_messages;
drop policy if exists "portal_messages_select_staff" on portal_messages;
drop policy if exists "portal_messages_write_admin"  on portal_messages;

-- The student portal. Read the note at the top: this is also the public role,
-- so the condition is what keeps a staff message off a student's screen, and
-- nothing here can keep a student message off a determined stranger's.
create policy "portal_messages_select_anon" on portal_messages
  for select to anon
  using (audience in ('all', 'students'));

-- Signed in is staff: an admin or a teacher. Both see everything, because the
-- admin sends them and the 'teachers' rows are addressed to exactly this set.
create policy "portal_messages_select_staff" on portal_messages
  for select to authenticated
  using (true);

create policy "portal_messages_write_admin" on portal_messages
  for all to authenticated
  using (admin_can_notices())
  with check (admin_can_notices());


-- ============================================================
-- Verify (run separately, after the above)
-- ============================================================
-- select column_name, data_type, column_default from information_schema.columns
--  where table_name = 'portal_messages' order by ordinal_position;
-- select policyname, roles, cmd, qual from pg_policies where tablename = 'portal_messages';
--
-- As the anon role, a teachers-only row must not come back:
-- set role anon; select audience, count(*) from portal_messages group by audience; reset role;
