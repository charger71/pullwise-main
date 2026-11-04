-- Live chat: a push notification to staff phones and computers when a visitor writes, even with the admin closed.
--
-- Staff turn it on per device from the admin Chat screen (admin/staff-push.js; admin/sw.js shows what arrives). The
-- Edge Function `push-notify` sends it, with the same VAPID keys as the pull list app's notices. This migration adds:
--   * staff_push_subscriptions: one row per staff device that turned notifications on (only through the functions below)
--   * chat_conversations.staff_pushed_at: when staff were last told about a chat, so a visitor typing several lines in
--     a row buzzes once, not once a line
--   * a trigger on chat_messages that asks push-notify to send when a visitor writes

create table public.staff_push_subscriptions (
  id           bigint generated always as identity primary key,
  user_id      uuid   not null references public.staff (user_id) on delete cascade,
  endpoint     text   not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh       text   not null check (length(p256dh) <= 200),
  auth         text   not null check (length(auth) <= 100),
  user_agent   text   check (length(user_agent) <= 300),
  created_at   timestamptz not null default now(),
  last_sent_at timestamptz
);
create index staff_push_subscriptions_user_idx on public.staff_push_subscriptions (user_id);
alter table public.staff_push_subscriptions enable row level security;
-- Staff see their own devices; adding and removing goes through the functions below.
create policy "own staff push subscriptions read" on public.staff_push_subscriptions for select
  using (user_id = auth.uid() and public.is_staff());
revoke all on public.staff_push_subscriptions from anon;

alter table public.chat_conversations add column staff_pushed_at timestamptz;

-- A staff member turns chat notifications on for this device. A device that was signed in as another staff member
-- moves to this one.
create or replace function public.save_staff_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Please sign in with your staff account.' using errcode = 'P0001';
  end if;
  if coalesce(p_endpoint, '') !~ '^https://' or length(p_endpoint) > 1000 or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'This browser sent a notification address we can''t use.' using errcode = 'P0001';
  end if;
  insert into public.staff_push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, left(p_p256dh, 200), left(p_auth, 100), left(p_user_agent, 300))
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent;
end;
$$;
revoke execute on function public.save_staff_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_staff_push_subscription(text, text, text, text) to authenticated;

-- Turn chat notifications off for one device (the staff member's own).
create or replace function public.delete_staff_push_subscription(p_endpoint text)
returns void
language sql security definer set search_path = public
as $$
  delete from public.staff_push_subscriptions where user_id = auth.uid() and endpoint = p_endpoint;
$$;
revoke execute on function public.delete_staff_push_subscription(text) from public, anon;
grant execute on function public.delete_staff_push_subscription(text) to authenticated;

-- A visitor wrote: ask push-notify to tell staff, at most once every 5 minutes for each chat (staff answering a
-- chat they already have open hear about it on the screen). Nothing is asked when no staff device has notifications
-- on, or the shop has the chat feature switched off. A failure here never stops the visitor's message being saved.
-- It sits next to the email function, so it uses that function's address and secret (as push_notify_tick does).
create or replace function public.chat_message_push()
returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_url text;
  v_key text;
begin
  if new.from_staff
     or not exists (select 1 from public.staff_push_subscriptions)
     or not coalesce((select chat_available from public.settings where id = 1), false) then
    return new;
  end if;
  -- Claim this chat's turn: only one message in 5 minutes gets past here.
  update public.chat_conversations set staff_pushed_at = now()
  where id = new.conversation_id and (staff_pushed_at is null or staff_pushed_at < now() - interval '5 minutes');
  if not found then
    return new;
  end if;

  begin
    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'weekly_email_url';
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'weekly_email_secret';
    if v_url is null or v_key is null then
      raise warning 'a staff chat notification is waiting but the weekly_email_url / weekly_email_secret Vault secrets are missing';
      return new;
    end if;
    perform net.http_post(
      url := regexp_replace(v_url, '/weekly-pull-list$', '/push-notify'),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_key),
      body := jsonb_build_object('mode', 'chat', 'conversation_id', new.conversation_id, 'message_id', new.id),
      timeout_milliseconds := 30000
    );
  exception when others then
    raise warning 'staff chat notification not sent: %', sqlerrm;
  end;
  return new;
end;
$$;
revoke execute on function public.chat_message_push() from public, anon, authenticated;
create trigger chat_messages_push after insert on public.chat_messages for each row execute function public.chat_message_push();
