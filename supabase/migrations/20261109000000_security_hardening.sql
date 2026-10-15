-- Security review hardening for the customer-account / pull-list features.
--
-- 1. claim_customer(): only a CONFIRMED email may claim a customer record or link guest orders.
--    Today the project has email confirmation switched on, so a sign-up with someone else's address
--    never gets a session. This makes the database enforce it too, so the protection doesn't depend on
--    that dashboard setting staying on.
-- 2. item_creators: creator names are visible only for titles the visitor can see (hidden titles stay hidden).
-- 3. A pull list holds at most 300 active titles per customer, so one account can't flood the order list.
--    (Staff adding titles for a customer are not limited. Wording of the cutoff message now says "order cutoff".)
-- 4. Least privilege: the public role only needs to read; signed-in users never need TRUNCATE / REFERENCES /
--    TRIGGER. Row-level security already blocked the writes, this removes the permission as well.

-- 1 ---------------------------------------------------------------------------
create or replace function public.claim_customer()
returns public.customers
language plpgsql security definer set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_row   public.customers;
begin
  if v_uid is null then
    raise exception 'Please sign in.' using errcode = '42501';
  end if;

  -- The email on the login itself, and only once it has been confirmed.
  select nullif(lower(trim(u.email)), '') into v_email
  from auth.users u
  where u.id = v_uid and u.email_confirmed_at is not null;
  if v_email is null then
    raise exception 'Please confirm your email address first.' using errcode = 'P0001';
  end if;

  select * into v_row from public.customers where user_id = v_uid;

  if v_row.id is null then
    update public.customers set user_id = v_uid
    where lower(email) = v_email and user_id is null
    returning * into v_row;
  end if;

  if v_row.id is null then
    insert into public.customers (user_id, email) values (v_uid, v_email)
    returning * into v_row;
  end if;

  if v_row.first_name is null or v_row.phone is null then
    update public.customers c set
      first_name = coalesce(c.first_name, (public._split_name(o.name)).first_name),
      last_name  = case when c.first_name is null then (public._split_name(o.name)).last_name else c.last_name end,
      phone      = coalesce(c.phone, o.phone)
    from (
      select name, phone from public.reservation_orders
      where lower(email) = v_email order by created_at desc limit 1
    ) o
    where c.id = v_row.id;
    select * into v_row from public.customers where id = v_row.id;
  end if;

  update public.reservation_orders set customer_id = v_row.id
  where customer_id is null and lower(email) = v_email;

  return v_row;
end;
$$;

-- 2 ---------------------------------------------------------------------------
drop policy "public read item_creators" on public.item_creators;
-- items' own row-level security hides hidden titles from the public, so this follows it.
create policy "public read item_creators" on public.item_creators for select
  using (exists (select 1 from public.items i where i.id = item_creators.item_id));

-- 3 ---------------------------------------------------------------------------
create or replace function public._pull_list_problem(c public.customers, item public.items, qty int, skip_line bigint default null)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  v_title    text := item.title || coalesce(' #' || item.issue_number, '') || coalesce(' (' || item.variant || ')', '');
  v_max      int;
  v_existing int;
begin
  if item.id is null or item.status <> 'pre_order' or item.hidden then
    return v_title || ' is no longer open for pre-order.';
  end if;
  if item.foc_date is not null and item.foc_date <= public.reservations_close_through() then
    return 'The order cutoff for ' || v_title || ' has passed.';
  end if;
  if qty is null or qty < 1 then
    return 'Quantity for ' || v_title || ' must be at least 1.';
  end if;
  select coalesce(max_copies_per_title, 10) into v_max from public.settings where id = 1;
  select coalesce(sum(r.quantity), 0) into v_existing
  from public.reservations r
  join public.reservation_orders o on o.id = r.order_id
  where r.item_id = item.id
    and r.status not in ('cancelled', 'released')
    and r.id is distinct from skip_line
    and (o.customer_id = c.id
      or (c.phone_digits is not null and o.phone_digits = c.phone_digits)
      or (c.email is not null and lower(o.email) = lower(c.email)));
  if v_existing + qty > v_max then
    return 'Limit is ' || v_max || ' copies per customer for ' || v_title
      || case when v_existing > 0 then ' (you already have ' || v_existing || ' on your list).' else '.' end;
  end if;
  -- Size cap (editing an existing line doesn't add one, so it is exempt).
  if skip_line is null and (
    select count(*) from public.reservations r join public.reservation_orders o on o.id = r.order_id
    where o.customer_id = c.id and r.status in ('open', 'ordered', 'arrived')
  ) >= 300 then
    return 'Your pull list is full (300 titles). Please call the shop.';
  end if;
  return null;
end;
$$;

-- 4 ---------------------------------------------------------------------------
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;
