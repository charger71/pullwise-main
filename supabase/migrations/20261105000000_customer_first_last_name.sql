-- Customers get a first and last name. `name` stays, but is now the two joined
-- ("Jane Smith"), so the Reservations page, search and exports keep working unchanged.
-- Guest reservations keep their single "Your name" box; it is split at the last space only
-- when a customer account picks it up.

alter table public.customers add column first_name text check (length(first_name) <= 80);
alter table public.customers add column last_name  text check (length(last_name) <= 80);

-- Existing names: everything before the last space is the first name.
update public.customers set
  first_name = case when trim(name) ~ '\s' then regexp_replace(trim(name), '\s+\S+$', '') else nullif(trim(name), '') end,
  last_name  = case when trim(name) ~ '\s' then substring(trim(name) from '\S+$') end;

alter table public.customers drop column name;
alter table public.customers add column name text
  generated always as (nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '')) stored;
create index customers_last_name_idx on public.customers (lower(last_name), lower(first_name));

-- Dropping the column dropped its grant.
grant update (first_name, last_name) on public.customers to authenticated;

-- Split a single typed name at its last space.
create or replace function public._split_name(p_name text, out first_name text, out last_name text)
language sql immutable
as $$
  select case when trim(p_name) ~ '\s' then regexp_replace(trim(p_name), '\s+\S+$', '') else nullif(trim(p_name), '') end,
         case when trim(p_name) ~ '\s' then substring(trim(p_name) from '\S+$') end;
$$;
revoke execute on function public._split_name(text) from public, anon, authenticated;

-- claim_customer(): as before, but fills first/last name (and phone) from the latest guest order.
create or replace function public.claim_customer()
returns public.customers
language plpgsql security definer set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text := nullif(lower(trim(auth.jwt() ->> 'email')), '');
  v_row   public.customers;
begin
  if v_uid is null then
    raise exception 'Please sign in.' using errcode = '42501';
  end if;
  if v_email is null then
    raise exception 'This login has no email address.' using errcode = 'P0001';
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

-- staff_save_customer(): payload now carries first_name / last_name. A first name and a way to
-- reach the customer are required; the last name is optional.
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
    insert into public.customers (first_name, last_name, email, phone, address1, city, state, zip, ship_arrivals, email_opt_in)
    values (
      v_first, v_last, v_email, v_phone,
      nullif(trim(p ->> 'address1'), ''), nullif(trim(p ->> 'city'), ''), nullif(trim(p ->> 'state'), ''), nullif(trim(p ->> 'zip'), ''),
      coalesce((p ->> 'ship_arrivals')::boolean, false), coalesce((p ->> 'email_opt_in')::boolean, true)
    ) returning id into v_id;
  else
    -- A customer with a login signs in by email, so staff can't change it from here.
    if exists (select 1 from public.customers where id = p_id and user_id is not null and lower(email) is distinct from v_email) then
      raise exception 'This customer has an account, so their email can''t be changed here.' using errcode = 'P0001';
    end if;
    update public.customers set
      first_name = v_first, last_name = v_last, email = v_email, phone = v_phone,
      address1 = nullif(trim(p ->> 'address1'), ''), city = nullif(trim(p ->> 'city'), ''), state = nullif(trim(p ->> 'state'), ''),
      zip = nullif(trim(p ->> 'zip'), ''), ship_arrivals = coalesce((p ->> 'ship_arrivals')::boolean, ship_arrivals),
      email_opt_in = coalesce((p ->> 'email_opt_in')::boolean, email_opt_in)
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
