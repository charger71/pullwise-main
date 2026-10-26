-- Master catalog sync, part two: the catalog's Series list and Artists list reach the shops too, not only its titles.
--   * Series list (Admin -> Series): series the catalog's staff added, with publisher and cover. A shop's own entry
--     keeps its own name, publisher and cover; the catalog only fills in what it's missing.
--   * Artists list (Admin -> Artists): names the catalog's staff added (found in cover text) and names they blocked.
--     Credits arrive with the titles already. A block in the catalog blocks the name in every shop; unblocking in
--     the catalog doesn't unblock a shop (its own block may be why it's blocked).
--   * Artist renames and merges ("by Jack Kirby" -> "Jack Kirby"): the shop merges the same two names, so its titles
--     and customers' follows move over and later titles land on the new name.
--   * Series merges: the shop merges the same two series (titles, follows, list entry), like Admin -> Series would.
-- Nothing is ever deleted from a shop. Each list is copied in order of change, with its own cursor, like the titles.

-- Change tracking, so a shop can ask the catalog for what changed since its last run.
alter table public.series_catalog add column updated_at timestamptz not null default now();
alter table public.creator_catalog add column updated_at timestamptz not null default now();
alter table public.creator_aliases add column updated_at timestamptz not null default now();
alter table public.series_aliases add column updated_at timestamptz not null default now();
create trigger series_catalog_touch before update on public.series_catalog for each row execute function public.touch_updated_at();
create trigger creator_catalog_touch before update on public.creator_catalog for each row execute function public.touch_updated_at();
create trigger creator_aliases_touch before update on public.creator_aliases for each row execute function public.touch_updated_at();
create trigger series_aliases_touch before update on public.series_aliases for each row execute function public.touch_updated_at();
create index series_catalog_updated_idx on public.series_catalog (updated_at, key);
create index creator_catalog_updated_idx on public.creator_catalog (updated_at, key);
create index creator_aliases_updated_idx on public.creator_aliases (updated_at, from_key);
create index series_aliases_updated_idx on public.series_aliases (updated_at, from_key);

-- Shops read the catalog's renames and merges with its anon key, like its titles and lists (both already public).
-- Spellings of names only; nothing private.
create policy "public read creator_aliases" on public.creator_aliases for select using (true);
create policy "public read series_aliases" on public.series_aliases for select using (true);
create view public.creator_aliases_named with (security_invoker = true) as
  select a.from_key, a.to_key, c.name as to_name, a.updated_at
  from public.creator_aliases a left join public.creator_catalog c on c.key = a.to_key;
grant select on public.creator_aliases_named to anon, authenticated;

-- Where each list's sync has got to: { "series": { "at": ..., "id": ... }, "series_merges": ..., "artists": ..., ... }.
alter table public.catalog_sync_state add column list_cursors jsonb not null default '{}';

-- Series list rows from the catalog: key, title, publisher, cover_url. A key this shop merged away lands on the
-- series it was merged into.
create or replace function public.catalog_apply_series(p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  r       record;
  v_key   text;
  v_ins   int := 0;
  v_upd   int := 0;
  v_same  int := 0;
  v_fail  int := 0;
  v_error text;
begin
  for r in select * from jsonb_to_recordset(p_rows) as x(key text, title text, publisher text, cover_url text) loop
    begin
      v_key := public._series_resolve(r.key);
      if exists (select 1 from public.series_catalog where key = v_key) then
        update public.series_catalog s set
          publisher = coalesce(s.publisher, r.publisher),
          cover_url = coalesce(s.cover_url, r.cover_url)
        where s.key = v_key
          and ((s.publisher is null and r.publisher is not null) or (s.cover_url is null and r.cover_url is not null));
        if found then v_upd := v_upd + 1; else v_same := v_same + 1; end if;
      else
        insert into public.series_catalog (key, title, publisher, cover_url)
        values (v_key, left(coalesce(case when v_key <> r.key then public._series_label(v_key) end, r.title), 200), r.publisher, r.cover_url);
        v_ins := v_ins + 1;
      end if;
    exception when others then
      v_fail := v_fail + 1;
      v_error := coalesce(v_error, format('series %s: %s', r.key, sqlerrm));
    end;
  end loop;
  return jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'unchanged', v_same, 'failed', v_fail, 'error', v_error);
end;
$$;

-- Artists list rows from the catalog: key, name, source, blocked. Only staff-added and blocked names matter (credited
-- names come with the titles). A name this shop merged away applies to the name it was merged into.
create or replace function public.catalog_apply_artists(p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  r       record;
  v_key   text;
  v_ins   int := 0;
  v_upd   int := 0;
  v_same  int := 0;
  v_fail  int := 0;
  v_error text;
begin
  for r in select * from jsonb_to_recordset(p_rows) as x(key text, name text, source text, blocked boolean) loop
    begin
      if r.source is distinct from 'staff' and not coalesce(r.blocked, false) then
        v_same := v_same + 1;
        continue;
      end if;
      v_key := coalesce((select to_key from public.creator_aliases where from_key = r.key), r.key);
      if exists (select 1 from public.creator_catalog where key = v_key) then
        update public.creator_catalog c set
          blocked = c.blocked or coalesce(r.blocked, false),
          source = case when r.source = 'staff' then 'staff' else c.source end
        where c.key = v_key
          and ((coalesce(r.blocked, false) and not c.blocked) or (r.source = 'staff' and c.source <> 'staff'));
        if found then v_upd := v_upd + 1; else v_same := v_same + 1; end if;
      else
        insert into public.creator_catalog (key, name, source, blocked)
        values (v_key, left(r.name, 200), case when r.source = 'staff' then 'staff' else 'credit' end, coalesce(r.blocked, false));
        v_ins := v_ins + 1;
      end if;
    exception when others then
      v_fail := v_fail + 1;
      v_error := coalesce(v_error, format('artist %s: %s', r.key, sqlerrm));
    end;
  end loop;
  return jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'unchanged', v_same, 'failed', v_fail, 'error', v_error);
end;
$$;

-- Artist renames from the catalog: from_key, to_key, to_name. The shop merges the two names the way a rename on its
-- own Artists page would (public._merge_artist), so titles and follows move over and the alias catches later imports.
create or replace function public.catalog_apply_artist_renames(p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  r       record;
  v_ins   int := 0;
  v_same  int := 0;
  v_fail  int := 0;
  v_error text;
begin
  for r in select * from jsonb_to_recordset(p_rows) as x(from_key text, to_key text, to_name text) loop
    begin
      if r.from_key = r.to_key or exists (select 1 from public.creator_aliases where from_key = r.from_key and to_key = r.to_key) then
        v_same := v_same + 1;
        continue;
      end if;
      perform public._merge_artist(r.from_key, r.to_key,
        coalesce((select name from public.creator_catalog where key = r.to_key), r.to_name, r.to_key));
      v_ins := v_ins + 1;
    exception when others then
      v_fail := v_fail + 1;
      v_error := coalesce(v_error, format('artist rename %s: %s', r.from_key, sqlerrm));
    end;
  end loop;
  return jsonb_build_object('inserted', v_ins, 'updated', 0, 'unchanged', v_same, 'failed', v_fail, 'error', v_error);
end;
$$;

-- Merging one series into another, without the staff check, so the sync can do it too. The body of
-- staff_merge_series (20270113000000_admin_audit_fixes.sql), which now checks and calls this.
create or replace function public._merge_series(p_from text, p_to text)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_n  int;
  v_to text := public._series_resolve(p_to);
begin
  if p_from is null or v_to is null or p_from = v_to then
    raise exception 'Pick two different series.' using errcode = 'P0001';
  end if;
  -- The active-list row: the kept series keeps its own cover and publisher, and takes the old one's when it has none.
  insert into public.series_catalog (key, title, publisher, cover_url)
  select v_to, left(coalesce(public._series_label(v_to), f.title), 200), f.publisher, f.cover_url
  from public.series_catalog f where f.key = p_from
  on conflict (key) do update set
    cover_url = coalesce(series_catalog.cover_url, excluded.cover_url),
    publisher = coalesce(series_catalog.publisher, excluded.publisher);
  delete from public.series_catalog where key = p_from;
  update public.items set series_key = v_to where series_key = p_from;
  get diagnostics v_n = row_count;
  -- Follows of the old key move over, unless the customer already follows the new one.
  delete from public.subscriptions s where s.kind = 'series' and s.key = p_from
    and exists (select 1 from public.subscriptions t where t.customer_id = s.customer_id and t.kind = 'series' and t.key = v_to);
  update public.subscriptions set key = v_to, label = coalesce(public._series_label(v_to), label) where kind = 'series' and key = p_from;
  -- Future imports of the old title land on the merged key too.
  insert into public.series_aliases (from_key, to_key) values (p_from, v_to)
  on conflict (from_key) do update set to_key = excluded.to_key;
  update public.series_aliases set to_key = v_to where to_key = p_from;
  return v_n;
end;
$$;
revoke execute on function public._merge_series(text, text) from public, anon, authenticated;

create or replace function public.staff_merge_series(p_from text, p_to text)
returns int
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'Staff only.' using errcode = '42501'; end if;
  return public._merge_series(p_from, p_to);
end;
$$;

-- Series merges from the catalog: from_key, to_key. A merge this shop already has, or one that would undo a merge
-- the shop made the other way round, is left alone.
create or replace function public.catalog_apply_series_merges(p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  r       record;
  v_to    text;
  v_ins   int := 0;
  v_same  int := 0;
  v_fail  int := 0;
  v_error text;
begin
  for r in select * from jsonb_to_recordset(p_rows) as x(from_key text, to_key text) loop
    begin
      v_to := public._series_resolve(r.to_key);
      if r.from_key = v_to or exists (select 1 from public.series_aliases where from_key = r.from_key and to_key = v_to) then
        v_same := v_same + 1;
        continue;
      end if;
      perform public._merge_series(r.from_key, v_to);
      v_ins := v_ins + 1;
    exception when others then
      v_fail := v_fail + 1;
      v_error := coalesce(v_error, format('series merge %s: %s', r.from_key, sqlerrm));
    end;
  end loop;
  return jsonb_build_object('inserted', v_ins, 'updated', 0, 'unchanged', v_same, 'failed', v_fail, 'error', v_error);
end;
$$;

revoke execute on function public.catalog_apply_series(jsonb), public.catalog_apply_series_merges(jsonb),
  public.catalog_apply_artists(jsonb), public.catalog_apply_artist_renames(jsonb) from public, anon, authenticated;
grant execute on function public.catalog_apply_series(jsonb), public.catalog_apply_series_merges(jsonb),
  public.catalog_apply_artists(jsonb), public.catalog_apply_artist_renames(jsonb) to service_role;
