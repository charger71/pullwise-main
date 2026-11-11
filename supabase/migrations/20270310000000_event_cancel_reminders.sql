-- Events: cancel without deleting, and a day-before reminder email to everyone signed up.
--
--   cancelled_at     set when staff cancel an event. The event stays on the calendar marked Cancelled, signups close,
--                    and everyone signed up is emailed (trigger below). Clearing it puts the event back.
--   send_reminder    the per-event "email a reminder" box (on by default); only matters while the event has signups.
--   reminder_sent_at set when the reminder has gone out, so it is sent once.
--
-- Both emails go through the weekly-pull-list Edge function (modes "event_reminder" and "event_cancelled"), the same way
-- the signup confirmation does, using the same Vault secrets. A problem sending never blocks the change itself.

alter table public.events
  add column cancelled_at     timestamptz,
  add column send_reminder    boolean not null default true,
  add column reminder_sent_at timestamptz;

-- Signups close on a cancelled event (same as 20270114000000_site_audit_fixes.sql, plus the cancelled check).
create or replace function public.event_signup(
  p_event_id bigint,
  p_name     text,
  p_email    text,
  p_phone    text,
  p_party    int default 1,
  p_notes    text default null,
  p_website  text default null  -- honeypot: real users never fill this in
)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_name  text := nullif(trim(p_name), '');
  v_email text := nullif(lower(trim(p_email)), '');
  v_phone text := nullif(trim(p_phone), '');
  v_notes text := nullif(trim(p_notes), '');
  v_ev    public.events;
  v_ip    inet := public._client_ip();
  v_taken int;
  v_id    bigint;
begin
  if coalesce(p_website, '') <> '' then
    return 0;
  end if;
  if v_name is null then
    raise exception 'Please enter your name.' using errcode = 'P0001';
  end if;
  if length(v_name) > 100 then
    raise exception 'Please keep your name under 100 characters.' using errcode = 'P0001';
  end if;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception 'Please enter a valid email address.' using errcode = 'P0001';
  end if;
  if v_phone is null then
    raise exception 'Please enter your phone number.' using errcode = 'P0001';
  end if;
  if length(v_phone) > 40 then
    raise exception 'That phone number looks too long.' using errcode = 'P0001';
  end if;
  if p_party is null or p_party < 1 or p_party > 10 then
    raise exception 'Party size must be between 1 and 10. For a bigger group, please call the shop.' using errcode = 'P0001';
  end if;
  if length(v_notes) > 500 then
    raise exception 'Please keep notes under 500 characters.' using errcode = 'P0001';
  end if;

  -- Lock the event row so two people can't take the last spot at once.
  select * into v_ev from public.events where id = p_event_id for update;
  if not found or not v_ev.signup_enabled then
    raise exception 'Signups aren''t open for this event.' using errcode = 'P0001';
  end if;
  if v_ev.cancelled_at is not null then
    raise exception 'This event has been cancelled.' using errcode = 'P0001';
  end if;
  if coalesce(v_ev.ends_at, v_ev.starts_at) < now() then
    raise exception 'This event has already happened.' using errcode = 'P0001';
  end if;

  if not public.form_rate_take('event_signup', p_event_id::text, v_ip, 10, interval '10 minutes', 60, interval '1 hour') then
    raise exception 'Too many signups right now — please try again in a few minutes or call the shop.' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.event_signups where event_id = p_event_id and lower(email) = v_email) then
    raise exception 'That email address is already signed up for this event. Call the shop if you need to change it.' using errcode = 'P0001';
  end if;

  if v_ev.signup_capacity is not null then
    v_taken := public.event_spots_taken(p_event_id);
    if v_taken >= v_ev.signup_capacity then
      raise exception 'Sorry, this event is full.' using errcode = 'P0001';
    end if;
    if v_taken + p_party > v_ev.signup_capacity then
      raise exception 'Only % spot(s) left — please lower your party size.', v_ev.signup_capacity - v_taken using errcode = 'P0001';
    end if;
  end if;

  insert into public.event_signups (event_id, name, email, phone, party_size, notes, client_ip)
  values (p_event_id, v_name, v_email, v_phone, p_party, v_notes, v_ip)
  returning id into v_id;
  return v_id;
end;
$$;

-- Tell everyone signed up when an event is cancelled. Not when a restore puts the rows back.
create or replace function public.event_cancel_email_trigger()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_url text;
  v_key text;
begin
  if current_setting('app.restoring', true) = 'on' then return new; end if;
  if new.cancelled_at is null or old.cancelled_at is not null then return new; end if;
  if not exists (select 1 from public.event_signups where event_id = new.id) then return new; end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'weekly_email_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'weekly_email_secret';
  if v_url is null or v_key is null then
    raise warning 'event cancellation emails need the weekly_email_url / weekly_email_secret Vault secrets';
    return new;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_key),
    body := jsonb_build_object('mode', 'event_cancelled', 'event_id', new.id),
    timeout_milliseconds := 60000
  );
  return new;
exception when others then
  raise warning 'event cancellation email not queued: %', sqlerrm;
  return new;
end;
$$;
revoke execute on function public.event_cancel_email_trigger() from public, anon, authenticated;

create trigger events_cancel_email after update of cancelled_at on public.events
  for each row execute function public.event_cancel_email_trigger();

-- Hourly (at :20): an event that starts within the next 24 hours, has the reminder on, is not cancelled and has signups
-- gets its reminder, once. Only between 8am and 8pm shop time, so nobody is emailed in the night; an event the
-- reminder window opens for after dark is picked up the next morning, if it hasn't started.
create or replace function public.event_reminder_tick()
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare
  s     public.settings;
  v_hr  int;
  v_url text;
  v_key text;
  e     record;
begin
  select * into s from public.settings where id = 1;
  if s.id is null then return; end if;
  v_hr := extract(hour from (now() at time zone coalesce(s.timezone, 'America/New_York')))::int;
  if v_hr < 8 or v_hr >= 20 then return; end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'weekly_email_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'weekly_email_secret';

  for e in
    select ev.id from public.events ev
    where ev.send_reminder and ev.cancelled_at is null and ev.reminder_sent_at is null
      and ev.starts_at > now() and ev.starts_at <= now() + interval '24 hours'
      and exists (select 1 from public.event_signups x where x.event_id = ev.id)
  loop
    if v_url is null or v_key is null then
      raise warning 'event reminders need the weekly_email_url / weekly_email_secret Vault secrets';
      return;
    end if;
    update public.events set reminder_sent_at = now() where id = e.id;
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_key),
      body := jsonb_build_object('mode', 'event_reminder', 'event_id', e.id),
      timeout_milliseconds := 60000
    );
  end loop;
end;
$$;
revoke execute on function public.event_reminder_tick() from public, anon, authenticated;

select cron.schedule('event-reminder', '20 * * * *', 'select public.event_reminder_tick()');
