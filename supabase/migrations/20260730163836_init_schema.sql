-- =========================================
-- Tables
-- =========================================

create table shows (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  event_date timestamptz not null,
  venue text,
  created_at timestamptz default now()
);

create table seats (
  id uuid primary key default gen_random_uuid(),
  show_id uuid references shows(id) on delete cascade,
  section text not null,
  row_number int not null,
  seat_number int not null,
  pos_x int not null,
  pos_y int not null,
  created_at timestamptz default now(),
  unique (show_id, section, row_number, seat_number)
);

create table reservations (
  id uuid primary key default gen_random_uuid(),
  seat_id uuid references seats(id) on delete cascade,
  show_id uuid references shows(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  status text not null check (status in ('locked', 'confirmed', 'expired', 'cancelled')),
  expires_at timestamptz,
  created_at timestamptz default now()
);

create index idx_reservations_seat_active
  on reservations (seat_id)
  where status in ('locked', 'confirmed');

create index idx_reservations_user_show
  on reservations (user_id, show_id)
  where status in ('locked', 'confirmed');

-- =========================================
-- lock_seat: places a temporary hold on a seat
-- Enforces: seat not already held/confirmed, user under 4-seat cap
-- =========================================

create or replace function lock_seat(p_seat_id uuid, p_user_id uuid)
returns json
language plpgsql
security definer
as $$
declare
  v_show_id uuid;
  v_existing record;
  v_active_count int;
begin
  select show_id into v_show_id from seats where id = p_seat_id;
  if v_show_id is null then
    return json_build_object('success', false, 'reason', 'seat_not_found');
  end if;

  -- lock any existing active reservation row for this seat
  select id, status, expires_at
  into v_existing
  from reservations
  where seat_id = p_seat_id
    and status in ('locked', 'confirmed')
    and (status = 'confirmed' or expires_at > now())
  for update;

  if found then
    return json_build_object('success', false, 'reason', 'seat_taken');
  end if;

  -- clean up any stale expired lock row for this seat
  delete from reservations
  where seat_id = p_seat_id and status = 'locked' and expires_at <= now();

  -- enforce the 4-seat cap per user per show
  select count(*) into v_active_count
  from reservations
  where user_id = p_user_id
    and show_id = v_show_id
    and status in ('locked', 'confirmed')
    and (status = 'confirmed' or expires_at > now());

  if v_active_count >= 4 then
    return json_build_object('success', false, 'reason', 'cap_reached');
  end if;

  insert into reservations (seat_id, show_id, user_id, status, expires_at)
  values (p_seat_id, v_show_id, p_user_id, 'locked', now() + interval '10 minutes');

  return json_build_object('success', true);
end;
$$;

-- =========================================
-- confirm_reservation: finalizes all of a user's held seats for a show
-- =========================================

create or replace function confirm_reservation(p_user_id uuid, p_show_id uuid)
returns json
language plpgsql
security definer
as $$
declare
  v_count int;
begin
  update reservations
  set status = 'confirmed', expires_at = null
  where user_id = p_user_id
    and show_id = p_show_id
    and status = 'locked'
    and expires_at > now();

  get diagnostics v_count = row_count;

  if v_count = 0 then
    return json_build_object('success', false, 'reason', 'no_active_holds');
  end if;

  return json_build_object('success', true, 'confirmed_count', v_count);
end;
$$;

-- =========================================
-- Scheduled cleanup of expired locks (requires pg_cron extension)
-- =========================================

create extension if not exists pg_cron;

select cron.schedule(
  'release-expired-locks',
  '* * * * *',
  $$ delete from reservations where status = 'locked' and expires_at <= now(); $$
);

-- =========================================
-- Row-Level Security
-- =========================================

alter table seats enable row level security;
alter table reservations enable row level security;

create policy "Anyone can view seats"
on seats for select
using (true);

create policy "Users see own reservations"
on reservations for select
using (auth.uid() = user_id);

-- Note: no insert/update policies for reservations —
-- all writes go through lock_seat / confirm_reservation (security definer),
-- so direct table writes from clients are blocked by default.