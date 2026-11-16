-- Pickup reliability and account trust, phase 1: the schema, the shop's settings, and what staff can see
-- (the unclaimed report and the indicator on the customer lookup). Nothing here pauses anyone or sends anything yet.
--
--   trust_settings          the shop's settings for this feature (one row). Staff read it; only an owner changes it.
--                           It is its own table because `settings` can be read by anyone (the public site reads it).
--   trust_settings_log      every change to those settings: which, from, to, who, when.
--   customer_standing       one row per customer: account state, pause, pickup cadence, and what the ladder has sent.
--                           Staff read it; nobody writes it directly (staff go through functions in later phases).
--                           Customers can't read it at all, so no reliability data ever reaches them.
--   customer_standing_log   every change to a customer's state, pause or cadence: from, to, who, when.
--   reservations.picked_up_at  when a line was picked up (stamped by a trigger, whichever way the status changes).
--
-- "Unclaimed" is a line that has been received (status 'arrived', the staff word "Ready") and not picked up. Its clock
-- starts on the received date (arrived_on) and follows the oldest unclaimed line, so a partial pickup moves the clock
-- to the next-oldest line. The ladder clock never starts before trust_settings.reliability_started_at (the launch
-- floor); reports show the true age.
--
-- Money is integer cents: a copy is valued at items.price (the shop's price) in cents, times the quantity.

-- ---------------------------------------------------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------------------------------------------------

create table public.trust_settings (
  id                        smallint primary key default 1 check (id = 1),
  -- "Pause pulls for unclaimed books": the automatic warning / pause ladder.
  pickup_pause_enabled      boolean  not null default true,
  -- "Verify new accounts": new signups wait for staff approval, then a weekly cap until their first pickup.
  verification_enabled      boolean  not null default true,
  -- Weekly cap for approved (not yet proven) accounts, per order cutoff week. Null or 0 means no cap.
  unproven_weekly_cap_cents integer  default 4000 check (unproven_weekly_cap_cents is null or unproven_weekly_cap_cents between 0 and 100000000),
  -- Ladder days, counted from the oldest unclaimed line's received date.
  warning_days              smallint not null default 7  check (warning_days between 1 and 365),
  pause_days                smallint not null default 14 check (pause_days between 1 and 365),
  monthly_warning_days      smallint not null default 21 check (monthly_warning_days between 1 and 365),
  monthly_pause_days        smallint not null default 35 check (monthly_pause_days between 1 and 365),
  auto_resume_on_pickup     boolean  not null default true,
  -- Launch floor: lines received before this date count as received on it, for the ladder only.
  reliability_started_at    date     not null default public.shop_today(),
  updated_at                timestamptz not null default now(),
  updated_by                uuid references auth.users (id) on delete set null,
  constraint trust_settings_weekly_order  check (warning_days < pause_days),
  constraint trust_settings_monthly_order check (monthly_warning_days < monthly_pause_days)
);
comment on table public.trust_settings is 'Pickup reliability and account trust settings (one row). Staff read; owners change.';

insert into public.trust_settings (id) values (1) on conflict (id) do nothing;

alter table public.trust_settings enable row level security;
create policy "staff read trust_settings"  on public.trust_settings for select using (public.is_staff());
create policy "owner update trust_settings" on public.trust_settings for update using (public.is_owner()) with check (public.is_owner());
revoke all on public.trust_settings from anon, authenticated;
grant select on public.trust_settings to authenticated;
grant update (pickup_pause_enabled, verification_enabled, unproven_weekly_cap_cents, warning_days, pause_days,
              monthly_warning_days, monthly_pause_days, auto_resume_on_pickup, reliability_started_at)
  on public.trust_settings to authenticated;

create table public.trust_settings_log (
  id         bigint generated always as identity primary key,
  setting    text not null,
  from_value text,
  to_value   text,
  user_id    uuid references auth.users (id) on delete set null,
  staff_name text,
  created_at timestamptz not null default now()
);
create index trust_settings_log_created_idx on public.trust_settings_log (created_at desc);
alter table public.trust_settings_log enable row level security;
create policy "staff read trust_settings_log" on public.trust_settings_log for select using (public.is_staff());
revoke all on public.trust_settings_log from anon, authenticated;
grant select on public.trust_settings_log to authenticated;

-- Who is acting, for the logs: the staff member's name, or null for a scheduled job / the SQL editor.
create or replace function public._actor_name()
returns text
language sql stable security definer set search_path = public
as $$
  select name from public.staff where user_id = auth.uid();
$$;
revoke execute on function public._actor_name() from public, anon, authenticated;

-- Turning the ladder on starts every clock fresh: the launch floor moves to today, so nobody is warned or paused for
-- books that were waiting before the switch went on.
create or replace function public.trust_settings_before_update()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.pickup_pause_enabled and not old.pickup_pause_enabled then
    new.reliability_started_at := public.shop_today();
  end if;
  new.id := 1;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
create trigger trust_settings_before_update before update on public.trust_settings
  for each row execute function public.trust_settings_before_update();

create or replace function public.trust_settings_log_changes()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.trust_settings_log (setting, from_value, to_value, user_id, staff_name)
  select e.key, to_jsonb(old) ->> e.key, e.value #>> '{}', auth.uid(), public._actor_name()
  from jsonb_each(to_jsonb(new)) e
  where e.key not in ('id', 'updated_at', 'updated_by')
    and (to_jsonb(old) -> e.key) is distinct from e.value;
  return null;
end;
$$;
create trigger trust_settings_log_changes after update on public.trust_settings
  for each row execute function public.trust_settings_log_changes();

-- ---------------------------------------------------------------------------------------------------------------------
-- Customer standing
-- ---------------------------------------------------------------------------------------------------------------------

create type public.account_state as enum ('unapproved', 'approved', 'proven');

create table public.customer_standing (
  customer_id       bigint primary key references public.customers (id) on delete cascade,
  account_state     public.account_state not null default 'proven',
  -- Why an account is unapproved: it signed up while verification was on, or a staff member unverified it.
  unapproved_reason text check (unapproved_reason in ('signup', 'staff')),
  state_changed_at  timestamptz not null default now(),
  -- Paused: no new auto-adds or pre-orders, and lines before the cutoff leave the ordering numbers.
  paused_at         timestamptz,
  paused_reason     text check (paused_reason in ('auto', 'manual')),
  paused_by         uuid references auth.users (id) on delete set null,
  -- How long this customer usually takes to pick up: weekly or monthly day counts, or never laddered.
  pickup_cadence    text not null default 'weekly' check (pickup_cadence in ('weekly', 'monthly', 'exempt')),
  -- What the ladder has sent in the current unclaimed streak (cleared when nothing is left unclaimed).
  warning_sent_at   timestamptz,
  pause_sent_at     timestamptz,
  created_at        timestamptz not null default now(),
  constraint customer_standing_reason_chk check ((account_state = 'unapproved') = (unapproved_reason is not null)),
  constraint customer_standing_pause_chk  check ((paused_at is null) = (paused_reason is null))
);
create index customer_standing_paused_idx on public.customer_standing (paused_at) where paused_at is not null;
create index customer_standing_state_idx  on public.customer_standing (account_state) where account_state <> 'proven';

alter table public.customer_standing enable row level security;
create policy "staff read customer_standing" on public.customer_standing for select using (public.is_staff());
revoke all on public.customer_standing from anon, authenticated;
grant select on public.customer_standing to authenticated;

create table public.customer_standing_log (
  id          bigint generated always as identity primary key,
  customer_id bigint not null references public.customers (id) on delete cascade,
  field       text not null check (field in ('account_state', 'paused', 'pickup_cadence')),
  from_value  text,
  to_value    text,
  reason      text,
  user_id     uuid references auth.users (id) on delete set null,
  staff_name  text,
  created_at  timestamptz not null default now()
);
create index customer_standing_log_customer_idx on public.customer_standing_log (customer_id, created_at desc);
alter table public.customer_standing_log enable row level security;
create policy "staff read customer_standing_log" on public.customer_standing_log for select using (public.is_staff());
revoke all on public.customer_standing_log from anon, authenticated;
grant select on public.customer_standing_log to authenticated;

-- Every change is logged here, whichever function made it. A function that wants a reason on the log entry sets
-- `pullwise.standing_reason` for the transaction (set_config(..., true)) before it updates the row.
create or replace function public.customer_standing_log_changes()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_name   text := public._actor_name();
  v_reason text := nullif(current_setting('pullwise.standing_reason', true), '');
begin
  if new.account_state is distinct from old.account_state or new.unapproved_reason is distinct from old.unapproved_reason then
    insert into public.customer_standing_log (customer_id, field, from_value, to_value, reason, user_id, staff_name)
    values (new.customer_id, 'account_state',
            old.account_state::text || coalesce(' (' || old.unapproved_reason || ')', ''),
            new.account_state::text || coalesce(' (' || new.unapproved_reason || ')', ''), v_reason, v_uid, v_name);
  end if;
  if (new.paused_at is null) is distinct from (old.paused_at is null) or new.paused_reason is distinct from old.paused_reason then
    insert into public.customer_standing_log (customer_id, field, from_value, to_value, reason, user_id, staff_name)
    values (new.customer_id, 'paused',
            case when old.paused_at is null then 'active' else 'paused (' || old.paused_reason || ')' end,
            case when new.paused_at is null then 'active' else 'paused (' || new.paused_reason || ')' end, v_reason, v_uid, v_name);
  end if;
  if new.pickup_cadence is distinct from old.pickup_cadence then
    insert into public.customer_standing_log (customer_id, field, from_value, to_value, reason, user_id, staff_name)
    values (new.customer_id, 'pickup_cadence', old.pickup_cadence, new.pickup_cadence, v_reason, v_uid, v_name);
  end if;
  return null;
end;
$$;
create trigger customer_standing_log_changes after update on public.customer_standing
  for each row execute function public.customer_standing_log_changes();

create or replace function public.customer_standing_touch()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.account_state is distinct from old.account_state then
    new.state_changed_at := now();
  end if;
  return new;
end;
$$;
create trigger customer_standing_touch before update on public.customer_standing
  for each row execute function public.customer_standing_touch();

-- Every customer gets a standing row when it is created. Phase 1: everyone starts proven (account verification
-- arrives with the approval queue). Customers whose books are shipped start exempt from the pickup ladder.
create or replace function public.customers_create_standing()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- A restore brings its own standing rows (and an older backup without them leaves the defaults: proven, weekly).
  if current_setting('app.restoring', true) = 'on' then
    return null;
  end if;
  insert into public.customer_standing (customer_id, pickup_cadence)
  values (new.id, case when new.ship_arrivals then 'exempt' else 'weekly' end)
  on conflict (customer_id) do nothing;
  return null;
end;
$$;
create trigger customers_create_standing after insert on public.customers
  for each row execute function public.customers_create_standing();

-- Existing customers: all proven, so nobody is held back by the launch.
insert into public.customer_standing (customer_id, pickup_cadence)
select id, case when ship_arrivals then 'exempt' else 'weekly' end from public.customers
on conflict (customer_id) do nothing;

-- ---------------------------------------------------------------------------------------------------------------------
-- When a line was picked up
-- ---------------------------------------------------------------------------------------------------------------------

alter table public.reservations add column picked_up_at timestamptz;

-- Lines already picked up: the last change to the line is the best date there is (the same stand-in the analytics use).
update public.reservations set picked_up_at = updated_at where status = 'picked_up';

create or replace function public.reservations_pickup_stamp()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.status is distinct from 'picked_up' then
    new.picked_up_at := null;
  elsif tg_op = 'INSERT' then
    new.picked_up_at := coalesce(new.picked_up_at, now());  -- a restore keeps the date it brings
  elsif old.status is distinct from 'picked_up' then
    new.picked_up_at := now();
  else
    new.picked_up_at := coalesce(new.picked_up_at, old.picked_up_at);
  end if;
  return new;
end;
$$;
create trigger reservations_pickup_stamp before insert or update of status, picked_up_at on public.reservations
  for each row execute function public.reservations_pickup_stamp();

create index reservations_unclaimed_idx on public.reservations (order_id, arrived_on) where status = 'arrived';

-- ---------------------------------------------------------------------------------------------------------------------
-- Unclaimed lines and the ladder
-- ---------------------------------------------------------------------------------------------------------------------

-- A copy's price in cents (what the customer pays: the shop's price for the title). No price counts as 0.
create or replace function public.price_cents(p numeric)
returns bigint
language sql immutable
as $$
  select coalesce(round(p * 100), 0)::bigint;
$$;

-- One row per customer with anything received and not picked up. Not readable from the browser: staff read it
-- through staff_pickup_summary(), and the scheduled ladder (a later phase) reads it directly.
create or replace view public.customer_unclaimed as
select o.customer_id,
       count(*)::int                                          as unclaimed_count,
       sum(r.quantity)::int                                   as unclaimed_copies,
       sum(public.price_cents(i.price) * r.quantity)::bigint  as unclaimed_cents,
       min(coalesce(r.arrived_on, r.updated_at::date))        as oldest_received_on
from public.reservations r
join public.reservation_orders o on o.id = r.order_id
join public.items i on i.id = r.item_id
where r.status = 'arrived' and o.customer_id is not null
group by o.customer_id;
revoke all on public.customer_unclaimed from public, anon, authenticated;

-- The ladder's dates for a streak whose oldest unclaimed line was received on `p_oldest`: the clock starts on that
-- date, or on the launch floor when the line came in earlier. Day counts come from trust_settings as they are now.
-- Exempt customers (and no unclaimed line) get no dates. Whether the ladder runs at all is the job's check
-- (pickup_pause_enabled), not this function's.
create or replace function public.pickup_ladder_dates(p_oldest date, p_cadence text,
  out clock_start date, out warning_on date, out pause_on date)
language sql stable security definer set search_path = public
as $$
  select st.start,
         st.start + case when p_cadence = 'monthly' then s.monthly_warning_days else s.warning_days end,
         st.start + case when p_cadence = 'monthly' then s.monthly_pause_days   else s.pause_days   end
  from public.trust_settings s
  cross join lateral (select greatest(p_oldest, s.reliability_started_at) as start) st
  where s.id = 1 and p_oldest is not null and p_cadence in ('weekly', 'monthly');
$$;
revoke execute on function public.pickup_ladder_dates(date, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- What staff see: the indicator on the customer lookup, and the unclaimed report
-- ---------------------------------------------------------------------------------------------------------------------

-- p_ids: these customers (the lookup), whether or not they have anything unclaimed. Null: every customer with
-- something unclaimed (the report). Ages are true ages in shop days; the ladder dates honour the launch floor.
create or replace function public.staff_pickup_summary(p_ids bigint[] default null)
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
  last_pickup_at     timestamptz
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
         lp.last_pickup_at
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
