-- Speed up Series > Creatives (staff_list_artists).
--
-- The covers count ran _artist_cover_ids once per artist, and each run scanned every title's variant text for the
-- name: about a second for a shop with ~5,500 artists and ~9,000 titles. The screen loads the list in pages of 1,000
-- (fetchAll), and each page ran the whole function again, so the list took several seconds to appear.
--
-- Same counts, worked out in one pass:
--   * credits: every item_creators row for the key, counted once per key with a group by;
--   * covers: the key's cover credits, plus titles whose variant text names the artist. Keys and variant_words both
--     come from person_key (lowercase letters and digits, single spaces), so a title whose variant names the artist
--     has the artist's first two words side by side. Joining each title's word pairs to each key's first two words
--     finds the few candidates, and the same LIKE as _artist_cover_ids confirms them.
-- Ties on name now fall back to the key, so paging through the list never repeats or skips a row.

create or replace function public.staff_list_artists()
returns table (key text, name text, source text, blocked boolean, credits bigint, covers bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'Staff only.' using errcode = '42501'; end if;
  return query
  with pairs as (
    select distinct i.id, i.variant_words, w[s] || ' ' || w[s + 1] as pair
    from public.items i,
         lateral (select string_to_array(trim(i.variant_words), ' ') as w) a,
         generate_series(1, coalesce(array_length(a.w, 1), 0) - 1) s
  ), key_pairs as (
    select c.key, split_part(c.key, ' ', 1) || ' ' || split_part(c.key, ' ', 2) as pair
    from public.creator_catalog c
    where c.key like '% %'
  ), cover_items as (
    select ic.key, ic.item_id from public.item_creators ic where ic.role = 'cover'
    union
    select kp.key, p.id
    from key_pairs kp join pairs p on p.pair = kp.pair
    where p.variant_words like '% ' || kp.key || ' %'
  ), cover_counts as (
    select ci.key, count(*) as n from cover_items ci group by ci.key
  ), credit_counts as (
    select ic.key, count(*) as n from public.item_creators ic group by ic.key
  )
  select cc.key, cc.name, cc.source, cc.blocked, coalesce(cr.n, 0)::bigint, coalesce(cv.n, 0)::bigint
  from public.creator_catalog cc
  left join credit_counts cr on cr.key = cc.key
  left join cover_counts cv on cv.key = cc.key
  order by cc.name, cc.key;
end;
$$;

revoke execute on function public.staff_list_artists() from public, anon;
grant execute on function public.staff_list_artists() to authenticated;
