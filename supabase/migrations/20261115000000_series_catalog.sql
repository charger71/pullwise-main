-- Active-series list. A series could only be followed once an issue of it had been imported,
-- so ongoing books with nothing recent in the catalog were missing. Staff can now load a list
-- of series names (Admin -> Series); they appear in the follow search straight away, and
-- apply_subscriptions adds each issue to followers' pull lists as the issue gets imported.

create table public.series_catalog (
  key        text primary key,
  title      text not null check (length(title) <= 200),
  publisher  text,
  created_at timestamptz not null default now()
);
alter table public.series_catalog enable row level security;
create policy "public read series_catalog" on public.series_catalog for select using (true);
create policy "staff all series_catalog" on public.series_catalog for all using (public.is_staff()) with check (public.is_staff());

create or replace function public._series_label(p_key text)
returns text
language sql stable set search_path = public
as $$
  select coalesce(
    (select title from public.items where series_key = p_key and not hidden order by length(title), created_at desc limit 1),
    (select title from public.series_catalog where key = p_key)
  );
$$;

-- Only the series check changes from the original.
do $$
declare
  v_src text := pg_get_functiondef('public._subscribe(public.customers, text, text, text, text, int)'::regprocedure);
begin
  v_src := replace(v_src,
    'not exists (select 1 from public.items where series_key = p_key and not hidden)',
    'not exists (select 1 from public.items where series_key = p_key and not hidden) and not exists (select 1 from public.series_catalog where key = p_key)');
  if v_src not like '%series_catalog%' then raise exception 'could not patch _subscribe'; end if;
  execute v_src;
end $$;

create or replace function public.search_series(p_q text)
returns table (key text, label text, issues bigint)
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
  select k, l, n from (select * from s union all select * from c) u order by n desc, l limit 20;
$$;

-- Staff: add series names. p_rows = [{"title": "...", "publisher": "..."}, ...]. Returns how many were new.
create or replace function public.staff_add_series(p_rows jsonb)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_n int;
begin
  if not public.is_staff() then raise exception 'Staff only.' using errcode = '42501'; end if;
  with src as (
    select distinct on (public._series_key_auto(r->>'title'))
      public._series_key_auto(r->>'title') as key, left(trim(r->>'title'), 200) as title, nullif(trim(r->>'publisher'), '') as publisher
    from jsonb_array_elements(p_rows) r
    where public._series_key_auto(r->>'title') is not null
    order by public._series_key_auto(r->>'title'), length(r->>'title')
  ), ins as (
    insert into public.series_catalog (key, title, publisher)
    select key, title, publisher from src
    on conflict (key) do nothing
    returning 1
  )
  select count(*) into v_n from ins;
  return v_n;
end;
$$;

create or replace function public.staff_series_catalog_count()
returns bigint
language sql stable security definer set search_path = public
as $$ select case when public.is_staff() then (select count(*) from public.series_catalog) end; $$;

-- Merging: the folded-away name leaves the list so it isn't offered twice.
do $$
declare
  v_src text := pg_get_functiondef('public.staff_merge_series(text, text)'::regprocedure);
begin
  v_src := replace(v_src, '  update public.items set series_key = p_to where series_key = p_from;',
    E'  delete from public.series_catalog where key = p_from;\n  update public.items set series_key = p_to where series_key = p_from;');
  if v_src not like '%series_catalog%' then raise exception 'could not patch staff_merge_series'; end if;
  execute v_src;
end $$;

revoke execute on function public.staff_add_series(jsonb), public.staff_series_catalog_count() from public, anon;
grant execute on function public.staff_add_series(jsonb), public.staff_series_catalog_count() to authenticated;
