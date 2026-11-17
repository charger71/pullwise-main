-- Shop ordering, part 3: the store's copies through Received and Past Orders, like customer lines
-- (open -> ordered -> received).
--
--  * staff_receive_shop_copies: Received marks the store's ordered copies of the titles that came in as received,
--    alongside customers' lines becoming Ready.
--  * staff_past_cutoffs: the cutoffs Past Orders lists (passed, with something ordered or sent), with their totals
--    from _order_rows, so Past Orders shows the same numbers Place Order did. Its titles come from staff_order_rows.

-- Received: the store's copies that came in. Only rows still ordered change (a row staff changed meanwhile is left
-- alone). Returns how many rows were marked received.
create or replace function public.staff_receive_shop_copies(p_ids bigint[])
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_done int;
begin
  if not public.is_staff() then
    raise exception 'Staff only.' using errcode = '42501';
  end if;
  update public.shop_order_lines
  set status = 'received', received_at = now(), updated_by = auth.uid(), updated_at = now()
  where id = any (coalesce(p_ids, '{}')) and status = 'ordered';
  get diagnostics v_done = row_count;
  return v_done;
end;
$$;
revoke execute on function public.staff_receive_shop_copies(bigint[]) from public, anon;
grant execute on function public.staff_receive_shop_copies(bigint[]) to authenticated;

-- Past Orders: one line per cutoff that has passed (or titles with no cutoff) with customer lines ordered, arrived or
-- picked up, store copies ordered or received, or anything sent. Newest first, no cutoff last. Totals from _order_rows
-- (titles with copies or something sent).
create or replace function public.staff_past_cutoffs(p_location bigint default null)
returns table (
  foc_date        date,
  titles          int,
  customer_copies int,
  shop_copies     int,
  total           int,
  submitted_at    timestamptz
)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_today date := public.shop_today();
begin
  perform public._order_check('all', p_location);
  return query
    with focs as (
      select i.foc_date as f from public.reservations r join public.items i on i.id = r.item_id
      where r.status in ('ordered', 'arrived', 'picked_up') and not r.reorder
        and (p_location is null or r.location_id = p_location)
        and (i.foc_date is null or i.foc_date < v_today)
      union
      select i.foc_date from public.shop_order_lines s join public.items i on i.id = s.item_id
      where s.status in ('ordered', 'received') and (p_location is null or s.location_id = p_location)
        and (i.foc_date is null or i.foc_date < v_today)
      union
      select i.foc_date from public.order_submission_lines l
      join public.order_submissions o on o.id = l.submission_id
      join public.items i on i.id = l.item_id
      where (p_location is null or o.location_id = p_location)
        and (i.foc_date is null or i.foc_date < v_today)
    )
    select f.f,
           count(r.item_id)::int,
           coalesce(sum(r.customer_copies), 0)::int,
           coalesce(sum(r.shop_copies), 0)::int,
           coalesce(sum(r.total), 0)::int,
           max(r.submitted_at)
    from focs f
    join lateral public._order_rows(f.f, 'all', p_location) r on r.total > 0 or r.submitted is not null
    group by f.f
    order by f.f desc nulls last;
end;
$$;
revoke execute on function public.staff_past_cutoffs(bigint) from public, anon;
grant execute on function public.staff_past_cutoffs(bigint) to authenticated;
