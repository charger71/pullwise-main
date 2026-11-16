-- Pickup reliability, phase 2 (20270317000000_pickup_pause_manual.sql): staff pause, resume and unverify; a pause
-- blocks new pre-orders and follow auto-adds; paused and unapproved customers leave the ordering numbers.
-- Run with tools/test-db.sh. One transaction, rolled back. A failed check raises an exception.
\set ON_ERROR_STOP on
set client_min_messages = warning;
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@example.com'),
  ('00000000-0000-0000-0000-0000000000c1', 'dana@example.com'),
  ('00000000-0000-0000-0000-0000000000c2', 'eli@example.com');
insert into public.staff (user_id, name, is_owner) values ('00000000-0000-0000-0000-0000000000a1', 'Olive Owner', true);

insert into public.items (title, issue_number, publisher, status, price, foc_date) values
  ('SPAWN', '401', 'Image', 'pre_order', 3.99, current_date + 30),  -- before its cutoff
  ('SPAWN', '402', 'Image', 'pre_order', 3.99, current_date + 37),  -- a follow would add this
  ('SAGA',  '71',  'Image', 'pre_order', 4.50, current_date + 30),
  ('BONE',  '1',   'Image', 'coming_soon', 2.99, current_date - 3),  -- cutoff passed
  ('MAUS',  '1',   'Image', 'pre_order', 5.00, null);               -- no cutoff

insert into public.customers (first_name, last_name, email, phone, user_id) values
  ('Dana', 'Reader', 'dana@example.com', '(555) 300-1000', '00000000-0000-0000-0000-0000000000c1'),
  ('Eli',  'Other',  'eli@example.com',  '(555) 300-2000', '00000000-0000-0000-0000-0000000000c2');

create temp table ids as
select (select id from public.customers where email = 'dana@example.com') as dana,
       (select id from public.customers where email = 'eli@example.com') as eli,
       0::bigint as l_future, 0::bigint as l_past, 0::bigint as l_nocut, 0::bigint as l_eli;
grant all on ids to authenticated;
-- Supabase grants table access to the API roles by default (row-level security then decides the rows); the scratch
-- database doesn't, so give the reads these checks rely on.
grant select on public.reservations, public.reservation_orders, public.items, public.customers to authenticated;
grant select on ids, public.items to anon;

do $$
declare
  d public.customers;
  e public.customers;
begin
  select * into d from public.customers where email = 'dana@example.com';
  select * into e from public.customers where email = 'eli@example.com';
  update ids set
    l_future = (select public._pull_list_put(d, i, 1, 'manual', false) from public.items i where title = 'SPAWN' and issue_number = '401'),
    l_eli    = (select public._pull_list_put(e, i, 2, 'manual', false) from public.items i where title = 'SPAWN' and issue_number = '401');
  -- Lines past their cutoff / with none can't be added through the customer path: put them in directly (as staff would).
  insert into public.reservations (order_id, item_id, quantity) select public._pull_list_order(d), id, 1 from public.items where title = 'BONE';
  insert into public.reservations (order_id, item_id, quantity) select public._pull_list_order(d), id, 1 from public.items where title = 'MAUS';
  update ids set
    l_past  = (select r.id from public.reservations r join public.items i on i.id = r.item_id where i.title = 'BONE'),
    l_nocut = (select r.id from public.reservations r join public.items i on i.id = r.item_id where i.title = 'MAUS');
  insert into public.subscriptions (customer_id, kind, key, label) values (d.id, 'series', 'spawn', 'Spawn');
end;
$$;

-- ---- A customer can't pause anyone, or call the staff functions --------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
do $$
begin
  begin
    perform public.staff_pause_customer((select dana from ids));
    raise exception 'a customer must not pause';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.staff_set_account_state((select dana from ids), 'proven');
    raise exception 'a customer must not change their state';
  exception when insufficient_privilege then null;
  end;
  assert public.my_account_notice() is null, 'no notice before a pause';
  assert (select public.counts_for_order(r) from public.reservations r where id = (select l_future from ids)) is null, 'customers get no answer from counts_for_order';
end;
$$;

-- ---- Staff pause Dana ----------------------------------------------------------------------------------------------------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
do $$
declare
  st public.customer_standing;
  n  int;
begin
  -- Before the pause, everything counts.
  assert (select bool_and(public.counts_for_order(r)) from public.reservations r), 'all lines count before a pause';

  st := public.staff_pause_customer((select dana from ids), 'Books waiting since October');
  assert st.paused_reason = 'manual' and st.paused_at is not null and st.paused_by = '00000000-0000-0000-0000-0000000000a1', format('paused: %s', st);
  assert exists (select 1 from public.customer_standing_log where customer_id = (select dana from ids) and field = 'paused'
                   and from_value = 'active' and to_value = 'paused (manual)' and reason = 'Books waiting since October' and staff_name = 'Olive Owner'), 'pause logged';

  -- Ordering numbers: a line before its cutoff (or with none) drops out; past the cutoff it stays; other customers count.
  assert (select public.counts_for_order(r) from public.reservations r where id = (select l_future from ids)) = false, 'paused, before cutoff: not counted';
  assert (select public.counts_for_order(r) from public.reservations r where id = (select l_nocut from ids)) = false, 'paused, no cutoff: not counted';
  assert (select public.counts_for_order(r) from public.reservations r where id = (select l_past from ids)) = true, 'paused, past cutoff: still counted';
  assert (select public.counts_for_order(r) from public.reservations r where id = (select l_eli from ids)) = true, 'another customer still counts';

  -- "Mark ordered" from a list loaded before the pause skips the held line.
  n := public.staff_set_line_status(array[(select l_future from ids), (select l_eli from ids), (select l_past from ids)], 'ordered', array['open']::public.reservation_status[]);
  assert n = 2, format('only the counted lines are marked ordered: %s', n);
  assert (select status from public.reservations where id = (select l_future from ids)) = 'open', 'held line stays open';

  -- Staff can still add for a paused customer.
  perform public.staff_pull_list_add((select dana from ids), (select id from public.items where title = 'SAGA'), 1);
  assert exists (select 1 from public.reservations r join public.items i on i.id = r.item_id where i.title = 'SAGA' and r.status = 'open'), 'staff add allowed';
end;
$$;
reset role;
delete from public.reservations where item_id = (select id from public.items where title = 'SAGA');
-- An automatic pause that staff then pause by hand becomes manual.
update public.customer_standing set paused_reason = 'auto' where customer_id = (select dana from ids);
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
do $$
declare
  st public.customer_standing;
begin
  st := public.staff_pause_customer((select dana from ids));
  assert st.paused_reason = 'manual', 'pausing an auto-paused customer by hand makes it manual';
end;
$$;

-- ---- Dana, paused, tries to add ----------------------------------------------------------------------------------------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
do $$
begin
  assert public.my_account_notice() = 'on_hold', 'the customer sees a neutral on-hold notice';
  begin
    perform public.pull_list_add((select id from public.items where title = 'SAGA'), 1);
    raise exception 'a paused customer must not add';
  exception when raise_exception then
    if sqlerrm not like '%on hold%' then raise; end if;
  end;
  -- Raising a quantity is a new pre-order too.
  begin
    perform public.pull_list_set_quantity((select l_future from ids), 3);
    raise exception 'a paused customer must not raise a quantity';
  exception when raise_exception then
    if sqlerrm not like '%on hold%' then raise; end if;
  end;
  -- Nothing Dana can read says why.
  assert (select count(*) from public.customer_standing) = 0, 'standing stays hidden';
end;
$$;
reset role;

-- A follow's new issue is skipped quietly for a paused customer (the hourly sweep runs with no signed-in user).
do $$
declare
  n int;
begin
  n := public.apply_subscriptions((select dana from ids));
  assert n = 0, format('no auto-adds while paused: %s', n);
  assert not exists (select 1 from public.reservations r join public.items i on i.id = r.item_id where i.title = 'SPAWN' and i.issue_number = '402'), 'follow line not added';
end;
$$;

-- A guest checkout under Dana's email is refused; under someone else's details it works.
set local role anon;
set local request.jwt.claim.role = 'anon';
set local request.jwt.claim.sub = '';
do $$
begin
  begin
    perform public.create_reservation_order('Dana Reader', '(555) 999-0000', 'Dana@Example.com', jsonb_build_array(jsonb_build_object('item_id', (select id from public.items where title = 'SAGA'), 'quantity', 1)));
    raise exception 'a guest order under a paused customer''s email must be refused';
  exception when raise_exception then
    if sqlerrm not like '%contact the shop%' then raise; end if;
  end;
  begin
    perform public.create_reservation_order('Someone', '(555) 300-1000', 'other@example.com', jsonb_build_array(jsonb_build_object('item_id', (select id from public.items where title = 'SAGA'), 'quantity', 1)));
    raise exception 'a guest order under a paused customer''s phone must be refused';
  exception when raise_exception then
    if sqlerrm not like '%contact the shop%' then raise; end if;
  end;
  assert public.create_reservation_order('Fay Guest', '(555) 777-0000', 'fay@example.com', jsonb_build_array(jsonb_build_object('item_id', (select id from public.items where title = 'SAGA'), 'quantity', 1))) > 0, 'other guests unaffected';
end;
$$;
reset role;

-- ---- Resume: Dana counts again and can add -------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
do $$
declare
  st public.customer_standing;
begin
  st := public.staff_resume_customer((select dana from ids), 'Picked up');
  assert st.paused_at is null and st.paused_reason is null, format('resumed: %s', st);
  assert exists (select 1 from public.customer_standing_log where customer_id = (select dana from ids) and field = 'paused' and to_value = 'active' and reason = 'Picked up'), 'resume logged';
  assert (select public.counts_for_order(r) from public.reservations r where id = (select l_future from ids)), 'counts again after resume';
end;
$$;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
do $$
begin
  assert public.my_account_notice() is null, 'notice gone after resume';
  assert public.pull_list_add((select id from public.items where title = 'SAGA'), 1) is not null, 'can add again';
end;
$$;

-- ---- Unverify: Dana's lines leave the ordering numbers (all of them), but she can still build a list ---------------------
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
do $$
declare
  st public.customer_standing;
begin
  st := public.staff_set_account_state((select dana from ids), 'unapproved', 'Looks like a duplicate account');
  assert st.account_state = 'unapproved' and st.unapproved_reason = 'staff', format('unverified: %s', st);
  assert exists (select 1 from public.customer_standing_log where customer_id = (select dana from ids) and field = 'account_state'
                   and from_value = 'proven' and to_value = 'unapproved (staff)' and reason = 'Looks like a duplicate account'), 'unverify logged';
  assert not (select bool_or(public.counts_for_order(r)) from public.reservations r join public.reservation_orders o on o.id = r.order_id where o.customer_id = (select dana from ids)),
    'an unapproved customer''s lines never count, even past the cutoff';
  assert (select public.counts_for_order(r) from public.reservations r where id = (select l_eli from ids)), 'Eli unaffected';
end;
$$;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
do $$
begin
  assert public.my_account_notice() is null, 'unapproved is not on hold (phase 3 adds its own notice)';
  assert public.pull_list_add((select id from public.items where title = 'SPAWN' and issue_number = '402'), 1) is not null, 'an unapproved customer can still build a list';
end;
$$;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
do $$
declare
  st public.customer_standing;
begin
  st := public.staff_set_account_state((select dana from ids), 'proven');
  assert st.account_state = 'proven' and st.unapproved_reason is null, 'staff can set proven';
  assert (select bool_and(public.counts_for_order(r)) from public.reservations r join public.reservation_orders o on o.id = r.order_id where o.customer_id = (select dana from ids) and r.status = 'open'),
    'counts again once proven';
end;
$$;

rollback;
