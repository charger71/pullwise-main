-- Staff: every series (imported and on the active list), for the Admin -> Series screen.
create or replace function public.staff_list_series()
returns table (key text, label text, issues bigint, cover_url text)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'Staff only.' using errcode = '42501'; end if;
  return query
  with s as (
    select i.series_key as k, (array_agg(i.title order by length(i.title), i.created_at desc))[1] as l, count(distinct i.issue_number) as n
    from public.items i
    where i.issue_number is not null and i.series_key is not null and not i.hidden
    group by i.series_key
  ),
  c as (
    select sc.key as k, sc.title as l, 0::bigint as n
    from public.series_catalog sc
    where not exists (select 1 from s where s.k = sc.key)
  )
  select u.k, u.l, u.n, sc.cover_url
  from (select * from s union all select * from c) u
  left join public.series_catalog sc on sc.key = u.k
  order by u.l;
end;
$$;
revoke execute on function public.staff_list_series() from public, anon;
grant execute on function public.staff_list_series() to authenticated;
