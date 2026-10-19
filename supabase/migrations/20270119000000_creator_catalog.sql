-- Artist list. Cover artists named only in cover text ("CVR A NATHAN GOODEN ...") were guessed from word patterns, so
-- each new oddity ("Absolute Batman", "Fried Pie") needed another patch. Now there is a list, like the series list:
--   * every credited person on an imported title is added to it automatically (writers, artists, cover artists);
--   * staff can add an artist who appears only in cover text, and the search looks for that exact name there;
--   * staff can block a name that keeps showing up as a false artist, and it is never offered again.
-- The old word-pattern guessing stays as the fallback for names nobody has listed or blocked yet.

create table public.creator_catalog (
  key        text primary key,
  name       text not null check (length(name) <= 200),
  source     text not null default 'credit' check (source in ('credit', 'staff')),
  blocked    boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.creator_catalog enable row level security;
create policy "public read creator_catalog" on public.creator_catalog for select using (true);
create policy "staff all creator_catalog" on public.creator_catalog for all using (public.is_staff()) with check (public.is_staff());

insert into public.creator_catalog (key, name)
select distinct on (key) key, left(name, 200) from public.item_creators order by key, length(name) desc
on conflict (key) do nothing;

-- New credits join the list as items are imported or edited.
create or replace function public.creator_catalog_grow()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.creator_catalog (key, name)
  select distinct on (key) key, left(name, 200) from new_rows order by key, length(name) desc
  on conflict (key) do nothing;
  return null;
end;
$$;
create trigger item_creators_grow_catalog after insert on public.item_creators
  referencing new table as new_rows for each statement execute function public.creator_catalog_grow();

-- Staff: add artists by name (one per entry). A name already on the list is unblocked and marked as staff-added.
-- Returns how many names were new to the list.
create or replace function public.staff_add_artists(p_names jsonb)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_n int;
begin
  if not public.is_staff() then raise exception 'Staff only.' using errcode = '42501'; end if;
  with src as (
    select distinct on (public.person_key(t)) public.person_key(t) as key, left(trim(regexp_replace(t, '\s+', ' ', 'g')), 200) as name
    from jsonb_array_elements_text(p_names) t
    where public.person_key(t) is not null
    order by public.person_key(t), length(t)
  ), ins as (
    insert into public.creator_catalog (key, name, source)
    select key, name, 'staff' from src
    on conflict (key) do update set blocked = false, source = 'staff'
    returning (xmax = 0) as fresh
  )
  select count(*) filter (where fresh) into v_n from ins;
  return v_n;
end;
$$;

create or replace function public.staff_set_artist_blocked(p_key text, p_blocked boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'Staff only.' using errcode = '42501'; end if;
  update public.creator_catalog set blocked = p_blocked where key = p_key;
end;
$$;

-- Blocking a name that isn't on the list yet (a guessed one such as "Fried Pie") adds it as blocked.
create or replace function public.staff_block_artist(p_name text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'Staff only.' using errcode = '42501'; end if;
  if public.person_key(p_name) is null then raise exception 'Enter a name.' using errcode = 'P0001'; end if;
  insert into public.creator_catalog (key, name, source, blocked)
  values (public.person_key(p_name), left(trim(p_name), 200), 'staff', true)
  on conflict (key) do update set blocked = true;
end;
$$;

create or replace function public.staff_delete_artist(p_key text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_owner() then raise exception 'Only an owner can delete an artist.' using errcode = '42501'; end if;
  delete from public.creator_catalog where key = p_key;
end;
$$;

create or replace function public.staff_list_artists()
returns table (key text, name text, source text, blocked boolean, credits bigint, covers bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'Staff only.' using errcode = '42501'; end if;
  return query
  select cc.key, cc.name, cc.source, cc.blocked,
         (select count(*) from public.item_creators ic where ic.key = cc.key),
         (select count(*) from public.item_creators ic where ic.key = cc.key and ic.role = 'cover')
  from public.creator_catalog cc
  order by cc.name;
end;
$$;

revoke execute on function public.staff_add_artists(jsonb), public.staff_set_artist_blocked(text, boolean), public.staff_block_artist(text),
  public.staff_delete_artist(text), public.staff_list_artists() from public, anon;
grant execute on function public.staff_add_artists(jsonb), public.staff_set_artist_blocked(text, boolean), public.staff_block_artist(text),
  public.staff_delete_artist(text), public.staff_list_artists() to authenticated;

-- Artist search: otherwise the same as the live function (20270115). Changes: blocked names are never offered, and
-- names staff added to the list are looked for directly in cover text (and skip the series-name check).
create or replace function public.search_artists(p_q text)
 RETURNS TABLE(name text, covers bigint, issues bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with q as (select public._search_tokens(p_q) as toks, public.person_key(p_q) as key),
  -- Credited people: every word of the search somewhere in the name, in any order, accents and punctuation ignored.
  credited as (
    select ic.key, (array_agg(ic.name order by length(ic.name) desc))[1] as name, count(*) as issues
    from q, public.item_creators ic
    join public.items i on i.id = ic.item_id and not i.hidden
    where length(replace(coalesce(q.key, ''), ' ', '')) >= 2
      and not exists (select 1 from unnest(q.toks) t where ic.key not like '%' || t || '%')
      and not exists (select 1 from public.creator_catalog b where b.key = ic.key and b.blocked)
    group by ic.key
    order by count(*) desc
    limit 40
  ),
  -- Words in cover text that are cover codes, not names.
  stop as (select array['cvr', 'cover', 'covers', 'var', 'variant', 'card', 'stock', 'cardstock', 'cs', 'foil',
        'virgin', 'incv', 'inc', 'ratio', 'blank', 'sketch', 'homage', 'connecting', 'design', 'team', 'the', 'of', 'and',
        'by', 'edition', 'ed', 'exc', 'excl', 'exclusive', 'ltd', 'limited', 'puzzle', 'trading', 'wraparound', 'wrap',
        'glow', 'metal', 'hc', 'tp', 'mr', 'new', 'open', 'order', 'second', 'third', 'printing', 'ptg', 'print', 'black',
        'white', 'color', 'spot', 'acetate', 'lenticular', 'textured', 'negative', 'gold', 'silver', 'red', 'blue', 'green',
        'movie', 'game', 'anime', 'manga', 'retro', 'classic', 'facsimile', 'reprint', 'fried', 'pie', 'midtown'] as words),
  -- A full name as typed, or with its words reversed ("momoko peach" -> "peach momoko").
  typed_names as (
    select k from q, stop,
         lateral (values (q.key),
                         (array_to_string(array(select w from unnest(string_to_array(q.key, ' ')) with ordinality u(w, o) order by o desc), ' '))) v(k)
    where q.key like '% %' and not (string_to_array(q.key, ' ') && stop.words)
  ),
  -- For one word ("momoko"), the two-word names it forms with the word before or after it in cover text. Only the
  -- side where its most common pairing is found is kept ("PEACH" is always before "MOMOKO", while descriptors after
  -- it vary), ties to the word before; and a pairing whose partner word belongs to a more common name is dropped.
  pairs as (
    select s.side, case when s.side = -1 then a.w[n - 1] || ' ' || a.w[n] else a.w[n] || ' ' || a.w[n + 1] end as key,
           count(distinct i.id) as hits
    from q, stop, public.items i,
         lateral (select string_to_array(trim(i.variant_words), ' ') as w) a,
         lateral generate_subscripts(a.w, 1) n,
         (values (-1), (1)) s(side)
    where q.key ~ '^[a-z]{3,}$'
      and q.key <> all (stop.words)
      and not i.hidden
      and i.variant_words like '% ' || q.key || ' %'
      and a.w[n] = q.key
      and a.w[n + s.side] ~ '^[a-z]{2,}$'
      and a.w[n + s.side] <> all (stop.words)
    group by 1, 2
  ),
  name_side as (select side from pairs order by hits desc, side limit 1),
  kept as (select p.side, p.key, p.hits, split_part(p.key, ' ', case when p.side = -1 then 1 else 2 end) as partner
           from pairs p join name_side ns on ns.side = p.side),
  partner_pairs as (
    select k.key, count(distinct i.id) as hits
    from kept k, q, stop, public.items i,
         lateral (select string_to_array(trim(i.variant_words), ' ') as w) a,
         lateral generate_subscripts(a.w, 1) n,
         (values (-1), (1)) s(side)
    where not i.hidden
      and i.variant_words like '% ' || k.partner || ' %'
      and a.w[n] = k.partner
      and a.w[n + s.side] ~ '^[a-z]{2,}$'
      and a.w[n + s.side] <> all (stop.words)
      and a.w[n + s.side] <> q.key
    group by k.key, s.side, a.w[n + s.side]
  ),
  -- Names staff added to the artist list by hand: trusted, so cover text is searched for them directly.
  listed as (
    select cc.key from q, public.creator_catalog cc
    where cc.source = 'staff' and not cc.blocked and cc.key like '% %'
      and not exists (select 1 from unnest(q.toks) t where cc.key not like '%' || t || '%')
  ),
  candidates as (
    select k as key, false as trusted from typed_names
    union
    select k.key, false from kept k
    where not exists (select 1 from partner_pairs pp where pp.key = k.key and pp.hits > k.hits)
    union
    select key, true from listed
  ),
  typed as (
    select c.key, initcap(c.key) as name, 0::bigint as issues
    from candidates c
    -- not already listed as (part of) a credited name: "garcia lopez" is José Luis García-López
    where not exists (select 1 from credited cr where ' ' || cr.key || ' ' like '% ' || c.key || ' %')
      and exists (select 1 from public.items i where not i.hidden and i.variant_words like '% ' || c.key || ' %')
      -- never a name staff blocked on the artist list
      and not exists (select 1 from public.creator_catalog b where b.blocked and ' ' || b.key || ' ' like '% ' || c.key || ' %')
      -- a guess isn't a series named in the cover text ("CVR A NATHAN GOODEN ABSOLUTE BATMAN 1 HOMAGE")
      and (c.trusted
           or (not exists (select 1 from public.items i where ' ' || i.series_key || ' ' like '% ' || c.key || ' %')
               and not exists (select 1 from public.series_catalog sc where ' ' || sc.key || ' ' like '% ' || c.key || ' %')))
  ),
  people as (select * from credited union all select * from typed)
  select p.name,
         (select count(*) from (
            select ic.item_id from public.item_creators ic join public.items i on i.id = ic.item_id and not i.hidden
            where ic.key = p.key and ic.role = 'cover'
            union
            select i.id from public.items i
            where not i.hidden and p.key like '% %' and i.variant_words like '% ' || p.key || ' %'
          ) x) as covers,
         p.issues
  from people p
  order by 2 desc, 3 desc
  limit 20;
$function$;
