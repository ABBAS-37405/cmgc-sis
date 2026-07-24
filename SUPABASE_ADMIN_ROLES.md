# Supabase Schema Changes - Sub-Admin Roles & Permissions

This adds limited-rights "sub-admin" accounts: the main admin can create extra admin
logins that only see certain tabs (e.g. Attendance + Results) and, within those tabs,
only certain programs/classes (e.g. only ICS students).

Run everything below, **in order**, in the Supabase Dashboard → SQL Editor.

---

## 1. Create the `admin_profiles` table

```sql
create table admin_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null unique,
  name text,
  is_super_admin boolean not null default false,
  permissions text[] not null default '{}',       -- subset of: students, attendance, results, fee, notices
  allowed_programs text[] not null default '{}',  -- empty array = all programs allowed
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

alter table admin_profiles enable row level security;
```

**Permission keys** used by the app: `students`, `attendance`, `results`, `fee`, `notices`.
`overview` is always visible to every admin and is not a toggle.

**Program values** (must match exactly what's used elsewhere in the app):
`Pre-Engineering`, `Pre-Medical`, `ICS`, `General Science`, `Humanities`.
An empty `allowed_programs` array means "no restriction — all programs".

---

## 2. Helper function `is_super_admin()`

This is `security definer` so it can read `admin_profiles` without recursively
re-triggering that same table's RLS (standard Supabase pattern).

```sql
create or replace function is_super_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select is_super_admin from admin_profiles where user_id = auth.uid()),
    false
  );
$$;
```

---

## 3. Policies on `admin_profiles`

```sql
create policy "self or super admin can read"
on admin_profiles for select
using (user_id = auth.uid() or is_super_admin());

create policy "super admin can insert"
on admin_profiles for insert
with check (is_super_admin());

create policy "super admin can update"
on admin_profiles for update
using (is_super_admin());

create policy "super admin can delete"
on admin_profiles for delete
using (is_super_admin());
```

---

## 4. Bootstrap the first super admin

The policies above mean **nobody can insert the first row** (you need to already be a
super admin to pass the insert policy) — so insert it once manually, bypassing the
chicken-and-egg problem, using the SQL Editor (which runs as the Postgres owner, not
subject to RLS).

Find your existing admin's user id first:

```sql
select id, email from auth.users where email = 'YOUR_EXISTING_ADMIN_EMAIL';
```

Then insert their profile as a super admin (replace both values):

```sql
insert into admin_profiles (user_id, email, name, is_super_admin, permissions, allowed_programs)
values (
  'PASTE_USER_ID_HERE',
  'YOUR_EXISTING_ADMIN_EMAIL',
  'Main Admin',
  true,
  '{}',
  '{}'
);
```

---

## 5. Existing policies found and cleaned up (already applied to this project)

The project's actual policies on `attendance`/`results`/`students` (checked via
`select tablename, policyname, cmd, roles, qual from pg_policies where tablename in
('attendance', 'results', 'students');`) were all scoped to `{public}` (i.e. both `anon`
and `authenticated`) with an unconditional `true` — meaning every read and write on
these 3 tables was wide open to everyone, admin or not. Verified against the app code
that **only the admin dashboard ever inserts/updates/deletes** these tables (the public
student/parent portal only ever reads). The following was run to fix this:

```sql
-- Narrow the existing read policies to anon only (keeps student/parent portal working)
alter policy "attendance_select" on attendance to anon;
alter policy "results_select" on results to anon;
alter policy "students_select" on students to anon;

-- Remove the duplicate broad read policy on students
drop policy "students_select_all" on students;

-- Remove the broad admin-only write policies (replaced by scoped ones in Section 6)
drop policy "attendance_insert" on attendance;
drop policy "attendance_update" on attendance;
drop policy "attendance_delete" on attendance;
drop policy "results_insert" on results;
drop policy "results_update" on results;
drop policy "results_delete" on results;
drop policy "students_insert" on students;
drop policy "students_update" on students;
```

**Known separate issue, intentionally left alone:** `students_delete` is scoped to
`{anon}` — any anonymous visitor (no login at all) can currently delete any student row.
This predates this feature and is unrelated to admin scoping; flagged for a future,
separate fix rather than bundled in here.

---

## 6. Program-scoped write policies

### `students` table

```sql
create policy "admin scoped write on students"
on students for all
to authenticated
using (
  is_super_admin()
  or exists (
    select 1 from admin_profiles ap
    where ap.user_id = auth.uid()
      and 'students' = any(ap.permissions)
      and (array_length(ap.allowed_programs, 1) is null or students.program = any(ap.allowed_programs))
  )
)
with check (
  is_super_admin()
  or exists (
    select 1 from admin_profiles ap
    where ap.user_id = auth.uid()
      and 'students' = any(ap.permissions)
      and (array_length(ap.allowed_programs, 1) is null or students.program = any(ap.allowed_programs))
  )
);
```

### `attendance` table

```sql
create policy "admin scoped write on attendance"
on attendance for all
to authenticated
using (
  is_super_admin()
  or exists (
    select 1 from admin_profiles ap
    join students s on s.id = attendance.student_id
    where ap.user_id = auth.uid()
      and 'attendance' = any(ap.permissions)
      and (array_length(ap.allowed_programs, 1) is null or s.program = any(ap.allowed_programs))
  )
)
with check (
  is_super_admin()
  or exists (
    select 1 from admin_profiles ap
    join students s on s.id = attendance.student_id
    where ap.user_id = auth.uid()
      and 'attendance' = any(ap.permissions)
      and (array_length(ap.allowed_programs, 1) is null or s.program = any(ap.allowed_programs))
  )
);
```

### `results` table

```sql
create policy "admin scoped write on results"
on results for all
to authenticated
using (
  is_super_admin()
  or exists (
    select 1 from admin_profiles ap
    join students s on s.id = results.student_id
    where ap.user_id = auth.uid()
      and 'results' = any(ap.permissions)
      and (array_length(ap.allowed_programs, 1) is null or s.program = any(ap.allowed_programs))
  )
)
with check (
  is_super_admin()
  or exists (
    select 1 from admin_profiles ap
    join students s on s.id = results.student_id
    where ap.user_id = auth.uid()
      and 'results' = any(ap.permissions)
      and (array_length(ap.allowed_programs, 1) is null or s.program = any(ap.allowed_programs))
  )
);
```

`fee` and `notices` are **not** program-scoped (fee verification already spans all
programs and notices are global) — those two are still gated by tab-level
`permissions` in the app's UI only, not by a DB policy.

---

## 7. Rollback (if needed)

```sql
drop policy if exists "admin scoped write on students" on students;
drop policy if exists "admin scoped write on attendance" on attendance;
drop policy if exists "admin scoped write on results" on results;
drop policy if exists "self or super admin can read" on admin_profiles;
drop policy if exists "super admin can insert" on admin_profiles;
drop policy if exists "super admin can update" on admin_profiles;
drop policy if exists "super admin can delete" on admin_profiles;
drop function if exists is_super_admin();
drop table if exists admin_profiles;

-- Restore the original wide-open policies removed in Section 5, if needed
alter policy "attendance_select" on attendance to public;
alter policy "results_select" on results to public;
alter policy "students_select" on students to public;
create policy "students_select_all" on students for select to public using (true);
create policy "attendance_insert" on attendance for insert to public with check (true);
create policy "attendance_update" on attendance for update to public using (true);
create policy "attendance_delete" on attendance for delete to public using (true);
create policy "results_insert" on results for insert to public with check (true);
create policy "results_update" on results for update to public using (true);
create policy "results_delete" on results for delete to public using (true);
create policy "students_insert" on students for insert to public with check (true);
create policy "students_update" on students for update to public using (true);
```

---

## Summary

| Component | Change | Status |
|-----------|--------|--------|
| `admin_profiles` table | New table storing per-admin tab + program permissions | Required |
| `is_super_admin()` function | Helper used by RLS policies | Required |
| RLS on `admin_profiles` | Self-read + super-admin-only manage | Required |
| RLS on `students`/`attendance`/`results` | Scoped by permission + allowed program | Required |
| Bootstrap insert | Marks existing admin as super admin | Required, one-time |
