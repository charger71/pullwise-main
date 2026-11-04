-- Live chat: a master switch for the whole feature.
-- chat_available (Shop Settings → Online, owners) turns the feature on or off for the shop: off hides the Chat screen in
-- the admin and everything on the public pages. chat_enabled (the switch on the admin Chat screen, any staff) is the
-- day-to-day on/off. Visitors see the chat only when both are on, and the functions below refuse messages otherwise.
-- Shops that already have the Chat screen keep it (default true).

alter table public.settings add column chat_available boolean not null default true;

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

  insert into public.chat_conversations (visitor_token, name, email, client_ip) values (p_token, v_name, v_email, v_ip)
  returning id into v_id;
  insert into public.chat_messages (conversation_id, from_staff, body) values (v_id, false, v_body);
end;
$$;

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
  if not coalesce((select chat_enabled and chat_available from public.settings where id = 1), false) then
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
