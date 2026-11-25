-- Staff start a chat with a customer (20270418000000_staff_start_chat.sql): chat_staff_start puts it on the customer's
-- account (or adds to their open chat), and chat_mine lets the signed-in customer find it.
-- Run with tools/test-db.sh. One transaction, rolled back. A failed check raises an exception.
\set ON_ERROR_STOP on
set client_min_messages = warning;
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@example.com'),
  ('00000000-0000-0000-0000-0000000000c1', 'dana@example.com'),
  ('00000000-0000-0000-0000-0000000000c2', 'eli@example.com');
insert into public.staff (user_id, name, is_owner) values ('00000000-0000-0000-0000-0000000000a1', 'Olive Owner', true);
insert into public.customers (first_name, last_name, email, user_id) values
  ('Dana', 'Reader', 'dana@example.com', '00000000-0000-0000-0000-0000000000c1'),
  ('Eli',  'Other',  'eli@example.com',  '00000000-0000-0000-0000-0000000000c2'),
  ('Walk', 'In',     'walk@example.com', null);
update public.settings set chat_enabled = true, chat_available = true where id = 1;

do $$
declare
  dana bigint := (select id from public.customers where email = 'dana@example.com');
  walk bigint := (select id from public.customers where email = 'walk@example.com');
  c1   bigint;
  c2   bigint;
  mine jsonb;
  ok   boolean;
begin
  -- not staff: refused
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c2', true);
  begin
    perform public.chat_staff_start(dana, 'hi');
    ok := false;
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'a customer cannot start a staff chat';

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);

  -- no online account: refused
  begin
    perform public.chat_staff_start(walk, 'hi');
    ok := false;
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'a customer without an account cannot be chatted';

  -- a new chat on Dana's account, with the first line from staff
  c1 := public.chat_staff_start(dana, '  Your copy of Saga is in!  ');
  assert (select customer_id from public.chat_conversations where id = c1) = dana, 'on the account';
  assert (select name from public.chat_conversations where id = c1) = 'Dana Reader', 'named for the customer';
  assert (select status from public.chat_conversations where id = c1) = 'open';
  assert (select unread_staff from public.chat_conversations where id = c1) = 0, 'nothing unread for staff';
  assert (select count(*) from public.chat_messages where conversation_id = c1 and from_staff and body = 'Your copy of Saga is in!') = 1, 'first line saved, trimmed';

  -- a second line goes to the same open chat
  c2 := public.chat_staff_start(dana, 'Pick up any time.');
  assert c2 = c1, 'reuses the open chat';
  assert (select count(*) from public.chat_messages where conversation_id = c1) = 2;

  -- a closed chat is not reused
  update public.chat_conversations set status = 'closed' where id = c1;
  c2 := public.chat_staff_start(dana, 'One more thing.');
  assert c2 <> c1, 'a new chat once the old one is closed';

  -- chat off: refused
  update public.settings set chat_enabled = false where id = 1;
  begin
    perform public.chat_staff_start(dana, 'hi');
    ok := false;
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'chat off refuses';
  update public.settings set chat_enabled = true where id = 1;

  -- empty message: refused
  begin
    perform public.chat_staff_start(dana, '   ');
    ok := false;
  exception when sqlstate 'P0001' then ok := true;
  end;
  assert ok, 'empty message refused';

  -- Dana finds her open chat, and can read and answer it with its token
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);
  mine := public.chat_mine();
  assert (mine->>'token')::uuid = (select visitor_token from public.chat_conversations where id = c2), format('chat_mine: %s', mine);
  assert jsonb_array_length(public.chat_fetch((mine->>'token')::uuid)->'messages') = 1, 'fetch by the token';
  perform public.chat_send((mine->>'token')::uuid, 'Thanks!');
  assert (select unread_staff from public.chat_conversations where id = c2) = 1, 'her answer is unread for staff';

  -- seen: moves forward only, only to a shop message in that chat
  perform public.chat_mark_seen((mine->>'token')::uuid, (select max(id) from public.chat_messages where conversation_id = c2 and from_staff));
  assert (select visitor_seen_id from public.chat_conversations where id = c2) = (select max(id) from public.chat_messages where conversation_id = c2 and from_staff), 'seen saved';
  assert (select visitor_seen_at from public.chat_conversations where id = c2) is not null, 'seen time saved';
  perform public.chat_mark_seen((mine->>'token')::uuid, (select max(id) from public.chat_messages where conversation_id = c2 and not from_staff));
  perform public.chat_mark_seen((mine->>'token')::uuid, (select min(id) from public.chat_messages where conversation_id = c1));
  assert (select visitor_seen_id from public.chat_conversations where id = c2) = (select max(id) from public.chat_messages where conversation_id = c2 and from_staff), 'own message or another chat''s message ignored';
  perform public.chat_mark_seen(gen_random_uuid(), (select max(id) from public.chat_messages where conversation_id = c2 and from_staff));
  assert (select visitor_seen_id from public.chat_conversations where id = c1) is null, 'unknown token changes nothing';

  -- someone else, or nobody signed in, finds nothing
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c2', true);
  assert public.chat_mine() is null, 'another customer sees nothing';
  perform set_config('request.jwt.claim.sub', '', true);
  assert public.chat_mine() is null, 'signed out sees nothing';

  assert not has_function_privilege('anon', 'public.chat_staff_start(bigint, text)', 'execute'), 'anon cannot start';
end;
$$;

rollback;
