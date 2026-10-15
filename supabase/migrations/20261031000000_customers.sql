-- Pull list, phase 1: customer accounts.
--
-- Customers sign in with Supabase Auth (email magic link / code), the same auth
-- system staff use. Being signed in NEVER means being staff: staff access is
-- decided only by public.is_staff() (membership of the `staff` table), and every
-- customer policy below is limited to the customer's own rows.
--
-- `customers` also holds records staff create for walk-in / phone customers who
-- have no login (user_id is null). When such a customer later signs in with the
-- same email, claim_customer() attaches the login to the existing record.

create table public.customers (
  id            bigint generated always as identity primary key,
  user_id       uuid unique references auth.users (id) on delete set null,
  name          text check (length(name) <= 120),
  email         text check (length(email) <= 254),
  phone         text check (length(phone) <= 40),
  phone_digits  text generated always as (nullif(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), '')) stored,
  -- For customers who pay by phone and have their books shipped
  address1      text check (length(address1) <= 200),
  city          text check (length(city) <= 100),
  state         text check (length(state) <= 50),
  zip           text check (length(zip) <= 20),
  ship_arrivals boolean not null default false,
  -- Weekly pull-list email: on unless the customer turns it off in their profile
  email_opt_in  boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index customers_email_key on public.customers (lower(email)) where email is not null;
create index customers_phone_idx on public.customers (phone_digits);

-- Orders placed by (or later linked to) a customer.
alter table public.reservation_orders
  add column customer_id bigint references public.customers (id) on delete set null;
create index reservation_orders_customer_idx on public.reservation_orders (customer_id);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.customers enable row level security;

create policy "staff all customers" on public.customers for all using (public.is_staff()) with check (public.is_staff());
create policy "own customer read"   on public.customers for select using (user_id = auth.uid());
create policy "own customer update" on public.customers for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Customers can read but never create or delete their record directly (claim_customer()
-- creates it), and can only change profile fields — not email, user_id or ship_arrivals.
-- Staff use the same `authenticated` role, so their writes are granted through the same columns
-- plus the privileges below.
revoke all on public.customers from anon;
revoke insert, update, delete on public.customers from authenticated;
grant select on public.customers to authenticated;
grant update (name, phone, address1, city, state, zip, email_opt_in) on public.customers to authenticated;

create or replace function public.customers_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger customers_touch before update on public.customers
  for each row execute function public.customers_touch();

-- Staff must still be able to create customers and change email/ship_arrivals. Column grants
-- apply to the role, not the policy, so staff writes go through this function instead.
create or replace function public.staff_save_customer(p_id bigint, p jsonb)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_id bigint;
begin
  if not public.is_staff() then
    raise exception 'Staff only.' using errcode = '42501';
  end if;
  if p_id is null then
    insert into public.customers (name, email, phone, address1, city, state, zip, ship_arrivals, email_opt_in)
    values (
      nullif(trim(p ->> 'name'), ''), nullif(lower(trim(p ->> 'email')), ''), nullif(trim(p ->> 'phone'), ''),
      nullif(trim(p ->> 'address1'), ''), nullif(trim(p ->> 'city'), ''), nullif(trim(p ->> 'state'), ''), nullif(trim(p ->> 'zip'), ''),
      coalesce((p ->> 'ship_arrivals')::boolean, false), coalesce((p ->> 'email_opt_in')::boolean, true)
    ) returning id into v_id;
  else
    update public.customers set
      name = nullif(trim(p ->> 'name'), ''), email = nullif(lower(trim(p ->> 'email')), ''), phone = nullif(trim(p ->> 'phone'), ''),
      address1 = nullif(trim(p ->> 'address1'), ''), city = nullif(trim(p ->> 'city'), ''), state = nullif(trim(p ->> 'state'), ''),
      zip = nullif(trim(p ->> 'zip'), ''), ship_arrivals = coalesce((p ->> 'ship_arrivals')::boolean, ship_arrivals),
      email_opt_in = coalesce((p ->> 'email_opt_in')::boolean, email_opt_in)
    where id = p_id returning id into v_id;
  end if;
  return v_id;
end;
$$;
revoke execute on function public.staff_save_customer(bigint, jsonb) from public, anon;
grant execute on function public.staff_save_customer(bigint, jsonb) to authenticated;

-- Customers read their own reservations (writes still go through functions).
create policy "own orders read" on public.reservation_orders for select
  using (customer_id in (select id from public.customers where user_id = auth.uid()));
create policy "own reservations read" on public.reservations for select
  using (order_id in (
    select o.id from public.reservation_orders o
    join public.customers c on c.id = o.customer_id
    where c.user_id = auth.uid()
  ));

-- ---------------------------------------------------------------------------
-- claim_customer(): called by the site right after a customer signs in.
-- Idempotent. Uses the email Supabase Auth has verified (the magic link proves
-- the customer controls it), so it is safe to:
--   1. return the customer already linked to this login, else
--   2. attach this login to a staff-created record with the same email, else
--   3. create a new record,
-- and then attach earlier guest reservation orders placed with that email.
-- Phone-only matches are never linked automatically: a phone number isn't verified.
-- ---------------------------------------------------------------------------
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

  -- Fill in name/phone from the most recent guest order when the profile is still empty.
  if v_row.name is null or v_row.phone is null then
    update public.customers c set
      name  = coalesce(c.name,  o.name),
      phone = coalesce(c.phone, o.phone)
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
revoke execute on function public.claim_customer() from public, anon;
grant execute on function public.claim_customer() to authenticated;
