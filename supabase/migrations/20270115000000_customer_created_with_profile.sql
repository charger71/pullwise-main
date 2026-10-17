-- Customers with no name or phone kept appearing in Admin → Customers.
--
-- Cause: claim_customer() created the customers row (email only) the moment someone signed in, before the account page
-- asked for their name and phone. Anyone who signed in and left without finishing that form stayed behind as an
-- email-only customer.
--
-- Fix: a signed-in visitor gets a customers row only once it holds everything an order needs.
--  * claim_customer() no longer inserts a bare row. It still links a staff-created record with the same email, and
--    still creates the record straight away when the latest guest order already gives a first name, last name and
--    phone. Otherwise it returns an unsaved row (id null) holding whatever is known, to fill in the setup form.
--  * create_my_customer() saves the setup form: it creates (or links, or completes) the record with the name and phone.
--  * Pull-list and follow functions already refuse a login with no customers row; their message now says what to do.
-- Existing email-only records that nothing refers to are removed.

create or replace function public.claim_customer()
returns public.customers
language plpgsql security definer set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_row   public.customers;
  v_first text;
  v_last  text;
  v_phone text;
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
    -- No record yet: start from the latest guest order (a single name box, split at its last space).
    select nullif(trim((public._split_name(o.name)).first_name), ''), nullif(trim((public._split_name(o.name)).last_name), ''),
           nullif(trim(o.phone), '')
    into v_first, v_last, v_phone
    from public.reservation_orders o
    where lower(o.email) = v_email and o.kind <> 'pull_list'
    order by o.created_at desc limit 1;

    if v_first is null or v_last is null or v_phone is null then
      -- Not enough to place an order: nothing is saved until create_my_customer().
      v_row.email := v_email;
      v_row.first_name := v_first;
      v_row.last_name := v_last;
      v_row.phone := v_phone;
      return v_row;
    end if;

    insert into public.customers (user_id, email, first_name, last_name, phone)
    values (v_uid, v_email, left(v_first, 80), left(v_last, 80), left(v_phone, 40))
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

-- The account page's first-sign-in form: creates the signed-in customer's record with the details orders need.
-- Also fine to call when the record already exists (another tab got there first): it just saves the three fields.
create or replace function public.create_my_customer(p_first_name text, p_last_name text, p_phone text)
returns public.customers
language plpgsql security definer set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_first text := nullif(trim(p_first_name), '');
  v_last  text := nullif(trim(p_last_name), '');
  v_phone text := nullif(trim(p_phone), '');
  v_row   public.customers;
begin
  if v_uid is null then
    raise exception 'Please sign in.' using errcode = '42501';
  end if;
  select nullif(lower(trim(u.email)), '') into v_email
  from auth.users u
  where u.id = v_uid and u.email_confirmed_at is not null;
  if v_email is null then
    raise exception 'Please confirm your email address first.' using errcode = 'P0001';
  end if;

  if v_first is null then
    raise exception 'Please enter your first name.' using errcode = 'P0001';
  end if;
  if v_last is null then
    raise exception 'Please enter your last name.' using errcode = 'P0001';
  end if;
  if v_phone is null then
    raise exception 'Please enter your phone number.' using errcode = 'P0001';
  end if;
  if length(v_first) > 80 or length(v_last) > 80 then
    raise exception 'That name is too long.' using errcode = 'P0001';
  end if;
  if length(v_phone) > 40 then
    raise exception 'That phone number is too long.' using errcode = 'P0001';
  end if;

  update public.customers set first_name = v_first, last_name = v_last, phone = v_phone
  where user_id = v_uid
  returning * into v_row;

  if v_row.id is null then
    update public.customers set user_id = v_uid, first_name = v_first, last_name = v_last, phone = v_phone
    where lower(email) = v_email and user_id is null
    returning * into v_row;
  end if;

  if v_row.id is null then
    insert into public.customers (user_id, email, first_name, last_name, phone)
    values (v_uid, v_email, v_first, v_last, v_phone)
    returning * into v_row;
  end if;

  update public.reservation_orders set customer_id = v_row.id
  where customer_id is null and lower(email) = v_email;

  return v_row;
end;
$$;
revoke execute on function public.create_my_customer(text, text, text) from public, anon;
grant execute on function public.create_my_customer(text, text, text) to authenticated;

-- Signed in but the setup form not finished yet: say where to finish it. (Redefined in full rather than patched, so it
-- doesn't depend on the exact wording already in the database.)
create or replace function public._pull_list_customer()
returns public.customers
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.customers;
begin
  if auth.uid() is null then
    raise exception 'Please sign in.' using errcode = 'P0001';
  end if;
  select * into v_row from public.customers where user_id = auth.uid();
  if v_row.id is null then
    raise exception 'Please finish setting up your account under My Pull List. We need your first name, last name and phone before you can add titles or follow anything.' using errcode = 'P0001';
  end if;
  return v_row;
end;
$$;

-- Repair: remove the email-only records left by sign-ins that never finished the form. Only records with a login, no name,
-- no phone and nothing else attached (orders, follows, pull-list history, notes, messages, sent emails) go; the login itself is untouched,
-- and finishing the form later creates the record again.
delete from public.customers c
where c.user_id is not null
  and nullif(trim(c.first_name), '') is null
  and nullif(trim(c.last_name), '') is null
  and nullif(trim(c.phone), '') is null
  and not exists (select 1 from public.reservation_orders o where o.customer_id = c.id)
  and not exists (select 1 from public.subscriptions s where s.customer_id = c.id)
  and not exists (select 1 from public.pull_list_exclusions x where x.customer_id = c.id)
  and not exists (select 1 from public.pull_list_log l where l.customer_id = c.id)
  and not exists (select 1 from public.customer_notes n where n.customer_id = c.id)
  and not exists (select 1 from public.customer_messages m where m.customer_id = c.id)
  and not exists (select 1 from public.email_log e where e.customer_id = c.id);
