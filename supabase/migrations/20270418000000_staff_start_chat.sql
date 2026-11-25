-- Live chat: staff can start a chat with a customer from the admin (Customers → a customer → Messages → Chat).
--
-- Until now only a visitor could start a chat, and a visitor's chat is found by the secret token their browser made.
-- A chat staff start has no browser behind it yet, so it goes on the customer's account (chat_conversations.customer_id)
-- and the customer finds it when they are signed in, on the website or in the app:
--   * chat_staff_start(customer, message): staff write the first line. A customer who already has an open chat gets the
--     line there instead of a second chat. Only for a customer with an online account, and only while chat is on (the
--     customer couldn't see or answer it otherwise). The usual reply trigger then sends the app notification.
--   * chat_mine(): the signed-in customer's newest open chat, so their chat box can show it. It hands back that chat's
--     token, which is theirs (the chat is on their account), so chat_fetch / chat_send work as for any chat.
--   * chat_mark_seen(token, message): the chat box says how far the customer has read, so staff see "Seen" (any chat,
--     a visitor's too).

create or replace function public.chat_staff_start(p_customer bigint, p_body text)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_body  text := left(trim(coalesce(p_body, '')), 1000);
  v_cust  public.customers;
  v_name  text;
  v_id    bigint;
begin
  if not public.is_staff() then
    raise exception 'Please sign in with your staff account.' using errcode = 'P0001';
  end if;
  if v_body = '' then
    raise exception 'Please type a message.' using errcode = 'P0001';
  end if;
  if not coalesce((select chat_enabled and chat_available from public.settings where id = 1), false) then
    raise exception 'Chat is off, so the customer couldn’t see or answer this. Turn chat on (Chat screen) first.' using errcode = 'P0001';
  end if;
  select * into v_cust from public.customers where id = p_customer;
  if v_cust.id is null then
    raise exception 'That customer is gone. A teammate may have deleted them.' using errcode = 'P0001';
  end if;
  if v_cust.user_id is null then
    raise exception 'This customer has no online account, so they can’t chat yet. Email them instead.' using errcode = 'P0001';
  end if;

  select id into v_id from public.chat_conversations
  where customer_id = p_customer and status = 'open'
  order by last_message_at desc limit 1;
  if v_id is null then
    v_name := left(coalesce(nullif(trim(concat_ws(' ', v_cust.first_name, v_cust.last_name)), ''), nullif(trim(v_cust.name), ''), 'Customer'), 80);
    insert into public.chat_conversations (visitor_token, name, email, customer_id)
    values (gen_random_uuid(), v_name, nullif(left(v_cust.email, 200), ''), p_customer)
    returning id into v_id;
  end if;
  insert into public.chat_messages (conversation_id, from_staff, body, sent_by)
  values (v_id, true, v_body, auth.jwt() ->> 'email');
  return v_id;
end;
$$;
revoke execute on function public.chat_staff_start(bigint, text) from public, anon;
grant execute on function public.chat_staff_start(bigint, text) to authenticated;

-- The signed-in customer's newest open chat: { token, status } or null (signed out, no account, or no open chat).
create or replace function public.chat_mine()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object('token', c.visitor_token, 'status', c.status)
  from public.chat_conversations c
  join public.customers u on u.id = c.customer_id
  where u.user_id = auth.uid() and auth.uid() is not null and c.status = 'open'
  order by c.last_message_at desc
  limit 1;
$$;
revoke execute on function public.chat_mine() from public, anon;
grant execute on function public.chat_mine() to anon, authenticated;

-- Seen: staff can tell whether the customer (or visitor) has read the shop's messages. Their chat box reports the
-- newest shop message it has shown with the box open (chat_mark_seen); the admin marks the staff messages up to it
-- "Seen" with the time. Only ever moves forward, and only to a message in that chat.
alter table public.chat_conversations
  add column visitor_seen_id bigint,
  add column visitor_seen_at timestamptz;

create or replace function public.chat_mark_seen(p_token uuid, p_message bigint)
returns void
language sql security definer set search_path = public
as $$
  update public.chat_conversations c set visitor_seen_id = p_message, visitor_seen_at = now()
  where c.visitor_token = p_token
    and p_message > coalesce(c.visitor_seen_id, 0)
    and exists (select 1 from public.chat_messages m where m.id = p_message and m.conversation_id = c.id and m.from_staff);
$$;
revoke execute on function public.chat_mark_seen(uuid, bigint) from public;
grant execute on function public.chat_mark_seen(uuid, bigint) to anon, authenticated;
