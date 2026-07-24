# Supabase Schema Change - Admin-Recorded Fee Payments

Adds the ability for admin to directly mark a student's fee as paid (e.g. cash handed
in at the office, no online proof needed) from the Fee Verification → Unpaid Fee tab,
and distinguishes these from student-submitted-and-approved payments on the student's
own Fee tab.

Run this once in the Supabase Dashboard → SQL Editor:

```sql
alter table payment_transactions
add column if not exists recorded_by text not null default 'student';

comment on column payment_transactions.recorded_by is
  'student = student submitted proof (admin may have approved it); admin = admin recorded the payment directly with no student submission';
```

No RLS changes needed — `payment_transactions`/`fees` already allow the admin dashboard
full read/write (unchanged by the earlier sub-admin migration), and this is just a new
column with a safe default.

## Rollback

```sql
alter table payment_transactions drop column if exists recorded_by;
```
