-- Pickup reliability, phase 4 (20270319000000_pickup_ladder.sql): the automatic warning and pause, once per streak,
-- weekly / monthly / exempt cadences with the launch floor, the switch, and auto-resume. Run with tools/test-db.sh.
-- One transaction, rolled back. A failed check raises an exception.
\set ON_ERROR_STOP on
set client_min_messages = warning;
begin;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'owner@example.com');
insert into public.staff (user_id, name, is_owner) values ('00000000-0000-0000-0000-0000000000a1', 'Olive Owner', true);
insert into public.items (title, issue_number, publisher, status, price) values
  ('A', '1', 'Image', 'available', 4.00), ('B', '1', 'Image', 'available', 5.00);

-- Customers (all existing accounts, so proven): received dates set per test below.
insert into public.customers (first_name, last_name, email, phone) values
  ('Wes',  'Weekly',  'wes@example.com',  '(555) 500-0001'),   -- weekly, 9 days: warning
  ('Pia',  'Pause',   'pia@example.com',  '(555) 500-0002'),   -- weekly, 15 days: pause
  ('Mo',   'Monthly', 'mo@example.com',   '(555) 500-0003'),   -- monthly, 15 days: nothing yet
  ('Ex',   'Empt',    'ex@example.com',   '(555) 500-0004'),   -- exempt, 60 days: never
  ('Hal',  'Handpaused', 'hal@example.com', '(555) 500-0005'), -- weekly, 20 days, paused by staff: left alone
  ('Nell', 'Noemail', null, '(555) 500-0006');                 -- weekly, 9 days, no email: skipped
update public.customer_standing st set pickup_cadence = 'monthly' from public.customers c where c.id = st.customer_id and c.email = 'mo@example.com';
update public.customer_standing st set pickup_cadence = 'exempt'  from public.customers c where c.id = st.customer_id and c.email = 'ex@example.com';
update public.customer_standing st set paused_at = now(), paused_reason = 'manual' from public.customers c where c.id = st.customer_id and c.email = 'hal@example.com';

create or replace function pg_temp.arrive(p_email text, p_title text, p_days int) returns bigint language plpgsql as $$
declare
  c public.customers;
  v bigint;
begin
  if p_email is null then select * into c from public.customers where first_name = 'Nell';
  else select * into c from public.customers where email = p_email; end if;
  insert into public.reservations (order_id, item_id, quantity, status, arrived_on)
  select public._pull_list_order(c), id, 1, 'arrived', public.shop_today() - p_days from public.items where title = p_title
  returning id into v;
  return v;
end;
$$;
create or replace function pg_temp.cid(p_email text) returns bigint language sql as $$
  select id from public.customers where email = p_email or (p_email is null and first_name = 'Nell');
$$;
create or replace function pg_temp.st(p_email text) returns public.customer_standing language sql as $$
  select * from public.customer_standing where customer_id = pg_temp.cid(p_email);
$$;
create or replace function pg_temp.notices(p_email text) returns text language sql as $$
  select coalesce(string_agg(stage || ':' || status, ',' order by id), '') from public.pickup_notices where customer_id = pg_temp.cid(p_email);
$$;

do $$
begin
  perform pg_temp.arrive('wes@example.com', 'A', 9);
  perform pg_temp.arrive('pia@example.com', 'A', 15);
  perform pg_temp.arrive('pia@example.com', 'B', 3);
  perform pg_temp.arrive('mo@example.com',  'A', 15);
  perform pg_temp.arrive('ex@example.com',  'A', 60);
  perform pg_temp.arrive('hal@example.com', 'A', 20);
  perform pg_temp.arrive(null, 'A', 9);
end;
$$;

-- ---- Launch floor: everything arrived before the floor (today) counts from today, so nobody is laddered --------------
do $$
begin
  assert (select reliability_started_at from public.trust_settings) = public.shop_today(), 'the migration set the floor to today';
  assert public.pickup_ladder_run() = 0, 'old history warns and pauses nobody';
  assert (select count(*) from public.pickup_notices) = 0, 'no notices';
  -- Reports still show the true age.
  assert (select (public.shop_today() - oldest_received_on) from public.customer_unclaimed where customer_id = pg_temp.cid('pia@example.com')) = 15, 'true age kept';
end;
$$;

-- ---- Move the floor back: the ladder runs on true dates -------------------------------------------------------------
update public.trust_settings set reliability_started_at = public.shop_today() - 365;
do $$
declare
  n int;
  w public.pickup_notices;
begin
  n := public.pickup_ladder_run();
  assert n = 3, format('Wes warned, Pia paused, Nell warned (skipped): %s', n);

  -- Weekly, 9 days: a warning with the pause date (14 days from the received date).
  assert pg_temp.notices('wes@example.com') = 'warning:queued', pg_temp.notices('wes@example.com');
  select * into w from public.pickup_notices where customer_id = pg_temp.cid('wes@example.com');
  assert w.pause_on = public.shop_today() + 5 and w.unclaimed_count = 1 and w.unclaimed_cents = 400, format('warning: %s', w);
  assert (pg_temp.st('wes@example.com')).warning_sent_at is not null and (pg_temp.st('wes@example.com')).paused_at is null, 'warned, not paused';

  -- Weekly, 15 days (oldest line): paused automatically, with the pause email.
  assert pg_temp.notices('pia@example.com') = 'pause:queued', pg_temp.notices('pia@example.com');
  assert (pg_temp.st('pia@example.com')).paused_reason = 'auto', 'paused automatically';
  assert exists (select 1 from public.customer_standing_log where customer_id = pg_temp.cid('pia@example.com') and field = 'paused'
                 and to_value = 'paused (auto)' and reason like 'Books waiting since%' and staff_name is null), 'auto pause logged as automatic';
  assert (select unclaimed_cents from public.pickup_notices where customer_id = pg_temp.cid('pia@example.com')) = 900, 'the total covers every waiting book';

  -- Monthly, 15 days: nothing until day 21.
  assert pg_temp.notices('mo@example.com') = '', 'monthly not yet';
  -- Exempt: never.
  assert pg_temp.notices('ex@example.com') = '', 'exempt never';
  -- Paused by staff: left alone.
  assert pg_temp.notices('hal@example.com') = '' and (pg_temp.st('hal@example.com')).paused_reason = 'manual', 'staff pause left alone';
  -- No email: the stage is recorded, the email skipped.
  assert pg_temp.notices(null) = 'warning:skipped', pg_temp.notices(null);

  -- Once per streak: running again changes nothing.
  assert public.pickup_ladder_run() = 0, 'nothing new on a second run';
  assert (select count(*) from public.pickup_notices) = 3, 'no duplicates';
end;
$$;

-- ---- Monthly cadence: day 21 warns, day 35 pauses ---------------------------------------------------------------------
do $$
begin
  update public.reservations set arrived_on = public.shop_today() - 21 where order_id in (select id from public.reservation_orders where customer_id = pg_temp.cid('mo@example.com'));
  perform public.pickup_ladder_run();
  assert pg_temp.notices('mo@example.com') = 'warning:queued', format('monthly day 21: %s', pg_temp.notices('mo@example.com'));
  assert (select pause_on from public.pickup_notices where customer_id = pg_temp.cid('mo@example.com')) = public.shop_today() + 14, 'monthly pause date (day 35)';
  update public.reservations set arrived_on = public.shop_today() - 35 where order_id in (select id from public.reservation_orders where customer_id = pg_temp.cid('mo@example.com'));
  perform public.pickup_ladder_run();
  assert pg_temp.notices('mo@example.com') = 'warning:queued,pause:queued', format('monthly day 35: %s', pg_temp.notices('mo@example.com'));
  assert (pg_temp.st('mo@example.com')).paused_reason = 'auto', 'monthly paused';
end;
$$;

-- ---- Pickups ------------------------------------------------------------------------------------------------------------
do $$
begin
  -- A partial pickup doesn't resume: Pia still has B waiting.
  update public.reservations set status = 'picked_up'
  where order_id in (select id from public.reservation_orders where customer_id = pg_temp.cid('pia@example.com'))
    and item_id = (select id from public.items where title = 'A');
  assert (pg_temp.st('pia@example.com')).paused_reason = 'auto', 'still paused after a partial pickup';
  -- Picking up the rest resumes her and ends the streak.
  update public.reservations set status = 'picked_up'
  where order_id in (select id from public.reservation_orders where customer_id = pg_temp.cid('pia@example.com'));
  assert (pg_temp.st('pia@example.com')).paused_at is null, 'auto-resumed when everything is picked up';
  assert (pg_temp.st('pia@example.com')).pause_sent_at is null and (pg_temp.st('pia@example.com')).warning_sent_at is null, 'streak reset';
  assert exists (select 1 from public.customer_standing_log where customer_id = pg_temp.cid('pia@example.com') and field = 'paused'
                 and to_value = 'active' and reason = 'Everything waiting was picked up'), 'resume logged';

  -- Wes picks up before his warning goes out: the queued warning is dropped.
  update public.reservations set status = 'picked_up' where order_id in (select id from public.reservation_orders where customer_id = pg_temp.cid('wes@example.com'));
  assert pg_temp.notices('wes@example.com') = 'warning:skipped', pg_temp.notices('wes@example.com');

  -- A staff pause isn't lifted by a pickup.
  update public.reservations set status = 'picked_up' where order_id in (select id from public.reservation_orders where customer_id = pg_temp.cid('hal@example.com'));
  assert (pg_temp.st('hal@example.com')).paused_reason = 'manual', 'manual pause stays after pickup';

  -- With auto-resume off, an automatic pause stays after a pickup.
  update public.trust_settings set auto_resume_on_pickup = false;
  update public.reservations set status = 'picked_up' where order_id in (select id from public.reservation_orders where customer_id = pg_temp.cid('mo@example.com'));
  assert (pg_temp.st('mo@example.com')).paused_reason = 'auto', 'no auto-resume when it is off';
  assert (pg_temp.st('mo@example.com')).pause_sent_at is null, 'but the streak still ends';
  update public.trust_settings set auto_resume_on_pickup = true;
end;
$$;

-- ---- The switch -----------------------------------------------------------------------------------------------------------
-- Off: a customer past the pause day gets no email and isn't paused, even when the job runs.
do $$
declare
  v_late bigint;
begin
  v_late := pg_temp.arrive('wes@example.com', 'B', 30);  -- Wes again, 30 days
  update public.trust_settings set pickup_pause_enabled = false;
  -- Switching off lifted Mo's automatic pause, but not Hal's staff pause.
  assert (pg_temp.st('mo@example.com')).paused_at is null, 'switching off resumes an auto-paused customer';
  assert (pg_temp.st('hal@example.com')).paused_reason = 'manual', 'but not one paused by hand';
  assert exists (select 1 from public.customer_standing_log where customer_id = pg_temp.cid('mo@example.com') and reason = 'Pause pulls for unclaimed books turned off'), 'logged';
  perform public.pickup_ladder_tick();
  assert public.pickup_ladder_run() = 0, 'the ladder does nothing while off';
  assert pg_temp.notices('wes@example.com') = 'warning:skipped', format('no new email while off: %s', pg_temp.notices('wes@example.com'));
  assert (pg_temp.st('wes@example.com')).paused_at is null, 'not paused while off';
  -- The report and lookup still work while off.
  assert (select unclaimed_count from public.customer_unclaimed where customer_id = pg_temp.cid('wes@example.com')) = 1, 'unclaimed still tracked';

  -- On again: clocks start fresh from today, so Wes's 30-day-old book doesn't pause him straight away.
  update public.trust_settings set pickup_pause_enabled = true;
  assert (select reliability_started_at from public.trust_settings) = public.shop_today(), 'floor moved to today';
  assert public.pickup_ladder_run() = 0, 'nobody laddered right after turning on';
end;
$$;

-- ---- Customers can't read any of it ---------------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000ff';
do $$
begin
  assert (select count(*) from public.pickup_notices) = 0, 'a customer sees no notices';
  begin
    perform public.pickup_ladder_run();
    raise exception 'a customer must not run the ladder';
  exception when insufficient_privilege then null;
  end;
end;
$$;

rollback;
