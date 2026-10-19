-- "Written by Rob Williams with art by Nil Vendrell" credited only Rob Williams. A role phrase ("with art by",
-- "Translated by", ...) now also separates names, so each person in the credit is picked up. Items are re-read.

create or replace function public._credit_roles_re()
returns text
language sql immutable
as $$
  select 'written|story|stories|art|artwork|illustrations?|illustrated|manga|script|letters?|lettering|lettered|translation|translated|'
         'storyboards?|photography|introduction|foreword|afterword|colou?rs?|colou?red|inks?|inked|pencils?|penciled|edited|created|adapted|'
         'organized|designed?|cover|cover art|cover designed';
$$;

create or replace function public._clean_creator_name(p_name text)
returns text
language sql immutable
as $$
  select nullif(trim(regexp_replace(
           regexp_replace(
             regexp_replace(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'),
               '^(?:[\w.]+\s+){0,3}?\m(?:' || public._credit_roles_re() || ')(?:\s+\w+){0,2}?\s+by\s+', '', 'i'),
             '[.,]?\s+(?:with\s+)?(?:' || public._credit_roles_re() || ')(?:\s+\w+){0,2}?\s+by\s.*$', '', 'i'),
           '[.,\s]+$', '')), '');
$$;

-- Names are also split where a role phrase starts. Otherwise the same as the live function (20270121).
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
          from regexp_split_to_table(v_creators,
            '\s*[,;/]\s*|\s+&\s+|\s+and\s+|[.,]?\s+(?:with\s+)?(?:' || public._credit_roles_re() || ')(?:\s+\w+){0,2}?\s+by\s+', 'i') nm) c
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

-- Re-read the credits of the titles whose credit text has a role phrase in it.
do $$
declare
  r record;
begin
  for r in select id from public.items where creators ~* ('\s(?:with\s+)?(?:' || public._credit_roles_re() || ')(?:\s+\w+){0,2}?\s+by\s') loop
    perform public._sync_item_creators(r.id);
  end loop;
end $$;
