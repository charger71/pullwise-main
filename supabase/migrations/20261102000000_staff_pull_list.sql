-- Pull list, phase 3: staff edit a customer's pull list from the admin.
--
-- Staff already have full row-level access to reservations, so changing a quantity or a
-- status is a direct update from the admin. What needs a function is adding titles:
-- the customer's standing order may not exist yet, and staff may add titles the customer
-- couldn't (past the order cutoff, over the per-title copy limit).

-- Who changed what, shown on the customer's page in the admin.
create table public.pull_list_log (
  id             bigint generated always as identity primary key,
  customer_id    bigint not null references public.customers (id) on delete cascade,
  reservation_id bigint references public.reservations (id) on delete set null,
  staff_user     uuid default auth.uid(),
  action         text not null,
  detail         text,
  created_at     timestamptz not null default now()
);
create index pull_list_log_customer_idx on public.pull_list_log (customer_id, created_at desc);
alter table public.pull_list_log enable row level security;
create policy "staff all pull_list_log" on public.pull_list_log for all using (public.is_staff()) with check (public.is_staff());
revoke all on public.pull_list_log from anon;

-- staff_save_customer(): same as before, but a customer needs a name and a way to reach them.
create or replace function public.staff_save_customer(p_id bigint, p jsonb)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_id bigint;
  v_name  text := nullif(trim(p ->> 'name'), '');
  v_email text := nullif(lower(trim(p ->> 'email')), '');
  v_phone text := nullif(trim(p ->> 'phone'), '');
begin
  if not public.is_staff() then
    raise exception 'Staff only.' using errcode = '42501';
  end if;
  if v_name is null then
    raise exception 'Please enter the customer''s name.' using errcode = 'P0001';
  end if;
  if v_email is null and v_phone is null then
    raise exception 'Please enter an email or a phone number.' using errcode = 'P0001';
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That email address doesn''t look right.' using errcode = 'P0001';
  end if;
  if p_id is null then
    insert into public.customers (name, email, phone, address1, city, state, zip, ship_arrivals, email_opt_in)
    values (
      v_name, v_email, v_phone,
      nullif(trim(p ->> 'address1'), ''), nullif(trim(p ->> 'city'), ''), nullif(trim(p ->> 'state'), ''), nullif(trim(p ->> 'zip'), ''),
      coalesce((p ->> 'ship_arrivals')::boolean, false), coalesce((p ->> 'email_opt_in')::boolean, true)
    ) returning id into v_id;
  else
    -- A customer with a login signs in by email, so staff can't change it from here.
    if exists (select 1 from public.customers where id = p_id and user_id is not null and lower(email) is distinct from v_email) then
      raise exception 'This customer has an account, so their email can''t be changed here.' using errcode = 'P0001';
    end if;
    update public.customers set
      name = v_name, email = v_email, phone = v_phone,
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

-- Adds one title, or every open non-incentive cover of the issue, to a customer's list.
-- Returns { added, skipped, closed } where `closed` counts added titles whose order cutoff
-- has already passed (staff may do this, but should know the distributor order may be in).
-- Titles the customer already has live are skipped.
create or replace function public.staff_pull_list_add(p_customer bigint, p_item_id bigint, p_quantity int default 1, p_all_covers boolean default false)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  c        public.customers;
  base     public.items;
  item     public.items;
  v_order  bigint;
  v_line   bigint;
  v_added  int := 0;
  v_skip   int := 0;
  v_closed int := 0;
begin
  if not public.is_staff() then
    raise exception 'Staff only.' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 100 then
    raise exception 'Quantity must be between 1 and 100.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = p_customer;
  if c.id is null then
    raise exception 'That customer no longer exists.' using errcode = 'P0001';
  end if;
  select * into base from public.items where id = p_item_id;
  if base.id is null then
    raise exception 'That title isn''t available.' using errcode = 'P0001';
  end if;

  for item in
    select * from public.items i
    where i.status = 'pre_order' and not i.hidden
      and case when p_all_covers then
            lower(trim(i.title)) = lower(trim(base.title))
            and i.issue_number is not distinct from base.issue_number
            and i.publisher is not distinct from base.publisher
            and (i.variant is null or i.id = base.id
                 or i.variant !~* '(\m1:\d+|\mINCV?\M|\mRI\M|\mRATIO\M|\mINCENTIVE\M|\m\d+\s*COPY\M)')
          else i.id = base.id end
    order by i.variant nulls first, i.id
  loop
    if exists (
      select 1 from public.reservations r join public.reservation_orders o on o.id = r.order_id
      where r.item_id = item.id and o.customer_id = c.id and r.status not in ('cancelled', 'released')
    ) then
      v_skip := v_skip + 1;
      continue;
    end if;

    v_order := public._pull_list_order(c);
    insert into public.reservations (order_id, item_id, quantity, source)
    values (v_order, item.id, p_quantity, 'staff')
    on conflict (order_id, item_id) do update
      set quantity = excluded.quantity, source = 'staff', status = 'open', arrived_on = null, created_at = now()
    returning id into v_line;
    delete from public.pull_list_exclusions where customer_id = c.id and item_id = item.id;

    insert into public.pull_list_log (customer_id, reservation_id, action, detail)
    values (c.id, v_line, 'added', item.title || coalesce(' #' || item.issue_number, '') || coalesce(' · ' || item.variant, '') || ' × ' || p_quantity);

    v_added := v_added + 1;
    if item.foc_date is not null and item.foc_date <= public.reservations_close_through() then
      v_closed := v_closed + 1;
    end if;
  end loop;

  if v_added = 0 and v_skip = 0 then
    raise exception 'That title isn''t open for pre-order.' using errcode = 'P0001';
  end if;
  return jsonb_build_object('added', v_added, 'skipped', v_skip, 'closed', v_closed);
end;
$$;

revoke execute on function public.staff_pull_list_add(bigint, bigint, int, boolean) from public, anon;
grant execute on function public.staff_pull_list_add(bigint, bigint, int, boolean) to authenticated;
