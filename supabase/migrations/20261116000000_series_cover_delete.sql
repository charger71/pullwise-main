-- Series cover images (shown in the follow search and on a customer's Following list) and a way
-- to delete a series from the active list. series_catalog now also holds covers for series that
-- came in through imports, so a row there no longer means "added by hand".

alter table public.series_catalog add column cover_url text check (length(cover_url) <= 1000);

drop function public.search_series(text);
create function public.search_series(p_q text)
returns table (key text, label text, issues bigint, cover_url text)
language sql stable set search_path = public
as $$
  with q as (select replace(replace(trim(p_q), '%', ''), '_', '') as t),
  s as (
    select i.series_key as k, (array_agg(i.title order by length(i.title), i.created_at desc))[1] as l, count(distinct i.issue_number) as n
    from public.items i, q
    where i.issue_number is not null and i.series_key is not null and not i.hidden
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
grant execute on function public.search_series(text) to anon, authenticated;

-- Staff: set or clear a series cover. p_title names the series if it has no row yet.
create or replace function public.staff_set_series_cover(p_key text, p_title text, p_url text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'Staff only.' using errcode = '42501'; end if;
  insert into public.series_catalog (key, title, cover_url)
  values (p_key, left(coalesce(nullif(trim(p_title), ''), p_key), 200), nullif(trim(p_url), ''))
  on conflict (key) do update set cover_url = excluded.cover_url;
end;
$$;

-- Staff: remove a series that has no titles. Its follows go with it.
create or replace function public.staff_delete_series(p_key text)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_titles int;
  v_follows int;
begin
  if not public.is_staff() then raise exception 'Staff only.' using errcode = '42501'; end if;
  select count(*) into v_titles from public.items where series_key = p_key;
  if v_titles > 0 then
    raise exception 'This series has % imported titles, so it can''t be deleted here. Delete or hide its titles first.', v_titles using errcode = 'P0001';
  end if;
  delete from public.subscriptions where kind = 'series' and key = p_key;
  get diagnostics v_follows = row_count;
  delete from public.series_catalog where key = p_key;
  return v_follows;
end;
$$;

revoke execute on function public.staff_set_series_cover(text, text, text), public.staff_delete_series(text) from public, anon;
grant execute on function public.staff_set_series_cover(text, text, text), public.staff_delete_series(text) to authenticated;
