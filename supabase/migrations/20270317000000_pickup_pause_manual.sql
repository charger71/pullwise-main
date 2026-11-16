-- Pickup reliability and account trust, phase 2: staff pause, resume and unverify customers by hand, and a pause is
-- enforced on the server whichever way a line arrives. All of it works whichever way the two switches are set.
--
-- What paused means:
--   * no new auto-adds from follows: a follow's new line is skipped quietly (the hourly sweep adds it after a resume
--     if it is still open for pre-order);
--   * no new pre-orders: a customer adding a title, re-ordering, raising a quantity, or a guest checkout under the
--     paused customer's email or phone is refused with a neutral message. Staff can still add lines by hand;
--   * lines whose order cutoff hasn't passed leave the ordering numbers (counts_for_order). Lines past their cutoff,
--     and lines already ordered or received, stay held for the customer.
-- An unapproved account (staff unverified it here; signups arrive with phase 3) never counts toward the ordering
-- numbers, but can still build a list.
--
-- Staff change standing only through the functions below, which log who, from, to and an optional reason
-- (customer_standing_log, written by the trigger from phase 1).

-- ---------------------------------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------------------------------

-- The paused customer behind an order: its own customer, or for a guest order the customer with the same email or
-- phone. Null when nobody behind it is paused.
create or replace function public._paused_customer_for_order(p_order bigint)
returns bigint
language sql stable security definer set search_path = public
as $$
  select st.customer_id
  from public.reservation_orders o
  join public.customers c
    on (o.customer_id is not null and c.id = o.customer_id)
    or (o.customer_id is null and (
          (o.email is not null and lower(c.email) = lower(o.email))
       or (o.phone_digits is not null and c.phone_digits = o.phone_digits)))
  join public.customer_standing st on st.customer_id = c.id
  where o.id = p_order and st.paused_at is not null
  limit 1;
$$;
revoke execute on function public._paused_customer_for_order(bigint) from public, anon, authenticated;

-- Whether a line counts toward the ordering numbers (Place Order, the distributor list and its exports, "Mark
-- ordered", the dashboard). False for an unapproved customer's line, and for a paused customer's line whose cutoff
-- hasn't passed (no cutoff counts as not passed). Readable as a column (reservations?select=…,counts_for_order) by
-- staff only: anyone else gets null, so a customer can't learn their own standing from it.
create or replace function public._line_counts(p_order bigint, p_item bigint)
returns boolean
language sql stable security definer set search_path = public
as $$
  select not exists (
    select 1
    from public.reservation_orders o
    join public.customer_standing st on st.customer_id = o.customer_id
    join public.items i on i.id = p_item
    where o.id = p_order
      and (st.account_state = 'unapproved'
           or (st.paused_at is not null and (i.foc_date is null or i.foc_date >= public.shop_today())))
  );
$$;
create or replace function public.counts_for_order(r public.reservations)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case when not public.is_staff() then null else public._line_counts(r.order_id, r.item_id) end;
$$;

revoke execute on function public._line_counts(bigint, bigint) from public, anon, authenticated;
revoke execute on function public.counts_for_order(public.reservations) from public, anon;
grant execute on function public.counts_for_order(public.reservations) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- The pause, enforced on every new line
-- ---------------------------------------------------------------------------------------------------------------------

-- A line becomes new demand when it is added open, set back to open, or its quantity goes up while open.
--   * a follow's line (source series / artist) for a paused customer is skipped quietly, whoever runs the follow;
--   * staff adding or changing a line by hand is allowed;
--   * any other automatic job is skipped quietly;
--   * the customer, or a guest checking out, is refused with a neutral message (nothing about why).
create or replace function public.reservations_pause_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_via  text;
begin
  if new.status <> 'open' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'open' and new.quantity <= old.quantity then
    return new;
  end if;
  if public._paused_customer_for_order(new.order_id) is null then
    return new;
  end if;

  if new.source in ('series', 'artist') and (tg_op = 'INSERT' or old.status <> 'open') then
    return null;
  end if;
  v_via := case
    when v_uid is not null and public.is_staff() then 'staff'
    when v_uid is not null then 'customer'
    when coalesce(auth.role(), '') = 'anon' then 'guest'
    else 'system'
  end;
  if v_via = 'staff' then
    return new;
  end if;
  if v_via = 'system' then
    return null;
  end if;
  if v_via = 'guest' then
    raise exception 'We can’t take new pre-orders under these contact details right now. Please contact the shop.' using errcode = 'P0001';
  end if;
  raise exception 'Your pull list is on hold right now, so new titles can’t be added. Please contact the shop.' using errcode = 'P0001';
end;
$$;
create trigger reservations_pause_guard before insert or update of status, quantity on public.reservations
  for each row execute function public.reservations_pause_guard();

-- ---------------------------------------------------------------------------------------------------------------------
-- "Mark ordered" never orders a line that doesn't count, even from a list loaded before the customer was paused
-- ---------------------------------------------------------------------------------------------------------------------

-- Same as 20270113000000_admin_audit_fixes.sql, plus: moving open lines to Ordered skips lines that don't count.
create or replace function public.staff_set_line_status(p_ids bigint[], p_status public.reservation_status, p_from public.reservation_status[] default null)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_n int;
begin
  if not public.is_staff() then raise exception 'Staff only.' using errcode = '42501'; end if;
  with old as (
    -- Locking re-checks the status against the latest row, so a line changed meanwhile is left alone.
    select r.id, r.status from public.reservations r
    where r.id = any (p_ids) and r.status <> p_status and (p_from is null or r.status = any (p_from))
      and not (p_status = 'ordered' and r.status = 'open' and not public._line_counts(r.order_id, r.item_id))
    order by r.id
    for update
  ), done as (
    update public.reservations r
    set status = p_status, arrived_on = case when p_status = 'arrived' then public.shop_today() else r.arrived_on end
    from old where r.id = old.id
    returning r.id, r.order_id, r.item_id, old.status as was
  ), logged as (
    insert into public.pull_list_log (customer_id, reservation_id, action, detail)
    select o.customer_id, d.id, 'status',
           i.title || coalesce(' #' || nullif(i.issue_number, ''), '') || coalesce(' · ' || nullif(i.variant, ''), '')
           || ': ' || public._line_status_label(d.was) || ' → ' || public._line_status_label(p_status)
    from done d
    join public.reservation_orders o on o.id = d.order_id
    join public.items i on i.id = d.item_id
    where o.customer_id is not null
  )
  select count(*) into v_n from done;
  return v_n;
end;
$$;
revoke execute on function public.staff_set_line_status(bigint[], public.reservation_status, public.reservation_status[]) from public, anon;
grant execute on function public.staff_set_line_status(bigint[], public.reservation_status, public.reservation_status[]) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Staff controls
-- ---------------------------------------------------------------------------------------------------------------------

-- The customer's standing row, created if missing (a restored customer from an older backup has none), locked.
create or replace function public._standing_for_update(p_customer bigint)
returns public.customer_standing
language plpgsql security definer set search_path = public
as $$
declare
  v public.customer_standing;
begin
  if not exists (select 1 from public.customers where id = p_customer) then
    raise exception 'That customer no longer exists.' using errcode = 'P0001';
  end if;
  insert into public.customer_standing (customer_id) values (p_customer) on conflict (customer_id) do nothing;
  select * into v from public.customer_standing where customer_id = p_customer for update;
  return v;
end;
$$;
revoke execute on function public._standing_for_update(bigint) from public, anon, authenticated;

create or replace function public._require_staff()
returns void
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Staff only.' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function public._require_staff() from public, anon, authenticated;

-- Pause by hand (an automatic pause becomes a manual one, so it no longer lifts on its own).
create or replace function public.staff_pause_customer(p_customer bigint, p_reason text default null)
returns public.customer_standing
language plpgsql security definer set search_path = public
as $$
declare
  v public.customer_standing;
begin
  perform public._require_staff();
  v := public._standing_for_update(p_customer);
  if v.paused_reason = 'manual' then
    return v;
  end if;
  perform set_config('pullwise.standing_reason', left(nullif(trim(p_reason), ''), 500), true);
  update public.customer_standing
  set paused_at = coalesce(paused_at, now()), paused_reason = 'manual', paused_by = auth.uid()
  where customer_id = p_customer
  returning * into v;
  return v;
end;
$$;

-- Resume, whatever paused them.
create or replace function public.staff_resume_customer(p_customer bigint, p_reason text default null)
returns public.customer_standing
language plpgsql security definer set search_path = public
as $$
declare
  v public.customer_standing;
begin
  perform public._require_staff();
  v := public._standing_for_update(p_customer);
  if v.paused_at is null then
    return v;
  end if;
  perform set_config('pullwise.standing_reason', left(nullif(trim(p_reason), ''), 500), true);
  update public.customer_standing
  set paused_at = null, paused_reason = null, paused_by = null
  where customer_id = p_customer
  returning * into v;
  return v;
end;
$$;

-- Set the account state by hand: 'unapproved' (unverify; recorded as a staff decision), 'approved' or 'proven'.
create or replace function public.staff_set_account_state(p_customer bigint, p_state public.account_state, p_reason text default null)
returns public.customer_standing
language plpgsql security definer set search_path = public
as $$
declare
  v public.customer_standing;
begin
  perform public._require_staff();
  if p_state is null then
    raise exception 'Choose an account state.' using errcode = 'P0001';
  end if;
  v := public._standing_for_update(p_customer);
  if v.account_state = p_state and (p_state <> 'unapproved' or v.unapproved_reason = 'staff') then
    return v;
  end if;
  perform set_config('pullwise.standing_reason', left(nullif(trim(p_reason), ''), 500), true);
  update public.customer_standing
  set account_state = p_state, unapproved_reason = case when p_state = 'unapproved' then 'staff' end
  where customer_id = p_customer
  returning * into v;
  return v;
end;
$$;

revoke execute on function public.staff_pause_customer(bigint, text) from public, anon;
revoke execute on function public.staff_resume_customer(bigint, text) from public, anon;
revoke execute on function public.staff_set_account_state(bigint, public.account_state, text) from public, anon;
grant execute on function public.staff_pause_customer(bigint, text) to authenticated;
grant execute on function public.staff_resume_customer(bigint, text) to authenticated;
grant execute on function public.staff_set_account_state(bigint, public.account_state, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- What the customer sees: a neutral notice and nothing more
-- ---------------------------------------------------------------------------------------------------------------------

-- 'on_hold' while the signed-in customer is paused, else null. No state, reason, dates or numbers.
create or replace function public.my_account_notice()
returns text
language sql stable security definer set search_path = public
as $$
  select case when st.paused_at is not null then 'on_hold' end
  from public.customers c
  join public.customer_standing st on st.customer_id = c.id
  where c.user_id = auth.uid();
$$;
revoke execute on function public.my_account_notice() from public, anon;
grant execute on function public.my_account_notice() to authenticated;
