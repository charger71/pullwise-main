-- Artist search: a series named in cover text (homage covers: "CVR A NATHAN GOODEN ABSOLUTE BATMAN 1 HOMAGE") was
-- offered as a cover artist ("Absolute Batman"). A name found only in cover text is now skipped when it is (part of)
-- a series title. Credited people are unaffected. Otherwise the same as the live function (20270107).

create or replace function public.search_artists(p_q text)
 RETURNS TABLE(name text, covers bigint, issues bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with q as (select public._search_tokens(p_q) as toks, public.person_key(p_q) as key),
  -- Credited people: every word of the search somewhere in the name, in any order, accents and punctuation ignored.
  credited as (
    select ic.key, (array_agg(ic.name order by length(ic.name) desc))[1] as name, count(*) as issues
    from q, public.item_creators ic
    join public.items i on i.id = ic.item_id and not i.hidden
    where length(replace(coalesce(q.key, ''), ' ', '')) >= 2
      and not exists (select 1 from unnest(q.toks) t where ic.key not like '%' || t || '%')
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
  candidates as (
    select k as key from typed_names
    union
    select k.key from kept k
    where not exists (select 1 from partner_pairs pp where pp.key = k.key and pp.hits > k.hits)
  ),
  typed as (
    select c.key, initcap(c.key) as name, 0::bigint as issues
    from candidates c
    -- not already listed as (part of) a credited name: "garcia lopez" is José Luis García-López
    where not exists (select 1 from credited cr where ' ' || cr.key || ' ' like '% ' || c.key || ' %')
      and exists (select 1 from public.items i where not i.hidden and i.variant_words like '% ' || c.key || ' %')
      -- not a series named in the cover text ("CVR A NATHAN GOODEN ABSOLUTE BATMAN 1 HOMAGE")
      and not exists (select 1 from public.items i where ' ' || i.series_key || ' ' like '% ' || c.key || ' %')
      and not exists (select 1 from public.series_catalog sc where ' ' || sc.key || ' ' like '% ' || c.key || ' %')
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
$function$;
