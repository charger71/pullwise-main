-- Shop ordering and distributor export, part 1: the data and the numbers.
--
-- The shop orders its own shelf copies ("store copies") for each order cutoff next to customer reservations, and
-- exports the full total in the form each distributor accepts. Pullwise doesn't submit orders itself; staff upload or
-- paste the export on the distributor's site, then mark the cutoff ordered, which records what was sent.
--
--  * shop_order_lines: the store's copies of a title at a location, one row per title and location (a title has a
--    single cutoff, so it never needs two; copies wanted after the cutoff are re-orders, in stock_reorders). The
--    number is overwritten as staff type, and 0 is kept (it overrides last issue's number, below).
--    open -> ordered -> received, or cancelled.
--  * A title with no row of its own starts at last issue's store copies: the latest earlier title in the same series
--    (items.series_key) with the same variant label, by order cutoff. Marking ordered writes those numbers as rows.
--  * order_submissions / order_submission_lines: what was sent to the distributor, per title. A title's Submitted
--    number is its latest submission line at that location, whatever cutoff it was sent under, so a title whose
--    order cutoff moves keeps its number (and shows "FOC date moved").
--  * _order_rows(cutoff, distributor, location): every title for that cutoff with customer copies, store copies,
--    total, submitted and change. The Store Order and Place Order screens, the exports, Mark ordered and Past Orders
--    all read it, so they can't disagree.
-- Customer copies are open lines that count toward the order (counts_for_order) plus lines already ordered, arrived
-- or picked up. Re-orders (reorder = true) and "reordered" lines (a damaged copy ordered again) are a separate order
-- and never count here. Writes go through the staff_* functions; staff can read the tables, nobody writes them
-- directly.

-- ---------------------------------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------------------------------

create table public.shop_order_lines (
  id          bigint generated always as identity primary key,
  item_id     bigint not null references public.items (id) on delete restrict,
  location_id bigint not null references public.locations (id) on delete restrict default public.default_location_id(),
  quantity    smallint not null check (quantity between 0 and 999),
  status      text not null default 'open' check (status in ('open', 'ordered', 'received', 'cancelled')),
  updated_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now(),
  ordered_at  timestamptz,
  received_at timestamptz,
  unique (item_id, location_id)
);
comment on table public.shop_order_lines is 'Store (shelf) copies ordered before a title''s cutoff, one row per title and location.';
create index shop_order_lines_location_idx on public.shop_order_lines (location_id);
create index shop_order_lines_status_idx on public.shop_order_lines (status) where status in ('open', 'ordered');

create table public.order_submissions (
  id           bigint generated always as identity primary key,
  foc_date     date,
  distributor  text not null check (distributor in ('lunar', 'prh', 'other', 'none')),
  location_id  bigint not null references public.locations (id) on delete restrict,
  source       text not null default 'export' check (source in ('export', 'manual')),
  note         text check (length(note) <= 500),
  submitted_by uuid default auth.uid(),
  submitted_at timestamptz not null default now()
);
comment on table public.order_submissions is 'An order sent to a distributor for one cutoff (or a number staff entered for an order placed on the distributor''s site).';
create index order_submissions_location_idx on public.order_submissions (location_id);
create index order_submissions_foc_idx on public.order_submissions (foc_date, distributor);

create table public.order_submission_lines (
  submission_id   bigint not null references public.order_submissions (id) on delete cascade,
  item_id         bigint not null references public.items (id) on delete restrict,
  quantity        int not null check (quantity between 0 and 9999),
  customer_copies int not null default 0,
  shop_copies     int not null default 0,
  foc_date        date,
  primary key (submission_id, item_id)
);
comment on column public.order_submission_lines.quantity is 'Copies the distributor has for this title after this submission.';
comment on column public.order_submission_lines.foc_date is 'The title''s order cutoff when it was sent (a later change shows as "FOC date moved").';
create index order_submission_lines_item_idx on public.order_submission_lines (item_id);

-- Every title in a cutoff is listed (not only pre-orders), so look titles up by cutoff directly.
create index items_foc_distributor_idx on public.items (foc_date, distributor);

alter table public.shop_order_lines enable row level security;
alter table public.order_submissions enable row level security;
alter table public.order_submission_lines enable row level security;
create policy "staff read shop order lines" on public.shop_order_lines for select using ((select public.is_staff()));
create policy "staff read order submissions" on public.order_submissions for select using ((select public.is_staff()));
create policy "staff read order submission lines" on public.order_submission_lines for select using ((select public.is_staff()));
grant select on public.shop_order_lines, public.order_submissions, public.order_submission_lines to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- The rows: one per title in a cutoff
-- ---------------------------------------------------------------------------------------------------------------------

create type public.order_row as (
  item_id         bigint,
  title           text,
  issue_number    text,
  variant         text,
  publisher       text,
  category        text,     -- the category's slug (comics, trades, ...)
  price           numeric,
  release_date    date,
  foc_date        date,
  distributor     text,
  sku             text,
  upc             text,
  isbn            text,
  hidden          boolean,
  customer_copies int,      -- open lines that count, plus ordered, arrived and picked up
  customer_open   int,      -- of which still open (not yet marked ordered)
  customers       int,      -- customer orders with copies of this title
  shop_copies     int,      -- the store's number, or last issue's when there is no row yet
  shop_saved      boolean,  -- true when shop_copies is the title's own row, false when it's last issue's number
  shop_status     text,     -- open, ordered, received (null without a row)
  last_issue_shop int,      -- last issue's store copies (null when there is no earlier issue with a number)
  total           int,      -- customer_copies + shop_copies: what the distributor should have
  submitted       int,      -- copies sent to the distributor (null when never sent)
  submitted_at    timestamptz,
  submitted_foc   date,     -- the title's cutoff when it was last sent
  foc_moved       boolean,  -- sent under a different cutoff than it has now
  change          int       -- total - submitted (null when never sent)
);

-- p_foc: the cutoff (null: titles with no cutoff, listed only when they have customer copies or store copies).
-- p_distributor: lunar, prh, other, none (titles with no distributor) or all.
-- p_location: one location, or null for all of them (a shop with one location passes null). With null, store copies
-- and submitted numbers are added up across locations.
-- Internal: the staff_* functions below call it after checking the caller is staff.
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
  )
  select b.id, b.title, b.issue_number, b.variant, b.publisher, k.slug::text, b.price::numeric, b.release_date, b.foc_date,
         b.distributor, b.sku, b.upc, b.isbn, b.hidden,
         coalesce(c.copies, 0)::int,
         coalesce(c.open_copies, 0)::int,
         coalesce(c.orders, 0)::int,
         (case when coalesce(s.rows_kept, 0) > 0 then s.qty else coalesce(li.qty, 0) end)::int,
         coalesce(s.rows_kept, 0) > 0,
         s.status,
         li.qty::int,
         (coalesce(c.copies, 0) + case when coalesce(s.rows_kept, 0) > 0 then s.qty else coalesce(li.qty, 0) end)::int,
         sb.qty::int,
         sb.at,
         sb.foc,
         coalesce(sb.qty is not null and sb.foc is distinct from b.foc_date, false),
         case when sb.qty is null then null
              else (coalesce(c.copies, 0) + case when coalesce(s.rows_kept, 0) > 0 then s.qty else coalesce(li.qty, 0) end - sb.qty)::int end
  from base b
  left join public.categories k on k.id = b.category_id
  left join cust c on c.item_id = b.id
  left join shop s on s.item_id = b.id
  -- Last issue: the latest earlier title in the series with the same variant label, and its own store rows.
  left join lateral (
    select (select sum(x.quantity) from public.shop_order_lines x
            where x.item_id = p.id and x.status <> 'cancelled' and (p_location is null or x.location_id = p_location)) as qty
    from public.items p
    where b.series_key is not null and b.foc_date is not null
      and p.series_key = b.series_key and p.variant is not distinct from b.variant and p.foc_date < b.foc_date
    order by p.foc_date desc, p.id desc
    limit 1
  ) li on true
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

create or replace function public._order_check(p_distributor text, p_location bigint, p_any_distributor boolean default true)
returns void
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Staff only.' using errcode = '42501';
  end if;
  if p_distributor is null or p_distributor not in ('lunar', 'prh', 'other', 'none', 'all')
     or (not p_any_distributor and p_distributor = 'all') then
    raise exception 'Pick a distributor.' using errcode = 'P0001';
  end if;
  if p_location is not null and not exists (select 1 from public.locations where id = p_location) then
    raise exception 'That location no longer exists.' using errcode = 'P0001';
  end if;
end;
$$;
revoke execute on function public._order_check(text, bigint, boolean) from public, anon, authenticated;

-- Every title for one cutoff (Store Order lists them all, A to Z). p_ordering_only: just the titles with copies to
-- order or already sent (Place Order).
create or replace function public.staff_order_rows(p_foc date, p_distributor text, p_location bigint default null, p_ordering_only boolean default false)
returns setof public.order_row
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public._order_check(p_distributor, p_location);
  return query
    select * from public._order_rows(p_foc, p_distributor, p_location) r
    where not p_ordering_only or r.total > 0 or r.submitted is not null;
end;
$$;
revoke execute on function public.staff_order_rows(date, text, bigint, boolean) from public, anon;
grant execute on function public.staff_order_rows(date, text, bigint, boolean) to authenticated;

-- One line per cutoff: upcoming cutoffs with titles from this distributor, plus any cutoff (passed, or no cutoff)
-- that still has copies waiting to be ordered. Totals come from _order_rows.
create or replace function public.staff_order_cutoffs(p_distributor text, p_location bigint default null)
returns table (
  foc_date        date,
  titles          int,      -- titles with copies to order
  all_titles      int,      -- every title in the cutoff (Store Order)
  customer_copies int,
  shop_copies     int,
  total           int,
  cost            numeric,  -- total at cover price
  submitted_at    timestamptz,
  changed         int       -- titles whose total differs from what was sent
)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_today date := public.shop_today();
begin
  perform public._order_check(p_distributor, p_location);
  -- (the output columns share names with _order_rows' fields; every reference below is qualified)
  return query
    with focs as (
      select i.foc_date as f from public.items i
      where i.foc_date >= v_today and (p_distributor = 'all' or coalesce(i.distributor, 'none') = p_distributor)
      union
      select i.foc_date from public.reservations r join public.items i on i.id = r.item_id
      where r.status = 'open' and not r.reorder and (p_location is null or r.location_id = p_location)
        and (p_distributor = 'all' or coalesce(i.distributor, 'none') = p_distributor)
      union
      select i.foc_date from public.shop_order_lines s join public.items i on i.id = s.item_id
      where s.status = 'open' and s.quantity > 0 and (p_location is null or s.location_id = p_location)
        and (p_distributor = 'all' or coalesce(i.distributor, 'none') = p_distributor)
    )
    select f.f,
           (count(*) filter (where r.total > 0))::int,
           count(r.item_id)::int,
           coalesce(sum(r.customer_copies), 0)::int,
           coalesce(sum(r.shop_copies), 0)::int,
           coalesce(sum(r.total), 0)::int,
           coalesce(sum(r.total * r.price), 0)::numeric,
           max(r.submitted_at),
           (count(*) filter (where r.change <> 0))::int
    from focs f
    left join lateral public._order_rows(f.f, p_distributor, p_location) r on true
    group by f.f
    having count(r.item_id) > 0
    order by f.f nulls last;
end;
$$;
revoke execute on function public.staff_order_cutoffs(text, bigint) from public, anon;
grant execute on function public.staff_order_cutoffs(text, bigint) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------------------------------------------------

-- The location a write goes to: the one picked, or the shop's only one. A shop with 2+ locations must pick.
create or replace function public._order_location(p_location bigint)
returns bigint
language plpgsql stable security definer set search_path = public
as $$
begin
  if p_location is not null then
    if not exists (select 1 from public.locations where id = p_location) then
      raise exception 'That location no longer exists.' using errcode = 'P0001';
    end if;
    return p_location;
  end if;
  if (select count(*) from public.locations) > 1 then
    raise exception 'Pick a location first.' using errcode = 'P0001';
  end if;
  return public.default_location_id();
end;
$$;
revoke execute on function public._order_location(bigint) from public, anon, authenticated;

-- Store Order: set the store's copies of a title (0 keeps a row that overrides last issue's number). Allowed until
-- the title's cutoff has passed, and not once the copies are received. Returns the title's row, with its new total.
create or replace function public.staff_set_shop_qty(p_item_id bigint, p_quantity int, p_location bigint default null)
returns setof public.order_row
language plpgsql security definer set search_path = public
as $$
declare
  item  public.items;
  v_loc bigint;
  v_name text;
begin
  if not public.is_staff() then
    raise exception 'Staff only.' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity < 0 or p_quantity > 999 then
    raise exception 'Store copies must be between 0 and 999.' using errcode = 'P0001';
  end if;
  select * into item from public.items where id = p_item_id;
  if item.id is null then
    raise exception 'That title no longer exists.' using errcode = 'P0001';
  end if;
  v_name := item.title || coalesce(' #' || nullif(item.issue_number, ''), '') || coalesce(' (' || nullif(item.variant, '') || ')', '');
  if item.foc_date is not null and item.foc_date < public.shop_today() then
    raise exception 'The order cutoff for % has passed.', v_name using errcode = 'P0001';
  end if;
  v_loc := public._order_location(p_location);
  if exists (select 1 from public.shop_order_lines where item_id = item.id and location_id = v_loc and status = 'received') then
    raise exception 'The store copies of % are already received.', v_name using errcode = 'P0001';
  end if;
  insert into public.shop_order_lines (item_id, location_id, quantity)
  values (item.id, v_loc, p_quantity)
  on conflict (item_id, location_id) do update
    set quantity = excluded.quantity, updated_by = auth.uid(), updated_at = now(),
        status = case when public.shop_order_lines.status = 'cancelled' then 'open' else public.shop_order_lines.status end;
  return query select * from public._order_rows(item.foc_date, coalesce(item.distributor, 'none'), p_location) r where r.item_id = item.id;
end;
$$;
revoke execute on function public.staff_set_shop_qty(bigint, int, bigint) from public, anon;
grant execute on function public.staff_set_shop_qty(bigint, int, bigint) to authenticated;

-- Mark ordered: record what was sent for one cutoff and distributor, then move the copies to ordered.
-- p_lines: [{ "item_id": 12, "quantity": 9 }, ...], the titles and quantities in the export as sent (Lunar: every
-- title, with its full total, including 0 for one sent earlier; PRH: the titles whose increase was pasted or whose
-- decrease staff made by hand in the cart, with the total the cart now holds). Each becomes the title's Submitted
-- number. Customer lines still open for those titles become Ordered (through staff_set_line_status, which logs it),
-- and the store's copies become ordered rows (last issue's number is written as the title's own row).
-- Titles that aren't in this cutoff and distributor any more are skipped. Returns { submission_id, titles, copies,
-- skipped, changed }: changed counts titles whose total moved since the export (they show a Change to send again).
create or replace function public.staff_mark_ordered(p_foc date, p_distributor text, p_location bigint, p_lines jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_loc     bigint;
  v_sub     bigint;
  v_titles  int;
  v_copies  int;
  v_skipped int;
  v_changed int;
  v_ids     bigint[];
begin
  perform public._order_check(p_distributor, p_location, false);
  v_loc := public._order_location(p_location);
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Nothing to mark ordered.' using errcode = 'P0001';
  end if;
  if exists (select 1 from jsonb_array_elements(p_lines) e
             where jsonb_typeof(e -> 'item_id') <> 'number' or jsonb_typeof(e -> 'quantity') <> 'number'
                or (e ->> 'quantity')::numeric not between 0 and 9999 or (e ->> 'quantity')::numeric <> trunc((e ->> 'quantity')::numeric)) then
    raise exception 'Each title needs a quantity between 0 and 9999.' using errcode = 'P0001';
  end if;

  drop table if exists pg_temp.mark_sent, pg_temp.mark_now;
  create temporary table pg_temp.mark_sent on commit drop as
    select (e ->> 'item_id')::bigint as item_id, max((e ->> 'quantity')::int) as quantity
    from jsonb_array_elements(p_lines) e
    group by 1;
  create temporary table pg_temp.mark_now on commit drop as
    select r.* from public._order_rows(p_foc, p_distributor, p_location) r
    where r.item_id in (select item_id from pg_temp.mark_sent);

  select count(*) into v_skipped from pg_temp.mark_sent s where not exists (select 1 from pg_temp.mark_now n where n.item_id = s.item_id);
  if v_skipped = (select count(*) from pg_temp.mark_sent) then
    raise exception 'None of those titles are in this cutoff any more. Refresh and export again.' using errcode = 'P0001';
  end if;

  insert into public.order_submissions (foc_date, distributor, location_id)
  values (p_foc, p_distributor, v_loc)
  returning id into v_sub;
  insert into public.order_submission_lines (submission_id, item_id, quantity, customer_copies, shop_copies, foc_date)
  select v_sub, n.item_id, s.quantity, n.customer_copies, n.shop_copies, n.foc_date
  from pg_temp.mark_now n join pg_temp.mark_sent s on s.item_id = n.item_id;

  -- Store copies: last issue's number becomes the title's own row; every open row becomes ordered.
  insert into public.shop_order_lines (item_id, location_id, quantity, status, ordered_at)
  select n.item_id, v_loc, n.shop_copies, 'ordered', now()
  from pg_temp.mark_now n
  where not n.shop_saved and n.shop_copies > 0
  on conflict (item_id, location_id) do nothing;
  update public.shop_order_lines l
  set status = 'ordered', ordered_at = now(), updated_by = auth.uid(), updated_at = now()
  from pg_temp.mark_now n
  where l.item_id = n.item_id and l.location_id = v_loc and l.status = 'open';

  -- Customer lines still open (the ones that count) become Ordered.
  select coalesce(array_agg(r.id), '{}') into v_ids
  from public.reservations r
  join pg_temp.mark_now n on n.item_id = r.item_id
  where r.location_id = v_loc and r.status = 'open' and not r.reorder;
  if cardinality(v_ids) > 0 then
    perform public.staff_set_line_status(v_ids, 'ordered', array['open']::public.reservation_status[]);
  end if;

  select count(*), coalesce(sum(s.quantity), 0) into v_titles, v_copies
  from pg_temp.mark_now n join pg_temp.mark_sent s on s.item_id = n.item_id;
  select count(*) into v_changed
  from public._order_rows(p_foc, p_distributor, p_location) r
  join pg_temp.mark_sent s on s.item_id = r.item_id
  where r.total <> s.quantity;

  return jsonb_build_object('submission_id', v_sub, 'titles', v_titles, 'copies', v_copies, 'skipped', v_skipped, 'changed', v_changed);
end;
$$;
revoke execute on function public.staff_mark_ordered(date, text, bigint, jsonb) from public, anon;
grant execute on function public.staff_mark_ordered(date, text, bigint, jsonb) to authenticated;

-- An order placed on the distributor's own site: staff enter how many copies the distributor has for a title, so
-- Submitted and Change stay right. Recorded as a manual submission with an optional note.
create or replace function public.staff_set_submitted(p_item_id bigint, p_quantity int, p_location bigint default null, p_note text default null)
returns setof public.order_row
language plpgsql security definer set search_path = public
as $$
declare
  item  public.items;
  v_loc bigint;
  v_sub bigint;
  v_now public.order_row;
begin
  if not public.is_staff() then
    raise exception 'Staff only.' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity < 0 or p_quantity > 9999 then
    raise exception 'Copies sent must be between 0 and 9999.' using errcode = 'P0001';
  end if;
  select * into item from public.items where id = p_item_id;
  if item.id is null then
    raise exception 'That title no longer exists.' using errcode = 'P0001';
  end if;
  v_loc := public._order_location(p_location);
  select * into v_now from public._order_rows(item.foc_date, coalesce(item.distributor, 'none'), v_loc) r where r.item_id = item.id;
  insert into public.order_submissions (foc_date, distributor, location_id, source, note)
  values (item.foc_date, coalesce(item.distributor, 'none'), v_loc, 'manual', nullif(trim(p_note), ''))
  returning id into v_sub;
  insert into public.order_submission_lines (submission_id, item_id, quantity, customer_copies, shop_copies, foc_date)
  values (v_sub, item.id, p_quantity, coalesce(v_now.customer_copies, 0), coalesce(v_now.shop_copies, 0), item.foc_date);
  return query select * from public._order_rows(item.foc_date, coalesce(item.distributor, 'none'), p_location) r where r.item_id = item.id;
end;
$$;
revoke execute on function public.staff_set_submitted(bigint, int, bigint, text) from public, anon;
grant execute on function public.staff_set_submitted(bigint, int, bigint, text) to authenticated;
