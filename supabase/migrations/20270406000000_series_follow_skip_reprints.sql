-- Series follows: no facsimiles, no later printings, and a preview of the next issue before following.
--  * is_reprint(): a facsimile edition ("FACSIMILE EDITION", or the Facsimile badge) or a later printing
--    ("2ND PTG", "3RD PRINTING", "SECOND PRINT", "NEW PTG", "REPRINT"); a first printing still counts.
--  * The sweep (apply_subscriptions) no longer adds those to a series follow, main cover or all covers. Artist
--    follows are unchanged. _follow_covers() agrees, so unfollowing doesn't count them as the follow's.
--  * Lines a series follow already added for one, still open and before the order cutoff, are taken off (another
--    of the customer's follows that wants it keeps it), the way unfollowing would.
--  * series_follow_preview(): the next issue of a series still open for ordering (earliest order cutoff), shown in
--    the "Follow this series?" question before the follow is made.

create or replace function public.is_reprint(p_title text, p_variant text, p_badges text[] default '{}')
returns boolean
language sql immutable
as $$
  select coalesce('facsimile' = any (p_badges), false)
      or (coalesce(p_title, '') || ' ' || coalesce(p_variant, '')) ~* (
           '\mfacsimile\M'
           || '|\mre-?print(s|ing)?\M'
           || '|\m(([2-9]|[1-9][0-9])(nd|rd|th)|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|new)\s*(ptg|prtg|prt|printing|print)\M');
$$;

-- Same as 20270111000000_pull_list_audit_fixes, except a series never covers a reprint.
create or replace function public._follow_covers(s public.subscriptions, i public.items)
returns boolean
language sql stable security definer set search_path = public
as $$
  select (s.kind = 'series' and i.series_key = s.key and not public.is_reprint(i.title, i.variant, i.badges))
      or (s.kind = 'artist' and s.role = 'cover'
          and (exists (select 1 from public.item_creators ic where ic.item_id = i.id and ic.key = s.key and ic.role = 'cover')
               or (s.key like '% %' and i.variant_words like '% ' || s.key || ' %')))
      or (s.kind = 'artist' and s.role = 'creator'
          and exists (select 1 from public.item_creators ic where ic.item_id = i.id and ic.key = s.key));
$$;

-- Same as 20270327000000_shop_dates_cached, except the series match skips reprints (and not oi.reprint).
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
revoke execute on function public.apply_subscriptions(bigint, int) from public, anon, authenticated;

-- Reprints a series follow already added, not ordered yet: off the list (unless an artist follow wants them).
delete from public.reservations r
using public.reservation_orders o, public.items i
where o.id = r.order_id and i.id = r.item_id
  and r.source = 'series' and r.status = 'open'
  and (i.foc_date is null or i.foc_date > public.reservations_close_through())
  and public.is_reprint(i.title, i.variant, i.badges)
  and not exists (
    select 1 from public.subscriptions s
    where s.customer_id = o.customer_id and s.kind = 'artist' and public._follow_covers(s, i));

-- The next issue of a series open for ordering, for the question before following it. Returns
--   { label, issues, next }   issues: how many issues are open for ordering now (each would be added)
--                             next: { id, title, issue_number, variant, foc_date, release_date } with the earliest
--                                   order cutoff (its main cover), or null when none is open yet.
-- Counts the same titles the sweep would add, before the customer's own removals, mature setting and list limits.
create or replace function public.series_follow_preview(p_key text)
returns jsonb
language sql stable security definer set search_path = public
as $$
  with k as (select public._series_resolve(p_key) as key),
  open_issues as (
    select i.*,
           row_number() over (
             partition by lower(trim(i.title)), i.issue_number, i.publisher
             order by (i.variant is null) desc, (i.variant ~* '^(cvr|cover)\s*a\M') desc, i.id
           ) as rn
    from public.items i, k
    where i.series_key = k.key and i.status = 'pre_order' and not i.hidden
      and not public.is_incentive_variant(i.variant)
      and not public.is_reprint(i.title, i.variant, i.badges)
      and (i.foc_date is null or i.foc_date > public.reservations_close_through())
  ),
  mains as (select * from open_issues where rn = 1)
  select jsonb_build_object(
    'label', coalesce(public._series_label((select key from k)), (select key from k)),
    'issues', (select count(*) from mains),
    'next', (select jsonb_build_object('id', m.id, 'title', m.title, 'issue_number', m.issue_number, 'variant', m.variant,
                                       'foc_date', m.foc_date, 'release_date', m.release_date)
             from mains m
             order by m.foc_date nulls last, m.release_date nulls last, m.id
             limit 1));
$$;

revoke execute on function public.series_follow_preview(text) from public, anon;
grant execute on function public.series_follow_preview(text) to authenticated;
