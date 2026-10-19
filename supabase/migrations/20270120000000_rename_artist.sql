-- Admin > Series > Artists: staff can fix the spelling of a name they added (or blocked). Names that come from
-- distributor credits aren't renamed here; the search shows those as credited.
create or replace function public.staff_rename_artist(p_key text, p_name text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_key text := public.person_key(p_name);
begin
  if not public.is_staff() then raise exception 'Staff only.' using errcode = '42501'; end if;
  if v_key is null then raise exception 'Enter a name.' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.creator_catalog where key = p_key and source = 'staff') then
    raise exception 'Only names added or blocked by staff can be renamed.' using errcode = 'P0001';
  end if;
  if v_key <> p_key and exists (select 1 from public.creator_catalog where key = v_key) then
    raise exception 'That name is already on the list.' using errcode = 'P0001';
  end if;
  update public.creator_catalog set key = v_key, name = left(regexp_replace(trim(p_name), '\s+', ' ', 'g'), 200) where key = p_key;
end;
$$;
revoke execute on function public.staff_rename_artist(text, text) from public, anon;
grant execute on function public.staff_rename_artist(text, text) to authenticated;
