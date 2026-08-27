-- ============================================================
-- The weekly class test schedule
-- ============================================================
--
-- Run this whole file once in the Supabase SQL editor. It is safe to re-run:
-- the seed at the bottom is `on conflict do nothing`.
--
-- Every portal — student, teacher and admin — raises a box on open naming the
-- next weekly test, its date and the papers on it. That schedule started life as
-- a module in the frontend, retyped from the spreadsheet the office attaches to
-- its "OFFICIAL WEEKLY CLASS TEST SCHEDULE" notice. This table is what lets the
-- office change it themselves, from **Notices → Test Schedule**, without a
-- deploy.
--
-- The frontend keeps that retyped 2026-27 sheet as a **fallback**, used only
-- when this table cannot be read — the window between a frontend deploy and this
-- file being pasted in. Same reasoning as `fetchRoster` retrying on 42703: a box
-- that vanishes because a migration has not been run yet is the worse failure.
-- Note the asymmetry that follows, and it is deliberate: a **failed read** falls
-- back, an **empty table** does not. Clearing the schedule at the end of a year
-- has to mean the box stops appearing, not that last year's sheet comes back.


-- ------------------------------------------------------------
-- 0. What this file depends on
-- ------------------------------------------------------------
--
-- The write policy below reuses admin_can_notices(), which supabase_notices_upgrade.sql
-- defines. Checked out loud rather than left to fail at the `create policy` line,
-- where the error names a function and not the file that would create it.

do $$
begin
  if to_regprocedure('public.admin_can_notices()') is null then
    raise exception
      'admin_can_notices() does not exist. Run supabase_notices_upgrade.sql first, then this file.';
  end if;
end $$;


-- ------------------------------------------------------------
-- 1. The table
-- ------------------------------------------------------------
--
-- One row per test day. Two things are deliberately NOT columns here:
--
--   * **The test number.** The printed sheet's TNO is simply the row's position
--     in date order, and the frontend derives it that way. Stored, an office
--     that moves one date ends up renumbering twenty rows by hand, or with two
--     tests numbered 4 on the sheet in the girls' hands.
--
--   * **The day of the week.** It is the date. A stored copy is one more thing
--     that can disagree with the column next to it.
--
-- The papers are jsonb rather than text[] because each is a *list of lists*: one
-- entry per paper sat that day, and each of those is the set of subjects that
-- one paper covers across the groups — [["Mathematics","Biology","Civics"], ...]
-- means the first paper is Mathematics for Pre-Engineering, Biology for
-- Pre-Medical and Civics for FA-IT. The frontend narrows it to the one subject
-- a given girl actually sits, from her group and her subject_combination.
--
-- Subject names are the same strings src/lib/academics.js uses and results.subject
-- stores. Nothing constrains them here — same as results.subject — but a name
-- that matches nothing simply fails to narrow and is shown to every girl as
-- entered, so keep them in step.

create table if not exists test_schedule (
  id                  uuid primary key default gen_random_uuid(),
  -- One test per day. This is the real duplicate to prevent, and unlike a test
  -- number it never fights the office renumbering or inserting.
  test_date           date not null unique,
  first_year_papers   jsonb,
  second_year_papers  jsonb,
  note                text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- A row where neither class sits anything is not a test day, it is a blank line
-- on the board. The frontend drops such rows too; this stops one being saved.
alter table test_schedule drop constraint if exists test_schedule_has_papers;
alter table test_schedule add  constraint test_schedule_has_papers check (
  (jsonb_typeof(first_year_papers)  = 'array' and jsonb_array_length(first_year_papers)  > 0)
  or
  (jsonb_typeof(second_year_papers) = 'array' and jsonb_array_length(second_year_papers) > 0)
);

-- Every read is "the whole schedule, in date order", and every portal makes it
-- once on open.
create index if not exists test_schedule_date_idx on test_schedule (test_date);

create or replace function touch_test_schedule()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists test_schedule_touch on test_schedule;
create trigger test_schedule_touch before update on test_schedule
  for each row execute function touch_test_schedule();


-- ------------------------------------------------------------
-- 2. RLS
-- ------------------------------------------------------------
--
-- **Reading is open to everybody, including anon.** This is not a relaxation:
-- the schedule is already a public document — it is posted on the notice board
-- with the spreadsheet attached, and the board itself is on the landing page.
-- More to the point, students have no Supabase Auth account at all, so anon is
-- the role every student portal reads as.
--
-- **Writing is the `notices` permission**, through the admin_can_notices()
-- helper that supabase_notices_upgrade.sql already defines. Reused rather than
-- given a key of its own, because the schedule is the office announcing
-- something to the whole college — the same act, by the same person, as posting
-- the notice that carries the spreadsheet. A new PERMISSION_KEYS entry would
-- mean a migration here and a matching change in src/lib/adminAuth.js for a
-- right nobody would ever hold separately.
--
-- Teachers are deliberately excluded, exactly as they are from notices: this
-- goes to every girl in the college, and that is the office's to set.

alter table test_schedule enable row level security;

drop policy if exists "test_schedule_select"      on test_schedule;
drop policy if exists "test_schedule_write_admin" on test_schedule;

create policy "test_schedule_select" on test_schedule
  for select to anon, authenticated
  using (true);

create policy "test_schedule_write_admin" on test_schedule
  for all to authenticated
  using (admin_can_notices())
  with check (admin_can_notices());


-- ------------------------------------------------------------
-- 3. The 2026-27 sheet
-- ------------------------------------------------------------
--
-- The schedule the college published, so the office starts with its own sheet
-- already in the table rather than twenty-seven rows to retype. `on conflict do
-- nothing` on the date means re-running this file never overwrites an edit the
-- office has since made.
--
-- The sheet alternates two sets of papers:
--
--   Set A   Maths/Bio/Civics · Chemistry/Computer/Education · Islamiat/TQ/PakStudies
--   Set B   Urdu             · Physics/Economics/Sociology  · English
--
-- 1st year sits nothing for the first two tests — that class had not started.

with sets(name, papers) as (
  values
    ('A'::text, '[["Mathematics","Biology","Civics"],
            ["Chemistry","Computer Science","Education"],
            ["Islamiat","Tarjama Tul Quran","Pakistan Studies"]]'::jsonb),
    ('B'::text, '[["Urdu"],
            ["Physics","Economics","Sociology"],
            ["English"]]'::jsonb)
),
sheet(test_date, first_set, second_set) as (
  values
    (date '2026-09-04', null::text, 'A'::text),
    (date '2026-09-05', null::text, 'B'::text),
    (date '2026-09-11', 'B', 'A'),
    (date '2026-09-19', 'A', 'B'),
    (date '2026-09-25', 'B', 'A'),
    (date '2026-10-03', 'A', 'B'),
    (date '2026-10-09', 'B', 'A'),
    (date '2026-10-17', 'A', 'B'),
    (date '2026-10-23', 'B', 'A'),
    (date '2026-10-31', 'A', 'B'),
    (date '2026-11-06', 'B', 'A'),
    (date '2026-11-14', 'A', 'B'),
    (date '2026-11-20', 'B', 'A'),
    (date '2026-11-28', 'A', 'B'),
    (date '2027-01-01', 'B', 'A'),
    (date '2027-01-09', 'A', 'B'),
    (date '2027-01-15', 'B', 'A'),
    (date '2027-01-23', 'A', 'B'),
    (date '2027-01-29', 'B', 'A'),
    (date '2027-02-06', 'A', 'B'),
    (date '2027-02-12', 'B', 'A'),
    (date '2027-02-20', 'A', 'B'),
    (date '2027-02-26', 'B', 'A'),
    (date '2027-03-06', 'A', 'B'),
    (date '2027-03-12', 'B', 'A'),
    (date '2027-03-20', 'A', 'B'),
    (date '2027-03-26', 'B', 'A')
)
insert into test_schedule (test_date, first_year_papers, second_year_papers)
select
  sheet.test_date,
  (select papers from sets where sets.name = sheet.first_set),
  (select papers from sets where sets.name = sheet.second_set)
from sheet
on conflict (test_date) do nothing;


-- ============================================================
-- Verify (run separately, after the above)
-- ============================================================
-- 27 rows, first two with a null first_year_papers:
-- select test_date, to_char(test_date, 'Dy') as day,
--        jsonb_array_length(coalesce(first_year_papers,  '[]'::jsonb)) as xi_papers,
--        jsonb_array_length(coalesce(second_year_papers, '[]'::jsonb)) as xii_papers
--   from test_schedule order by test_date;
--
-- Every date should be a Friday or a Saturday — that is what the sheet says:
-- select distinct to_char(test_date, 'Dy') from test_schedule;
--
-- select policyname, roles, cmd, qual from pg_policies where tablename = 'test_schedule';
--
-- Reading as anon must work, because that is what a student portal is:
-- set role anon; select count(*) from test_schedule; reset role;
