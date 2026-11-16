-- Pickup reliability, phase 5 (20270320000000_pickup_cadence.sql): staff set a customer's pickup cadence; the change
-- is logged and takes effect on the ladder. Run with tools/test-db.sh. One transaction, rolled back.
\set ON_ERROR_STOP on
set client_min_messages = warning;
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@example.com'),
  ('00000000-0000-0000-0000-0000000000c1', 'cam@example.com');
insert into public.staff (user_id, name, is_owner) values ('00000000-0000-0000-0000-0000000000a1', 'Olive Owner', true);
insert into public.items (title, issue_number, publisher, status, price) values ('A', '1', 'Image', 'available', 4.00);
insert into public.customers (first_name, last_name, email, phone, user_id) values
  ('Cam', 'Cadence', 'cam@example.com', '(555) 700-0001', '00000000-0000-0000-0000-0000000000c1'),
  ('Dot', 'Done',    'dot@example.com', '(555) 700-0002', null);
update public.customer_standing set account_state = 'proven', unapproved_reason = null;
update public.trust_settings set reliability_started_at = public.shop_today() - 365;

create or replace function pg_temp.cid(p_email text) returns bigint language sql as $$ select id from public.customers where email = p_email $$;
create or replace function pg_temp.st(p_email text) returns public.customer_standing language sql as $$
  select * from public.customer_standing where customer_id = pg_temp.cid(p_email) $$;

-- Cam's book has waited 20 days: weekly, the ladder pauses him (past day 14).
do $$
declare
  c public.customers;
begin
  select * into c from public.customers where email = 'cam@example.com';
  insert into public.reservations (order_id, item_id, quantity, status, arrived_on)
  select public._pull_list_order(c), id, 1, 'arrived', public.shop_today() - 20 from public.items where title = 'A';
  perform public.pickup_ladder_run();
  assert (pg_temp.st('cam@example.com')).paused_reason = 'auto', 'weekly: paused at day 20';
end;
$$;

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
do $$
declare
  v public.customer_standing;
begin
  -- Monthly: day 20 is before the monthly pause day (35), so the automatic pause lifts.
  v := public.staff_set_cadence(pg_temp.cid('cam@example.com'), 'monthly', 'Comes in once a month');
  assert v.pickup_cadence = 'monthly' and v.paused_at is null and v.pause_sent_at is null, format('monthly: %s', v);
  assert v.warning_sent_at is not null, 'the reminder already sent is remembered (not sent again)';
  assert exists (select 1 from public.customer_standing_log where customer_id = pg_temp.cid('cam@example.com') and field = 'pickup_cadence'
                 and from_value = 'weekly' and to_value = 'monthly' and reason = 'Comes in once a month' and staff_name = 'Olive Owner'), 'cadence change logged';
  assert exists (select 1 from public.customer_standing_log where customer_id = pg_temp.cid('cam@example.com') and field = 'paused'
                 and to_value = 'active' and reason like '%Pickup cadence changed to monthly'), 'the resume is logged with why';

  -- Back to weekly: the new pause day has passed, so the next run pauses him again.
  v := public.staff_set_cadence(pg_temp.cid('cam@example.com'), 'weekly');
  assert v.paused_at is null, 'a cadence change never pauses by itself';
end;
$$;
reset role;
do $$
begin
  perform public.pickup_ladder_run();
  assert (pg_temp.st('cam@example.com')).paused_reason = 'auto', 'the ladder pauses again on the weekly days';
  -- Day 20 went straight to the pause (no reminder then), and the remembered reminder stage means none is sent now.
  assert (select count(*) from public.pickup_notices where customer_id = pg_temp.cid('cam@example.com') and stage = 'warning') = 0, 'no reminder after a resume';
  assert (select count(*) from public.pickup_notices where customer_id = pg_temp.cid('cam@example.com') and stage = 'pause') = 2, 'a second pause email for the second pause';
end;
$$;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
do $$
declare
  v public.customer_standing;
begin
  -- Exempt: the automatic pause lifts, and the ladder leaves him alone.
  v := public.staff_set_cadence(pg_temp.cid('cam@example.com'), 'exempt');
  assert v.pickup_cadence = 'exempt' and v.paused_at is null, format('exempt: %s', v);
  -- A staff pause isn't touched by a cadence change.
  perform public.staff_pause_customer(pg_temp.cid('dot@example.com'));
  v := public.staff_set_cadence(pg_temp.cid('dot@example.com'), 'exempt');
  assert v.paused_reason = 'manual', 'manual pause kept';
  -- Bad values are refused.
  begin
    perform public.staff_set_cadence(pg_temp.cid('dot@example.com'), 'yearly');
    raise exception 'yearly must be refused';
  exception when raise_exception then
    if sqlerrm not like 'Choose weekly%' then raise; end if;
  end;
end;
$$;
reset role;
do $$
begin
  assert public.pickup_ladder_run() = 0, 'exempt: never laddered';
  assert (pg_temp.st('cam@example.com')).paused_at is null, 'still not paused';
end;
$$;

-- A customer can't set their own cadence.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
do $$
begin
  begin
    perform public.staff_set_cadence(pg_temp.cid('cam@example.com'), 'exempt');
    raise exception 'a customer must not set their cadence';
  exception when insufficient_privilege then null;
  end;
end;
$$;

rollback;
