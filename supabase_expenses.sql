-- =====================================================================
-- Accounts: the one thing the college spends money on that no other
-- table already records.
-- =====================================================================
--
-- Run this once in the Supabase Dashboard -> SQL Editor. Safe to re-run.
--
-- The Accounts screen (Reports -> Accounts) shows a month-by-month and a
-- whole-year profit/loss. Two of its three figures need no new storage at all:
--
--   income    sum of payment_transactions.amount where status = 'Success'
--   salaries  sum of staff_salaries.paid_amount
--
-- Both already exist and are already written by screens the office uses every
-- day, so the ledger cannot drift from them. This file adds only the third:
-- everything else the college pays for -- bills, rent, repairs, stationery,
-- fuel, printing -- which is nowhere in the schema because nothing else needs
-- it.
--
-- IMPORTANT, and the one way to get a wrong answer out of this screen: a
-- salary must never be entered here. Salaries are counted from staff_salaries,
-- so typing one in as a miscellaneous expense counts it twice and understates
-- the profit. The Accounts screen says so on the form; this comment is the
-- other half of that warning.


-- ---------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------
-- `spent_on` is a plain date, not a timestamp: what matters is the day the
-- money left, not the second the row was typed, and the ledger groups by the
-- month of this column. `created_at` still records when it was entered, which
-- is what tells you a March bill was back-dated in June.
create table if not exists expenses (
  id             uuid primary key default gen_random_uuid(),
  spent_on       date not null default current_date,
  category       text not null,
  description    text,
  amount         numeric not null default 0 check (amount >= 0),
  payment_method text,
  notes          text,
  recorded_by    uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- The screen always asks for one period at a time, never the whole table.
create index if not exists expenses_spent_on_idx on expenses (spent_on);

comment on table expenses is
  'Money the college spends that no other table records. Salaries are NOT here - they come from staff_salaries, and entering one here double-counts it.';
comment on column expenses.spent_on is
  'The day the money left. The Accounts ledger groups by the month of this column, not by created_at.';


-- ---------------------------------------------------------------------
-- 2. Row Level Security
-- ---------------------------------------------------------------------
alter table expenses enable row level security;

-- Gated on can_manage_teachers() -- the `teachers` permission, or super admin.
--
-- That is not an arbitrary reuse. The Accounts screen is a profit and loss, and
-- the expense half of it is mostly payroll: it reads staff_salaries, whose own
-- select policy is can_manage_teachers(). Gating expenses on anything looser
-- would produce the single worst failure this screen can have -- an admin who
-- cannot read salaries gets zero rows back with no error (RLS refuses reads
-- silently, exactly like the writes WRITE_BLOCKED_HINT is about) and is shown a
-- healthy profit that is missing every wage the college paid. One gate over
-- both tables is what makes the total either right or plainly refused.
--
-- The UI matches this: the Accounts sub-tab is only offered to an admin who
-- holds `teachers`, so nobody reaches a screen the database will half-answer.
drop policy if exists "expenses_select" on expenses;
create policy "expenses_select" on expenses for select to authenticated
using (can_manage_teachers());

drop policy if exists "expenses_write" on expenses;
create policy "expenses_write" on expenses for all to authenticated
using (can_manage_teachers()) with check (can_manage_teachers());


-- ---------------------------------------------------------------------
-- 3. Rollback
-- ---------------------------------------------------------------------
-- drop table if exists expenses;
