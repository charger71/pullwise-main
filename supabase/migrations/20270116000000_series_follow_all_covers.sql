-- Series follows: "All covers". Some customers want every variant cover of a series, not just the main one.
--  * subscriptions.all_covers (series only, off by default): the sweep adds every cover of each new issue instead of
--    only the main one. Incentive/ratio covers still never come in, and the usual checks apply (removed titles stay
--    removed, mature opt-in, copy limit, list size, per-run cap).
--  * set_follow_all_covers() / staff_set_follow_all_covers() switch it. Turning it on adds the open covers right
--    away; turning it off takes back the extra covers this follow added that haven't been ordered (the main cover
--    stays, and so does a cover another of the customer's follows also wants), like unfollow does.

alter table public.subscriptions add column all_covers boolean not null default false;
alter table public.subscriptions add constraint subscriptions_all_covers_chk check (not all_covers or kind = 'series');

-- Same as 20270109000000_follows_audit_fixes, except the series match: (oi.rn = 1 or s.all_covers).
create or replace function public.apply_subscriptions(p_customer bigint default null, p_cap int default 60)
returns int
language plpgsql security definer set search_path = public
as $$
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
             row_number() over (
               partition by lower(trim(i.title)), i.issue_number, i.publisher
               order by (i.variant is null) desc, (i.variant ~* '^(cvr|cover)\s*a\M') desc, i.id
             ) as rn
      from public.items i
      where i.status = 'pre_order' and not i.hidden
        and not public.is_incentive_variant(i.variant)
        and (i.foc_date is null or i.foc_date > public.reservations_close_through())
    ),
    subs as (select * from public.subscriptions where p_customer is null or customer_id = p_customer),
    matches as (
      -- series: the main cover of each issue, or every cover when the follow is set to all covers
      select s.customer_id, oi.id as item_id, s.quantity, s.kind
      from subs s join open_items oi on s.kind = 'series' and (oi.rn = 1 or s.all_covers) and oi.series_key = s.key
      union all
      -- credited cover artists: every cover they drew
      select s.customer_id, oi.id, s.quantity, s.kind
      from subs s
      join public.item_creators ic on s.kind = 'artist' and s.role = 'cover' and ic.key = s.key and ic.role = 'cover'
      join open_items oi on oi.id = ic.item_id
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
      join open_items oi on oi.id = i.id
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
    where (cu.mature_ok or not oi.mature)
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
$$;
revoke execute on function public.apply_subscriptions(bigint, int) from public, anon, authenticated;

-- Switches all covers on or off for a series follow. Returns { added, removed }.
create or replace function public._set_follow_all_covers(s public.subscriptions, p_on boolean)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_before int;
  v_ids    bigint[];
begin
  if s.kind <> 'series' then
    raise exception 'All covers is only for series.' using errcode = 'P0001';
  end if;
  update public.subscriptions set all_covers = coalesce(p_on, false) where id = s.id returning * into s;

  if s.all_covers then
    select count(*) into v_before from public.reservations r join public.reservation_orders o on o.id = r.order_id where o.customer_id = s.customer_id;
    perform public.apply_subscriptions(s.customer_id);
    return jsonb_build_object('added',
      (select count(*) from public.reservations r join public.reservation_orders o on o.id = r.order_id where o.customer_id = s.customer_id) - v_before,
      'removed', 0);
  end if;

  -- Off: the open lines this follow added that aren't the main cover of their issue (same ranking as the sweep).
  with ranked as (
    select i.id,
           row_number() over (
             partition by lower(trim(i.title)), i.issue_number, i.publisher
             order by (i.variant is null) desc, (i.variant ~* '^(cvr|cover)\s*a\M') desc, i.id
           ) as rn
    from public.items i
    where i.series_key = s.key and i.status = 'pre_order' and not i.hidden
      and not public.is_incentive_variant(i.variant)
      and (i.foc_date is null or i.foc_date > public.reservations_close_through())
  )
  select coalesce(array_agg(l.id), '{}') into v_ids
  from public._follow_open_lines(s) l
  join public.items i on i.id = l.item_id
  where not exists (select 1 from ranked k where k.id = l.item_id and k.rn = 1)
    and not exists (
      select 1 from public.subscriptions other
      where other.customer_id = s.customer_id and other.id <> s.id and public._follow_covers(other, i));
  delete from public.reservations where id = any (v_ids);
  return jsonb_build_object('added', 0, 'removed', cardinality(v_ids));
end;
$$;

create or replace function public.set_follow_all_covers(p_id bigint, p_on boolean)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  c public.customers := public._pull_list_customer();
  s public.subscriptions;
begin
  select * into s from public.subscriptions where id = p_id and customer_id = c.id;
  if s.id is null then return jsonb_build_object('added', 0, 'removed', 0); end if;
  return public._set_follow_all_covers(s, p_on);
end;
$$;

create or replace function public.staff_set_follow_all_covers(p_customer bigint, p_id bigint, p_on boolean)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  s public.subscriptions;
begin
  if not public.is_staff() then raise exception 'Staff only.' using errcode = '42501'; end if;
  select * into s from public.subscriptions where id = p_id and customer_id = p_customer;
  if s.id is null then return jsonb_build_object('added', 0, 'removed', 0); end if;
  return public._set_follow_all_covers(s, p_on);
end;
$$;

revoke execute on function public._set_follow_all_covers(public.subscriptions, boolean) from public, anon, authenticated;
revoke execute on function public.set_follow_all_covers(bigint, boolean), public.staff_set_follow_all_covers(bigint, bigint, boolean) from public, anon;
grant execute on function public.set_follow_all_covers(bigint, boolean), public.staff_set_follow_all_covers(bigint, bigint, boolean) to authenticated;
