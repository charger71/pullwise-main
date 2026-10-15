-- Pull list, phase 4: follow a series or an artist (especially cover artists).
--
-- A subscription adds new pre-order issues to the customer's pull list automatically
-- (source 'series' / 'artist'); the customer can remove any of them, and a removal is
-- remembered (pull_list_exclusions) so it isn't added back.
--
--   series  - items.series_key is derived from the title; staff can merge keys.
--             A series follow adds ONE cover per issue: the plain/"A" cover.
--   artist  - item_creators splits items.creators into people. The distributor sheets
--             don't say who did what, so the role is inferred: a name that also appears in
--             the cover/variant text is that cover's artist ('cover'); everyone else is
--             'creator'. Following as 'cover' adds every cover by that artist; following as
--             'creator' adds one cover per issue (like a series).
--
-- Auto-adding happens when someone follows (so their list fills in right away) and in an
-- hourly sweep, apply_subscriptions(), which picks up newly imported titles.

-- ---------------------------------------------------------------------------
-- Normalising helpers
-- ---------------------------------------------------------------------------

create table public.series_aliases (
  from_key text primary key,
  to_key   text not null
);
alter table public.series_aliases enable row level security;
create policy "staff all series_aliases" on public.series_aliases for all using (public.is_staff()) with check (public.is_staff());

-- "GARGOYLES (2026)" -> "gargoyles 2026"; "BATMAN (MR)" -> "batman"
create or replace function public._series_key_auto(p_title text)
returns text
language sql stable set search_path = public
as $$
  select coalesce(
    (select to_key from public.series_aliases where from_key = k.key),
    k.key
  )
  from (
    select nullif(trim(regexp_replace(regexp_replace(lower(coalesce(p_title, '')), '\(mr\)', ' ', 'g'), '[^a-z0-9]+', ' ', 'g')), '') as key
  ) k;
$$;

create or replace function public.person_key(p_name text)
returns text
language sql immutable
as $$
  select nullif(trim(regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', ' ', 'g')), '');
$$;

-- Incentive / ratio covers (same patterns the importer and add-all-covers use).
create or replace function public.is_incentive_variant(p_variant text)
returns boolean
language sql immutable
as $$
  select coalesce(p_variant ~* '(\m1:\d+|\mINCV?\M|\mRI\M|\mRATIO\M|\mINCENTIVE\M|\m\d+\s*COPY\M)', false);
$$;

-- ---------------------------------------------------------------------------
-- items.series_key
-- ---------------------------------------------------------------------------

alter table public.items add column series_key text;
create index items_series_key_idx on public.items (series_key) where series_key is not null;

create or replace function public.items_set_series_key()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.series_key is null then
      new.series_key := public._series_key_auto(new.title);
    end if;
  elsif new.title is distinct from old.title
        and new.series_key is not distinct from old.series_key
        and old.series_key is not distinct from public._series_key_auto(old.title) then
    -- Still on its automatic key: follow the new title. A key staff merged by hand is left alone.
    new.series_key := public._series_key_auto(new.title);
  end if;
  return new;
end;
$$;
create trigger items_series_key before insert or update on public.items
  for each row execute function public.items_set_series_key();

update public.items set series_key = public._series_key_auto(title) where series_key is null;

-- ---------------------------------------------------------------------------
-- item_creators
-- ---------------------------------------------------------------------------

create table public.item_creators (
  item_id bigint not null references public.items (id) on delete cascade,
  key     text   not null,
  name    text   not null,
  role    text   not null check (role in ('creator', 'cover')),
  primary key (item_id, key)
);
create index item_creators_key_idx on public.item_creators (key, role);
alter table public.item_creators enable row level security;
create policy "public read item_creators" on public.item_creators for select using (true);

create or replace function public._sync_item_creators(p_item_id bigint)
returns void
language plpgsql set search_path = public
as $$
declare
  v_creators text;
  v_variant  text;
begin
  select creators, variant into v_creators, v_variant from public.items where id = p_item_id;
  delete from public.item_creators where item_id = p_item_id;
  if v_creators is null then
    return;
  end if;
  insert into public.item_creators (item_id, key, name, role)
  select p_item_id, public.person_key(n.name), n.name,
         case when v_variant is not null and position(lower(n.name) in lower(v_variant)) > 0 then 'cover' else 'creator' end
  from (
    select distinct on (public.person_key(nm)) trim(regexp_replace(nm, '\s+', ' ', 'g')) as name
    from regexp_split_to_table(v_creators, '\s*[,;/]\s*|\s+&\s+|\s+and\s+', 'i') nm
    order by public.person_key(nm), length(nm)
  ) n
  where length(n.name) >= 3
    and public.person_key(n.name) is not null
    and public.person_key(n.name) not in ('various', 'various artists', 'tbd', 'tba', 'unknown', 'n a', 'none')
  on conflict (item_id, key) do nothing;
end;
$$;

create or replace function public.items_sync_creators()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.creators is distinct from old.creators or new.variant is distinct from old.variant then
    perform public._sync_item_creators(new.id);
  end if;
  return null;
end;
$$;
create trigger items_creators after insert or update of creators, variant on public.items
  for each row execute function public.items_sync_creators();

do $$
declare
  r record;
begin
  for r in select id from public.items where creators is not null loop
    perform public._sync_item_creators(r.id);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Subscriptions
-- ---------------------------------------------------------------------------

alter table public.customers add column mature_ok boolean not null default false;
grant update (mature_ok) on public.customers to authenticated;

create table public.subscriptions (
  id          bigint generated always as identity primary key,
  customer_id bigint not null references public.customers (id) on delete cascade,
  kind        text not null check (kind in ('series', 'artist')),
  key         text not null,
  label       text not null,
  role        text check (role in ('creator', 'cover')),
  quantity    smallint not null default 1 check (quantity between 1 and 100),
  created_at  timestamptz not null default now(),
  constraint subscriptions_role_chk check ((kind = 'series' and role is null) or (kind = 'artist' and role is not null))
);
create unique index subscriptions_unique on public.subscriptions (customer_id, kind, key, coalesce(role, ''));

alter table public.subscriptions enable row level security;
create policy "staff all subscriptions" on public.subscriptions for all using (public.is_staff()) with check (public.is_staff());
create policy "own subscriptions read" on public.subscriptions for select
  using (customer_id in (select id from public.customers where user_id = auth.uid()));
revoke all on public.subscriptions from anon;
revoke insert, update, delete on public.subscriptions from authenticated;
grant select on public.subscriptions to authenticated;
-- Staff change subscriptions through the functions below, or delete them directly.
grant delete on public.subscriptions to authenticated;

-- ---------------------------------------------------------------------------
-- The sweep: add matching open pre-orders to subscribers' lists.
-- Adds only titles the customer has never had a line for (any status), that aren't
-- excluded, aren't incentive covers, are still open for pre-order and pass the same
-- checks as a manual add (cutoff, copy limit). Mature titles need customers.mature_ok.
-- p_cap limits how many titles one customer gets per run, so a broad follow can't flood a list.
-- ---------------------------------------------------------------------------

create or replace function public.apply_subscriptions(p_customer bigint default null, p_cap int default 60)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  c       public.customers;
  m       record;
  item    public.items;
  v_total int := 0;
  v_n     int;
begin
  for c in
    select * from public.customers cu
    where (p_customer is null or cu.id = p_customer)
      and exists (select 1 from public.subscriptions s where s.customer_id = cu.id)
  loop
    v_n := 0;
    for m in
      with open_items as (
        select i.*,
               row_number() over (
                 partition by lower(trim(i.title)), i.issue_number, i.publisher
                 order by (i.variant is null) desc, (i.variant ~* '^(cvr|cover)\s*a\M') desc, i.id
               ) as rn
        from public.items i
        where i.status = 'pre_order' and not i.hidden
          and not public.is_incentive_variant(i.variant)
          and (i.foc_date is null or i.foc_date > public.reservations_close_through())
      )
      select distinct on (oi.id) oi.id as item_id, s.quantity, s.kind
      from public.subscriptions s
      join open_items oi on (
           (s.kind = 'series' and oi.rn = 1 and oi.series_key = s.key)
        or (s.kind = 'artist' and s.role = 'creator' and oi.rn = 1
            and exists (select 1 from public.item_creators ic where ic.item_id = oi.id and ic.key = s.key))
        or (s.kind = 'artist' and s.role = 'cover'
            and exists (select 1 from public.item_creators ic where ic.item_id = oi.id and ic.key = s.key and ic.role = 'cover'))
      )
      where s.customer_id = c.id
        and (c.mature_ok or not oi.mature)
        and not exists (select 1 from public.pull_list_exclusions x where x.customer_id = c.id and x.item_id = oi.id)
        and not exists (
          select 1 from public.reservations r join public.reservation_orders o on o.id = r.order_id
          where r.item_id = oi.id and o.customer_id = c.id
        )
      order by oi.id, (s.kind = 'artist') desc
    loop
      exit when v_n >= p_cap;
      select * into item from public.items where id = m.item_id;
      if public._pull_list_problem(c, item, m.quantity) is null
         and public._pull_list_put(c, item, m.quantity, m.kind, true) is not null then
        v_n := v_n + 1;
      end if;
    end loop;
    v_total := v_total + v_n;
  end loop;
  return v_total;
end;
$$;
revoke execute on function public.apply_subscriptions(bigint, int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Customer and staff API
-- ---------------------------------------------------------------------------

-- Creates the subscription (or updates its quantity) and fills the customer's list right away.
create or replace function public._subscribe(c public.customers, p_kind text, p_key text, p_label text, p_role text, p_quantity int)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_id     bigint;
  v_before int;
  v_added  int;
begin
  if p_quantity is null or p_quantity < 1 or p_quantity > 100 then
    raise exception 'Quantity must be between 1 and 100.' using errcode = 'P0001';
  end if;
  if p_kind = 'series' and not exists (select 1 from public.items where series_key = p_key and not hidden) then
    raise exception 'We couldn''t find that series.' using errcode = 'P0001';
  end if;
  if p_kind = 'artist' and not exists (select 1 from public.item_creators ic join public.items i on i.id = ic.item_id where ic.key = p_key and not i.hidden) then
    raise exception 'We couldn''t find that artist.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.subscriptions where customer_id = c.id) >= 200 then
    raise exception 'That''s a lot of follows — please call the shop.' using errcode = 'P0001';
  end if;

  insert into public.subscriptions (customer_id, kind, key, label, role, quantity)
  values (c.id, p_kind, p_key, p_label, p_role, p_quantity)
  on conflict (customer_id, kind, key, coalesce(role, '')) do update set quantity = excluded.quantity
  returning id into v_id;

  select count(*) into v_before from public.reservations r join public.reservation_orders o on o.id = r.order_id where o.customer_id = c.id;
  perform public.apply_subscriptions(c.id);
  select count(*) - v_before into v_added from public.reservations r join public.reservation_orders o on o.id = r.order_id where o.customer_id = c.id;
  return jsonb_build_object('id', v_id, 'added', v_added);
end;
$$;

create or replace function public._series_label(p_key text)
returns text
language sql stable set search_path = public
as $$
  -- the shortest title is the plainest name ("ABSOLUTE BATMAN" over "DF ABSOLUTE BATMAN")
  select title from public.items where series_key = p_key and not hidden order by length(title), created_at desc limit 1;
$$;

create or replace function public.follow_series(p_key text, p_quantity int default 1)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  c public.customers := public._pull_list_customer();
begin
  return public._subscribe(c, 'series', p_key, coalesce(public._series_label(p_key), p_key), null, p_quantity);
end;
$$;

-- p_role: 'cover' (every cover by this artist) or 'creator' (one cover per issue they work on)
create or replace function public.follow_artist(p_name text, p_role text default 'cover', p_quantity int default 1)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  c   public.customers := public._pull_list_customer();
  v_key text := public.person_key(p_name);
  v_name text;
begin
  if p_role not in ('creator', 'cover') then
    raise exception 'Choose cover artist or writer/artist.' using errcode = 'P0001';
  end if;
  select name into v_name from public.item_creators where key = v_key order by length(name) desc limit 1;
  return public._subscribe(c, 'artist', v_key, coalesce(v_name, trim(p_name)), p_role, p_quantity);
end;
$$;

create or replace function public.unfollow(p_id bigint)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  c public.customers := public._pull_list_customer();
begin
  delete from public.subscriptions where id = p_id and customer_id = c.id;
end;
$$;

create or replace function public.set_follow_quantity(p_id bigint, p_quantity int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  c public.customers := public._pull_list_customer();
begin
  if p_quantity is null or p_quantity < 1 or p_quantity > 100 then
    raise exception 'Quantity must be between 1 and 100.' using errcode = 'P0001';
  end if;
  update public.subscriptions set quantity = p_quantity where id = p_id and customer_id = c.id;
end;
$$;

-- Staff versions: same, for a chosen customer (walk-ins).
create or replace function public.staff_follow_series(p_customer bigint, p_key text, p_quantity int default 1)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  c public.customers;
begin
  if not public.is_staff() then raise exception 'Staff only.' using errcode = '42501'; end if;
  select * into c from public.customers where id = p_customer;
  if c.id is null then raise exception 'That customer no longer exists.' using errcode = 'P0001'; end if;
  return public._subscribe(c, 'series', p_key, coalesce(public._series_label(p_key), p_key), null, p_quantity);
end;
$$;

create or replace function public.staff_follow_artist(p_customer bigint, p_name text, p_role text default 'cover', p_quantity int default 1)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  c public.customers;
  v_key text := public.person_key(p_name);
  v_name text;
begin
  if not public.is_staff() then raise exception 'Staff only.' using errcode = '42501'; end if;
  if p_role not in ('creator', 'cover') then raise exception 'Choose cover artist or writer/artist.' using errcode = 'P0001'; end if;
  select * into c from public.customers where id = p_customer;
  if c.id is null then raise exception 'That customer no longer exists.' using errcode = 'P0001'; end if;
  select name into v_name from public.item_creators where key = v_key order by length(name) desc limit 1;
  return public._subscribe(c, 'artist', v_key, coalesce(v_name, trim(p_name)), p_role, p_quantity);
end;
$$;

-- Pickers: find a series or an artist by name (open to everyone; only public data).
create or replace function public.search_series(p_q text)
returns table (key text, label text, issues bigint)
language sql stable set search_path = public
as $$
  select i.series_key, (array_agg(i.title order by length(i.title), i.created_at desc))[1], count(distinct i.issue_number)
  from public.items i
  where i.issue_number is not null and i.series_key is not null and not i.hidden
    and i.title ilike '%' || replace(replace(trim(p_q), '%', ''), '_', '') || '%'
    and length(trim(p_q)) >= 2
  group by i.series_key
  order by 3 desc, 2
  limit 20;
$$;

create or replace function public.search_artists(p_q text)
returns table (name text, covers bigint, issues bigint)
language sql stable set search_path = public
as $$
  select (array_agg(ic.name order by length(ic.name) desc))[1],
         count(*) filter (where ic.role = 'cover'),
         count(*)
  from public.item_creators ic
  join public.items i on i.id = ic.item_id and not i.hidden
  where ic.name ilike '%' || replace(replace(trim(p_q), '%', ''), '_', '') || '%'
    and length(trim(p_q)) >= 2
  group by ic.key
  order by 2 desc, 3 desc
  limit 20;
$$;

-- Staff: fold one series key into another (e.g. "batman" and "batman 2025" are the same book to the shop).
create or replace function public.staff_merge_series(p_from text, p_to text)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_n int;
begin
  if not public.is_staff() then raise exception 'Staff only.' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_from = p_to then
    raise exception 'Pick two different series.' using errcode = 'P0001';
  end if;
  update public.items set series_key = p_to where series_key = p_from;
  get diagnostics v_n = row_count;
  -- Follows of the old key move over, unless the customer already follows the new one.
  delete from public.subscriptions s where s.kind = 'series' and s.key = p_from
    and exists (select 1 from public.subscriptions t where t.customer_id = s.customer_id and t.kind = 'series' and t.key = p_to);
  update public.subscriptions set key = p_to, label = coalesce(public._series_label(p_to), label) where kind = 'series' and key = p_from;
  -- Future imports of the old title land on the merged key too.
  insert into public.series_aliases (from_key, to_key) values (p_from, p_to)
  on conflict (from_key) do update set to_key = excluded.to_key;
  update public.series_aliases set to_key = p_to where to_key = p_from;
  return v_n;
end;
$$;

revoke execute on function
  public._subscribe(public.customers, text, text, text, text, int), public._series_label(text),
  public._sync_item_creators(bigint)
from public, anon, authenticated;

revoke execute on function
  public.follow_series(text, int), public.follow_artist(text, text, int), public.unfollow(bigint),
  public.set_follow_quantity(bigint, int), public.staff_follow_series(bigint, text, int),
  public.staff_follow_artist(bigint, text, text, int), public.staff_merge_series(text, text)
from public, anon;
grant execute on function
  public.follow_series(text, int), public.follow_artist(text, text, int), public.unfollow(bigint),
  public.set_follow_quantity(bigint, int), public.staff_follow_series(bigint, text, int),
  public.staff_follow_artist(bigint, text, text, int), public.staff_merge_series(text, text)
to authenticated;
grant execute on function public.search_series(text), public.search_artists(text), public.person_key(text) to anon, authenticated;

-- Hourly, at :30 (the status flip runs on the hour), so newly imported titles reach subscribers.
select cron.schedule('apply-subscriptions', '30 * * * *', 'select public.apply_subscriptions()');
