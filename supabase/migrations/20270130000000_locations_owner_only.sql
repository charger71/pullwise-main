-- Locations hold the shop's address and hours, which only owners may change in Shop Settings. Match that: any staff
-- login can still read locations, but adding, editing and deleting them is owner-only. (The trigger that mirrors
-- Shop Settings into the first location is security definer, so it is unaffected.)
drop policy "staff all locations" on public.locations;
create policy "staff read locations"    on public.locations for select using (public.is_staff());
create policy "owner insert locations"  on public.locations for insert with check (public.is_owner());
create policy "owner update locations"  on public.locations for update using (public.is_owner()) with check (public.is_owner());
create policy "owner delete locations"  on public.locations for delete using (public.is_owner());
