-- Notifications in the pull list app (app.html): a push to the customer's phone when their books are ready for
-- pickup, and when a series or artist they follow adds new titles to their list.
--
-- The Edge Function `push-notify` sends them (Web Push, signed with the VAPID keys in its secrets). This migration adds:
--   * push_subscriptions: one row per phone or browser that turned notifications on (only through the functions below)
--   * customers.push_arrivals / push_new_titles: the customer's own on/off for each kind (App → Account)
--   * reservations.arrival_pushed_at and customers.new_titles_pushed_at: what has been sent, so nothing is sent twice
--   * an hourly tick that calls the function when there is something to send, inside the arrival email's sending hours
--     (Emails → "Your books are in"), so nobody's phone buzzes at night

create table public.push_subscriptions (
  id           bigint generated always as identity primary key,
  customer_id  bigint not null references public.customers (id) on delete cascade,
  endpoint     text   not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh       text   not null check (length(p256dh) <= 200),
  auth         text   not null check (length(auth) <= 100),
  user_agent   text   check (length(user_agent) <= 300),
  created_at   timestamptz not null default now(),
  last_sent_at timestamptz
);
create index push_subscriptions_customer_idx on public.push_subscriptions (customer_id);
alter table public.push_subscriptions enable row level security;
-- Customers see which of their devices get notifications; adding and removing goes through the functions below.
create policy "own push subscriptions read" on public.push_subscriptions for select
  using (customer_id in (select id from public.customers where user_id = auth.uid()));
create policy "staff read push subscriptions" on public.push_subscriptions for select using (public.is_staff());

alter table public.customers
  add column push_arrivals        boolean not null default true,
  add column push_new_titles      boolean not null default true,
  add column new_titles_pushed_at timestamptz;
grant update (push_arrivals, push_new_titles) on public.customers to authenticated;

alter table public.reservations add column arrival_pushed_at timestamptz;

-- Stamp "last updated by": marking a notice as sent is bookkeeping, not an edit; a title that leaves "arrived" can be
-- announced again if it comes back. (As in 20261110000000_arrival_email.sql, plus the push stamp.)
create or replace function public.reservations_stamp()
returns trigger
language plpgsql set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if tg_op = 'UPDATE' then
    if (new.arrival_notified_at is distinct from old.arrival_notified_at or new.arrival_pushed_at is distinct from old.arrival_pushed_at)
       and new.status = old.status and new.quantity = old.quantity then
      return new;
    end if;
    if new.status is distinct from old.status and new.status <> 'arrived' then
      new.arrival_notified_at := null;
      new.arrival_pushed_at := null;
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

-- Titles already waiting at the counter: nobody has a phone signed up yet, so there is nothing to announce. (After the
-- trigger above, which treats this as bookkeeping and leaves each line's "last updated" alone.)
update public.reservations set arrival_pushed_at = now() where status = 'arrived';

-- The signed-in customer turns notifications on for this device. A device that was signed in as someone else moves
-- to this customer. Only what happens from now on is announced: books already waiting and titles already added aren't.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_customer bigint;
begin
  select id into v_customer from public.customers where user_id = auth.uid();
  if v_customer is null then
    raise exception 'Please sign in.' using errcode = 'P0001';
  end if;
  if coalesce(p_endpoint, '') !~ '^https://' or length(p_endpoint) > 1000 or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'This browser sent a notification address we can''t use.' using errcode = 'P0001';
  end if;
  insert into public.push_subscriptions (customer_id, endpoint, p256dh, auth, user_agent)
  values (v_customer, p_endpoint, left(p_p256dh, 200), left(p_auth, 100), left(p_user_agent, 300))
  on conflict (endpoint) do update set customer_id = excluded.customer_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent;

  update public.reservations r set arrival_pushed_at = now()
  from public.reservation_orders o
  where o.id = r.order_id and o.customer_id = v_customer and r.status = 'arrived' and r.arrival_pushed_at is null;
  update public.customers set new_titles_pushed_at = greatest(coalesce(new_titles_pushed_at, now()), now()) where id = v_customer;
end;
$$;
revoke execute on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

-- Turn notifications off for one device (the customer's own).
create or replace function public.delete_push_subscription(p_endpoint text)
returns void
language sql security definer set search_path = public
as $$
  delete from public.push_subscriptions s
  using public.customers c
  where c.id = s.customer_id and c.user_id = auth.uid() and s.endpoint = p_endpoint;
$$;
revoke execute on function public.delete_push_subscription(text) from public, anon;
grant execute on function public.delete_push_subscription(text) to authenticated;

-- Hourly check (at :15, after the status flip at :00 and the follow sweep at :30 of the hour before): inside the
-- sending hours, when a customer with notifications on has a book newly ready or a title a follow added, ask the
-- function to send. It sits next to the email function, so it uses that function's address and secret.
create or replace function public.push_notify_tick()
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare
  s     public.settings;
  v_hr  int;
  v_url text;
  v_key text;
begin
  select * into s from public.settings where id = 1;
  if s.id is null then
    return;
  end if;
  v_hr := extract(hour from (now() at time zone coalesce(s.timezone, 'America/New_York')))::int;
  if v_hr < s.arrival_email_after_hour or v_hr >= s.arrival_email_before_hour then
    return;
  end if;
  if not exists (
    select 1
    from public.reservations r
    join public.reservation_orders o on o.id = r.order_id
    join public.customers c on c.id = o.customer_id
    where exists (select 1 from public.push_subscriptions p where p.customer_id = c.id)
      and (
        (c.push_arrivals and r.status = 'arrived' and r.arrival_pushed_at is null)
        or (c.push_new_titles and r.status = 'open' and r.source in ('series', 'artist')
            and r.created_at > coalesce(c.new_titles_pushed_at, now() - interval '1 day'))
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

select cron.schedule('push-notify', '15 * * * *', 'select public.push_notify_tick()');
