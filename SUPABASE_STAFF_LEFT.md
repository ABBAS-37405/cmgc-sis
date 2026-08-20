# Supabase Schema Changes — Left Teachers and Staff

Adds a **Left** register to the admin portal's Teachers & Staff tab. A "Left" button on
each active teacher and staff card moves that person to a separate "Left" list — off the
active roster, off the payroll register — without deleting anything: their attendance,
salary and class-test history all stay exactly where they are.

**To apply this, paste `supabase_staff_left.sql` into Supabase Dashboard → SQL Editor.**
Pure SQL, safe to run twice.

---

## 1. One nullable date, on both rosters

```sql
alter table teachers add column if not exists left_date date;
alter table staff    add column if not exists left_date date;
```

`left_date` is null for everyone currently working. Setting it is what "Left" means; the
date records when. This is the same shape as `students.deleted_at` in the recycle bin —
null means live — and a `date` rather than a timestamp because it sits next to
`joining_date` and prints the same way on the card.

## 2. Why not reuse `is_active`?

Because the two columns answer different questions. On `teachers`, `is_active: false`
means *her login is disabled* — she is still on the roster, still on the payroll sheet,
just locked out of the portal. On `staff`, it means "no longer employed" but leaves the
row on the same list. "Left" is a stronger statement: off the active list entirely, into
a register of her own.

Marking a teacher as left **also sets `is_active: false`**, because a login for someone
who no longer works here should not keep working. "Rejoin" clears `left_date` and turns
the login back on.

## 3. What the UI does with it

- **Teachers list** — splits into "Teaching Staff" (`left_date` null) and "Left Teachers".
  Each active card gains a **Left** button; each left card has **Rejoin** and the same
  Remove as before.
- **Admin Staff list** — the same split into "Non-Teaching Staff" and "Left Staff".
- **Attendance & Salary** — anyone with a `left_date` is off the live register, the same
  way retired staff already were. Salary rows already written stay in `staff_salaries`.

## 4. No RLS changes

The existing update policies on `teachers` and `staff` are row-level, so an admin who can
already edit a row can set `left_date` on it. Sub-admins need the `teachers` permission,
exactly as before.
