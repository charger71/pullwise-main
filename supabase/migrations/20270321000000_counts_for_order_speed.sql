-- Speed up reservations?select=…,counts_for_order (the dashboard, Place Order and the distributor list).
--
-- counts_for_order was a SQL function that calls two more SQL functions (is_staff, _line_counts). Postgres can't
-- inline a SECURITY DEFINER function with its own search_path, so for every reservation row it re-planned all three
-- bodies: about 2.5 ms a row, 2.5 seconds for each page of 1,000 lines. A shop with a few thousand active lines
-- hit the statement timeout and the dashboard showed "That took too long". PL/pgSQL keeps its plans for the session,
-- so the same page now takes about 0.1 seconds. Same answers as before: null for anyone but staff, otherwise
-- whether the line counts toward the ordering numbers (_line_counts).

create or replace function public.counts_for_order(r public.reservations)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_staff() then
    return null;
  end if;
  return public._line_counts(r.order_id, r.item_id);
end;
$$;

revoke execute on function public.counts_for_order(public.reservations) from public, anon;
grant execute on function public.counts_for_order(public.reservations) to authenticated;
