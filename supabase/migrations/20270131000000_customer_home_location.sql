-- A customer picks one home location; their pull list is picked up there.
--
-- New lines follow the customer's home location (whichever way they are added: the customer, staff, or a follow).
-- When the customer changes home location, lines that haven't arrived yet move with them. Lines already on the
-- shelf (arrived) stay where the books are, so the "ready" email names the right store.

create or replace function public.reservations_set_location()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_home bigint;
begin
  select c.home_location_id into v_home
  from public.reservation_orders o join public.customers c on c.id = o.customer_id
  where o.id = new.order_id;
  if v_home is not null then new.location_id := v_home; end if;
  return new;
end;
$$;
create trigger reservations_set_location before insert on public.reservations
  for each row execute function public.reservations_set_location();

create or replace function public.customers_move_open_lines()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  update public.reservations r
     set location_id = new.home_location_id
    from public.reservation_orders o
   where o.id = r.order_id and o.customer_id = new.id
     and r.status in ('open', 'ordered', 'reordered', 'not_ordered')
     and r.location_id is distinct from new.home_location_id;
  return null;
end;
$$;
create trigger customers_move_open_lines after update of home_location_id on public.customers
  for each row when (old.home_location_id is distinct from new.home_location_id and new.home_location_id is not null)
  execute function public.customers_move_open_lines();

-- Customers choose it themselves, alongside the other profile fields.
grant update (home_location_id) on public.customers to authenticated;
