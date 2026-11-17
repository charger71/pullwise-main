-- Shop ordering, part 2 (20270404000000_shop_order_helps.sql): the series' standing store copies ("every issue"),
-- last issue's total, and going back to the default. Run with tools/test-db.sh. One transaction, rolled back.
-- A failed check raises an exception.
\set ON_ERROR_STOP on
set client_min_messages = warning;
begin;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'owner@example.com');
insert into public.staff (user_id, name, is_owner) values ('00000000-0000-0000-0000-0000000000a1', 'Olive Owner', true);
update public.trust_settings set verification_enabled = false;
grant select on public.items, public.reservations, public.reservation_orders, public.locations to authenticated;

-- Saga #73 last week (4 store copies, 2 for a customer), #74 and its Cover B this week; Kroma #3 with no last issue;
-- a title with no series.
insert into public.items (title, issue_number, variant, publisher, status, price, foc_date, distributor, sku, series_key) values
  ('Saga',  '73', null,      'Image', 'available', 4.00, public.shop_today() - 7, 'lunar', 'L073',  'saga'),
  ('Saga',  '74', null,      'Image', 'pre_order', 4.00, public.shop_today() + 7, 'lunar', 'L074',  'saga'),
  ('Saga',  '74', 'Cover B', 'Image', 'pre_order', 5.00, public.shop_today() + 7, 'lunar', 'L074B', 'saga'),
  ('Kroma', '3',  null,      'Image', 'pre_order', 4.00, public.shop_today() + 7, 'lunar', 'L003',  'kroma'),
  ('***',   '1',  null,      'Image', 'pre_order', 4.00, public.shop_today() + 7, 'lunar', 'L100',  null),  -- no letters: no series key
  ('Old',   '9',  null,      'Image', 'available', 4.00, public.shop_today() - 7, 'lunar', 'L009',  'old');

create or replace function pg_temp.item(p_title text, p_issue text, p_variant text default null) returns bigint language sql as $$
  select id from public.items where title = p_title and issue_number = p_issue and variant is not distinct from p_variant $$;
create or replace function pg_temp.orow(p_title text, p_issue text, p_variant text default null) returns public.order_row language sql as $$
  select * from public.staff_order_rows(public.shop_today() + 7, 'lunar') r where r.item_id = pg_temp.item(p_title, p_issue, p_variant) $$;

insert into public.shop_order_lines (item_id, quantity, status) values (pg_temp.item('Saga', '73'), 4, 'received');
do $$
declare v_order bigint;
begin
  insert into public.reservation_orders (name, phone, email) values ('Ann', '555-0001', 'ann@example.com') returning id into v_order;
  insert into public.reservations (order_id, item_id, quantity, status) values (v_order, pg_temp.item('Saga', '73'), 2, 'picked_up');
  insert into public.reservation_orders (name, phone, email, kind) values ('Bo', '555-0002', 'bo@example.com', 'reorder') returning id into v_order;
  insert into public.reservations (order_id, item_id, quantity, reorder) values (v_order, pg_temp.item('Saga', '73'), 5, true);
end;
$$;

-- ---- Signed in as staff -------------------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';

do $$
declare
  r public.order_row;
  n int;
begin
  -- Last issue's total: its store copies and its customer copies (a re-order line doesn't count).
  r := pg_temp.orow('Saga', '74');
  assert r.last_issue_shop = 4 and r.last_issue_total = 6, format('Saga #74: last issue 4 store, 6 in all (got %s, %s)', r.last_issue_shop, r.last_issue_total);
  assert r.shop_copies = 4 and not r.shop_saved and r.series_qty is null, 'Saga #74 starts at last issue''s 4';
  r := pg_temp.orow('Kroma', '3');
  assert r.last_issue_total is null and r.last_issue_shop is null, 'Kroma #3: no last issue';

  -- Every issue: the standing number beats last issue's, for the same variant label only.
  r := (select x from public.staff_set_series_qty(pg_temp.item('Saga', '74'), 7) x);
  assert r.series_qty = 7 and r.shop_copies = 7 and r.total = 7 and not r.shop_saved, format('Saga #74 at the series'' 7 (got %s)', r.shop_copies);
  r := pg_temp.orow('Saga', '74', 'Cover B');
  assert r.series_qty is null and r.shop_copies = 0, 'Cover B keeps its own default (no earlier Cover B)';
  r := (select x from public.staff_set_series_qty(pg_temp.item('Saga', '74', 'Cover B'), 1) x);
  assert r.series_qty = 1 and r.shop_copies = 1, 'Cover B has its own every-issue number';
  assert (select quantity from public.series_shop_qty where series_key = 'saga' and variant = '') = 7, 'kept per variant label';

  -- A number of its own still wins; clearing it goes back to the series' number.
  r := (select x from public.staff_set_shop_qty(pg_temp.item('Saga', '74'), 2) x);
  assert r.shop_copies = 2 and r.shop_saved and r.series_qty = 7, 'its own 2 wins over the series'' 7';
  r := (select x from public.staff_clear_shop_qty(pg_temp.item('Saga', '74')) x);
  assert r.shop_copies = 7 and not r.shop_saved, 'cleared: back to the series'' 7';
  r := (select x from public.staff_set_shop_qty(pg_temp.item('Saga', '74'), 0) x);
  assert r.shop_copies = 0 and r.shop_saved, '0 of its own still overrides the series';
  perform public.staff_clear_shop_qty(pg_temp.item('Saga', '74'));

  -- Stopping the standing number goes back to last issue's.
  r := (select x from public.staff_set_series_qty(pg_temp.item('Saga', '74'), null) x);
  assert r.series_qty is null and r.shop_copies = 4, 'stopped: back to last issue''s 4';
  perform public.staff_set_series_qty(pg_temp.item('Saga', '74'), 7);

  -- Cutoff totals use it too.
  assert (select x.shop_copies from public.staff_order_cutoffs('lunar') x where x.foc_date = public.shop_today() + 7) = 8,
    'cutoff store copies: 7 + Cover B''s 1';

  -- Mark ordered writes the standing number as the title's own row; then clearing is refused.
  perform public.staff_mark_ordered(public.shop_today() + 7, 'lunar', null, jsonb_build_array(jsonb_build_object('item_id', pg_temp.item('Saga', '74'), 'quantity', 7)));
  assert (select quantity from public.shop_order_lines where item_id = pg_temp.item('Saga', '74') and status = 'ordered') = 7, 'ordered row of 7';
  begin
    perform public.staff_clear_shop_qty(pg_temp.item('Saga', '74'));
    assert false, 'clearing an ordered row should be refused';
  exception when raise_exception then
    assert sqlerrm like '%already ordered%', sqlerrm;
  end;

  -- Refused: no series, out of range, a passed cutoff.
  begin
    perform public.staff_set_series_qty(pg_temp.item('***', '1'), 2);
    assert false, 'a title with no series should be refused';
  exception when raise_exception then
    assert sqlerrm like '%isn''t part of a series%', sqlerrm;
  end;
  begin
    perform public.staff_set_series_qty(pg_temp.item('Kroma', '3'), 1000);
    assert false, '1000 should be refused';
  exception when raise_exception then
    assert sqlerrm like '%between 0 and 999%', sqlerrm;
  end;
  begin
    perform public.staff_clear_shop_qty(pg_temp.item('Old', '9'));
    assert false, 'a passed cutoff should be refused';
  exception when raise_exception then
    assert sqlerrm like '%has passed%', sqlerrm;
  end;

  -- Staff can read the standing numbers; nobody writes the table directly.
  select count(*) into n from public.series_shop_qty;
  assert n = 2, format('2 standing numbers, got %s', n);
  begin
    insert into public.series_shop_qty (series_key, quantity) values ('kroma', 1);
    assert false, 'a direct insert should be refused';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- ---- Not staff -----------------------------------------------------------------------------------------------------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000ff';
do $$
begin
  begin
    perform public.staff_set_series_qty((select id from public.items where title = 'Kroma'), 1);
    assert false, 'non-staff should be refused';
  exception when insufficient_privilege then null;
  end;
  assert (select count(*) from public.series_shop_qty) = 0, 'non-staff read nothing';
end;
$$;

rollback;
