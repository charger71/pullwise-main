-- Reminders in the pull list app (supabase/functions/push-notify sends them; messages.js says when):
--   * books waiting at the counter: once after a week, and again when two days of the hold are left (Settings →
--     hold_days); reservations.pickup_reminders counts what each line has had, so neither is sent twice
--   * the day before the last day to change the list (the Saturday before each order cutoff): the open titles going
--     into that order; customers.cutoff_pushed_on is the last day reminded about
-- Both follow the customer's own switch, customers.push_reminders (App → Account → Notifications).

alter table public.customers
  add column push_reminders   boolean not null default true,
  add column cutoff_pushed_on date;
grant update (push_reminders) on public.customers to authenticated;

alter table public.reservations add column pickup_reminders smallint not null default 0;

-- Stamp "last updated by": sending a notice is bookkeeping, not an edit; a title that leaves "arrived" can be
-- announced and reminded about again if it comes back. (As in 20270207000000_push_notifications.sql, plus reminders.)
create or replace function public.reservations_stamp()
returns trigger
language plpgsql set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if tg_op = 'UPDATE' then
    if (new.arrival_notified_at is distinct from old.arrival_notified_at
        or new.arrival_pushed_at is distinct from old.arrival_pushed_at
        or new.pickup_reminders is distinct from old.pickup_reminders)
       and new.status = old.status and new.quantity = old.quantity then
      return new;
    end if;
    if new.status is distinct from old.status and new.status <> 'arrived' then
      new.arrival_notified_at := null;
      new.arrival_pushed_at := null;
      new.pickup_reminders := 0;
    end if;
  end if;
  new.updated_at := now();
  new.updated_by := v_uid;
  new.updated_via := case
    when v_uid is not null and public.is_staff() then 'staff'
    when v_uid is not null then 'customer'
    when coalesce(auth.role(), '') = 'anon' then 'guest'
    else 'system'
  end;
  return new;
end;
$$;

-- Books already waiting long enough for a reminder today: nobody turned these on, so start from the next one due.
update public.reservations r set pickup_reminders = case
    when r.arrived_on >= public.shop_today() - (s.hold_days - 2) then 1
    else 2
  end
from public.settings s
where s.id = 1 and r.status = 'arrived' and r.arrived_on is not null and r.arrived_on <= public.shop_today() - 7;

-- The last day to change a title whose FOC is `foc`: the Saturday before it (js/dates.js lastReserveDay).
create or replace function public.last_change_day(foc date)
returns date
language sql immutable
as $$
  select foc - (case when extract(dow from foc) = 6 then 7 else extract(dow from foc)::int + 1 end);
$$;

-- Hourly check (as in 20270207000000_push_notifications.sql): inside the sending hours, when a customer with
-- notifications on has something due, ask the function to send. Now also reminders.
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
