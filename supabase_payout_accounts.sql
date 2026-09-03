-- ============================================================
-- CMGC — where each person's salary is sent (bank / EasyPaisa / JazzCash)
-- ============================================================
--
-- Run this in the Supabase SQL editor on a database that has already run
-- `supabase_staff_payroll.sql`.
--
-- WHAT CHANGES: four text columns on `teachers` and the same four on `staff`.
-- No new table, no policy, no constraint. The office fills them in so that when
-- a salary is transferred online, the account can be checked on the salary card
-- instead of hunting for it on a slip of paper.
--
--   payment_method   'Bank Transfer' | 'EasyPaisa' | 'JazzCash' | 'Cash' | 'Other'
--                    Free text — offered as a datalist in the UI, exactly like
--                    `staff.designation`, because the college will invent a
--                    wallet the day after any fixed list ships.
--   bank_name        the bank, for a bank transfer (blank for a wallet)
--   account_title    the name the account is held in
--   account_number   the account number, IBAN, or the wallet's mobile number
--
-- WHY NO CONSTRAINT: `payment_method` is a hint for the office, not something the
-- arithmetic branches on — `src/lib/payroll.js` never reads any of these. A bad
-- value costs nothing but a mislabelled card, and a check constraint would be the
-- first thing to need a migration.
--
-- RLS: nothing to add. Both tables already expose every column through their
-- existing select policies, and both already allow an admin
-- (`can_manage_teachers()`) to update. These columns ride along.
--
-- PRIVACY: an account number is not a secret in the way a password is, but it is
-- not public either. It is shown only inside the Teachers & Staff tab and the
-- salary sheet, both already gated by the `teachers` permission. It is
-- deliberately NOT put into the WhatsApp salary slip, which gets forwarded.

-- ------------------------------------------------------------
-- 1. Teaching staff
-- ------------------------------------------------------------
alter table teachers add column if not exists payment_method text;
alter table teachers add column if not exists bank_name      text;
alter table teachers add column if not exists account_title  text;
alter table teachers add column if not exists account_number text;

-- ------------------------------------------------------------
-- 2. Non-teaching staff
-- ------------------------------------------------------------
alter table staff add column if not exists payment_method text;
alter table staff add column if not exists bank_name      text;
alter table staff add column if not exists account_title  text;
alter table staff add column if not exists account_number text;

-- ------------------------------------------------------------
-- 3. Check
-- ------------------------------------------------------------
-- select column_name, data_type from information_schema.columns
-- where table_name in ('teachers', 'staff')
--   and column_name in ('payment_method', 'bank_name', 'account_title', 'account_number')
-- order by table_name, column_name;

-- ------------------------------------------------------------
-- Rollback
-- ------------------------------------------------------------
-- alter table teachers drop column if exists payment_method;
-- alter table teachers drop column if exists bank_name;
-- alter table teachers drop column if exists account_title;
-- alter table teachers drop column if exists account_number;
-- alter table staff drop column if exists payment_method;
-- alter table staff drop column if exists bank_name;
-- alter table staff drop column if exists account_title;
-- alter table staff drop column if exists account_number;
