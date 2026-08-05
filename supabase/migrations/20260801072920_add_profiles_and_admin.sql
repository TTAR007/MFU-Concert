-- Profiles table, one row per user
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  is_admin boolean not null default false,
  created_at timestamptz default now()
);

-- Auto-create a profile row whenever a new user signs up
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- RLS: users can read their own profile (to check is_admin)
alter table profiles enable row level security;

create policy "Users can view own profile"
on profiles for select
using (auth.uid() = id);