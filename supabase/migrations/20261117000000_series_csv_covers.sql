-- staff_add_series also takes an optional cover image link per row ("cover_url", https only).
-- For a series that is already listed, a link sets its cover; a blank leaves the cover alone.
-- Returns how many series were new.
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
      public._series_key_auto(r->>'title') as key, left(trim(r->>'title'), 200) as title,
      nullif(trim(r->>'publisher'), '') as publisher,
      case when trim(r->>'cover_url') ~* '^https://\S+$' and length(trim(r->>'cover_url')) <= 1000 then trim(r->>'cover_url') end as cover_url
    from jsonb_array_elements(p_rows) r
    where public._series_key_auto(r->>'title') is not null
    order by public._series_key_auto(r->>'title'), (trim(r->>'cover_url') !~* '^https://'), length(r->>'title')
  ), up as (
    insert into public.series_catalog (key, title, publisher, cover_url)
    select key, title, publisher, cover_url from src
    on conflict (key) do update set cover_url = coalesce(excluded.cover_url, public.series_catalog.cover_url)
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted) into v_n from up;
  return v_n;
end;
$$;
