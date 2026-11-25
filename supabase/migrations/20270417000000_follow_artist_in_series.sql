-- Follow a cover artist on one series: "Peach Momoko on X-Men" adds every cover Peach Momoko draws for that series,
-- and nothing else of theirs. A customer can have several (Momoko on X-Men, Momoko on Uncanny X-Men), and these
-- alongside a plain artist follow.
--
--  * subscriptions.in_series: the series key (exact series, as the series follow uses), only for cover-artist follows.
--    in_series_label: that series' name when followed, for the Following lists; series merges refresh it.
--  * The sweep (apply_subscriptions) and _follow_covers() (unfollow, quantity changes) only match the series' titles.
--  * follow_artist_in_series() / staff_follow_artist_in_series().
--  * The unique index now includes in_series; the two inserts that name it (_subscribe, the pull-list import) follow.
--  * The customer change log names the series ("Cover artist: Peach Momoko on X-MEN").
--  * Series merges move these follows to the kept series; deleting a series (only when it has no titles) drops them.
--    Artist merges keep a customer's follows apart by series.

alter table public.subscriptions
  add column in_series text,
  add column in_series_label text,
  add constraint subscriptions_in_series_chk check (in_series is null or (kind = 'artist' and role = 'cover'));

drop index public.subscriptions_unique;
create unique index subscriptions_unique on public.subscriptions (customer_id, kind, key, coalesce(role, ''), coalesce(in_series, ''));
create index subscriptions_in_series_idx on public.subscriptions (in_series) where in_series is not null;

-- ---------------------------------------------------------------------------
-- Following
-- ---------------------------------------------------------------------------

-- Same as 20261103000000_subscriptions, plus p_in_series / p_in_series_label.
create or replace function public._subscribe(c public.customers, p_kind text, p_key text, p_label text, p_role text, p_quantity int,
                                             p_in_series text, p_in_series_label text)
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
  if p_in_series is not null and not exists (select 1 from public.items where series_key = p_in_series and not hidden) then
    raise exception 'We couldn''t find that series.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.subscriptions where customer_id = c.id) >= 200 then
    raise exception 'That''s a lot of follows — please call the shop.' using errcode = 'P0001';
  end if;

  insert into public.subscriptions (customer_id, kind, key, label, role, quantity, in_series, in_series_label)
  values (c.id, p_kind, p_key, p_label, p_role, p_quantity, p_in_series, p_in_series_label)
  on conflict (customer_id, kind, key, coalesce(role, ''), coalesce(in_series, '')) do update set quantity = excluded.quantity
  returning id into v_id;

  select count(*) into v_before from public.reservations r join public.reservation_orders o on o.id = r.order_id where o.customer_id = c.id;
  perform public.apply_subscriptions(c.id);
  select count(*) - v_before into v_added from public.reservations r join public.reservation_orders o on o.id = r.order_id where o.customer_id = c.id;
  return jsonb_build_object('id', v_id, 'added', v_added);
end;
$$;

-- The old six-argument form (follow_series, follow_artist and their staff versions call it): no series.
create or replace function public._subscribe(c public.customers, p_kind text, p_key text, p_label text, p_role text, p_quantity int)
returns jsonb
language sql security definer set search_path = public
as $$ select public._subscribe(c, p_kind, p_key, p_label, p_role, p_quantity, null, null); $$;

revoke execute on function public._subscribe(public.customers, text, text, text, text, int),
  public._subscribe(public.customers, text, text, text, text, int, text, text) from public, anon, authenticated;

-- Every cover this artist draws on one series. Returns { id, added } like follow_artist.
create or replace function public._follow_artist_in_series(c public.customers, p_name text, p_series text, p_quantity int)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_key    text := public.person_key(p_name);
  v_series text := public._series_resolve(p_series);
  v_name   text;
begin
  if v_series is null then raise exception 'Pick a series.' using errcode = 'P0001'; end if;
  select name into v_name from public.item_creators where key = v_key order by length(name) desc limit 1;
  return public._subscribe(c, 'artist', v_key, coalesce(v_name, trim(p_name)), 'cover', p_quantity,
                           v_series, coalesce(public._series_label(v_series), v_series));
end;
$$;
revoke execute on function public._follow_artist_in_series(public.customers, text, text, int) from public, anon, authenticated;

create or replace function public.follow_artist_in_series(p_name text, p_series text, p_quantity int default 1)
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  return public._follow_artist_in_series(public._pull_list_customer(), p_name, p_series, p_quantity);
end;
$$;

create or replace function public.staff_follow_artist_in_series(p_customer bigint, p_name text, p_series text, p_quantity int default 1)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  c public.customers;
begin
  if not public.is_staff() then raise exception 'Staff only.' using errcode = '42501'; end if;
  select * into c from public.customers where id = p_customer;
  if c.id is null then raise exception 'That customer no longer exists.' using errcode = 'P0001'; end if;
  return public._follow_artist_in_series(c, p_name, p_series, p_quantity);
end;
$$;

revoke execute on function public.follow_artist_in_series(text, text, int), public.staff_follow_artist_in_series(bigint, text, text, int) from public, anon;
grant execute on function public.follow_artist_in_series(text, text, int), public.staff_follow_artist_in_series(bigint, text, text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Matching
-- ---------------------------------------------------------------------------

-- Same as 20270406000000_series_follow_skip_reprints, except a cover-artist follow on one series covers only its titles.
create or replace function public._follow_covers(s public.subscriptions, i public.items)
returns boolean
language sql stable security definer set search_path = public
as $$
  select (s.kind = 'series' and i.series_key = s.key and not public.is_reprint(i.title, i.variant, i.badges))
      or (s.kind = 'artist' and s.role = 'cover'
          and (s.in_series is null or i.series_key = s.in_series)
          and (exists (select 1 from public.item_creators ic where ic.item_id = i.id and ic.key = s.key and ic.role = 'cover')
               or (s.key like '% %' and i.variant_words like '% ' || s.key || ' %')))
      or (s.kind = 'artist' and s.role = 'creator'
          and exists (select 1 from public.item_creators ic where ic.item_id = i.id and ic.key = s.key));
$$;

-- Same as 20270406000000_series_follow_skip_reprints, except the two cover-artist matches check in_series.
CREATE OR REPLACE FUNCTION public.apply_subscriptions(p_customer bigint DEFAULT NULL::bigint, p_cap integer DEFAULT 60)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m       record;
  c       public.customers;
  item    public.items;
  v_total   int := 0;
  v_n       int := 0;
  v_problem text;
begin
  for m in
    with open_items as materialized (
      select i.id, i.series_key, i.mature,
             public.is_reprint(i.title, i.variant, i.badges) as reprint,
             row_number() over (
               partition by lower(trim(i.title)), i.issue_number, i.publisher
               order by (i.variant is null) desc, (i.variant ~* '^(cvr|cover)\s*a\M') desc, i.id
             ) as rn
      from public.items i
      where i.status = 'pre_order' and not i.hidden
        and not public.is_incentive_variant(i.variant)
        and (i.foc_date is null or i.foc_date > (select public.reservations_close_through()))
    ),
    subs as (select * from public.subscriptions where p_customer is null or customer_id = p_customer),
    matches as (
      -- series: the main cover of each issue, or every cover when the follow is set to all covers
      select s.customer_id, oi.id as item_id, s.quantity, s.kind
      from subs s join open_items oi on s.kind = 'series' and (oi.rn = 1 or s.all_covers) and oi.series_key = s.key and not oi.reprint
      union all
      -- credited cover artists: every cover they drew (on one series, when the follow names one)
      select s.customer_id, oi.id, s.quantity, s.kind
      from subs s
      join public.item_creators ic on s.kind = 'artist' and s.role = 'cover' and ic.key = s.key and ic.role = 'cover'
      join open_items oi on oi.id = ic.item_id and (s.in_series is null or oi.series_key = s.in_series)
      union all
      -- writers and artists: the main cover of each issue they're on
      select s.customer_id, oi.id, s.quantity, s.kind
      from subs s
      join public.item_creators ic on s.kind = 'artist' and s.role = 'creator' and ic.key = s.key
      join open_items oi on oi.id = ic.item_id and oi.rn = 1
      union all
      -- cover artists named only in the cover text
      select s.customer_id, oi.id, s.quantity, s.kind
      from subs s
      join public.items i on s.kind = 'artist' and s.role = 'cover' and s.key like '% %'
                         and i.variant_words like '% ' || s.key || ' %'
      join open_items oi on oi.id = i.id and (s.in_series is null or oi.series_key = s.in_series)
    ),
    picked as (
      select distinct on (mt.customer_id, mt.item_id) mt.*
      from matches mt
      order by mt.customer_id, mt.item_id, (mt.kind = 'artist') desc
    )
    select p.*
    from picked p
    join public.customers cu on cu.id = p.customer_id
    join open_items oi on oi.id = p.item_id
    where (cu.email is not null or cu.phone is not null) -- a pull list order needs one of them
      and (cu.mature_ok or not oi.mature)
      and not exists (select 1 from public.pull_list_exclusions x where x.customer_id = p.customer_id and x.item_id = p.item_id)
      and not exists (
        select 1 from public.reservations r join public.reservation_orders o on o.id = r.order_id
        where r.item_id = p.item_id and o.customer_id = p.customer_id)
    order by p.customer_id, p.item_id
  loop
    if c.id is distinct from m.customer_id then
      select * into c from public.customers where id = m.customer_id;
      v_n := 0;
    end if;
    continue when v_n >= p_cap;
    select * into item from public.items where id = m.item_id;
    v_problem := public._pull_list_problem(c, item, m.quantity);
    if v_problem is null then
      if public._pull_list_put(c, item, m.quantity, m.kind, true) is not null then
        v_n := v_n + 1;
        v_total := v_total + 1;
      end if;
    elsif v_problem like 'Your pull list is full%' then
      v_n := p_cap; -- nothing more fits on this customer's list: skip the rest of their titles
    end if;
  end loop;
  return v_total;
end;
$function$;
revoke execute on function public.apply_subscriptions(bigint, int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The pull-list import names the unique index's columns in its insert: give it the new one.
-- ---------------------------------------------------------------------------

do $$
declare
  v_def text := pg_get_functiondef('public._pull_import_save_customer(public.import_customers)'::regprocedure);
  v_old text := 'on conflict (customer_id, kind, key, coalesce(role, ''''))';
  v_new text := 'on conflict (customer_id, kind, key, coalesce(role, ''''), coalesce(in_series, ''''))';
begin
  if position(v_old in v_def) = 0 then
    raise exception '_pull_import_save_customer no longer has the insert this migration updates';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$$;

-- ---------------------------------------------------------------------------
-- Series and artist housekeeping
-- ---------------------------------------------------------------------------

-- Same as 20270204000000_catalog_sync_lists, plus artist follows on the old series move to the kept one.
create or replace function public._merge_series(p_from text, p_to text)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_n  int;
  v_to text := public._series_resolve(p_to);
begin
  if p_from is null or v_to is null or p_from = v_to then
    raise exception 'Pick two different series.' using errcode = 'P0001';
  end if;
  -- The active-list row: the kept series keeps its own cover and publisher, and takes the old one's when it has none.
  insert into public.series_catalog (key, title, publisher, cover_url)
  select v_to, left(coalesce(public._series_label(v_to), f.title), 200), f.publisher, f.cover_url
  from public.series_catalog f where f.key = p_from
  on conflict (key) do update set
    cover_url = coalesce(series_catalog.cover_url, excluded.cover_url),
    publisher = coalesce(series_catalog.publisher, excluded.publisher);
  delete from public.series_catalog where key = p_from;
  update public.items set series_key = v_to where series_key = p_from;
  get diagnostics v_n = row_count;
  -- Follows of the old key move over, unless the customer already follows the new one.
  delete from public.subscriptions s where s.kind = 'series' and s.key = p_from
    and exists (select 1 from public.subscriptions t where t.customer_id = s.customer_id and t.kind = 'series' and t.key = v_to);
  update public.subscriptions set key = v_to, label = coalesce(public._series_label(v_to), label) where kind = 'series' and key = p_from;
  -- Cover artists followed on the old series: the same, by artist.
  delete from public.subscriptions s where s.in_series = p_from
    and exists (select 1 from public.subscriptions t where t.customer_id = s.customer_id and t.kind = s.kind and t.key = s.key
                and t.role = s.role and t.in_series = v_to);
  update public.subscriptions set in_series = v_to, in_series_label = coalesce(public._series_label(v_to), in_series_label)
  where in_series = p_from;
  -- Future imports of the old title land on the merged key too.
  insert into public.series_aliases (from_key, to_key) values (p_from, v_to)
  on conflict (from_key) do update set to_key = excluded.to_key;
  update public.series_aliases set to_key = v_to where to_key = p_from;
  return v_n;
end;
$$;
revoke execute on function public._merge_series(text, text) from public, anon, authenticated;

-- Same as 20261224000000_owner_only_and_audit, plus cover-artist follows on that series go too.
create or replace function public.staff_delete_series(p_key text)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_titles int;
  v_follows int;
begin
  if not public.is_owner() then raise exception 'Only an owner can delete a series.' using errcode = '42501'; end if;
  select count(*) into v_titles from public.items where series_key = p_key;
  if v_titles > 0 then
    raise exception 'This series has % imported titles, so it can''t be deleted here. Delete or hide its titles first.', v_titles using errcode = 'P0001';
  end if;
  delete from public.subscriptions where (kind = 'series' and key = p_key) or in_series = p_key;
  get diagnostics v_follows = row_count;
  delete from public.series_catalog where key = p_key;
  return v_follows;
end;
$$;

-- Same as 20270123000000_artist_merge, except a follow is a duplicate only on the same series too.
create or replace function public._merge_artist(p_from text, p_to text, p_name text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_from public.creator_catalog;
  v_to   public.creator_catalog;
begin
  if p_from = p_to then return; end if;
  select * into v_from from public.creator_catalog where key = p_from;
  select * into v_to from public.creator_catalog where key = p_to;

  insert into public.creator_aliases (from_key, to_key) values (p_from, p_to)
  on conflict (from_key) do update set to_key = excluded.to_key;
  update public.creator_aliases set to_key = p_to where to_key = p_from;
  delete from public.creator_aliases where from_key = to_key;

  -- titles: a cover credit on either side wins
  update public.item_creators x set role = 'cover'
  where x.key = p_to and x.role <> 'cover'
    and exists (select 1 from public.item_creators f where f.item_id = x.item_id and f.key = p_from and f.role = 'cover');
  update public.item_creators f set key = p_to, name = coalesce(v_to.name, p_name)
  where f.key = p_from
    and not exists (select 1 from public.item_creators x where x.item_id = f.item_id and x.key = p_to);
  delete from public.item_creators where key = p_from;

  -- follows
  delete from public.subscriptions f
  where f.kind = 'artist' and f.key = p_from
    and exists (select 1 from public.subscriptions x where x.customer_id = f.customer_id and x.kind = 'artist'
                and x.key = p_to and x.role = f.role and x.in_series is not distinct from f.in_series);
  update public.subscriptions set key = p_to, label = coalesce(v_to.name, p_name) where kind = 'artist' and key = p_from;

  -- the list itself
  if v_to.key is not null then
    update public.creator_catalog
       set blocked = blocked or coalesce(v_from.blocked, false),
           source = case when source = 'staff' or v_from.source = 'staff' then 'staff' else source end
     where key = p_to;
    delete from public.creator_catalog where key = p_from;
  else
    update public.creator_catalog set key = p_to, name = p_name where key = p_from;
  end if;
end;
$$;
revoke execute on function public._merge_artist(text, text, text) from public, anon, authenticated;

-- Same as 20270414000000_log_customer_changes, except a cover artist followed on one series names it.
create or replace function public._log_customer_follow_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_sub      public.subscriptions := case when tg_op = 'DELETE' then old else new end;
  v_customer bigint;
  v_what     text;
begin
  if auth.uid() is null then return null; end if;
  v_customer := public._acting_customer(v_sub.customer_id);
  if v_customer is null then return null; end if;
  v_what := case when v_sub.kind = 'series' then 'Series: '
                 when v_sub.role = 'cover' then 'Cover artist: '
                 else 'Writer / artist: ' end || v_sub.label
            || case when v_sub.in_series is not null then ' on ' || coalesce(v_sub.in_series_label, v_sub.in_series) else '' end;

  if tg_op = 'INSERT' then
    insert into public.pull_list_log (customer_id, staff_user, by_customer, action, detail)
    values (v_customer, null, true, 'followed', v_what || ' × ' || new.quantity || case when new.all_covers then ', all covers' else '' end);
  elsif tg_op = 'DELETE' then
    insert into public.pull_list_log (customer_id, staff_user, by_customer, action, detail)
    values (v_customer, null, true, 'unfollowed', v_what);
  else
    if new.quantity is distinct from old.quantity then
      insert into public.pull_list_log (customer_id, staff_user, by_customer, action, detail)
      values (v_customer, null, true, 'follow', v_what || ': ' || old.quantity || ' → ' || new.quantity || ' per issue');
    end if;
    if new.all_covers is distinct from old.all_covers then
      insert into public.pull_list_log (customer_id, staff_user, by_customer, action, detail)
      values (v_customer, null, true, 'follow', v_what || ': all covers ' || case when new.all_covers then 'on' else 'off' end);
    end if;
  end if;
  return null;
end;
$$;
revoke execute on function public._log_customer_follow_change() from public, anon, authenticated;
