create policy "Anyone can view active seat status"
on reservations for select
using (status in ('locked', 'confirmed'));