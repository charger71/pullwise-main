-- Brings the demo shop's data up to today. Additive and idempotent: it only adds what is missing since the last
-- run and then puts every line back in a state that is possible on today's date. Run it with tools/demo-data.mjs.
--
-- Rules the data follows (tools/demo-data/check.sql tests every one):
--   * a copy can't be ordered before its title's cutoff (FOC) and is ordered once the cutoff has passed
--   * a copy can't arrive or be picked up before its release date, or after today (shop time)
--   * open and ordered copies have no arrival date; arrived and picked-up copies always do
--   * a line never predates its order, nothing is dated in the future, no email failed
--   * this week's titles are ordered and waiting to be received (Admin > Ordering > Received)
--   * a copy added on the site or the pull list is added before its cutoff closes (the Saturday on or before the FOC
--     date); later ones are re-orders. Re-order lines (reorder = true) are never moved by the lifecycle below,
--     except the demo's own customer re-orders (source 'manual'), which staff order and then receive
--   * copies waiting more than 6 days are collected, except those of the few customers who never collect; those
--     customers are warned at day 7 and paused at day 14 (weekly) or 21 and 35 (monthly), as the pickup ladder would
--   * chats, searches, app visits, stock alerts and shelf re-orders are dated between a customer joining and now
-- Shop time is America/New_York; the database runs in UTC, so "today" is always computed in shop time.
-- Customers are @example.com with email opt-in off, so nothing here can send real mail.
begin;
-- @options
alter table public.reservations disable trigger reservations_stamp;
alter table public.event_signups disable trigger user;

create temp table demo_staff on commit drop as
select row_number() over (order by s.name) - 1 as n, s.user_id
from public.staff s join auth.users u on u.id = s.user_id
where u.email like '%@area71.com';
create temp table demo_clock on commit drop as
select d as today,
       case when current_setting('demo.hold_week', true) = 'on' then d - extract(dow from d)::int else d end as hold_from,
       coalesce(current_setting('demo.seed', true), '') = 'on' as seed
from (select (now() at time zone 'America/New_York')::date d) x;

-- 0. A customer can't add a copy after its cutoff closes (reservations_close_through: the Saturday on or before the
-- FOC date); drop the old ones that did. Orders left empty go too and the day-filler below writes valid ones.
create temp table late_lines on commit drop as
select r.id from public.reservations r
join public.items i on i.id = r.item_id
cross join lateral (select (r.created_at at time zone 'America/New_York')::date d) c
where not r.reorder and i.foc_date is not null
  and ((r.source = 'manual' and c.d + ((6 - extract(dow from c.d)::int) % 7) >= i.foc_date) or (r.source = 'series' and c.d > i.foc_date));
update public.pull_list_log set reservation_id = null where reservation_id in (select id from late_lines);
delete from public.reservations where id in (select id from late_lines);
delete from public.reservation_orders o where o.kind = 'order' and not exists (select 1 from public.reservations r where r.order_id = o.id);

-- 1. New customers: about one every three days since the last one (a fresh seed: about 55 over 100 days), each with
-- a pull list, follows and lines.
create temp table new_customers (id bigint) on commit drop;
with last as (
  select greatest(coalesce(max(created_at at time zone 'America/New_York')::date, (select today - 100 from demo_clock)),
                  (select today - case when seed then 100 else 60 end from demo_clock)) d
  from public.customers, (select seed from demo_clock) sd where email like '%@example.com'
), days as (
  select g::date dy from last, demo_clock, generate_series(last.d + 1, demo_clock.today, interval '1 day') g
  where case when (select seed from demo_clock) then abs(hashtext('nc' || g::date)) % 100 < 55 else abs(hashtext('nc' || g::date)) % 3 = 0 end
), gen as (
  select row_number() over (order by dy) rn, dy,
    (array['Aiden','Bianca','Caleb','Dani','Evan','Farah','Gabe','Hana','Isaac','Jada','Kyle','Lena','Marco','Nora','Owen','Priya','Quinn','Rosa','Seth','Tess','Uriel','Vera','Wes','Ximena','Yusuf','Zoe','Abel','Brooke','Cody','Delia'])[1 + abs(hashtext('f' || dy)) % 30] f,
    (array['Alvarez','Brennan','Castillo','Dawson','Ellison','Fitch','Gallagher','Hollis','Iverson','Jankowski','Kessler','Lindqvist','Maddox','Novak','Okafor','Pruitt','Quigley','Ramsey','Sutter','Tran','Underhill','Vasquez','Whitlock','Yoder','Zeller','Bishop','Calloway','Doyle','Estrada','Foley'])[1 + abs(hashtext('l' || dy)) % 30] l,
    (array['2210 Bardstown Rd','815 Frankfort Ave','4417 Preston Hwy','96 Shelbyville Rd','3302 Taylor Blvd','1520 Highland Ave','240 E Market St','5100 Dixie Hwy','1233 Bardstown Rd','702 E Oak St'])[1 + abs(hashtext('a' || dy)) % 10] addr
  from days
), ins as (
  insert into public.customers (first_name, last_name, email, phone, address1, city, state, zip, email_opt_in, notify_arrivals, ship_arrivals, mature_ok, created_at)
  select f, l, lower(f || '.' || l) || '@example.com', '(555) 011-' || lpad(((select coalesce(max(id), 0) from public.customers) + rn)::text, 4, '0'),
         addr, 'Louisville', 'KY', (array['40205','40206','40213','40204','40215'])[1 + abs(hashtext(addr)) % 5],
         false, false, false, true,
         least((dy + make_interval(hours => 9 + abs(hashtext('h' || dy)) % 11, mins => abs(hashtext('m' || dy)) % 60)) at time zone 'America/New_York', now())
  from gen
  where not exists (select 1 from public.customers c where c.email = lower(f || '.' || l) || '@example.com')
  returning id
)
insert into new_customers select id from ins;

insert into public.reservation_orders (name, phone, email, customer_id, kind, created_at)
select c.name, c.phone, c.email, c.id, 'pull_list', c.created_at
from public.customers c
where c.email like '%@example.com' and not exists (select 1 from public.reservation_orders o where o.customer_id = c.id and o.kind = 'pull_list');

create temp table demo_series on commit drop as
select series_key, row_number() over (order by count(*) desc, series_key) rn
from public.items, demo_clock
where status = 'pre_order' and cover_url is not null and foc_date > today and series_key is not null
group by 1 having count(*) >= 2 limit 30;

insert into public.subscriptions (customer_id, kind, key, label, quantity, all_covers)
select c.id, 'series', s.series_key, (select initcap(i.title) from public.items i where i.series_key = s.series_key order by i.id limit 1), 1, false
from public.customers c
join new_customers n on n.id = c.id
cross join generate_series(0, 3) k
join demo_series s on s.rn = 1 + ((c.id * 5 + k * 7) % (select count(*) from demo_series))
on conflict do nothing;

insert into public.reservations (order_id, item_id, quantity, status, source, created_at, updated_at, updated_via)
select distinct on (o.id, i.id) o.id, i.id, 1, 'open', 'series', least(c.created_at + interval '5 minutes', now()), least(c.created_at + interval '5 minutes', now()), 'system'
from public.customers c
join new_customers n on n.id = c.id
join public.subscriptions s on s.customer_id = c.id
join public.reservation_orders o on o.customer_id = c.id and o.kind = 'pull_list'
join lateral (select id from public.items, demo_clock where series_key = s.key and status = 'pre_order' and cover_url is not null and foc_date > today order by release_date, id limit 3) i on true
on conflict (order_id, item_id) do nothing;

-- Titles of the followed series that released after the customer joined (cutoff still ahead of the join date):
-- their copies get picked up or cancelled by the lifecycle below.
insert into public.reservations (order_id, item_id, quantity, status, source, created_at, updated_at, updated_via)
select distinct on (o.id, i.id) o.id, i.id, 1, 'open', 'series', least(c.created_at + interval '5 minutes', now()), least(c.created_at + interval '5 minutes', now()), 'system'
from public.customers c
join new_customers n on n.id = c.id
join public.subscriptions s on s.customer_id = c.id
join public.reservation_orders o on o.customer_id = c.id and o.kind = 'pull_list'
join lateral (select id from public.items, demo_clock where series_key = s.key and cover_url is not null and not hidden
                and foc_date > (c.created_at at time zone 'America/New_York')::date and release_date < today order by release_date, id limit 6) i on true
on conflict (order_id, item_id) do nothing;

-- 2. Website reservations: 1-3 orders on every one of the last 45 days that has none (mostly signed-in customers).
create temp table gap_orders (id bigint, created_at timestamptz, customer_id bigint) on commit drop;
with gaps as (
  select g::date as dy from demo_clock, generate_series(today - 44, today, interval '1 day') g
  where not exists (select 1 from public.reservation_orders o where o.kind = 'order' and (o.created_at at time zone 'America/New_York')::date = g::date)
), slots as (
  select g.dy, k, least((g.dy + make_interval(hours => 9 + abs(hashtext(g.dy::text || k)) % 11, mins => abs(hashtext('m' || g.dy::text || k)) % 60)) at time zone 'America/New_York', now() - k * interval '20 minutes') as ts
  from gaps g cross join lateral generate_series(1, 1 + abs(hashtext(g.dy::text)) % 3) k
), ins as (
  insert into public.reservation_orders (name, phone, email, customer_id, kind, created_at)
  select coalesce(c.name, 'Walk-up guest'), coalesce(c.phone, '(555) 010-' || (9100 + abs(hashtext(s.ts::text)) % 800)), c.email, c.id, 'order', s.ts
  from slots s
  left join lateral (
    select * from public.customers x where x.email like '%@example.com' and x.created_at < s.ts and abs(hashtext('g' || s.ts::text)) % 9 <> 0
    order by md5(x.id::text || s.ts::text) limit 1
  ) c on true
  where s.ts <= now()
  returning id, created_at, customer_id
)
insert into gap_orders select * from ins;

insert into public.reservations (order_id, item_id, quantity, status, source, created_at, updated_at, updated_via)
select o.id, i.id, 1, 'open', 'manual', o.created_at, o.created_at + interval '1 hour',
       case when o.customer_id is null then 'guest' when abs(hashtext(o.id::text)) % 10 < 7 then 'customer' else 'staff' end
from gap_orders o
cross join lateral (select 1 + abs(hashtext('n' || o.id)) % 3 n) k
join lateral (
  select t.id, row_number() over (order by t.h) rn from (
    select x.id, md5('i' || o.id::text || x.id::text) h from public.items x
    where x.cover_url is not null and x.release_date between ((o.created_at at time zone 'America/New_York')::date + 6) and ((o.created_at at time zone 'America/New_York')::date + 60) and not x.hidden
      and ((o.created_at at time zone 'America/New_York')::date + ((6 - extract(dow from o.created_at at time zone 'America/New_York')::int) % 7)) < x.foc_date
    order by h limit 3) t
) i on i.rn <= k.n;
delete from public.reservation_orders where id in (select o.id from gap_orders o where not exists (select 1 from public.reservations r where r.order_id = o.id));

-- 3. This week's shipment: pull-list copies of titles releasing within the last 45 days or next 10 days whose
-- cutoff has passed (about one customer in nine), ordered at the cutoff.
insert into public.reservations (order_id, item_id, quantity, status, source, created_at, updated_at, updated_via)
select o.id, w.id, case when abs(hashtext(o.id::text || w.id)) % 9 = 0 then 2 else 1 end, 'ordered', 'series',
       greatest(c.created_at, (w.foc_date - 5 - abs(hashtext('c' || o.id || w.id)) % 12)::timestamptz),
       w.foc_date + time '16:00', 'system'
from (
  select i.id, i.foc_date, row_number() over (partition by i.release_date order by md5(i.id::text)) rn
  from public.items i, demo_clock
  where i.release_date between today - 45 and today + 10 and i.foc_date < today and i.cover_url is not null and not i.hidden
) w
join public.customers c on c.email like '%@example.com' and c.created_at < w.foc_date - interval '2 days'
join public.reservation_orders o on o.customer_id = c.id and o.kind = 'pull_list'
where w.rn <= 40 and abs(hashtext('wk' || c.id || w.id)) % 9 = 0
on conflict (order_id, item_id) do nothing;

-- 4. Lifecycle. Everything below follows from the dates, so a re-run on a later day moves the shop forward.
-- 4a. Titles not yet released (or this week's, when held) are not received; an ordered line past its cutoff stays ordered.
update public.reservations r set status = 'ordered', arrived_on = null, arrival_notified_at = null,
       updated_at = least(greatest(r.created_at, i.foc_date + time '16:00'), now())
from public.items i, demo_clock d
where i.id = r.item_id and not r.reorder and r.status in ('arrived', 'picked_up') and i.release_date >= d.hold_from;
update public.reservations r set status = 'open', arrived_on = null
from public.items i, demo_clock d
where i.id = r.item_id and not r.reorder and r.status = 'ordered' and i.foc_date > d.today;
update public.reservations r set status = 'ordered'
from public.items i, demo_clock d
where i.id = r.item_id and not r.reorder and r.status = 'open' and i.foc_date < d.today - 3;
update public.reservations set arrived_on = null where not reorder and status in ('open', 'ordered', 'reordered') and arrived_on is not null;
-- 4b. Ordered copies of released titles arrive on the release day; recent ones wait on the shelf, older ones were picked up.
update public.reservations r set
  status = case when d.today - i.release_date <= 6 then (case when abs(hashtext(r.id::text)) % 10 < 3 then 'picked_up' else 'arrived' end)
                when abs(hashtext(r.id::text)) % 20 = 0 then 'cancelled' else 'picked_up' end::public.reservation_status,
  arrived_on = case when abs(hashtext('a' || r.id)) % 4 = 0 then least(i.release_date + 1, d.today) else i.release_date end,
  updated_at = least(now(), (least(i.release_date + 1, d.today) + (abs(hashtext('u' || r.id)) % 6) * interval '1 day' + time '12:00') at time zone 'America/New_York'),
  updated_via = 'staff',
  updated_by = (select user_id from demo_staff where n = abs(hashtext('s' || r.id)) % greatest((select count(*) from demo_staff), 1))
from public.items i, demo_clock d
where i.id = r.item_id and not r.reorder and r.status in ('open', 'ordered', 'reordered') and i.release_date < d.hold_from and i.foc_date < d.today - 3;
-- 4c. Repairs: arrival dates inside [release, today]; lines don't predate their order.
update public.reservations r set arrived_on = greatest(i.release_date, least(coalesce(r.arrived_on, i.release_date), d.today))
from public.items i, demo_clock d
where i.id = r.item_id and not r.reorder and r.status in ('arrived', 'picked_up') and (r.arrived_on is null or r.arrived_on < i.release_date or r.arrived_on > d.today);
update public.reservations r set created_at = o.created_at
from public.reservation_orders o where o.id = r.order_id and r.created_at < o.created_at - interval '1 minute';
update public.reservations set updated_at = least(greatest(updated_at, created_at), now());


-- 4d. Re-orders (Titles > a trade or omnibus > Order a copy, and the Re-order tab): customers ask for a copy
-- of a title whose cutoff is long past; staff order it the next day and it arrives 3-4 days later. Only the demo's
-- own (source 'manual', @example.com) lines move; re-orders staff entered by hand are left alone.
create temp table ro_pick on commit drop as
select s.ts, c.id customer_id, i.id item_id, case when abs(hashtext('rq' || s.ts)) % 8 = 0 then 2 else 1 end qty
from (
  select (g::date + make_interval(hours => 10 + abs(hashtext('rh' || g::date || k)) % 9, mins => abs(hashtext('rm' || g::date || k)) % 60)) at time zone 'America/New_York' ts, g::date dy, k
  from demo_clock, generate_series(today - 44, today, interval '1 day') g, generate_series(1, 2) k
  where abs(hashtext('ro' || g::date || k)) % 5 < 2
) s
join lateral (select x.id, x.created_at from public.customers x where x.email like '%@example.com' and x.created_at < s.ts - interval '1 day'
              and nullif(trim(x.phone), '') is not null order by md5(x.id::text || s.ts) limit 1) c on true
join lateral (select y.id from public.items y join public.categories k on k.id = y.category_id
              where k.slug in ('trades', 'omnibuses') and not y.hidden and y.status <> 'pre_order' and y.cover_url is not null
                and y.release_date <= s.dy - 7 and (y.foc_date is null or y.foc_date <= s.dy) order by md5(y.id::text || s.ts) limit 1) i on true
where s.ts <= now()
  and not exists (select 1 from public.reservations r join public.reservation_orders o on o.id = r.order_id
                  where o.customer_id = c.id and r.item_id = i.id and r.status in ('open', 'ordered', 'reordered', 'arrived'));
create temp table ro_orders (id bigint, customer_id bigint, created_at timestamptz) on commit drop;
with ins as (
  insert into public.reservation_orders (name, phone, email, customer_id, kind, created_at)
  select c.name, c.phone, c.email, c.id, 'reorder', p.ts from ro_pick p join public.customers c on c.id = p.customer_id
  returning id, customer_id, created_at
)
insert into ro_orders select * from ins;
with ins as (
  insert into public.reservations (order_id, item_id, quantity, status, source, reorder, created_at, updated_at, updated_via)
  select o.id, p.item_id, p.qty, 'open', 'manual', true, o.created_at, o.created_at, 'customer'
  from ro_orders o join ro_pick p on p.customer_id = o.customer_id and p.ts = o.created_at
  returning id, order_id, item_id, created_at
)
insert into public.pull_list_log (customer_id, reservation_id, staff_user, action, detail, created_at)
select o.customer_id, i.id, null, 'added',
       'Re-order: ' || it.title || coalesce(' #' || it.issue_number, '') || coalesce(' · ' || it.variant, ''), i.created_at
from ins i join ro_orders o on o.id = i.order_id join public.items it on it.id = i.item_id;

create temp table ro_lines on commit drop as
select r.id from public.reservations r join public.reservation_orders o on o.id = r.order_id join public.customers c on c.id = o.customer_id
where r.reorder and r.source = 'manual' and c.email like '%@example.com';
update public.reservations r set status = 'ordered', updated_via = 'staff',
  updated_at = least(now(), ((r.created_at at time zone 'America/New_York')::date + 1 + time '11:00') at time zone 'America/New_York'),
  updated_by = (select user_id from demo_staff where n = abs(hashtext('rs' || r.id)) % greatest((select count(*) from demo_staff), 1))
from demo_clock d
where r.id in (select id from ro_lines) and r.status = 'open' and (r.created_at at time zone 'America/New_York')::date <= d.today - 1;
update public.reservations r set status = 'arrived', updated_via = 'staff',
  arrived_on = (r.created_at at time zone 'America/New_York')::date + 3 + abs(hashtext('ra' || r.id)) % 2,
  updated_at = least(now(), (((r.created_at at time zone 'America/New_York')::date + 3 + abs(hashtext('ra' || r.id)) % 2) + time '11:30') at time zone 'America/New_York'),
  updated_by = (select user_id from demo_staff where n = abs(hashtext('rs' || r.id)) % greatest((select count(*) from demo_staff), 1))
from demo_clock d
where r.id in (select id from ro_lines) and r.status = 'ordered' and (r.created_at at time zone 'America/New_York')::date + 4 <= d.today;
update public.reservations r set status = 'picked_up', updated_via = 'staff',
  updated_at = least(now(), greatest(r.updated_at, ((r.arrived_on + 1 + abs(hashtext('rp' || r.id)) % 4) + time '15:00') at time zone 'America/New_York'))
from demo_clock d
where r.id in (select id from ro_lines) and r.status = 'arrived' and r.arrived_on + 5 <= d.today;

-- 4f. Copies that arrived more than 6 days ago were collected (except the few 4e below leaves uncollected,
-- keep theirs, flagged by 4e): otherwise the pickup ladder would be warning half the shop.
update public.reservations r set status = 'picked_up', updated_via = 'staff',
  updated_at = least(now(), ((r.arrived_on + 1 + abs(hashtext('p4' || r.id)) % 5) + time '15:00') at time zone 'America/New_York'),
  updated_by = (select user_id from demo_staff where n = abs(hashtext('rs' || r.id)) % greatest((select count(*) from demo_staff), 1))
from public.reservation_orders o, demo_clock d
where o.id = r.order_id and not r.reorder and r.status = 'arrived' and r.arrived_on < d.today - 6 and r.pickup_reminders < 2;

-- 4e. Customers who stopped coming: some picked-up copies from 31-44 days ago were never collected, so they sit
-- past the 30-day hold (Dashboard > Trends > Customers Drifting Away), with both pickup reminders sent.
update public.reservations r set status = 'arrived', pickup_reminders = 2, updated_via = 'staff',
  updated_at = least(now(), ((r.arrived_on + 2) + time '12:00') at time zone 'America/New_York'),
  updated_by = (select user_id from demo_staff where n = abs(hashtext('rs' || r.id)) % greatest((select count(*) from demo_staff), 1))
from (
  select r2.id, o.customer_id, row_number() over (partition by o.customer_id order by r2.arrived_on, r2.id) rn
  from public.reservations r2
  join public.reservation_orders o on o.id = r2.order_id
  join public.customers c on c.id = o.customer_id and c.email like '%@example.com',
  demo_clock d, public.settings st
  where st.id = 1 and not r2.reorder and r2.status = 'picked_up' and r2.arrived_on between d.today - 44 and d.today - st.hold_days - 1
    and abs(hashtext('dr' || o.customer_id)) % 100 < 10
) pick, demo_clock d, public.settings st
where st.id = 1 and r.id = pick.id and pick.rn <= 2
  and (select count(*) from public.reservations x join public.reservation_orders ox on ox.id = x.order_id
       where ox.customer_id = pick.customer_id and x.status = 'arrived' and x.arrived_on < d.today - st.hold_days) < 2;
-- Reminders for anything waiting more than a week (the first goes out at a week, the second 2 days before the hold ends).
update public.reservations r set pickup_reminders = case when r.arrived_on >= d.today - (st.hold_days - 2) then 1 else 2 end
from demo_clock d, public.settings st
where st.id = 1 and r.status = 'arrived' and not r.reorder and r.arrived_on <= d.today - 7 and r.pickup_reminders = 0;

alter table public.reservations enable trigger reservations_stamp;

-- 5. Calendar: weekly recurring events (3+ occurrences on one weekday in the last 120 days) continue 5 weeks ahead.
insert into public.events (title, event_type, starts_at, ends_at, location, description, image_url, summary, signup_enabled, signup_capacity, location_id, series_id)
select e.title, e.event_type,
       ((e.starts_at at time zone 'America/New_York') + w.n * interval '7 days') at time zone 'America/New_York',
       case when e.ends_at is null then null else ((e.starts_at at time zone 'America/New_York') + w.n * interval '7 days') at time zone 'America/New_York' + (e.ends_at - e.starts_at) end,
       e.location, e.description, e.image_url, e.summary, e.signup_enabled, e.signup_capacity, e.location_id, coalesce(e.series_id, md5('series' || e.title)::uuid)
from (
  select distinct on (title) * from public.events
  where title in (select title from public.events where starts_at > now() - interval '120 days' and starts_at < now()
                  group by title having count(*) >= 3 and count(distinct extract(dow from starts_at at time zone 'America/New_York')) = 1)
  order by title, starts_at desc
) e
cross join generate_series(1, 5) w(n)
where ((e.starts_at at time zone 'America/New_York') + w.n * interval '7 days') at time zone 'America/New_York' <= now() + interval '35 days'
  and not exists (select 1 from public.events x where x.title = e.title
                  and (x.starts_at at time zone 'America/New_York')::date = ((e.starts_at at time zone 'America/New_York') + w.n * interval '7 days')::date);

-- 6. Sign-ups (confirmation emails are skipped: the user triggers are off), up to half an event's capacity.
insert into public.event_signups (event_id, name, email, phone, party_size, created_at)
select e.id, c.name, c.email, c.phone, 1 + (c.id % 3),
       greatest(c.created_at, least(e.starts_at - (1 + abs(hashtext('d' || e.id || c.id)) % 10) * interval '1 day', now() - interval '1 hour'))
from public.events e
join public.customers c on c.email like '%@example.com' and c.created_at < least(e.starts_at, now()) - interval '1 day'
where e.signup_enabled and abs(hashtext('s' || e.id || c.id)) % 6 = 0
  and (select count(*) from public.event_signups x where x.event_id = e.id) < coalesce(e.signup_capacity, 20) / 2
  and not exists (select 1 from public.event_signups x where x.event_id = e.id and x.email = c.email);
update public.event_signups s set created_at = least(c.created_at + interval '1 hour', now())
from public.customers c where c.email = s.email and s.created_at < c.created_at;
alter table public.event_signups enable trigger user;

-- 7. Email history: Monday pull-list sends, arrival notices for arrivals (only sent ones), welcome messages.
insert into public.email_log (kind, to_email, customer_id, subject, body, status, run_id, created_at)
select 'weekly', c.email, c.id, 'Your pull list this week', 'Weekly pull list summary.', 'sent', md5('weekly' || m.dy)::uuid,
       least((m.dy + time '10:00') at time zone 'America/New_York', now())
from (select g::date dy from demo_clock, generate_series(today - 49, today, interval '1 day') g where extract(dow from g) = 1) m
join public.customers c on c.email like '%@example.com' and c.id % 2 = 0 and c.created_at < (m.dy + time '10:00') at time zone 'America/New_York'
where (m.dy + time '10:00') at time zone 'America/New_York' <= now()
  and not exists (select 1 from public.email_log e where e.kind = 'weekly' and e.customer_id = c.id and (e.created_at at time zone 'America/New_York')::date = m.dy);
insert into public.email_log (kind, to_email, customer_id, subject, body, status, created_at)
select 'arrival', c.email, c.id, 'Your comics have arrived', 'Titles on your pull list arrived and are being held for you.', 'sent',
       least((r.arrived_on + time '10:05') at time zone 'America/New_York', now())
from public.reservations r
join public.reservation_orders o on o.id = r.order_id
join public.customers c on c.id = o.customer_id and c.email like '%@example.com'
where r.status in ('arrived', 'picked_up') and r.arrived_on >= (select today - 45 from demo_clock)
group by c.id, c.email, r.arrived_on
having not exists (select 1 from public.email_log e where e.customer_id = c.id and e.kind = 'arrival' and (e.created_at at time zone 'America/New_York')::date between r.arrived_on - 1 and r.arrived_on + 1);
delete from public.email_log e
where e.kind = 'arrival' and e.customer_id is not null
  and not exists (
    select 1 from public.reservations r join public.reservation_orders o on o.id = r.order_id
    where o.customer_id = e.customer_id and r.status in ('arrived', 'picked_up')
      and r.arrived_on between (e.created_at at time zone 'America/New_York')::date - 1 and (e.created_at at time zone 'America/New_York')::date + 1);
delete from public.email_log where status = 'failed';
insert into public.customer_messages (customer_id, to_email, subject, body, sent_by, created_at)
select c.id, c.email, 'Welcome to the shop!', 'Hi there, welcome! Your pull list is set up and we''ll hold each new issue for you.',
       (select s.name from public.staff s join demo_staff d on d.user_id = s.user_id where d.n = c.id % greatest((select count(*) from demo_staff), 1)),
       least(c.created_at + interval '2 hours', now())
from public.customers c join new_customers n on n.id = c.id;

-- 8. Survey answers, pull-list activity, QR scans and last-seen, spread over the days since they last ran.
insert into public.survey_responses (survey_id, answers, created_at)
select s.id, jsonb_build_object('visit', (array['Every week','A few times a month','Monthly'])[1 + abs(hashtext('v' || g.ts)) % 3], 'rating', 4 + abs(hashtext('r' || g.ts)) % 2,
  'likes', jsonb_build_array('New comics', (array['Back issues','Toys and Funko','Records'])[1 + abs(hashtext('k' || g.ts)) % 3]), 'pull', true,
  'better', (array['Love the Wednesday release parties!','Would like a bigger manga section','Staff helped me find the perfect gift'])[1 + abs(hashtext('b' || g.ts)) % 3]), g.ts
from public.surveys s
cross join lateral (
  select ts from (select (d + make_interval(hours => 10 + abs(hashtext('sh' || d)) % 9)) at time zone 'America/New_York' ts
                  from demo_clock, generate_series(today - 44, today, interval '1 day') d where abs(hashtext('sv' || d)) % 3 = 0 or d::date >= today - 1) q
  where ts <= now()
) g
where s.slug = 'customer-feedback' and not exists (select 1 from public.survey_responses r where r.survey_id = s.id and r.created_at::date = g.ts::date);

insert into public.pull_list_log (customer_id, reservation_id, staff_user, action, detail, created_at)
select c.id, null, case when c.id % 2 = 0 then (select user_id from demo_staff where n = c.id % greatest((select count(*) from demo_staff), 1)) end,
       (array['followed','quantity','unfollowed','followed'])[1 + c.id % 4],
       (array['series monstress','Saga: 1 → 2','Ultimate Spider-Man (2 not-yet-ordered titles removed)','series absolute batman'])[1 + c.id % 4],
       least(g.dy::timestamp at time zone 'America/New_York' + make_interval(hours => 10 + abs(hashtext('lh' || c.id || g.dy)) % 9), now())
from public.customers c
cross join lateral (select d::date dy from demo_clock, generate_series(today - 44, today, interval '1 day') d) g
where c.email like '%@example.com' and abs(hashtext('pl' || c.id || g.dy)) % 40 = 0
  and not exists (select 1 from public.pull_list_log l where l.customer_id = c.id and (l.created_at at time zone 'America/New_York')::date = g.dy);

update public.qr_codes set scan_count = scan_count + 4 + abs(hashtext(slug)) % 20, last_scan_at = now() - (abs(hashtext(slug)) % 20 || ' hours')::interval
where last_scan_at < now() - interval '2 days';
insert into public.pull_list_seen (customer_id, seen_at)
select c.id, now() - (abs(hashtext('sn' || c.id)) % 60 || ' hours')::interval from public.customers c where c.email like '%@example.com' and c.id % 4 <> 0
on conflict (customer_id) do update set seen_at = excluded.seen_at;

-- 9. Live chat (Admin > Chat): about one chat every three days, the last two days always; answered by staff within
-- minutes and closed, except today's, which is open and waiting. The push triggers are off so no device is pinged.
alter table public.chat_messages disable trigger chat_messages_push;
alter table public.chat_messages disable trigger chat_messages_reply_push;
create temp table chat_plan on commit drop as
select g::date dy, md5('chat' || g::date)::uuid token, 1 + abs(hashtext('ct' || g::date)) % 10 topic,
       least((g::date + make_interval(hours => 9 + abs(hashtext('chh' || g::date)) % 12, mins => abs(hashtext('chm' || g::date)) % 60)) at time zone 'America/New_York',
             now() - (case when g::date = d.today then interval '40 minutes' else interval '0' end)) ts,
       abs(hashtext('cc' || g::date)) % 2 = 0 as linked
from demo_clock d, generate_series(d.today - 44, d.today, interval '1 day') g
where abs(hashtext('ch' || g::date)) % 3 = 0 or g::date >= d.today - 1;
create temp table chat_new (id bigint, token uuid) on commit drop;
with ins as (
  insert into public.chat_conversations (visitor_token, name, email, customer_id, status, unread_staff, last_message_at, created_at)
  select p.token,
         coalesce(c.name, (array['Jordan P.','Alex M.','Sam R.','Taylor K.','Chris L.','Morgan D.','Riley S.','Casey B.'])[1 + abs(hashtext('cn' || p.dy)) % 8]),
         case when c.id is not null then c.email when abs(hashtext('ce' || p.dy)) % 2 = 0 then 'visitor' || abs(hashtext('cv' || p.dy)) % 900 || '@example.com' end,
         c.id, 'open', 0, p.ts, p.ts
  from chat_plan p
  left join lateral (select x.* from public.customers x where p.linked and x.email like '%@example.com' and x.created_at < p.ts - interval '1 hour'
                     order by md5(x.id::text || p.dy) limit 1) c on true
  where not exists (select 1 from public.chat_conversations v where v.visitor_token = p.token)
  returning id, visitor_token
)
insert into chat_new select * from ins;
insert into public.chat_messages (conversation_id, from_staff, body, sent_by, created_at)
select m.cid, m.from_staff, m.body, m.sent_by, m.ts
from (
  select n.id cid, false from_staff, null::text sent_by, p.ts,
    (array['Hi! Do you have Absolute Batman #1 in stock?','What time do you open on Wednesday for new comics?','Can I add a series to my pull list from my phone?','Is my order ready for pickup yet?','Do you buy used comics or trade paperbacks?','Will there be a sale around the holidays?','Can someone else pick up my comics for me?','Do you sell gift cards?','My pull list says a title is not ordered. Why?','Do you carry manga box sets?'])[p.topic] body
  from chat_new n join chat_plan p on p.token = n.token
  union all
  select n.id, true, (select s.name from public.staff s join demo_staff d on d.user_id = s.user_id where d.n = abs(hashtext('cs' || p.dy)) % greatest((select count(*) from demo_staff), 1)),
    p.ts + (3 + abs(hashtext('cd' || p.dy)) % 20) * interval '1 minute',
    (array['Hi! We have a few second printings behind the counter. Want us to set one aside under your name?','We open at 10am every Wednesday and the new releases are on the shelves by then.','Yes! Sign in, open a title and tap Add to my pull list. It follows every new issue.','Anything marked Ready on your pull list is on the hold shelf for 30 days.','We do! Bring them in any day before closing and we will make you an offer on the spot.','Yes, check the Calendar page for the sale dates and deals.','Sure, just have them give us your name and phone number at the counter.','We do, in any amount. Stop by or call and we will set one up.','That means the order cutoff has not passed yet. We place the order after the cutoff and it moves to Ordered.','We carry a good selection. Search the Titles page or tell us the series and we will check.'])[p.topic]
  from chat_new n join chat_plan p on p.token = n.token
  where p.ts + (3 + abs(hashtext('cd' || p.dy)) % 20) * interval '1 minute' < now() - interval '5 minutes'
  union all
  select n.id, false, null, p.ts + (3 + abs(hashtext('cd' || p.dy)) % 20 + 2) * interval '1 minute',
    (array['Thank you so much!','Perfect, thanks!','Great, see you soon.'])[1 + abs(hashtext('ck' || p.dy)) % 3]
  from chat_new n join chat_plan p on p.token = n.token
  where abs(hashtext('ct2' || p.dy)) % 5 < 3 and p.ts + (3 + abs(hashtext('cd' || p.dy)) % 20 + 2) * interval '1 minute' < now() - interval '3 minutes'
) m
order by m.ts, m.from_staff;
update public.chat_conversations set status = 'closed', unread_staff = 0
where id in (select id from chat_new) and created_at < now() - interval '30 hours';
alter table public.chat_messages enable trigger chat_messages_push;
alter table public.chat_messages enable trigger chat_messages_reply_push;

-- 10. What people search for (Dashboard, Analytics): 5-12 searches a day for the last 45 days. Some find nothing
-- (unmet demand) and some lead to a reservation. Days that already have searches are left alone.
insert into public.search_log (term, titles, searched_at, reserved)
select t.term, t.titles,
       least((s.dy + make_interval(hours => 9 + abs(hashtext('sh' || s.dy || s.k)) % 14, mins => abs(hashtext('sm' || s.dy || s.k)) % 60)) at time zone 'America/New_York', now()),
       case when t.titles > 0 and abs(hashtext('sr' || s.dy || s.k)) % 100 < 22 then 1 + abs(hashtext('sq' || s.dy || s.k)) % 3 else 0 end
from (select g::date dy, k from demo_clock d, generate_series(d.today - 44, d.today, interval '1 day') g,
        lateral generate_series(1, 5 + abs(hashtext('sn' || g::date)) % 8) k
      where not exists (select 1 from public.search_log l where (l.searched_at at time zone 'America/New_York')::date = g::date)) s
join (select row_number() over () rn, v.term, case when v.found then 1 + abs(hashtext(v.term)) % 14 else 0 end titles
      from (values ('absolute batman', true), ('one piece', true), ('spider-man', true), ('saga', true), ('x-men', true), ('invincible', true),
                   ('chainsaw man', true), ('dungeons and dragons', false), ('batman', true), ('funko pop', false), ('spawn', true),
                   ('magic the gathering', false), ('monstress', true), ('berserk', true), ('hellboy', true), ('omnibus', true),
                   ('jujutsu kaisen', true), ('sandman', true), ('gift card', false), ('walking dead', true), ('vinyl records', false),
                   ('star wars', true), ('ultimate spider-man', true), ('pokemon cards', false), ('dragon ball', true), ('blacksad', true)) v(term, found)) t
  on t.rn = 1 + (abs(hashtext('s1' || s.dy || s.k)) % 100) * (abs(hashtext('s2' || s.dy || s.k)) % 100) * 26 / 10000
where s.dy is not null;
delete from public.search_log where searched_at < now() - interval '90 days';

-- 11. Shelf re-orders staff placed (Re-order tab, Order for the shelf): about two a week, received 4-5 days later.
insert into public.stock_reorders (item_id, quantity, status, created_by, created_at, ordered_at, received_at)
select i.id, 2 + abs(hashtext('sq' || s.dy)) % 5,
       case when s.ts + interval '5 days' <= now() then 'received' when s.ts + interval '1 day' <= now() then 'ordered' else 'open' end,
       (select user_id from demo_staff where n = abs(hashtext('ss' || s.dy)) % greatest((select count(*) from demo_staff), 1)),
       s.ts,
       case when s.ts + interval '1 day' <= now() then s.ts + interval '1 day' end,
       case when s.ts + interval '5 days' <= now() then s.ts + interval '5 days' end
from (select g::date dy, least((g::date + make_interval(hours => 10 + abs(hashtext('s3' || g::date)) % 8)) at time zone 'America/New_York', now()) ts
      from demo_clock d, generate_series(d.today - 44, d.today, interval '1 day') g where abs(hashtext('sr' || g::date)) % 4 = 0) s
join lateral (select y.id from public.items y join public.categories k on k.id = y.category_id
              where k.slug in ('trades', 'omnibuses') and not y.hidden and y.status <> 'pre_order' and y.release_date <= s.dy - 14
                and (y.foc_date is null or y.foc_date <= s.dy) order by md5(y.id::text || s.dy) limit 1) i on true
where not exists (select 1 from public.stock_reorders x where (x.created_at at time zone 'America/New_York')::date = s.dy);

-- 12. Stock alerts ("tell me when it's back"), app users, staff notes on customers.
insert into public.stock_alerts (customer_id, item_id, created_at)
select c.id, i.id, least(greatest(c.created_at, now() - (1 + abs(hashtext('al' || c.id || i.id)) % 40) * interval '1 day'), now())
from public.customers c
join lateral (select y.id from public.items y where y.status in ('sold_out', 'backorder', 'coming_soon') and not y.hidden and y.cover_url is not null
              order by md5(y.id::text || c.id) limit 2) i on true
where c.email like '%@example.com' and abs(hashtext('sa' || c.id)) % 100 < 30
on conflict (customer_id, item_id) do nothing;

insert into public.app_visits (customer_id, first_seen_at, last_seen_at)
select c.id, greatest(c.created_at, least(c.created_at + (abs(hashtext('fv' || c.id)) % 72) * interval '1 hour', now() - interval '2 hours')), now()
from public.customers c
where c.email like '%@example.com' and abs(hashtext('av' || c.id)) % 100 < 65
on conflict (customer_id) do nothing;
update public.app_visits v set last_seen_at = least(now(), greatest(v.first_seen_at, now() - (abs(hashtext('lv' || v.customer_id || (select today from demo_clock))) % 240) * interval '1 hour'))
where v.customer_id in (select id from public.customers where email like '%@example.com');

insert into public.customer_notes (customer_id, notes, updated_at, updated_by)
select c.id, (array['Prefers variant covers when we have them.','Collects Batman and Spider-Man; usually picks up on Wednesdays.','A friend picks up for them; the friend knows the name.','Asked us to call when new manga volumes arrive.','Gifts comics to a nephew; likes all-ages titles.','Wants to hear about signings before the newsletter goes out.'])[1 + abs(hashtext('nn' || c.id)) % 6],
       least(greatest(c.created_at, now() - (abs(hashtext('nd' || c.id)) % 30) * interval '1 day'), now()),
       (select user_id from demo_staff where n = abs(hashtext('nu' || c.id)) % greatest((select count(*) from demo_staff), 1))
from public.customers c
where c.email like '%@example.com' and abs(hashtext('nt' || c.id)) % 9 = 0
  and not exists (select 1 from public.customer_notes n where n.customer_id = c.id);

-- 13. New-response badges: answers and sign-ups from the last 3 days are unread; older ones were seen. Chat on, email colors set.
update public.survey_responses set seen = true where not seen and created_at < now() - interval '3 days';
update public.event_signups set seen = true where not seen and created_at < now() - interval '3 days';
update public.settings set chat_enabled = true, chat_available = true,
  chat_greeting = coalesce(chat_greeting, 'Hi! Ask us about your pull list, new releases or store hours.'),
  email_page_color = coalesce(email_page_color, '#f4f1fa'), email_body_color = coalesce(email_body_color, '#ffffff')
where id = 1;

-- 14. Pickup reliability (Admin > Customers > Unclaimed, the customer lookup, Shop Settings > Pickup). The ladder's clock
-- starts 60 days back so there is history. Customers who never collect are warned and paused exactly as the hourly
-- ladder would have done, with the notices marked sent, so the ladder finds nothing left to email and no demo address
-- is mailed. A couple of customers are on a monthly rhythm, one is exempt, and two were paused by hand.
update public.trust_settings set reliability_started_at = least(reliability_started_at, (select today - 60 from demo_clock)) where id = 1;
alter table public.customer_standing disable trigger customer_standing_log_changes;
insert into public.customer_standing (customer_id, account_state, pickup_cadence)
select c.id, 'proven', case when c.ship_arrivals then 'exempt' else 'weekly' end from public.customers c
on conflict (customer_id) do nothing;
create temp table cadence_picks on commit drop as
select st.customer_id, case when abs(hashtext('cx' || st.customer_id)) % 100 < 4 then 'exempt' else 'monthly' end as to_cadence,
       (select s.name from public.staff s join demo_staff d on d.user_id = s.user_id where d.n = abs(hashtext('cs' || st.customer_id)) % greatest((select count(*) from demo_staff), 1)) staff_name,
       (select user_id from demo_staff where n = abs(hashtext('cs' || st.customer_id)) % greatest((select count(*) from demo_staff), 1)) staff_user
from public.customer_standing st join public.customers c on c.id = st.customer_id
where c.email like '%@example.com' and st.pickup_cadence = 'weekly' and abs(hashtext('cm' || st.customer_id)) % 100 < 14;
insert into public.customer_standing_log (customer_id, field, from_value, to_value, reason, user_id, staff_name, created_at)
select customer_id, 'pickup_cadence', 'weekly', to_cadence, case to_cadence when 'monthly' then 'Customer only comes in once a month.' else 'Ships to the customer; no pickups.' end, staff_user, staff_name,
       now() - (1 + abs(hashtext('cl' || customer_id)) % 40) * interval '1 day'
from cadence_picks;
update public.customer_standing st set pickup_cadence = p.to_cadence from cadence_picks p where p.customer_id = st.customer_id;

-- A customer who collects the old books is resumed automatically; a pause ends with the books, and so does the warning.
with resumed as (
  update public.customer_standing st set paused_at = null, paused_reason = null, paused_by = null, pause_sent_at = null
  where st.paused_reason = 'auto' and not exists (
    select 1 from public.customer_unclaimed u cross join lateral public.pickup_ladder_dates(u.oldest_received_on, st.pickup_cadence) d
    where u.customer_id = st.customer_id and d.pause_on is not null and (select today from demo_clock) >= d.pause_on)
  returning st.customer_id
)
insert into public.customer_standing_log (customer_id, field, from_value, to_value, reason, created_at)
select customer_id, 'paused', 'paused (auto)', 'active', 'Picked up their books; the pause ended on its own.', now() from resumed;

update public.customer_standing st set warning_sent_at = null
where st.paused_at is null and st.warning_sent_at is not null and not exists (
  select 1 from public.customer_unclaimed u cross join lateral public.pickup_ladder_dates(u.oldest_received_on, st.pickup_cadence) d
  where u.customer_id = st.customer_id and d.warning_on is not null and (select today from demo_clock) >= d.warning_on);
create temp table ladder on commit drop as
select u.customer_id, st.pickup_cadence, u.unclaimed_count, u.unclaimed_cents, u.oldest_received_on, d.warning_on, d.pause_on,
       (select today from demo_clock) as today
from public.customer_unclaimed u
join public.customer_standing st on st.customer_id = u.customer_id and st.pickup_cadence <> 'exempt'
join public.customers c on c.id = u.customer_id and c.email like '%@example.com'
cross join lateral public.pickup_ladder_dates(u.oldest_received_on, st.pickup_cadence) d;
insert into public.pickup_notices (customer_id, stage, status, unclaimed_count, unclaimed_cents, oldest_received_on, pause_on, created_at, sent_at)
select l.customer_id, 'warning', 'sent', l.unclaimed_count, l.unclaimed_cents, l.oldest_received_on, l.pause_on,
       (l.warning_on + time '10:00') at time zone 'America/New_York', (l.warning_on + time '10:00') at time zone 'America/New_York'
from ladder l
where l.today >= l.warning_on and (l.warning_on + time '10:00') at time zone 'America/New_York' <= now()
  and not exists (select 1 from public.pickup_notices n where n.customer_id = l.customer_id and n.stage = 'warning' and n.oldest_received_on = l.oldest_received_on);
insert into public.pickup_notices (customer_id, stage, status, unclaimed_count, unclaimed_cents, oldest_received_on, created_at, sent_at)
select l.customer_id, 'pause', 'sent', l.unclaimed_count, l.unclaimed_cents, l.oldest_received_on,
       (l.pause_on + time '10:00') at time zone 'America/New_York', (l.pause_on + time '10:00') at time zone 'America/New_York'
from ladder l
where l.today >= l.pause_on and (l.pause_on + time '10:00') at time zone 'America/New_York' <= now()
  and not exists (select 1 from public.pickup_notices n where n.customer_id = l.customer_id and n.stage = 'pause' and n.oldest_received_on = l.oldest_received_on);
insert into public.customer_standing_log (customer_id, field, from_value, to_value, reason, created_at)
select l.customer_id, 'paused', 'active', 'paused (auto)', format('Books waiting since %s (%s unclaimed)', to_char(l.oldest_received_on, 'Mon FMDD'), l.unclaimed_count),
       (l.pause_on + time '10:00') at time zone 'America/New_York'
from ladder l join public.customer_standing st on st.customer_id = l.customer_id
where l.today >= l.pause_on and st.paused_at is null and (l.pause_on + time '10:00') at time zone 'America/New_York' <= now();
update public.customer_standing st set
  warning_sent_at = coalesce(st.warning_sent_at, (l.warning_on + time '10:00') at time zone 'America/New_York'),
  paused_at = case when l.today >= l.pause_on then (l.pause_on + time '10:00') at time zone 'America/New_York' else st.paused_at end,
  paused_reason = case when l.today >= l.pause_on then 'auto' else st.paused_reason end,
  pause_sent_at = case when l.today >= l.pause_on then (l.pause_on + time '10:00') at time zone 'America/New_York' else st.pause_sent_at end
from ladder l
where l.customer_id = st.customer_id and l.today >= l.warning_on and st.paused_at is null and (l.warning_on + time '10:00') at time zone 'America/New_York' <= now();

-- Two customers staff paused by hand (a lost phone number; moved away).
with pick as (
  select c.id, row_number() over (order by md5(c.id::text)) rn,
         (select user_id from demo_staff where n = abs(hashtext('pm' || c.id)) % greatest((select count(*) from demo_staff), 1)) staff_user,
         (select s.name from public.staff s join demo_staff d on d.user_id = s.user_id where d.n = abs(hashtext('pm' || c.id)) % greatest((select count(*) from demo_staff), 1)) staff_name
  from public.customers c join public.customer_standing st on st.customer_id = c.id
  where c.email like '%@example.com' and st.paused_at is null and st.pickup_cadence <> 'exempt'
    and not exists (select 1 from public.customer_unclaimed u where u.customer_id = c.id)
), todo as (
  select * from pick where rn <= 2 - (select count(*) from public.customer_standing where paused_reason = 'manual')
), upd as (
  update public.customer_standing st set paused_at = now() - (6 + t.rn * 3) * interval '1 day', paused_reason = 'manual', paused_by = t.staff_user
  from todo t where t.id = st.customer_id returning st.customer_id, t.staff_user, t.staff_name, st.paused_at
)
insert into public.customer_standing_log (customer_id, field, from_value, to_value, reason, user_id, staff_name, created_at)
select customer_id, 'paused', 'active', 'paused (manual)', 'Phone number no longer works; holding the list until they check in.', staff_user, staff_name, paused_at from upd;
alter table public.customer_standing enable trigger customer_standing_log_changes;

-- Nothing for the demo to email: drop queued or failed notices (the ladder has already marked them sent above).
delete from public.pickup_notices where status in ('queued', 'sending', 'failed');
-- Guest orders are approved once they are two days old; the newest wait in Admin's approval queue.
insert into public.guest_order_approvals (order_id, approved_at)
select o.id, o.created_at + interval '1 day' from public.reservation_orders o
where o.customer_id is null and o.created_at < now() - interval '2 days'
  and not exists (select 1 from public.guest_order_approvals a where a.order_id = o.id)
on conflict (order_id) do nothing;
-- Weekly events share a series id, like repeating events made in Admin.
update public.events e set series_id = md5('series' || e.title)::uuid
where e.series_id is null and e.title in (select title from public.events where starts_at > now() - interval '120 days'
                                           group by title having count(*) >= 3 and count(distinct extract(dow from starts_at at time zone 'America/New_York')) = 1);
-- Holiday hours (Shop Settings > Shop; on the website's footer): the next holidays, replacing dates that have passed.
update public.settings st set holiday_hours = (
  select coalesce(jsonb_agg(h.j order by h.d), '[]'::jsonb) from (
    select v.d, jsonb_build_object('date', v.d, 'label', v.label, 'closed', v.closed, 'open', v.o, 'close', v.c) j
    from demo_clock dc cross join lateral (values
      (make_date(extract(year from dc.today)::int, 11, 1) + ((4 - extract(dow from make_date(extract(year from dc.today)::int, 11, 1))::int + 7) % 7) + 21, 'Thanksgiving', true, '11:00', '16:00'),
      (make_date(extract(year from dc.today)::int, 11, 1) + ((4 - extract(dow from make_date(extract(year from dc.today)::int, 11, 1))::int + 7) % 7) + 22, 'Black Friday', false, '09:00', '21:00'),
      (make_date(extract(year from dc.today)::int, 12, 24), 'Christmas Eve', false, '10:00', '15:00'),
      (make_date(extract(year from dc.today)::int, 12, 25), 'Christmas Day', true, '11:00', '16:00'),
      (make_date(extract(year from dc.today)::int, 12, 31), 'New Year''s Eve', false, '10:00', '16:00'),
      (make_date(extract(year from dc.today)::int + 1, 1, 1), 'New Year''s Day', true, '11:00', '16:00')
    ) v(d, label, closed, o, c)
    where v.d >= dc.today and v.d <= dc.today + 120
  ) h
) where id = 1 and not exists (select 1 from jsonb_array_elements(st.holiday_hours) e where (e ->> 'date')::date >= (select today from demo_clock));

commit;
