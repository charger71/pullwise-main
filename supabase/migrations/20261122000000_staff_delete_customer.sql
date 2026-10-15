-- Staff can delete a customer completely: the record, their pull list and orders,
-- follows, notes and change log, and their login (so they can't sign back in to an
-- empty account). Staff logins are never deleted, and a customer who is also staff
-- keeps their login.
--
-- Cascades already cover pull_list, subscriptions, customer_notes and pull_list_log.
-- reservation_orders only null out customer_id, so those are deleted explicitly
-- (their reservation lines cascade), which also frees any held copies.

create or replace function public.staff_delete_customer(p_id bigint)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid;
begin
  if not public.is_staff() then
    raise exception 'Staff only.' using errcode = '42501';
  end if;

  select user_id into v_user from public.customers where id = p_id;
  if not found then
    raise exception 'That customer no longer exists.' using errcode = 'P0001';
  end if;

  delete from public.reservation_orders where customer_id = p_id;
  delete from public.customers where id = p_id;

  if v_user is not null and not exists (select 1 from public.staff where user_id = v_user) then
    delete from auth.users where id = v_user;
  end if;
end;
$$;
revoke execute on function public.staff_delete_customer(bigint) from public, anon;
grant execute on function public.staff_delete_customer(bigint) to authenticated;
