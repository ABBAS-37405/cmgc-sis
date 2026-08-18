-- ============================================================
-- Storage cleanup — keeping the free 1 GB from ever filling up
-- ============================================================
--
-- Run this whole file once in the Supabase SQL editor. It is idempotent.
--
-- WHY THIS EXISTS
--
-- Every bucket in this project only ever grew. Nothing in the app has ever
-- called storage.remove(): `removeMaterial` soft-deletes the lms_materials row
-- and leaves the file, a replaced profile picture becomes a *new* file because
-- the path carries Date.now(), and a rejected application keeps all six of its
-- documents. On the free 1 GB that is a wall the college hits without warning,
-- and the failure it produces is an upload that silently errors mid-admission.
--
-- The frontend now sweeps. This file gives it the three things it cannot do from
-- the browser on its own:
--
--   1. read how full storage actually is (storage.objects is not readable by
--      anon or authenticated, and there is no supabase-js API for bucket size),
--   2. mark an LMS row as having lost its file but not its content,
--   3. delete an object at all — none of these buckets had a delete policy, so
--      every remove() would have been refused with a plain success.
--
-- WHAT IS NOT HERE
--
-- The quota itself. Postgres has no idea which Supabase plan the project is on,
-- so STORAGE_QUOTA_BYTES lives in src/lib/storageCleanup.js and must be changed
-- there if the college ever moves off the free tier.


-- ============================================================
-- 1. An archived file — the record survives, the file does not
-- ============================================================
--
-- Deliberately not a delete. A teacher's material is a title, a description, a
-- link and often a YouTube video as well as the attached file; throwing all of
-- that away to reclaim a 300 kB scan would destroy far more than it saved. So
-- the row stays, `file_url` is cleared, and the student is told the file was
-- removed to save space and to ask her teacher for it again.

alter table lms_materials add column if not exists file_archived_at timestamptz;
alter table lms_materials add column if not exists file_archived_reason text;

comment on column lms_materials.file_archived_at is
  'Set when the attached file was swept to reclaim storage. The row and its text, link and video are untouched — only file_url was cleared.';

-- Oldest-first is the order the sweep picks in, so it is the order to index.
create index if not exists lms_materials_sweep_idx
  on lms_materials (created_at)
  where deleted_at is null and file_url is not null;


-- ============================================================
-- 2. Reading actual usage
-- ============================================================
--
-- storage.objects carries the byte size in metadata->>'size'. It is not exposed
-- through PostgREST and must not be — these functions are security definer and
-- refuse anyone who is not signed-in staff.
--
-- `stable`, not `immutable`: it reads a table that changes under it.

create or replace function public.storage_usage()
returns table (bucket_id text, bytes bigint, files bigint)
language plpgsql security definer stable set search_path = public, storage as $$
begin
  if not is_staff() then
    raise exception 'Only staff may read storage usage' using errcode = '42501';
  end if;

  return query
    select o.bucket_id::text,
           coalesce(sum(coalesce((o.metadata->>'size')::bigint, 0)), 0)::bigint,
           count(*)::bigint
      from storage.objects o
     group by o.bucket_id;
end;
$$;

-- One row per object in a bucket: the path, its size and when it was written.
--
-- This is what lets the sweep work out which files nothing points at any more,
-- what each one is worth reclaiming, and — through `created_at` — which are too
-- new to touch. Without it the frontend would have to page through
-- storage.list() folder by folder and would still not know a file's age.
create or replace function public.storage_objects_in(bucket text)
returns table (path text, bytes bigint, created_at timestamptz)
language plpgsql security definer stable set search_path = public, storage as $$
begin
  if not is_staff() then
    raise exception 'Only staff may list storage objects' using errcode = '42501';
  end if;

  return query
    select o.name::text,
           coalesce((o.metadata->>'size')::bigint, 0)::bigint,
           o.created_at
      from storage.objects o
     where o.bucket_id = bucket;
end;
$$;

revoke all on function public.storage_usage() from public, anon;
revoke all on function public.storage_objects_in(text) from public, anon;
grant execute on function public.storage_usage() to authenticated;
grant execute on function public.storage_objects_in(text) to authenticated;


-- ============================================================
-- 3. Delete policies — without these, every sweep silently does nothing
-- ============================================================
--
-- None of these buckets had a delete policy. A delete that matches no policy is
-- answered with a plain success and zero rows, exactly like the update case in
-- WRITE_BLOCKED_HINT, so the sweep would have reported freeing space it had not
-- freed. Deleting is staff-only in all three: uploads come from anon sessions
-- (a student, an applicant), removals never do.

drop policy if exists "lms_materials_delete"     on storage.objects;
drop policy if exists "admission_documents_delete" on storage.objects;
drop policy if exists "student_profiles_delete"  on storage.objects;

create policy "lms_materials_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'lms-materials' and is_staff());

create policy "admission_documents_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'admission-documents' and is_staff());

create policy "student_profiles_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'student-profiles' and is_staff());


-- ============================================================
-- 4. What is deliberately NOT swept
-- ============================================================
--
-- `assignments` and `reports` are left alone by this migration and have no
-- delete policy added.
--
--   - A submission is a student's own work and the only copy of it; nobody
--     wants it deleted by a housekeeping rule.
--   - A report PDF is regenerable, so pruning it is safe in principle, but the
--     link has already been sent to a parent on WhatsApp and deleting the file
--     breaks a message somebody may open months later. Doing that properly
--     means expiring links, not deleting behind them.
--
-- Both are worth revisiting if what the other three sweeps reclaim stops being
-- enough. Neither is urgent: between them they are the smallest two buckets.
