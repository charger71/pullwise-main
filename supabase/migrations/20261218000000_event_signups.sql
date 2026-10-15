-- Event signups: staff can turn on a signup form for any event, optionally with a spot limit.
-- Guests sign up through event_signup(); only staff can read or remove signups directly.

alter table public.events
  add column signup_enabled  boolean  not null default false,
  add column signup_capacity smallint check (signup_capacity is null or signup_capacity > 0);

create table public.event_signups (
  id         bigint generated always as identity primary key,
  event_id   bigint not null references public.events (id) on delete cascade,
  name       text not null,
  email      text not null,
  phone      text not null,
  party_size smallint not null default 1 check (party_size between 1 and 10),
  notes      text check (length(notes) <= 500),
  client_ip  inet,
  created_at timestamptz not null default now()
);
create index event_signups_event_idx on public.event_signups (event_id);
-- One signup per email per event (people can call to change it).
create unique index event_signups_email_uniq on public.event_signups (event_id, lower(email));

alter table public.event_signups enable row level security;
create policy "staff all event_signups" on public.event_signups for all using (public.is_staff()) with check (public.is_staff());

-- Spots taken so far (people, not signups), for the public form. Null capacity = unlimited.
create or replace function public.event_spots_taken(p_event_id bigint)
returns int
language sql stable security definer set search_path = public
as $$
  select coalesce(sum(party_size), 0)::int from public.event_signups where event_id = p_event_id;
$$;
grant execute on function public.event_spots_taken(bigint) to anon, authenticated;

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
  v_ip    inet;
  v_taken int;
  v_id    bigint;
begin
  if coalesce(p_website, '') <> '' then
    return 0;
  end if;
  if v_name is null then
    raise exception 'Please enter your name.' using errcode = 'P0001';
  end if;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Please enter a valid email address.' using errcode = 'P0001';
  end if;
  if v_phone is null then
    raise exception 'Please enter your phone number.' using errcode = 'P0001';
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
  if coalesce(v_ev.ends_at, v_ev.starts_at) < now() then
    raise exception 'This event has already happened.' using errcode = 'P0001';
  end if;

  begin
    v_ip := split_part(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ',', 1)::inet;
  exception when others then
    v_ip := null;
  end;
  if v_ip is not null and (
    select count(*) from public.event_signups where client_ip = v_ip and created_at > now() - interval '10 minutes'
  ) >= 10 then
    raise exception 'Too many signups from your connection — please try again in a few minutes or call the shop.' using errcode = 'P0001';
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
grant execute on function public.event_signup(bigint, text, text, text, int, text, text) to anon, authenticated;

-- Emails: every new signup tells the customer (confirmation) and the shop (notification). The trigger asks the
-- weekly-pull-list Edge function (mode "event_signup") to send them, using the same Vault secrets as the hourly ticks.
-- A problem here must never block the signup itself, so everything is wrapped and only logs a warning.
create or replace function public.event_signup_email_trigger()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'weekly_email_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'weekly_email_secret';
  if v_url is null or v_key is null then
    raise warning 'event signup emails need the weekly_email_url / weekly_email_secret Vault secrets';
    return new;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_key),
    body := jsonb_build_object('mode', 'event_signup', 'signup_id', new.id),
    timeout_milliseconds := 30000
  );
  return new;
exception when others then
  raise warning 'event signup email not queued: %', sqlerrm;
  return new;
end;
$$;
revoke execute on function public.event_signup_email_trigger() from public, anon, authenticated;

create trigger event_signups_email after insert on public.event_signups
  for each row execute function public.event_signup_email_trigger();
