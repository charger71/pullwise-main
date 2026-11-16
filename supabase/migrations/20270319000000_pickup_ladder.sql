-- Pickup reliability and account trust, phase 4: the automatic ladder ("Pause pulls for unclaimed books",
-- trust_settings.pickup_pause_enabled), its emails, auto-resume, and what the switch does when it is flipped.
--
--   Warning day  a friendly "your books are waiting" email: what's waiting, the total, and the pause date.
--   Pause day    the pull list is paused (paused_reason 'auto', flagged for staff on Customers → Unclaimed) and a
--                second email says so.
-- Day counts come from trust_settings for the customer's cadence (weekly, monthly; exempt customers are never
-- laddered), counted from the oldest unclaimed line's received date, or the launch floor if that is later
-- (pickup_ladder_dates, phase 1). Each stage happens once per unclaimed streak (customer_standing.warning_sent_at /
-- pause_sent_at); a streak ends when nothing is left unclaimed. A customer already paused (by staff) isn't laddered.
--
-- The hourly job pickup_ladder_tick() checks the switch before it does anything. It decides and pauses at any hour,
-- and queues the emails in pickup_notices (which is also the log of what was sent); the Edge Function
-- weekly-pull-list (mode "pickup_notices") sends them within the shop's email hours and checks the switch again.
-- The emails are transactional: they go out whatever the customer's weekly / arrival email preferences.
--
-- Auto-resume: when nothing is left unclaimed (picked up, or released by staff), an automatic pause lifts if
-- auto_resume_on_pickup is on. A pause staff made by hand stays until staff resume it.
-- Switch off: no emails and no automatic pauses; customers paused automatically are resumed; queued emails are
-- dropped. Switch on: the launch floor moves to today (phase 1) and every streak starts fresh.

-- ---------------------------------------------------------------------------------------------------------------------
-- The emails' words, editable in Shop Settings → Pickups & Accounts
-- ---------------------------------------------------------------------------------------------------------------------
-- Placeholders: {first_name} {shop_name} {count} (e.g. "3 books") {total} (e.g. "$12.48") {days} (days the oldest
-- book has waited) {pause_date} (warning only). The list of books and the shop's hours are added below the intro.

alter table public.trust_settings
  add column pickup_warning_subject text not null default 'Your books are waiting at {shop_name}'
    check (length(pickup_warning_subject) between 1 and 200),
  add column pickup_warning_intro   text not null default 'Good news: your books are waiting for you! You have {count} ready to pick up, {total} in all. Please come by before {pause_date} so we can keep your pull list going.'
    check (length(pickup_warning_intro) between 1 and 2000),
  add column pickup_pause_subject   text not null default 'Your pull list at {shop_name} is on hold'
    check (length(pickup_pause_subject) between 1 and 200),
  add column pickup_pause_intro     text not null default 'Your books are still waiting for you ({count}, {total} in all), so we’ve put your pull list on hold for now. Come by to pick them up and we’ll get it going again. Questions? Just reply to this email.'
    check (length(pickup_pause_intro) between 1 and 2000);
grant update (pickup_warning_subject, pickup_warning_intro, pickup_pause_subject, pickup_pause_intro) on public.trust_settings to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- The queue (and log) of ladder emails
-- ---------------------------------------------------------------------------------------------------------------------

create table public.pickup_notices (
  id                 bigint generated always as identity primary key,
  customer_id        bigint not null references public.customers (id) on delete cascade,
  stage              text not null check (stage in ('warning', 'pause')),
  status             text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  unclaimed_count    int not null,
  unclaimed_cents    bigint not null,
  oldest_received_on date not null,
  pause_on           date,
  attempts           smallint not null default 0,
  error              text,
  created_at         timestamptz not null default now(),
  sent_at            timestamptz
);
create index pickup_notices_queued_idx on public.pickup_notices (created_at) where status in ('queued', 'sending');
create index pickup_notices_customer_idx on public.pickup_notices (customer_id, created_at desc);
alter table public.pickup_notices enable row level security;
create policy "staff read pickup_notices" on public.pickup_notices for select using (public.is_staff());
revoke all on public.pickup_notices from anon, authenticated;
grant select on public.pickup_notices to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- The ladder
-- ---------------------------------------------------------------------------------------------------------------------

-- One pass: warn or pause every customer who has reached a stage they haven't had this streak. Returns how many
-- notices it queued. Does nothing while the switch is off. Safe to run any number of times.
create or replace function public.pickup_ladder_run()
returns int
language plpgsql security definer set search_path = public
as $$
declare
  s     public.trust_settings;
  today date := public.shop_today();
  r     record;
  d     record;
  n     int := 0;
begin
  select * into s from public.trust_settings where id = 1;
  if s.id is null or not s.pickup_pause_enabled then
    return 0;
  end if;

  for r in
    select st.customer_id, st.pickup_cadence, st.warning_sent_at, st.pause_sent_at,
           u.unclaimed_count, u.unclaimed_cents, u.oldest_received_on, c.email
    from public.customer_standing st
    join public.customer_unclaimed u on u.customer_id = st.customer_id
    join public.customers c on c.id = st.customer_id
    where st.pickup_cadence <> 'exempt' and st.paused_at is null and st.pause_sent_at is null
    for update of st
  loop
    select * into d from public.pickup_ladder_dates(r.oldest_received_on, r.pickup_cadence);
    if d.pause_on is not null and today >= d.pause_on then
      perform set_config('pullwise.standing_reason',
        format('Books waiting since %s (%s unclaimed)', to_char(r.oldest_received_on, 'Mon FMDD'), r.unclaimed_count), true);
      update public.customer_standing
      set paused_at = now(), paused_reason = 'auto', paused_by = null,
          pause_sent_at = now(), warning_sent_at = coalesce(warning_sent_at, now())
      where customer_id = r.customer_id;
      perform set_config('pullwise.standing_reason', '', true);
      insert into public.pickup_notices (customer_id, stage, status, unclaimed_count, unclaimed_cents, oldest_received_on, error)
      values (r.customer_id, 'pause', case when r.email is null then 'skipped' else 'queued' end,
              r.unclaimed_count, r.unclaimed_cents, r.oldest_received_on, case when r.email is null then 'No email address' end);
      n := n + 1;
    elsif d.warning_on is not null and today >= d.warning_on and r.warning_sent_at is null then
      update public.customer_standing set warning_sent_at = now() where customer_id = r.customer_id;
      insert into public.pickup_notices (customer_id, stage, status, unclaimed_count, unclaimed_cents, oldest_received_on, pause_on, error)
      values (r.customer_id, 'warning', case when r.email is null then 'skipped' else 'queued' end,
              r.unclaimed_count, r.unclaimed_cents, r.oldest_received_on, d.pause_on, case when r.email is null then 'No email address' end);
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;
revoke execute on function public.pickup_ladder_run() from public, anon, authenticated;

-- Hourly (pg_cron): check the switch, run the ladder, and when emails are waiting and it is inside the shop's email
-- hours (the "your books are in" hours, Admin → Emails), ask the Edge Function to send them.
create or replace function public.pickup_ladder_tick()
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare
  s     public.settings;
  v_hr  int;
  v_url text;
  v_key text;
begin
  if not coalesce((select pickup_pause_enabled from public.trust_settings where id = 1), false) then
    return;
  end if;
  perform public.pickup_ladder_run();

  if not exists (select 1 from public.pickup_notices where status = 'queued') then
    return;
  end if;
  select * into s from public.settings where id = 1;
  v_hr := extract(hour from (now() at time zone coalesce(s.timezone, 'America/New_York')))::int;
  if v_hr < coalesce(s.arrival_email_after_hour, 12) or v_hr >= coalesce(s.arrival_email_before_hour, 20) then
    return;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'weekly_email_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'weekly_email_secret';
  if v_url is null or v_key is null then
    raise warning 'pickup emails are waiting but the weekly_email_url / weekly_email_secret Vault secrets are missing';
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_key),
    body := jsonb_build_object('mode', 'pickup_notices'),
    timeout_milliseconds := 120000
  );
end;
$$;
revoke execute on function public.pickup_ladder_tick() from public, anon, authenticated;

select cron.schedule('pickup-ladder', '20 * * * *', 'select public.pickup_ladder_tick()');

-- ---------------------------------------------------------------------------------------------------------------------
-- A streak ends when nothing is left unclaimed: reset the stages, and lift an automatic pause
-- ---------------------------------------------------------------------------------------------------------------------

create or replace function public.reservations_end_streak()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_resume boolean := coalesce((select auto_resume_on_pickup from public.trust_settings where id = 1), false);
  c        bigint;
begin
  for c in
    select distinct o.customer_id
    from changed_rows x
    join public.reservation_orders o on o.id = x.order_id
    join public.customer_standing st on st.customer_id = o.customer_id
    where (st.warning_sent_at is not null or st.pause_sent_at is not null or st.paused_reason = 'auto')
      and not exists (select 1 from public.customer_unclaimed u where u.customer_id = o.customer_id)
  loop
    if v_resume then
      perform set_config('pullwise.standing_reason', 'Everything waiting was picked up', true);
      update public.customer_standing set paused_at = null, paused_reason = null, paused_by = null
      where customer_id = c and paused_reason = 'auto';
      perform set_config('pullwise.standing_reason', '', true);
    end if;
    update public.customer_standing set warning_sent_at = null, pause_sent_at = null
    where customer_id = c and (warning_sent_at is not null or pause_sent_at is not null);
    -- A warning still waiting to go out is moot now.
    update public.pickup_notices set status = 'skipped', error = 'Picked up before it was sent'
    where customer_id = c and status = 'queued';
  end loop;
  return null;
end;
$$;
create trigger reservations_end_streak_upd after update on public.reservations
  referencing new table as changed_rows for each statement execute function public.reservations_end_streak();
create trigger reservations_end_streak_del after delete on public.reservations
  referencing old table as changed_rows for each statement execute function public.reservations_end_streak();

-- ---------------------------------------------------------------------------------------------------------------------
-- Flipping the switch
-- ---------------------------------------------------------------------------------------------------------------------

create or replace function public.trust_settings_apply_pickup_pause()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if old.pickup_pause_enabled and not new.pickup_pause_enabled then
    -- Off: lift every automatic pause (pauses staff made stay), and send nothing that is still waiting.
    perform set_config('pullwise.standing_reason', 'Pause pulls for unclaimed books turned off', true);
    update public.customer_standing set paused_at = null, paused_reason = null, paused_by = null where paused_reason = 'auto';
    perform set_config('pullwise.standing_reason', '', true);
    update public.pickup_notices set status = 'skipped', error = 'Pause pulls for unclaimed books was turned off' where status = 'queued';
  elsif new.pickup_pause_enabled and not old.pickup_pause_enabled then
    -- On: every clock starts fresh (the launch floor moved to today in the before-update trigger).
    update public.customer_standing set warning_sent_at = null, pause_sent_at = null
    where warning_sent_at is not null or pause_sent_at is not null;
  end if;
  return null;
end;
$$;
create trigger trust_settings_apply_pickup_pause after update on public.trust_settings
  for each row execute function public.trust_settings_apply_pickup_pause();

-- ---------------------------------------------------------------------------------------------------------------------
-- The report and indicator show where each customer is on the ladder
-- ---------------------------------------------------------------------------------------------------------------------

drop function public.staff_pickup_summary(bigint[]);
create function public.staff_pickup_summary(p_ids bigint[] default null)
returns table (
  customer_id        bigint,
  first_name         text,
  last_name          text,
  name               text,
  email              text,
  phone              text,
  account_state      public.account_state,
  unapproved_reason  text,
  paused_at          timestamptz,
  paused_reason      text,
  pickup_cadence     text,
  unclaimed_count    int,
  unclaimed_copies   int,
  unclaimed_cents    bigint,
  oldest_received_on date,
  oldest_age_days    int,
  warning_on         date,
  pause_on           date,
  last_pickup_at     timestamptz,
  warning_sent_at    timestamptz,
  pause_sent_at      timestamptz
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Staff only.' using errcode = '42501';
  end if;
  return query
  select c.id, c.first_name, c.last_name, c.name, c.email, c.phone,
         coalesce(st.account_state, 'proven'::public.account_state), st.unapproved_reason,
         st.paused_at, st.paused_reason, coalesce(st.pickup_cadence, 'weekly'),
         coalesce(u.unclaimed_count, 0), coalesce(u.unclaimed_copies, 0), coalesce(u.unclaimed_cents, 0::bigint),
         u.oldest_received_on, (public.shop_today() - u.oldest_received_on)::int,
         l.warning_on, l.pause_on,
         lp.last_pickup_at,
         st.warning_sent_at, st.pause_sent_at
  from public.customers c
  left join public.customer_standing st on st.customer_id = c.id
  left join public.customer_unclaimed u on u.customer_id = c.id
  left join lateral public.pickup_ladder_dates(u.oldest_received_on, coalesce(st.pickup_cadence, 'weekly')) l on true
  left join lateral (
    select max(r.picked_up_at) as last_pickup_at
    from public.reservations r join public.reservation_orders o on o.id = r.order_id
    where o.customer_id = c.id and r.status = 'picked_up'
  ) lp on true
  where case when p_ids is null then u.customer_id is not null else c.id = any (p_ids) end;
end;
$$;
revoke execute on function public.staff_pickup_summary(bigint[]) from public, anon;
grant execute on function public.staff_pickup_summary(bigint[]) to authenticated;
