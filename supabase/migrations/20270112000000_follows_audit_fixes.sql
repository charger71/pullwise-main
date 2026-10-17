-- Follows audit fixes.
--  1. The hourly sweep (apply_subscriptions) rebuilt the list of open titles once per customer: about 0.7 s each,
--     so 300 followers took 3-5 minutes every hour and it grew with every customer. Open titles are now worked out
--     once per run and every follow is matched against them in one pass (cover text through the indexed
--     items.variant_words). Same rules as before: series and writer/artist follows add one cover per issue (the main
--     one), cover-artist follows every cover they drew; incentive covers, closed titles, mature titles for customers
--     who haven't opted in, removed titles and titles already on the list are skipped; at most p_cap titles per
--     customer per run; the copy limit and list size are checked for each title, and a full list is skipped for the
--     rest of the run.
--  2. item_cover_artists(): the cover artist named in a variant's cover text ("CVR C PEACH MOMOKO CARD STOCK VAR"),
--     for the follow dialog on a title, which only listed the people credited on it.

-- 1 -------------------------------------------------------------------------------------------------------------
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
      -- series: the main cover of each issue
      select s.customer_id, oi.id as item_id, s.quantity, s.kind
      from subs s join open_items oi on s.kind = 'series' and oi.rn = 1 and oi.series_key = s.key
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

-- 2 -------------------------------------------------------------------------------------------------------------
-- Words in cover text that are cover codes or descriptors, not names (as in search_artists).
create or replace function public._cover_code_words()
returns text[]
language sql immutable
as $$
  select array['cvr', 'cover', 'covers', 'var', 'variant', 'card', 'stock', 'cardstock', 'cs', 'foil',
    'virgin', 'incv', 'inc', 'ratio', 'blank', 'sketch', 'homage', 'connecting', 'design', 'team', 'the', 'of', 'and',
    'by', 'edition', 'ed', 'exc', 'excl', 'exclusive', 'ltd', 'limited', 'puzzle', 'trading', 'wraparound', 'wrap',
    'glow', 'metal', 'hc', 'tp', 'mr', 'new', 'open', 'order', 'second', 'third', 'printing', 'ptg', 'print', 'black',
    'white', 'color', 'spot', 'acetate', 'lenticular', 'textured', 'negative', 'gold', 'silver', 'red', 'blue', 'green',
    'movie', 'game', 'anime', 'manga', 'retro', 'classic', 'facsimile', 'reprint', 'fried', 'pie', 'midtown'];
$$;

-- The cover artist named in a title's cover text, when they aren't among its credited people. Two-word names from
-- the cover text, leaving out cover codes and words of the title itself ("SPIDER-MAN" on a Spider-Man cover is the
-- character); where two candidates share a word ("PEACH MOMOKO" / "MOMOKO MIDNIGHT") the one found on more covers
-- across the catalog wins. At most two.
create or replace function public.item_cover_artists(p_item bigint)
returns table (name text, covers bigint)
language sql stable security definer set search_path = public
as $$
  with it as (
    select string_to_array(trim(i.variant_words), ' ') as w, string_to_array(coalesce(public.person_key(i.title), ''), ' ') as tw
    from public.items i where i.id = p_item and not i.hidden
  ),
  pairs as (
    select distinct it.w[n] || ' ' || it.w[n + 1] as key, it.w[n] as a, it.w[n + 1] as b
    from it, generate_subscripts(it.w, 1) n
    where it.w[n] ~ '^[a-z]{2,}$' and it.w[n + 1] ~ '^[a-z]{2,}$'
      and it.w[n] <> all (public._cover_code_words()) and it.w[n + 1] <> all (public._cover_code_words())
      and it.w[n] <> all (it.tw) and it.w[n + 1] <> all (it.tw)
  ),
  counted as (
    select p.*, (select count(*) from public.items i where not i.hidden and i.variant_words like '% ' || p.key || ' %') as hits
    from pairs p
  )
  select initcap(c.key), c.hits
  from counted c
  where not exists (select 1 from counted o where o.key <> c.key and (o.a in (c.a, c.b) or o.b in (c.a, c.b)) and o.hits > c.hits)
    and not exists (select 1 from public.item_creators ic where ic.item_id = p_item and ' ' || ic.key || ' ' like '% ' || c.key || ' %')
  order by c.hits desc, c.key
  limit 2;
$$;
grant execute on function public.item_cover_artists(bigint), public._cover_code_words() to anon, authenticated;
