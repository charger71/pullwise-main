-- A restore that brings back titles starts the shop's catalog sync over, and the sync position itself is never restored.
--
-- Restored titles come back without their link to the master catalog (catalog_id), or from before titles the catalog
-- has added since, while catalog_sync_state still says the shop is up to date. The sync then only sends titles the
-- catalog changes later, so everything in between never reaches the shop (popscomics502, restored from the original
-- single-shop site's backup, was missing 495 upcoming titles). Clearing the position makes the next sync read the whole
-- catalog once: catalog_apply links each restored title by its catalog id, or by distributor and SKU, UPC or ISBN, and
-- adds the ones the shop doesn't have. tools/restore.mjs does the same for restores run by hand.
--
-- catalog_sync_state isn't restorable: a position copied from an older backup, or another shop's, is never this shop's.

-- _restorable as in 20270307000000, plus catalog_sync_state.
create or replace function public._restorable(p_table text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select p_table = 'auth_users' or exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname = p_table
      and c.relname not in ('staff', 'restore_stage', 'staff_audit', 'job_log', 'catalog_sync_state'));
$$;
revoke execute on function public._restorable(text) from public, anon, authenticated;

-- restore_apply_all as in 20270307000000, plus: restoring items clears the catalog sync position (see above).
create or replace function public.restore_apply_all(p_tables text[], p_replace boolean default false)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_tables   text[];
  v_order    text[];
  t          text;
  v_oid      oid;
  v_cols     text;
  v_override text;
  v_has_pk   boolean;
  v_ok       text;
  v_inserted bigint;
  v_orphans  bigint;
  v_n        bigint;
  v_now      bigint;
  v_out      jsonb := '[]';
  r          record;
  s          text;
  e_state text; e_msg text; e_detail text; e_hint text;
  v_auth     jsonb;
begin
  if not public.is_owner() then raise exception 'Only an owner can restore data.' using errcode = '42501'; end if;
  v_tables := array(select distinct x from unnest(p_tables) x where x is not null);
  if cardinality(v_tables) = 0 then raise exception 'Pick at least one table.' using errcode = 'P0001'; end if;
  foreach t in array v_tables loop
    if not public._restorable(t) then raise exception '%: that table can''t be restored here.', t using errcode = 'P0001'; end if;
    if not exists (select 1 from public.restore_stage where table_name = t) then
      raise exception 'Nothing was uploaded for %.', t using errcode = 'P0001';
    end if;
  end loop;
  -- Triggers that email or notify people skip rows a restore puts back (event_signup_email_trigger).
  perform set_config('app.restoring', 'on', true);
  -- Customers' sign-ins (auth_users) load first, so the customers that point at them find them. Accounts that already
  -- exist are never touched or replaced, even in Replace mode.
  if 'auth_users' = any (v_tables) then
    v_auth := public._restore_auth_users();
    v_tables := array_remove(v_tables, 'auth_users');
    v_out := jsonb_build_array(v_auth);
  end if;
  v_order := public._fk_order(v_tables);

  if p_replace then
    for i in reverse cardinality(v_order) .. 1 loop
      t := v_order[i];
      begin
        execute format('delete from public.%I where true', t); -- "where true": see above
      exception when others then
        get stacked diagnostics e_state = returned_sqlstate, e_msg = message_text, e_detail = pg_exception_detail, e_hint = pg_exception_hint;
        raise exception '%: %', t, e_msg using errcode = e_state, detail = e_detail, hint = e_hint;
      end;
    end loop;
  end if;

  foreach t in array v_order loop
    begin
      v_oid := format('public.%I', t)::regclass;
      -- Columns a restore can write to (generated columns are recomputed).
      select string_agg(quote_ident(a.attname), ', ' order by a.attnum),
             case when bool_or(a.attidentity = 'a') then ' overriding system value' else '' end
        into v_cols, v_override
      from pg_attribute a where a.attrelid = v_oid and a.attnum > 0 and not a.attisdropped and a.attgenerated = '';
      select exists (select 1 from pg_index where indrelid = v_oid and indisprimary) into v_has_pk;
      -- Rows whose parent (in a table being restored, loaded just before) exists, or that have no parent.
      select coalesce(string_agg(format('(%s or exists (select 1 from %s p where %s))',
                                        (select string_agg(format('x.%I is null', a.attname), ' or ')
                                         from unnest(k.conkey) ck(attnum) join pg_attribute a on a.attrelid = k.conrelid and a.attnum = ck.attnum),
                                        k.confrelid::regclass,
                                        (select string_agg(format('p.%I = x.%I', pa.attname, ca.attname), ' and ')
                                         from unnest(k.conkey, k.confkey) u(c, p)
                                         join pg_attribute ca on ca.attrelid = k.conrelid and ca.attnum = u.c
                                         join pg_attribute pa on pa.attrelid = k.confrelid and pa.attnum = u.p)), ' and '), 'true')
        into v_ok
      from pg_constraint k
      where k.contype = 'f' and k.conrelid = v_oid and k.confrelid <> v_oid
        and k.confrelid in (select format('public.%I', x)::regclass from unnest(v_tables) x);

      v_inserted := 0;
      v_orphans := 0;
      for r in select rows from public.restore_stage where table_name = t order by chunk loop
        execute format('select count(*) from jsonb_populate_recordset(null::public.%I, $1) x where not (%s)', t, v_ok) using r.rows into v_n;
        v_orphans := v_orphans + v_n;
        execute format('insert into public.%I (%s)%s select %s from jsonb_populate_recordset(null::public.%I, $1) x where %s%s',
                       t, v_cols, v_override, v_cols, t, v_ok, case when p_replace or not v_has_pk then '' else ' on conflict do nothing' end)
          using r.rows;
        get diagnostics v_n = row_count;
        v_inserted := v_inserted + v_n;
      end loop;

      -- Move identity / serial counters past the restored ids.
      for s in select format('select setval(%L, greatest((select coalesce(max(%I), 0) from public.%I), 1))', pg_get_serial_sequence(format('public.%I', t), a.attname), a.attname, t)
               from pg_attribute a where a.attrelid = v_oid and a.attnum > 0 and not a.attisdropped
                 and pg_get_serial_sequence(format('public.%I', t), a.attname) is not null loop
        execute s;
      end loop;

      delete from public.restore_stage where table_name = t;
      execute format('select count(*) from public.%I', t) into v_now;
      v_out := v_out || jsonb_build_array(jsonb_build_object('table', t, 'inserted', v_inserted, 'rows_now', v_now, 'orphans_skipped', v_orphans));
    exception when others then
      -- Say which table failed; re-raising undoes the whole call.
      get stacked diagnostics e_state = returned_sqlstate, e_msg = message_text, e_detail = pg_exception_detail, e_hint = pg_exception_hint;
      raise exception '%: %', t, e_msg using errcode = e_state, detail = e_detail, hint = e_hint;
    end;
  end loop;
  -- Titles came back: the next catalog sync reads the whole catalog and links them (see the top of this file).
  if 'items' = any (v_tables) then
    update public.catalog_sync_state set cursor_at = null, cursor_id = null where id = 1;
  end if;
  return jsonb_build_object('tables', v_out);
end;
$$;
revoke execute on function public.restore_apply_all(text[], boolean) from public, anon;
grant execute on function public.restore_apply_all(text[], boolean) to authenticated;
