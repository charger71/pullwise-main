-- Admin → Customers: the list's Ready / Active / Last updated / Notes columns are sortable, so the
-- database works them out (they used to be computed in the browser for the visible page only).
-- security_invoker: staff see exactly what their own access to customers and reservations allows.

create view public.customer_list with (security_invoker = true) as
select c.*,
  coalesce(s.ready, 0) as ready_count,
  coalesce(s.active, 0) as active_count,
  s.last_updated,
  concat_ws(' · ',
    case when c.user_id is not null then 'Has account' else 'No login' end,
    case when c.ship_arrivals then 'Ships' end,
    case when c.email is null then 'No email' end,
    case when c.email is not null and not c.email_opt_in then 'Email off' end) as notes_text
from public.customers c
left join (
  select o.customer_id,
    count(*) filter (where r.status = 'arrived') as ready,
    count(*) filter (where r.status in ('open', 'ordered', 'arrived')) as active,
    max(r.updated_at) as last_updated
  from public.reservations r
  join public.reservation_orders o on o.id = r.order_id
  where o.customer_id is not null
  group by o.customer_id
) s on s.customer_id = c.id;

grant select on public.customer_list to authenticated;
