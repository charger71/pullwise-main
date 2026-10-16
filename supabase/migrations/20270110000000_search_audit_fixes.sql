-- Search audit fixes.
--  1. Accented names: person_key() dropped accented letters ("José García-López" -> "jos garc a l pez"), so accented
--     creators couldn't be found without typing the accents, and their credits and cover text gave different keys.
--     Accents are now folded the way titles already are (_squash). Creator keys and artist follows are rebuilt.
--  2. Artist search speed: it re-read every title's cover text for each candidate artist (seconds on a large
--     catalog). Cover text is now kept pre-normalised in items.variant_words with a trigram index.
--  3. Artist search matches every word of the search in any order ("momoko peach" finds Peach Momoko).
--  4. Series search returns the newest issue's cover when the series has none, so series without a cover set in
--     Admin -> Series still show on the site search.

-- 1 -------------------------------------------------------------------------------------------------------------
create or replace function public.person_key(p_name text)
returns text
language sql immutable
as $$
  select nullif(trim(regexp_replace(
    translate(lower(coalesce(p_name, '')), 'áàâäãåéèêëíìîïóòôöõúùûüñçß', 'aaaaaaeeeeiiiiooooouuuuncs'),
    '[^a-z0-9]+', ' ', 'g')), '');
$$;

-- A name on the cover text marks that person as the cover's artist; compared as keys so accents don't matter.
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
         case when v_variant is not null
               and ' ' || coalesce(public.person_key(v_variant), '') || ' ' like '% ' || public.person_key(n.name) || ' %'
              then 'cover' else 'creator' end
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

do $$
declare
  r record;
begin
  for r in select id from public.items where creators is not null loop
    perform public._sync_item_creators(r.id);
  end loop;
end $$;

-- Artist follows: re-key from the name they were made with. Two follows that now share a key keep the older one.
delete from public.subscriptions s
where s.kind = 'artist'
  and exists (select 1 from public.subscriptions t
              where t.customer_id = s.customer_id and t.kind = 'artist' and t.role = s.role and t.id < s.id
                and public.person_key(t.label) = public.person_key(s.label));
update public.subscriptions set key = public.person_key(label)
where kind = 'artist' and public.person_key(label) is not null and key is distinct from public.person_key(label);

-- 2 -------------------------------------------------------------------------------------------------------------
alter table public.items
  add column variant_words text generated always as (' ' || coalesce(public.person_key(variant), '') || ' ') stored;
create index items_variant_words_trgm_idx on public.items using gin (variant_words gin_trgm_ops);

-- 2 + 3 ---------------------------------------------------------------------------------------------------------
create or replace function public.search_artists(p_q text)
returns table (name text, covers bigint, issues bigint)
language sql stable set search_path = public
as $$
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
$$;

-- 4 -------------------------------------------------------------------------------------------------------------
create or replace function public.search_series(p_q text)
returns table (key text, label text, issues bigint, cover_url text)
language sql stable set search_path = public
as $$
  with q as (
    select coalesce(nullif(array(select t from unnest(public._search_tokens(p_q)) t where t !~ '^[0-9]+$'), '{}'), public._search_tokens(p_q)) as toks,
           length(public._squash(p_q)) as n
  ),
  s as (
    select i.series_key as k, (array_agg(i.title order by length(i.title), i.created_at desc))[1] as l, count(distinct i.issue_number) as n
    from public.items i
    left join public.categories cat on cat.id = i.category_id, q
    where i.issue_number is not null and i.series_key is not null and not i.hidden
      and coalesce(cat.slug, 'comics') in ('comics', 'trades', 'omnibuses')
      and q.n >= 2 and cardinality(q.toks) > 0
      and not exists (select 1 from unnest(q.toks) t where public._squash(i.title) not like '%' || t || '%')
    group by i.series_key
  ),
  c as (
    select sc.key as k, sc.title as l, 0::bigint as n
    from public.series_catalog sc, q
    where q.n >= 2 and cardinality(q.toks) > 0
      and not exists (select 1 from unnest(q.toks) t where public._squash(sc.title) not like '%' || t || '%')
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
