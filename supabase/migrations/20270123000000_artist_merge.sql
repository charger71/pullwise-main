-- Artist list: renaming an auto-created name ("by Jack Kirby" -> "Jack Kirby") left two entries with the same name.
-- Now a rename re-keys the entry to the new name, and when that name is already on the list the two are merged:
--   * their titles move to the surviving entry (a cover credit wins over a plain credit);
--   * customers' artist follows move too (a customer following both keeps one);
--   * an alias remembers the old spelling, so the next import of "by Jack Kirby" lands on Jack Kirby instead of
--     bringing the junk name back.
-- Existing entries whose name no longer matches their key are cleaned up the same way.

create table public.creator_aliases (
  from_key text primary key,
  to_key   text not null
);
alter table public.creator_aliases enable row level security;
create policy "staff all creator_aliases" on public.creator_aliases for all using (public.is_staff()) with check (public.is_staff());

-- Imports honour the aliases. Otherwise the same as the live function (20270107).
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
    select distinct on (public.person_key(nm)) trim(regexp_replace(nm, '\s+', ' ', 'g')) as name
    from regexp_split_to_table(v_creators, '\s*[,;/]\s*|\s+&\s+|\s+and\s+', 'i') nm
    order by public.person_key(nm), length(nm)
  ) n
  left join public.creator_aliases a on a.from_key = public.person_key(n.name)
  where length(n.name) >= 3
    and public.person_key(n.name) is not null
    and public.person_key(n.name) not in ('various', 'various artists', 'tbd', 'tba', 'unknown', 'n a', 'none')
  on conflict (item_id, key) do nothing;
end;
$$;

-- Move one entry into another (or just re-key it when the target isn't on the list). Private: staff go through
-- staff_rename_artist().
create or replace function public._merge_artist(p_from text, p_to text, p_name text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_from public.creator_catalog;
  v_to   public.creator_catalog;
begin
  if p_from = p_to then return; end if;
  select * into v_from from public.creator_catalog where key = p_from;
  select * into v_to from public.creator_catalog where key = p_to;

  insert into public.creator_aliases (from_key, to_key) values (p_from, p_to)
  on conflict (from_key) do update set to_key = excluded.to_key;
  update public.creator_aliases set to_key = p_to where to_key = p_from;
  delete from public.creator_aliases where from_key = to_key;

  -- titles: a cover credit on either side wins
  update public.item_creators x set role = 'cover'
  where x.key = p_to and x.role <> 'cover'
    and exists (select 1 from public.item_creators f where f.item_id = x.item_id and f.key = p_from and f.role = 'cover');
  update public.item_creators f set key = p_to, name = coalesce(v_to.name, p_name)
  where f.key = p_from
    and not exists (select 1 from public.item_creators x where x.item_id = f.item_id and x.key = p_to);
  delete from public.item_creators where key = p_from;

  -- follows
  delete from public.subscriptions f
  where f.kind = 'artist' and f.key = p_from
    and exists (select 1 from public.subscriptions x where x.customer_id = f.customer_id and x.kind = 'artist'
                and x.key = p_to and x.role = f.role);
  update public.subscriptions set key = p_to, label = coalesce(v_to.name, p_name) where kind = 'artist' and key = p_from;

  -- the list itself
  if v_to.key is not null then
    update public.creator_catalog
       set blocked = blocked or coalesce(v_from.blocked, false),
           source = case when source = 'staff' or v_from.source = 'staff' then 'staff' else source end
     where key = p_to;
    delete from public.creator_catalog where key = p_from;
  else
    update public.creator_catalog set key = p_to, name = p_name where key = p_from;
  end if;
end;
$$;
revoke execute on function public._merge_artist(text, text, text) from public, anon, authenticated;

create or replace function public.staff_rename_artist(p_key text, p_name text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_key  text := public.person_key(p_name);
  v_name text := left(regexp_replace(trim(p_name), '\s+', ' ', 'g'), 200);
begin
  if not public.is_staff() then raise exception 'Staff only.' using errcode = '42501'; end if;
  if v_key is null then raise exception 'Enter a name.' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.creator_catalog where key = p_key) then
    raise exception 'That name is no longer on the list.' using errcode = 'P0001';
  end if;
  if v_key = p_key then
    update public.creator_catalog set name = v_name where key = p_key;
  else
    perform public._merge_artist(p_key, v_key, v_name);
  end if;
end;
$$;

-- One-time cleanup: entries whose name no longer matches their key (renamed before this change).
do $$
declare
  r record;
begin
  for r in select key, name from public.creator_catalog where public.person_key(name) is not null and public.person_key(name) <> key loop
    perform public._merge_artist(r.key, public.person_key(r.name), r.name);
  end loop;
end $$;
