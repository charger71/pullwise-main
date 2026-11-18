-- Titles → Sync now: staff start the master catalog sync (catalog-sync Edge Function) without waiting for the hourly
-- tick. requested_at is when staff last asked; a second press is refused while that run hasn't finished (it has
-- three minutes), so two runs don't overlap from the button.

alter table public.catalog_sync_state add column if not exists requested_at timestamptz;

create or replace function public.staff_catalog_sync_now()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  s public.catalog_sync_state;
begin
  if not public.is_staff() then raise exception 'Only staff can sync the catalog' using errcode = '42501'; end if;
  select * into s from public.catalog_sync_state where id = 1 for update;
  if s.requested_at > now() - interval '3 minutes' and (s.last_run_at is null or s.last_run_at < s.requested_at) then
    return jsonb_build_object('started', false, 'requested_at', s.requested_at);
  end if;
  update public.catalog_sync_state set requested_at = now() where id = 1;
  perform public.catalog_sync_tick();
  return jsonb_build_object('started', true, 'requested_at', now());
end;
$$;
revoke execute on function public.staff_catalog_sync_now() from public, anon;
grant execute on function public.staff_catalog_sync_now() to authenticated;
