-- A restore that brings back titles starts the catalog sync over, and the sync position is never restored
-- (20270409000000_restore_resyncs_catalog.sql). Run with tools/test-db.sh.
-- Everything happens in one transaction that is rolled back. A failed check raises an exception.
\set ON_ERROR_STOP on
set client_min_messages = warning;
begin;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'owner@example.com');
insert into public.staff (user_id, name, is_owner) values ('00000000-0000-0000-0000-0000000000a1', 'Owner', true);
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
set local request.jwt.claim.role = 'authenticated';

do $$
declare
  s public.catalog_sync_state;
begin
  -- The shop is synced up to some point.
  update public.catalog_sync_state set cursor_at = now() - interval '1 day', cursor_id = 500 where id = 1;

  -- Restoring something other than titles leaves the position alone.
  insert into public.restore_stage (table_name, chunk, rows) values
    ('categories', 0, '[{"id": 9001, "slug": "restored-cat", "name": "Restored", "sort": 99}]');
  perform public.restore_apply_all(array['categories']);
  select * into s from public.catalog_sync_state where id = 1;
  if s.cursor_at is null or s.cursor_id is distinct from 500 then
    raise exception 'restoring categories should keep the sync position, got % / %', s.cursor_at, s.cursor_id;
  end if;

  -- Restoring titles clears it, so the next sync reads the whole catalog and links them.
  -- A whole row, as a backup has it: made, read back and deleted, then restored.
  insert into public.items (id, title, issue_number, distributor, sku, status)
    overriding system value values (9101, 'RESTORED', '1', 'prh', '75960600000000111', 'pre_order');
  insert into public.restore_stage (table_name, chunk, rows)
    select 'items', 0, jsonb_build_array(to_jsonb(i)) from public.items i where id = 9101;
  delete from public.items where id = 9101;
  perform public.restore_apply_all(array['items']);
  select * into s from public.catalog_sync_state where id = 1;
  if s.cursor_at is not null or s.cursor_id is not null then
    raise exception 'restoring items should clear the sync position, got % / %', s.cursor_at, s.cursor_id;
  end if;
  if not exists (select 1 from public.items where id = 9101 and catalog_id is null) then
    raise exception 'the restored title should be there, not yet linked';
  end if;

  -- The position itself can't be restored.
  insert into public.restore_stage (table_name, chunk, rows) values
    ('catalog_sync_state', 0, '[{"id": 1, "cursor_at": "2026-01-01T00:00:00Z", "cursor_id": 7}]');
  begin
    perform public.restore_apply_all(array['catalog_sync_state']);
    raise exception 'restoring catalog_sync_state should be refused';
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'catalog_sync_state: that table can''t be restored here.%' then raise; end if;
  end;
end $$;

rollback;
\echo 'restore_resync tests passed'
