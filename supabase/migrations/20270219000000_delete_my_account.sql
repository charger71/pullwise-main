-- A customer deletes their account from the app or the website's account page (the app stores require it).
--
-- What it does, as the shop decided: the account is disabled, and the shop keeps the customer's contact details.
--   - The login goes (auth.users; customers.user_id is set to null by its foreign key), so no device stays signed in.
--   - Follows go, so no new titles are added for them; titles still just on the list (open, not yet ordered) are
--     cancelled, so the shop doesn't order books for a disabled account.
--   - Push subscriptions, stock alerts and the app's own records (pull_list_seen, app_visits) go.
--   - The weekly pull-list email is turned off. Books already ordered or waiting stay, with the customer's name,
--     email, phone and address, so the shop can still reach them about those; their "your books are in" email
--     still goes out.
--   - The customer's change log says so, for staff.
-- Signing in again with the same email links the kept record to the new login (claim_customer), as for any
-- customer record without a login.

create or replace function public.delete_my_account()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_customer bigint;
  v_cancelled int := 0;
begin
  if v_uid is null then
    raise exception 'Please sign in.' using errcode = '42501';
  end if;

  select id into v_customer from public.customers where user_id = v_uid;

  if v_customer is not null then
    update public.reservations r set status = 'cancelled'
    from public.reservation_orders o
    where r.order_id = o.id and o.customer_id = v_customer and r.status = 'open';
    get diagnostics v_cancelled = row_count;

    delete from public.subscriptions where customer_id = v_customer;
    delete from public.push_subscriptions where customer_id = v_customer;
    delete from public.stock_alerts where customer_id = v_customer;
    delete from public.pull_list_seen where customer_id = v_customer;
    delete from public.app_visits where customer_id = v_customer;
    update public.customers set email_opt_in = false where id = v_customer;

    insert into public.pull_list_log (customer_id, staff_user, action, detail)
    values (v_customer, null, 'account deleted',
            'The customer deleted their account: sign-in, follows and notifications are off'
            || case when v_cancelled > 0 then format(', and %s title(s) not yet ordered were taken off', v_cancelled) else '' end
            || '. Contact details and books already ordered or waiting are kept.');
  end if;

  -- Last: every session of this login ends with it.
  delete from auth.users where id = v_uid;
end;
$$;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
