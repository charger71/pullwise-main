-- Shop ordering, part 2: helps for the store's copies on Store Order.
--
--  * series_shop_qty: a standing number of store copies for a series ("every issue"), per location. It is kept per
--    variant label, like last issue's number, so a standing order for the main cover doesn't fill every variant.
--  * A title with no store row of its own now starts at the series' standing number when there is one, else at last
--    issue's number, as before. A row of its own (0 included) still wins over both. Mark ordered writes whichever it
--    started at as the title's own row. Once a title's cutoff has passed, a title with no row of its own has 0 store
--    copies (nothing was ordered for the store), so Past Orders and late cutoffs don't count a number nobody sent.
--  * order_row gains last_issue_total (last issue's customer copies plus its store copies, what was ordered for it) and
--    series_qty (the standing number, null when the series has none), so the screen can show where a number came from.

create table public.series_shop_qty (
  series_key  text not null,
  variant     text not null default '',  -- '' for titles with no variant label
  location_id bigint not null references public.locations (id) on delete cascade default public.default_location_id(),
  quantity    smallint not null check (quantity between 0 and 999),
  updated_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now(),
  primary key (series_key, variant, location_id)
);
comment on table public.series_shop_qty is 'Store copies to order of every new issue in a series (per variant label and location), until staff stop it.';
create index series_shop_qty_location_idx on public.series_shop_qty (location_id);
alter table public.series_shop_qty enable row level security;
create policy "staff read series shop qty" on public.series_shop_qty for select using ((select public.is_staff()));
grant select on public.series_shop_qty to authenticated;

alter type public.order_row add attribute last_issue_total int;  -- last issue's customer + store copies (null: no last issue)
alter type public.order_row add attribute series_qty int;        -- the series' standing store copies (null: none)

-- The same rows as before (see 20270403000000_shop_ordering.sql), with the standing number and last issue's total.
create or replace function public._order_rows(p_foc date, p_distributor text, p_location bigint)
returns setof public.order_row
language sql stable set search_path = public
as $$
  with base as (
    select i.*
    from public.items i
    where i.foc_date is not distinct from p_foc
      and (p_distributor = 'all' or coalesce(i.distributor, 'none') = p_distributor)
      and (p_foc is not null
           or exists (select 1 from public.reservations r
                      where r.item_id = i.id and not r.reorder and r.status in ('open', 'ordered', 'arrived', 'picked_up')
                        and (p_location is null or r.location_id = p_location))
           or exists (select 1 from public.shop_order_lines s
                      where s.item_id = i.id and s.quantity > 0 and s.status <> 'cancelled'
                        and (p_location is null or s.location_id = p_location)))
  ),
  cust as (
    select r.item_id,
           sum(r.quantity) as copies,
           coalesce(sum(r.quantity) filter (where r.status = 'open'), 0) as open_copies,
           count(distinct r.order_id) as orders
    from public.reservations r
    join base b on b.id = r.item_id
    where not r.reorder
      and (p_location is null or r.location_id = p_location)
      and (r.status in ('ordered', 'arrived', 'picked_up') or (r.status = 'open' and public.counts_for_order(r)))
    group by r.item_id
  ),
  shop as (
    select s.item_id,
           sum(s.quantity) filter (where s.status <> 'cancelled') as qty,
           count(*) filter (where s.status <> 'cancelled') as rows_kept,
           case when bool_or(s.status = 'open') then 'open'
                when bool_or(s.status = 'ordered') then 'ordered'
                when bool_or(s.status = 'received') then 'received' end as status
    from public.shop_order_lines s
    join base b on b.id = s.item_id
    where p_location is null or s.location_id = p_location
    group by s.item_id
  ),
  -- What a title with no row of its own starts at: the series' standing number, else last issue's.
  pick as (
    select b.id,
           c.copies, c.open_copies, c.orders,
           s.qty, s.rows_kept, s.status,
           li.qty as li_qty, li.total as li_total, sq.qty as sq_qty,
           -- Once the cutoff has passed, a title with no row of its own had no store copies ordered: no default.
           case when coalesce(s.rows_kept, 0) > 0 then s.qty
                when b.foc_date < public.shop_today() then 0
                else coalesce(sq.qty, li.qty, 0) end as shop_copies
    from base b
    left join cust c on c.item_id = b.id
    left join shop s on s.item_id = b.id
    -- Last issue: the latest earlier title in the series with the same variant label, its own store rows and its
    -- customer copies (counted the same way as cust above).
    left join lateral (
      select (select sum(x.quantity) from public.shop_order_lines x
              where x.item_id = p.id and x.status <> 'cancelled' and (p_location is null or x.location_id = p_location)) as qty,
             (select coalesce(sum(x.quantity), 0) from public.shop_order_lines x
              where x.item_id = p.id and x.status <> 'cancelled' and (p_location is null or x.location_id = p_location))
             + (select coalesce(sum(r.quantity), 0) from public.reservations r
                where r.item_id = p.id and not r.reorder and (p_location is null or r.location_id = p_location)
                  and (r.status in ('ordered', 'arrived', 'picked_up') or (r.status = 'open' and public.counts_for_order(r)))) as total
      from public.items p
      where b.series_key is not null and b.foc_date is not null
        and p.series_key = b.series_key and p.variant is not distinct from b.variant and p.foc_date < b.foc_date
      order by p.foc_date desc, p.id desc
      limit 1
    ) li on true
    left join lateral (
      select sum(q.quantity) as qty
      from public.series_shop_qty q
      where b.series_key is not null and q.series_key = b.series_key and q.variant = coalesce(b.variant, '')
        and (p_location is null or q.location_id = p_location)
      having count(*) > 0
    ) sq on true
  )
  select b.id, b.title, b.issue_number, b.variant, b.publisher, k.slug::text, b.price::numeric, b.release_date, b.foc_date,
         b.distributor, b.sku, b.upc, b.isbn, b.hidden,
         coalesce(x.copies, 0)::int,
         coalesce(x.open_copies, 0)::int,
         coalesce(x.orders, 0)::int,
         x.shop_copies::int,
         coalesce(x.rows_kept, 0) > 0,
         x.status,
         x.li_qty::int,
         (coalesce(x.copies, 0) + x.shop_copies)::int,
         sb.qty::int,
         sb.at,
         sb.foc,
         coalesce(sb.qty is not null and sb.foc is distinct from b.foc_date, false),
         case when sb.qty is null then null else (coalesce(x.copies, 0) + x.shop_copies - sb.qty)::int end,
         x.li_total::int,
         x.sq_qty::int
  from base b
  join pick x on x.id = b.id
  left join public.categories k on k.id = b.category_id
  -- Submitted: the latest submission line for the title at each location, added up.
  left join lateral (
    select sum(t.quantity) as qty, max(t.submitted_at) as at,
           (array_agg(t.foc_date order by t.submitted_at desc))[1] as foc
    from (
      select distinct on (o.location_id) l.quantity, l.foc_date, o.submitted_at
      from public.order_submission_lines l
      join public.order_submissions o on o.id = l.submission_id
      where l.item_id = b.id and (p_location is null or o.location_id = p_location)
      order by o.location_id, o.submitted_at desc, o.id desc
    ) t
    having count(*) > 0
  ) sb on true
  order by b.title, substring(b.issue_number from '^[0-9]+(?:\.[0-9]+)?')::numeric nulls first, b.issue_number, b.variant nulls first, b.id;
$$;
revoke execute on function public._order_rows(date, text, bigint) from public, anon, authenticated;

-- Store Order: set (or with null, stop) the series' standing store copies, for the series and variant label of this
-- title. Applies to every title in the series and variant that has no store row of its own, this one included.
-- Returns this title's row.
create or replace function public.staff_set_series_qty(p_item_id bigint, p_quantity int, p_location bigint default null)
returns setof public.order_row
language plpgsql security definer set search_path = public
as $$
declare
  item  public.items;
  v_loc bigint;
begin
  if not public.is_staff() then
    raise exception 'Staff only.' using errcode = '42501';
  end if;
  if p_quantity is not null and (p_quantity < 0 or p_quantity > 999) then
    raise exception 'Store copies must be between 0 and 999.' using errcode = 'P0001';
  end if;
  select * into item from public.items where id = p_item_id;
  if item.id is null then
    raise exception 'That title no longer exists.' using errcode = 'P0001';
  end if;
  if item.series_key is null then
    raise exception 'That title isn''t part of a series, so it has no every-issue number.' using errcode = 'P0001';
  end if;
  v_loc := public._order_location(p_location);
  if p_quantity is null then
    delete from public.series_shop_qty where series_key = item.series_key and variant = coalesce(item.variant, '') and location_id = v_loc;
  else
    insert into public.series_shop_qty (series_key, variant, location_id, quantity)
    values (item.series_key, coalesce(item.variant, ''), v_loc, p_quantity)
    on conflict (series_key, variant, location_id) do update
      set quantity = excluded.quantity, updated_by = auth.uid(), updated_at = now();
  end if;
  return query select * from public._order_rows(item.foc_date, coalesce(item.distributor, 'none'), p_location) r where r.item_id = item.id;
end;
$$;
revoke execute on function public.staff_set_series_qty(bigint, int, bigint) from public, anon;
grant execute on function public.staff_set_series_qty(bigint, int, bigint) to authenticated;

-- Store Order: drop the title's own store row, so it goes back to the series' number or last issue's. Only while the
-- row is still open (copies already ordered or received keep their row).
create or replace function public.staff_clear_shop_qty(p_item_id bigint, p_location bigint default null)
returns setof public.order_row
language plpgsql security definer set search_path = public
as $$
declare
  item  public.items;
  v_loc bigint;
begin
  if not public.is_staff() then
    raise exception 'Staff only.' using errcode = '42501';
  end if;
  select * into item from public.items where id = p_item_id;
  if item.id is null then
    raise exception 'That title no longer exists.' using errcode = 'P0001';
  end if;
  if item.foc_date is not null and item.foc_date < public.shop_today() then
    raise exception 'The order cutoff for this title has passed.' using errcode = 'P0001';
  end if;
  v_loc := public._order_location(p_location);
  if exists (select 1 from public.shop_order_lines where item_id = item.id and location_id = v_loc and status in ('ordered', 'received')) then
    raise exception 'The store copies of this title are already ordered. Change the number instead.' using errcode = 'P0001';
  end if;
  delete from public.shop_order_lines where item_id = item.id and location_id = v_loc and status in ('open', 'cancelled');
  return query select * from public._order_rows(item.foc_date, coalesce(item.distributor, 'none'), p_location) r where r.item_id = item.id;
end;
$$;
revoke execute on function public.staff_clear_shop_qty(bigint, bigint) from public, anon;
grant execute on function public.staff_clear_shop_qty(bigint, bigint) to authenticated;
