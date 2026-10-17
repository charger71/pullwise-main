-- Customer site audit fixes. Three parts, each with its own numbered sections:
--  A. Catalog and search: filter lists from one query each, faster series search, events in progress stay upcoming,
--     most-reserved list capped.
--  B. Public forms: one trustworthy client IP and a shared rate-limit table (no more bypass with a junk
--     X-Forwarded-For), per-event / per-survey / overall caps, length limits, We Buy Comics rate limit, anonymous
--     survey answers, de-duplicated drawing entries, QR scans counted once per visitor per hour.
--  C. Pull list: re-following keeps copies, "Not ordered" titles can be added again and don't count, a customer's
--     phone no longer reveals other people's reservations.

-- ===============================================================================================================
-- Part A: Catalog and search
-- ===============================================================================================================
-- Catalog pages (customer site).
--  1. New Arrivals and Pre-Orders built their Publisher and Order cutoff filters by paging through every matching
--     title's publisher / FOC date 1000 rows at a time, one request after another. catalog_publishers() and
--     catalog_foc_dates() return just the distinct values in one call.
--  6. Series search squashed every title on each keystroke with no index to help. Titles (and series catalog titles)
--     now keep their squashed form in a stored column with a trigram index, and search_series() uses it. Same results.
--  8. top_reserved_items() let anyone list up to 50 of the most-reserved titles; the site only shows a Top 10, so
--     that's now the most it returns.

-- A1 ------------------------------------------------------------------------------------------------------------------
-- Rows rather than bare values, so the JSON is { publisher } / { foc_date } whatever the PostgREST version.
-- Security invoker, so row-level security still decides what the caller can see; `not hidden` keeps the public
-- pages showing what customers see when staff (or a customer with a hidden title on their list) are signed in.
create or replace function public.catalog_publishers(p_statuses public.item_status[])
returns table (publisher text)
language sql stable security invoker set search_path = public
as $$
  select distinct i.publisher from public.items i
  where not i.hidden and i.status = any (p_statuses) and i.publisher is not null
  order by 1;
$$;
revoke execute on function public.catalog_publishers(public.item_status[]) from public;
grant execute on function public.catalog_publishers(public.item_status[]) to anon, authenticated;

-- Distinct order cutoffs (ascending) of visible titles with these statuses, on or after p_from.
create or replace function public.catalog_foc_dates(p_statuses public.item_status[], p_from date)
returns table (foc_date date)
language sql stable security invoker set search_path = public
as $$
  select distinct i.foc_date from public.items i
  where not i.hidden and i.status = any (p_statuses) and i.foc_date >= p_from
  order by 1;
$$;
revoke execute on function public.catalog_foc_dates(public.item_status[], date) from public;
grant execute on function public.catalog_foc_dates(public.item_status[], date) to anon, authenticated;

-- A6 ------------------------------------------------------------------------------------------------------------------
-- _squash() is immutable, so it can feed a stored generated column.
alter table public.items add column title_squash text generated always as (public._squash(title)) stored;
create index items_title_squash_trgm_idx on public.items using gin (title_squash gin_trgm_ops);
alter table public.series_catalog add column title_squash text generated always as (public._squash(title)) stored;
create index series_catalog_title_squash_trgm_idx on public.series_catalog using gin (title_squash gin_trgm_ops);

-- The new columns are bookkeeping, like search_norm: leave them out of the activity log.
create or replace function public._audit_diff(o jsonb, n jsonb, k text, names_only boolean)
returns jsonb
language plpgsql immutable
as $$
declare
  v_changed jsonb;
begin
  select jsonb_object_agg(e.key, case when names_only then 'true'::jsonb
                                      else jsonb_build_object('from', public._audit_cell(o -> e.key), 'to', public._audit_cell(e.value)) end)
  into v_changed
  from jsonb_each(n) e
  where e.key <> all (array['updated_at', 'series_key', 'search_norm', 'arrival_rank', 'title_squash']) and (o -> e.key) is distinct from e.value;
  if v_changed is null then return null; end if;
  return public._audit_label(n, k) || jsonb_build_object('changed', v_changed);
end;
$$;

-- As in 20270107000000_search_audit_fixes.sql, with the stored column in place of _squash(title). The extra
-- `like` on the longest word (already one of the words every title must contain, so results don't change) is
-- what lets the trigram index narrow the titles down first.
create or replace function public.search_series(p_q text)
returns table (key text, label text, issues bigint, cover_url text)
language sql stable set search_path = public
as $$
  with q as (
    select coalesce(nullif(array(select t from unnest(public._search_tokens(p_q)) t where t !~ '^[0-9]+$'), '{}'), public._search_tokens(p_q)) as toks,
           length(public._squash(p_q)) as n
  ),
  longest as (select '%' || t || '%' as pat from q, unnest(q.toks) t order by length(t) desc, t limit 1),
  s as (
    select i.series_key as k, (array_agg(i.title order by length(i.title), i.created_at desc))[1] as l, count(distinct i.issue_number) as n
    from public.items i
    left join public.categories cat on cat.id = i.category_id, q
    where i.issue_number is not null and i.series_key is not null and not i.hidden
      and coalesce(cat.slug, 'comics') in ('comics', 'trades', 'omnibuses')
      and q.n >= 2 and cardinality(q.toks) > 0
      and i.title_squash like (select pat from longest)
      and not exists (select 1 from unnest(q.toks) t where i.title_squash not like '%' || t || '%')
    group by i.series_key
  ),
  c as (
    select sc.key as k, sc.title as l, 0::bigint as n
    from public.series_catalog sc, q
    where q.n >= 2 and cardinality(q.toks) > 0
      and sc.title_squash like (select pat from longest)
      and not exists (select 1 from unnest(q.toks) t where sc.title_squash not like '%' || t || '%')
      and not exists (select 1 from s where s.k = sc.key)
  ),
  top as (select * from (select * from s union all select * from c) u order by u.n desc, u.l limit 20)
  -- The series' own cover, else the main cover of its newest issue.
  select t.k, t.l, t.n,
         coalesce(sc.cover_url,
                  (select i.cover_url from public.items i
                   where i.series_key = t.k and not i.hidden and i.cover_url is not null
                   order by i.release_date desc nulls last, (i.variant is null) desc, i.id desc limit 1))
  from top t
  left join public.series_catalog sc on sc.key = t.k
  order by t.n desc, t.l;
$$;

-- A8 ------------------------------------------------------------------------------------------------------------------
-- At most ten: the Top 10 badge is all the site (home page, catalog cards, title popup) asks for.
create or replace function public.top_reserved_items(p_limit int default 10)
returns table (item_id bigint)
language sql stable security definer set search_path = public
as $$
  select r.item_id
  from public.reservations r
  join public.items i on i.id = r.item_id and not i.hidden
  where r.status in ('open', 'ordered', 'reordered', 'arrived')
  group by r.item_id, i.title, i.issue_number
  having sum(r.quantity) > 0
  order by sum(r.quantity) desc, i.title, i.issue_number nulls first, r.item_id
  limit least(greatest(coalesce(p_limit, 10), 1), 10);
$$;

-- ===============================================================================================================
-- Part B: Public forms, surveys, QR scans
-- ===============================================================================================================
-- Customer site audit, public forms (package S3).

-- B1 ------------------------------------------------------------------------------------------------------------------
-- Rate limits on the public forms (event signups, surveys, guest pre-orders, the We Buy Comics form and QR scans).
-- They used to read the FIRST x-forwarded-for entry, which the visitor can write themselves, and skipped the limit
-- altogether when it didn't parse, so a junk header turned the limit off. Now:
--  * _client_ip() picks the most trustworthy address available. Supabase sits behind Cloudflare, which always
--    overwrites cf-connecting-ip with the address it actually saw, so that comes first; then x-real-ip (also set by
--    the proxy); then the LAST x-forwarded-for entry, the one appended by the nearest proxy (earlier entries are
--    whatever the client sent). IPv6 addresses count per /64, since one connection usually owns the whole /64.
--  * When no address can be found, the request still counts, against one shared "unknown" bucket.
--  * Each form also has an overall hourly cap, so rotating addresses can't send unlimited emails.
-- Hits are kept in form_rate (no client access at all) and expire after a day at most.
create table public.form_rate (
  kind  text not null,
  scope text not null default '',
  ip    inet,
  at    timestamptz not null default now()
);
create index form_rate_ip_idx on public.form_rate (kind, ip, at);
create index form_rate_scope_idx on public.form_rate (kind, scope, at);
create index form_rate_at_idx on public.form_rate (at);
alter table public.form_rate enable row level security;
revoke all on public.form_rate from public, anon, authenticated;

-- One header value as an address to count by (null if it isn't one).
create or replace function public._norm_ip(p_value text)
returns inet
language plpgsql immutable set search_path = public
as $$
declare
  v_ip inet;
begin
  begin
    v_ip := host(trim(p_value)::inet)::inet; -- drops any /mask the header carried
  exception when others then
    return null;
  end;
  return case when family(v_ip) = 6 then network(set_masklen(v_ip, 64)) else v_ip end;
end;
$$;
revoke execute on function public._norm_ip(text) from public, anon, authenticated;

create or replace function public._client_ip()
returns inet
language plpgsql stable set search_path = public
as $$
declare
  v_h json;
begin
  begin
    v_h := current_setting('request.headers', true)::json;
  exception when others then
    return null;
  end;
  return coalesce(
    public._norm_ip(v_h ->> 'cf-connecting-ip'),
    public._norm_ip(v_h ->> 'x-real-ip'),
    public._norm_ip(regexp_replace(v_h ->> 'x-forwarded-for', '^.*,', ''))  -- last hop
  );
end;
$$;
revoke execute on function public._client_ip() from public, anon, authenticated;

-- Count one hit for `kind` if it's within the limits; true = go ahead (and the hit is recorded).
--   p_ip_max per p_ip_window from one address (null address = the shared unknown bucket), across all scopes;
--   p_all_max per p_all_window for this kind + scope from everyone (null = no overall cap).
-- If the caller later raises an error the hit is rolled back with everything else.
create or replace function public.form_rate_take(
  p_kind       text,
  p_scope      text,
  p_ip         inet,
  p_ip_max     int,
  p_ip_window  interval,
  p_all_max    int default null,
  p_all_window interval default null
)
returns boolean
language plpgsql volatile security definer set search_path = public
as $$
begin
  delete from public.form_rate where at < now() - interval '1 day';
  delete from public.form_rate where kind = p_kind and at < now() - greatest(p_ip_window, coalesce(p_all_window, p_ip_window));
  if (select count(*) from public.form_rate
      where kind = p_kind and ip is not distinct from p_ip and at > now() - p_ip_window) >= p_ip_max then
    return false;
  end if;
  if p_all_max is not null and (select count(*) from public.form_rate
      where kind = p_kind and scope = coalesce(p_scope, '') and at > now() - p_all_window) >= p_all_max then
    return false;
  end if;
  insert into public.form_rate (kind, scope, ip) values (p_kind, coalesce(p_scope, ''), p_ip);
  return true;
end;
$$;
revoke execute on function public.form_rate_take(text, text, inet, int, interval, int, interval) from public, anon, authenticated;

-- The We Buy Comics form (sell-inquiry Edge Function, which calls this with the service key and passes the address it
-- picked the same way as _client_ip): 5 per address per hour, 30 an hour overall.
create or replace function public.sell_inquiry_rate_ok(p_ip text)
returns boolean
language sql volatile security definer set search_path = public
as $$
  select public.form_rate_take('sell_inquiry', '', public._norm_ip(p_ip), 5, interval '1 hour', 30, interval '1 hour');
$$;
revoke execute on function public.sell_inquiry_rate_ok(text) from public, anon, authenticated;
grant execute on function public.sell_inquiry_rate_ok(text) to service_role;

-- Event signups: at most 10 per address per 10 minutes, 60 per event per hour; length limits on every field.
create or replace function public.event_signup(
  p_event_id bigint,
  p_name     text,
  p_email    text,
  p_phone    text,
  p_party    int default 1,
  p_notes    text default null,
  p_website  text default null  -- honeypot: real users never fill this in
)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_name  text := nullif(trim(p_name), '');
  v_email text := nullif(lower(trim(p_email)), '');
  v_phone text := nullif(trim(p_phone), '');
  v_notes text := nullif(trim(p_notes), '');
  v_ev    public.events;
  v_ip    inet := public._client_ip();
  v_taken int;
  v_id    bigint;
begin
  if coalesce(p_website, '') <> '' then
    return 0;
  end if;
  if v_name is null then
    raise exception 'Please enter your name.' using errcode = 'P0001';
  end if;
  if length(v_name) > 100 then
    raise exception 'Please keep your name under 100 characters.' using errcode = 'P0001';
  end if;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception 'Please enter a valid email address.' using errcode = 'P0001';
  end if;
  if v_phone is null then
    raise exception 'Please enter your phone number.' using errcode = 'P0001';
  end if;
  if length(v_phone) > 40 then
    raise exception 'That phone number looks too long.' using errcode = 'P0001';
  end if;
  if p_party is null or p_party < 1 or p_party > 10 then
    raise exception 'Party size must be between 1 and 10. For a bigger group, please call the shop.' using errcode = 'P0001';
  end if;
  if length(v_notes) > 500 then
    raise exception 'Please keep notes under 500 characters.' using errcode = 'P0001';
  end if;

  -- Lock the event row so two people can't take the last spot at once.
  select * into v_ev from public.events where id = p_event_id for update;
  if not found or not v_ev.signup_enabled then
    raise exception 'Signups aren''t open for this event.' using errcode = 'P0001';
  end if;
  if coalesce(v_ev.ends_at, v_ev.starts_at) < now() then
    raise exception 'This event has already happened.' using errcode = 'P0001';
  end if;

  if not public.form_rate_take('event_signup', p_event_id::text, v_ip, 10, interval '10 minutes', 60, interval '1 hour') then
    raise exception 'Too many signups right now — please try again in a few minutes or call the shop.' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.event_signups where event_id = p_event_id and lower(email) = v_email) then
    raise exception 'That email address is already signed up for this event. Call the shop if you need to change it.' using errcode = 'P0001';
  end if;

  if v_ev.signup_capacity is not null then
    v_taken := public.event_spots_taken(p_event_id);
    if v_taken >= v_ev.signup_capacity then
      raise exception 'Sorry, this event is full.' using errcode = 'P0001';
    end if;
    if v_taken + p_party > v_ev.signup_capacity then
      raise exception 'Only % spot(s) left — please lower your party size.', v_ev.signup_capacity - v_taken using errcode = 'P0001';
    end if;
  end if;

  insert into public.event_signups (event_id, name, email, phone, party_size, notes, client_ip)
  values (p_event_id, v_name, v_email, v_phone, p_party, v_notes, v_ip)
  returning id into v_id;
  return v_id;
end;
$$;

-- Guest pre-orders: at most 10 per address per 10 minutes, 100 an hour overall; length limits on name/phone/email.
create or replace function public.create_reservation_order(
  p_name    text,
  p_phone   text,
  p_email   text,
  p_items   jsonb,
  p_website text default null  -- honeypot: real users never fill this in
)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_name     text := nullif(trim(p_name), '');
  v_phone    text := nullif(trim(p_phone), '');
  v_email    text := nullif(lower(trim(p_email)), '');
  v_digits   text;
  v_max      smallint;
  v_ip       inet := public._client_ip();
  v_order_id bigint;
  v_line     record;
  v_item     public.items;
  v_title    text;
  v_existing int;
begin
  -- Silently accept bots so they don't learn the field is a trap.
  if coalesce(p_website, '') <> '' then
    return 0;
  end if;

  if v_name is null then
    raise exception 'Please enter your name.' using errcode = 'P0001';
  end if;
  if length(v_name) > 100 then
    raise exception 'Please keep your name under 100 characters.' using errcode = 'P0001';
  end if;
  if v_phone is null then
    raise exception 'Please enter your phone number.' using errcode = 'P0001';
  end if;
  if length(v_phone) > 40 then
    raise exception 'That phone number looks too long.' using errcode = 'P0001';
  end if;
  if v_email is null then
    raise exception 'Please enter your email address.' using errcode = 'P0001';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception 'That email address doesn''t look right.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Your reservation list is empty.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'That''s a lot of titles for one order — please call the shop.' using errcode = 'P0001';
  end if;

  if not public.form_rate_take('reservation', '', v_ip, 10, interval '10 minutes', 100, interval '1 hour') then
    raise exception 'Too many reservations in a short time — please try again later or call the shop.' using errcode = 'P0001';
  end if;

  select max_copies_per_title into v_max from public.settings where id = 1;
  v_max := coalesce(v_max, 10);
  v_digits := nullif(regexp_replace(coalesce(v_phone, ''), '\D', '', 'g'), '');

  insert into public.reservation_orders (name, phone, email, client_ip)
  values (v_name, v_phone, v_email, v_ip)
  returning id into v_order_id;

  for v_line in
    select (e ->> 'item_id')::bigint as item_id, sum((e ->> 'quantity')::int) as quantity
    from jsonb_array_elements(p_items) e
    group by 1
  loop
    select * into v_item from public.items where id = v_line.item_id;
    v_title := coalesce(v_item.title || coalesce(' #' || v_item.issue_number, ''), 'One of those titles');

    if v_item.id is null or v_item.status <> 'pre_order' or v_item.hidden then
      raise exception '% is no longer open for pre-order — please remove it from your list.', v_title using errcode = 'P0001';
    end if;
    -- Reservations close at midnight (shop time) on the Saturday before FOC (usually a
    -- Monday), so the shop has time to collect the reservations and place the order.
    if v_item.foc_date is not null and v_item.foc_date <= public.reservations_close_through() then
      raise exception 'Reservations for % have closed — please remove it from your list.', v_title using errcode = 'P0001';
    end if;
    if v_line.quantity is null or v_line.quantity < 1 then
      raise exception 'Quantity for % must be at least 1.', v_title using errcode = 'P0001';
    end if;

    -- Per-customer, per-title copy limit (matched on phone digits or email),
    -- counting earlier orders as well as this one.
    select coalesce(sum(r.quantity), 0) into v_existing
    from public.reservations r
    join public.reservation_orders o on o.id = r.order_id
    where r.item_id = v_item.id
      and r.order_id <> v_order_id
      and r.status not in ('cancelled', 'released')
      and ((v_digits is not null and o.phone_digits = v_digits)
        or (v_email is not null and lower(o.email) = v_email));

    if v_existing + v_line.quantity > v_max then
      if v_existing > 0 then
        raise exception 'Limit is % copies per customer for % (you already have % reserved).',
          v_max, v_title, v_existing using errcode = 'P0001';
      end if;
      raise exception 'Limit is % copies per customer for %.', v_max, v_title using errcode = 'P0001';
    end if;

    insert into public.reservations (order_id, item_id, quantity)
    values (v_order_id, v_item.id, v_line.quantity);
  end loop;

  return v_order_id;
end;
$$;

-- B2 ------------------------------------------------------------------------------------------------------------------
-- Surveys stay anonymous: answers no longer keep the visitor's address (the rate limit uses form_rate, whose rows
-- expire within the hour), and drawing entries get a random id and only the day they were entered, so neither
-- the order nor the time links an email to its answers. Drawing entries are unique per normalised email
-- (lowercase, no +tag, and for Gmail no dots), so one inbox can't enter the same drawing many times.
update public.survey_responses set client_ip = null where client_ip is not null;
comment on column public.survey_responses.client_ip is 'No longer used (kept empty so answers stay anonymous).';

create or replace function public._email_key(p_email text)
returns text
language sql immutable set search_path = public
as $$
  with p as (
    select split_part(lower(trim(p_email)), '@', 1) as local, split_part(lower(trim(p_email)), '@', 2) as domain
  )
  select case
    when p.domain in ('gmail.com', 'googlemail.com') then replace(split_part(p.local, '+', 1), '.', '') || '@gmail.com'
    else split_part(p.local, '+', 1) || '@' || p.domain
  end
  from p;
$$;
revoke execute on function public._email_key(text) from public, anon, authenticated;

-- Entries made before this change: repeat +variants of one inbox dropped (the first kept), then ids shuffled and
-- times cut to the day.
delete from public.survey_entries e
using public.survey_entries f
where f.survey_id = e.survey_id and public._email_key(f.email) = public._email_key(e.email) and f.id < e.id;
alter table public.survey_entries alter column id drop identity if exists;
alter table public.survey_entries alter column id set default (floor(random() * 9e15) + 1)::bigint;
update public.survey_entries set created_at = date_trunc('day', created_at), id = (floor(random() * 9e15) + 1)::bigint;
alter table public.survey_entries alter column created_at set default date_trunc('day', now());
drop index public.survey_entries_unique;
create unique index survey_entries_unique on public.survey_entries (survey_id, public._email_key(email));

create or replace function public.submit_survey_response(
  p_survey_id bigint,
  p_answers   jsonb,
  p_website   text default null,  -- honeypot: real users never fill this in
  p_email     text default null    -- optional prize-drawing entry; kept apart from the answers
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_survey  public.surveys;
  v_q       jsonb;
  v_clean   jsonb := '{}'::jsonb;
  v_val     jsonb;
  v_text    text;
  v_opt     jsonb;
  v_n       int;
  v_arr     jsonb;
  v_email   text := nullif(lower(trim(p_email)), '');
begin
  if coalesce(p_website, '') <> '' then
    return; -- bots get a silent success
  end if;
  if v_email is not null and (v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254) then
    raise exception 'That email address doesn''t look right.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_answers) is distinct from 'object' then
    raise exception 'Something went wrong — please reload and try again.' using errcode = 'P0001';
  end if;

  select * into v_survey from public.surveys where id = p_survey_id and is_open;
  if v_survey.id is null then
    raise exception 'This survey is closed. Thanks for stopping by!' using errcode = 'P0001';
  end if;

  -- 5 per address per 10 minutes, 200 per survey per hour.
  if not public.form_rate_take('survey', v_survey.id::text, public._client_ip(), 5, interval '10 minutes', 200, interval '1 hour') then
    raise exception 'Too many submissions in a short time — please try again later.' using errcode = 'P0001';
  end if;

  -- Keep only answers to real questions, in the right shape.
  for v_q in select * from jsonb_array_elements(v_survey.questions) loop
    v_val := p_answers -> (v_q ->> 'id');
    if v_val is null or v_val = 'null'::jsonb or v_val = '""'::jsonb or v_val = '[]'::jsonb then
      if coalesce((v_q ->> 'required')::boolean, false) then
        raise exception 'Please answer: %', left(v_q ->> 'label', 120) using errcode = 'P0001';
      end if;
      continue;
    end if;

    case v_q ->> 'type'
      when 'text', 'long' then
        if jsonb_typeof(v_val) <> 'string' then raise exception 'Invalid answer.' using errcode = 'P0001'; end if;
        v_text := left(trim(v_val #>> '{}'), case when v_q ->> 'type' = 'text' then 300 else 3000 end);
        if v_text <> '' then v_clean := v_clean || jsonb_build_object(v_q ->> 'id', v_text); end if;
      when 'choice', 'yesno' then
        if jsonb_typeof(v_val) <> 'string' then raise exception 'Invalid answer.' using errcode = 'P0001'; end if;
        v_text := v_val #>> '{}';
        if v_q ->> 'type' = 'yesno' then
          if v_text not in ('Yes', 'No') then raise exception 'Invalid answer.' using errcode = 'P0001'; end if;
        elsif not (v_q -> 'options') @> to_jsonb(v_text) then
          -- Write-in: "Other" or "Other: something", only on questions that allow it.
          if not (coalesce((v_q ->> 'other')::boolean, false) and (v_text = 'Other' or v_text like 'Other: %')) then
            raise exception 'Invalid answer.' using errcode = 'P0001';
          end if;
          v_text := left(v_text, 210);
        end if;
        v_clean := v_clean || jsonb_build_object(v_q ->> 'id', v_text);
      when 'multi' then
        if jsonb_typeof(v_val) <> 'array' then raise exception 'Invalid answer.' using errcode = 'P0001'; end if;
        v_arr := '[]'::jsonb;
        for v_opt in select * from jsonb_array_elements(v_val) loop
          if jsonb_typeof(v_opt) <> 'string' then raise exception 'Invalid answer.' using errcode = 'P0001'; end if;
          v_text := v_opt #>> '{}';
          if not (v_q -> 'options') @> to_jsonb(v_text) then
            if not (coalesce((v_q ->> 'other')::boolean, false) and (v_text = 'Other' or v_text like 'Other: %')) then
              raise exception 'Invalid answer.' using errcode = 'P0001';
            end if;
            v_text := left(v_text, 210);
          end if;
          v_arr := v_arr || to_jsonb(v_text);
        end loop;
        v_clean := v_clean || jsonb_build_object(v_q ->> 'id', v_arr);
      when 'rating' then
        if jsonb_typeof(v_val) <> 'number' then raise exception 'Invalid answer.' using errcode = 'P0001'; end if;
        v_n := (v_val #>> '{}')::numeric::int;
        if v_n < 1 or v_n > 5 then raise exception 'Invalid answer.' using errcode = 'P0001'; end if;
        v_clean := v_clean || jsonb_build_object(v_q ->> 'id', v_n);
      else
        null;
    end case;
  end loop;

  if v_clean = '{}'::jsonb then
    raise exception 'Please answer at least one question.' using errcode = 'P0001';
  end if;

  insert into public.survey_responses (survey_id, answers) values (v_survey.id, v_clean);
  -- Not linked to the response row (random id, date only), so the answers stay anonymous.
  if v_email is not null and v_survey.collect_email then
    insert into public.survey_entries (survey_id, email) values (v_survey.id, v_email) on conflict do nothing;
  end if;
end;
$$;

-- B3 ------------------------------------------------------------------------------------------------------------------
-- QR scan counts: anyone could call qr_target in a loop to inflate a code's count. A scan now counts at most once
-- per address per code per hour; the forwarding address is returned every time.
create or replace function public.qr_target(p_slug text)
returns text
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_slug text := lower(p_slug);
  v_url  text;
begin
  select target_url into v_url from public.qr_codes where slug = v_slug and forward;
  if v_url is not null and public.form_rate_take('qr:' || v_slug, '', public._client_ip(), 1, interval '1 hour') then
    update public.qr_codes set scan_count = scan_count + 1, last_scan_at = now() where slug = v_slug;
  end if;
  return v_url;
end;
$$;

-- ===============================================================================================================
-- Part C: Customer pull list
-- ===============================================================================================================
-- Customer pull list fixes (site audit, package S4).
--  1. Following something you already follow (a Follow button pressed again) no longer resets its copies to 1:
--     the existing follow keeps its quantity. Only set_follow_quantity changes it.
--  2. "Not ordered" lines (the shop decided not to order the title) no longer count toward the copy limit or block
--     adding the title again; adding it again reopens the line (as with a cancelled one) while the title is open.
--  3. Privacy: a signed-in customer's copy limit counts only their own orders, plus unclaimed guest orders under the
--     verified email they sign in with. It no longer matches other people's orders by phone (customers can set any
--     phone on their profile), so the "you already have N" count can't reveal someone else's reservations, and
--     someone else's guest orders can't use up their limit. Guest checkout no longer says how many copies are
--     already reserved under the phone or email typed in.

-- C1 ------------------------------------------------------------------------------------------------------------------
-- _subscribe has been patched in place by earlier migrations, so patch just its upsert.
do $$
declare
  v_src text := pg_get_functiondef('public._subscribe(public.customers, text, text, text, text, int)'::regprocedure);
  v_old text := 'do update set quantity = excluded.quantity';
begin
  if position(v_old in v_src) = 0 then raise exception 'could not patch _subscribe'; end if;
  -- A no-op update, so `returning id` still gives the existing follow's id.
  execute replace(v_src, v_old, 'do update set quantity = public.subscriptions.quantity');
end $$;

-- C2 + C3 -------------------------------------------------------------------------------------------------------------
-- Copies of a title that count toward this customer's limit: their own orders, and unclaimed guest orders under the
-- verified email of their login. A customer with no login (set up by the shop) is matched on the email and phone
-- the shop entered, as before. Cancelled, released and not-ordered lines don't count.
create or replace function public._pull_list_problem(c public.customers, item public.items, qty int, skip_line bigint default null)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  v_title    text := item.title || coalesce(' #' || item.issue_number, '') || coalesce(' (' || item.variant || ')', '');
  v_max      int;
  v_existing int;
  v_email    text;
  v_digits   text;
begin
  if item.id is null or item.status <> 'pre_order' or item.hidden then
    return v_title || ' is no longer open for pre-order.';
  end if;
  if item.foc_date is not null and item.foc_date <= public.reservations_close_through() then
    return 'The order cutoff for ' || v_title || ' has passed.';
  end if;
  if qty is null or qty < 1 then
    return 'Quantity for ' || v_title || ' must be at least 1.';
  end if;
  if c.user_id is not null then
    select nullif(lower(trim(u.email)), '') into v_email
    from auth.users u where u.id = c.user_id and u.email_confirmed_at is not null;
  else
    v_email := nullif(lower(trim(c.email)), '');
    v_digits := c.phone_digits;
  end if;
  select coalesce(max_copies_per_title, 10) into v_max from public.settings where id = 1;
  select coalesce(sum(r.quantity), 0) into v_existing
  from public.reservations r
  join public.reservation_orders o on o.id = r.order_id
  where r.item_id = item.id
    and r.status not in ('cancelled', 'released', 'not_ordered')
    and r.id is distinct from skip_line
    and (o.customer_id = c.id
      or (o.customer_id is null and v_email is not null and lower(o.email) = v_email)
      or (o.customer_id is null and v_digits is not null and o.phone_digits = v_digits));
  if v_existing + qty > v_max then
    return 'Limit is ' || v_max || ' copies per customer for ' || v_title
      || case when v_existing > 0 then ' (you already have ' || v_existing || ' on your list).' else '.' end;
  end if;
  -- Size cap (editing an existing line doesn't add one, so it is exempt).
  if skip_line is null and (
    select count(*) from public.reservations r join public.reservation_orders o on o.id = r.order_id
    where o.customer_id = c.id and r.status in ('open', 'ordered', 'reordered', 'arrived')
  ) >= 300 then
    return 'Your pull list is full (300 titles). Please call the shop.';
  end if;
  return null;
end;
$$;
revoke execute on function public._pull_list_problem(public.customers, public.items, int, bigint) from public, anon, authenticated;

-- A not-ordered line isn't "already on your list": adding the title again reopens it (the upsert below sets it back
-- to open when it is on the pull list order) or adds a new line.
create or replace function public._pull_list_put(c public.customers, item public.items, qty int, src text, quiet boolean)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_order bigint;
  v_id    bigint;
  v_msg   text;
begin
  if exists (
    select 1 from public.reservations r join public.reservation_orders o on o.id = r.order_id
    where r.item_id = item.id and o.customer_id = c.id and r.status not in ('cancelled', 'released', 'not_ordered')
  ) then
    if quiet then return null; end if;
    raise exception '% is already on your list.', item.title || coalesce(' #' || item.issue_number, '') using errcode = 'P0001';
  end if;

  v_msg := public._pull_list_problem(c, item, qty);
  if v_msg is not null then
    raise exception '%', v_msg using errcode = 'P0001';
  end if;

  v_order := public._pull_list_order(c);
  insert into public.reservations (order_id, item_id, quantity, source)
  values (v_order, item.id, qty, src)
  on conflict (order_id, item_id) do update
    set quantity = excluded.quantity, source = excluded.source, status = 'open', arrived_on = null, created_at = now()
  returning id into v_id;

  delete from public.pull_list_exclusions where customer_id = c.id and item_id = item.id;
  return v_id;
end;
$$;
revoke execute on function public._pull_list_put(public.customers, public.items, int, text, boolean) from public, anon, authenticated;

-- Guest checkout's per-title copy limit, matched on the phone digits or email of the order (the only identity a
-- guest has), counting earlier orders but not p_order itself. Not-ordered lines don't count, and the message
-- doesn't say how many copies are already reserved: anyone can type a phone number or email.
create or replace function public._guest_copy_problem(p_item public.items, p_qty int, p_digits text, p_email text, p_order bigint)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  v_title    text := coalesce(p_item.title || coalesce(' #' || p_item.issue_number, ''), 'One of those titles');
  v_max      int;
  v_existing int;
begin
  select coalesce(max_copies_per_title, 10) into v_max from public.settings where id = 1;
  select coalesce(sum(r.quantity), 0) into v_existing
  from public.reservations r
  join public.reservation_orders o on o.id = r.order_id
  where r.item_id = p_item.id
    and r.order_id is distinct from p_order
    and r.status not in ('cancelled', 'released', 'not_ordered')
    and ((p_digits is not null and o.phone_digits = p_digits)
      or (p_email is not null and lower(o.email) = lower(p_email)));
  if v_existing + p_qty > coalesce(v_max, 10) then
    if v_existing > 0 then
      return 'Limit is ' || coalesce(v_max, 10) || ' copies per customer for ' || v_title
        || ', counting copies already reserved under this phone number or email. Please call the shop if you need more.';
    end if;
    return 'Limit is ' || coalesce(v_max, 10) || ' copies per customer for ' || v_title || '.';
  end if;
  return null;
end;
$$;
revoke execute on function public._guest_copy_problem(public.items, int, text, text, bigint) from public, anon, authenticated;

-- create_reservation_order: swap its inline copy-limit check for _guest_copy_problem. Patched in place (only that
-- block) so other changes to the function are kept.
do $$
declare
  v_src text := pg_get_functiondef('public.create_reservation_order(text, text, text, jsonb, text)'::regprocedure);
  v_new text;
begin
  v_new := regexp_replace(v_src,
    '-- Per-customer, per-title copy limit.*?raise exception ''Limit is % copies per customer for %\.'', v_max, v_title using errcode = ''P0001'';\s*end if;',
    E'-- Per-customer, per-title copy limit (matched on phone digits or email), counting earlier orders.\n'
    || E'    v_title := public._guest_copy_problem(v_item, v_line.quantity::int, v_digits, v_email, v_order_id);\n'
    || E'    if v_title is not null then\n'
    || E'      raise exception ''%'', v_title using errcode = ''P0001'';\n'
    || E'    end if;',
    's');
  if v_new = v_src then raise exception 'could not patch create_reservation_order'; end if;
  execute v_new;
end $$;
