-- Forgiving search: "spider-man", "spiderman" and "spider man" all find Spider-Man.
-- Titles are compared with case, accents, spaces and punctuation squashed away, and a
-- multi-word search needs every word to appear (in any order), so "spider man" also brings up Spider-Woman.

create or replace function public._squash(t text)
returns text language sql immutable parallel safe
as $$ select regexp_replace(translate(lower(coalesce(t, '')), 'áàâäãåéèêëíìîïóòôöõúùûüñçß', 'aaaaaaeeeeiiiiooooouuuuncs'), '[^a-z0-9]', '', 'g') $$;

-- The words of a search, lower-cased, accents and punctuation removed (at most 6).
create or replace function public._search_tokens(q text)
returns text[] language sql immutable parallel safe
as $$
  select coalesce(array(
    select w from unnest(regexp_split_to_array(translate(lower(coalesce(q, '')), 'áàâäãåéèêëíìîïóòôöõúùûüñçß', 'aaaaaaeeeeiiiiooooouuuuncs'), '[^a-z0-9]+')) w
    where w <> '' limit 6), '{}')
$$;

alter table public.items
  add column search_norm text generated always as (public._squash(coalesce(title, '') || ' ' || coalesce(variant, '') || ' ' || coalesce(creators, '') || ' ' || coalesce(issue_number, ''))) stored;
create index items_search_norm_trgm_idx on public.items using gin (search_norm gin_trgm_ops);

-- Series search with the same forgiving match. Numbers in a search ("batman 12") are ignored when
-- matching the series name, since the issue number isn't part of it.
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
  )
  select u.k, u.l, u.n, sc.cover_url
  from (select * from s union all select * from c) u
  left join public.series_catalog sc on sc.key = u.k
  order by u.n desc, u.l limit 20;
$$;
