-- counts_for_order, about twice as fast again (the Reservations screen filters on it for every open line).
--
-- It called is_staff() and then _line_counts(), which looked the order up again inside a SQL function. Now it reads
-- the order once and asks only what that order needs: a customer's standing and the line's cap flag, or for a guest
-- order the verification rules. Same answers as _line_counts (which staff_set_line_status and the guest checks still
-- use): checked on three shops against every line, with paused, unapproved and approved customers, cap flags and
-- guest orders set up both with verification on and off. 1,000 lines: 144 -> 85 ms; filtering ~2,000 open lines on
-- it: 340 -> 166 ms.

create or replace function public.counts_for_order(r public.reservations)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  v_order public.reservation_orders;
begin
  if not public.is_staff() then
    return null;
  end if;
  select * into v_order from public.reservation_orders o where o.id = r.order_id;
  if not found then
    return null;
  end if;
  if v_order.customer_id is not null then
    return not exists (
             select 1 from public.customer_standing st
             where st.customer_id = v_order.customer_id
               and (st.account_state = 'unapproved'
                    or (st.paused_at is not null
                        and coalesce((select i.foc_date >= public.shop_today() from public.items i where i.id = r.item_id), true)))
           )
       and not exists (select 1 from public.line_cap_flags f where f.reservation_id = r.id and f.status = 'over_cap');
  end if;
  return not coalesce((select t.verification_enabled from public.trust_settings t where t.id = 1), false)
      or exists (select 1 from public.guest_order_approvals g where g.order_id = v_order.id)
      or exists (
           select 1 from public.customers c join public.customer_standing st on st.customer_id = c.id
           where st.account_state in ('approved', 'proven') and st.paused_at is null
             and ((v_order.email is not null and lower(c.email) = lower(v_order.email))
               or (v_order.phone_digits is not null and c.phone_digits = v_order.phone_digits))
         );
end;
$$;

revoke execute on function public.counts_for_order(public.reservations) from public, anon;
grant execute on function public.counts_for_order(public.reservations) to authenticated;
