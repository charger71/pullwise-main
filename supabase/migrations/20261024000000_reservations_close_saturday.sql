-- Reservations close at midnight on the Saturday before a title's FOC (usually a Monday),
-- not the night before, so the shop has time to collect the reservations and place the order.
--
-- reservations_close_through() is the latest FOC date that is already closed today: this
-- Saturday (or today, if it is Saturday). A title with FOC Monday Oct 5 stays open through
-- Saturday Oct 3 and closes on Sunday, when this returns Oct 10. The site applies the same
-- rule in js/site.js (lastReserveDay / openFocFrom).

create or replace function public.reservations_close_through()
returns date
language sql stable security definer set search_path = public
as $$
  select public.shop_today() + ((6 - extract(dow from public.shop_today())::int) % 7);
$$;

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
  if v_phone is null and v_email is null then
    raise exception 'Please give a phone number or email.' using errcode = 'P0001';
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

-- Update the seeded page text that still describes the old rule. Only rows still holding
-- the original wording are touched, so anything staff have rewritten is left alone.
update public.pages set lede_html = replace(lede_html,
  'Reserve by the night before and we''ll order a copy just for you',
  'Reserve by midnight the Saturday before and we''ll order a copy just for you')
  where slug = 'home-preorders';
update public.pages set lede_html = replace(lede_html,
  'Reserve upcoming books by the night before the <strong>Final Order Cutoff (FOC)</strong> — the day we place our order with the distributor.',
  'Reserve upcoming books by <strong>midnight Saturday</strong> before the <strong>Final Order Cutoff (FOC)</strong> — usually the following Monday, when we place our order with the distributor.')
  where slug = 'pre-orders';
update public.pages set body_html = replace(body_html,
  'Reservations for a title close at midnight the night before its Final Order Cutoff (FOC) date.',
  'Reservations for a title close at midnight on the Saturday before its Final Order Cutoff (FOC) date, which is usually a Monday. That gives us time to collect the reservations and place the order.')
  where slug = 'terms';
update public.faqs set answer_html = replace(answer_html,
  'Reservations close at midnight the night before the distributor''s Final Order Cutoff (FOC); we place our order on FOC day.',
  'Reservations close at midnight on the Saturday before the distributor''s Final Order Cutoff (FOC), which is usually a Monday; we place our order on FOC day.')
  where question = 'How do pre-orders work?';
