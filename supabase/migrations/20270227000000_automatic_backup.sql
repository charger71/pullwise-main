-- Automatic nightly backups (.github/workflows/backup.yml → tools/backup-shops.mjs) read every table through
-- backup_meta / backup_page with the project's service key, so those two now also let the service role in.
-- Bodies are unchanged from 20270113000000_admin_audit_fixes (backup_meta) and 20261226000000_backup_export
-- (backup_page) except for the guard. Anyone signed in still has to be an owner.

create or replace function public.backup_meta()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_order text[] := public._fk_order();
begin
  if not (public.is_owner() or auth.role() = 'service_role') then raise exception 'Only an owner can back up the data.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'tables', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', c.relname,
        'pk', coalesce((select string_agg(a.attname, ',' order by k.ord)
                        from pg_index i cross join lateral unnest(i.indkey) with ordinality k(attnum, ord)
                        join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
                        where i.indrelid = c.oid and i.indisprimary), ''),
        'generated', coalesce((select jsonb_agg(a.attname) from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and a.attgenerated <> ''), '[]'::jsonb),
        'identity_always', coalesce((select jsonb_agg(a.attname) from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and a.attidentity = 'a'), '[]'::jsonb),
        'restorable', public._restorable(c.relname)
      ) order by array_position(v_order, c.relname::text) desc, c.relname), '[]'::jsonb)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')),
    'migration', (select max(version) from supabase_migrations.schema_migrations)
  );
end;
$$;

-- One page of a table (rows as JSON, in primary-key order) and the table's total row count.
-- p_table = 'auth_users' returns the sign-in list without password hashes.
create or replace function public.backup_page(p_table text, p_offset int default 0, p_limit int default 1000)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_pk    text;
  v_order text;
  v_n     bigint;
  v_rows  jsonb;
  v_lim   int := least(greatest(coalesce(p_limit, 1000), 1), 2000);
  v_off   int := greatest(coalesce(p_offset, 0), 0);
begin
  if not (public.is_owner() or auth.role() = 'service_role') then raise exception 'Only an owner can back up the data.' using errcode = '42501'; end if;

  if p_table = 'auth_users' then
    select count(*), coalesce(jsonb_agg(jsonb_build_object('id', id, 'email', email, 'email_confirmed_at', email_confirmed_at,
                                                          'created_at', created_at, 'last_sign_in_at', last_sign_in_at) order by id), '[]'::jsonb)
      into v_n, v_rows from auth.users;
    return jsonb_build_object('count', v_n, 'rows', v_rows);
  end if;

  select coalesce((select string_agg('x.' || quote_ident(a.attname), ', ' order by k.ord)
                   from pg_index i cross join lateral unnest(i.indkey) with ordinality k(attnum, ord)
                   join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
                   where i.indrelid = c.oid and i.indisprimary), 'to_jsonb(x)::text')
    into v_order
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname = p_table;
  if v_order is null then raise exception 'Unknown table.' using errcode = 'P0001'; end if;

  execute format('select count(*) from public.%I', p_table) into v_n;
  execute format('select coalesce(jsonb_agg(to_jsonb(y)), ''[]''::jsonb) from (select * from public.%I x order by %s limit %s offset %s) y', p_table, v_order, v_lim, v_off) into v_rows;
  return jsonb_build_object('count', v_n, 'rows', v_rows);
end;
$$;

revoke execute on function public.backup_meta(), public.backup_page(text, int, int) from public, anon;
grant execute on function public.backup_meta(), public.backup_page(text, int, int) to authenticated, service_role;
