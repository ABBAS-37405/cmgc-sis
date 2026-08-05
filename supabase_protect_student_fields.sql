-- Prevent non-super-admins from changing passout/promote/delete fields
-- Run this after `supabase_add_passout_fields.sql` and after `is_super_admin()` exists.

create or replace function protect_student_fields_on_update()
returns trigger
language plpgsql
security definer
as $$
begin
  -- If caller is super admin, allow everything
  if is_super_admin() then
    return new;
  end if;

  -- For non-super-admins, disallow changes to these columns:
  if (new.is_passout is distinct from old.is_passout)
     or (new.passout_at is distinct from old.passout_at)
     or (new.deleted_at is distinct from old.deleted_at)
     or (new.year_of_study is distinct from old.year_of_study)
  then
    raise exception 'Only super admin may change passout/promote/delete fields on students';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_student_fields on students;
create trigger protect_student_fields
before update on students
for each row
execute function protect_student_fields_on_update();

-- Note: this trigger complements the UI checks. It enforces at the DB level
-- that only super admins can change `is_passout`, `passout_at`, `deleted_at`
-- and `year_of_study`. Run this in Supabase SQL Editor.
