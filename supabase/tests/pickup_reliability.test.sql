-- Pickup reliability, phase 1 (20270316000000_pickup_reliability.sql): standing rows, pickup dates, unclaimed totals,
-- ladder dates with the launch floor, the settings log, and who can read or change what. Run with tools/test-db.sh.
-- Everything happens in one transaction that is rolled back. A failed check raises an exception.
\set ON_ERROR_STOP on
set client_min_messages = warning;
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@example.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'clerk@example.com'),
  ('00000000-0000-0000-0000-0000000000c1', 'dana@example.com');
insert into public.staff (user_id, name, is_owner) values
  ('00000000-0000-0000-0000-0000000000a1', 'Olive Owner', true),
  ('00000000-0000-0000-0000-0000000000a2', 'Cal Clerk', false);

insert into public.items (title, issue_number, publisher, status, price) values
  ('SPAWN', '401', 'Image', 'available', 3.99),
  ('SAGA',  '71',  'Image', 'available', 4.50),
  ('BONE',  '1',   'Image', 'available', null);

insert into public.customers (first_name, last_name, email, phone, user_id) values
  ('Dana', 'Reader', 'dana@example.com', '(555) 300-1000', '00000000-0000-0000-0000-0000000000c1');
insert into public.customers (first_name, last_name, email, phone, ship_arrivals) values
  ('Sam', 'Shipper', 'sam@example.com', '(555) 300-2000', true);

do $$
declare
  c     public.customers;
  o     bigint;
  l1 bigint; l2 bigint; l3 bigint;
  st    public.customer_standing;
  u     record;
  d     record;
  t0    timestamptz;
  today date := public.shop_today();
begin
  -- Every customer gets a standing row: proven, and exempt from the ladder when their books are shipped.
  select * into st from public.customer_standing where customer_id = (select id from public.customers where email = 'dana@example.com');
  assert st.account_state = 'proven' and st.pickup_cadence = 'weekly' and st.paused_at is null, format('dana standing: %s', st);
  assert (select pickup_cadence from public.customer_standing where customer_id = (select id from public.customers where email = 'sam@example.com')) = 'exempt',
    'a customer whose arrivals are shipped starts exempt';

  select * into c from public.customers where email = 'dana@example.com';
  o := public._pull_list_order(c);
  insert into public.reservations (order_id, item_id, quantity, status, arrived_on) select o, id, 2, 'arrived', today - 20 from public.items where title = 'SPAWN' returning id into l1;
  insert into public.reservations (order_id, item_id, quantity, status, arrived_on) select o, id, 1, 'arrived', today - 9  from public.items where title = 'SAGA'  returning id into l2;
  insert into public.reservations (order_id, item_id, quantity, status, arrived_on) select o, id, 1, 'arrived', today - 3  from public.items where title = 'BONE'  returning id into l3;

  -- Unclaimed: every received line not picked up; value in cents at the shop's price (no price counts as 0).
  select * into u from public.customer_unclaimed where customer_id = c.id;
  assert u.unclaimed_count = 3 and u.unclaimed_copies = 4, format('counts: %s', u);
  assert u.unclaimed_cents = 2 * 399 + 450, format('value: %s', u);
  assert u.oldest_received_on = today - 20, format('oldest: %s', u);

  -- Picking up stamps the pickup time; the clock moves to the next-oldest line (a partial pickup).
  t0 := clock_timestamp();
  update public.reservations set status = 'picked_up' where id = l1;
  assert (select picked_up_at from public.reservations where id = l1) is not null, 'pickup stamped';
  select * into u from public.customer_unclaimed where customer_id = c.id;
  assert u.unclaimed_count = 2 and u.oldest_received_on = today - 9 and u.unclaimed_cents = 450, format('after partial pickup: %s', u);
  -- Another change to a picked-up line keeps its pickup date; moving it back off picked up clears it.
  update public.reservations set quantity = 3 where id = l1;
  assert (select picked_up_at from public.reservations where id = l1) is not null, 'pickup date kept on an unrelated change';
  update public.reservations set status = 'arrived' where id = l1;
  assert (select picked_up_at from public.reservations where id = l1) is null, 'pickup date cleared when the line is no longer picked up';
  update public.reservations set status = 'picked_up' where id = l1;

  -- Ladder dates: weekly 7/14, monthly 21/35, exempt none. The launch floor is today (set by the migration), so a
  -- line received 9 days ago starts its clock today.
  update public.trust_settings set reliability_started_at = today - 100;
  select * into d from public.pickup_ladder_dates(today - 9, 'weekly');
  assert d.clock_start = today - 9 and d.warning_on = today - 2 and d.pause_on = today + 5, format('weekly: %s', d);
  select * into d from public.pickup_ladder_dates(today - 9, 'monthly');
  assert d.warning_on = today + 12 and d.pause_on = today + 26, format('monthly: %s', d);
  select * into d from public.pickup_ladder_dates(today - 9, 'exempt');
  assert d.clock_start is null and d.warning_on is null and d.pause_on is null, format('exempt: %s', d);
  -- Launch floor: lines received before it count from the floor.
  update public.trust_settings set reliability_started_at = today - 4;
  select * into d from public.pickup_ladder_dates(today - 9, 'weekly');
  assert d.clock_start = today - 4 and d.warning_on = today + 3 and d.pause_on = today + 10, format('floored weekly: %s', d);
  select * into d from public.pickup_ladder_dates(today - 1, 'weekly');
  assert d.clock_start = today - 1, format('a line after the floor keeps its own date: %s', d);
  -- Day counts are read live.
  update public.trust_settings set warning_days = 5, pause_days = 10;
  select * into d from public.pickup_ladder_dates(today - 4, 'weekly');
  assert d.warning_on = today + 1 and d.pause_on = today + 6, format('live day counts: %s', d);
  update public.trust_settings set warning_days = 7, pause_days = 14;
end;
$$;

-- The warning day must come before the pause day.
do $$
begin
  begin
    update public.trust_settings set warning_days = 14, pause_days = 14;
    raise exception 'warning = pause should be refused';
  exception when check_violation then null;
  end;
end;
$$;

-- ---- As staff ---------------------------------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';

-- An owner switches the ladder off and on again: both are logged with who, and turning it on starts the clocks today.
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
do $$
declare
  n int;
begin
  update public.trust_settings set reliability_started_at = public.shop_today() - 30;
  update public.trust_settings set pickup_pause_enabled = false;
  assert (select reliability_started_at from public.trust_settings) = public.shop_today() - 30, 'turning off leaves the floor';
  update public.trust_settings set pickup_pause_enabled = true;
  assert (select reliability_started_at from public.trust_settings) = public.shop_today(), 'turning on moves the floor to today';
  update public.trust_settings set verification_enabled = false, unproven_weekly_cap_cents = 2500;
  select count(*) into n from public.trust_settings_log
  where setting = 'pickup_pause_enabled' and staff_name = 'Olive Owner' and user_id = '00000000-0000-0000-0000-0000000000a1';
  assert n = 2, format('both pause switch changes logged with who: %s', n);
  assert exists (select 1 from public.trust_settings_log where setting = 'pickup_pause_enabled' and from_value = 'false' and to_value = 'true'), 'from / to logged';
  assert exists (select 1 from public.trust_settings_log where setting = 'verification_enabled' and from_value = 'true' and to_value = 'false' and staff_name = 'Olive Owner'), 'verification switch logged';
  assert exists (select 1 from public.trust_settings_log where setting = 'unproven_weekly_cap_cents' and from_value = '4000' and to_value = '2500'), 'cap change logged';
  assert (select updated_by from public.trust_settings) = '00000000-0000-0000-0000-0000000000a1', 'updated_by stamped';
end;
$$;

-- Other staff read the settings, the report and the indicator, but can't change the settings.
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
do $$
declare
  n int;
  r record;
begin
  assert (select count(*) from public.trust_settings) = 1, 'staff read the settings';
  update public.trust_settings set pickup_pause_enabled = false;
  get diagnostics n = row_count;
  assert n = 0, 'a staff member who is not an owner changes nothing';
  assert (select pickup_pause_enabled from public.trust_settings), 'still on';

  -- The report: customers with something unclaimed, true ages, contact details and the last pickup.
  select count(*) into n from public.staff_pickup_summary(null);
  assert n = 1, format('only Dana has unclaimed books: %s', n);
  select * into r from public.staff_pickup_summary(null);
  assert r.first_name = 'Dana' and r.email = 'dana@example.com' and r.phone is not null, format('contact: %s', r);
  assert r.unclaimed_count = 2 and r.unclaimed_cents = 450 and r.oldest_age_days = 9, format('report: %s', r);
  assert r.last_pickup_at is not null and r.account_state = 'proven' and r.paused_at is null, format('report state: %s', r);
  -- The floor was moved to today when the switch went back on: the ladder starts today, the age stays true.
  assert r.warning_on = public.shop_today() + 7 and r.pause_on = public.shop_today() + 14, format('ladder from the floor: %s', r);

  -- The indicator: any customer by id, unclaimed or not.
  select * into r from public.staff_pickup_summary(array[(select id from public.customers where email = 'sam@example.com')]);
  assert r.unclaimed_count = 0 and r.unclaimed_cents = 0 and r.oldest_received_on is null and r.pickup_cadence = 'exempt', format('indicator: %s', r);

  assert (select count(*) from public.customer_standing) = 2, 'staff read standing';
  begin
    update public.customer_standing set paused_at = now(), paused_reason = 'manual';
    raise exception 'staff must not write standing directly';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- ---- As the customer --------------------------------------------------------------------------------------------------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
do $$
begin
  assert (select count(*) from public.customer_standing) = 0, 'a customer sees no standing, not even their own';
  assert (select count(*) from public.customer_standing_log) = 0, 'or its log';
  assert (select count(*) from public.trust_settings) = 0, 'or the settings';
  assert (select count(*) from public.trust_settings_log) = 0, 'or the settings log';
  begin
    perform public.staff_pickup_summary(null);
    raise exception 'a customer must not read the report';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.customer_unclaimed;
    raise exception 'a customer must not read customer_unclaimed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.customer_standing set account_state = 'proven';
    raise exception 'a customer must not write standing';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;

-- Standing changes are logged with from, to and reason (later phases change standing through functions).
do $$
declare
  v_id bigint := (select id from public.customers where email = 'dana@example.com');
begin
  perform set_config('pullwise.standing_reason', 'test', true);
  update public.customer_standing set paused_at = now(), paused_reason = 'manual', pickup_cadence = 'monthly' where customer_id = v_id;
  assert exists (select 1 from public.customer_standing_log where customer_id = v_id and field = 'paused' and from_value = 'active' and to_value = 'paused (manual)' and reason = 'test'), 'pause logged';
  assert exists (select 1 from public.customer_standing_log where customer_id = v_id and field = 'pickup_cadence' and from_value = 'weekly' and to_value = 'monthly'), 'cadence logged';
  update public.customer_standing set account_state = 'unapproved', unapproved_reason = 'staff' where customer_id = v_id;
  assert exists (select 1 from public.customer_standing_log where customer_id = v_id and field = 'account_state' and from_value = 'proven' and to_value = 'unapproved (staff)'), 'state logged';
  begin
    update public.customer_standing set account_state = 'unapproved', unapproved_reason = null where customer_id = v_id;
    raise exception 'unapproved needs a reason';
  exception when check_violation then null;
  end;
end;
$$;

rollback;
