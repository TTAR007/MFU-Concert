create or replace function release_own_lock(p_seat_id uuid, p_user_id uuid)
returns json
language plpgsql
security definer
as $$
begin
  delete from reservations
  where seat_id = p_seat_id
    and user_id = p_user_id
    and status = 'locked';

  return json_build_object('success', true);
end;
$$;