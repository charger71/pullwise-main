-- Cover artists named only in the cover text. Distributor sheets usually credit the main cover artist, but a
-- variant by someone else often names them only in the variant ("CVR B PEACH MOMOKO VAR"), so they never got into
-- item_creators: the follow search couldn't find them and a cover follow never matched those covers.
-- Now a full name (two words or more) that appears as whole words in a cover's variant text counts as that
-- cover's artist for the follow search, following, and the hourly sweep.

-- Does the variant text name this person (whole words, any case or punctuation)?
create or replace function public._variant_names(p_variant text, p_key text)
returns boolean
language sql immutable
as $$
  select p_key is not null and p_variant is not null
     and ' ' || coalesce(public.person_key(p_variant), '') || ' ' like '% ' || p_key || ' %';
$$;

-- Same result columns as before. Credited people come first as before; a full name typed into the box that only
-- appears in cover text comes back as a cover artist with no books (issues = 0).
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
  -- A full name as typed ("peach momoko"), or for one word ("momoko") the two-word names around it in cover text,
  -- skipping cover-code words ("CVR C MOMOKO CARD STOCK VAR" gives nothing; "PEACH MOMOKO VAR" gives "peach momoko").
  candidates as (
    select public.person_key(q.t) as key from q, stop
    where public.person_key(q.t) like '% %' and not (string_to_array(public.person_key(q.t), ' ') && stop.words)
    union
    select case when side = -1 then w[n - 1] || ' ' || w[n] else w[n] || ' ' || w[n + 1] end
    from q, stop, public.items i,
         lateral (select string_to_array(public.person_key(i.variant), ' ') as w) a,
         lateral generate_subscripts(a.w, 1) n,
         (values (-1), (1)) s(side)
    where public.person_key(q.t) ~ '^[a-z]{3,}$'
      and public.person_key(q.t) <> all (stop.words)
      and not i.hidden
      and public.person_key(i.variant) like '%' || public.person_key(q.t) || '%'
      and a.w[n] = public.person_key(q.t)
      and a.w[n + side] ~ '^[a-z]{2,}$'
      and a.w[n + side] <> all (stop.words)
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

do $$
declare
  v_src text;
  v_old text;
begin
  -- Following: a cover artist named only in cover text exists too.
  v_src := pg_get_functiondef('public._subscribe(public.customers, text, text, text, text, int)'::regprocedure);
  v_old := 'where ic.key = p_key and not i.hidden) then';
  if position(v_old in v_src) = 0 then raise exception 'could not patch _subscribe'; end if;
  execute replace(v_src, v_old,
    'where ic.key = p_key and not i.hidden)'
    || ' and not (p_key like ''% %'' and exists (select 1 from public.items i where not i.hidden and public._variant_names(i.variant, p_key))) then');

  -- The sweep: a cover follow also matches covers whose variant text names the artist.
  v_src := pg_get_functiondef('public.apply_subscriptions(bigint, int)'::regprocedure);
  v_old := 'and exists (select 1 from public.item_creators ic where ic.item_id = oi.id and ic.key = s.key and ic.role = ''cover''))';
  if position(v_old in v_src) = 0 then raise exception 'could not patch apply_subscriptions'; end if;
  execute replace(v_src, v_old, v_old
    || E'\n        or (s.kind = ''artist'' and s.role = ''cover'' and s.key like ''% %'' and public._variant_names(oi.variant, s.key))');
end $$;

grant execute on function public._variant_names(text, text) to anon, authenticated;
