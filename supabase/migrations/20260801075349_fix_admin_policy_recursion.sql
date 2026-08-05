-- Helper function that checks admin status without triggering RLS recursion
create or replace function is_admin_user(p_user_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select coalesce(is_admin, false) from profiles where id = p_user_id;
$$;

-- Drop the recursive policy and replace it using the function instead
drop policy if exists "Admins can view all profiles" on profiles;

create policy "Admins can view all profiles"
on profiles for select
using (is_admin_user(auth.uid()));