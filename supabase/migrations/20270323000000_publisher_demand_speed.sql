-- Speed up Analytics > demand by publisher (analytics_publisher_demand).
--
-- It ran publisher_group and publisher_family once per reservation line. Both carry their own search_path, so
-- Postgres can't inline them and re-plans them on every call: about 0.75 seconds for a shop with ~3,300 active
-- lines. Copies are now added up per publisher spelling first (a shop has a few hundred), and the two functions run
-- once per spelling. Same rows in the same order: the shortest spelling still names a group, imprints still count
-- under their family.

create or replace function public.analytics_publisher_demand()
returns table (publisher text, copies int)
language sql stable set search_path = public
as $$
  with by_name as (
    select i.publisher as name, sum(r.quantity) as copies
    from public.reservations r
    join public.items i on i.id = r.item_id
    where r.status in ('open', 'ordered', 'reordered', 'arrived')
    group by i.publisher
  ), named as (
    select b.copies, btrim(b.name) as spelling, g.grp, public.publisher_family(g.grp) as family
    from by_name b
    cross join lateral (select public.publisher_group(b.name) as grp) g
  )
  select coalesce(max(family), (array_agg(spelling order by length(spelling), spelling = upper(spelling), spelling) filter (where grp is not null))[1], 'No publisher listed'),
         sum(copies)::int
  from named
  group by coalesce(lower(family), grp)
  having sum(copies) > 0
  order by 2 desc, 1;
$$;

revoke execute on function public.analytics_publisher_demand() from public, anon;
grant execute on function public.analytics_publisher_demand() to authenticated;
