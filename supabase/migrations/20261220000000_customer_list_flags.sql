-- Admin → Customers status icons: titles that arrived and are past the hold window (shop days, not UTC).
-- Columns are appended after notes_text so the view can be replaced in place.

create or replace view public.customer_list with (security_invoker = true) as
select c.id,
  c.user_id,
  c.email,
  c.phone,
  c.phone_digits,
  c.address1,
  c.city,
  c.state,
  c.zip,
  c.ship_arrivals,
  c.email_opt_in,
  c.created_at,
  c.updated_at,
  c.mature_ok,
  c.unsubscribe_token,
  c.last_emailed_on,
  c.first_name,
  c.last_name,
  c.name,
  c.notify_arrivals,
  coalesce(s.ready, 0::bigint) as ready_count,
  coalesce(s.active, 0::bigint) as active_count,
  s.last_updated,
  concat_ws(' · ',
    case when c.user_id is not null then 'Has account' else 'No login' end,
    case when c.ship_arrivals then 'Ships' end,
    case when c.email is null then 'No email' end,
    case when c.email is not null and not c.email_opt_in then 'Email off' end) as notes_text,
  coalesce(s.overdue, 0::bigint) as overdue_count
from public.customers c
left join (
  select o.customer_id,
    count(*) filter (where r.status = 'arrived') as ready,
    count(*) filter (where r.status in ('open', 'ordered', 'reordered', 'arrived')) as active,
    count(*) filter (
      where r.status = 'arrived'
        and r.arrived_on < public.shop_today() - (select hold_days from public.settings where id = 1)
    ) as overdue,
    max(r.updated_at) as last_updated
  from public.reservations r
  join public.reservation_orders o on o.id = r.order_id
  where o.customer_id is not null
  group by o.customer_id
) s on s.customer_id = c.id;
