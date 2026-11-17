-- Shop ordering, part 1 (20270403000000_shop_ordering.sql): store copies, last issue's number, the order rows and
-- cutoff totals, Mark ordered and the submission snapshot. Run with tools/test-db.sh. One transaction, rolled back.
-- A failed check raises an exception.
\set ON_ERROR_STOP on
set client_min_messages = warning;
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@example.com'),
  ('00000000-0000-0000-0000-0000000000c1', 'hal@example.com');
insert into public.staff (user_id, name, is_owner) values ('00000000-0000-0000-0000-0000000000a1', 'Olive Owner', true);
update public.trust_settings set verification_enabled = false;
grant select on public.items, public.reservations, public.reservation_orders, public.locations to authenticated;

-- Cutoff F (a week out) for Lunar, with last week's issues before it, one PRH title, and a title with no cutoff.
insert into public.items (title, issue_number, variant, publisher, status, price, foc_date, distributor, sku, series_key) values
  ('Saga',   '73', null,      'Image', 'available', 4.00, public.shop_today() - 7, 'lunar', 'L073', 'saga'),
  ('Saga',   '74', null,      'Image', 'pre_order', 4.00, public.shop_today() + 7, 'lunar', 'L074', 'saga'),
  ('Saga',   '74', 'Cover B', 'Image', 'pre_order', 5.00, public.shop_today() + 7, 'lunar', 'L074B', 'saga'),
  ('Batman', '1',  null,      'DC',    'pre_order', 5.00, public.shop_today() + 7, 'lunar', 'L001', 'batman'),
  ('Kroma',  '2',  null,      'Image', 'available', 4.00, public.shop_today() - 7, 'lunar', 'L002', 'kroma'),
  ('Kroma',  '3',  null,      'Image', 'pre_order', 4.00, public.shop_today() + 7, 'lunar', 'L003', 'kroma'),
  ('Xeno',   '1',  null,      'Boom',  'pre_order', 3.00, public.shop_today() + 7, 'lunar', null,   'xeno'),
  ('Spidey', '26', null,      'Marvel','pre_order', 4.00, public.shop_today() + 7, 'prh',   null,   'spidey');

create or replace function pg_temp.item(p_title text, p_issue text, p_variant text default null) returns bigint language sql as $$
  select id from public.items where title = p_title and issue_number = p_issue and variant is not distinct from p_variant $$;
create or replace function pg_temp.orow(p_title text, p_issue text, p_variant text default null) returns public.order_row language sql as $$
  select * from public.staff_order_rows(public.shop_today() + 7, 'lunar') r where r.item_id = pg_temp.item(p_title, p_issue, p_variant) $$;

-- Last issues' store copies: Saga #73 had 4, Kroma #2 had 3.
insert into public.shop_order_lines (item_id, quantity, status) values
  (pg_temp.item('Saga', '73'), 4, 'received'),
  (pg_temp.item('Kroma', '2'), 3, 'received');

-- Customer lines (guest orders count: verification is off). Each line is its own order.
do $$
declare
  v_order bigint;
  v_hal   public.customers;
begin
  -- Saga #74: 2 open + 1 already ordered count; a "reordered" line and a re-order line don't.
  insert into public.reservation_orders (name, phone, email) values ('Ann', '555-0001', 'ann@example.com') returning id into v_order;
  insert into public.reservations (order_id, item_id, quantity) values (v_order, pg_temp.item('Saga', '74'), 2);
  insert into public.reservations (order_id, item_id, quantity) values (v_order, pg_temp.item('Batman', '1'), 1);
  insert into public.reservation_orders (name, phone, email) values ('Bo', '555-0002', 'bo@example.com') returning id into v_order;
  insert into public.reservations (order_id, item_id, quantity, status) values (v_order, pg_temp.item('Saga', '74'), 1, 'ordered');
  insert into public.reservation_orders (name, phone, email) values ('Cy', '555-0003', 'cy@example.com') returning id into v_order;
  insert into public.reservations (order_id, item_id, quantity, status) values (v_order, pg_temp.item('Saga', '74'), 5, 'reordered');
  insert into public.reservation_orders (name, phone, email, kind) values ('Di', '555-0004', 'di@example.com', 'reorder') returning id into v_order;
  insert into public.reservations (order_id, item_id, quantity, reorder) values (v_order, pg_temp.item('Batman', '1'), 4, true);
  -- Batman #1: a customer waiting for approval is held back.
  insert into public.customers (first_name, last_name, email, phone, user_id)
  values ('Hal', 'Held', 'hal@example.com', '(555) 700-0001', '00000000-0000-0000-0000-0000000000c1') returning * into v_hal;
  -- (the line goes in first: a new line for an account waiting for approval is dropped by the pause guard)
  update public.customer_standing set account_state = 'proven', unapproved_reason = null where customer_id = v_hal.id;
  insert into public.reservations (order_id, item_id, quantity) values (public._pull_list_order(v_hal), pg_temp.item('Batman', '1'), 6);
  update public.customer_standing set account_state = 'unapproved', unapproved_reason = 'staff' where customer_id = v_hal.id;
  assert (select count(*) from public.reservations where item_id = pg_temp.item('Batman', '1') and status = 'open' and not reorder) = 2,
    'setup: Ann''s and Hal''s Batman lines are open';
end;
$$;

-- ---- Signed in as staff -------------------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';

do $$
declare
  r public.order_row;
  c record;
  n int;
begin
  -- Every Lunar title in the cutoff, reserved or not; not last week's, not PRH's.
  select count(*) into n from public.staff_order_rows(public.shop_today() + 7, 'lunar');
  assert n = 5, format('5 Lunar titles in the cutoff, got %s', n);
  assert not exists (select 1 from public.staff_order_rows(public.shop_today() + 7, 'lunar') x where x.distributor <> 'lunar'), 'only Lunar';
  select count(*) into n from public.staff_order_rows(public.shop_today() + 7, 'all');
  assert n = 6, format('all distributors: 6 titles, got %s', n);

  r := pg_temp.orow('Saga', '74');
  assert r.customer_copies = 3, format('Saga #74: 2 open + 1 ordered, not reordered (got %s)', r.customer_copies);
  assert r.customer_open = 2, 'Saga #74: 2 still open';
  assert r.customers = 2, 'Saga #74: 2 customer orders';
  assert r.shop_copies = 4 and not r.shop_saved and r.last_issue_shop = 4, 'Saga #74 starts at last issue''s 4';
  assert r.total = 7 and r.submitted is null and r.change is null, 'Saga #74: total 7, never sent';

  r := pg_temp.orow('Saga', '74', 'Cover B');
  assert r.last_issue_shop is null and r.shop_copies = 0 and r.total = 0, 'Cover B: no earlier Cover B, starts at 0';

  r := pg_temp.orow('Batman', '1');
  assert r.customer_copies = 1, format('Batman #1: the held line and the re-order don''t count (got %s)', r.customer_copies);

  r := pg_temp.orow('Kroma', '3');
  assert r.shop_copies = 3 and r.total = 3, 'Kroma #3 starts at last issue''s 3';

  -- Place Order lists only titles with copies (Cover B and Xeno have none yet).
  select count(*) into n from public.staff_order_rows(public.shop_today() + 7, 'lunar', null, true);
  assert n = 3, format('3 titles to order, got %s', n);

  -- 0 is kept: it overrides last issue's number.
  r := (select x from public.staff_set_shop_qty(pg_temp.item('Saga', '74'), 0) x);
  assert r.shop_copies = 0 and r.shop_saved and r.total = 3, 'Saga #74 at 0: total 3';
  r := (select x from public.staff_set_shop_qty(pg_temp.item('Saga', '74'), 6) x);
  assert r.shop_copies = 6 and r.total = 9, 'Saga #74 at 6: total 9';
  perform public.staff_set_shop_qty(pg_temp.item('Xeno', '1'), 2);

  -- Cutoff totals come from the same rows.
  select * into c from public.staff_order_cutoffs('lunar') x where x.foc_date = public.shop_today() + 7;
  assert c.total = 15, format('cutoff total 9 + 1 + 3 + 2 = 15, got %s', c.total);
  assert c.titles = 4 and c.all_titles = 5, 'cutoff: 4 titles to order of 5';
  assert c.customer_copies = 4 and c.shop_copies = 11, 'cutoff: 4 customer + 11 store copies';
  assert c.cost = 9 * 4 + 5 + 3 * 4 + 2 * 3, format('cutoff cost at cover price, got %s', c.cost);
  assert not exists (select 1 from public.staff_order_cutoffs('lunar') x where x.foc_date < public.shop_today()),
    'last week''s cutoff (nothing open) isn''t listed';
end;
$$;

-- Mark ordered: what was sent becomes Submitted; open lines and store copies become ordered.
do $$
declare
  v jsonb;
  r public.order_row;
begin
  v := public.staff_mark_ordered(public.shop_today() + 7, 'lunar', null, jsonb_build_array(
    jsonb_build_object('item_id', pg_temp.item('Saga', '74'), 'quantity', 9),
    jsonb_build_object('item_id', pg_temp.item('Batman', '1'), 'quantity', 1),
    jsonb_build_object('item_id', pg_temp.item('Kroma', '3'), 'quantity', 3),
    jsonb_build_object('item_id', pg_temp.item('Xeno', '1'), 'quantity', 2),
    jsonb_build_object('item_id', pg_temp.item('Spidey', '26'), 'quantity', 1)));  -- PRH: not in this order
  assert (v ->> 'titles')::int = 4 and (v ->> 'copies')::int = 15, format('4 titles, 15 copies sent: %s', v);
  assert (v ->> 'skipped')::int = 1 and (v ->> 'changed')::int = 0, format('Spidey skipped, nothing changed: %s', v);

  r := pg_temp.orow('Saga', '74');
  assert r.submitted = 9 and r.change = 0 and r.customer_open = 0 and r.customer_copies = 3, 'Saga #74 sent: 9, lines ordered';
  assert r.shop_status = 'ordered', 'Saga #74 store copies ordered';
  r := pg_temp.orow('Kroma', '3');
  assert r.shop_saved and r.shop_copies = 3 and r.shop_status = 'ordered', 'Kroma #3: last issue''s 3 written as its own ordered row';
  assert (select string_agg(x.status::text || ' ' || x.quantity, ', ' order by x.quantity) from public.reservations x
          where x.item_id = pg_temp.item('Batman', '1') and not x.reorder) = 'ordered 1, open 6',
    'Batman #1: Ann''s line ordered, the held line stays open';
  assert (select x.status from public.reservations x where x.item_id = pg_temp.item('Batman', '1') and x.reorder) = 'open',
    'Batman #1: the re-order line is left alone';
  assert (select x.status from public.reservations x where x.item_id = pg_temp.item('Saga', '74') and x.status = 'reordered') = 'reordered',
    'the reordered line is left alone';

  -- After sending: the store number can still change before the cutoff, and shows as a change.
  r := (select x from public.staff_set_shop_qty(pg_temp.item('Saga', '74'), 4) x);
  assert r.total = 7 and r.submitted = 9 and r.change = -2 and r.shop_status = 'ordered', 'Saga #74 down 2 since sent';
  -- A title sent earlier and now at 0 stays on Place Order with its change (Lunar gets a 0).
  r := (select x from public.staff_set_shop_qty(pg_temp.item('Xeno', '1'), 0) x);
  assert r.total = 0 and r.submitted = 2 and r.change = -2, 'Xeno at 0: change -2';
  assert exists (select 1 from public.staff_order_rows(public.shop_today() + 7, 'lunar', null, true) x where x.item_id = pg_temp.item('Xeno', '1')),
    'Xeno stays on Place Order';
  assert (select x.changed from public.staff_order_cutoffs('lunar') x where x.foc_date = public.shop_today() + 7) = 2, '2 titles changed';

  -- Sending again records the new numbers.
  v := public.staff_mark_ordered(public.shop_today() + 7, 'lunar', null, jsonb_build_array(
    jsonb_build_object('item_id', pg_temp.item('Saga', '74'), 'quantity', 7),
    jsonb_build_object('item_id', pg_temp.item('Xeno', '1'), 'quantity', 0)));
  assert (pg_temp.orow('Saga', '74')).change = 0 and (pg_temp.orow('Xeno', '1')).submitted = 0, 'second submission is the latest';

  -- An order placed on Lunar's own site: staff enter the number.
  r := (select x from public.staff_set_submitted(pg_temp.item('Batman', '1'), 5, null, 'Phoned in') x);
  assert r.submitted = 5 and r.change = -4, 'Batman #1: manual 5 sent, total 1';

  begin
    perform public.staff_mark_ordered(public.shop_today() + 7, 'lunar', null, jsonb_build_array(jsonb_build_object('item_id', pg_temp.item('Spidey', '26'), 'quantity', 1)));
    raise exception 'expected an error';
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'None of those titles%', sqlerrm;
  end;
  begin
    perform public.staff_mark_ordered(public.shop_today() + 7, 'all', null, '[]');
    raise exception 'expected an error';
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'Pick a distributor.', sqlerrm;
  end;
end;
$$;

-- The title's cutoff moves: it shows under the new cutoff with its Submitted number, marked moved.
reset role;
update public.items set foc_date = public.shop_today() + 14 where id = pg_temp.item('Kroma', '3');
update public.items set foc_date = public.shop_today() - 1 where id = pg_temp.item('Saga', '74', 'Cover B');
update public.shop_order_lines set status = 'received' where item_id = pg_temp.item('Saga', '74');
set local role authenticated;
do $$
declare
  r public.order_row;
begin
  select * into r from public.staff_order_rows(public.shop_today() + 14, 'lunar') x where x.item_id = pg_temp.item('Kroma', '3');
  assert r.submitted = 3 and r.foc_moved and r.submitted_foc = public.shop_today() + 7 and r.change = 0, 'Kroma #3 moved with its 3';
  assert not exists (select 1 from public.staff_order_rows(public.shop_today() + 7, 'lunar') x where x.item_id = pg_temp.item('Kroma', '3')),
    'and is gone from the old cutoff';

  begin
    perform public.staff_set_shop_qty(pg_temp.item('Saga', '74', 'Cover B'), 1);
    raise exception 'expected an error';
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'The order cutoff for Saga #74 (Cover B) has passed.', sqlerrm;
  end;
  begin
    perform public.staff_set_shop_qty(pg_temp.item('Saga', '74'), 1);
    raise exception 'expected an error';
  exception when sqlstate 'P0001' then
    assert sqlerrm like '%already received.', sqlerrm;
  end;
  begin
    perform public.staff_set_shop_qty(pg_temp.item('Batman', '1'), 1000);
    raise exception 'expected an error';
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'Store copies must be between 0 and 999.', sqlerrm;
  end;
end;
$$;

-- A shop with two locations must pick one to write.
reset role;
insert into public.locations (name) values ('Second Store');
set local role authenticated;
do $$
begin
  perform public.staff_set_shop_qty(pg_temp.item('Batman', '1'), 1);
  raise exception 'expected an error';
exception when sqlstate 'P0001' then
  assert sqlerrm = 'Pick a location first.', sqlerrm;
end;
$$;
do $$
declare
  v_loc bigint := (select id from public.locations where name = 'Second Store');
  r public.order_row;
begin
  r := (select x from public.staff_set_shop_qty(pg_temp.item('Batman', '1'), 2, v_loc) x);
  assert r.shop_copies = 2 and r.customer_copies = 0 and r.submitted is null, 'the second store has its own numbers';
  r := pg_temp.orow('Batman', '1');
  assert r.shop_copies = 2 and r.customer_copies = 1, 'all locations: added up';
end;
$$;

-- ---- Not staff: nothing ----------------------------------------------------------------------------------------------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
do $$
begin
  perform public.staff_order_rows(public.shop_today() + 7, 'lunar');
  raise exception 'expected an error';
exception when sqlstate '42501' then null;
end;
$$;
do $$
begin
  perform public.staff_set_shop_qty(pg_temp.item('Batman', '1'), 1);
  raise exception 'expected an error';
exception when sqlstate '42501' then null;
end;
$$;
do $$
begin
  assert (select count(*) from public.shop_order_lines) = 0, 'customers can''t read store copies';
  assert (select count(*) from public.order_submissions) = 0, 'customers can''t read submissions';
  begin
    insert into public.shop_order_lines (item_id, quantity) values (pg_temp.item('Batman', '1'), 1);
    raise exception 'expected an error';
  exception when insufficient_privilege then null;
  end;
end;
$$;

rollback;
