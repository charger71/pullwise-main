-- Live chat: a small chat box on the public pages (switched on in Shop Settings → Online) and a Chat screen in the
-- admin where staff read and answer it.
--
-- Visitors have no login. Each browser makes a random secret token and keeps it; every visitor call goes through a
-- function below that checks the token, so a visitor can only ever read or add to their own chat. Staff read and
-- answer through row-level security, and hear about new messages live (Supabase Realtime) while the Chat screen is open.

alter table public.settings add column chat_enabled boolean not null default false;
alter table public.settings add column chat_greeting text check (char_length(chat_greeting) <= 200);

create table public.chat_conversations (
  id              bigint generated always as identity primary key,
  visitor_token   uuid not null unique,
  name            text not null check (char_length(name) between 1 and 80),
  email           text check (char_length(email) <= 200),
  status          text not null default 'open' check (status in ('open', 'closed')),
  unread_staff    int not null default 0 check (unread_staff >= 0),  -- visitor messages no staff member has opened yet
  client_ip       inet,
  last_message_at timestamptz not null default now(),
  created_at      timestamptz not null default now()
);
create index chat_conversations_status_idx on public.chat_conversations (status, last_message_at desc);

create table public.chat_messages (
  id              bigint generated always as identity primary key,
  conversation_id bigint not null references public.chat_conversations (id) on delete cascade,
  from_staff      boolean not null,
  body            text not null check (char_length(body) between 1 and 1000),
  sent_by         text,
  created_at      timestamptz not null default now()
);
create index chat_messages_conversation_idx on public.chat_messages (conversation_id, id);

-- Every new message keeps its conversation's summary current: the time, the unread count, and a visitor writing
-- again reopens a chat staff had closed.
create or replace function public.chat_message_added()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  update public.chat_conversations set
    last_message_at = new.created_at,
    unread_staff = case when new.from_staff then 0 else unread_staff + 1 end,
    status = case when new.from_staff then status else 'open' end
  where id = new.conversation_id;
  return new;
end;
$$;
create trigger chat_messages_added after insert on public.chat_messages for each row execute function public.chat_message_added();

alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;

-- Staff only. Visitors never touch the tables: they use the functions below.
create policy "staff manage chats" on public.chat_conversations for all using (public.is_staff()) with check (public.is_staff());
create policy "staff read chat messages" on public.chat_messages for select using (public.is_staff());
create policy "staff send chat messages" on public.chat_messages for insert with check (public.is_staff() and from_staff);
revoke all on public.chat_conversations, public.chat_messages from anon;

-- Staff screens update live from these two tables.
alter publication supabase_realtime add table public.chat_conversations, public.chat_messages;

-- Start a chat with a first message. The honeypot field catches bots (they get a silent success).
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
  v_name  text := left(trim(coalesce(p_name, '')), 80);
  v_email text := nullif(left(trim(coalesce(p_email, '')), 200), '');
  v_body  text := left(trim(coalesce(p_body, '')), 1000);
  v_ip    inet;
  v_id    bigint;
begin
  if coalesce(p_website, '') <> '' then
    return;
  end if;
  if not coalesce((select chat_enabled from public.settings where id = 1), false) then
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

  insert into public.chat_conversations (visitor_token, name, email, client_ip) values (p_token, v_name, v_email, v_ip)
  returning id into v_id;
  insert into public.chat_messages (conversation_id, from_staff, body) values (v_id, false, v_body);
end;
$$;
grant execute on function public.chat_start(uuid, text, text, text, text) to anon, authenticated;

-- A visitor adds a message to their own chat.
create or replace function public.chat_send(p_token uuid, p_body text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_body text := left(trim(coalesce(p_body, '')), 1000);
  v_id   bigint;
begin
  if v_body = '' then
    raise exception 'Please type a message.' using errcode = 'P0001';
  end if;
  if not coalesce((select chat_enabled from public.settings where id = 1), false) then
    raise exception 'Chat is closed right now. Please call or email the shop.' using errcode = 'P0001';
  end if;
  select id into v_id from public.chat_conversations where visitor_token = p_token;
  if v_id is null then
    raise exception 'This chat has ended. Please start a new one.' using errcode = 'P0001';
  end if;
  if (
    select count(*) from public.chat_messages where conversation_id = v_id and not from_staff and created_at > now() - interval '10 minutes'
  ) >= 20 then
    raise exception 'You’re sending messages quickly. Please wait a moment.' using errcode = 'P0001';
  end if;
  insert into public.chat_messages (conversation_id, from_staff, body) values (v_id, false, v_body);
end;
$$;
grant execute on function public.chat_send(uuid, text) to anon, authenticated;

-- A visitor reads their own chat: { status, messages: [{ id, from_staff, body, created_at }] } (the latest 200), or null
-- when the token matches no chat (staff deleted it).
create or replace function public.chat_fetch(p_token uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'status', c.status,
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'from_staff', m.from_staff, 'body', m.body, 'created_at', m.created_at) order by m.id)
      from (select * from public.chat_messages where conversation_id = c.id order by id desc limit 200) m
    ), '[]'::jsonb)
  )
  from public.chat_conversations c
  where c.visitor_token = p_token;
$$;
grant execute on function public.chat_fetch(uuid) to anon, authenticated;
