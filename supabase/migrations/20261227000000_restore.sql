-- Admin -> Backup & Restore -> Restore (owners only). The browser reads a backup file and sends one table at a
-- time: first in chunks into restore_stage (restore_stage_put), then restore_apply() loads the whole table in ONE
-- transaction, so a table is either fully restored or left exactly as it was.
-- Normal rules stay on: foreign keys and triggers still run, so a restore can't create orphaned or invalid rows
-- (a child table fails until its parent has been restored). The staff list is never restored here (Admin -> Staff).

create unlogged table public.restore_stage (
  table_name text   not null,
  chunk      int    not null,
  rows       jsonb  not null,
  primary key (table_name, chunk)
);
alter table public.restore_stage enable row level security;
revoke all on public.restore_stage from anon, authenticated;

-- Tables a restore may write to.
create or replace function public._restorable(p_table text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname = p_table
      and c.relname not in ('staff', 'restore_stage'));
$$;
revoke execute on function public._restorable(text) from public, anon, authenticated;

create or replace function public.restore_stage_put(p_table text, p_chunk int, p_rows jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_owner() then raise exception 'Only an owner can restore data.' using errcode = '42501'; end if;
  if not public._restorable(p_table) then raise exception 'That table can''t be restored here.' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Rows must be a list.' using errcode = 'P0001'; end if;
  if p_chunk = 0 then delete from public.restore_stage where table_name = p_table; end if;
  insert into public.restore_stage (table_name, chunk, rows) values (p_table, p_chunk, p_rows)
  on conflict (table_name, chunk) do update set rows = excluded.rows;
end;
$$;

-- Load the staged rows into the table. p_replace = delete the table's rows first; otherwise rows that already
-- exist (same key) are left alone. Returns { inserted, rows_now }.
create or replace function public.restore_apply(p_table text, p_replace boolean default false)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_oid      oid;
  v_cols     text;
  v_override text := '';
  v_has_pk   boolean;
  v_inserted bigint := 0;
  v_n        bigint;
  v_now      bigint;
  r          record;
  s          text;
begin
  if not public.is_owner() then raise exception 'Only an owner can restore data.' using errcode = '42501'; end if;
  if not public._restorable(p_table) then raise exception 'That table can''t be restored here.' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.restore_stage where table_name = p_table) then
    raise exception 'Nothing was uploaded for %.', p_table using errcode = 'P0001';
  end if;

  select c.oid into v_oid from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = p_table;
  -- Columns a restore can write to (generated columns are recomputed).
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum),
         case when bool_or(a.attidentity = 'a') then ' overriding system value' else '' end
    into v_cols, v_override
  from pg_attribute a where a.attrelid = v_oid and a.attnum > 0 and not a.attisdropped and a.attgenerated = '';
  select exists (select 1 from pg_index where indrelid = v_oid and indisprimary) into v_has_pk;

  if p_replace then execute format('delete from public.%I', p_table); end if;
  for r in select rows from public.restore_stage where table_name = p_table order by chunk loop
    execute format('insert into public.%I (%s)%s select %s from jsonb_populate_recordset(null::public.%I, $1)%s',
                   p_table, v_cols, v_override, v_cols, p_table, case when p_replace or not v_has_pk then '' else ' on conflict do nothing' end)
      using r.rows;
    get diagnostics v_n = row_count;
    v_inserted := v_inserted + v_n;
  end loop;

  -- Move identity / serial counters past the restored ids.
  for s in select format('select setval(%L, greatest((select coalesce(max(%I), 0) from public.%I), 1))', pg_get_serial_sequence(format('public.%I', p_table), a.attname), a.attname, p_table)
           from pg_attribute a where a.attrelid = v_oid and a.attnum > 0 and not a.attisdropped
             and pg_get_serial_sequence(format('public.%I', p_table), a.attname) is not null loop
    execute s;
  end loop;

  delete from public.restore_stage where table_name = p_table;
  execute format('select count(*) from public.%I', p_table) into v_now;
  return jsonb_build_object('inserted', v_inserted, 'rows_now', v_now);
end;
$$;

revoke execute on function public.restore_stage_put(text, int, jsonb), public.restore_apply(text, boolean) from public, anon;
grant execute on function public.restore_stage_put(text, int, jsonb), public.restore_apply(text, boolean) to authenticated;
