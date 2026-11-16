-- Pickup reliability and account trust, phase 3: account states and the weekly cap.
--
--   unapproved  a new account that signed up while "Verify new accounts" (trust_settings.verification_enabled) is
--               on, or one staff unverified. It can build a list and pre-order, but nothing counts toward the
--               ordering numbers (phase 2). The customer sees a neutral "waiting for the shop" notice.
--   approved    staff approved it. Its titles count, up to the weekly cap per order cutoff week (Sunday to Saturday
--               week of the title's FOC), at the price the customer pays, auto-adds included, filled in the order
--               the titles were added. A title that doesn't fit is flagged for staff approval (not refused); an
--               approved title counts (and uses up the cap). A cap change applies from the current week on: flags
--               for earlier weeks are left as they were. Titles with no cutoff, and re-orders, are never capped.
--   proven      first pickup (automatic), or staff say so. No cap.
--
-- With verification off: new signups start proven, there is no approval step and no cap. Turning it off promotes
-- signup-unapproved accounts and approved accounts with nothing over the cap to proven; accounts a staff member
-- unverified stay unapproved. Turning it on changes no existing account.
--
-- Guest orders (no account): they count once their email or phone matches an approved or proven customer, or staff
-- approve the order. Orders that existed before this migration, and any placed while verification is off, start
-- approved, so turning verification on never drops orders already taken.
--
-- Staff-created customers (walk-ins, imports, a login later claiming a staff record) are proven: staff vouched.
-- The cap flags and guest approvals are in staff-only tables, so customers never see them.

-- ---------------------------------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------------------------------

create table public.line_cap_flags (
  reservation_id bigint primary key references public.reservations (id) on delete cascade,
  status         text not null check (status in ('over_cap', 'approved')),
  decided_by     uuid references auth.users (id) on delete set null,
  decided_at     timestamptz not null default now()
);
alter table public.line_cap_flags enable row level security;
create policy "staff read line_cap_flags" on public.line_cap_flags for select using (public.is_staff());
revoke all on public.line_cap_flags from anon, authenticated;
grant select on public.line_cap_flags to authenticated;

create table public.guest_order_approvals (
  order_id    bigint primary key references public.reservation_orders (id) on delete cascade,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz not null default now()
);
alter table public.guest_order_approvals enable row level security;
create policy "staff read guest_order_approvals" on public.guest_order_approvals for select using (public.is_staff());
revoke all on public.guest_order_approvals from anon, authenticated;
grant select on public.guest_order_approvals to authenticated;

-- Every guest order taken so far keeps counting.
insert into public.guest_order_approvals (order_id)
select id from public.reservation_orders where customer_id is null
on conflict (order_id) do nothing;

-- A guest order placed while verification is off counts, now and later.
create or replace function public.reservation_orders_auto_approve()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.customer_id is null and not coalesce((select verification_enabled from public.trust_settings where id = 1), false) then
    insert into public.guest_order_approvals (order_id) values (new.id) on conflict (order_id) do nothing;
  end if;
  return null;
end;
$$;
create trigger reservation_orders_auto_approve after insert on public.reservation_orders
  for each row execute function public.reservation_orders_auto_approve();

-- ---------------------------------------------------------------------------------------------------------------------
-- New accounts
-- ---------------------------------------------------------------------------------------------------------------------

-- Same as phase 1, plus: an account the customer created themselves (it has a login) starts unapproved while
-- verification is on. Staff-created customers have no login when they are created, so they start proven.
create or replace function public.customers_create_standing()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_verify boolean := coalesce((select verification_enabled from public.trust_settings where id = 1), false);
begin
  if current_setting('app.restoring', true) = 'on' then
    return null;
  end if;
  insert into public.customer_standing (customer_id, pickup_cadence, account_state, unapproved_reason)
  values (new.id, case when new.ship_arrivals then 'exempt' else 'weekly' end,
          case when new.user_id is not null and v_verify then 'unapproved' else 'proven' end::public.account_state,
          case when new.user_id is not null and v_verify then 'signup' end)
  on conflict (customer_id) do nothing;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- The cap
-- ---------------------------------------------------------------------------------------------------------------------

-- The order cutoff week a title belongs to: the Sunday that starts the week of its FOC.
create or replace function public.foc_week(p_foc date)
returns date
language sql immutable
as $$
  select p_foc - extract(dow from p_foc)::int;
$$;

-- Re-flag one customer's titles for the current and later cutoff weeks. Earlier weeks keep their flags.
create or replace function public._recompute_cap(p_customer bigint)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  s       public.trust_settings;
  v_state public.account_state;
  v_week  date := public.foc_week(public.shop_today());
  v_cur   date;
  v_sum   bigint := 0;
  l       record;
begin
  if p_customer is null then
    return;
  end if;
  select * into s from public.trust_settings where id = 1;
  select account_state into v_state from public.customer_standing where customer_id = p_customer;

  delete from public.line_cap_flags f
  using public.reservations r, public.reservation_orders o, public.items i
  where f.reservation_id = r.id and o.id = r.order_id and i.id = r.item_id
    and o.customer_id = p_customer and f.status = 'over_cap'
    and (i.foc_date is null or public.foc_week(i.foc_date) >= v_week or r.status <> 'open');

  if not coalesce(s.verification_enabled, false) or v_state is distinct from 'approved' or coalesce(s.unproven_weekly_cap_cents, 0) <= 0 then
    return;
  end if;

  for l in
    select r.id, r.status, public.foc_week(i.foc_date) as week, public.price_cents(i.price) * r.quantity as cents,
           exists (select 1 from public.line_cap_flags f where f.reservation_id = r.id and f.status = 'approved') as approved
    from public.reservations r
    join public.reservation_orders o on o.id = r.order_id
    join public.items i on i.id = r.item_id
    where o.customer_id = p_customer and not r.reorder and i.foc_date is not null
      and public.foc_week(i.foc_date) >= v_week
      and r.status in ('open', 'ordered', 'reordered', 'arrived', 'picked_up')
    order by public.foc_week(i.foc_date), r.created_at, r.id
  loop
    if l.week is distinct from v_cur then
      v_cur := l.week;
      v_sum := 0;
    end if;
    if l.status <> 'open' or l.approved or v_sum + l.cents <= s.unproven_weekly_cap_cents then
      v_sum := v_sum + l.cents;
    else
      insert into public.line_cap_flags (reservation_id, status) values (l.id, 'over_cap')
      on conflict (reservation_id) do nothing;
    end if;
  end loop;
end;
$$;
revoke execute on function public._recompute_cap(bigint) from public, anon, authenticated;

-- Re-flag whenever a customer's titles change. Statement-level, so a sweep adding many titles re-flags each
-- customer once.
create or replace function public.reservations_recompute_cap()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  c bigint;
begin
  for c in
    select distinct o.customer_id
    from (select order_id from changed_rows) x
    join public.reservation_orders o on o.id = x.order_id
    join public.customer_standing st on st.customer_id = o.customer_id
    where st.account_state = 'approved'
  loop
    perform public._recompute_cap(c);
  end loop;
  return null;
end;
$$;
create trigger reservations_recompute_cap_ins after insert on public.reservations
  referencing new table as changed_rows for each statement execute function public.reservations_recompute_cap();
create trigger reservations_recompute_cap_upd after update on public.reservations
  referencing new table as changed_rows for each statement execute function public.reservations_recompute_cap();
create trigger reservations_recompute_cap_del after delete on public.reservations
  referencing old table as changed_rows for each statement execute function public.reservations_recompute_cap();

-- ---------------------------------------------------------------------------------------------------------------------
-- What counts toward the ordering numbers (replaces phase 2's rule)
-- ---------------------------------------------------------------------------------------------------------------------

-- A line counts unless: its customer is unapproved; or paused and the cutoff hasn't passed; or the title is
-- flagged over the cap; or it is a guest order that nobody has vouched for while verification is on.
create or replace function public._line_counts(p_order bigint, p_item bigint)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case
    when o.customer_id is not null then
      not exists (
        select 1 from public.customer_standing st, public.items i
        where st.customer_id = o.customer_id and i.id = p_item
          and (st.account_state = 'unapproved'
               or (st.paused_at is not null and (i.foc_date is null or i.foc_date >= public.shop_today())))
      )
      and not exists (
        select 1 from public.reservations r join public.line_cap_flags f on f.reservation_id = r.id
        where r.order_id = p_order and r.item_id = p_item and f.status = 'over_cap'
      )
    else
      not coalesce((select verification_enabled from public.trust_settings where id = 1), false)
      or exists (select 1 from public.guest_order_approvals g where g.order_id = o.id)
      or exists (
        select 1 from public.customers c join public.customer_standing st on st.customer_id = c.id
        where st.account_state in ('approved', 'proven') and st.paused_at is null
          and ((o.email is not null and lower(c.email) = lower(o.email))
            or (o.phone_digits is not null and c.phone_digits = o.phone_digits))
      )
  end
  from public.reservation_orders o
  where o.id = p_order;
$$;
revoke execute on function public._line_counts(bigint, bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- First pickup proves an account
-- ---------------------------------------------------------------------------------------------------------------------

-- Approved accounts, and accounts still waiting from their signup, become proven on their first pickup. An account
-- a staff member unverified stays unapproved until staff decide.
create or replace function public.reservations_prove_on_pickup()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  c bigint;
begin
  for c in
    select distinct o.customer_id
    from changed_rows n
    left join old_rows p on p.id = n.id
    join public.reservation_orders o on o.id = n.order_id
    where n.status = 'picked_up' and p.status is distinct from 'picked_up' and o.customer_id is not null
  loop
    perform set_config('pullwise.standing_reason', 'First pickup', true);
    update public.customer_standing
    set account_state = 'proven', unapproved_reason = null
    where customer_id = c
      and (account_state = 'approved' or (account_state = 'unapproved' and unapproved_reason = 'signup'));
    perform set_config('pullwise.standing_reason', '', true);
  end loop;
  return null;
end;
$$;
create trigger reservations_prove_on_pickup after update on public.reservations
  referencing old table as old_rows new table as changed_rows for each statement execute function public.reservations_prove_on_pickup();

-- ---------------------------------------------------------------------------------------------------------------------
-- State changes re-flag the cap
-- ---------------------------------------------------------------------------------------------------------------------

create or replace function public.customer_standing_recompute_cap()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.account_state is distinct from old.account_state then
    perform public._recompute_cap(new.customer_id);
  end if;
  return null;
end;
$$;
create trigger customer_standing_recompute_cap after update of account_state on public.customer_standing
  for each row execute function public.customer_standing_recompute_cap();

-- ---------------------------------------------------------------------------------------------------------------------
-- The verification switch and the cap setting
-- ---------------------------------------------------------------------------------------------------------------------

-- Turning verification off promotes signup-unapproved accounts, and approved accounts with nothing over the cap,
-- to proven. A cap or switch change re-flags every approved account (flags for earlier weeks stay).
create or replace function public.trust_settings_apply_verification()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  c bigint;
begin
  if old.verification_enabled and not new.verification_enabled then
    perform set_config('pullwise.standing_reason', 'Verify new accounts turned off', true);
    update public.customer_standing st
    set account_state = 'proven', unapproved_reason = null
    where (st.account_state = 'unapproved' and st.unapproved_reason = 'signup')
       or (st.account_state = 'approved' and not exists (
             select 1 from public.line_cap_flags f
             join public.reservations r on r.id = f.reservation_id
             join public.reservation_orders o on o.id = r.order_id
             join public.items i on i.id = r.item_id
             where o.customer_id = st.customer_id and f.status = 'over_cap' and r.status = 'open'
               and i.foc_date is not null and public.foc_week(i.foc_date) >= public.foc_week(public.shop_today())));
    perform set_config('pullwise.standing_reason', '', true);
  end if;
  if new.verification_enabled is distinct from old.verification_enabled
     or new.unproven_weekly_cap_cents is distinct from old.unproven_weekly_cap_cents then
    for c in select customer_id from public.customer_standing where account_state = 'approved' loop
      perform public._recompute_cap(c);
    end loop;
  end if;
  return null;
end;
$$;
create trigger trust_settings_apply_verification after update on public.trust_settings
  for each row execute function public.trust_settings_apply_verification();

-- ---------------------------------------------------------------------------------------------------------------------
-- The approval queue
-- ---------------------------------------------------------------------------------------------------------------------

-- Accounts waiting for approval, with what they have asked for (open titles, copies and value).
create or replace function public.staff_waiting_accounts()
returns table (customer_id bigint, first_name text, last_name text, name text, email text, phone text,
               unapproved_reason text, created_at timestamptz, open_titles int, open_copies int, open_cents bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public._require_staff();
  return query
  select c.id, c.first_name, c.last_name, c.name, c.email, c.phone, st.unapproved_reason, c.created_at,
         count(r.id)::int, coalesce(sum(r.quantity), 0)::int, coalesce(sum(public.price_cents(i.price) * r.quantity), 0)::bigint
  from public.customer_standing st
  join public.customers c on c.id = st.customer_id
  left join public.reservation_orders o on o.customer_id = c.id
  left join public.reservations r on r.order_id = o.id and r.status = 'open'
  left join public.items i on i.id = r.item_id
  where st.account_state = 'unapproved'
  group by c.id, st.unapproved_reason
  order by (st.unapproved_reason = 'signup') desc, c.created_at;
end;
$$;

-- Titles over the weekly cap, waiting for staff: the customer, the title and the week's total so far.
create or replace function public.staff_over_cap_lines()
returns table (reservation_id bigint, customer_id bigint, customer_name text, email text, title text, foc_date date,
               quantity int, line_cents bigint, week_cents bigint, added_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public._require_staff();
  return query
  select r.id, o.customer_id, coalesce(nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), c.name, c.email), c.email,
         i.title || coalesce(' #' || nullif(i.issue_number, ''), '') || coalesce(' · ' || nullif(i.variant, ''), ''),
         i.foc_date, r.quantity::int, public.price_cents(i.price) * r.quantity,
         (select coalesce(sum(public.price_cents(i2.price) * r2.quantity), 0)::bigint
          from public.reservations r2
          join public.reservation_orders o2 on o2.id = r2.order_id
          join public.items i2 on i2.id = r2.item_id
          where o2.customer_id = o.customer_id and not r2.reorder and i2.foc_date is not null
            and public.foc_week(i2.foc_date) = public.foc_week(i.foc_date)
            and r2.status in ('open', 'ordered', 'reordered', 'arrived', 'picked_up')
            and not exists (select 1 from public.line_cap_flags f2 where f2.reservation_id = r2.id and f2.status = 'over_cap')),
         r.created_at
  from public.line_cap_flags f
  join public.reservations r on r.id = f.reservation_id
  join public.reservation_orders o on o.id = r.order_id
  join public.customers c on c.id = o.customer_id
  join public.items i on i.id = r.item_id
  where f.status = 'over_cap' and r.status = 'open'
  order by i.foc_date, c.id, r.created_at;
end;
$$;

-- Guest orders nobody has vouched for yet (only while verification is on; otherwise every guest order counts).
create or replace function public.staff_waiting_guest_orders()
returns table (order_id bigint, name text, email text, phone text, created_at timestamptz, open_titles int, open_copies int, open_cents bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public._require_staff();
  return query
  select o.id, o.name, o.email, o.phone, o.created_at,
         count(r.id)::int, sum(r.quantity)::int, sum(public.price_cents(i.price) * r.quantity)::bigint
  from public.reservation_orders o
  join public.reservations r on r.order_id = o.id and r.status = 'open'
  join public.items i on i.id = r.item_id
  where o.customer_id is null and not public._line_counts(o.id, r.item_id)
  group by o.id
  order by o.created_at;
end;
$$;

-- Approve titles over the cap, one or many. Each approval is noted on the customer's pull list history.
create or replace function public.staff_approve_cap_lines(p_ids bigint[])
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_n int;
  c   bigint;
begin
  perform public._require_staff();
  with done as (
    update public.line_cap_flags f
    set status = 'approved', decided_by = auth.uid(), decided_at = now()
    where f.reservation_id = any (p_ids) and f.status = 'over_cap'
    returning f.reservation_id
  ), logged as (
    insert into public.pull_list_log (customer_id, reservation_id, action, detail)
    select o.customer_id, r.id, 'approved',
           i.title || coalesce(' #' || nullif(i.issue_number, ''), '') || coalesce(' · ' || nullif(i.variant, ''), '')
           || ': approved over the weekly limit'
    from done d
    join public.reservations r on r.id = d.reservation_id
    join public.reservation_orders o on o.id = r.order_id
    join public.items i on i.id = r.item_id
    returning customer_id
  )
  select count(*) into v_n from logged;
  for c in
    select distinct o.customer_id from public.reservations r join public.reservation_orders o on o.id = r.order_id where r.id = any (p_ids)
  loop
    perform public._recompute_cap(c);
  end loop;
  return v_n;
end;
$$;

create or replace function public.staff_approve_guest_order(p_order bigint)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public._require_staff();
  if not exists (select 1 from public.reservation_orders where id = p_order and customer_id is null) then
    raise exception 'That guest order no longer exists, or it now belongs to a customer.' using errcode = 'P0001';
  end if;
  insert into public.guest_order_approvals (order_id, approved_by) values (p_order, auth.uid())
  on conflict (order_id) do nothing;
end;
$$;

revoke execute on function public.staff_waiting_accounts() from public, anon;
revoke execute on function public.staff_over_cap_lines() from public, anon;
revoke execute on function public.staff_waiting_guest_orders() from public, anon;
revoke execute on function public.staff_approve_cap_lines(bigint[]) from public, anon;
revoke execute on function public.staff_approve_guest_order(bigint) from public, anon;
grant execute on function public.staff_waiting_accounts() to authenticated;
grant execute on function public.staff_over_cap_lines() to authenticated;
grant execute on function public.staff_waiting_guest_orders() to authenticated;
grant execute on function public.staff_approve_cap_lines(bigint[]) to authenticated;
grant execute on function public.staff_approve_guest_order(bigint) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- The customer's notice
-- ---------------------------------------------------------------------------------------------------------------------

-- 'on_hold' while paused, 'waiting' while the account waits for approval, else null. Nothing more.
create or replace function public.my_account_notice()
returns text
language sql stable security definer set search_path = public
as $$
  select case when st.paused_at is not null then 'on_hold' when st.account_state = 'unapproved' then 'waiting' end
  from public.customers c
  join public.customer_standing st on st.customer_id = c.id
  where c.user_id = auth.uid();
$$;
revoke execute on function public.my_account_notice() from public, anon;
grant execute on function public.my_account_notice() to authenticated;
