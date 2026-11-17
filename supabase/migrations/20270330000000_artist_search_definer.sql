-- Artist search: run past row-level security so its text matching can use the trigram indexes.
--
-- Run as the visitor, every items row it matched against cover text went through the items policies first, and
-- Postgres won't apply a LIKE (not leakproof) ahead of them, so the variant_words trigram index went unused and each
-- search scanned the titles several times: ~150-250 ms a search for visitors and staff (the owner-only timings in
-- 20270326000000 were ~45 ms). As SECURITY DEFINER it skips the policies; it already keeps to visible titles
-- everywhere, and the one check that saw hidden titles for staff (a guess that is really a series name) keeps doing
-- so for staff only. Same results in the same order for 30 searches on four shops, signed out, as a customer and as
-- staff; 150-250 ms -> 32-58 ms.

create or replace function public.search_artists(p_q text)
returns table (name text, covers bigint, issues bigint)
language sql stable security definer set search_path = public
as $fn$
with q as (select public._search_tokens(p_q) as toks, public.person_key(p_q) as key),
  -- Credited people: every word of the search somewhere in the name, in any order, accents and punctuation ignored.
  -- Artist-list names matching every word: the key or the name staff gave it (search_text holds both). A credited
  -- key with no list row (an artist deleted while credits remained) is matched on the key alone.
  pats as (select array(select '%' || t || '%' from unnest(q.toks) t) as p from q),
  matched as (
    select cc.key from q, pats, public.creator_catalog cc
    where length(replace(coalesce(q.key, ''), ' ', '')) >= 2 and not cc.blocked and cc.search_text like all (pats.p)
    union
    select distinct ic.key from q, pats, public.item_creators ic
    where length(replace(coalesce(q.key, ''), ' ', '')) >= 2 and ic.key like all (pats.p)
      and not exists (select 1 from public.creator_catalog c2 where c2.key = ic.key)
  ),
  -- Credited people: every word of the search somewhere in the name, in any order, accents and punctuation ignored.
  credited as (
    select ic.key, coalesce(max(cc.name), (array_agg(ic.name order by length(ic.name) desc))[1]) as name, count(*) as issues
    from matched m
    join public.item_creators ic on ic.key = m.key
    join public.items i on i.id = ic.item_id and not i.hidden
    left join public.creator_catalog cc on cc.key = ic.key
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
  -- A full name as typed, or with its words reversed ("momoko peach" -> "peach momoko").
  typed_names as (
    select k from q, stop,
         lateral (values (q.key),
                         (array_to_string(array(select w from unnest(string_to_array(q.key, ' ')) with ordinality u(w, o) order by o desc), ' '))) v(k)
    where q.key like '% %' and not (string_to_array(q.key, ' ') && stop.words)
  ),
  -- For one word ("momoko"), the two-word names it forms with the word before or after it in cover text. Only the
  -- side where its most common pairing is found is kept ("PEACH" is always before "MOMOKO", while descriptors after
  -- it vary), ties to the word before; and a pairing whose partner word belongs to a more common name is dropped.
  pairs as (
    select s.side, case when s.side = -1 then a.w[n - 1] || ' ' || a.w[n] else a.w[n] || ' ' || a.w[n + 1] end as key,
           count(distinct i.id) as hits
    from q, stop, public.items i,
         lateral (select string_to_array(trim(i.variant_words), ' ') as w) a,
         lateral generate_subscripts(a.w, 1) n,
         (values (-1), (1)) s(side)
    where q.key ~ '^[a-z]{3,}$'
      and q.key <> all (stop.words)
      and not i.hidden
      and i.variant_words like '% ' || q.key || ' %'
      and a.w[n] = q.key
      and a.w[n + s.side] ~ '^[a-z]{2,}$'
      and a.w[n + s.side] <> all (stop.words)
    group by 1, 2
  ),
  name_side as (select side from pairs order by hits desc, side limit 1),
  kept as (select p.side, p.key, p.hits, split_part(p.key, ' ', case when p.side = -1 then 1 else 2 end) as partner
           from pairs p join name_side ns on ns.side = p.side),
  partner_pairs as (
    select k.key, count(distinct i.id) as hits
    from kept k, q, stop, public.items i,
         lateral (select string_to_array(trim(i.variant_words), ' ') as w) a,
         lateral generate_subscripts(a.w, 1) n,
         (values (-1), (1)) s(side)
    where not i.hidden
      and i.variant_words like '% ' || k.partner || ' %'
      and a.w[n] = k.partner
      and a.w[n + s.side] ~ '^[a-z]{2,}$'
      and a.w[n + s.side] <> all (stop.words)
      and a.w[n + s.side] <> q.key
    group by k.key, s.side, a.w[n + s.side]
  ),
  -- Names staff added to the artist list by hand: trusted, so cover text is searched for them directly.
  listed as (
    select cc.key from q, public.creator_catalog cc
    where cc.source = 'staff' and not cc.blocked and cc.key like '% %'
      and not exists (select 1 from unnest(q.toks) t where cc.key not like '%' || t || '%')
  ),
  candidates as (
    select k as key, false as trusted from typed_names
    union
    select k.key, false from kept k
    where not exists (select 1 from partner_pairs pp where pp.key = k.key and pp.hits > k.hits)
    union
    select key, true from listed
  ),
  typed as (
    select c.key, initcap(c.key) as name, 0::bigint as issues
    from candidates c
    -- not already listed as (part of) a credited name: "garcia lopez" is José Luis García-López
    where not exists (select 1 from credited cr where ' ' || cr.key || ' ' like '% ' || c.key || ' %')
      and exists (select 1 from public.items i where not i.hidden and i.variant_words like '% ' || c.key || ' %')
      -- never a name staff blocked on the artist list
      and not exists (select 1 from public.creator_catalog b where b.blocked and ' ' || b.key || ' ' like '% ' || c.key || ' %')
      -- a guess isn't a series named in the cover text ("CVR A NATHAN GOODEN ABSOLUTE BATMAN 1 HOMAGE")
      and (c.trusted
           or (not exists (select 1 from public.items i where (not i.hidden or (select public.is_staff())) and ' ' || i.series_key || ' ' like '% ' || c.key || ' %')
               and not exists (select 1 from public.series_catalog sc where ' ' || sc.key || ' ' like '% ' || c.key || ' %')))
  ),
  people as (select * from credited union all select * from typed)
  select p.name,
         (select count(*) from (
            select ic.item_id from public.item_creators ic join public.items i on i.id = ic.item_id and not i.hidden
            where ic.key = p.key and ic.role = 'cover'
            union
            select i.id from public.items i
            where not i.hidden and p.key like '% %' and i.variant_words like '% ' || p.key || ' %'
          ) x) as covers,
         p.issues
  from people p
  order by 2 desc, 3 desc
  limit 20;
$fn$;
