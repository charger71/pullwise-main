-- Every rule the demo data must follow. One row per rule with the number of rows breaking it; all must be 0.
with t as (select (now() at time zone 'America/New_York')::date today)
select 'arrived or picked up before release' as rule, count(*) as bad
  from public.reservations r join public.items i on i.id = r.item_id, t
  where r.status in ('arrived', 'picked_up') and i.release_date > t.today
union all select 'arrival date before release, after today or missing', count(*)
  from public.reservations r join public.items i on i.id = r.item_id, t
  where not r.reorder and r.status in ('arrived', 'picked_up') and (r.arrived_on is null or r.arrived_on < i.release_date or r.arrived_on > t.today)
union all select 'open or ordered with an arrival date', count(*)
  from public.reservations where status in ('open', 'ordered', 'reordered') and arrived_on is not null
union all select 'ordered before the cutoff', count(*)
  from public.reservations r join public.items i on i.id = r.item_id, t where r.status = 'ordered' and i.foc_date > t.today
union all select 'still open long after the cutoff', count(*)
  from public.reservations r join public.items i on i.id = r.item_id, t where not r.reorder and r.status = 'open' and i.foc_date < t.today - 3
union all select 'line older than its order', count(*)
  from public.reservations r join public.reservation_orders o on o.id = r.order_id where r.created_at < o.created_at - interval '1 minute'
union all select 'dated in the future', (select count(*) from public.reservations where created_at > now() or updated_at > now())
  + (select count(*) from public.reservation_orders where created_at > now())
  + (select count(*) from public.customers where created_at > now())
  + (select count(*) from public.email_log where created_at > now())
  + (select count(*) from public.event_signups where created_at > now())
union all select 'added on the site or pull list after the cutoff closed', count(*)
  from public.reservations r join public.items i on i.id = r.item_id
  cross join lateral (select (r.created_at at time zone 'America/New_York')::date d) c
  where not r.reorder and i.foc_date is not null
    and ((r.source = 'manual' and c.d + ((6 - extract(dow from c.d)::int) % 7) >= i.foc_date) or (r.source = 'series' and c.d > i.foc_date))
union all select 're-order arrived before it was ordered or after today', count(*)
  from public.reservations r, t where r.reorder and r.status in ('arrived', 'picked_up') and r.arrived_on is not null
    and (r.arrived_on < (r.created_at at time zone 'America/New_York')::date or r.arrived_on > t.today)
union all select 'chat message before its chat started or in the future', count(*)
  from public.chat_messages m join public.chat_conversations c on c.id = m.conversation_id where m.created_at < c.created_at or m.created_at > now()
union all select 'closed chat with unread messages', count(*) from public.chat_conversations where status = 'closed' and unread_staff > 0
union all select 'search, visit, alert or stock re-order dated in the future', (select count(*) from public.search_log where searched_at > now())
  + (select count(*) from public.app_visits where last_seen_at > now() or first_seen_at > now())
  + (select count(*) from public.stock_alerts where created_at > now())
  + (select count(*) from public.stock_reorders where created_at > now() or ordered_at > now() or received_at > now())
union all select 'app visit, stock alert or chat before the customer joined', (select count(*) from public.app_visits v join public.customers c on c.id = v.customer_id where v.first_seen_at < c.created_at)
  + (select count(*) from public.stock_alerts a join public.customers c on c.id = a.customer_id where a.created_at < c.created_at)
  + (select count(*) from public.chat_conversations h join public.customers c on c.id = h.customer_id where h.created_at < c.created_at)
union all select 'old survey answer or sign-up still unread', (select count(*) from public.survey_responses where not seen and created_at < now() - interval '3 days')
  + (select count(*) from public.event_signups where not seen and created_at < now() - interval '3 days')
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
union all select 'chat_messages triggers disabled', count(*) from pg_trigger
  where tgrelid = 'public.chat_messages'::regclass and not tgisinternal and tgenabled = 'D'
