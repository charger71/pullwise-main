-- Every rule the demo data must follow. One row per rule with the number of rows breaking it; all must be 0.
with t as (select (now() at time zone 'America/New_York')::date today)
select 'arrived or picked up before release' as rule, count(*) as bad
  from public.reservations r join public.items i on i.id = r.item_id, t
  where r.status in ('arrived', 'picked_up') and i.release_date > t.today
union all select 'arrival date before release, after today or missing', count(*)
  from public.reservations r join public.items i on i.id = r.item_id, t
  where r.status in ('arrived', 'picked_up') and (r.arrived_on is null or r.arrived_on < i.release_date or r.arrived_on > t.today)
union all select 'open or ordered with an arrival date', count(*)
  from public.reservations where status in ('open', 'ordered', 'reordered') and arrived_on is not null
union all select 'ordered before the cutoff', count(*)
  from public.reservations r join public.items i on i.id = r.item_id, t where r.status = 'ordered' and i.foc_date > t.today
union all select 'still open long after the cutoff', count(*)
  from public.reservations r join public.items i on i.id = r.item_id, t where r.status = 'open' and i.foc_date < t.today - 3
union all select 'line older than its order', count(*)
  from public.reservations r join public.reservation_orders o on o.id = r.order_id where r.created_at < o.created_at - interval '1 minute'
union all select 'dated in the future', (select count(*) from public.reservations where created_at > now() or updated_at > now())
  + (select count(*) from public.reservation_orders where created_at > now())
  + (select count(*) from public.customers where created_at > now())
  + (select count(*) from public.email_log where created_at > now())
  + (select count(*) from public.event_signups where created_at > now())
union all select 'failed emails', count(*) from public.email_log where status = 'failed'
union all select 'arrival email without an arrival', count(*) from public.email_log e
  where e.kind = 'arrival' and e.customer_id is not null and not exists (
    select 1 from public.reservations r join public.reservation_orders o on o.id = r.order_id
    where o.customer_id = e.customer_id and r.status in ('arrived', 'picked_up')
      and r.arrived_on between (e.created_at at time zone 'America/New_York')::date - 1 and (e.created_at at time zone 'America/New_York')::date + 1)
union all select 'orders without lines', count(*) from public.reservation_orders o
  where o.kind = 'order' and not exists (select 1 from public.reservations r where r.order_id = o.id)
union all select 'event sign-up before the customer joined or after the event', count(*)
  from public.event_signups s join public.events e on e.id = s.event_id left join public.customers c on c.email = s.email
  where s.created_at > e.starts_at or s.created_at < c.created_at
union all select 'reservations_stamp trigger disabled', count(*) from pg_trigger
  where tgname = 'reservations_stamp' and tgenabled = 'D'
union all select 'event_signups user triggers disabled', count(*) from pg_trigger
  where tgrelid = 'public.event_signups'::regclass and not tgisinternal and tgenabled = 'D'
