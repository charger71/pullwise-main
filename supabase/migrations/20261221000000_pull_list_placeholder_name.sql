-- "Pull list customer" was showing up as a customer's real name.
--
-- Cause: when a customer with no name yet added a title, _pull_list_order() wrote the placeholder
-- "Pull list customer" as the order's name. The next time claim_customer() ran it saw no first name, copied the name of the
-- customer's most recent order, and that placeholder became their first name "Pull list" and last name "customer".
--
-- Fix: claim_customer() only learns a name from guest orders (a pull-list order only ever holds a copy of the customer's own
-- details), and a pull-list order for a customer with no name is named after their email instead of the placeholder.
-- Existing damage is repaired below.

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
      where lower(email) = v_email and kind <> 'pull_list' order by created_at desc limit 1
    ) o
    where c.id = v_row.id;
    select * into v_row from public.customers where id = v_row.id;
  end if;

  update public.reservation_orders set customer_id = v_row.id
  where customer_id is null and lower(email) = v_email;

  return v_row;
end;
$$;

create or replace function public._pull_list_order(c public.customers)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_id bigint;
begin
  select id into v_id from public.reservation_orders where customer_id = c.id and kind = 'pull_list';
  if v_id is null then
    insert into public.reservation_orders (name, phone, email, customer_id, kind)
    values (coalesce(nullif(trim(c.name), ''), left(c.email, 120), 'Pull list customer'), c.phone, c.email, c.id, 'pull_list')
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- Repair: clear the placeholder name, then give those customers the name from their latest guest order if they have one.
-- (Two statements: one statement can't update the same row twice.)
create temp table _placeholder_customers as
  select id, email from public.customers where first_name = 'Pull list' and last_name = 'customer';

update public.customers set first_name = null, last_name = null
where id in (select id from _placeholder_customers);

update public.customers c set
  first_name = (public._split_name(o.name)).first_name,
  last_name  = (public._split_name(o.name)).last_name
from _placeholder_customers p
join lateral (
  select name from public.reservation_orders
  where lower(email) = lower(p.email) and kind <> 'pull_list' and name <> 'Pull list customer'
  order by created_at desc limit 1
) o on true
where c.id = p.id;

drop table _placeholder_customers;

-- Repair: pull-list orders still carrying the placeholder take the customer's name, or their email when they have none.
update public.reservation_orders o set name = left(coalesce(nullif(trim(c.name), ''), c.email, o.name), 120)
from public.customers c
where o.customer_id = c.id and o.kind = 'pull_list' and o.name = 'Pull list customer';
