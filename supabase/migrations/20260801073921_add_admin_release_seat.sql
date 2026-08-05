create or replace function release_seat(p_seat_id uuid, p_admin_id uuid)
returns json
language plpgsql
security definer
as $$
declare
  v_is_admin boolean;
begin
  select is_admin into v_is_admin from profiles where id = p_admin_id;

  if not coalesce(v_is_admin, false) then
    return json_build_object('success', false, 'reason', 'not_authorized');
  end if;

  delete from reservations
  where seat_id = p_seat_id and status in ('locked', 'confirmed');

  return json_build_object('success', true);
end;
$$;