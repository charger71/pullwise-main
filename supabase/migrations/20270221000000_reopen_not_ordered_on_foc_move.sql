-- A title marked Not ordered (Ordering > Place Order) because its order cutoff was wrong opens again when the cutoff
-- is corrected: whenever a title's FOC date changes (an import, a catalog sync, a staff edit) to one still open for
-- orders, its Not ordered pull list lines go back to Open, so they're back on Place Order for the new cutoff and
-- customers see "On your list" again. Re-orders are left alone. Each change is noted in the customer's staff log.
-- The title itself already turns from Coming Soon back to Pre-order (20270214000000_coming_soon_flip.sql).
create or replace function public._items_reopen_not_ordered()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.foc_date is distinct from old.foc_date
     and new.foc_date > public.reservations_close_through()
     and new.status = 'pre_order' then
    with reopened as (
      update public.reservations r
      set status = 'open'
      where r.item_id = new.id and r.status = 'not_ordered' and not r.reorder
      returning r.id, r.order_id
    )
    insert into public.pull_list_log (customer_id, reservation_id, action, detail)
    select o.customer_id, x.id, 'status',
           new.title || coalesce(' #' || new.issue_number, '') || coalesce(' · ' || new.variant, '')
             || ': Not ordered → Open (order cutoff moved to ' || to_char(new.foc_date, 'Mon FMDD') || ')'
    from reopened x join public.reservation_orders o on o.id = x.order_id
    where o.customer_id is not null;
  end if;
  return null;
end;
$$;

create trigger items_reopen_not_ordered after update of foc_date on public.items
  for each row execute function public._items_reopen_not_ordered();
