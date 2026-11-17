-- The shop's date (shop_today) and the reservation cutoff (reservations_close_through), cheap enough to call per row.
--
-- Both were SQL functions with their own search_path, which Postgres can't inline, and reservations_close_through
-- calls shop_today twice: every call re-planned three function bodies. Many queries call them once per title or
-- line (the hourly pull-list sweep, follows, the status flip, imports, counts_for_order), so filtering ~2,600
-- pre-order titles on the cutoff took 0.8 seconds. As PL/pgSQL their plans are kept: 86 ms for the same filter.
--
-- The pull-list sweep (apply_subscriptions, run hourly and on every follow) now also works the cutoff out once per
-- run. Same titles added: checked on two shops by removing follow lines and letting the sweep put them back.
-- 0.4-1.0 s -> 25-80 ms a run.

create or replace function public.shop_today()
returns date
language plpgsql stable security definer set search_path = public
as $$
begin
  return (now() at time zone coalesce((select timezone from public.settings where id = 1), 'America/New_York'))::date;
end;
$$;

create or replace function public.reservations_close_through()
returns date
language plpgsql stable security definer set search_path = public
as $$
declare
  d date := public.shop_today();
begin
  return d + ((6 - extract(dow from d)::int) % 7);
end;
$$;

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
