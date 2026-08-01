-- CMGC — Monthly Performance Reports
-- Paste this WHOLE file into Supabase Dashboard -> SQL Editor and press Run.
-- Safe to run more than once. Run supabase_teachers_migration.sql first — the
-- policies below use is_staff() from it.
--
-- What this adds: somewhere to put the generated PDFs, and a small log of which
-- report was sent to whom. The report itself is assembled in the browser from
-- tables that already exist (attendance, class_tests/class_test_marks,
-- assignments/assignment_submissions, results, fees) — nothing about those
-- changes, and no data is duplicated here.


-- ============================================================
-- 1. Storage bucket for the generated PDFs
-- ============================================================
-- Public, for the same reason admission-documents and student-profiles are: the
-- parent opening the WhatsApp link has no login of any kind, so a signed session
-- cannot be required of them.
--
-- The object path is monthly/<YYYY-MM>/<student uuid>.pdf. The UUID is what
-- keeps a report from being guessable — a roll number is public within the
-- college, a student UUID is not. Please read the security note at the bottom
-- before deciding this is good enough for you.

insert into storage.buckets (id, name, public)
values ('reports', 'reports', true)
on conflict (id) do nothing;

drop policy if exists "reports_read"   on storage.objects;
drop policy if exists "reports_upload" on storage.objects;
drop policy if exists "reports_update" on storage.objects;
drop policy if exists "reports_delete" on storage.objects;

-- Anyone with the link may read (that is the whole point). Only signed-in staff
-- may write — unlike the assignments bucket, no anonymous session ever uploads
-- here, so these stay locked to authenticated.
create policy "reports_read" on storage.objects
  for select to anon, authenticated using (bucket_id = 'reports');
create policy "reports_upload" on storage.objects
  for insert to authenticated with check (bucket_id = 'reports' and is_staff());
create policy "reports_update" on storage.objects
  for update to authenticated using (bucket_id = 'reports' and is_staff());
create policy "reports_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'reports' and is_staff());


-- ============================================================
-- 2. report_log — one row per student per month
-- ============================================================
-- Purely a record of what was sent, so the Monthly Reports list can show "Sent
-- 3 Aug" and the admin does not message the same parent twice. The unique
-- constraint is what the portal upserts against: regenerating a month's report
-- updates the row rather than adding a second one.
--
-- The two percentages are snapshotted deliberately. They are what the parent was
-- actually told, which is not necessarily what the tables would produce later if
-- a teacher corrects a mark — that history is the only reason to store them.

create table if not exists report_log (
  id                 uuid primary key default gen_random_uuid(),
  student_id         uuid not null references students(id) on delete cascade,
  month              text not null,          -- 'YYYY-MM'
  file_url           text,
  attendance_percent numeric,
  test_percent       numeric,
  sent_by            uuid references auth.users(id) on delete set null,
  sent_at            timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  unique (student_id, month)
);

create index if not exists report_log_month_idx   on report_log (month);
create index if not exists report_log_student_idx on report_log (student_id);


-- ============================================================
-- 3. Row Level Security
-- ============================================================
-- Staff only, all four ways. Nothing about the log needs to reach a student's
-- anonymous session — she reads her own marks from the portal tabs, and her
-- parent reads the PDF from the link.

alter table report_log enable row level security;

drop policy if exists "report_log_select" on report_log;
drop policy if exists "report_log_insert" on report_log;
drop policy if exists "report_log_update" on report_log;
drop policy if exists "report_log_delete" on report_log;

create policy "report_log_select" on report_log for select to authenticated using (is_staff());
create policy "report_log_insert" on report_log for insert to authenticated with check (is_staff());
create policy "report_log_update" on report_log for update to authenticated using (is_staff());
create policy "report_log_delete" on report_log for delete to authenticated using (is_staff());


-- ============================================================
-- 4. The `reports` permission
-- ============================================================
-- No SQL is needed for it. `admin_profiles.permissions` is an unconstrained
-- text[], so the new 'reports' key works the moment the frontend ships it —
-- exactly like 'lms' did. Tick "Monthly Reports" in Manage Admins to grant it.
-- Super admins have it automatically.
--
-- To grant it to an existing sub-admin by hand instead:
--
--   update admin_profiles
--      set permissions = array_append(permissions, 'reports')
--    where email = 'her@email.com'
--      and not (permissions @> array['reports']);


-- ============================================================
-- 5. Security note — please read
-- ============================================================
-- A report PDF contains a girl's marks, attendance and fee balance, and it sits
-- in a PUBLIC bucket. Anyone holding the URL can open it, forever, without
-- signing in. That is a deliberate trade: parents have no accounts, and a link
-- they can simply tap is the only delivery WhatsApp click-to-chat supports.
--
-- What protects a report is that its URL contains the student's UUID, which is
-- not published anywhere and cannot be derived from her roll number. What does
-- NOT protect it: the link being forwarded. A parent who forwards the WhatsApp
-- message forwards the report with it.
--
-- If that is not acceptable, the fix is to make the bucket private and hand out
-- signed URLs instead (storage.createSignedUrl with a long expiry). The portal
-- would need one line changed in uploadReportPdf(); the cost is that every link
-- eventually dies, including ones already sent.


-- ============================================================
-- Verify (run separately, after the above)
-- ============================================================
-- select id, public from storage.buckets where id = 'reports';
-- select count(*) from report_log;
