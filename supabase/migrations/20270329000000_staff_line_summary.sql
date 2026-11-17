-- Dashboard and Analytics: reservations in progress, added up in the database (staff_line_summary).
--
-- Both screens downloaded every open, ordered and arrived line with its title (about 3,300 lines and 1 MB on the
-- busiest shop, four requests) and added them up in the browser, so they slowed down with every new reservation.
-- This returns just the figures the cards show, for the whole shop or one store:
--   open_copies      copies to order (open lines that count toward the order: counts_for_order's rules, for all
--                    lines in one pass)
--   arrived_copies, arrived_orders, overdue_lines (arrived before p_overdue_before)
--   by_foc           copies and customers to order per upcoming order cutoff
--   top              the 50 most-reserved titles with their details, plus any tied with the 50th (the screen breaks
--                    ties by name)
--   money            dollars arrived and not here yet, and the ids of lines with no price (Analytics > Money)
-- Checked against the browser's arithmetic on every shop and store, with paused, unapproved, over-cap and guest
-- lines: the same figures. About 45 ms and 18 KB on the busiest shop.

create or replace function public.staff_line_summary(p_location bigint default null, p_overdue_before date default null)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_today date := public.shop_today();
  v_verify boolean := coalesce((select t.verification_enabled from public.trust_settings t where t.id = 1), false);
  v_out jsonb;
begin
  if not public.is_staff() then raise exception 'Staff only.' using errcode = '42501'; end if;

  with lines as (
    select r.id, r.order_id, r.item_id, r.quantity, r.status, r.arrived_on, i.price, i.foc_date,
           case when r.status <> 'open' then true
                when o.customer_id is not null then
                  not exists (select 1 from public.customer_standing st
                              where st.customer_id = o.customer_id
                                and (st.account_state = 'unapproved'
                                     or (st.paused_at is not null and (i.foc_date is null or i.foc_date >= v_today))))
                  and not exists (select 1 from public.line_cap_flags f where f.reservation_id = r.id and f.status = 'over_cap')
                else
                  not v_verify
                  or exists (select 1 from public.guest_order_approvals g where g.order_id = o.id)
                  or exists (select 1 from public.customers c join public.customer_standing st on st.customer_id = c.id
                             where st.account_state in ('approved', 'proven') and st.paused_at is null
                               and ((o.email is not null and lower(c.email) = lower(o.email))
                                 or (o.phone_digits is not null and c.phone_digits = o.phone_digits)))
           end as counts
    from public.reservations r
    join public.reservation_orders o on o.id = r.order_id
    join public.items i on i.id = r.item_id
    where r.status in ('open', 'ordered', 'reordered', 'arrived')
      and (p_location is null or r.location_id = p_location)
  ),
  per_item as (
    select item_id, sum(quantity) as copies from lines group by item_id having sum(quantity) > 0
  ),
  top as (
    -- the 50 titles with most copies, plus any tied with the 50th (the screen breaks ties by name)
    select p.item_id, p.copies from per_item p
    where p.copies >= coalesce((select copies from per_item order by copies desc offset 49 limit 1), 0)
  )
  select jsonb_build_object(
    'open_copies',    coalesce((select sum(quantity) from lines where status = 'open' and counts), 0),
    'arrived_copies', coalesce((select sum(quantity) from lines where status = 'arrived'), 0),
    'arrived_orders', (select count(distinct order_id) from lines where status = 'arrived'),
    'overdue_lines',  (select count(*) from lines where status = 'arrived' and arrived_on < p_overdue_before),
    'by_foc', coalesce((select jsonb_agg(jsonb_build_object('foc_date', foc_date, 'copies', copies, 'orders', orders) order by foc_date)
                        from (select foc_date, sum(quantity) as copies, count(distinct order_id) as orders
                              from lines where status = 'open' and counts and foc_date >= v_today group by foc_date) f), '[]'),
    'top', coalesce((select jsonb_agg(jsonb_build_object(
                       'copies', t.copies,
                       'item', jsonb_build_object('id', i.id, 'title', i.title, 'issue_number', i.issue_number, 'variant', i.variant,
                                                  'publisher', i.publisher, 'price', i.price, 'foc_date', i.foc_date,
                                                  'release_date', i.release_date, 'cover_url', i.cover_url))
                       order by t.copies desc, t.item_id)
                     from top t join public.items i on i.id = t.item_id), '[]'),
    'money', jsonb_build_object(
      'ready',  coalesce((select sum(price * quantity) from lines where status = 'arrived' and price > 0), 0),
      'coming', coalesce((select sum(price * quantity) from lines where status <> 'arrived' and price > 0), 0),
      'unpriced_ids', coalesce((select jsonb_agg(id order by id) from lines where price is null or price <= 0), '[]'))
  ) into v_out;
  return v_out;
end;
$$;
revoke execute on function public.staff_line_summary(bigint, date) from public, anon;
grant execute on function public.staff_line_summary(bigint, date) to authenticated;
