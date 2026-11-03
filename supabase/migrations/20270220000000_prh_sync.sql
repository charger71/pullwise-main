-- PRH title updates (Edge Function prh-sync): in the master catalog, PRH titles are looked up in the Penguin Random
-- House API hourly, to fill in descriptions and creators the sheets don't carry and to keep dates and retail prices
-- current between imports. Shops get the changes through catalog-sync. Every shop runs this migration, but the
-- function does nothing without the PRH_API_KEY secret, which only the catalog has.

-- When each title was last looked up and what PRH said, kept apart from items so a lookup that changes nothing
-- doesn't touch items.updated_at (which would make every shop copy the title again). sale_status is PRH's raw
-- availability code (IN, IP, EL, …), kept for the distributor-availability work.
create table public.prh_titles (
  item_id     bigint primary key references public.items (id) on delete cascade,
  checked_at  timestamptz not null default now(),
  found       boolean not null,
  domain      text,
  sale_status text
);
alter table public.prh_titles enable row level security;
create policy "staff read prh titles" on public.prh_titles for select using (public.is_staff());

-- The next PRH titles to look up: never looked up first, then the longest since. Only titles out within the last
-- 60 days or still to come (older ones stop changing), plus any still missing a description. Those are looked up
-- at most once a day; an older title still missing one (PRH may have no copy for it) once a month.
-- Called only by prh-sync (service role).
create or replace function public.prh_sync_batch(p_limit int)
returns table (id bigint, upc text, isbn text, description text, creators text, retail_price numeric,
               foc_date date, release_date date)
language sql stable security definer set search_path = public
as $$
  select i.id, i.upc, i.isbn, i.description, i.creators, i.retail_price, i.foc_date, i.release_date
  from public.items i
  left join public.prh_titles p on p.item_id = i.id
  where i.distributor = 'prh'
    and (i.upc is not null or i.isbn is not null)
    and (i.release_date is null or i.release_date >= public.shop_today() - 60 or nullif(i.description, '') is null)
    and (p.checked_at is null or p.checked_at < now() - case
      when i.release_date is null or i.release_date >= public.shop_today() - 60 then interval '20 hours'
      else interval '30 days' end)
  order by p.checked_at nulls first, i.release_date desc nulls first, i.id
  limit p_limit;
$$;
revoke execute on function public.prh_sync_batch(int) from public, anon, authenticated;

-- Hourly tick, the same way as catalog_sync_tick (the weekly email's address with the function name swapped).
create or replace function public.prh_sync_tick()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_url text;
  v_key text;
begin
  select replace(decrypted_secret, '/weekly-pull-list', '/prh-sync') into v_url from vault.decrypted_secrets where name = 'weekly_email_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'weekly_email_secret';
  if v_url is null or v_key is null then return; end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_key),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
end;
$$;
revoke execute on function public.prh_sync_tick() from public, anon, authenticated;

-- At :05, so it finishes well before the shops' catalog-sync at :20 picks up what changed.
select cron.schedule('prh-sync', '5 * * * *', 'select public.prh_sync_tick()');
