-- Pull list, phase 5: the weekly pull-list email.
--
-- The Edge Function `weekly-pull-list` builds and sends the emails (through Resend). This
-- migration adds what it needs: schedule settings (edited in Shop Settings), a per-customer
-- unsubscribe token, a "last emailed" date so a retry never double-sends, and an hourly
-- tick that calls the function when the shop-local day and hour match the schedule.
--
-- The email is OFF until staff switch it on in Shop Settings (after the Resend key and
-- sending domain are set up), so applying this migration sends nothing.

alter table public.settings
  add column pull_list_email_enabled   boolean  not null default false,
  add column pull_list_email_day       smallint not null default 4  check (pull_list_email_day between 0 and 6),  -- 0 = Sunday … 4 = Thursday
  add column pull_list_email_hour      smallint not null default 9  check (pull_list_email_hour between 0 and 23), -- shop-local hour
  add column pull_list_email_from      text,                                                                        -- e.g. 'Your Comic Shop <pulllist@example.com>'
  add column pull_list_email_last_sent date;

alter table public.customers
  add column unsubscribe_token uuid not null default gen_random_uuid(),
  add column last_emailed_on   date;
create unique index customers_unsubscribe_token_key on public.customers (unsubscribe_token);

-- ---------------------------------------------------------------------------
-- Hourly tick
--
-- Reads two Vault secrets (set once, see the README):
--   weekly_email_url    https://<project>.supabase.co/functions/v1/weekly-pull-list
--   weekly_email_secret the same value as the function's CRON_SECRET
-- ---------------------------------------------------------------------------

create extension if not exists pg_net with schema extensions;

create or replace function public.weekly_pull_list_tick()
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare
  s       public.settings;
  v_local timestamp;
  v_url   text;
  v_key   text;
begin
  select * into s from public.settings where id = 1;
  if s.id is null or not s.pull_list_email_enabled then
    return;
  end if;
  v_local := now() at time zone coalesce(s.timezone, 'America/New_York');
  if extract(dow from v_local)::int <> s.pull_list_email_day
     or extract(hour from v_local)::int <> s.pull_list_email_hour
     or s.pull_list_email_last_sent = v_local::date then
    return;
  end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'weekly_email_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'weekly_email_secret';
  if v_url is null or v_key is null then
    raise warning 'weekly pull list email is on but the weekly_email_url / weekly_email_secret Vault secrets are missing';
    return;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_key),
    body := jsonb_build_object('mode', 'send'),
    timeout_milliseconds := 120000
  );
end;
$$;
revoke execute on function public.weekly_pull_list_tick() from public, anon, authenticated;

-- At :05 so it follows the on-the-hour status flip.
select cron.schedule('weekly-pull-list', '5 * * * *', 'select public.weekly_pull_list_tick()');
