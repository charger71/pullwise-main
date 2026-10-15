-- Admin -> Media: before deleting an image, show where it is used; and record Media deletes in the change log.

-- Where does this Media Library file (path like 'library/abc-logo.png') appear? Looks in the content tables'
-- text columns for the file name without its extension (so the small "-sm" copy and `?v=` links count too).
-- Returns [{ "table": "settings", "column": "logo_url", "count": 1, "examples": ["Your Comic Shop"] }, ...]. Staff only.
create or replace function public.media_usage(p_path text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_needle text := lower(regexp_replace(coalesce(p_path, ''), '\.\w+$', ''));
  v_out    jsonb := '[]'::jsonb;
  c        record;
  v_n      bigint;
  v_ex     jsonb;
begin
  if not public.is_staff() then raise exception 'Staff only.' using errcode = '42501'; end if;
  if length(v_needle) < 6 then return v_out; end if;
  for c in
    select col.table_name, col.column_name
    from information_schema.columns col
    where col.table_schema = 'public'
      and col.table_name in ('settings', 'items', 'events', 'posts', 'pages', 'faqs', 'series_catalog', 'surveys', 'categories')
      and col.data_type in ('text', 'character varying', 'jsonb', 'json')
    order by col.table_name, col.ordinal_position
  loop
    execute format('select count(*) from public.%I x where position($1 in lower(x.%I::text)) > 0', c.table_name, c.column_name) into v_n using v_needle;
    if v_n > 0 then
      execute format($q$select coalesce(jsonb_agg(l), '[]'::jsonb) from (
          select left(coalesce(to_jsonb(x) ->> 'title', to_jsonb(x) ->> 'slug', to_jsonb(x) ->> 'name', to_jsonb(x) ->> 'question', to_jsonb(x) ->> 'shop_name', 'row'), 60) as l
          from public.%I x where position($1 in lower(x.%I::text)) > 0 limit 3) q$q$, c.table_name, c.column_name) into v_ex using v_needle;
      v_out := v_out || jsonb_build_object('table', c.table_name, 'column', c.column_name, 'count', v_n, 'examples', v_ex);
    end if;
  end loop;
  return v_out;
end;
$$;

-- Owners delete Media files from the browser (storage policy); this records it in the change log.
create or replace function public.log_media_delete(p_paths text[])
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_owner() then raise exception 'Only an owner can delete Media.' using errcode = '42501'; end if;
  insert into public.staff_audit (user_id, staff_name, table_name, action, row_count, summary)
  values (auth.uid(), (select name from public.staff where user_id = auth.uid()), 'media', 'delete', coalesce(array_length(p_paths, 1), 0),
          (select coalesce(jsonb_agg(jsonb_build_object('label', left(p, 120))), '[]'::jsonb) from unnest(p_paths[1:10]) p));
end;
$$;

revoke execute on function public.media_usage(text), public.log_media_delete(text[]) from public, anon;
grant execute on function public.media_usage(text), public.log_media_delete(text[]) to authenticated;
