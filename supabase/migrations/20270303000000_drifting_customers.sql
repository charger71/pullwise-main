-- Customers Drifting Away (Dashboard → Trends): pull list customers staff may want to call.
--
-- Listed when the customer has an active pull list (a follow, or a line in progress) and either:
--  * has copies past the shop's pickup window, or
--  * hasn't picked up in p_days, and had a reason to come in: copies waiting now, or released in those days.
--    Someone whose books simply haven't come out isn't drifting. A new customer counts from the day they joined.
-- A finished line's updated_at stands in for its pickup date (a trigger stamps every change to a line).
-- Runs as the caller, so the staff policies on these tables decide who gets rows.

create or replace function public.drifting_customers(p_days int default 60)
returns table (
  id            bigint,
  name          text,
  first_name    text,
  phone         text,
  email         text,
  last_pickup   timestamptz,
  waiting       int,
  past_window   int,
  waiting_value numeric
)
language sql stable set search_path = public
as $$
  with per_customer as (
    select c.id, c.name, c.first_name, c.phone, c.email, c.created_at,
           max(r.updated_at) filter (where r.status = 'picked_up') as last_pickup,
           coalesce(sum(r.quantity) filter (where r.status = 'arrived'), 0)::int as waiting,
           coalesce(sum(r.quantity) filter (where r.status = 'arrived'
             and r.arrived_on < public.shop_today() - (select s.hold_days from public.settings s where s.id = 1)), 0)::int as past_window,
           coalesce(sum(r.quantity * i.price) filter (where r.status = 'arrived'), 0) as waiting_value,
           coalesce(bool_or(r.status = 'released' and r.arrived_on >= public.shop_today() - p_days), false) as released_lately,
           bool_or(r.status in ('open', 'ordered', 'reordered', 'arrived')) as in_progress
    from public.customers c
    join public.reservation_orders o on o.customer_id = c.id
    join public.reservations r on r.order_id = o.id
    join public.items i on i.id = r.item_id
    group by c.id
  )
  select p.id, p.name, p.first_name, p.phone, p.email, p.last_pickup, p.waiting, p.past_window, p.waiting_value
  from per_customer p
  where (p.in_progress or exists (select 1 from public.subscriptions f where f.customer_id = p.id))
    and (p.past_window > 0
      or (coalesce(p.last_pickup, p.created_at) < now() - make_interval(days => p_days)
          and (p.waiting > 0 or p.released_lately)))
  order by p.waiting_value desc, coalesce(p.last_pickup, p.created_at)
  limit 200;
$$;
revoke execute on function public.drifting_customers(int) from public, anon;
grant execute on function public.drifting_customers(int) to authenticated;
