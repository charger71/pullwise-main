-- "Skip" from a notification or email (20270315000000_skip_followed_title.sql). Run with tools/test-db.sh.
-- Everything happens in one transaction that is rolled back. A failed check raises an exception.
\set ON_ERROR_STOP on
set client_min_messages = warning;
begin;

insert into public.items (title, issue_number, publisher, status, foc_date) values
  ('SPAWN', '401', 'Image', 'pre_order', current_date + 60),   -- open, followed
  ('SPAWN', '402', 'Image', 'pre_order', current_date + 90),   -- open, followed (second line)
  ('SAGA',  '71',  'Image', 'pre_order', current_date + 60),   -- added by the customer
  ('BONE',  '1',   'Image', 'coming_soon', current_date - 2);  -- past the cutoff

insert into public.customers (first_name, last_name, email, phone) values
  ('Dana', 'Reader', 'dana@example.com', '(555) 300-1000'),
  ('Eli',  'Other',  'eli@example.com',  '(555) 300-2000');

create temp table t as
select
  (select id from public.customers where email = 'dana@example.com') as dana,
  (select id from public.customers where email = 'eli@example.com') as eli,
  (select unsubscribe_token from public.customers where email = 'dana@example.com') as dana_token,
  (select unsubscribe_token from public.customers where email = 'eli@example.com') as eli_token;

do $$
declare
  c    public.customers;
  o    bigint;
  l1 bigint; l2 bigint; l3 bigint; l4 bigint;
  res  jsonb;
  tok  uuid;
  eli_line bigint;
begin
  select * into c from public.customers where email = 'dana@example.com';
  o := public._pull_list_order(c);
  insert into public.reservations (order_id, item_id, quantity, source) select o, id, 1, 'series' from public.items where title = 'SPAWN' and issue_number = '401' returning id into l1;
  insert into public.reservations (order_id, item_id, quantity, source) select o, id, 1, 'artist' from public.items where title = 'SPAWN' and issue_number = '402' returning id into l2;
  insert into public.reservations (order_id, item_id, quantity, source) select o, id, 1, 'manual' from public.items where title = 'SAGA' returning id into l3;
  insert into public.reservations (order_id, item_id, quantity, source) select o, id, 1, 'series' from public.items where title = 'BONE' returning id into l4;
  select dana_token into tok from t;

  -- a follow's line: skipped, cancelled, remembered
  res := public.skip_followed_line(tok, l1);
  assert res->>'result' = 'skipped' and res->>'title' = 'SPAWN #401', format('skip: %s', res);
  assert (select status from public.reservations where id = l1) = 'cancelled', 'line cancelled';
  assert exists (select 1 from public.pull_list_exclusions x join public.items i on i.id = x.item_id where x.customer_id = c.id and i.title = 'SPAWN' and i.issue_number = '401'), 'removal remembered so the follow does not add it back';
  -- the other follow line is untouched
  assert (select status from public.reservations where id = l2) = 'open', 'other lines stay';

  -- tapping again (or the email after the push): already done, no change, no error
  res := public.skip_followed_line(tok, l1);
  assert res->>'result' = 'already', format('again: %s', res);

  -- a title the customer added themselves is not a follow's: not skippable from a link
  res := public.skip_followed_line(tok, l3);
  assert res->>'result' = 'invalid', format('manual line: %s', res);
  assert (select status from public.reservations where id = l3) = 'open';

  -- past the order cutoff: the shop has to change it
  res := public.skip_followed_line(tok, l4);
  assert res->>'result' = 'closed', format('closed: %s', res);
  assert (select status from public.reservations where id = l4) = 'open';

  -- somebody else's token cannot skip this customer's line
  res := public.skip_followed_line((select eli_token from t), l2);
  assert res->>'result' = 'invalid', format('other customer: %s', res);
  assert (select status from public.reservations where id = l2) = 'open', 'still open';

  -- not a token, not a line
  res := public.skip_followed_line(gen_random_uuid(), l2);
  assert res->>'result' = 'invalid', format('unknown token: %s', res);
  res := public.skip_followed_line(tok, 999999999);
  assert res->>'result' = 'invalid', format('unknown line: %s', res);

  -- the sweep does not bring the skipped one back
  perform public.apply_subscriptions(c.id);
  assert (select count(*) from public.reservations r join public.items i on i.id = r.item_id where r.order_id = o and i.issue_number = '401' and r.status = 'open') = 0, 'not added back';

  -- the browser's roles cannot call it (the link's token would be enough to skip anyone's titles)
  assert not has_function_privilege('anon', 'public.skip_followed_line(uuid, bigint)', 'execute'), 'anon';
  assert not has_function_privilege('authenticated', 'public.skip_followed_line(uuid, bigint)', 'execute'), 'authenticated';
  assert has_function_privilege('service_role', 'public.skip_followed_line(uuid, bigint)', 'execute'), 'service_role';
end;
$$;

rollback;
