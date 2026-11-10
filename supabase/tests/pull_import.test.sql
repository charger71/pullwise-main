-- Customer pull list import (20270306000000_pull_list_import.sql). Run with tools/test-db.sh on a scratch database.
-- Everything happens in one transaction that is rolled back. A failed check raises an exception.
\set ON_ERROR_STOP on
set client_min_messages = warning;
begin;

-- ---- Fixtures --------------------------------------------------------------------------------------------------------
-- A staff login (is_staff() reads auth.uid() from the claim) and a catalog:
--   starfall rangers - #3 past its cutoff (coming soon), two open issues (#4 main and a B cover, #5)
--   night harbor     - one open issue, mature
--   absolute batman  - open; "batman" is merged into it (series_aliases)
--   lantern keeper   - only in the series catalog, no titles yet
--   saga             - open; used for the existing-follow check
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'staff@example.com');
insert into public.staff (user_id, name) values ('00000000-0000-0000-0000-00000000000a', 'Test staff');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);

insert into public.items (title, issue_number, variant, publisher, status, foc_date, mature) values
  ('STARFALL RANGERS', '4', 'CVR A', 'Image', 'pre_order', current_date + 30, false),
  ('STARFALL RANGERS', '4', 'CVR B VARIANT', 'Image', 'pre_order', current_date + 30, false),
  ('STARFALL RANGERS', '5', null, 'Image', 'pre_order', current_date + 60, false),
  ('STARFALL RANGERS', '3', null, 'Image', 'coming_soon', current_date - 2, false),
  ('NIGHT HARBOR (MR)', '2', null, 'Dark Horse', 'pre_order', current_date + 30, true),
  ('ABSOLUTE BATMAN', '12', null, 'DC', 'pre_order', current_date + 30, false),
  ('SAGA', '70', null, 'Image', 'pre_order', current_date + 30, false);
insert into public.series_aliases (from_key, to_key) values ('batman', 'absolute batman');
insert into public.series_catalog (key, title, publisher) values ('lantern keeper', 'Lantern Keeper', 'BOOM!');

-- An existing customer, with a follow of Saga at 3 copies and staff notes.
insert into public.customers (first_name, last_name, email, phone) values ('Dana', 'Old', 'dana@example.com', '(555) 200-1000');
insert into public.subscriptions (customer_id, kind, key, label, quantity)
select id, 'series', 'saga', 'SAGA', 3 from public.customers where email = 'dana@example.com';
insert into public.customer_notes (customer_id, notes) select id, 'Prefers Friday pickup.' from public.customers where email = 'dana@example.com';

-- ---- Matching order --------------------------------------------------------------------------------------------------
do $$
declare
  m record;
begin
  -- exact: the key itself
  select * into m from public._pull_import_match('Starfall Rangers');
  assert m.o_status = 'matched' and m.o_method = 'exact' and m.o_key = 'starfall rangers', format('exact: %s', row_to_json(m));
  -- exact through series_aliases (_series_key_auto follows it)
  select * into m from public._pull_import_match('Batman');
  assert m.o_status = 'matched' and m.o_method = 'exact' and m.o_key = 'absolute batman', format('series alias: %s', row_to_json(m));
  -- exact against a series that is only in the catalog
  select * into m from public._pull_import_match('LANTERN KEEPER');
  assert m.o_status = 'matched' and m.o_key = 'lantern keeper', format('catalog only: %s', row_to_json(m));
  -- close: a misspelling gets candidates, best first, and needs a look
  select * into m from public._pull_import_match('Starfal Rangrs');
  assert m.o_status = 'review' and m.o_method = 'close' and m.o_candidates -> 0 ->> 'key' = 'starfall rangers', format('close: %s', row_to_json(m));
  assert jsonb_array_length(m.o_candidates) <= 5;
  -- nothing like it
  select * into m from public._pull_import_match('Zzyzx Quorble');
  assert m.o_status = 'not_found' and m.o_key is null, format('not found: %s', row_to_json(m));
  -- an import alias wins over an exact match ("saga" means starfall rangers here, as a test of the order)
  insert into public.pull_import_aliases (raw_key, series_key) values ('saga', 'starfall rangers');
  select * into m from public._pull_import_match('Saga');
  assert m.o_method = 'alias' and m.o_key = 'starfall rangers', format('alias first: %s', row_to_json(m));
  delete from public.pull_import_aliases where raw_key = 'saga';
  -- an alias to a series that no longer exists is ignored
  insert into public.pull_import_aliases (raw_key, series_key) values ('saga', 'gone forever');
  select * into m from public._pull_import_match('Saga');
  assert m.o_method = 'exact' and m.o_key = 'saga', format('stale alias: %s', row_to_json(m));
  delete from public.pull_import_aliases where raw_key = 'saga';
end $$;

-- ---- A batch: matching, review decisions and aliases ----------------------------------------------------------------
insert into public.import_batches (source_name) values ('test-sheet.csv');
insert into public.import_customers (batch_id, ref, first_name, last_name, email, phone, mature_ok, no_email)
select b.id, v.ref, v.f, v.l, v.e, v.p, v.m, v.n
from public.import_batches b, (values
  ('e:jane@example.com', 'Jane', 'New', 'jane@example.com', null, false, false),
  ('e:dana@example.com', 'Dana', 'Different', 'DANA@example.com', null, true, true),   -- existing, by email
  ('p:5552001000', 'D.', null, null, '+1 555 200 1000', false, false),                 -- the same Dana, by phone
  ('n:walk in', 'Walk', 'In', null, null, false, false),                               -- no email, no phone
  ('n:bad', 'Bad', 'Line', 'bad@example.com', null, false, false)
) v(ref, f, l, e, p, m, n)
where b.source_name = 'test-sheet.csv';
insert into public.import_lines (batch_id, customer_ref, position, raw_title, raw_quantity, raw_notes)
select b.id, v.ref, v.pos, v.t, v.q, v.notes
from public.import_batches b, (values
  ('e:jane@example.com', 1, 'Starfall Rangers', 2, 'Wants the A cover'),
  ('e:jane@example.com', 2, 'Night Harbor', 1, null),                -- mature; Jane isn't mature_ok
  ('e:jane@example.com', 3, 'Starfal Rangrs', 1, null),              -- close match, decided below
  ('e:jane@example.com', 4, 'Lantern Keeper', 1, null),              -- catalog only: follow saved, nothing added
  ('e:dana@example.com', 1, 'Saga', 1, 'Long-time subscriber'),      -- already follows Saga at 3
  ('e:dana@example.com', 2, 'Night Harbor', 1, null),                -- mature_ok from the sheet
  ('p:5552001000', 1, 'Batman', 1, null),
  ('n:walk in', 1, 'Starfal Rangrs', 1, null),                       -- same spelling as Jane's line 3
  ('n:bad', 1, 'Zzyzx Quorble', 1, null)
) v(ref, pos, t, q, notes)
where b.source_name = 'test-sheet.csv';

do $$
declare
  v_batch bigint := (select id from public.import_batches where source_name = 'test-sheet.csv');
  v_res   jsonb;
  v_line  bigint;
begin
  -- matching in small steps reports what is left
  v_res := public.staff_import_match(v_batch, 4);
  assert (v_res ->> 'remaining')::int = 5, format('first step: %s', v_res);
  v_res := public.staff_import_match(v_batch, 100);
  assert (v_res ->> 'remaining')::int = 0, format('second step: %s', v_res);
  assert (select status from public.import_batches where id = v_batch) = 'reviewing';

  -- de-duplication: both Dana rows find the existing customer, the rest are new
  assert (select count(*) from public.import_customers where batch_id = v_batch and customer_id = (select id from public.customers where email = 'dana@example.com')) = 2,
    'Dana by email and by phone';
  assert (select count(*) from public.import_customers where batch_id = v_batch and was_new) = 3, 'three new customers';

  assert (select status from public.import_lines where batch_id = v_batch and customer_ref = 'n:walk in') = 'review';
  assert (select status from public.import_lines where batch_id = v_batch and customer_ref = 'n:bad') = 'not_found';

  -- Save refuses while titles are waiting: no customer is touched and they stay pending
  v_res := public.staff_import_pull_lists(jsonb_build_object('batch_id', v_batch, 'refs', jsonb_build_array('e:jane@example.com')));
  assert v_res -> 'results' -> 0 ->> 'status' = 'failed' and v_res -> 'results' -> 0 ->> 'error' like '1 title still needs a decision%', format('waiting: %s', v_res);
  assert not exists (select 1 from public.customers where email = 'jane@example.com'), 'nothing saved while waiting';

  -- staff pick the candidate for Jane's misspelling: saved as an import alias, and the walk-in's same spelling follows
  select id into v_line from public.import_lines where batch_id = v_batch and customer_ref = 'e:jane@example.com' and position = 3;
  v_res := public.staff_import_decide(v_line, 'starfall rangers');
  assert (v_res ->> 'also')::int = 1, format('same spelling: %s', v_res);
  assert (select series_key from public.pull_import_aliases where raw_key = 'starfal rangrs') = 'starfall rangers', 'alias saved';
  assert (select match_method from public.import_lines where id = v_line) = 'staff';
  assert (select match_method || ':' || status from public.import_lines where batch_id = v_batch and customer_ref = 'n:walk in') = 'alias:matched';
  -- and the next import of that spelling matches by alias
  assert (select o_method from public._pull_import_match('Starfal Rangrs')) = 'alias', 'alias used next time';

  -- the not-found line is skipped (not an alias)
  perform public.staff_import_decide((select id from public.import_lines where batch_id = v_batch and customer_ref = 'n:bad'), null);
  assert (select status from public.import_lines where batch_id = v_batch and customer_ref = 'n:bad') = 'skipped';
  assert not exists (select 1 from public.pull_import_aliases where raw_key = 'zzyzx quorble'), 'a skip is not an alias';

  -- matched lines carry their series' name
  assert (select candidates -> 0 ->> 'label' from public.import_lines where batch_id = v_batch and customer_ref = 'p:5552001000') = 'ABSOLUTE BATMAN';
  assert (select candidates @> '[{"key": "starfall rangers"}]' from public.import_lines where id = v_line), 'picked series kept';

  -- adding a not-found title to the series catalog matches the line to it; undo with a skip so the save below is unchanged
  v_res := public.staff_import_add_series((select id from public.import_lines where batch_id = v_batch and customer_ref = 'n:bad'), 'Zzyzx Quorble', 'Indie');
  assert v_res ->> 'key' = 'zzyzx quorble' and exists (select 1 from public.series_catalog where key = 'zzyzx quorble' and publisher = 'Indie'), format('add: %s', v_res);
  assert (select status from public.import_lines where batch_id = v_batch and customer_ref = 'n:bad') = 'matched';
  perform public.staff_import_decide((select id from public.import_lines where batch_id = v_batch and customer_ref = 'n:bad'), null);
  delete from public.pull_import_aliases where raw_key = 'zzyzx quorble';

  -- a series that doesn't exist is refused
  begin
    perform public.staff_import_decide(v_line, 'no such series');
    raise exception 'unknown series accepted';
  exception when sqlstate 'P0001' then null;
  end;
end $$;

-- ---- Saving ----------------------------------------------------------------------------------------------------------
-- A failure for one customer must leave the others saved: make the walk-in fail by giving them no name.
update public.import_customers set first_name = null where ref = 'n:walk in';

do $$
declare
  v_batch bigint := (select id from public.import_batches where source_name = 'test-sheet.csv');
  v_res   jsonb;
  v_jane  bigint;
  v_dana  bigint := (select id from public.customers where email = 'dana@example.com');
  v_lines int;
  v_count int;
begin
  select count(*) into v_count from public.customers;
  v_res := public.staff_import_pull_lists(jsonb_build_object('batch_id', v_batch, 'final', true));
  assert (v_res -> 'counts' ->> 'failed')::int = 1 and (v_res -> 'counts' ->> 'saved')::int = 4, format('save: %s', v_res);
  assert not (v_res ->> 'done')::boolean;
  assert (select status from public.import_batches where id = v_batch) = 'reviewing', 'a failed customer keeps the batch open';
  assert (select error from public.import_customers where batch_id = v_batch and ref = 'n:walk in') like '%no name%';

  -- de-duplication: two new customers (Jane, Bad Line), Dana updated twice but never duplicated
  assert (select count(*) from public.customers) = v_count + 2, 'only two customers created';
  assert (select count(*) from public.customers where lower(email) = 'dana@example.com' or phone_digits like '%5552001000') = 1, 'Dana not duplicated';
  -- existing customer: name and contact kept; mature_ok switched on; "No email" switched the emails off
  assert (select last_name || '|' || mature_ok || '|' || email_opt_in || '|' || notify_arrivals from public.customers where id = v_dana) = 'Old|true|false|false',
    (select row_to_json(c)::text from public.customers c where id = v_dana);
  -- notes appended, never replacing
  assert (select notes from public.customer_notes where customer_id = v_dana) like 'Prefers Friday pickup.%Imported – Saga: Long-time subscriber',
    (select notes from public.customer_notes where customer_id = v_dana);

  -- existing follows untouched: Saga stays at 3 copies; Night Harbor added
  assert (select quantity from public.subscriptions where customer_id = v_dana and key = 'saga') = 3, 'existing follow quantity kept';
  assert (select count(*) from public.subscriptions where customer_id = v_dana) = 3, 'saga, night harbor, absolute batman';

  -- new customer: emails on by default, follows at the sheet's quantity, catalog-only series followed
  select id into v_jane from public.customers where email = 'jane@example.com';
  assert (select email_opt_in and notify_arrivals and not mature_ok from public.customers where id = v_jane), 'new customer defaults';
  assert (select quantity from public.subscriptions where customer_id = v_jane and key = 'starfall rangers') = 2;
  assert exists (select 1 from public.subscriptions where customer_id = v_jane and key = 'lantern keeper'), 'catalog-only follow';
  assert exists (select 1 from public.subscriptions where customer_id = v_jane and key = 'night harbor'), 'mature follow is saved';

  -- open titles added now: Starfall #4 (main cover) and #5, not the B cover, not #3 (cutoff passed), not mature Night Harbor
  select count(*) into v_lines from public.reservations r join public.reservation_orders o on o.id = r.order_id where o.customer_id = v_jane;
  assert v_lines = 2, format('Jane got %s titles', v_lines);
  assert not exists (select 1 from public.reservations r join public.reservation_orders o on o.id = r.order_id join public.items i on i.id = r.item_id
                     where o.customer_id = v_jane and i.mature), 'nothing mature without mature_ok';
  assert (select sum(r.quantity) from public.reservations r join public.reservation_orders o on o.id = r.order_id where o.customer_id = v_jane) = 4, 'two copies each';
  -- Dana is mature_ok now, so Night Harbor came in for her
  assert exists (select 1 from public.reservations r join public.reservation_orders o on o.id = r.order_id join public.items i on i.id = r.item_id
                 where o.customer_id = v_dana and i.mature), 'mature added when mature_ok';
  assert (select titles_added from public.import_customers where batch_id = v_batch and ref = 'e:jane@example.com') = 2;

  -- the job log has one entry with the counts
  assert (select count(*) from public.job_log where job = 'pull_import') = 1;
  assert (select not ok and message like 'test-sheet.csv: 4 of 5 customers saved%1 failed' from public.job_log where job = 'pull_import'),
    (select message from public.job_log where job = 'pull_import');

  -- deciding a saved customer's line is refused
  begin
    perform public.staff_import_decide((select id from public.import_lines where batch_id = v_batch and customer_ref = 'e:jane@example.com' limit 1), null);
    raise exception 'decided a saved line';
  exception when sqlstate 'P0001' then null;
  end;
end $$;

-- ---- Retry: only the failed customer is saved again -----------------------------------------------------------------
update public.import_customers set first_name = 'Walk' where ref = 'n:walk in';
do $$
declare
  v_batch bigint := (select id from public.import_batches where source_name = 'test-sheet.csv');
  v_res   jsonb;
  v_jane  bigint := (select id from public.customers where email = 'jane@example.com');
  v_before int := (select count(*) from public.subscriptions);
begin
  v_res := public.staff_import_pull_lists(jsonb_build_object('batch_id', v_batch, 'refs', jsonb_build_array('n:walk in'), 'final', true));
  assert jsonb_array_length(v_res -> 'results') = 1 and v_res -> 'results' -> 0 ->> 'status' = 'saved', format('retry: %s', v_res);
  assert (v_res ->> 'done')::boolean and (select status from public.import_batches where id = v_batch) = 'committed';
  assert (select count(*) from public.subscriptions) = v_before + 1, 'only the walk-in''s follow added';
  -- a customer with no email and no phone is allowed: follows saved, but no titles (a pull list order needs one)
  assert exists (select 1 from public.customers where first_name = 'Walk' and email is null and phone is null);
  assert (v_res -> 'results' -> 0 ->> 'no_contact')::boolean and (v_res -> 'results' -> 0 ->> 'titles_added')::int = 0, format('no contact: %s', v_res);
  -- Jane's earlier save was not redone
  assert (select count(*) from public.subscriptions where customer_id = v_jane) = 3;
  -- a committed batch can't be saved again
  begin
    perform public.staff_import_pull_lists(jsonb_build_object('batch_id', v_batch));
    raise exception 'saved a committed batch';
  exception when sqlstate 'P0001' then null;
  end;
end $$;

-- ---- Saving adds nothing for titles that aren't open, and sends nothing --------------------------------------------
do $$
begin
  -- the hourly sweep finds nothing more to add right after Save, and doesn't stop on the customer with no contact
  assert public.apply_subscriptions() = 0, 'the sweep had titles left over';
  -- once staff add a phone, the next sweep brings their titles in
  update public.customers set phone = '555-0199' where first_name = 'Walk' and last_name = 'In';
  assert public.apply_subscriptions() = 2, 'the walk-in''s titles after adding a phone';
  -- no email went out: no email log rows, no arrival notices stamped
  assert (select count(*) from public.email_log) = 0, 'an email was logged';
end $$;

-- ---- Cleanup after 30 days -------------------------------------------------------------------------------------------
do $$
declare
  v_batch bigint := (select id from public.import_batches where source_name = 'test-sheet.csv');
begin
  update public.import_batches set finished_at = now() - interval '31 days' where id = v_batch;
  perform public.pull_import_cleanup();
  assert not exists (select 1 from public.import_lines where batch_id = v_batch), 'lines deleted';
  assert not exists (select 1 from public.import_customers where batch_id = v_batch and (email is not null or phone is not null or first_name is not null)), 'contact details blanked';
  assert (select count(*) from public.import_customers where batch_id = v_batch and customer_id is not null) = 5, 'links kept';
  assert exists (select 1 from cron.job where jobname = 'pull-import-cleanup'), 'cleanup scheduled';
end $$;

-- ---- Row security: staff only, nothing for anon -----------------------------------------------------------------------
insert into public.import_batches (source_name) values ('rls-check.csv');
do $$
begin
  assert not has_table_privilege('anon', 'public.import_lines', 'select'), 'anon can read import_lines';
  assert not has_table_privilege('anon', 'public.import_customers', 'select'), 'anon can read import_customers';
  assert not has_table_privilege('anon', 'public.pull_import_aliases', 'select'), 'anon can read pull_import_aliases';
  assert not has_function_privilege('anon', 'public.staff_import_pull_lists(jsonb)', 'execute'), 'anon can save';
  assert not has_function_privilege('authenticated', 'public._pull_import_save_customer(public.import_customers)', 'execute');
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000ff', true); -- signed in, not staff
do $$
begin
  assert (select count(*) from public.import_batches) = 0, 'a customer login sees import batches';
  begin
    perform public.staff_import_find_series('starfall');
    raise exception 'non-staff searched';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

rollback;
\echo pull import tests passed
