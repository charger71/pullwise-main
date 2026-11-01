-- "Tell me when it's in" in the pull list app: a customer asks to hear when a title that can't be reserved (sold out,
-- on backorder, or past its order cutoff) is in the shop. push-notify sends one notification when the title's status
-- turns to one in stock, then forgets the request.

create table public.stock_alerts (
  id          bigint generated always as identity primary key,
  customer_id bigint not null references public.customers (id) on delete cascade,
  item_id     bigint not null references public.items (id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (customer_id, item_id)
);
create index stock_alerts_item_idx on public.stock_alerts (item_id);
alter table public.stock_alerts enable row level security;
-- Customers see, add and remove their own (js/customer.js); staff can see who is waiting for what.
create policy "own stock alerts read" on public.stock_alerts for select
  using (customer_id in (select id from public.customers where user_id = auth.uid()));
create policy "own stock alerts add" on public.stock_alerts for insert
  with check (customer_id in (select id from public.customers where user_id = auth.uid()));
create policy "own stock alerts remove" on public.stock_alerts for delete
  using (customer_id in (select id from public.customers where user_id = auth.uid()));
create policy "staff read stock alerts" on public.stock_alerts for select using (public.is_staff());
grant select, insert, delete on public.stock_alerts to authenticated;

-- Hourly check (as in 20270209000000_push_reminders.sql), now also when a title someone asked about is in.
create or replace function public.push_notify_tick()
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare
  s       public.settings;
  v_hr    int;
  v_today date;
  v_url   text;
  v_key   text;
begin
  select * into s from public.settings where id = 1;
  if s.id is null then
    return;
  end if;
  v_hr := extract(hour from (now() at time zone coalesce(s.timezone, 'America/New_York')))::int;
  if v_hr < s.arrival_email_after_hour or v_hr >= s.arrival_email_before_hour then
    return;
  end if;
  v_today := public.shop_today();
  if not exists (
    select 1
    from public.reservations r
    join public.reservation_orders o on o.id = r.order_id
    join public.customers c on c.id = o.customer_id
    left join public.items i on i.id = r.item_id
    where exists (select 1 from public.push_subscriptions p where p.customer_id = c.id)
      and (
        (c.push_arrivals and r.status = 'arrived' and r.arrival_pushed_at is null)
        or (c.push_new_titles and r.status = 'open' and r.source in ('series', 'artist')
            and r.created_at > coalesce(c.new_titles_pushed_at, now() - interval '1 day'))
        -- a week waiting, or two days of the hold left (messages.js pickupDue)
        or (c.push_reminders and r.status = 'arrived' and r.arrived_on is not null
            and r.arrived_on + s.hold_days >= v_today
            and ((r.pickup_reminders < 1 and r.arrived_on <= v_today - 7)
                 or (r.pickup_reminders < 2 and r.arrived_on + s.hold_days <= v_today + 2)))
        -- tomorrow is the last day to change it
        or (c.push_reminders and r.status = 'open' and i.foc_date is not null
            and public.last_change_day(i.foc_date) = v_today + 1
            and c.cutoff_pushed_on is distinct from v_today + 1)
      )
  ) and not exists (
    -- a title someone asked about is in the shop now
    select 1
    from public.stock_alerts a
    join public.items i on i.id = a.item_id
    where i.status in ('new_this_wednesday', 'just_arrived', 'available', 'low_stock', 'sale', 'clearance')
      and exists (select 1 from public.push_subscriptions p where p.customer_id = a.customer_id)
  ) then
    return;
  end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'weekly_email_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'weekly_email_secret';
  if v_url is null or v_key is null then
    raise warning 'app notifications are waiting but the weekly_email_url / weekly_email_secret Vault secrets are missing';
    return;
  end if;

  perform net.http_post(
    url := regexp_replace(v_url, '/weekly-pull-list$', '/push-notify'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_key),
    body := jsonb_build_object('mode', 'send'),
    timeout_milliseconds := 120000
  );
end;
$$;
revoke execute on function public.push_notify_tick() from public, anon, authenticated;
