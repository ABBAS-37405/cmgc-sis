-- CMGC — Fee plans (admin-editable) + labelled fee rows
-- Paste this WHOLE file into Supabase Dashboard -> SQL Editor and press Run.
-- Safe to run more than once.
--
-- Until now the amounts lived as constants in the frontend (ADMISSION_FEE = 12500,
-- FEE_AMOUNTS per group), so changing a fee meant a code edit and a redeploy.
-- This moves them into a table the admin can edit from the portal.


-- ============================================================
-- 1. fee_plans — one row per (year, group)
-- ============================================================

create table if not exists fee_plans (
  id             uuid primary key default gen_random_uuid(),
  year_of_study  text not null,
  program        text not null,
  admission_fee  numeric not null default 12500,
  monthly_fee    numeric not null,
  -- Stored rather than computed: the admin may override the headline total
  -- without it being forced to equal admission_fee + monthly_fee x months.
  total_fee      numeric not null,
  -- The payment schedule. Each entry is
  --   { "label": "2nd Installment", "months": 4, "due_month": 11 }
  -- `months` x monthly_fee is what that entry charges, and `due_month` is the
  -- calendar month it falls due (1-12). `due_month: null` means "at admission",
  -- which resolves to a week after the student is enrolled.
  installments   jsonb not null default '[]'::jsonb,
  updated_at     timestamptz not null default now(),
  unique (year_of_study, program)
);


-- ============================================================
-- 2. fees.label — so a student can tell her charges apart
-- ============================================================
-- Without this every generated row is just an amount and a date; the student's
-- Fee tab would show three identical "12000" entries with nothing to
-- distinguish them.
alter table fees add column if not exists label text;
alter table fees add column if not exists year_of_study text;


-- ============================================================
-- 3. Seed the plans
-- ============================================================
-- 1st year: admission fee, then three 4-month installments (1st due at
--           admission, 2nd in November, 3rd in February) — 12 months in total.
-- 2nd year: admission fee, then eight separate monthly charges, Sep to Apr.
--
-- NOTE ON FA-IT: seeded at the same rate as the science groups, following the
-- rule as given ("monthly fee 3000 of all groups except humanities"). If FA-IT
-- should instead match Humanities, change it from the portal's Fee Settings —
-- no SQL needed.

insert into fee_plans (year_of_study, program, admission_fee, monthly_fee, total_fee, installments)
values
  -- ---------- 1st Year ----------
  ('1st Year', 'Pre-Engineering', 12500, 3000, 48500,
   '[{"label":"1st Installment","months":4,"due_month":null},
     {"label":"2nd Installment","months":4,"due_month":11},
     {"label":"3rd Installment","months":4,"due_month":2}]'::jsonb),
  ('1st Year', 'Pre-Medical', 12500, 3000, 48500,
   '[{"label":"1st Installment","months":4,"due_month":null},
     {"label":"2nd Installment","months":4,"due_month":11},
     {"label":"3rd Installment","months":4,"due_month":2}]'::jsonb),
  ('1st Year', 'ICS', 12500, 3000, 48500,
   '[{"label":"1st Installment","months":4,"due_month":null},
     {"label":"2nd Installment","months":4,"due_month":11},
     {"label":"3rd Installment","months":4,"due_month":2}]'::jsonb),
  ('1st Year', 'General Science', 12500, 3000, 48500,
   '[{"label":"1st Installment","months":4,"due_month":null},
     {"label":"2nd Installment","months":4,"due_month":11},
     {"label":"3rd Installment","months":4,"due_month":2}]'::jsonb),
  ('1st Year', 'FA-IT', 12500, 3000, 48500,
   '[{"label":"1st Installment","months":4,"due_month":null},
     {"label":"2nd Installment","months":4,"due_month":11},
     {"label":"3rd Installment","months":4,"due_month":2}]'::jsonb),
  ('1st Year', 'Humanities', 12500, 2500, 42500,
   '[{"label":"1st Installment","months":4,"due_month":null},
     {"label":"2nd Installment","months":4,"due_month":11},
     {"label":"3rd Installment","months":4,"due_month":2}]'::jsonb),

  -- ---------- 2nd Year (Sep–Apr, charged month by month) ----------
  ('2nd Year', 'Pre-Engineering', 12500, 2500, 32500,
   '[{"label":"September","months":1,"due_month":9},{"label":"October","months":1,"due_month":10},
     {"label":"November","months":1,"due_month":11},{"label":"December","months":1,"due_month":12},
     {"label":"January","months":1,"due_month":1},{"label":"February","months":1,"due_month":2},
     {"label":"March","months":1,"due_month":3},{"label":"April","months":1,"due_month":4}]'::jsonb),
  ('2nd Year', 'Pre-Medical', 12500, 2500, 32500,
   '[{"label":"September","months":1,"due_month":9},{"label":"October","months":1,"due_month":10},
     {"label":"November","months":1,"due_month":11},{"label":"December","months":1,"due_month":12},
     {"label":"January","months":1,"due_month":1},{"label":"February","months":1,"due_month":2},
     {"label":"March","months":1,"due_month":3},{"label":"April","months":1,"due_month":4}]'::jsonb),
  ('2nd Year', 'ICS', 12500, 2500, 32500,
   '[{"label":"September","months":1,"due_month":9},{"label":"October","months":1,"due_month":10},
     {"label":"November","months":1,"due_month":11},{"label":"December","months":1,"due_month":12},
     {"label":"January","months":1,"due_month":1},{"label":"February","months":1,"due_month":2},
     {"label":"March","months":1,"due_month":3},{"label":"April","months":1,"due_month":4}]'::jsonb),
  ('2nd Year', 'General Science', 12500, 2500, 32500,
   '[{"label":"September","months":1,"due_month":9},{"label":"October","months":1,"due_month":10},
     {"label":"November","months":1,"due_month":11},{"label":"December","months":1,"due_month":12},
     {"label":"January","months":1,"due_month":1},{"label":"February","months":1,"due_month":2},
     {"label":"March","months":1,"due_month":3},{"label":"April","months":1,"due_month":4}]'::jsonb),
  ('2nd Year', 'FA-IT', 12500, 2500, 32500,
   '[{"label":"September","months":1,"due_month":9},{"label":"October","months":1,"due_month":10},
     {"label":"November","months":1,"due_month":11},{"label":"December","months":1,"due_month":12},
     {"label":"January","months":1,"due_month":1},{"label":"February","months":1,"due_month":2},
     {"label":"March","months":1,"due_month":3},{"label":"April","months":1,"due_month":4}]'::jsonb),
  ('2nd Year', 'Humanities', 12500, 2000, 28500,
   '[{"label":"September","months":1,"due_month":9},{"label":"October","months":1,"due_month":10},
     {"label":"November","months":1,"due_month":11},{"label":"December","months":1,"due_month":12},
     {"label":"January","months":1,"due_month":1},{"label":"February","months":1,"due_month":2},
     {"label":"March","months":1,"due_month":3},{"label":"April","months":1,"due_month":4}]'::jsonb)
on conflict (year_of_study, program) do nothing;
-- `do nothing` so re-running never overwrites amounts the admin has since edited.


-- ============================================================
-- 4. Row Level Security
-- ============================================================

alter table fee_plans enable row level security;

drop policy if exists "fee_plans_select" on fee_plans;
drop policy if exists "fee_plans_insert" on fee_plans;
drop policy if exists "fee_plans_update" on fee_plans;
drop policy if exists "fee_plans_delete" on fee_plans;

-- Readable by everyone: it is a price list, and the student portal shows the
-- year's total on her Fee tab.
create policy "fee_plans_select" on fee_plans for select to anon, authenticated using (true);

-- Only signed-in admins may change the amounts. is_admin_user() comes from
-- SUPABASE_TEACHERS_CLASS_TESTS.md — run that migration first if you have not.
create policy "fee_plans_insert" on fee_plans for insert to authenticated with check (is_admin_user());
create policy "fee_plans_update" on fee_plans for update to authenticated using (is_admin_user());
create policy "fee_plans_delete" on fee_plans for delete to authenticated using (is_admin_user());


-- ============================================================
-- Verify (run separately, after the above)
-- ============================================================
-- select year_of_study, program, admission_fee, monthly_fee, total_fee,
--        jsonb_array_length(installments) as installment_count
--   from fee_plans
--  order by year_of_study, program;
--
-- Expected: 12 rows. 1st Year totals 48500 (42500 Humanities) with 3 installments;
-- 2nd Year totals 32500 (28500 Humanities) with 8.
