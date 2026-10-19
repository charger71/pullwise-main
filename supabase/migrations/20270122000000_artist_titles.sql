-- Admin > Series > Artists: click an artist's Credits or Covers number to see the titles it was counted from.
-- "Credits" are titles that credit the person; "Covers" are titles whose cover is theirs, either credited as the cover
-- artist or named in the cover text (the same rule the artist search uses). The list's Covers number uses the same rule.

create or replace function public._artist_cover_ids(p_key text)
returns setof bigint
language sql stable set search_path = public
as $$
  select ic.item_id from public.item_creators ic where ic.key = p_key and ic.role = 'cover'
  union
  select i.id from public.items i where p_key like '% %' and i.variant_words like '% ' || p_key || ' %';
$$;

create or replace function public.staff_artist_titles(p_key text, p_kind text)
returns table (id bigint, title text, issue_number text, variant text, publisher text, release_date date, cover_url text, hidden boolean)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'Staff only.' using errcode = '42501'; end if;
  return query
  select i.id, i.title, i.issue_number::text, i.variant, i.publisher, i.release_date, i.cover_url, i.hidden
  from public.items i
  where case when p_kind = 'covers' then i.id in (select public._artist_cover_ids(p_key))
             else i.id in (select ic.item_id from public.item_creators ic where ic.key = p_key) end
  order by i.release_date desc nulls last, i.title
  limit 500;
end;
$$;

drop function public.staff_list_artists();
create function public.staff_list_artists()
returns table (key text, name text, source text, blocked boolean, credits bigint, covers bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'Staff only.' using errcode = '42501'; end if;
  return query
  select cc.key, cc.name, cc.source, cc.blocked,
         (select count(*) from public.item_creators ic where ic.key = cc.key),
         (select count(*) from public._artist_cover_ids(cc.key))
  from public.creator_catalog cc
  order by cc.name;
end;
$$;

revoke execute on function public.staff_artist_titles(text, text), public.staff_list_artists(), public._artist_cover_ids(text) from public, anon;
grant execute on function public.staff_artist_titles(text, text), public.staff_list_artists() to authenticated;
