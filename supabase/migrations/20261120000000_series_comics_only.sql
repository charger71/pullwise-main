-- Series lists (follow search and Admin -> Series) are for comics. A few Funko Pops were in them
-- because the Funko sheet's "#" column landed in issue_number. Only comics, trades and omnibuses
-- count as series now (items with no category still do).

create or replace function public.search_series(p_q text)
returns table (key text, label text, issues bigint, cover_url text)
language sql stable set search_path = public
as $$
  with q as (select replace(replace(trim(p_q), '%', ''), '_', '') as t),
  s as (
    select i.series_key as k, (array_agg(i.title order by length(i.title), i.created_at desc))[1] as l, count(distinct i.issue_number) as n
    from public.items i
    left join public.categories cat on cat.id = i.category_id, q
    where i.issue_number is not null and i.series_key is not null and not i.hidden
      and coalesce(cat.slug, 'comics') in ('comics', 'trades', 'omnibuses')
      and i.title ilike '%' || q.t || '%' and length(q.t) >= 2
    group by i.series_key
  ),
  c as (
    select sc.key as k, sc.title as l, 0::bigint as n
    from public.series_catalog sc, q
    where sc.title ilike '%' || q.t || '%' and length(q.t) >= 2
      and not exists (select 1 from s where s.k = sc.key)
  )
  select u.k, u.l, u.n, sc.cover_url
  from (select * from s union all select * from c) u
  left join public.series_catalog sc on sc.key = u.k
  order by u.n desc, u.l limit 20;
$$;

create or replace function public.staff_list_series()
returns table (key text, label text, issues bigint, cover_url text, publisher text)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'Staff only.' using errcode = '42501'; end if;
  return query
  with s as (
    select i.series_key as k, (array_agg(i.title order by length(i.title), i.created_at desc))[1] as l, count(distinct i.issue_number) as n,
           mode() within group (order by i.publisher) as p
    from public.items i
    left join public.categories cat on cat.id = i.category_id
    where i.issue_number is not null and i.series_key is not null and not i.hidden
      and coalesce(cat.slug, 'comics') in ('comics', 'trades', 'omnibuses')
    group by i.series_key
  ),
  c as (
    select sc.key as k, sc.title as l, 0::bigint as n, sc.publisher as p
    from public.series_catalog sc
    where not exists (select 1 from s where s.k = sc.key)
  )
  select u.k, u.l, u.n, sc.cover_url, coalesce(u.p, sc.publisher)
  from (select * from s union all select * from c) u
  left join public.series_catalog sc on sc.key = u.k
  order by u.l;
end;
$$;

-- Funko Pops that had been added to the active list (or given a cover) come off it, along with any follows.
with funko as (
  select distinct i.series_key from public.items i join public.categories cat on cat.id = i.category_id
  where cat.slug not in ('comics', 'trades', 'omnibuses') and i.series_key is not null
    and not exists (select 1 from public.items j left join public.categories c2 on c2.id = j.category_id
                    where j.series_key = i.series_key and coalesce(c2.slug, 'comics') in ('comics', 'trades', 'omnibuses'))
), gone as (
  delete from public.series_catalog where key in (select series_key from funko) returning key
)
delete from public.subscriptions where kind = 'series' and key in (select key from gone);
