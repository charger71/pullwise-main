-- Analytics: what customers want and how the customer base grows. Totals only, worked out in the database.
-- Each function runs as the caller, so the staff policies on these tables decide who gets rows.

-- The most-followed series, with the copies of each issue those follows ask for and the follows added lately.
-- Unfollowing deletes the row, so follows lost can't be shown.
create or replace function public.analytics_series_demand(p_days int default 90)
returns table (label text, followers int, copies int, new_followers int)
language sql stable set search_path = public
as $$
  select (array_agg(s.label order by s.created_at desc))[1],
         count(*)::int,
         sum(s.quantity)::int,
         (count(*) filter (where s.created_at > now() - make_interval(days => p_days)))::int
  from public.subscriptions s
  where s.kind = 'series'
  group by s.key
  order by 2 desc, 3 desc, 1
  limit 50;
$$;
revoke execute on function public.analytics_series_demand(int) from public, anon;
grant execute on function public.analytics_series_demand(int) to authenticated;

-- What similar spellings of a publisher have in common, for adding them up: "Marvel", "MARVEL" and "Marvel Comics" all
-- give "marvel". Ignores case, punctuation, a leading "The" and business words at the end of the name, but never a
-- name's first word, so "Press" alone stays "press".
create or replace function public.publisher_group(p_name text)
returns text
language sql immutable set search_path = public
as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        btrim(regexp_replace(regexp_replace(replace(lower(p_name), '&', ' and '), '[''’.]', '', 'g'), '[^[:alnum:]]+', ' ', 'g')),
        '^the ', ''),
      '( (comics?|publishing|publishers?|publications?|entertainment|studios?|press|books?|media|universe|group|company|co|inc|llc|ltd))+$', ''),
    '');
$$;
revoke execute on function public.publisher_group(text) from public, anon;
grant execute on function public.publisher_group(text) to authenticated;

-- The parent publisher for imprints in the catalog ("Dark Horse Manga", "IDW Crime", "Random House Graphic"), given
-- what publisher_group() returned; null for anyone else. Add a line here when a new family of imprints shows up.
create or replace function public.publisher_family(p_group text)
returns text
language sql immutable set search_path = public
as $$
  select case
    when p_group ~ '^dark horse\y' then 'Dark Horse'
    when p_group ~ '^dc\y' then 'DC'
    when p_group ~ '^idw\y' then 'IDW'
    when p_group ~ '^titan\y' then 'Titan'
    when p_group ~ '^tokyopop\y' then 'TOKYOPOP'
    when p_group ~ '^(ka)?boom\y' then 'BOOM!'
    when p_group ~ '^(random house|rh)\y' then 'Random House'
    when p_group ~ '^penguin\y' then 'Penguin'
    when p_group ~ '^disney\y' then 'Disney'
    when p_group ~ '^dk\y' then 'DK'
    when p_group ~ '^ten speed\y' then 'Ten Speed'
    when p_group ~ '^square enix\y' then 'Square Enix'
    when p_group ~ '^fantagraphics\y' then 'Fantagraphics'
    when p_group ~ '\ywattpad\y' then 'Wattpad'
  end;
$$;
revoke execute on function public.publisher_family(text) from public, anon;
grant execute on function public.publisher_family(text) to authenticated;

-- Copies on reservations still in progress, by publisher, most first. Imprints count under their parent, and similar
-- spellings count as one publisher, shown under the shortest spelling.
create or replace function public.analytics_publisher_demand()
returns table (publisher text, copies int)
language sql stable set search_path = public
as $$
  select coalesce(max(f.family), (array_agg(n.spelling order by length(n.spelling), n.spelling = upper(n.spelling), n.spelling) filter (where n.grp is not null))[1], 'No publisher listed'),
         sum(r.quantity)::int
  from public.reservations r
  join public.items i on i.id = r.item_id
  cross join lateral (select btrim(i.publisher) as spelling, public.publisher_group(i.publisher) as grp) n
  cross join lateral (select public.publisher_family(n.grp) as family) f
  where r.status in ('open', 'ordered', 'reordered', 'arrived')
  group by coalesce(lower(f.family), n.grp)
  having sum(r.quantity) > 0
  order by 2 desc, 1;
$$;
revoke execute on function public.analytics_publisher_demand() from public, anon;
grant execute on function public.analytics_publisher_demand() to authenticated;

-- Words people searched for lately that found no titles the last time. Upper and lower case count as the same search.
create or replace function public.search_log_no_results(p_days int default 90)
returns table (term text, times int, last_at timestamptz)
language sql stable set search_path = public
as $$
  select t.term, t.times, t.last_at
  from (
    select (array_agg(l.term order by l.searched_at desc))[1] as term,
           count(*)::int as times,
           (array_agg(l.titles order by l.searched_at desc))[1] as titles,
           max(l.searched_at) as last_at
    from public.search_log l
    where l.searched_at > now() - make_interval(days => p_days)
    group by lower(l.term)
  ) t
  where t.titles = 0
  order by t.times desc, t.last_at desc
  limit 50;
$$;
revoke execute on function public.search_log_no_results(int) from public, anon;
grant execute on function public.search_log_no_results(int) to authenticated;

-- Titles customers are waiting on now. An alert is removed once the customer has been told the title is in.
create or replace function public.analytics_stock_alert_titles()
returns table (id bigint, title text, issue_number text, variant text, waiting int, last_at timestamptz)
language sql stable set search_path = public
as $$
  select i.id, i.title, i.issue_number, i.variant, count(*)::int, max(a.created_at)
  from public.stock_alerts a
  join public.items i on i.id = a.item_id
  group by i.id
  order by 5 desc, 6 desc
  limit 50;
$$;
revoke execute on function public.analytics_stock_alert_titles() from public, anon;
grant execute on function public.analytics_stock_alert_titles() to authenticated;

-- For each of the last p_months calendar months in the shop's time zone, this month included: customers added (signed
-- up, or added by staff), and orders from customers versus guests. Months with nothing are listed with zeros.
create or replace function public.analytics_customer_growth(p_months int default 12)
returns table (month date, new_customers int, customer_orders int, guest_orders int)
language sql stable set search_path = public
as $$
  with shop as (
    select s.timezone as zone, date_trunc('month', public.shop_today()::timestamp) as this_month
    from public.settings s
    where s.id = 1
  ),
  months as (
    select (z.this_month - make_interval(months => n))::date as first_day
    from shop z
    cross join generate_series(0, p_months - 1) as n
  ),
  joined as (
    select date_trunc('month', c.created_at at time zone z.zone)::date as first_day, count(*)::int as n
    from public.customers c
    cross join shop z
    where c.created_at >= now() - make_interval(months => p_months + 1)
    group by 1
  ),
  placed as (
    select date_trunc('month', o.created_at at time zone z.zone)::date as first_day,
           (count(*) filter (where o.customer_id is not null))::int as customer_orders,
           (count(*) filter (where o.customer_id is null))::int as guest_orders
    from public.reservation_orders o
    cross join shop z
    where o.created_at >= now() - make_interval(months => p_months + 1)
    group by 1
  )
  select m.first_day, coalesce(j.n, 0), coalesce(p.customer_orders, 0), coalesce(p.guest_orders, 0)
  from months m
  left join joined j on j.first_day = m.first_day
  left join placed p on p.first_day = m.first_day
  order by m.first_day desc;
$$;
revoke execute on function public.analytics_customer_growth(int) from public, anon;
grant execute on function public.analytics_customer_growth(int) to authenticated;
