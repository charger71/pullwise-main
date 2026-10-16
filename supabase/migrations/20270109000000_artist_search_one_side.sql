-- Follow search: a one-word search ("momoko") also offered descriptor pairs from the cover text as artists
-- ("Momoko Momo", "Momoko Midnight" from "PEACH MOMOKO MIDNIGHT VAR"). Now only names on one side of the typed word
-- are offered: the side where its most common pairing is found, and not a pairing whose partner word belongs to a more
-- common name ("midnight" no longer offers "Momoko Midnight"). See search_artists below. Same result columns.

create or replace function public.search_artists(p_q text)
returns table (name text, covers bigint, issues bigint)
language sql stable set search_path = public
as $$
  with q as (select replace(replace(trim(p_q), '%', ''), '_', '') as t),
  credited as (
    select ic.key, (array_agg(ic.name order by length(ic.name) desc))[1] as name, count(*) as issues
    from public.item_creators ic
    join public.items i on i.id = ic.item_id and not i.hidden, q
    where ic.name ilike '%' || q.t || '%' and length(q.t) >= 2
    group by ic.key
    order by count(*) desc
    limit 40
  ),
  -- Words in cover text that are cover codes, not names.
  stop as (select array['cvr', 'cover', 'covers', 'var', 'variant', 'card', 'stock', 'cardstock', 'cs', 'foil',
        'virgin', 'incv', 'inc', 'ratio', 'blank', 'sketch', 'homage', 'connecting', 'design', 'team', 'the', 'of', 'and',
        'by', 'edition', 'ed', 'exc', 'excl', 'exclusive', 'ltd', 'limited', 'puzzle', 'trading', 'wraparound', 'wrap',
        'glow', 'metal', 'hc', 'tp', 'mr', 'new', 'open', 'order', 'second', 'third', 'printing', 'ptg', 'print', 'black',
        'white', 'color', 'spot', 'acetate', 'lenticular', 'textured', 'negative', 'gold', 'silver', 'red', 'blue', 'green',
        'movie', 'game', 'anime', 'manga', 'retro', 'classic', 'facsimile', 'reprint', 'fried', 'pie', 'midtown'] as words),
  -- A full name as typed ("peach momoko"). For one word ("momoko"), the two-word names it forms with the word before
  -- or after it in cover text, skipping cover codes. The typed word is either a first name or a surname, so the real
  -- name always sits on the same side: only the side whose most common pairing is most frequent is kept ("PEACH" is
  -- always before "MOMOKO", while descriptors after it vary: "MOMOKO MOMO", "MOMOKO MIDNIGHT"). Ties go to the word
  -- before, since people mostly type surnames.
  pairs as (
    select s.side, case when s.side = -1 then a.w[n - 1] || ' ' || a.w[n] else a.w[n] || ' ' || a.w[n + 1] end as key,
           count(distinct i.id) as hits
    from q, stop, public.items i,
         lateral (select string_to_array(public.person_key(i.variant), ' ') as w) a,
         lateral generate_subscripts(a.w, 1) n,
         (values (-1), (1)) s(side)
    where public.person_key(q.t) ~ '^[a-z]{3,}$'
      and public.person_key(q.t) <> all (stop.words)
      and not i.hidden
      and public.person_key(i.variant) like '%' || public.person_key(q.t) || '%'
      and a.w[n] = public.person_key(q.t)
      and a.w[n + s.side] ~ '^[a-z]{2,}$'
      and a.w[n + s.side] <> all (stop.words)
    group by 1, 2
  ),
  name_side as (select side from pairs order by hits desc, side limit 1),
  kept as (select p.side, p.key, p.hits, split_part(p.key, ' ', case when p.side = -1 then 1 else 2 end) as partner
           from pairs p join name_side ns on ns.side = p.side),
  -- A pairing is dropped when its partner word belongs to a more common name: searching "midnight" finds
  -- "MOMOKO MIDNIGHT" once, but "MOMOKO" goes with "PEACH" on more covers, so "Momoko Midnight" is no name.
  partner_pairs as (
    select k.key, count(distinct i.id) as hits
    from kept k, q, stop, public.items i,
         lateral (select string_to_array(public.person_key(i.variant), ' ') as w) a,
         lateral generate_subscripts(a.w, 1) n,
         (values (-1), (1)) s(side)
    where not i.hidden
      and public.person_key(i.variant) like '%' || k.partner || '%'
      and a.w[n] = k.partner
      and a.w[n + s.side] ~ '^[a-z]{2,}$'
      and a.w[n + s.side] <> all (stop.words)
      and a.w[n + s.side] <> public.person_key(q.t)
    group by k.key, s.side, a.w[n + s.side]
  ),
  candidates as (
    select public.person_key(q.t) as key from q, stop
    where public.person_key(q.t) like '% %' and not (string_to_array(public.person_key(q.t), ' ') && stop.words)
    union
    select k.key from kept k
    where not exists (select 1 from partner_pairs pp where pp.key = k.key and pp.hits > k.hits)
  ),
  typed as (
    select c.key, initcap(c.key) as name, 0::bigint as issues
    from candidates c
    where not exists (select 1 from credited cr where cr.key = c.key)
      and exists (select 1 from public.items i where not i.hidden and public._variant_names(i.variant, c.key))
  ),
  people as (select * from credited union all select * from typed)
  select p.name,
         (select count(*) from public.items i
          where not i.hidden
            and (exists (select 1 from public.item_creators ic where ic.item_id = i.id and ic.key = p.key and ic.role = 'cover')
                 or (p.key like '% %' and public._variant_names(i.variant, p.key)))) as covers,
         p.issues
  from people p
  order by 2 desc, 3 desc
  limit 20;
$$;
