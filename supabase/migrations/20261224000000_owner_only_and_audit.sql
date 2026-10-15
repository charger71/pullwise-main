-- Owner-only rules and a staff change log.
--
-- 1. Shop settings: a regular staff login can still change the columns the Dashboard and Emails
--    screens edit (announcement, email schedule and look), but every other settings column needs an
--    owner. Enforced by a trigger, so it holds whatever the screen does.
-- 2. Deleting titles, Pages text, Media Library files and series needs an owner (staff can still add
--    and edit them; they can hide a title instead of deleting it).
-- 3. staff_audit: one row for every insert / update / delete a signed-in staff member makes to the
--    shop's content tables, with who, what and which columns changed. Owners read it on Admin -> Staff.
--    One row per statement, so an import of 500 titles is one entry, not 500. Scheduled jobs and
--    customers' own actions are not logged (only people in the staff table are).

-- 1 ---------------------------------------------------------------------------
create or replace function public._settings_owner_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_bad text;
begin
  -- Scheduled jobs, the Edge functions and the SQL editor have no signed-in user.
  if auth.uid() is null or public.is_owner() then return new; end if;
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

create trigger settings_owner_guard before update on public.settings
  for each row execute function public._settings_owner_guard();

-- 2 ---------------------------------------------------------------------------
drop policy "staff all items" on public.items;
create policy "staff insert items" on public.items for insert with check (public.is_staff());
create policy "staff update items" on public.items for update using (public.is_staff()) with check (public.is_staff());
create policy "owner delete items" on public.items for delete using (public.is_owner());

drop policy "staff all pages" on public.pages;
create policy "staff insert pages" on public.pages for insert with check (public.is_staff());
create policy "staff update pages" on public.pages for update using (public.is_staff()) with check (public.is_staff());
create policy "staff read pages"   on public.pages for select using (public.is_staff());
create policy "owner delete pages" on public.pages for delete using (public.is_owner());

drop policy "staff delete media" on storage.objects;
create policy "owner delete media" on storage.objects for delete using (bucket_id = 'media' and public.is_owner());

create or replace function public.staff_delete_series(p_key text)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_titles int;
  v_follows int;
begin
  if not public.is_owner() then raise exception 'Only an owner can delete a series.' using errcode = '42501'; end if;
  select count(*) into v_titles from public.items where series_key = p_key;
  if v_titles > 0 then
    raise exception 'This series has % imported titles, so it can''t be deleted here. Delete or hide its titles first.', v_titles using errcode = 'P0001';
  end if;
  delete from public.subscriptions where kind = 'series' and key = p_key;
  get diagnostics v_follows = row_count;
  delete from public.series_catalog where key = p_key;
  return v_follows;
end;
$$;

-- 3 ---------------------------------------------------------------------------
create table public.staff_audit (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id    uuid,
  staff_name text,
  table_name text not null,
  action     text not null check (action in ('insert', 'update', 'delete')),
  row_count  int  not null default 1,
  -- [{ "key": "12", "label": "Batman #1", "changed": { "price": { "from": 3.99, "to": 4.99 } } }, ...]
  -- (at most 10 rows; long values are cut short; private tables list column names only)
  summary    jsonb not null default '[]'
);
create index staff_audit_created_idx on public.staff_audit (created_at desc);
create index staff_audit_table_idx on public.staff_audit (table_name, created_at desc);

alter table public.staff_audit enable row level security;
create policy "owner read staff_audit" on public.staff_audit for select using (public.is_owner());
revoke all on public.staff_audit from anon, authenticated;
grant select on public.staff_audit to authenticated;

create or replace function public._audit_cell(v jsonb)
returns jsonb
language sql immutable
as $$
  select case
    when v is null then null
    when jsonb_typeof(v) = 'string' and length(v #>> '{}') > 120 then to_jsonb(left(v #>> '{}', 120) || '…')
    when jsonb_typeof(v) in ('object', 'array') and length(v::text) > 120 then to_jsonb(left(v::text, 120) || '…')
    else v end;
$$;

create or replace function public._audit_label(j jsonb, k text)
returns jsonb
language sql immutable
as $$
  select jsonb_build_object('key', j ->> k,
    'label', left(coalesce(j ->> 'title', j ->> 'name', j ->> 'question', j ->> 'slug', j ->> 'value', j ->> 'shop_name', j ->> 'email', j ->> k), 120));
$$;

-- What changed between two versions of a row; null when nothing but bookkeeping columns did.
create or replace function public._audit_diff(o jsonb, n jsonb, k text, names_only boolean)
returns jsonb
language plpgsql immutable
as $$
declare
  v_changed jsonb;
begin
  select jsonb_object_agg(e.key, case when names_only then 'true'::jsonb
                                      else jsonb_build_object('from', public._audit_cell(o -> e.key), 'to', public._audit_cell(e.value)) end)
  into v_changed
  from jsonb_each(n) e
  where e.key <> all (array['updated_at', 'series_key', 'search_norm', 'arrival_rank']) and (o -> e.key) is distinct from e.value;
  if v_changed is null then return null; end if;
  return public._audit_label(n, k) || jsonb_build_object('changed', v_changed);
end;
$$;

-- Statement-level triggers (transition tables) so a bulk change is one log entry.
-- Arguments: key column (default id), and 'names' to log column names without values.
create or replace function public._audit_ins()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_n int; v_rows jsonb;
begin
  if not public.is_staff() then return null; end if;
  select count(*), coalesce(jsonb_agg(l) filter (where rn <= 10), '[]')
  into v_n, v_rows
  from (select row_number() over () rn, public._audit_label(to_jsonb(r), coalesce(tg_argv[0], 'id')) l from new_rows r) q;
  if v_n > 0 then
    insert into public.staff_audit (user_id, staff_name, table_name, action, row_count, summary)
    values (auth.uid(), (select name from public.staff where user_id = auth.uid()), tg_table_name, 'insert', v_n, v_rows);
  end if;
  return null;
end;
$$;

create or replace function public._audit_upd()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_n int; v_rows jsonb; v_key text := coalesce(tg_argv[0], 'id');
begin
  if not public.is_staff() then return null; end if;
  select count(*), coalesce(jsonb_agg(d) filter (where rn <= 10), '[]')
  into v_n, v_rows
  from (
    select row_number() over () rn, d from (
      select public._audit_diff(to_jsonb(o), to_jsonb(n), v_key, tg_argv[1] = 'names') d
      from old_rows o join new_rows n on (to_jsonb(o) ->> v_key) = (to_jsonb(n) ->> v_key)
    ) x where d is not null
  ) q;
  if v_n > 0 then
    insert into public.staff_audit (user_id, staff_name, table_name, action, row_count, summary)
    values (auth.uid(), (select name from public.staff where user_id = auth.uid()), tg_table_name, 'update', v_n, v_rows);
  end if;
  return null;
end;
$$;

create or replace function public._audit_del()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_n int; v_rows jsonb;
begin
  if not public.is_staff() then return null; end if;
  select count(*), coalesce(jsonb_agg(l) filter (where rn <= 10), '[]')
  into v_n, v_rows
  from (select row_number() over () rn, public._audit_label(to_jsonb(r), coalesce(tg_argv[0], 'id')) l from old_rows r) q;
  if v_n > 0 then
    insert into public.staff_audit (user_id, staff_name, table_name, action, row_count, summary)
    values (auth.uid(), (select name from public.staff where user_id = auth.uid()), tg_table_name, 'delete', v_n, v_rows);
  end if;
  return null;
end;
$$;


do $$
declare
  t record;
begin
  for t in select * from (values
    ('settings', 'id', ''), ('items', 'id', ''), ('events', 'id', ''), ('posts', 'id', ''), ('pages', 'slug', ''),
    ('faqs', 'id', ''), ('categories', 'id', ''), ('series_catalog', 'key', ''), ('series_aliases', 'from_key', ''),
    ('surveys', 'id', ''), ('import_exclusions', 'id', ''),
    ('customers', 'id', 'names'), ('customer_notes', 'id', 'names'), ('event_signups', 'id', 'names')
  ) v(tbl, k, mode) loop
    execute format('create trigger audit_ins after insert on public.%I referencing new table as new_rows for each statement execute function public._audit_ins(%L)', t.tbl, t.k);
    execute format('create trigger audit_upd after update on public.%I referencing old table as old_rows new table as new_rows for each statement execute function public._audit_upd(%L, %L)', t.tbl, t.k, t.mode);
    execute format('create trigger audit_del after delete on public.%I referencing old table as old_rows for each statement execute function public._audit_del(%L)', t.tbl, t.k);
  end loop;
end $$;
