-- Live chat for signed-in customers: a chat a customer starts while signed in (on the website or in the shop's app)
-- belongs to their account, so staff see who they are talking to (Admin → Chat links to the customer), and the
-- shop's replies reach the customer's phone as an app notification, even with the app closed.
--
--   * chat_conversations.customer_id: the account the chat was started from (none for a visitor who isn't signed in)
--   * chat_conversations.customer_pushed_at: when the customer was last told about a reply, so a few quick lines
--     from staff buzz once
--   * customers.push_chat: the customer's own on/off for chat replies (App → Account → Notifications)
--   * chat_start links the chat; a trigger on chat_messages asks push-notify to tell the customer about a reply

alter table public.chat_conversations
  add column customer_id        bigint references public.customers (id) on delete set null,
  add column customer_pushed_at timestamptz;
create index chat_conversations_customer_idx on public.chat_conversations (customer_id);

alter table public.customers add column push_chat boolean not null default true;
grant update (push_chat) on public.customers to authenticated;

-- As in 20270223000000_chat_master_switch.sql, plus the signed-in customer's account (none for a visitor).
create or replace function public.chat_start(
  p_token   uuid,
  p_name    text,
  p_email   text,
  p_body    text,
  p_website text default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_name     text := left(trim(coalesce(p_name, '')), 80);
  v_email    text := nullif(left(trim(coalesce(p_email, '')), 200), '');
  v_body     text := left(trim(coalesce(p_body, '')), 1000);
  v_customer bigint := (select id from public.customers where user_id = auth.uid());
  v_ip       inet;
  v_id       bigint;
begin
  if coalesce(p_website, '') <> '' then
    return;
  end if;
  if not coalesce((select chat_enabled and chat_available from public.settings where id = 1), false) then
    raise exception 'Chat is closed right now. Please call or email the shop.' using errcode = 'P0001';
  end if;
  if p_token is null or v_name = '' or v_body = '' then
    raise exception 'Please add your name and a message.' using errcode = 'P0001';
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That email address doesn’t look right. You can also leave it blank.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.chat_conversations where visitor_token = p_token) then
    raise exception 'You already have a chat open. Please reload the page.' using errcode = 'P0001';
  end if;

  begin
    v_ip := split_part(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ',', 1)::inet;
  exception when others then
    v_ip := null;
  end;
  if v_ip is not null and (
    select count(*) from public.chat_conversations where client_ip = v_ip and created_at > now() - interval '1 hour'
  ) >= 5 then
    raise exception 'Too many chats started from here. Please try again later, or call the shop.' using errcode = 'P0001';
  end if;

  insert into public.chat_conversations (visitor_token, name, email, client_ip, customer_id) values (p_token, v_name, v_email, v_ip, v_customer)
  returning id into v_id;
  insert into public.chat_messages (conversation_id, from_staff, body) values (v_id, false, v_body);
end;
$$;
grant execute on function public.chat_start(uuid, text, text, text, text) to anon, authenticated;

-- Staff replied: ask push-notify to tell the customer, when the chat belongs to a customer who has the app's
-- notifications on for chat replies; at most once a minute for each chat. A failure here never stops the reply
-- being saved. It sits next to the email function, so it uses that function's address and secret.
create or replace function public.chat_reply_push()
returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_customer bigint;
  v_url      text;
  v_key      text;
begin
  if not new.from_staff then
    return new;
  end if;
  select customer_id into v_customer from public.chat_conversations where id = new.conversation_id;
  if v_customer is null
     or not exists (select 1 from public.customers where id = v_customer and push_chat)
     or not exists (select 1 from public.push_subscriptions where customer_id = v_customer) then
    return new;
  end if;
  update public.chat_conversations set customer_pushed_at = now()
  where id = new.conversation_id and (customer_pushed_at is null or customer_pushed_at < now() - interval '1 minute');
  if not found then
    return new;
  end if;

  begin
    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'weekly_email_url';
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'weekly_email_secret';
    if v_url is null or v_key is null then
      raise warning 'a chat reply notification is waiting but the weekly_email_url / weekly_email_secret Vault secrets are missing';
      return new;
    end if;
    perform net.http_post(
      url := regexp_replace(v_url, '/weekly-pull-list$', '/push-notify'),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_key),
      body := jsonb_build_object('mode', 'chat-reply', 'conversation_id', new.conversation_id),
      timeout_milliseconds := 30000
    );
  exception when others then
    raise warning 'chat reply notification not sent: %', sqlerrm;
  end;
  return new;
end;
$$;
revoke execute on function public.chat_reply_push() from public, anon, authenticated;
create trigger chat_messages_reply_push after insert on public.chat_messages for each row execute function public.chat_reply_push();
