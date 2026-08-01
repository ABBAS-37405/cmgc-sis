-- CMGC — Recycle bin for applications and enrolled students
-- Paste this WHOLE file into Supabase Dashboard -> SQL Editor and press Run.
-- Safe to run more than once.
--
-- Deleting from the Students tab now hides the row instead of destroying it:
-- `deleted_at` is stamped, the row disappears from Applications and Enrolled,
-- and it can be restored from the Deleted Items tab. Deleting a second time,
-- from Deleted Items, is the real DELETE.


-- ============================================================
-- 1. deleted_at — null means live, a timestamp means in the bin
-- ============================================================

alter table applications add column if not exists deleted_at timestamptz;
alter table students     add column if not exists deleted_at timestamptz;

comment on column applications.deleted_at is
  'Set when the admin deletes the application. Null = visible in the Applications tab.';
comment on column students.deleted_at is
  'Set when the admin deletes the student. Null = visible in the Enrolled Students tab.';

-- Every list query filters on this, so index the live rows (the common case).
create index if not exists applications_live_idx on applications (created_at desc) where deleted_at is null;
create index if not exists students_live_idx     on students (name)               where deleted_at is null;


-- ============================================================
-- 2. Cascade deletes so a permanent delete can actually complete
-- ============================================================
-- fees, attendance, results and class_test_marks all point at students.id. If
-- those foreign keys block deletion, "Delete Permanently" fails with a foreign
-- key violation and the row is stuck in the bin forever. Permanently deleting a
-- student is meant to remove her record entirely, so the children go with her.
--
-- This rebuilds each such key as ON DELETE CASCADE, keeping its original name
-- and column. Keys that already cascade are left alone.

do $$
declare
  r record;
begin
  for r in
    select c.conname,
           c.conrelid::regclass::text as child_table,
           a.attname                  as child_column,
           ref.relname                as parent_table
      from pg_constraint c
      join pg_class ref on ref.oid = c.confrelid
      join lateral unnest(c.conkey) as k(attnum) on true
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
     where c.contype = 'f'
       and ref.relname in ('students', 'fees')
       and c.confdeltype <> 'c'          -- 'c' = already ON DELETE CASCADE
       and array_length(c.conkey, 1) = 1 -- single-column keys only
  loop
    raise notice 'cascading %.% -> %', r.child_table, r.child_column, r.parent_table;
    execute format('alter table %s drop constraint %I', r.child_table, r.conname);
    execute format(
      'alter table %s add constraint %I foreign key (%I) references %I(id) on delete cascade',
      r.child_table, r.conname, r.child_column, r.parent_table
    );
  end loop;
end $$;


-- ============================================================
-- 3. Let an admin delete an application row for good
-- ============================================================
-- students already allows it through the "admin scoped write on students"
-- policy (it is FOR ALL). applications may not have a delete policy at all.
-- is_admin_user() comes from SUPABASE_TEACHERS_CLASS_TESTS.md.

drop policy if exists "applications_admin_delete" on applications;
create policy "applications_admin_delete" on applications
  for delete to authenticated using (is_admin_user());


-- ============================================================
-- Verify (run separately, after the above)
-- ============================================================
-- Nothing should be in the bin yet:
--   select count(*) from applications where deleted_at is not null;
--   select count(*) from students     where deleted_at is not null;
--
-- Every child key should now say CASCADE ('c'):
--   select c.conname, c.conrelid::regclass as child, c.confdeltype
--     from pg_constraint c
--     join pg_class ref on ref.oid = c.confrelid
--    where c.contype = 'f' and ref.relname in ('students', 'fees');
