-- A pull list now holds up to 1000 active titles per customer (was 300; a customer hit the old cap). Only the size
-- cap in _pull_list_problem changes; the rest is the latest definition (20270114000000_site_audit_fixes.sql), copied as is.
create or replace function public._pull_list_problem(c public.customers, item public.items, qty int, skip_line bigint default null)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  v_title    text := item.title || coalesce(' #' || item.issue_number, '') || coalesce(' (' || item.variant || ')', '');
  v_max      int;
  v_existing int;
  v_email    text;
  v_digits   text;
begin
  if item.id is null or item.status <> 'pre_order' or item.hidden then
    return v_title || ' is no longer open for pre-order.';
  end if;
  if item.foc_date is not null and item.foc_date <= public.reservations_close_through() then
    return 'The order cutoff for ' || v_title || ' has passed.';
  end if;
  if qty is null or qty < 1 then
    return 'Quantity for ' || v_title || ' must be at least 1.';
  end if;
  if c.user_id is not null then
    select nullif(lower(trim(u.email)), '') into v_email
    from auth.users u where u.id = c.user_id and u.email_confirmed_at is not null;
  else
    v_email := nullif(lower(trim(c.email)), '');
    v_digits := c.phone_digits;
  end if;
  select coalesce(max_copies_per_title, 10) into v_max from public.settings where id = 1;
  select coalesce(sum(r.quantity), 0) into v_existing
  from public.reservations r
  join public.reservation_orders o on o.id = r.order_id
  where r.item_id = item.id
    and r.status not in ('cancelled', 'released', 'not_ordered')
    and r.id is distinct from skip_line
    and (o.customer_id = c.id
      or (o.customer_id is null and v_email is not null and lower(o.email) = v_email)
      or (o.customer_id is null and v_digits is not null and o.phone_digits = v_digits));
  if v_existing + qty > v_max then
    return 'Limit is ' || v_max || ' copies per customer for ' || v_title
      || case when v_existing > 0 then ' (you already have ' || v_existing || ' on your list).' else '.' end;
  end if;
  -- Size cap (editing an existing line doesn't add one, so it is exempt).
  if skip_line is null and (
    select count(*) from public.reservations r join public.reservation_orders o on o.id = r.order_id
    where o.customer_id = c.id and r.status in ('open', 'ordered', 'reordered', 'arrived')
  ) >= 1000 then
    return 'Your pull list is full (1000 titles). Please call the shop.';
  end if;
  return null;
end;
$$;
revoke execute on function public._pull_list_problem(public.customers, public.items, int, bigint) from public, anon, authenticated;
