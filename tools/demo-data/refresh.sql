-- Brings the demo shop's data up to today. Additive and idempotent: it only adds what is missing since the last
-- run and then puts every line back in a state that is possible on today's date. Run it with tools/demo-data.mjs.
--
-- Rules the data follows (tools/demo-data/check.sql tests every one):
--   * a copy can't be ordered before its title's cutoff (FOC) and is ordered once the cutoff has passed
--   * a copy can't arrive or be picked up before its release date, or after today (shop time)
--   * open and ordered copies have no arrival date; arrived and picked-up copies always do
--   * a line never predates its order, nothing is dated in the future, no email failed
--   * this week's titles are ordered and waiting to be received (Admin > Ordering > Received)
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
select distinct on (o.id, i.id) o.id, i.id, 1, 'open', 'series', c.created_at + interval '5 minutes', c.created_at + interval '5 minutes', 'system'
from public.customers c
join new_customers n on n.id = c.id
join public.subscriptions s on s.customer_id = c.id
join public.reservation_orders o on o.customer_id = c.id and o.kind = 'pull_list'
join lateral (select id from public.items, demo_clock where series_key = s.key and status = 'pre_order' and cover_url is not null and foc_date > today order by release_date, id limit 3) i on true
on conflict (order_id, item_id) do nothing;

-- Titles of the followed series that released after the customer joined (cutoff still ahead of the join date):
-- their copies get picked up or cancelled by the lifecycle below.
insert into public.reservations (order_id, item_id, quantity, status, source, created_at, updated_at, updated_via)
select distinct on (o.id, i.id) o.id, i.id, 1, 'open', 'series', c.created_at + interval '5 minutes', c.created_at + interval '5 minutes', 'system'
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
  select g.dy, k, (g.dy + make_interval(hours => 9 + abs(hashtext(g.dy::text || k)) % 11, mins => abs(hashtext('m' || g.dy::text || k)) % 60)) at time zone 'America/New_York' as ts
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
where i.id = r.item_id and r.status in ('arrived', 'picked_up') and i.release_date >= d.hold_from;
update public.reservations r set status = 'open', arrived_on = null
from public.items i, demo_clock d
where i.id = r.item_id and r.status = 'ordered' and i.foc_date > d.today;
update public.reservations r set status = 'ordered'
from public.items i, demo_clock d
where i.id = r.item_id and r.status = 'open' and i.foc_date < d.today - 3;
update public.reservations set arrived_on = null where status in ('open', 'ordered', 'reordered') and arrived_on is not null;
-- 4b. Ordered copies of released titles arrive on the release day; recent ones wait on the shelf, older ones were picked up.
update public.reservations r set
  status = case when d.today - i.release_date <= 6 then (case when abs(hashtext(r.id::text)) % 10 < 3 then 'picked_up' else 'arrived' end)
                when abs(hashtext(r.id::text)) % 20 = 0 then 'cancelled' else 'picked_up' end::public.reservation_status,
  arrived_on = case when abs(hashtext('a' || r.id)) % 4 = 0 then least(i.release_date + 1, d.today) else i.release_date end,
  updated_at = least(now(), (least(i.release_date + 1, d.today) + (abs(hashtext('u' || r.id)) % 6) * interval '1 day' + time '12:00') at time zone 'America/New_York'),
  updated_via = 'staff',
  updated_by = (select user_id from demo_staff where n = abs(hashtext('s' || r.id)) % greatest((select count(*) from demo_staff), 1))
from public.items i, demo_clock d
where i.id = r.item_id and r.status in ('open', 'ordered', 'reordered') and i.release_date < d.hold_from and i.foc_date < d.today - 3;
-- 4c. Repairs: arrival dates inside [release, today]; lines don't predate their order.
update public.reservations r set arrived_on = greatest(i.release_date, least(coalesce(r.arrived_on, i.release_date), d.today))
from public.items i, demo_clock d
where i.id = r.item_id and r.status in ('arrived', 'picked_up') and (r.arrived_on is null or r.arrived_on < i.release_date or r.arrived_on > d.today);
update public.reservations r set created_at = o.created_at
from public.reservation_orders o where o.id = r.order_id and r.created_at < o.created_at - interval '1 minute';
update public.reservations set updated_at = least(greatest(updated_at, created_at), now());

alter table public.reservations enable trigger reservations_stamp;

-- 5. Calendar: weekly recurring events (3+ occurrences on one weekday in the last 120 days) continue 5 weeks ahead.
insert into public.events (title, event_type, starts_at, ends_at, location, description, image_url, summary, signup_enabled, signup_capacity, location_id)
select e.title, e.event_type,
       ((e.starts_at at time zone 'America/New_York') + w.n * interval '7 days') at time zone 'America/New_York',
       case when e.ends_at is null then null else ((e.starts_at at time zone 'America/New_York') + w.n * interval '7 days') at time zone 'America/New_York' + (e.ends_at - e.starts_at) end,
       e.location, e.description, e.image_url, e.summary, e.signup_enabled, e.signup_capacity, e.location_id
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
                  from demo_clock, generate_series(today - 44, today, interval '1 day') d where abs(hashtext('sv' || d)) % 3 = 0) q
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

commit;
