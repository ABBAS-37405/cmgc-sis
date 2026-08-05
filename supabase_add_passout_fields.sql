-- Add passout/alumni support for students
-- Run this in Supabase SQL Editor as a migration.

begin;

alter table students
  add column if not exists is_passout boolean default false;

alter table students
  add column if not exists passout_at timestamptz null;

commit;

-- Notes:
-- 1) `is_passout` marks students who've passed out. `passout_at` records the date.
-- 2) The admin UI will set `deleted_at` when marking passout so they disappear
--    from the enrolled roster (Deleted Items still retains them).
-- 3) Update RLS policies if needed to allow admins to set these columns.
