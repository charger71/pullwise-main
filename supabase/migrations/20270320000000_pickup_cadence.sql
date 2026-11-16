-- Pickup reliability and account trust, phase 5: staff set each customer's pickup cadence.
--
--   weekly   the weekly reminder / pause days (trust_settings.warning_days / pause_days)
--   monthly  the monthly ones (monthly_warning_days / monthly_pause_days), for customers who come in once a month
--   exempt   never reminded or paused automatically (customers whose books are shipped start here, phase 1)
--
-- Works whichever way the switches are set, and every change is logged (customer_standing_log, with an optional
-- reason). A change takes effect on the ladder at once:
--   * to exempt: an automatic pause lifts;
--   * to a cadence whose pause day hasn't come yet for the current streak: an automatic pause lifts, and the ladder
--     pauses again (with its email) only if the new pause day is reached. A reminder already sent isn't sent again.
-- A pause staff made by hand is never changed by a cadence change.

create or replace function public.staff_set_cadence(p_customer bigint, p_cadence text, p_reason text default null)
returns public.customer_standing
language plpgsql security definer set search_path = public
as $$
declare
  v public.customer_standing;
  u public.customer_unclaimed;
  d record;
begin
  perform public._require_staff();
  if p_cadence is null or p_cadence not in ('weekly', 'monthly', 'exempt') then
    raise exception 'Choose weekly, monthly or exempt.' using errcode = 'P0001';
  end if;
  v := public._standing_for_update(p_customer);
  if v.pickup_cadence = p_cadence then
    return v;
  end if;
  perform set_config('pullwise.standing_reason', left(nullif(trim(p_reason), ''), 500), true);
  update public.customer_standing set pickup_cadence = p_cadence where customer_id = p_customer returning * into v;

  if v.paused_reason = 'auto' then
    select * into u from public.customer_unclaimed where customer_id = p_customer;
    select * into d from public.pickup_ladder_dates(u.oldest_received_on, p_cadence);
    if p_cadence = 'exempt' or d.pause_on is null or public.shop_today() < d.pause_on then
      perform set_config('pullwise.standing_reason',
        coalesce(left(nullif(trim(p_reason), ''), 400) || ' · ', '') || 'Pickup cadence changed to ' || p_cadence, true);
      update public.customer_standing
      set paused_at = null, paused_reason = null, paused_by = null, pause_sent_at = null
      where customer_id = p_customer
      returning * into v;
    end if;
  end if;
  perform set_config('pullwise.standing_reason', '', true);
  return v;
end;
$$;
revoke execute on function public.staff_set_cadence(bigint, text, text) from public, anon;
grant execute on function public.staff_set_cadence(bigint, text, text) to authenticated;
