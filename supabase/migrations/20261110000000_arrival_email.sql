-- "Your books are in": an email to each customer when titles on their pull list become ready for pickup.
--
-- The Edge Function `weekly-pull-list` (mode "arrivals") builds and sends it. This migration adds:
--   * reservations.arrival_notified_at: which arrived titles have been announced, so nothing is sent twice
--   * customers.notify_arrivals: the customer's own on/off (profile checkbox; the email's unsubscribe link)
--   * settings: master switch (OFF until staff turn it on) and the hours of the day emails may go out
--   * an hourly tick that calls the function only when there is something new to announce

alter table public.settings
  add column arrival_email_enabled     boolean  not null default false,
  add column arrival_email_after_hour  smallint not null default 12 check (arrival_email_after_hour between 0 and 23),  -- shop-local; the shop opens at 11
  add column arrival_email_before_hour smallint not null default 20 check (arrival_email_before_hour between 1 and 24);

alter table public.customers add column notify_arrivals boolean not null default true;
grant update (notify_arrivals) on public.customers to authenticated;

alter table public.reservations add column arrival_notified_at timestamptz;
-- Titles already waiting at the counter were announced the old way; don't email about them now.
update public.reservations set arrival_notified_at = now() where status = 'arrived';

-- Stamp "last updated by": marking an email as sent is bookkeeping, not an edit; a title that leaves
-- "arrived" can be announced again if it comes back.
create or replace function public.reservations_stamp()
returns trigger
language plpgsql set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if tg_op = 'UPDATE' then
    if new.arrival_notified_at is distinct from old.arrival_notified_at and new.status = old.status and new.quantity = old.quantity then
      return new;
    end if;
    if new.status is distinct from old.status and new.status <> 'arrived' then
      new.arrival_notified_at := null;
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

-- Staff can set the arrival-email preference for a customer too.
create or replace function public.staff_save_customer(p_id bigint, p jsonb)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_id    bigint;
  v_first text := nullif(trim(p ->> 'first_name'), '');
  v_last  text := nullif(trim(p ->> 'last_name'), '');
  v_email text := nullif(lower(trim(p ->> 'email')), '');
  v_phone text := nullif(trim(p ->> 'phone'), '');
begin
  if not public.is_staff() then
    raise exception 'Staff only.' using errcode = '42501';
  end if;
  if v_first is null then
    raise exception 'Please enter the customer''s first name.' using errcode = 'P0001';
  end if;
  if v_email is null and v_phone is null then
    raise exception 'Please enter an email or a phone number.' using errcode = 'P0001';
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That email address doesn''t look right.' using errcode = 'P0001';
  end if;
  if p_id is null then
    insert into public.customers (first_name, last_name, email, phone, address1, city, state, zip, ship_arrivals, email_opt_in, notify_arrivals)
    values (
      v_first, v_last, v_email, v_phone,
      nullif(trim(p ->> 'address1'), ''), nullif(trim(p ->> 'city'), ''), nullif(trim(p ->> 'state'), ''), nullif(trim(p ->> 'zip'), ''),
      coalesce((p ->> 'ship_arrivals')::boolean, false), coalesce((p ->> 'email_opt_in')::boolean, true), coalesce((p ->> 'notify_arrivals')::boolean, true)
    ) returning id into v_id;
  else
    if exists (select 1 from public.customers where id = p_id and user_id is not null and lower(email) is distinct from v_email) then
      raise exception 'This customer has an account, so their email can''t be changed here.' using errcode = 'P0001';
    end if;
    update public.customers set
      first_name = v_first, last_name = v_last, email = v_email, phone = v_phone,
      address1 = nullif(trim(p ->> 'address1'), ''), city = nullif(trim(p ->> 'city'), ''), state = nullif(trim(p ->> 'state'), ''),
      zip = nullif(trim(p ->> 'zip'), ''), ship_arrivals = coalesce((p ->> 'ship_arrivals')::boolean, ship_arrivals),
      email_opt_in = coalesce((p ->> 'email_opt_in')::boolean, email_opt_in),
      notify_arrivals = coalesce((p ->> 'notify_arrivals')::boolean, notify_arrivals)
    where id = p_id returning id into v_id;
    if v_id is null then
      raise exception 'That customer no longer exists.' using errcode = 'P0001';
    end if;
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'Another customer already has that email address.' using errcode = 'P0001';
end;
$$;

-- Hourly check (at :10, after the status flip at :00): when the email is on, it is inside the sending hours,
-- and a customer who wants these emails has a newly arrived title, ask the function to send.
create or replace function public.arrival_email_tick()
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
  if s.id is null or not s.arrival_email_enabled then
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
    where r.status = 'arrived' and r.arrival_notified_at is null and c.email is not null and c.notify_arrivals
  ) then
    return;
  end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'weekly_email_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'weekly_email_secret';
  if v_url is null or v_key is null then
    raise warning 'arrival emails are on but the weekly_email_url / weekly_email_secret Vault secrets are missing';
    return;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_key),
    body := jsonb_build_object('mode', 'arrivals'),
    timeout_milliseconds := 120000
  );
end;
$$;
revoke execute on function public.arrival_email_tick() from public, anon, authenticated;

select cron.schedule('arrival-email', '10 * * * *', 'select public.arrival_email_tick()');
