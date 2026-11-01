-- Re-orders: titles ordered from the distributor after their order cutoff. Trades and omnibuses stay in print, so the
-- shop can order them any time after release.
--  * Staff re-order any title (Ordering → Re-order), for the shelf (stock_reorders) or for a customer (a reservation
--    line with reorder = true on an order of kind 'reorder', one per re-order, so a title picked up before keeps
--    its history).
--  * Signed-in customers order a copy of a released trade or omnibus themselves (pull_list_reorder).
-- Re-order lines are never on Place Order or Past Orders (those go by cutoff): the Re-order tab totals them, exports
-- them and marks them ordered. They don't turn Ready on release day either (the title is already out); staff mark
-- them Ready on Received when the copies come in.

alter table public.reservations add column reorder boolean not null default false;
comment on column public.reservations.reorder is 'Ordered after the cutoff (a re-order): listed on the Re-order tab, not Place Order.';
create index reservations_reorder_idx on public.reservations (status) where reorder;

alter table public.reservation_orders drop constraint reservation_orders_kind_check;
alter table public.reservation_orders add constraint reservation_orders_kind_check check (kind in ('order', 'pull_list', 'reorder'));

-- Copies re-ordered for the shelf (no customer): open → ordered → received, or cancelled.
create table public.stock_reorders (
  id          bigint generated always as identity primary key,
  item_id     bigint not null references public.items (id) on delete restrict,
  location_id bigint references public.locations (id) on delete restrict default public.default_location_id(),
  quantity    smallint not null check (quantity between 1 and 100),
  status      text not null default 'open' check (status in ('open', 'ordered', 'received', 'cancelled')),
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  ordered_at  timestamptz,
  received_at timestamptz
);
create index stock_reorders_item_idx on public.stock_reorders (item_id);
create index stock_reorders_status_idx on public.stock_reorders (status);
alter table public.stock_reorders enable row level security;
create policy "staff all stock reorders" on public.stock_reorders for all using (public.is_staff()) with check (public.is_staff());
grant select, insert, update on public.stock_reorders to authenticated;

-- Whether customers can order a copy themselves: a trade or omnibus that is out (and not hidden). Backlist titles
-- often have no release date; not being a pre-order is enough for them.
create or replace function public._reorderable(item public.items)
returns boolean
language sql stable security definer set search_path = public
as $$
  select item.id is not null and not item.hidden and item.status <> 'pre_order'
    and (item.release_date is null or item.release_date <= public.shop_today())
    and exists (select 1 from public.categories k where k.id = item.category_id and k.slug in ('trades', 'omnibuses'));
$$;
revoke execute on function public._reorderable(public.items) from public, anon, authenticated;

-- Copies the customer already has waiting for a title (any order), and the per-title limit.
create or replace function public._reorder_problem(c public.customers, item public.items, qty int, skip_line bigint default null)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  v_title    text := item.title || coalesce(' #' || item.issue_number, '') || coalesce(' (' || item.variant || ')', '');
  v_max      int;
  v_existing int;
begin
  if qty is null or qty < 1 then
    return 'Quantity for ' || v_title || ' must be at least 1.';
  end if;
  select coalesce(max_copies_per_title, 10) into v_max from public.settings where id = 1;
  select coalesce(sum(r.quantity), 0) into v_existing
  from public.reservations r join public.reservation_orders o on o.id = r.order_id
  where r.item_id = item.id and o.customer_id = c.id
    and r.status in ('open', 'ordered', 'reordered', 'arrived')
    and r.id is distinct from skip_line;
  if v_existing + qty > v_max then
    return 'Limit is ' || v_max || ' copies per customer for ' || v_title
      || case when v_existing > 0 then ' (you already have ' || v_existing || ' on your list).' else '.' end;
  end if;
  return null;
end;
$$;
revoke execute on function public._reorder_problem(public.customers, public.items, int, bigint) from public, anon, authenticated;

-- A re-order line for a customer: its own order, so earlier lines for the same title (picked up, cancelled) stay.
create or replace function public._reorder_put(c public.customers, item public.items, qty int, src text)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_order bigint;
  v_id    bigint;
  v_msg   text := public._reorder_problem(c, item, qty);
begin
  if v_msg is not null then
    raise exception '%', v_msg using errcode = 'P0001';
  end if;
  insert into public.reservation_orders (name, phone, email, customer_id, kind)
  values (coalesce(nullif(trim(c.name), ''), left(c.email, 120), 'Pull list customer'), c.phone, c.email, c.id, 'reorder')
  returning id into v_order;
  insert into public.reservations (order_id, item_id, quantity, source, reorder)
  values (v_order, item.id, qty, src, true)
  returning id into v_id;
  insert into public.pull_list_log (customer_id, reservation_id, action, detail)
  values (c.id, v_id, 'added', 'Re-order: ' || item.title || coalesce(' #' || item.issue_number, '') || coalesce(' · ' || item.variant, '') || ' × ' || qty);
  return v_id;
end;
$$;
revoke execute on function public._reorder_put(public.customers, public.items, int, text) from public, anon, authenticated;

-- The customer orders a copy of a released trade or omnibus (title details on the site and in the app).
create or replace function public.pull_list_reorder(p_item_id bigint, p_quantity int default 1)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  c    public.customers := public._pull_list_customer();
  item public.items;
begin
  if c.phone is null or nullif(trim(c.phone), '') is null then
    raise exception 'Please add your phone number under My Pull List before ordering titles.' using errcode = 'P0001';
  end if;
  select * into item from public.items where id = p_item_id;
  if not coalesce(public._reorderable(item), false) then
    raise exception 'That title can''t be ordered online. Please call the shop.' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.reservations r join public.reservation_orders o on o.id = r.order_id
    where r.item_id = item.id and o.customer_id = c.id and r.status in ('open', 'ordered', 'reordered', 'arrived')
  ) then
    raise exception '% is already on your list.', item.title || coalesce(' #' || item.issue_number, '') using errcode = 'P0001';
  end if;
  return public._reorder_put(c, item, p_quantity, 'manual');
end;
$$;
revoke execute on function public.pull_list_reorder(bigint, int) from public, anon;
grant execute on function public.pull_list_reorder(bigint, int) to authenticated;

-- Staff re-order any title: for a customer (p_customer) or, without one, for the shelf at p_location
-- (the default location when null). Returns the new line's or shelf re-order's id.
create or replace function public.staff_reorder(p_item_id bigint, p_quantity int, p_customer bigint default null, p_location bigint default null)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  c    public.customers;
  item public.items;
  v_id bigint;
begin
  if not public.is_staff() then
    raise exception 'Staff only.' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 100 then
    raise exception 'Quantity must be between 1 and 100.' using errcode = 'P0001';
  end if;
  select * into item from public.items where id = p_item_id;
  if item.id is null then
    raise exception 'That title no longer exists.' using errcode = 'P0001';
  end if;
  if p_customer is null then
    insert into public.stock_reorders (item_id, quantity, location_id)
    values (item.id, p_quantity, coalesce(p_location, public.default_location_id()))
    returning id into v_id;
    return v_id;
  end if;
  select * into c from public.customers where id = p_customer;
  if c.id is null then
    raise exception 'That customer no longer exists.' using errcode = 'P0001';
  end if;
  return public._reorder_put(c, item, p_quantity, 'staff');
end;
$$;
revoke execute on function public.staff_reorder(bigint, int, bigint, bigint) from public, anon;
grant execute on function public.staff_reorder(bigint, int, bigint, bigint) to authenticated;

-- A customer can change or remove a re-order until the shop has ordered it (its cutoff has long passed).
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
  if r.status <> 'open' or (not r.reorder and item.foc_date is not null and item.foc_date <= public.reservations_close_through()) then
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
  v_msg := case when r.reorder then public._reorder_problem(c, item, p_quantity, r.id)
                else public._pull_list_problem(c, item, p_quantity, r.id) end;
  if v_msg is not null then
    raise exception '%', v_msg using errcode = 'P0001';
  end if;
  update public.reservations set quantity = p_quantity where id = r.id;
end;
$$;

-- As in 20261219000001_reordered_status_use.sql, except re-order lines: their title is already out, so they wait for
-- the copies (staff mark them Ready on Received).
CREATE OR REPLACE FUNCTION public.flip_item_statuses()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_today     date := public.shop_today();
  v_start     date := public.shop_today() - extract(dow from public.shop_today())::int;  -- this week's Sunday
  v_arrived   int;
  v_settled   int;
  v_released  int;
  v_reserved  int;
begin
  -- Last week's arrivals settle into Available.
  update public.items
  set status = 'available'
  where status in ('just_arrived', 'new_this_wednesday')
    and coalesce(release_date, arrived_on) < v_start;
  get diagnostics v_settled = row_count;

  -- Pre-orders releasing this week are "New This Wednesday" until release day, then "Just Arrived";
  -- ones that somehow missed their week go straight to Available.
  with arrived as (
    update public.items
    set status = case when release_date < v_start then 'available'::public.item_status
                      when release_date > v_today then 'new_this_wednesday'::public.item_status
                      else 'just_arrived'::public.item_status end,
        arrived_on = least(release_date, v_today)
    where status = 'pre_order' and release_date < v_start + 7
    returning id
  )
  select count(*) into v_arrived from arrived;

  -- Release day has come: the tag changes to Just Arrived.
  update public.items
  set status = 'just_arrived', arrived_on = release_date
  where status = 'new_this_wednesday' and release_date <= v_today;
  get diagnostics v_released = row_count;

  -- Customers' reservations are ready as soon as the title is out (re-orders wait for their copies).
  update public.reservations r
  set status = 'arrived', arrived_on = i.release_date
  from public.items i
  where r.item_id = i.id and r.status in ('open', 'ordered') and not r.reorder
    and i.release_date <= v_today and i.status <> 'pre_order';
  get diagnostics v_reserved = row_count;

  if v_arrived + v_settled + v_released + v_reserved > 0 then
    insert into public.job_log (job, ok, message)
    values ('status_flip', true, format('%s marked new this week, %s moved to Available, %s became Just Arrived, %s reservations ready',
                                        v_arrived, v_settled, v_released, v_reserved));
  end if;
exception when others then
  insert into public.job_log (job, ok, message) values ('status_flip', false, sqlerrm);
end;
$function$;
