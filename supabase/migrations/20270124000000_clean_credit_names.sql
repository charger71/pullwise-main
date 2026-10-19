-- Credits written as "Illustrated by Abhi Alwar", or "Gou Tanabe. Translated by Zack Davisson." were imported as the
-- creative's name, so they became their own entries on the Creatives list. Credit text is now cleaned as it is read
-- (the role words come off, leaving just the name), and the entries already on the list are merged into the clean
-- name: titles and customers' follows move over, and an alias keeps the old wording from coming back.

create or replace function public._clean_creator_name(p_name text)
returns text
language sql immutable
as $$
  select nullif(trim(regexp_replace(
           regexp_replace(
             regexp_replace(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'), '^.*?\millustrated by\s+', '', 'i'),
             '[.,]?\s+(translated|cover designed|lettered|colou?red|edited) by\s.*$', '', 'i'),
           '[.,\s]+$', '')), '');
$$;

-- Credit text is cleaned before keys are made. Otherwise the same as the live function (20270120).
create or replace function public._sync_item_creators(p_item_id bigint)
returns void
language plpgsql set search_path = public
as $$
declare
  v_creators text;
  v_variant  text;
begin
  select creators, variant into v_creators, v_variant from public.items where id = p_item_id;
  delete from public.item_creators where item_id = p_item_id;
  if v_creators is null then
    return;
  end if;
  insert into public.item_creators (item_id, key, name, role)
  select p_item_id, coalesce(a.to_key, public.person_key(n.name)), n.name,
         case when v_variant is not null
               and ' ' || coalesce(public.person_key(v_variant), '') || ' ' like '% ' || public.person_key(n.name) || ' %'
              then 'cover' else 'creator' end
  from (
    select distinct on (public.person_key(c.nm)) c.nm as name
    from (select public._clean_creator_name(nm) as nm
          from regexp_split_to_table(v_creators, '\s*[,;/]\s*|\s+&\s+|\s+and\s+', 'i') nm) c
    where c.nm is not null
    order by public.person_key(c.nm), length(c.nm)
  ) n
  left join public.creator_aliases a on a.from_key = public.person_key(n.name)
  where length(n.name) >= 3
    and public.person_key(n.name) is not null
    and public.person_key(n.name) not in ('various', 'various artists', 'tbd', 'tba', 'unknown', 'n a', 'none')
  on conflict (item_id, key) do nothing;
end;
$$;

-- Merge the entries already on the list. A lone "illustrated" is just blocked.
do $$
declare
  r record;
begin
  update public.creator_catalog set blocked = true, source = 'staff' where key = 'illustrated';
  for r in
    select key, public._clean_creator_name(name) as clean
    from public.creator_catalog
    where key like '%illustrated by%' and public._clean_creator_name(name) is not null
  loop
    if public.person_key(r.clean) is not null and public.person_key(r.clean) <> r.key then
      perform public._merge_artist(r.key, public.person_key(r.clean), r.clean);
    end if;
  end loop;
end $$;
