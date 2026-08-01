# Supabase Schema Changes — Teachers & Class Tests

Adds the admin **Teachers** tab (teacher records + login + assignable rights), a **teacher
portal** where a teacher enters class tests for her own subjects, and a subject-wise
**Class Tests** tab in the student portal.

Teachers log in with **email + password through Supabase Auth**, exactly like sub-admins
(`SUPABASE_ADMIN_ROLES.md`). There is no separate teacher code and no password column —
a teacher's account is an `auth.users` row, and her `teachers` row holds the subjects,
programs and rights attached to it.

**To actually apply this, open `supabase_teachers_migration.sql` and paste the whole file
into Supabase Dashboard → SQL Editor.** That file is pure SQL and is safe to run twice.
Sections 1–4 below are the same migration split up with an explanation of each part — read
them to understand what you are running, but copy from the `.sql` file, not from here.

Until this is applied, the Teachers tab, the teacher login, and the student Class Tests
tab all fail: the `teachers` table is missing every column the feature adds, and neither
class-test table exists yet.

---

## 0. What already exists

The `teachers` table already exists in this project with only these columns:

| column | type |
|--------|------|
| `id` | uuid, primary key |
| `name` | text |
| `subject` | text (single subject, superseded by `subjects[]` below) |
| `qualification` | text |
| `created_at` | timestamp |

So **Section 1 only ADDs columns** — it does not recreate the table and does not drop
anything. The old `subject` column is kept and backfilled into the new `subjects` array,
so nothing already entered is lost.

`students.id` is `uuid`, which is what the foreign keys in Section 2 rely on.

---

## 1. Extend the `teachers` table

```sql
alter table teachers add column if not exists user_id    uuid references auth.users(id) on delete set null;
alter table teachers add column if not exists email      text;
alter table teachers add column if not exists subjects   text[] not null default '{}';
alter table teachers add column if not exists programs   text[] not null default '{}';
alter table teachers add column if not exists phone      text;
alter table teachers add column if not exists rights     text[] not null default '{class_tests}';
alter table teachers add column if not exists is_active  boolean not null default true;

-- One teacher record per login
create unique index if not exists teachers_user_id_key on teachers (user_id);

-- Carry any existing single `subject` value into the new subjects array
update teachers
set subjects = array[subject]
where subject is not null and subject <> '' and coalesce(array_length(subjects, 1), 0) = 0;
```

**Column meanings**

| column | meaning |
|--------|---------|
| `user_id` | The Supabase Auth user behind this teacher. `null` = record exists but no login has been created yet; the admin portal shows a "Create Login" button for those. |
| `email` | The login email, mirrored here so the admin list can show it without touching `auth.users`. The password lives only in Supabase Auth. |
| `subjects` | Subjects she teaches. **Empty array = all subjects**, same convention as `admin_profiles.allowed_programs`. |
| `programs` | Programs/classes she teaches. **Empty array = all programs.** Values must match exactly: `Pre-Engineering`, `Pre-Medical`, `ICS`, `General Science`, `FA-IT`, `Humanities`. |
| `rights` | Which tabs the teacher portal shows her. Valid keys: `class_tests`, `view_students`, `attendance`, `results`. |
| `is_active` | `false` blocks login without deleting the record and its test history. |

---

## 2. Create the class test tables

Two tables, because each subject can have a completely different number of tests:
`class_tests` is **one row per test conducted**, `class_test_marks` is **one row per
student per test**.

```sql
create table if not exists class_tests (
  id             uuid primary key default gen_random_uuid(),
  teacher_id     uuid references teachers(id) on delete set null,
  subject        text not null,
  program        text not null,
  programs       text[] not null default '{}',
  year_of_study  text not null default '1st Year',
  title          text not null,
  test_date      date not null default current_date,
  total_marks    numeric not null default 10,
  created_at     timestamptz not null default now()
);
```

`program` holds a single program name, or the literal `'All Programs'` when one test was
conducted for every group at once. `programs` records the **concrete** groups that test
actually covered — so a combined test's marks list stays correct even if the teacher's
assigned programs are changed afterwards. If you added `class_tests` before this column
existed:

```sql
alter table class_tests add column if not exists programs text[] not null default '{}';

update class_tests
set programs = array[program]
where coalesce(array_length(programs, 1), 0) = 0 and program is not null and program <> 'All Programs';

create table if not exists class_test_marks (
  id             uuid primary key default gen_random_uuid(),
  class_test_id  uuid not null references class_tests(id) on delete cascade,
  student_id     uuid not null references students(id) on delete cascade,
  marks_obtained numeric,
  is_absent      boolean not null default false,
  remarks        text,
  created_at     timestamptz not null default now(),
  unique (class_test_id, student_id)
);
```

`on delete cascade` on `class_test_id` means deleting a test removes its marks too.
`teacher_id` is `on delete set null` so removing a teacher does **not** wipe the class
test history — the tests stay, just unattributed.

The `unique (class_test_id, student_id)` constraint is what the app's upsert relies on
(re-saving a test updates the existing marks instead of duplicating them). It is
required, not optional.

### Indexes

```sql
create index if not exists class_tests_teacher_idx      on class_tests (teacher_id);
create index if not exists class_tests_lookup_idx       on class_tests (program, year_of_study, subject, test_date desc);
create index if not exists class_test_marks_student_idx on class_test_marks (student_id);
create index if not exists class_test_marks_test_idx    on class_test_marks (class_test_id);
```

`class_test_marks_student_idx` is the important one — the student portal's Class Tests
tab filters purely on `student_id`.

---

## 3. Helper functions

All `security definer` so they can read `teachers` / `admin_profiles` without
re-triggering those tables' own RLS — the same pattern as `is_super_admin()` in
`SUPABASE_ADMIN_ROLES.md`.

```sql
-- Is the caller any kind of admin?
create or replace function is_admin_user()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from admin_profiles where user_id = auth.uid());
$$;

-- May the caller create/remove teacher logins? (super admin, or the `teachers` permission)
create or replace function can_manage_teachers()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce(
    (select is_super_admin or 'teachers' = any(permissions)
     from admin_profiles where user_id = auth.uid()),
    false
  );
$$;

-- Is the caller signed-in staff — an admin or an active teacher?
create or replace function is_staff()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from admin_profiles where user_id = auth.uid())
      or exists (select 1 from teachers where user_id = auth.uid() and coalesce(is_active, true));
$$;

-- Is the caller an active teacher assigned to this program?
create or replace function teacher_sees_program(prog text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from teachers t
    where t.user_id = auth.uid()
      and coalesce(t.is_active, true)
      and (coalesce(array_length(t.programs, 1), 0) = 0 or prog = any(t.programs))
  );
$$;

-- ...and does she hold this right for that program?
create or replace function teacher_can(right_key text, prog text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from teachers t
    where t.user_id = auth.uid()
      and coalesce(t.is_active, true)
      and right_key = any(t.rights)
      and (coalesce(array_length(t.programs, 1), 0) = 0 or prog = any(t.programs))
  );
$$;
```

---

## 4. Row Level Security

```sql
alter table teachers          enable row level security;
alter table class_tests       enable row level security;
alter table class_test_marks  enable row level security;
```

### `teachers`

Nothing here is readable anonymously — a teacher reads her own row after signing in, and
admins read all of them.

```sql
create policy "teachers_select" on teachers for select to authenticated
using (user_id = auth.uid() or is_admin_user());

create policy "teachers_insert" on teachers for insert to authenticated
with check (can_manage_teachers());

create policy "teachers_update" on teachers for update to authenticated
using (can_manage_teachers());

create policy "teachers_delete" on teachers for delete to authenticated
using (can_manage_teachers());
```

### `class_tests` / `class_test_marks`

Students read these from an anonymous session; only signed-in staff may write.

```sql
create policy "class_tests_select"      on class_tests      for select to anon, authenticated using (true);
create policy "class_test_marks_select" on class_test_marks for select to anon, authenticated using (true);

create policy "class_tests_insert" on class_tests for insert to authenticated with check (is_staff());
create policy "class_tests_update" on class_tests for update to authenticated using (is_staff());
create policy "class_tests_delete" on class_tests for delete to authenticated using (is_staff());

create policy "class_test_marks_insert" on class_test_marks for insert to authenticated with check (is_staff());
create policy "class_test_marks_update" on class_test_marks for update to authenticated using (is_staff());
create policy "class_test_marks_delete" on class_test_marks for delete to authenticated using (is_staff());
```

### `students` — teachers must be able to read their roster

**This one is required, not optional.** `students_select` is currently scoped to `anon`
only, and admins get their read through the `admin scoped write on students` policy. A
teacher is `authenticated` but is not an admin, so without this she would see an empty
roster everywhere in her portal.

```sql
create policy "teacher read students" on students for select to authenticated
using (teacher_sees_program(students.program));
```

### `attendance` / `results` — only if you grant those rights

These give a teacher the same program-scoped access an admin has, but gated on her own
`rights` array. Skip them if you only ever assign `class_tests` and `view_students`.

```sql
create policy "teacher scoped write on attendance" on attendance for all to authenticated
using (
  exists (select 1 from students s where s.id = attendance.student_id and teacher_can('attendance', s.program))
)
with check (
  exists (select 1 from students s where s.id = attendance.student_id and teacher_can('attendance', s.program))
);

create policy "teacher scoped write on results" on results for all to authenticated
using (
  exists (select 1 from students s where s.id = results.student_id and teacher_can('results', s.program))
)
with check (
  exists (select 1 from students s where s.id = results.student_id and teacher_can('results', s.program))
);
```

---

## 5. Creating the first teacher

Use the admin portal → **Teachers** tab. Adding a teacher there calls
`POST /api/teacher/create` on `server.js`, which needs `SUPABASE_SERVICE_ROLE_KEY` — so
**`node server.js` must be running**, the same requirement the Manage Admins tab already
has. The server verifies the caller is a super admin (or an admin holding the `teachers`
permission) before creating anything.

If you seed a teacher directly in SQL instead, leave `user_id` null and create the login
later from the portal's "Create Login" button:

```sql
insert into teachers (name, qualification, subjects, programs, rights)
values ('Sample Teacher', 'M.Sc Physics', '{Physics}', '{Pre-Engineering,Pre-Medical}', '{class_tests}');
```

---

## 6. Notes

- **No plaintext passwords.** Teacher passwords live in Supabase Auth only; `teachers`
  holds no password column. This is the main reason this approach is preferred over the
  student-style login the `students` table still uses.
- **Deleting a teacher** goes through `POST /api/teacher/delete`, which removes the
  `teachers` row first and then the auth user. Because `class_tests.teacher_id` is
  `on delete set null`, her class tests and every student's marks survive.
- **Changing a password** goes through `POST /api/teacher/password` — the "Reset
  Password" button on the teacher's card.
- Program values in `teachers.programs` must match `PROGRAMS` in `src/lib/adminAuth.js`
  exactly, and right keys must match `TEACHER_RIGHTS` in `src/lib/teacherAuth.js`.

---

## 7. Rollback

```sql
drop policy if exists "teacher scoped write on attendance" on attendance;
drop policy if exists "teacher scoped write on results"    on results;
drop policy if exists "teacher read students"              on students;

drop table if exists class_test_marks;
drop table if exists class_tests;

drop policy if exists "teachers_select" on teachers;
drop policy if exists "teachers_insert" on teachers;
drop policy if exists "teachers_update" on teachers;
drop policy if exists "teachers_delete" on teachers;
alter table teachers disable row level security;

drop function if exists teacher_can(text, text);
drop function if exists teacher_sees_program(text);
drop function if exists is_staff();
drop function if exists can_manage_teachers();
drop function if exists is_admin_user();

drop index if exists teachers_user_id_key;
alter table teachers drop column if exists user_id;
alter table teachers drop column if exists email;
alter table teachers drop column if exists subjects;
alter table teachers drop column if exists programs;
alter table teachers drop column if exists phone;
alter table teachers drop column if exists rights;
alter table teachers drop column if exists is_active;
```

Auth users created for teachers are **not** removed by this rollback — delete those from
Dashboard → Authentication → Users if you want them gone.

The original `teachers.name` / `subject` / `qualification` columns are untouched.

---

## 8. Verifying it worked

Run these **after** the migration, on their own. They only read — they are not part of
the migration and do not need to be copied with it.

```sql
select column_name from information_schema.columns
where table_name = 'teachers' order by ordinal_position;
-- expect: id, name, subject, qualification, created_at,
--         user_id, email, subjects, programs, phone, rights, is_active

select tablename, policyname, cmd, roles from pg_policies
where tablename in ('teachers', 'class_tests', 'class_test_marks', 'students')
order by tablename, policyname;
```

---

## Summary

| Component | Change | Status |
|-----------|--------|--------|
| `teachers` table | Add `user_id`, `email`, `subjects[]`, `programs[]`, `rights[]` | Required |
| `class_tests` table | New — one row per test conducted | Required |
| `class_test_marks` table | New — one row per student per test | Required |
| Indexes | Student lookup + teacher report performance | Required |
| Helper functions (Section 3) | Used by every policy below | Required |
| RLS on teachers / class tests | Section 4 | Required |
| `teacher read students` policy | Section 4 | Required — portal is empty without it |
| attendance / results teacher policies | Section 4 | Only if you grant those rights |
