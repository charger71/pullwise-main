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
union all select 'copy waiting over 6 days that was not left uncollected on purpose', count(*)
  from public.reservations r, t where (not r.reorder or r.source = 'manual') and r.status = 'arrived' and r.arrived_on < t.today - 6 and r.pickup_reminders < 2
union all select 'unclaimed past the ladder dates but not warned or paused', count(*)
  from public.customer_unclaimed u join public.customer_standing st on st.customer_id = u.customer_id and st.pickup_cadence <> 'exempt'
    join public.customers cu on cu.id = u.customer_id and cu.email like '%@example.com',
    lateral public.pickup_ladder_dates(u.oldest_received_on, st.pickup_cadence) d, t
  where st.paused_at is null and ((t.today >= d.pause_on) or (t.today >= d.warning_on and st.warning_sent_at is null))
union all select 'auto-paused though no unclaimed copy is past the pause date', count(*)
  from public.customer_standing st, t where st.paused_reason = 'auto' and not exists (
    select 1 from public.customer_unclaimed u cross join lateral public.pickup_ladder_dates(u.oldest_received_on, st.pickup_cadence) d
    where u.customer_id = st.customer_id and d.pause_on is not null and t.today >= d.pause_on)
union all select 'queued, failed or future pickup notices', count(*) from public.pickup_notices where status in ('queued', 'sending', 'failed') or created_at > now() or sent_at > now()
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
union all select 'customer_standing triggers disabled', count(*) from pg_trigger
  where tgrelid = 'public.customer_standing'::regclass and not tgisinternal and tgenabled = 'D'
