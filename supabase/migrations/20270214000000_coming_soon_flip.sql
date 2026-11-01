-- Pre-orders become Coming Soon once their order cutoff passes (the Saturday before FOC, reservations_close_through),
-- and stay that way until their release week. See 20270213000000_coming_soon_status.sql.

-- Any write that leaves a pre-order past its cutoff (an import, catalog sync, a staff edit, a FOC date moved) gets the
-- right status at once; one whose FOC moves later opens again. The hourly job does the same as the days pass.
create or replace function public._items_coming_soon()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.status = 'pre_order' and new.foc_date is not null and new.foc_date <= public.reservations_close_through() then
    new.status := 'coming_soon';
  elsif new.status = 'coming_soon' and (new.foc_date is null or new.foc_date > public.reservations_close_through()) then
    new.status := 'pre_order';
  end if;
  return new;
end;
$$;
create trigger items_coming_soon before insert or update of status, foc_date on public.items
  for each row execute function public._items_coming_soon();

-- New Arrivals sorts Coming Soon last, as it did when they were pre-orders (20270206000000_arrival_rank_coming_soon.sql).
alter table public.items drop column arrival_rank;
alter table public.items
  add column arrival_rank smallint generated always as (
    case status
      when 'new_this_wednesday' then 0
      when 'just_arrived' then 1
      when 'backorder' then 3
      when 'sold_out' then 3
      when 'coming_soon' then 4
      when 'pre_order' then 4
      else 2
    end
  ) stored;
create index items_arrival_rank_idx on public.items (arrival_rank, title);

-- As in 20270212000000_reorders.sql, plus Coming Soon: pre-orders past their cutoff change to it, and Coming Soon
-- titles reach their release week the same way pre-orders do.
CREATE OR REPLACE FUNCTION public.flip_item_statuses()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_today     date := public.shop_today();
  v_start     date := public.shop_today() - extract(dow from public.shop_today())::int;  -- this week's Sunday
  v_close     date := public.reservations_close_through();
  v_arrived   int;
  v_settled   int;
  v_released  int;
  v_reserved  int;
  v_closed    int;
begin
  -- Last week's arrivals settle into Available.
  update public.items
  set status = 'available'
  where status in ('just_arrived', 'new_this_wednesday')
    and coalesce(release_date, arrived_on) < v_start;
  get diagnostics v_settled = row_count;

  -- Pre-orders and Coming Soon titles releasing this week are "New This Wednesday" until release day, then
  -- "Just Arrived"; ones that somehow missed their week go straight to Available.
  with arrived as (
    update public.items
    set status = case when release_date < v_start then 'available'::public.item_status
                      when release_date > v_today then 'new_this_wednesday'::public.item_status
                      else 'just_arrived'::public.item_status end,
        arrived_on = least(release_date, v_today)
    where status in ('pre_order', 'coming_soon') and release_date < v_start + 7
    returning id
  )
  select count(*) into v_arrived from arrived;

  -- Release day has come: the tag changes to Just Arrived.
  update public.items
  set status = 'just_arrived', arrived_on = release_date
  where status = 'new_this_wednesday' and release_date <= v_today;
  get diagnostics v_released = row_count;

  -- Pre-orders whose order cutoff has passed are Coming Soon.
  update public.items
  set status = 'coming_soon'
  where status = 'pre_order' and foc_date <= v_close;
  get diagnostics v_closed = row_count;

  -- Customers' reservations are ready as soon as the title is out (re-orders wait for their copies).
  update public.reservations r
  set status = 'arrived', arrived_on = i.release_date
  from public.items i
  where r.item_id = i.id and r.status in ('open', 'ordered') and not r.reorder
    and i.release_date <= v_today and i.status not in ('pre_order', 'coming_soon');
  get diagnostics v_reserved = row_count;

  if v_arrived + v_settled + v_released + v_reserved + v_closed > 0 then
    insert into public.job_log (job, ok, message)
    values ('status_flip', true, format('%s marked new this week, %s moved to Available, %s became Just Arrived, %s now Coming Soon, %s reservations ready',
                                        v_arrived, v_settled, v_released, v_closed, v_reserved));
  end if;
exception when others then
  insert into public.job_log (job, ok, message) values ('status_flip', false, sqlerrm);
end;
$function$;

-- Customers can order a copy of a Coming Soon trade or omnibus (past the cutoff is when most re-orders happen), as
-- well as a released one. As in 20270212000000_reorders.sql.
create or replace function public._reorderable(item public.items)
returns boolean
language sql stable security definer set search_path = public
as $$
  select item.id is not null and not item.hidden and item.status <> 'pre_order'
    and (item.status = 'coming_soon' or item.release_date is null or item.release_date <= public.shop_today())
    and exists (select 1 from public.categories k where k.id = item.category_id and k.slug in ('trades', 'omnibuses'));
$$;

-- Old unreleased titles (pre-orders and Coming Soon) hide sooner than old shelf titles. As in
-- 20261219000001_reordered_status_use.sql.
CREATE OR REPLACE FUNCTION public.staff_hide_old_titles(p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_today date := (now() at time zone (select timezone from public.settings where id = 1))::date;
  v_pre   int;
  v_store int;
begin
  if not public.is_staff() then
    raise exception 'Staff only.' using errcode = '42501';
  end if;

  create temp table _old_titles on commit drop as
    select i.id, (i.status in ('pre_order', 'coming_soon')) as is_pre
    from public.items i
    where not i.hidden
      and not i.staff_pick
      and not i.featured
      and i.release_date is not null
      and i.release_date < v_today - case when i.status in ('pre_order', 'coming_soon') then 90 else 180 end
      and not exists (
        select 1 from public.reservations r
        where r.item_id = i.id and r.status in ('open', 'ordered', 'reordered', 'arrived')
      );

  select count(*) filter (where is_pre), count(*) filter (where not is_pre) into v_pre, v_store from _old_titles;

  if not p_dry_run then
    update public.items set hidden = true where id in (select id from _old_titles);
  end if;
  drop table _old_titles;

  return jsonb_build_object('pre_orders', v_pre, 'in_store', v_store);
end;
$function$;

-- Staff can still add a title past its cutoff to a customer's list (counted as 'closed', so the screen can say the
-- order is already in). As in 20261102000000_staff_pull_list.sql, with Coming Soon titles too.
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
    where i.status in ('pre_order', 'coming_soon') and not i.hidden
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

-- Titles already past their cutoff.
update public.items set status = 'coming_soon' where status = 'pre_order' and foc_date <= public.reservations_close_through();
