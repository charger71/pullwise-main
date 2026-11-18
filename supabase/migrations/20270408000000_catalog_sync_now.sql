-- Titles → Sync now: staff start the master catalog sync (catalog-sync Edge Function) without waiting for the hourly
-- tick. requested_at is when staff last asked; a second press is refused while that run hasn't finished (it has
-- three minutes), so two runs don't overlap from the button. A shop missing its catalog connection gets an error back
-- instead of a wait.

alter table public.catalog_sync_state add column if not exists requested_at timestamptz;

create or replace function public.staff_catalog_sync_now()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  s     public.catalog_sync_state;
  v_url text;
  v_key text;
begin
  if not public.is_staff() then raise exception 'Only staff can sync the catalog' using errcode = '42501'; end if;
  select * into s from public.catalog_sync_state where id = 1 for update;
  if s.requested_at > now() - interval '3 minutes' and (s.last_run_at is null or s.last_run_at < s.requested_at) then
    return jsonb_build_object('started', false, 'requested_at', s.requested_at);
  end if;
  -- The hourly tick's call (catalog_sync_tick), marked manual so a shop missing its catalog secrets says so.
  select replace(decrypted_secret, '/weekly-pull-list', '/catalog-sync') into v_url from vault.decrypted_secrets where name = 'weekly_email_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'weekly_email_secret';
  if v_url is null or v_key is null then raise exception 'The catalog sync isn’t set up on this shop (its function secrets are missing)'; end if;
  update public.catalog_sync_state set requested_at = now() where id = 1;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_key),
    body := '{"manual": true}'::jsonb,
    timeout_milliseconds := 150000
  );
  return jsonb_build_object('started', true, 'requested_at', now());
end;
$$;
revoke execute on function public.staff_catalog_sync_now() from public, anon;
grant execute on function public.staff_catalog_sync_now() to authenticated;
