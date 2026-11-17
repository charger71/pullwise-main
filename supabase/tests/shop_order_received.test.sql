-- Shop ordering, part 3 (20270405000000_shop_order_received.sql): store copies received, and the past cutoffs.
-- Run with tools/test-db.sh. One transaction, rolled back. A failed check raises an exception.
\set ON_ERROR_STOP on
set client_min_messages = warning;
begin;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'owner@example.com');
insert into public.staff (user_id, name, is_owner) values ('00000000-0000-0000-0000-0000000000a1', 'Olive Owner', true);
update public.trust_settings set verification_enabled = false;
grant select on public.items, public.reservations, public.reservation_orders, public.locations to authenticated;

-- Two weeks ago: Saga #72 (store copies received, a customer picked up) and Kroma #1 (only sent).
-- Last week: Saga #73 (store copies ordered, a customer's line ordered). Next week: Saga #74 (open, not past).
-- Three weeks ago: Nada #1, nothing ordered (a cancelled line).
insert into public.items (title, issue_number, publisher, status, price, foc_date, distributor, sku, series_key) values
  ('Saga',  '72', 'Image', 'available', 4.00, public.shop_today() - 14, 'lunar', 'L072', 'saga'),
  ('Kroma', '1',  'Image', 'available', 4.00, public.shop_today() - 14, 'prh',   null,   'kroma'),
  ('Saga',  '73', 'Image', 'available', 4.00, public.shop_today() - 7,  'lunar', 'L073', 'saga'),
  ('Saga',  '74', 'Image', 'pre_order', 4.00, public.shop_today() + 7,  'lunar', 'L074', 'saga'),
  ('Nada',  '1',  'Image', 'available', 4.00, public.shop_today() - 21, 'lunar', 'L900', 'nada');

create or replace function pg_temp.item(p_title text, p_issue text) returns bigint language sql as $$
  select id from public.items where title = p_title and issue_number = p_issue $$;

insert into public.shop_order_lines (item_id, quantity, status) values
  (pg_temp.item('Saga', '72'), 3, 'received'),
  (pg_temp.item('Saga', '73'), 2, 'ordered'),
  (pg_temp.item('Saga', '74'), 5, 'ordered');  -- ordered early
do $$
declare v_order bigint; v_sub bigint;
begin
  insert into public.reservation_orders (name, phone, email) values ('Ann', '555-0001', 'ann@example.com') returning id into v_order;
  insert into public.reservations (order_id, item_id, quantity, status) values (v_order, pg_temp.item('Saga', '72'), 1, 'picked_up');
  insert into public.reservations (order_id, item_id, quantity, status) values (v_order, pg_temp.item('Saga', '73'), 2, 'ordered');
  insert into public.reservations (order_id, item_id, quantity, status) values (v_order, pg_temp.item('Nada', '1'), 1, 'cancelled');
  insert into public.order_submissions (foc_date, distributor, location_id) values (public.shop_today() - 14, 'prh', public.default_location_id()) returning id into v_sub;
  insert into public.order_submission_lines (submission_id, item_id, quantity, foc_date) values (v_sub, pg_temp.item('Kroma', '1'), 4, public.shop_today() - 14);
end;
$$;

-- ---- Signed in as staff -------------------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';

do $$
declare
  c record;
  n int;
  v_ids bigint[];
begin
  -- Past cutoffs: newest first, only passed ones with something ordered or sent.
  select count(*) into n from public.staff_past_cutoffs();
  assert n = 2, format('2 past cutoffs (not next week''s, not the one with only a cancelled line), got %s', n);
  select * into c from public.staff_past_cutoffs() limit 1;
  assert c.foc_date = public.shop_today() - 7, 'newest first';
  assert c.titles = 1 and c.customer_copies = 2 and c.shop_copies = 2 and c.total = 4, format('last week: 2 + 2 store (got %s, %s, %s)', c.titles, c.customer_copies, c.shop_copies);
  select * into c from public.staff_past_cutoffs() x where x.foc_date = public.shop_today() - 14;
  assert c.titles = 2 and c.customer_copies = 1 and c.shop_copies = 3 and c.submitted_at is not null,
    format('two weeks ago: Saga #72 (1 + 3 received) and Kroma #1 (sent only), got %s titles', c.titles);
  -- Saga #73 would start at last issue's 3 if its cutoff hadn't passed; it has its own 2.
  assert (select x.shop_copies from public.staff_order_rows(public.shop_today() - 7, 'lunar') x where x.item_id = pg_temp.item('Saga', '73')) = 2, 'own row';

  -- Received: only ordered rows change; a received one is left alone; the count says how many.
  select array_agg(id) into v_ids from public.shop_order_lines where item_id in (pg_temp.item('Saga', '72'), pg_temp.item('Saga', '73'));
  n := public.staff_receive_shop_copies(v_ids);
  assert n = 1, format('1 row received (the other was already), got %s', n);
  assert (select status from public.shop_order_lines where item_id = pg_temp.item('Saga', '73')) = 'received', 'Saga #73 received';
  assert (select received_at from public.shop_order_lines where item_id = pg_temp.item('Saga', '73')) is not null, 'received_at set';
  assert public.staff_receive_shop_copies(v_ids) = 0, 'again: nothing left to receive';
  assert public.staff_receive_shop_copies(null) = 0, 'null: nothing';
  -- Received copies still count in the rows.
  assert (select x.shop_status from public.staff_order_rows(public.shop_today() - 7, 'lunar') x where x.item_id = pg_temp.item('Saga', '73')) = 'received', 'shown as received';
end;
$$;

-- ---- Not staff -----------------------------------------------------------------------------------------------------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000ff';
do $$
begin
  begin
    perform public.staff_receive_shop_copies(array[1::bigint]);
    assert false, 'non-staff should be refused';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.staff_past_cutoffs();
    assert false, 'non-staff should be refused';
  exception when insufficient_privilege then null;
  end;
end;
$$;

rollback;
