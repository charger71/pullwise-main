-- Pull list, phase 2: a signed-in customer manages a standing list.
--
-- The pull list IS the reservation system: each customer gets one standing
-- reservation_orders row (kind = 'pull_list') and every title on their list is a
-- normal `reservations` line, so "To order", statuses, hold days and CSV export in the
-- admin all keep working. Customers never write those tables directly; they call the
-- functions below, which apply the same rules as create_reservation_order().

alter table public.reservation_orders
  add column kind text not null default 'order' check (kind in ('order', 'pull_list'));
create unique index reservation_orders_pull_list_key on public.reservation_orders (customer_id) where kind = 'pull_list';

-- Why a line is on the list. Later phases add lines automatically (series / artist) and
-- from staff; 'variant' marks lines added by "add all covers".
alter table public.reservations
  add column source text not null default 'manual' check (source in ('manual', 'variant', 'series', 'artist', 'staff'));

-- Titles a customer removed that a subscription would otherwise add back (phase 4 reads this).
create table public.pull_list_exclusions (
  customer_id bigint not null references public.customers (id) on delete cascade,
  item_id     bigint not null references public.items (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (customer_id, item_id)
);
alter table public.pull_list_exclusions enable row level security;
create policy "staff all pull_list_exclusions" on public.pull_list_exclusions for all using (public.is_staff()) with check (public.is_staff());
revoke all on public.pull_list_exclusions from anon;

-- ---------------------------------------------------------------------------
-- Helpers (not callable from the browser)
-- ---------------------------------------------------------------------------

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
    raise exception 'Please open My Pull List once to finish setting up your account.' using errcode = 'P0001';
  end if;
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
    values (coalesce(nullif(trim(c.name), ''), 'Pull list customer'), c.phone, c.email, c.id, 'pull_list')
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- Why `item` can't go on `c`'s list at quantity `qty` right now, or null if it can.
-- `skip_line` is a reservation being edited, so it isn't counted against the copy limit.
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
    return 'Reservations for ' || v_title || ' have closed.';
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
      || case when v_existing > 0 then ' (you already have ' || v_existing || ' reserved).' else '.' end;
  end if;
  return null;
end;
$$;

-- Adds one title (or reactivates a cancelled line). Returns the reservation id, or null if the
-- customer already has the title on a live line and `quiet` is true.
create or replace function public._pull_list_put(c public.customers, item public.items, qty int, src text, quiet boolean)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_order bigint;
  v_id    bigint;
  v_msg   text;
begin
  if exists (
    select 1 from public.reservations r join public.reservation_orders o on o.id = r.order_id
    where r.item_id = item.id and o.customer_id = c.id and r.status not in ('cancelled', 'released')
  ) then
    if quiet then return null; end if;
    raise exception '% is already on your list.', item.title || coalesce(' #' || item.issue_number, '') using errcode = 'P0001';
  end if;

  v_msg := public._pull_list_problem(c, item, qty);
  if v_msg is not null then
    raise exception '%', v_msg using errcode = 'P0001';
  end if;

  v_order := public._pull_list_order(c);
  insert into public.reservations (order_id, item_id, quantity, source)
  values (v_order, item.id, qty, src)
  on conflict (order_id, item_id) do update
    set quantity = excluded.quantity, source = excluded.source, status = 'open', arrived_on = null, created_at = now()
  returning id into v_id;

  delete from public.pull_list_exclusions where customer_id = c.id and item_id = item.id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Customer API
-- ---------------------------------------------------------------------------

create or replace function public.pull_list_add(p_item_id bigint, p_quantity int default 1)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  c    public.customers := public._pull_list_customer();
  item public.items;
begin
  select * into item from public.items where id = p_item_id;
  if item.id is null then
    raise exception 'That title isn''t available.' using errcode = 'P0001';
  end if;
  return public._pull_list_put(c, item, p_quantity, 'manual', false);
end;
$$;

-- Every open, non-incentive cover of the same issue (same title, issue number and publisher).
-- The importer already leaves out ratio/incentive covers; the pattern below also catches
-- "5 COPY VARIANT"-style covers that slip through, so they are never added in bulk.
-- Returns { added, skipped } so the page can say what happened.
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

-- Customers can change a line only while it is still open and before the order cutoff.
create or replace function public._pull_list_editable(c public.customers, p_line bigint)
returns public.reservations
language plpgsql security definer set search_path = public
as $$
declare
  r    public.reservations;
  item public.items;
begin
  select r2.* into r
  from public.reservations r2 join public.reservation_orders o on o.id = r2.order_id
  where r2.id = p_line and o.customer_id = c.id;
  if r.id is null then
    raise exception 'That title isn''t on your list.' using errcode = 'P0001';
  end if;
  select * into item from public.items where id = r.item_id;
  if r.status <> 'open' or (item.foc_date is not null and item.foc_date <= public.reservations_close_through()) then
    raise exception 'The order for % is already in. Please call the shop to change it.', item.title || coalesce(' #' || item.issue_number, '') using errcode = 'P0001';
  end if;
  return r;
end;
$$;

create or replace function public.pull_list_set_quantity(p_line bigint, p_quantity int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  c    public.customers := public._pull_list_customer();
  r    public.reservations := public._pull_list_editable(c, p_line);
  item public.items;
  v_msg text;
begin
  select * into item from public.items where id = r.item_id;
  v_msg := public._pull_list_problem(c, item, p_quantity, r.id);
  if v_msg is not null then
    raise exception '%', v_msg using errcode = 'P0001';
  end if;
  update public.reservations set quantity = p_quantity where id = r.id;
end;
$$;

-- Removing marks the line cancelled (so staff keep the history) and, for lines a subscription
-- added, remembers the removal so it isn't added back.
create or replace function public.pull_list_remove(p_line bigint)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  c public.customers := public._pull_list_customer();
  r public.reservations := public._pull_list_editable(c, p_line);
begin
  update public.reservations set status = 'cancelled' where id = r.id;
  if r.source in ('series', 'artist') then
    insert into public.pull_list_exclusions (customer_id, item_id) values (c.id, r.item_id) on conflict do nothing;
  end if;
end;
$$;

revoke execute on function
  public._pull_list_customer(), public._pull_list_order(public.customers),
  public._pull_list_problem(public.customers, public.items, int, bigint),
  public._pull_list_put(public.customers, public.items, int, text, boolean),
  public._pull_list_editable(public.customers, bigint)
from public, anon, authenticated;

revoke execute on function
  public.pull_list_add(bigint, int), public.pull_list_add_variants(bigint, int),
  public.pull_list_set_quantity(bigint, int), public.pull_list_remove(bigint)
from public, anon;
grant execute on function
  public.pull_list_add(bigint, int), public.pull_list_add_variants(bigint, int),
  public.pull_list_set_quantity(bigint, int), public.pull_list_remove(bigint)
to authenticated;
