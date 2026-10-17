-- Admin audit fixes. Five parts, each with its own numbered sections:
--  A. Shop settings and staff rights: non-owner staff could replace the settings row to get round the owner-only
--     columns (footer scripts run on every page); the staff notice was readable by anyone; any staff login could
--     delete a customer.
--  B. Backup and restore: a Replace restore silently deleted or unlinked rows in other tables; a multi-table restore
--     could stop halfway; restoring event signups re-sent their emails; the audit trail could be overwritten.
--  C. Pull list lines: bulk status changes (ordered, ready, not ordered) only change lines still in the expected
--     status, go in the request body instead of the URL, and log exactly what changed.
--  D. Emails: the weekly email retries failed sends that day; Admin -> Emails saves in one call.
--  E. Catalog: series list paging order, merged series leaving a stale catalog row, staff title week counts.


-- ===============================================================================================================
-- Part A
-- ===============================================================================================================
-- A1 ------------------------------------------------------------------------------------------------------------------
-- Shop settings: "staff all settings" let any staff login delete the settings row and insert a new one, which
-- skipped the owner-only column check (it only ran on update), e.g. to set footer_scripts. Staff can now only
-- update the row (the guard still limits which columns); adding or deleting it needs an owner. The guard trigger
-- also runs on insert and delete, so it holds whatever the policies say. Scheduled jobs, the Edge functions and
-- the SQL editor (no signed-in user) are not affected.
drop policy "staff all settings" on public.settings;
create policy "staff update settings" on public.settings for update using (public.is_staff()) with check (public.is_staff());
create policy "owner insert settings" on public.settings for insert with check (public.is_owner());
create policy "owner delete settings" on public.settings for delete using (public.is_owner());

create or replace function public._settings_owner_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_bad text;
begin
  -- Scheduled jobs, the Edge functions and the SQL editor have no signed-in user.
  if auth.uid() is null or public.is_owner() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op <> 'UPDATE' then
    raise exception 'Only an owner can add or remove the shop settings.' using errcode = '42501';
  end if;
  select string_agg(e.key, ', ' order by e.key) into v_bad
  from jsonb_each(to_jsonb(new)) e
  where e.key <> all (array[
      'announcement',
      'pull_list_email_enabled', 'pull_list_email_day', 'pull_list_email_hour', 'pull_list_email_from', 'pull_list_email_last_sent',
      'email_logo_url', 'email_header_color', 'email_button_color',
      'arrival_email_enabled', 'arrival_email_after_hour', 'arrival_email_before_hour',
      'updated_at'])
    and (to_jsonb(old) -> e.key) is distinct from e.value;
  if v_bad is not null then
    raise exception 'Only an owner can change these shop settings: %.', v_bad using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger settings_owner_guard on public.settings;
create trigger settings_owner_guard before insert or update or delete on public.settings
  for each row execute function public._settings_owner_guard();

-- A2 ------------------------------------------------------------------------------------------------------------------
-- The staff notice (gold bar at the top of every admin page) lived on settings, which anyone can read, so it
-- wasn't really staff only. It moves to its own one-row table that only staff can read. Changing it still needs
-- an owner, as before (it's on the owner-only Shop Settings screen and the settings guard allowed owners only).
create table public.staff_notice (
  id         int primary key default 1 check (id = 1),
  notice     text constraint staff_notice_notice_check check (length(notice) <= 500),
  updated_at timestamptz not null default now()
);
create trigger staff_notice_touch before update on public.staff_notice for each row execute function public.touch_updated_at();

alter table public.staff_notice enable row level security;
create policy "staff read staff_notice"    on public.staff_notice for select using (public.is_staff());
create policy "owner insert staff_notice"  on public.staff_notice for insert with check (public.is_owner());
create policy "owner update staff_notice"  on public.staff_notice for update using (public.is_owner()) with check (public.is_owner());
revoke all on public.staff_notice from anon, authenticated;
grant select, insert, update on public.staff_notice to authenticated;

-- Same change log as the settings row.
create trigger audit_ins after insert on public.staff_notice referencing new table as new_rows for each statement execute function public._audit_ins('id');
create trigger audit_upd after update on public.staff_notice referencing old table as old_rows new table as new_rows for each statement execute function public._audit_upd('id', '');
create trigger audit_del after delete on public.staff_notice referencing old table as old_rows for each statement execute function public._audit_del('id');

insert into public.staff_notice (id, notice) select 1, admin_notice from public.settings where id = 1
on conflict (id) do nothing;
insert into public.staff_notice (id) values (1) on conflict (id) do nothing;

alter table public.settings drop column admin_notice;

-- A3 ------------------------------------------------------------------------------------------------------------------
-- Deleting a customer for good (record, pull list, orders, follows, notes and login) needs an owner, not just any
-- staff login.
create or replace function public.staff_delete_customer(p_id bigint)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid;
begin
  if not public.is_owner() then
    raise exception 'Only an owner can delete a customer.' using errcode = '42501';
  end if;

  select user_id into v_user from public.customers where id = p_id;
  if not found then
    raise exception 'That customer no longer exists.' using errcode = 'P0001';
  end if;

  delete from public.reservation_orders where customer_id = p_id;
  delete from public.customers where id = p_id;

  if v_user is not null and not exists (select 1 from public.staff where user_id = v_user) then
    delete from auth.users where id = v_user;
  end if;
end;
$$;
revoke execute on function public.staff_delete_customer(bigint) from public, anon;
grant execute on function public.staff_delete_customer(bigint) to authenticated;

-- ===============================================================================================================
-- Part B
-- ===============================================================================================================
-- Backup & Restore audit fixes.
--  1. "Replace" restore wiped rows in tables that weren't ticked: deleting a table's rows also deletes (ON DELETE
--     CASCADE) or unlinks (SET NULL) the rows that point at them, e.g. replacing customers deleted every pull list.
--     restore_replace_impact() lists those other tables with row counts so the screen can warn and offer to restore
--     them too. A multi-table restore now runs in ONE transaction (restore_apply_all): any failure leaves every table
--     exactly as it was, instead of stopping halfway with the earlier tables already replaced.
--  2. Restoring event signups re-sent every signup email. Restores set app.restoring = 'on' for their transaction
--     and the email trigger skips while it's on.
--  3. The audit trail (staff_audit) and the job log can't be restored any more, so a restore can't rewrite them.
--     They are still in the backup file.
--  4. A backup isn't one snapshot (each page is read separately). Tables are now read children first, so a row added
--     mid-backup can't put a child in the file without its parent; and a restore skips (and counts) any child row
--     whose parent is in neither the database nor the backup, instead of refusing the whole table.

-- B3 ------------------------------------------------------------------------------------------------------------------
-- Tables a restore may write to: not the staff list, the audit trail, the job log or the restore's own staging.
create or replace function public._restorable(p_table text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname = p_table
      and c.relname not in ('staff', 'restore_stage', 'staff_audit', 'job_log'));
$$;
revoke execute on function public._restorable(text) from public, anon, authenticated;

-- B1 + B4 -------------------------------------------------------------------------------------------------------------
-- The given public tables (all of them when null) ordered parents first by their foreign keys. Self-references are
-- ignored; a cycle (none today) falls back to name order for the tables left.
create or replace function public._fk_order(p_tables text[] default null)
returns text[]
language plpgsql stable security definer set search_path = public
as $$
declare
  v_left text[];
  v_out  text[] := '{}';
  v_next text[];
begin
  select coalesce(array_agg(c.relname order by c.relname), '{}') into v_left
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
    and (p_tables is null or c.relname = any (p_tables));
  while cardinality(v_left) > 0 loop
    select coalesce(array_agg(t order by t), '{}') into v_next from unnest(v_left) t
    where not exists (
      select 1 from pg_constraint k
      where k.contype = 'f' and k.conrelid = format('public.%I', t)::regclass and k.confrelid <> k.conrelid
        and k.confrelid in (select format('public.%I', p)::regclass from unnest(v_left) p));
    if cardinality(v_next) = 0 then v_next := v_left; end if;
    v_out := v_out || v_next;
    v_left := array(select t from unnest(v_left) t where t <> all (v_next));
  end loop;
  return v_out;
end;
$$;
revoke execute on function public._fk_order(text[]) from public, anon, authenticated;

-- backup_meta as before, plus: tables listed children first (Download backup reads them in this order, so a parent
-- is always read after its children and is still there for any child already read), and whether each can be restored.
create or replace function public.backup_meta()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_order text[] := public._fk_order();
begin
  if not public.is_owner() then raise exception 'Only an owner can back up the data.' using errcode = '42501'; end if;
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
revoke execute on function public.backup_meta() from public, anon;
grant execute on function public.backup_meta() to authenticated;

-- B1 ------------------------------------------------------------------------------------------------------------------
-- What replacing p_tables would do to OTHER tables through their foreign keys, following cascades down:
-- [{ table, action: 'deleted' | 'unlinked' | 'blocks', via: [parent tables], rows }]. rows = rows that point at a
-- parent (an upper bound). 'blocks' = a key that refuses the delete, so the restore would fail unless that table is
-- restored too.
create or replace function public.restore_replace_impact(p_tables text[])
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  r     record;
  v_n   bigint;
  v_out jsonb := '[]';
begin
  if not public.is_owner() then raise exception 'Only an owner can restore data.' using errcode = '42501'; end if;
  for r in
    with recursive walk(child, parent, conid, act, path) as (
      select k.conrelid, k.confrelid, k.oid, k.confdeltype, array[k.confrelid, k.conrelid]
      from pg_constraint k
      where k.contype = 'f' and k.confrelid <> k.conrelid
        and k.confrelid in (select format('public.%I', t)::regclass from unnest(p_tables) t where to_regclass(format('public.%I', t)) is not null)
      union all
      select k.conrelid, k.confrelid, k.oid, k.confdeltype, w.path || k.conrelid
      from walk w join pg_constraint k on k.contype = 'f' and k.confrelid = w.child and k.confrelid <> k.conrelid
      where w.act = 'c' and not k.conrelid = any (w.path)
    )
    select w.child::regclass::text as child_q, c.relname as child, w.parent, w.conid,
           case w.act when 'c' then 'deleted' when 'n' then 'unlinked' when 'd' then 'unlinked' else 'blocks' end as action
    from walk w join pg_class c on c.oid = w.child
    where c.relnamespace = 'public'::regnamespace and c.relname <> all (p_tables)
  loop
    -- Rows in the child that point at a parent row (every key column set).
    execute format('select count(*) from %s where %s', r.child_q,
                   (select string_agg(format('%I is not null', a.attname), ' and ')
                    from pg_constraint k cross join unnest(k.conkey) ck(attnum)
                    join pg_attribute a on a.attrelid = k.conrelid and a.attnum = ck.attnum where k.oid = r.conid))
      into v_n;
    v_out := v_out || jsonb_build_array(jsonb_build_object('table', r.child, 'action', r.action, 'via', (select relname from pg_class where oid = r.parent), 'rows', v_n));
  end loop;
  -- One entry per table: the worst action, every parent it comes through, the largest count.
  return coalesce((
    select jsonb_agg(jsonb_build_object('table', t, 'action', act, 'via', via, 'rows', n) order by t)
    from (
      select e->>'table' t,
             (array_agg(e->>'action' order by array_position(array['deleted', 'unlinked', 'blocks'], e->>'action')))[1] act,
             jsonb_agg(distinct e->>'via') via,
             max((e->>'rows')::bigint) n
      from jsonb_array_elements(v_out) e group by e->>'table'
    ) x where n > 0), '[]');
end;
$$;
revoke execute on function public.restore_replace_impact(text[]) from public, anon;
grant execute on function public.restore_replace_impact(text[]) to authenticated;

-- B1 + B2 + B4 --------------------------------------------------------------------------------------------------------
-- Load every staged table in p_tables in ONE transaction: replace mode deletes them children first, then each is
-- loaded parents first. If any table fails, the error names it and nothing at all is changed.
-- A child row whose parent is in a table being restored but in neither the database nor the backup (a backup taken
-- while the shop was busy) is skipped and counted as orphans_skipped; a missing parent in a table NOT being
-- restored still refuses the table (23503: restore that table too).
-- Returns { tables: [{ table, inserted, rows_now, orphans_skipped }] } in the order loaded.
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
  v_order := public._fk_order(v_tables);

  if p_replace then
    for i in reverse cardinality(v_order) .. 1 loop
      t := v_order[i];
      begin
        execute format('delete from public.%I', t);
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

-- The one-table call is kept for anything still using it; it now goes through restore_apply_all.
create or replace function public.restore_apply(p_table text, p_replace boolean default false)
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  return public.restore_apply_all(array[p_table], p_replace) -> 'tables' -> 0;
end;
$$;
revoke execute on function public.restore_apply(text, boolean) from public, anon;
grant execute on function public.restore_apply(text, boolean) to authenticated;

-- B2 ------------------------------------------------------------------------------------------------------------------
-- As before, but a signup put back by a restore isn't emailed again.
create or replace function public.event_signup_email_trigger()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_url text;
  v_key text;
begin
  if current_setting('app.restoring', true) = 'on' then return new; end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'weekly_email_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'weekly_email_secret';
  if v_url is null or v_key is null then
    raise warning 'event signup emails need the weekly_email_url / weekly_email_secret Vault secrets';
    return new;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_key),
    body := jsonb_build_object('mode', 'event_signup', 'signup_id', new.id),
    timeout_milliseconds := 30000
  );
  return new;
exception when others then
  raise warning 'event signup email not queued: %', sqlerrm;
  return new;
end;
$$;
revoke execute on function public.event_signup_email_trigger() from public, anon, authenticated;

-- ===============================================================================================================
-- Part C
-- ===============================================================================================================
-- C1 ------------------------------------------------------------------------------------------------------------------
-- Staff status changes on reservation lines (Ordering page: the status dropdown, "Mark all picked up", "Mark copies
-- ordered", "Not ordering", "Mark ready"). These used to be direct updates from the admin with every line id in the
-- URL, which a busy cutoff could push past the gateway's URL limit; "Mark copies ordered" had no status check, so
-- lines another staff member had marked Not ordered (or a customer had cancelled) while the confirm box was open were
-- flipped back to Ordered; and the history log was written separately (errors ignored, sometimes for lines the
-- update had skipped, and not at all for the dropdown or Mark ordered).
-- staff_set_line_status() takes the line ids in the request body, changes only the lines still in one of p_from
-- (any status when p_from is null), stamps today's shop date as the arrival date when the new status is Ready (it
-- starts the hold window, like the nightly flip; the arrival email goes out from arrival_email_tick as before),
-- logs exactly the lines it changed in the customer's pull list history, and returns how many it changed.

-- The staff wording of a line status (LINE_STATUS in js/labels.js), for the history log.
create or replace function public._line_status_label(s public.reservation_status)
returns text
language sql immutable set search_path = public
as $$
  select case s
    when 'open' then 'Open' when 'ordered' then 'Ordered' when 'reordered' then 'Reordered' when 'arrived' then 'Ready'
    when 'picked_up' then 'Picked up' when 'released' then 'Released to shelf' when 'not_ordered' then 'Not ordered'
    when 'cancelled' then 'Cancelled' else s::text end;
$$;
revoke execute on function public._line_status_label(public.reservation_status) from public, anon, authenticated;

create or replace function public.staff_set_line_status(p_ids bigint[], p_status public.reservation_status, p_from public.reservation_status[] default null)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_n int;
begin
  if not public.is_staff() then raise exception 'Staff only.' using errcode = '42501'; end if;
  with old as (
    -- Locking re-checks the status against the latest row, so a line changed meanwhile is left alone.
    select r.id, r.status from public.reservations r
    where r.id = any (p_ids) and r.status <> p_status and (p_from is null or r.status = any (p_from))
    order by r.id
    for update
  ), done as (
    update public.reservations r
    set status = p_status, arrived_on = case when p_status = 'arrived' then public.shop_today() else r.arrived_on end
    from old where r.id = old.id
    returning r.id, r.order_id, r.item_id, old.status as was
  ), logged as (
    insert into public.pull_list_log (customer_id, reservation_id, action, detail)
    select o.customer_id, d.id, 'status',
           i.title || coalesce(' #' || nullif(i.issue_number, ''), '') || coalesce(' · ' || nullif(i.variant, ''), '')
           || ': ' || public._line_status_label(d.was) || ' → ' || public._line_status_label(p_status)
    from done d
    join public.reservation_orders o on o.id = d.order_id
    join public.items i on i.id = d.item_id
    where o.customer_id is not null
  )
  select count(*) into v_n from done;
  return v_n;
end;
$$;
revoke execute on function public.staff_set_line_status(bigint[], public.reservation_status, public.reservation_status[]) from public, anon;
grant execute on function public.staff_set_line_status(bigint[], public.reservation_status, public.reservation_status[]) to authenticated;

-- ===============================================================================================================
-- Part D
-- ===============================================================================================================
-- Email audit fixes (weekly pull list email, "your books are in" email, Admin -> Emails).
--  1. Weekly email retries: the hourly tick used to call the function only in the scheduled hour, so customers whose
--     email failed then missed the week. The function now marks the day done only when nothing due failed, and the
--     tick keeps calling it for three more hours that day until it is done. Customers already emailed today
--     (customers.last_emailed_on) are never emailed again, so a retry only reaches the ones that failed.
--  2. Saving Admin -> Emails is one call: the email settings and the signup text are saved together or not at all.
--     It runs as the signed-in staff member (security invoker), so row security and the owner-only settings guard
--     apply exactly as before. Saving nothing (signed out, or no settings row) is an error, not a silent success.

-- D1 ------------------------------------------------------------------------------------------------------------------
create or replace function public.weekly_pull_list_tick()
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare
  s       public.settings;
  v_local timestamp;
  v_hr    int;
  v_url   text;
  v_key   text;
begin
  select * into s from public.settings where id = 1;
  if s.id is null or not s.pull_list_email_enabled then
    return;
  end if;
  v_local := now() at time zone coalesce(s.timezone, 'America/New_York');
  v_hr := extract(hour from v_local)::int;
  -- The scheduled hour, then up to three retries in the hours after it (same day) until a run closes the day.
  if extract(dow from v_local)::int <> s.pull_list_email_day
     or v_hr < s.pull_list_email_hour or v_hr > s.pull_list_email_hour + 3
     or s.pull_list_email_last_sent = v_local::date then
    return;
  end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'weekly_email_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'weekly_email_secret';
  if v_url is null or v_key is null then
    raise warning 'weekly pull list email is on but the weekly_email_url / weekly_email_secret Vault secrets are missing';
    return;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_key),
    body := jsonb_build_object('mode', 'send'),
    timeout_milliseconds := 120000
  );
end;
$$;
revoke execute on function public.weekly_pull_list_tick() from public, anon, authenticated;

-- D2 ------------------------------------------------------------------------------------------------------------------
-- p: the Emails form's settings columns (a key left out keeps its value); p_signup_html: the signup intro text.
create or replace function public.staff_save_email_settings(p jsonb, p_signup_html text)
returns void
language plpgsql security invoker set search_path = public
as $$
declare
  v_id int;
begin
  if not public.is_staff() then
    raise exception 'Staff only. You may have been signed out: sign in again and save.' using errcode = '42501';
  end if;
  update public.settings set
    pull_list_email_enabled   = case when p ? 'pull_list_email_enabled'   then (p ->> 'pull_list_email_enabled')::boolean    else pull_list_email_enabled end,
    pull_list_email_day       = case when p ? 'pull_list_email_day'       then (p ->> 'pull_list_email_day')::smallint      else pull_list_email_day end,
    pull_list_email_hour      = case when p ? 'pull_list_email_hour'      then (p ->> 'pull_list_email_hour')::smallint     else pull_list_email_hour end,
    pull_list_email_from      = case when p ? 'pull_list_email_from'      then nullif(trim(p ->> 'pull_list_email_from'), '') else pull_list_email_from end,
    email_logo_url            = case when p ? 'email_logo_url'            then nullif(p ->> 'email_logo_url', '')       else email_logo_url end,
    email_header_color        = case when p ? 'email_header_color'        then nullif(p ->> 'email_header_color', '')   else email_header_color end,
    email_button_color        = case when p ? 'email_button_color'        then nullif(p ->> 'email_button_color', '')   else email_button_color end,
    arrival_email_enabled     = case when p ? 'arrival_email_enabled'     then (p ->> 'arrival_email_enabled')::boolean      else arrival_email_enabled end,
    arrival_email_after_hour  = case when p ? 'arrival_email_after_hour'  then (p ->> 'arrival_email_after_hour')::smallint  else arrival_email_after_hour end,
    arrival_email_before_hour = case when p ? 'arrival_email_before_hour' then (p ->> 'arrival_email_before_hour')::smallint else arrival_email_before_hour end
  where id = 1
  returning id into v_id;
  if v_id is null then
    raise exception 'Nothing was saved. You may have been signed out: sign in again and save.' using errcode = 'P0001';
  end if;
  insert into public.pages (slug, lede_html) values ('home-newsletter', p_signup_html)
  on conflict (slug) do update set lede_html = excluded.lede_html;
end;
$$;
revoke execute on function public.staff_save_email_settings(jsonb, text) from public, anon;
grant execute on function public.staff_save_email_settings(jsonb, text) to authenticated;

-- ===============================================================================================================
-- Part E
-- ===============================================================================================================
-- E1 ------------------------------------------------------------------------------------------------------------------
-- Admin -> Series lists every series. One request returns at most 1,000 rows, so the screen now loads the list a
-- page at a time; pages need a fixed order, so ties on the name are broken by the key.
create or replace function public.staff_list_series()
returns table (key text, label text, issues bigint, cover_url text, publisher text)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'Staff only.' using errcode = '42501'; end if;
  return query
  with s as (
    select i.series_key as k, (array_agg(i.title order by length(i.title), i.created_at desc))[1] as l, count(distinct i.issue_number) as n,
           mode() within group (order by i.publisher) as p
    from public.items i
    left join public.categories cat on cat.id = i.category_id
    where i.issue_number is not null and i.series_key is not null and not i.hidden
      and coalesce(cat.slug, 'comics') in ('comics', 'trades', 'omnibuses')
    group by i.series_key
  ),
  c as (
    select sc.key as k, sc.title as l, 0::bigint as n, sc.publisher as p
    from public.series_catalog sc
    where not exists (select 1 from s where s.k = sc.key)
  )
  select u.k, u.l, u.n, sc.cover_url, coalesce(u.p, sc.publisher)
  from (select * from s union all select * from c) u
  left join public.series_catalog sc on sc.key = u.k
  order by u.l, u.k;
end;
$$;

-- E2 ------------------------------------------------------------------------------------------------------------------
-- Merging series. The merged-away series' active-list row was deleted along with its cover; the cover now moves to
-- the series kept when that one has none (and the kept series joins the active list if the old one was on it).
-- Merges are recorded in series_aliases, so following, or setting a cover on, a merged-away key (a stale search
-- result or admin screen) now lands on the series it was merged into instead of failing or bringing the old key
-- back as an empty series.

create or replace function public._series_resolve(p_key text)
returns text
language sql stable security definer set search_path = public
as $$ select coalesce((select to_key from public.series_aliases where from_key = p_key), p_key); $$;
revoke execute on function public._series_resolve(text) from public, anon, authenticated;

create or replace function public.staff_merge_series(p_from text, p_to text)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_n  int;
  v_to text := public._series_resolve(p_to);
begin
  if not public.is_staff() then raise exception 'Staff only.' using errcode = '42501'; end if;
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

create or replace function public.follow_series(p_key text, p_quantity int default 1)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  c     public.customers := public._pull_list_customer();
  v_key text := public._series_resolve(p_key);
begin
  return public._subscribe(c, 'series', v_key, coalesce(public._series_label(v_key), v_key), null, p_quantity);
end;
$$;

create or replace function public.staff_follow_series(p_customer bigint, p_key text, p_quantity int default 1)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  c     public.customers;
  v_key text := public._series_resolve(p_key);
begin
  if not public.is_staff() then raise exception 'Staff only.' using errcode = '42501'; end if;
  select * into c from public.customers where id = p_customer;
  if c.id is null then raise exception 'That customer no longer exists.' using errcode = 'P0001'; end if;
  return public._subscribe(c, 'series', v_key, coalesce(public._series_label(v_key), v_key), null, p_quantity);
end;
$$;

create or replace function public.staff_set_series_cover(p_key text, p_title text, p_url text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_key text := public._series_resolve(p_key);
begin
  if not public.is_staff() then raise exception 'Staff only.' using errcode = '42501'; end if;
  insert into public.series_catalog (key, title, cover_url)
  values (v_key, left(coalesce(case when v_key = p_key then nullif(trim(p_title), '') end, public._series_label(v_key), v_key), 200), nullif(trim(p_url), ''))
  on conflict (key) do update set cover_url = excluded.cover_url;
end;
$$;

revoke execute on function public.staff_merge_series(text, text), public.follow_series(text, int),
  public.staff_follow_series(bigint, text, int), public.staff_set_series_cover(text, text, text) from public, anon;
grant execute on function public.staff_merge_series(text, text), public.follow_series(text, int),
  public.staff_follow_series(bigint, text, int), public.staff_set_series_cover(text, text, text) to authenticated;

-- Leftovers: active-list rows for a merged-away key with no titles of their own (a cover set on the old key from a
-- screen opened before the merge). They fold into the series they were merged into, the same way a merge does.
with gone as (
  select a.to_key, sc.title, sc.publisher, sc.cover_url
  from public.series_aliases a join public.series_catalog sc on sc.key = a.from_key
  where not exists (select 1 from public.items i where i.series_key = a.from_key)
)
insert into public.series_catalog (key, title, publisher, cover_url)
select distinct on (to_key) to_key, left(coalesce(public._series_label(to_key), title), 200), publisher, cover_url
from gone order by to_key, cover_url is null
on conflict (key) do update set
  cover_url = coalesce(series_catalog.cover_url, excluded.cover_url),
  publisher = coalesce(series_catalog.publisher, excluded.publisher);
delete from public.subscriptions s using public.series_aliases a
where s.kind = 'series' and s.key = a.from_key
  and exists (select 1 from public.subscriptions t where t.customer_id = s.customer_id and t.kind = 'series' and t.key = a.to_key);
update public.subscriptions s set key = a.to_key, label = coalesce(public._series_label(a.to_key), s.label)
from public.series_aliases a where s.kind = 'series' and s.key = a.from_key;
delete from public.series_catalog sc using public.series_aliases a
where sc.key = a.from_key and not exists (select 1 from public.items i where i.series_key = sc.key);

-- E3 ------------------------------------------------------------------------------------------------------------------
-- Admin -> Titles' FOC week and Out week dropdowns showed how many titles fall in each week by downloading the
-- dates of every title (tens of thousands of rows) on every visit and after every save. The database counts them
-- instead: one entry per kind ('foc' / 'release') and shop week (starting Sunday; null = no date). Hidden titles
-- count too, as before (the list shows them). One jsonb value, so the 1,000-row limit doesn't apply.
create or replace function public.staff_item_week_counts()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'Staff only.' using errcode = '42501'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object('k', k, 'w', w, 'n', n)), '[]'::jsonb)
    from (
      select 'foc' as k, foc_date - extract(dow from foc_date)::int as w, count(*) as n from public.items group by 2
      union all
      select 'release', release_date - extract(dow from release_date)::int, count(*) from public.items group by 2
    ) t
  );
end;
$$;
revoke execute on function public.staff_item_week_counts() from public, anon;
grant execute on function public.staff_item_week_counts() to authenticated;

