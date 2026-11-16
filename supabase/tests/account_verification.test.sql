-- Pickup reliability, phase 3 (20270318000000_account_verification.sql): account states, the approval step, the
-- weekly cap with per-title approval, guest orders, and the verification switch. Run with tools/test-db.sh.
-- One transaction, rolled back. A failed check raises an exception.
\set ON_ERROR_STOP on
set client_min_messages = warning;
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@example.com'),
  ('00000000-0000-0000-0000-0000000000c1', 'nia@example.com'),
  ('00000000-0000-0000-0000-0000000000c2', 'otto@example.com'),
  ('00000000-0000-0000-0000-0000000000c3', 'pat@example.com'),
  ('00000000-0000-0000-0000-0000000000c4', 'quinn@example.com'),
  ('00000000-0000-0000-0000-0000000000c5', 'rae@example.com');
insert into public.staff (user_id, name, is_owner) values ('00000000-0000-0000-0000-0000000000a1', 'Olive Owner', true);
grant select on public.reservations, public.reservation_orders, public.items, public.customers, public.pull_list_log to authenticated;

-- Titles on one cutoff two weeks out (one cutoff week), one on last week's cutoff.
insert into public.items (title, issue_number, publisher, status, price, foc_date) values
  ('A', '1', 'Image', 'pre_order', 15.00, public.shop_today() + 14),
  ('B', '1', 'Image', 'pre_order', 20.00, public.shop_today() + 14),
  ('C', '1', 'Image', 'pre_order', 10.00, public.shop_today() + 14),
  ('D', '1', 'Image', 'pre_order',  4.00, public.shop_today() + 14),
  ('E', '1', 'Image', 'pre_order',  9.00, public.shop_today() + 21),  -- the next cutoff week: its own cap
  ('OLD', '1', 'Image', 'coming_soon', 50.00, public.shop_today() - 14);

-- Helper: a customer's line for a title, added now (in this order).
create or replace function pg_temp.put(p_email text, p_title text) returns bigint language plpgsql as $$
declare
  c public.customers;
  v bigint;
begin
  select * into c from public.customers where email = p_email;
  insert into public.reservations (order_id, item_id, quantity, created_at)
  select public._pull_list_order(c), id, 1, clock_timestamp() from public.items where title = p_title
  returning id into v;
  return v;
end;
$$;
create or replace function pg_temp.line(p_email text, p_title text) returns bigint language sql as $$
  select r.id from public.reservations r join public.reservation_orders o on o.id = r.order_id
  join public.customers c on c.id = o.customer_id join public.items i on i.id = r.item_id
  where c.email = p_email and i.title = p_title;
$$;
create or replace function pg_temp.flagged(p_email text) returns text language sql as $$
  select coalesce(string_agg(i.title, ',' order by i.title), '')
  from public.line_cap_flags f join public.reservations r on r.id = f.reservation_id
  join public.reservation_orders o on o.id = r.order_id join public.customers c on c.id = o.customer_id
  join public.items i on i.id = r.item_id
  where c.email = p_email and f.status = 'over_cap';
$$;
create or replace function pg_temp.counts(p_line bigint) returns boolean language sql as $$
  select public._line_counts(order_id, item_id) from public.reservations where id = p_line;
$$;
create or replace function pg_temp.state(p_email text) returns text language sql as $$
  select st.account_state::text || coalesce(' ' || st.unapproved_reason, '')
  from public.customer_standing st join public.customers c on c.id = st.customer_id where c.email = p_email;
$$;

-- ---- New accounts with verification on -------------------------------------------------------------------------------
-- A customer who signs up (the account has a login) waits for approval; one staff add (no login) is proven.
insert into public.customers (first_name, last_name, email, phone, user_id) values
  ('Nia', 'New', 'nia@example.com', '(555) 400-0001', '00000000-0000-0000-0000-0000000000c1');
insert into public.customers (first_name, last_name, email, phone) values
  ('Walt', 'Walkin', 'walt@example.com', '(555) 400-0002');

do $$
declare
  a bigint; b bigint; cc bigint; d bigint; e bigint;
begin
  assert pg_temp.state('nia@example.com') = 'unapproved signup', format('signup waits: %s', pg_temp.state('nia@example.com'));
  assert pg_temp.state('walt@example.com') = 'proven', 'a customer staff add is proven';

  a := pg_temp.put('nia@example.com', 'A');
  b := pg_temp.put('nia@example.com', 'B');
  cc := pg_temp.put('nia@example.com', 'C');
  d := pg_temp.put('nia@example.com', 'D');
  e := pg_temp.put('nia@example.com', 'E');
  -- Unapproved: nothing counts, nothing is flagged (the cap is for approved accounts).
  assert not pg_temp.counts(a) and not pg_temp.counts(d), 'an unapproved account counts toward nothing';
  assert pg_temp.flagged('nia@example.com') = '', 'no cap flags while unapproved';
end;
$$;

-- The queue lists Nia with what she asked for.
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
do $$
declare
  q record;
begin
  select * into q from public.staff_waiting_accounts() where email = 'nia@example.com';
  assert q.unapproved_reason = 'signup' and q.open_titles = 5 and q.open_cents = 5800, format('queue: %s', q);
  -- One action approves.
  perform public.staff_set_account_state(q.customer_id, 'approved');
end;
$$;
reset role;

-- ---- The cap ($40 by default), filled in the order titles were added -------------------------------------------------
do $$
begin
  assert pg_temp.state('nia@example.com') = 'approved', 'approved';
  -- A 15 + B 20 = 35; C 10 would make 45: flagged; D 4 still fits (39). E is the next week: its own $40.
  assert pg_temp.flagged('nia@example.com') = 'C', format('cap 40: %s', pg_temp.flagged('nia@example.com'));
  assert pg_temp.counts(pg_temp.line('nia@example.com', 'A')) and not pg_temp.counts(pg_temp.line('nia@example.com', 'C'))
     and pg_temp.counts(pg_temp.line('nia@example.com', 'D')) and pg_temp.counts(pg_temp.line('nia@example.com', 'E')), 'only the flagged title is left out';

  -- Changing the cap changes the flags.
  update public.trust_settings set unproven_weekly_cap_cents = 5000;
  assert pg_temp.flagged('nia@example.com') = '', format('cap 50: %s', pg_temp.flagged('nia@example.com'));
  update public.trust_settings set unproven_weekly_cap_cents = 2000;
  -- A 15; B would be 35: flagged; C would be 25: flagged; D 19 fits.
  assert pg_temp.flagged('nia@example.com') = 'B,C', format('cap 20: %s', pg_temp.flagged('nia@example.com'));
  update public.trust_settings set unproven_weekly_cap_cents = 0;
  assert pg_temp.flagged('nia@example.com') = '', 'a cap of 0 flags nothing';
  update public.trust_settings set unproven_weekly_cap_cents = null;
  assert pg_temp.flagged('nia@example.com') = '', 'no cap flags nothing';
  update public.trust_settings set unproven_weekly_cap_cents = 2000;
  assert pg_temp.flagged('nia@example.com') = 'B,C', 'flags back at 20';

  -- A title added later is flagged straight away when it doesn't fit.
  perform pg_temp.put('nia@example.com', 'OLD');  -- last week's cutoff: never re-flagged now
  assert pg_temp.flagged('nia@example.com') = 'B,C', 'an earlier week is not capped now';
end;
$$;

-- Staff approve one flagged title: it counts and uses up the cap.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
do $$
declare
  o record;
  n int;
begin
  select * into o from public.staff_over_cap_lines() where title = 'B #1';
  assert o.line_cents = 2000 and o.week_cents = 1900, format('over-cap row: %s', o);
  n := public.staff_approve_cap_lines(array[o.reservation_id]);
  assert n = 1, 'approved one';
  assert exists (select 1 from public.pull_list_log where reservation_id = o.reservation_id and action = 'approved'), 'approval noted on the pull list history';
end;
$$;
reset role;
do $$
begin
  assert pg_temp.counts(pg_temp.line('nia@example.com', 'B')), 'the approved title counts';
  -- A 15 + B 20 (approved) = 35: C (45) and D (39) are both over 20 now.
  assert pg_temp.flagged('nia@example.com') = 'C,D', format('after approving B: %s', pg_temp.flagged('nia@example.com'));
end;
$$;

-- A cap change leaves an earlier week's flags as they were.
do $$
declare
  v_old bigint := pg_temp.line('nia@example.com', 'OLD');
begin
  insert into public.line_cap_flags (reservation_id, status) values (v_old, 'over_cap');
  update public.trust_settings set unproven_weekly_cap_cents = 9000;
  assert exists (select 1 from public.line_cap_flags where reservation_id = v_old and status = 'over_cap'), 'last week''s flag kept';
  assert pg_temp.flagged('nia@example.com') = 'OLD', format('this week re-flagged at 90: %s', pg_temp.flagged('nia@example.com'));
  delete from public.line_cap_flags where reservation_id = v_old;
  update public.trust_settings set unproven_weekly_cap_cents = 2000;
end;
$$;

-- ---- First pickup proves the account ----------------------------------------------------------------------------------
do $$
begin
  update public.reservations set status = 'picked_up' where id = pg_temp.line('nia@example.com', 'OLD');
  assert pg_temp.state('nia@example.com') = 'proven', format('first pickup proves: %s', pg_temp.state('nia@example.com'));
  assert pg_temp.flagged('nia@example.com') = '', 'a proven account has no cap';
  assert exists (select 1 from public.customer_standing_log l join public.customers c on c.id = l.customer_id
                 where c.email = 'nia@example.com' and l.field = 'account_state' and l.to_value = 'proven' and l.reason = 'First pickup'), 'logged';
end;
$$;

-- ---- Guest orders ------------------------------------------------------------------------------------------------------
grant select on public.items to anon;
set local role anon;
set local request.jwt.claim.role = 'anon';
set local request.jwt.claim.sub = '';
create temp table g as select public.create_reservation_order('Gus Guest', '(555) 600-0001', 'gus@example.com',
  jsonb_build_array(jsonb_build_object('item_id', (select id from public.items where title = 'A'), 'quantity', 1))) as gus,
  public.create_reservation_order('Walt W', '(555) 600-0002', 'WALT@example.com',
  jsonb_build_array(jsonb_build_object('item_id', (select id from public.items where title = 'A'), 'quantity', 1))) as walt;
reset role;
grant select on g to authenticated;
do $$
begin
  assert not public._line_counts((select gus from g), (select id from public.items where title = 'A')), 'an unknown guest waits';
  assert public._line_counts((select walt from g), (select id from public.items where title = 'A')), 'a guest matching a proven customer counts';
end;
$$;
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
do $$
begin
  assert exists (select 1 from public.staff_waiting_guest_orders() where order_id = (select gus from g)), 'Gus is in the queue';
  assert not exists (select 1 from public.staff_waiting_guest_orders() where order_id = (select walt from g)), 'Walt is not';
  assert not (select bool_and(public.counts_for_order(r)) from public.reservations r where r.order_id = (select gus from g)), 'staff see it held';
  perform public.staff_approve_guest_order((select gus from g));
  assert (select bool_and(public.counts_for_order(r)) from public.reservations r where r.order_id = (select gus from g)), 'an approved guest order counts';
end;
$$;
reset role;

-- ---- Verification off --------------------------------------------------------------------------------------------------
-- Set up: Otto signed up (waiting), Pat was unverified by staff, Quinn is approved under the cap, Rae approved over it.
insert into public.customers (first_name, last_name, email, phone, user_id) values
  ('Otto', 'O', 'otto@example.com', '(555) 400-0003', '00000000-0000-0000-0000-0000000000c2'),
  ('Pat',  'P', 'pat@example.com',  '(555) 400-0004', '00000000-0000-0000-0000-0000000000c3'),
  ('Quinn','Q', 'quinn@example.com','(555) 400-0005', '00000000-0000-0000-0000-0000000000c4'),
  ('Rae',  'R', 'rae@example.com',  '(555) 400-0006', '00000000-0000-0000-0000-0000000000c5');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
do $$
begin
  perform public.staff_set_account_state((select id from public.customers where email = 'pat@example.com'), 'proven');
  perform public.staff_set_account_state((select id from public.customers where email = 'pat@example.com'), 'unapproved', 'Suspicious');
  perform public.staff_set_account_state((select id from public.customers where email = 'quinn@example.com'), 'approved');
  perform public.staff_set_account_state((select id from public.customers where email = 'rae@example.com'), 'approved');
end;
$$;
reset role;
do $$
begin
  perform pg_temp.put('quinn@example.com', 'D');                                  -- $4, under $20
  perform pg_temp.put('rae@example.com', 'A'); perform pg_temp.put('rae@example.com', 'B');  -- B over
  assert pg_temp.flagged('rae@example.com') = 'B' and pg_temp.flagged('quinn@example.com') = '', 'set up';
  assert pg_temp.state('otto@example.com') = 'unapproved signup' and pg_temp.state('pat@example.com') = 'unapproved staff', 'set up states';
end;
$$;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
update public.trust_settings set verification_enabled = false;
reset role;
do $$
begin
  assert pg_temp.state('otto@example.com') = 'proven', 'switching off promotes a signup that was waiting';
  assert pg_temp.state('pat@example.com') = 'unapproved staff', 'but not one staff unverified';
  assert pg_temp.state('quinn@example.com') = 'proven', 'an approved account under the cap becomes proven';
  assert pg_temp.state('rae@example.com') = 'approved', 'one over the cap stays approved';
  assert pg_temp.flagged('rae@example.com') = '', '… with no cap while verification is off';
  assert pg_temp.counts(pg_temp.line('rae@example.com', 'B')), 'so all its titles count';
  assert exists (select 1 from public.customer_standing_log l join public.customers c on c.id = l.customer_id
                 where c.email = 'otto@example.com' and l.reason = 'Verify new accounts turned off' and l.staff_name = 'Olive Owner'), 'promotion logged with who';
  assert exists (select 1 from public.trust_settings_log where setting = 'verification_enabled' and to_value = 'false' and staff_name = 'Olive Owner'), 'switch change logged';
end;
$$;

-- With verification off, a new signup is proven and counts straight away; any guest order counts.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c6', 'sky@example.com');
insert into public.customers (first_name, last_name, email, phone, user_id) values
  ('Sky', 'S', 'sky@example.com', '(555) 400-0007', '00000000-0000-0000-0000-0000000000c6');
do $$
declare
  v bigint;
begin
  assert pg_temp.state('sky@example.com') = 'proven', 'verification off: a signup starts proven';
  v := pg_temp.put('sky@example.com', 'C');
  assert pg_temp.counts(v), 'and counts straight away';
  assert public._line_counts((select gus from g), (select id from public.items where title = 'A')), 'guest orders count';
end;
$$;

-- Turning it back on demotes nobody; only accounts created afterwards wait.
update public.trust_settings set verification_enabled = true;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c7', 'tad@example.com');
insert into public.customers (first_name, last_name, email, phone, user_id) values
  ('Tad', 'T', 'tad@example.com', '(555) 400-0008', '00000000-0000-0000-0000-0000000000c7');
do $$
begin
  assert pg_temp.state('sky@example.com') = 'proven' and pg_temp.state('otto@example.com') = 'proven', 'nobody demoted';
  assert pg_temp.state('tad@example.com') = 'unapproved signup', 'a new signup waits again';
  assert pg_temp.flagged('rae@example.com') = 'B', 'Rae is capped again';
end;
$$;

-- ---- Customers see none of it -------------------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c7';
do $$
begin
  assert public.my_account_notice() = 'waiting', 'a waiting account gets the neutral waiting notice';
  assert (select count(*) from public.line_cap_flags) = 0, 'no cap flags';
  assert (select count(*) from public.guest_order_approvals) = 0, 'no guest approvals';
  begin
    perform public.staff_waiting_accounts();
    raise exception 'customers must not read the queue';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.staff_approve_cap_lines(array[1::bigint]);
    raise exception 'customers must not approve';
  exception when insufficient_privilege then null;
  end;
end;
$$;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c5';
do $$
begin
  assert public.my_account_notice() is null, 'an approved account sees nothing, even over the cap';
end;
$$;

rollback;
