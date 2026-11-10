-- Restore customers' sign-ins, so customers don't have to sign up again.
--
-- A backup now carries each account's id, email, confirmation state, metadata and PASSWORD HASH (bcrypt: not the
-- password itself, but it must be treated as secret like the rest of the file), and a restore puts missing accounts
-- back into auth.users with the same ids, so customers.user_id and every other link to them works and customers sign
-- in with the password they already have. Accounts that exist already (same id or same email) are never changed;
-- Replace mode doesn't touch sign-ins. Backups made before this have no hashes: those accounts come back without a
-- password, and the customer uses "Forgot password" once. Email-login records (auth.identities) are rebuilt.
-- Tokens (password-reset and confirmation links) are not backed up.

create or replace function public._restorable(p_table text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select p_table = 'auth_users' or exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname = p_table
      and c.relname not in ('staff', 'restore_stage', 'staff_audit', 'job_log'));
$$;
revoke execute on function public._restorable(text) from public, anon, authenticated;

-- Same as 20270227000000 except auth_users now includes the password hash and metadata (never the one-time tokens).
create or replace function public.backup_page(p_table text, p_offset int default 0, p_limit int default 1000)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_order text;
  v_n     bigint;
  v_rows  jsonb;
  v_lim   int := least(greatest(coalesce(p_limit, 1000), 1), 2000);
  v_off   int := greatest(coalesce(p_offset, 0), 0);
begin
  if not (public.is_owner() or auth.role() = 'service_role') then raise exception 'Only an owner can back up the data.' using errcode = '42501'; end if;

  if p_table = 'auth_users' then
    select count(*) into v_n from auth.users;
    select coalesce(jsonb_agg(to_jsonb(y) - 'confirmation_token' - 'recovery_token' - 'email_change_token_new' - 'email_change_token_current'
                              - 'reauthentication_token' - 'phone_change_token' - 'email_change' - 'phone_change' order by y.id), '[]'::jsonb)
      into v_rows from (select * from auth.users order by id limit v_lim offset v_off) y;
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
revoke execute on function public.backup_page(text, int, int) from public, anon;
grant execute on function public.backup_page(text, int, int) to authenticated, service_role;

-- Put the staged sign-ins back. Only the columns the backup has are written (the rest keep their defaults), then the
-- columns a login needs are filled in. Returns the same shape as one table in restore_apply_all.
create or replace function public._restore_auth_users()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_writable text[];
  v_cols     text;
  v_xcols    text;
  v_ids      uuid[] := '{}';
  v_chunk    uuid[];
  v_inserted bigint;
  v_set      text;
  r          record;
begin
  select array_agg(a.attname::text) into v_writable
  from pg_attribute a where a.attrelid = 'auth.users'::regclass and a.attnum > 0 and not a.attisdropped and a.attgenerated = '';

  for r in select rows from public.restore_stage where table_name = 'auth_users' order by chunk loop
    if jsonb_array_length(r.rows) = 0 then continue; end if;
    -- Columns present in this chunk's rows that auth.users can take (id, instance_id, aud, role, email, encrypted_password, …).
    select string_agg(quote_ident(k), ', ' order by k), string_agg('x.' || quote_ident(k), ', ' order by k) into v_cols, v_xcols
    from (select distinct jsonb_object_keys(e) k from jsonb_array_elements(r.rows) e) keys
    where k = any (v_writable);
    execute format('with ins as (insert into auth.users (%s) select %s from jsonb_populate_recordset(null::auth.users, $1) x on conflict do nothing returning id) select coalesce(array_agg(id), ''{}'') from ins', v_cols, v_xcols)
      using r.rows into v_chunk;
    v_ids := v_ids || v_chunk;
  end loop;
  v_inserted := coalesce(cardinality(v_ids), 0);

  if v_inserted > 0 then
    -- What a login needs: the role names, app metadata, and empty (not null) token columns.
    select string_agg(format('%I = coalesce(%I, %L)', c.col, c.col, c.dflt), ', ') into v_set
    from (values ('aud', 'authenticated'), ('role', 'authenticated'), ('confirmation_token', ''), ('recovery_token', ''),
                 ('email_change_token_new', ''), ('email_change', ''), ('email_change_token_current', ''), ('phone_change', ''),
                 ('phone_change_token', ''), ('reauthentication_token', '')) c(col, dflt)
    where c.col = any (v_writable);
    execute format('update auth.users set %s, raw_app_meta_data = coalesce(raw_app_meta_data, %L::jsonb), raw_user_meta_data = coalesce(raw_user_meta_data, ''{}''::jsonb), updated_at = coalesce(updated_at, now()) where id = any ($1)',
                   v_set, '{"provider":"email","providers":["email"]}') using v_ids;
    -- Email sign-in records, for the accounts just put back.
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    select u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', u.email_confirmed_at is not null, 'phone_verified', false),
           'email', u.last_sign_in_at, coalesce(u.created_at, now()), now()
    from auth.users u
    where u.id = any (v_ids) and u.email is not null
      and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email');
  end if;

  delete from public.restore_stage where table_name = 'auth_users';
  return jsonb_build_object('table', 'auth_users', 'inserted', v_inserted, 'rows_now', (select count(*) from auth.users), 'orphans_skipped', 0);
end;
$$;
revoke execute on function public._restore_auth_users() from public, anon, authenticated;

-- restore_apply_all as in 20270127000000, plus: auth_users is restored first (see above).
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
  return jsonb_build_object('tables', v_out);
end;
$$;
revoke execute on function public.restore_apply_all(text[], boolean) from public, anon;
grant execute on function public.restore_apply_all(text[], boolean) to authenticated;
