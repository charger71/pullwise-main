-- Series follows skip facsimiles and later printings, and series_follow_preview() names the next issue open for
-- ordering (20270406000000_series_follow_skip_reprints.sql). Run with tools/test-db.sh.
-- One transaction, rolled back. A failed check raises an exception.
\set ON_ERROR_STOP on
set client_min_messages = warning;
begin;

insert into public.items (title, issue_number, variant, publisher, status, foc_date, badges) values
  ('SPAWN', '401', null,                'Image', 'pre_order', current_date + 37, '{}'),  -- added
  ('SPAWN', '400', null,                'Image', 'pre_order', current_date + 30, '{}'),  -- added, the next one
  ('SPAWN', '400', 'CVR B MCFARLANE',   'Image', 'pre_order', current_date + 30, '{}'),  -- all covers only
  ('SPAWN', '400', '1ST PTG',           'Image', 'pre_order', current_date + 30, '{}'),  -- first printing: all covers
  ('SPAWN', '399', '2ND PTG',           'Image', 'pre_order', current_date + 20, '{}'),  -- later printing: never
  ('SPAWN', '398', 'THIRD PRINTING',    'Image', 'pre_order', current_date + 20, '{}'),  -- never
  ('SPAWN', '1',   'FACSIMILE EDITION', 'Image', 'pre_order', current_date + 20, '{}'),  -- never
  ('SPAWN', '9',   null,                'Image', 'pre_order', current_date + 20, '{facsimile}'), -- badge: never
  ('SPAWN', '397', null,                'Image', 'coming_soon', current_date - 3, '{}'); -- past its cutoff

insert into public.customers (first_name, last_name, email, phone) values
  ('Dana', 'Reader', 'dana@example.com', '(555) 300-1000'),
  ('Eli',  'Other',  'eli@example.com',  '(555) 300-2000');
update public.customer_standing set account_state = 'proven', unapproved_reason = null;

do $$
declare
  dana public.customers;
  eli  public.customers;
  p    jsonb;
  o    bigint;
  l    bigint;
begin
  assert public.is_reprint('SPAWN', '2ND PTG') and public.is_reprint('BATMAN #423 FACSIMILE EDITION', null)
     and public.is_reprint('X-MEN', 'NEW PTG') and public.is_reprint('SAGA', '10TH PRINTING')
     and public.is_reprint('SAGA', 'REPRINT') and public.is_reprint('SAGA', null, '{facsimile}'), 'reprints';
  assert not public.is_reprint('SPAWN', '1ST PTG') and not public.is_reprint('SPAWN', 'CVR A')
     and not public.is_reprint('BLUEPRINT', null) and not public.is_reprint('SPAWN', null), 'not reprints';

  select * into dana from public.customers where email = 'dana@example.com';
  select * into eli  from public.customers where email = 'eli@example.com';

  -- The preview: two issues open (400 and 401), the earliest cutoff first.
  p := public.series_follow_preview('spawn');
  assert (p->>'issues')::int = 2, format('issues: %s', p);
  assert p->'next'->>'issue_number' = '400' and p->'next'->>'variant' is null, format('next: %s', p);

  -- Main cover follow: 400 and 401 only.
  insert into public.subscriptions (customer_id, kind, key, label, quantity) values (dana.id, 'series', 'spawn', 'SPAWN', 1);
  perform public.apply_subscriptions(dana.id);
  assert (select array_agg(i.issue_number || coalesce(' ' || i.variant, '') order by i.issue_number)
          from public.reservations r join public.reservation_orders ro on ro.id = r.order_id join public.items i on i.id = r.item_id
          where ro.customer_id = dana.id) = array['400', '401'], 'main covers, no reprints';

  -- All covers: every cover of 400 and 401, still no reprints.
  insert into public.subscriptions (customer_id, kind, key, label, quantity, all_covers) values (eli.id, 'series', 'spawn', 'SPAWN', 1, true);
  perform public.apply_subscriptions(eli.id);
  assert (select array_agg(i.issue_number || coalesce(' ' || i.variant, '') order by i.issue_number, i.variant nulls first)
          from public.reservations r join public.reservation_orders ro on ro.id = r.order_id join public.items i on i.id = r.item_id
          where ro.customer_id = eli.id) = array['400', '400 1ST PTG', '400 CVR B MCFARLANE', '401'], 'all covers, no reprints';

  -- A reprint added by hand stays; unfollowing doesn't take it.
  o := public._pull_list_order(dana);
  insert into public.reservations (order_id, item_id, quantity, source)
  select o, id, 1, 'manual' from public.items where issue_number = '399' returning id into l;
  assert public._unfollow((select s from public.subscriptions s where customer_id = dana.id), true) = 2, 'unfollow counts the follow''s two';
  assert exists (select 1 from public.reservations where id = l), 'manual reprint stays';
end;
$$;

-- The browser's signed-in role can ask for the preview; signed-out visitors can't.
select has_function_privilege('authenticated', 'public.series_follow_preview(text)', 'execute') as ok \gset
\if :ok
\else
  do $$ begin raise exception 'authenticated should run series_follow_preview'; end $$;
\endif
do $$ begin assert not has_function_privilege('anon', 'public.series_follow_preview(text)', 'execute'), 'anon'; end $$;

rollback;
