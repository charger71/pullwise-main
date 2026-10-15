-- Customers must give both a phone number and an email address to place orders.
-- Guest orders need both; signed-in customers (who always have an email) need a phone number on their profile.

create or replace function public.create_reservation_order(
  p_name    text,
  p_phone   text,
  p_email   text,
  p_items   jsonb,
  p_website text default null  -- honeypot: real users never fill this in
)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_name     text := nullif(trim(p_name), '');
  v_phone    text := nullif(trim(p_phone), '');
  v_email    text := nullif(lower(trim(p_email)), '');
  v_digits   text;
  v_max      smallint;
  v_ip       inet;
  v_order_id bigint;
  v_line     record;
  v_item     public.items;
  v_title    text;
  v_existing int;
begin
  -- Silently accept bots so they don't learn the field is a trap.
  if coalesce(p_website, '') <> '' then
    return 0;
  end if;

  if v_name is null then
    raise exception 'Please enter your name.' using errcode = 'P0001';
  end if;
  if v_phone is null then
    raise exception 'Please enter your phone number.' using errcode = 'P0001';
  end if;
  if v_email is null then
    raise exception 'Please enter your email address.' using errcode = 'P0001';
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That email address doesn''t look right.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Your reservation list is empty.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'That''s a lot of titles for one order — please call the shop.' using errcode = 'P0001';
  end if;

  -- Rate limit by client IP (PostgREST forwards request headers).
  begin
    v_ip := split_part(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ',', 1)::inet;
  exception when others then
    v_ip := null;
  end;
  if v_ip is not null and (
    select count(*) from public.reservation_orders
    where client_ip = v_ip and created_at > now() - interval '10 minutes'
  ) >= 10 then
    raise exception 'Too many reservations in a short time — please try again later or call the shop.' using errcode = 'P0001';
  end if;

  select max_copies_per_title into v_max from public.settings where id = 1;
  v_max := coalesce(v_max, 10);
  v_digits := nullif(regexp_replace(coalesce(v_phone, ''), '\D', '', 'g'), '');

  insert into public.reservation_orders (name, phone, email, client_ip)
  values (v_name, v_phone, v_email, v_ip)
  returning id into v_order_id;

  for v_line in
    select (e ->> 'item_id')::bigint as item_id, sum((e ->> 'quantity')::int) as quantity
    from jsonb_array_elements(p_items) e
    group by 1
  loop
    select * into v_item from public.items where id = v_line.item_id;
    v_title := coalesce(v_item.title || coalesce(' #' || v_item.issue_number, ''), 'One of those titles');

    if v_item.id is null or v_item.status <> 'pre_order' or v_item.hidden then
      raise exception '% is no longer open for pre-order — please remove it from your list.', v_title using errcode = 'P0001';
    end if;
    -- Reservations close at midnight (shop time) on the Saturday before FOC (usually a
    -- Monday), so the shop has time to collect the reservations and place the order.
    if v_item.foc_date is not null and v_item.foc_date <= public.reservations_close_through() then
      raise exception 'Reservations for % have closed — please remove it from your list.', v_title using errcode = 'P0001';
    end if;
    if v_line.quantity is null or v_line.quantity < 1 then
      raise exception 'Quantity for % must be at least 1.', v_title using errcode = 'P0001';
    end if;

    -- Per-customer, per-title copy limit (matched on phone digits or email),
    -- counting earlier orders as well as this one.
    select coalesce(sum(r.quantity), 0) into v_existing
    from public.reservations r
    join public.reservation_orders o on o.id = r.order_id
    where r.item_id = v_item.id
      and r.order_id <> v_order_id
      and r.status not in ('cancelled', 'released')
      and ((v_digits is not null and o.phone_digits = v_digits)
        or (v_email is not null and lower(o.email) = v_email));

    if v_existing + v_line.quantity > v_max then
      if v_existing > 0 then
        raise exception 'Limit is % copies per customer for % (you already have % reserved).',
          v_max, v_title, v_existing using errcode = 'P0001';
      end if;
      raise exception 'Limit is % copies per customer for %.', v_max, v_title using errcode = 'P0001';
    end if;

    insert into public.reservations (order_id, item_id, quantity)
    values (v_order_id, v_item.id, v_line.quantity);
  end loop;

  return v_order_id;
end;
$$;

create or replace function public.pull_list_add(p_item_id bigint, p_quantity int default 1)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  c    public.customers := public._pull_list_customer();
  item public.items;
begin
  if c.phone is null or nullif(trim(c.phone), '') is null then
    raise exception 'Please add your phone number under My Pull List before adding titles.' using errcode = 'P0001';
  end if;
  select * into item from public.items where id = p_item_id;
  if item.id is null then
    raise exception 'That title isn''t available.' using errcode = 'P0001';
  end if;
  return public._pull_list_put(c, item, p_quantity, 'manual', false);
end;
$$;

create or replace function public.pull_list_add_variants(p_item_id bigint, p_quantity int default 1)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  c       public.customers := public._pull_list_customer();
  base    public.items;
  item    public.items;
  v_added int := 0;
  v_skip  int := 0;
begin
  if c.phone is null or nullif(trim(c.phone), '') is null then
    raise exception 'Please add your phone number under My Pull List before adding titles.' using errcode = 'P0001';
  end if;
  select * into base from public.items where id = p_item_id;
  if base.id is null then
    raise exception 'That title isn''t available.' using errcode = 'P0001';
  end if;

  for item in
    select * from public.items i
    where lower(trim(i.title)) = lower(trim(base.title))
      and i.issue_number is not distinct from base.issue_number
      and i.publisher is not distinct from base.publisher
      and i.status = 'pre_order' and not i.hidden
      and (i.variant is null or i.variant !~* '(\m1:\d+|\mINCV?\M|\mRI\M|\mRATIO\M|\mINCENTIVE\M|\m\d+\s*COPY\M)')
    order by i.variant nulls first, i.id
  loop
    -- Covers that can't be added (already listed, closed, over the copy limit) are skipped, not errors.
    if public._pull_list_problem(c, item, p_quantity) is not null then
      v_skip := v_skip + 1;
    elsif public._pull_list_put(c, item, p_quantity, 'variant', true) is null then
      v_skip := v_skip + 1;
    else
      v_added := v_added + 1;
    end if;
  end loop;

  if v_added = 0 and v_skip = 0 then
    raise exception 'No other covers are open for that issue.' using errcode = 'P0001';
  end if;
  return jsonb_build_object('added', v_added, 'skipped', v_skip);
end;
$$;
