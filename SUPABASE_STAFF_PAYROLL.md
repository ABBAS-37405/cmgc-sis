# Supabase Schema Changes — Staff Payroll (Teachers + Admin Staff)

Adds payroll for **everyone the college pays**. There is a daily attendance register, and a
monthly salary screen that calculates what each person is owed, records payment, and sends
the working over WhatsApp.

**Three employment types on two pay shapes.** **Regular** and **Fix Pay** are both a fixed
monthly salary and are priced by exactly the same code off the same `monthly_salary` column
— Fix Pay records the terms someone is engaged on, not a different salary rule — while
**Visiting** is paid per day worked. `src/lib/payroll.js` therefore branches on
`isPerDayType()` and never on the type name. Fix Pay was added later; on a database that
already ran this file, `supabase_fix_pay_employment.sql` is the one-constraint migration
that allows it.

Two rosters share one payroll:

| Who | Table | Signs in? |
|-----|-------|-----------|
| Teaching staff | `teachers` | Yes — Supabase Auth, teacher portal |
| Everyone else — accounts, office, security, maintenance, transport | `staff` | No |

**To apply this, paste `supabase_staff_payroll.sql` into Supabase Dashboard → SQL Editor.**
Pure SQL, safe to run twice.

> **This file replaces the earlier `supabase_teacher_payroll.sql`.** If you already ran
> that one, section 0 of the new file renames `teacher_attendance` → `staff_attendance` and
> `teacher_salaries` → `staff_salaries` and carries your data forward. If you never ran it,
> the new file on its own is everything you need. The old pair has been deleted so nobody
> runs the outdated version by mistake.

Depends on `SUPABASE_TEACHERS_CLASS_TESTS.md` — `can_manage_teachers()` and
`is_admin_user()` come from there.

---

## 1. Why guards and peons are not rows in `teachers`

A `teachers` row carries `subjects[]`, `programs[]`, `rights[]` and a `user_id`. A security
guard has none of those. Putting him in that table would be one column short of harmless
and several screens short of correct: he would appear in the teacher dropdown on class
tests, LMS material, assignments and the class-test report, because every one of those
reads `teachers` to build its list.

So `staff` is its own table with its own fields, and **only the payroll is shared**. That
works because nothing in `src/lib/payroll.js` reads a subject, a program or a right — an
accountant and a physics teacher price identically, which is exactly why the functions take
a `person` rather than a `teacher`.

There is no `user_id` on `staff` and no auth account: non-teaching staff do not sign in to
anything. If that ever changes, copy the `teachers.user_id` pattern rather than inventing a
second one.

---

## 2. `teachers` gains an employment type and a rate

```sql
alter table teachers add column if not exists employment_type text not null default 'Regular';
alter table teachers add column if not exists monthly_salary  numeric;
alter table teachers add column if not exists per_day_salary  numeric;
alter table teachers add column if not exists joining_date    date;
alter table teachers add column if not exists whatsapp        text;
```

`supabase_payout_accounts.sql` adds four more later — `payment_method`, `bank_name`,
`account_title`, `account_number`, the same four on `staff` — so the office can check where
a salary is sent before an online transfer. Plain text, no constraint, no policy; see
section 10.

`whatsapp` is read first by `whatsappNumberFor()`, with `phone` as the fallback — the same
convention `students` already uses, and the reason a landline on file no longer breaks the
salary slip.

Existing teachers become `Regular` with a null salary, which shows as `Rs 0` until an admin
edits them. Deliberate: a guessed salary is worse than an obvious blank.

---

## 3. `staff` — the non-teaching register

```sql
create table if not exists staff (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  father_name text,
  cnic text,
  designation text not null,          -- 'Accountant', 'Security Guard', ...
  department text,                    -- must match STAFF_DEPARTMENTS in src/lib/staff.js
  phone text, whatsapp text, address text, emergency_contact text,
  employment_type text not null default 'Regular'
    check (employment_type in ('Regular', 'Visiting', 'Fix Pay')),
  monthly_salary numeric, per_day_salary numeric,
  joining_date date,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);
```

`designation` is **free text**, offered as a datalist of suggestions in the UI, because
every college invents a job title sooner or later and a fixed list would be the first thing
to need a migration. `department` is the fixed part — it is what the salary sheet groups
and subtotals by, so it must come from `STAFF_DEPARTMENTS` in `src/lib/staff.js`:
Administration, Accounts, Academic Support, Security, Maintenance, Transport.

`is_active` retires someone without deleting their salary history, the same role
`teachers.is_active` plays for a login.

---

## 4. `staff_attendance` — one row per person per day

```sql
create table if not exists staff_attendance (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid references teachers(id) on delete cascade,
  staff_id   uuid references staff(id)    on delete cascade,
  date date not null,
  status text not null default 'Present'
         check (status in ('Present', 'Absent', 'Leave', 'Half Day')),
  remarks text,
  created_at timestamptz not null default now(),
  unique (teacher_id, date)
);

create unique index if not exists staff_attendance_staff_date_key
  on staff_attendance (staff_id, date);

alter table staff_attendance add constraint staff_attendance_owner_check
  check ((teacher_id is not null) <> (staff_id is not null));
```

**Exactly one of `teacher_id` / `staff_id` is set on every row**, and that is enforced by
the check constraint rather than assumed by the app. `ownerColumnFor()` in
`src/lib/payroll.js` is what picks which one to write.

**Two unique keys, both required.** NULLs are distinct in a unique index, so teacher rows
never collide with each other on `(staff_id, date)` and staff rows never collide on
`(teacher_id, date)`. These are what the app upserts against — re-saving a day updates it
rather than duplicating.

**This is not the students' `attendance` table**, on purpose. That one is keyed to
`student_id` and its RLS is written around a student's own percentage; folding salary
evidence into it would put pay records behind policies designed for something else.

---

## 5. `college_holidays` — days that are not working days

```sql
create table if not exists college_holidays (
  date date primary key, title text, created_at timestamptz not null default now()
);
```

One row per closed day, college-wide, for teaching and non-teaching alike. **Sundays need
no row** — the weekly off is applied in code (`WEEKLY_OFF_DAY` in `src/lib/payroll.js`), so
the table holds only real holidays: Eid, 14 August, a declared closure.

A holiday behaves differently for the two pay shapes, and this is the asymmetry the college
asked for:

- **Regular / Fix Pay** — excluded from working days, so it can neither deduct from the salary nor
  inflate the per-day rate. Paid in full through the winter break.
- **Visiting** — not present, so unpaid. There is no separate rule for this; it falls
  straight out of "present days × per-day rate".

---

## 6. `staff_salaries` — one row per person per month

Same `teacher_id` / `staff_id` pair and the same exactly-one check, keyed
`unique (teacher_id, month)` plus a unique index on `(staff_id, month)`.

**Almost every column here is recomputed, not read.** The Salary screen calculates the
whole month from `staff_attendance` each time it opens, so a corrected attendance mark
immediately changes the figure. The row exists for the four things that cannot be
recomputed — `bonus`, `other_deduction`, `notes` and `present_days_override` — and for the
record of payment. The computed columns are stored as a snapshot of what was actually shown
and sent, the same way `report_log` snapshots the percentages it messaged.

**`present_days_override`** is the office's correction to the present days: `NULL`, the
default for everybody, means the register decides and the month prices exactly as it did
before this column existed. It is offered only to a **super admin**, under *Edit
Adjustments* on the salary card, for both rosters and both employment types. See section 8
for what a correction does and — more importantly — what it refuses to do.

`status` is **derived and written back** from `paid_amount` against `net_payable`, exactly
like a fee's status: `salaryStatusFor()` in `src/lib/payroll.js` is the single definition,
and it is the only place that decides.

---

## 7. Row Level Security

Pay is not roster data.

- **`staff`** — admin-only end to end (`can_manage_teachers()`), because nobody in it has a
  login to read their own row with.
- **`staff_attendance` / `staff_salaries`** — a signed-in teacher may read **her own** rows
  (`teacher_id is not null and is_this_teacher(teacher_id)`) and nothing else; staff rows
  are admin-only. Writing is `can_manage_teachers()` throughout — the same gate the Teachers
  & Staff tab already sits behind.
- **`college_holidays`** — readable by anyone (it is a calendar, not a secret), written only
  by an admin.

The migration drops the old `teacher_attendance_*` / `teacher_salaries_*` policy names
before creating the new ones, so an upgraded database is not left with two overlapping sets.

> **Remember the project-wide rule:** a write RLS refuses returns success with zero rows,
> not an error. Every write in `StaffPayroll.jsx` and `AdminStaff.jsx` asks for the rows
> back with `.select(...)` and treats an empty array as failure — see `WRITE_BLOCKED_HINT`
> in `src/lib/adminAuth.js`.

---

## 8. How the salary is calculated

All of it lives in `src/lib/payroll.js`, which imports nothing that reaches Supabase — the
arithmetic is the part that quietly goes wrong, and keeping it database-free is what lets it
be driven from plain Node, the same reason `reportPdf.js` is arranged that way.

**Working days** = every day of the month, minus Sundays, minus `college_holidays` rows.

**Regular and Fix Pay** — the same calculation, twice over; only the label differs.

```
per-day rate   = monthly_salary ÷ working days
absence days   = absent + leave + (half days × 0.5)
chargeable     = max(0, absence days − 1)        -- the first day each month is free
deduction      = chargeable × per-day rate
net payable    = monthly_salary − deduction + bonus − other deduction
```

**Visiting**

```
paid days      = present + (half days × 0.5)
net payable    = (paid days × per_day_salary) + bonus − other deduction
```

**A corrected present-day count** (`present_days_override`, super admin only)

```
Visiting   paid days    = override + (half days × 0.5)              -- priced straight off it
Monthly    absence days = clamp(working days − override − (half days × 0.5), 0, working days)
```

Where the register is complete the monthly line is arithmetically the absence it already
held — `working days = present + absent + leave + half` — so **a correction that agrees with
the register changes nothing at all.**

Both shapes are recomputed live like everything else, so the sheet, the payslip PDF, the
WhatsApp slip and the teacher's own **My Salary** tab all price off the same number and
cannot disagree. The corrected figure is never printed bare: every one of those says what
the register itself had recorded beside it.

Four rules that are easy to get wrong:

- **An unmarked day is not an absence.** Days with no register entry are counted and shown
  separately (`unmarkedDays`) but never deducted. Reading "nobody filled the register" as
  "they didn't come" would take money off someone who was at work.
- **The free day covers leave *and* absence together**, not one each — one non-attending day
  per month, whichever kind it was.
- **The divisor is that month's working days, not 30.** A February deduction is therefore
  slightly larger per day than a March one, and a month with many holidays does not make an
  absence cheaper than it should be relative to the days actually worked.
- **A stated present count accounts for the whole month, and that is not the first rule
  undone.** Nobody may read an empty register as "she didn't come" — but a super admin
  saying "present 20" in a month of 26 working days is not silence, and the six days she did
  not claim are days not attended. The difference-based alternative was considered and
  rejected: it returns a full salary however few days are typed, on exactly the incomplete
  register that is the main reason the box exists. Once a count is stated `computeSalary`
  reports `unmarkedDays: 0` (the register's own figure survives as `registerUnmarkedDays`),
  so no screen goes on promising that days the correction deducted cost nothing.

---

## 9. Where it appears in the app

| Screen | File |
|--------|------|
| Employment type + salary on the Add/Edit **Teacher** form | `src/components/Teachers/Teachers.jsx` |
| **Admin Staff** roster (guards, peons, accounts, office) | `src/components/AdminStaff/AdminStaff.jsx` |
| **Attendance & Salary** — daily register + monthly payroll, both rosters | `src/components/StaffPayroll/StaffPayroll.jsx` |
| The calculation, the slip text, the date helpers | `src/lib/payroll.js` |
| Designations and departments | `src/lib/staff.js` |
| Teacher salary columns passed through login creation | `src/lib/teacherAuth.js`, `server.js` |

All of it sits inside the **Teachers & Staff** sidebar tab, gated by the existing `teachers`
permission — no new permission key, so `PERMISSION_KEYS` and the RLS policies built on it
are unchanged.

The WhatsApp salary slip goes through `src/lib/whatsapp.js` like every other message in the
project, and bulk sending is a **queue, not a loop** — one chat per click.

---

## 10. Where the salary is sent — `supabase_payout_accounts.sql`

A later, optional migration. Four text columns on **both** `teachers` and `staff`:

```sql
alter table teachers add column if not exists payment_method text;  -- 'Bank Transfer' | 'EasyPaisa' | 'JazzCash' | 'Cash' | 'Other'
alter table teachers add column if not exists bank_name      text;
alter table teachers add column if not exists account_title  text;
alter table teachers add column if not exists account_number text;  -- account no, IBAN, or wallet mobile number
-- ...and the same four on staff
```

The college pays some salaries online now, and the office wanted the account visible on
the salary card instead of on a slip of paper. `PAYMENT_METHODS` in `src/lib/payroll.js` is
the datalist of suggestions — free text beyond it, exactly like `staff.designation`, and
**nothing in the arithmetic reads any of it**, so there is no constraint. `payoutAccountLine(person)`
in the same file is the one-line rendering, shared by the Teachers form card, the Admin
Staff card, and the salary card in `StaffPayroll` (with a copy button for the number).

**No RLS change.** Both tables already expose every column through their select policies and
already allow an admin (`can_manage_teachers()`) to update. A teacher who has a login is
edited by a direct browser `update`; a teacher who does not is written by
`POST /api/teacher/create` in `server.js`, so the four fields travel through
`createTeacherLogin()` and the route's allow-list too.

**Deliberately not in the WhatsApp slip.** That message gets forwarded. The account is shown
only inside the `teachers`-gated screens and printed on the payslip PDF (which the employee
downloads for herself), never in click-to-chat text.

---

## Summary

| Component | Change | Status |
|-----------|--------|--------|
| `teachers` | `employment_type`, `monthly_salary`, `per_day_salary`, `joining_date`, `whatsapp` | Required |
| `teachers` + `staff` | `payment_method`, `bank_name`, `account_title`, `account_number` (`supabase_payout_accounts.sql`) | Optional — for online salary transfers |
| `staff` | New — the non-teaching register | Required |
| `staff_attendance` | New (or renamed from `teacher_attendance`) — one row per person per day | Required |
| `college_holidays` | New — non-working days, college-wide | Required |
| `staff_salaries` | New (or renamed from `teacher_salaries`) — one row per person per month | Required |
| `staff_salaries.present_days_override` | The office's correction to the present days; `NULL` = the register decides | Required for the editable present days |
| `is_this_teacher()` | New helper | Required |
| Exactly-one-owner check constraints | Section 4 | Required |
| RLS on all four tables | Section 7 | Required |
