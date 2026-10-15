-- "Top 10" badge on the public title cards: the ten titles with the most copies on active reservations
-- (open, ordered, reordered or arrived; the same ranking as Admin -> Dashboard -> Most Reserved).
-- Public: returns only the item ids (no counts, no customer data). Hidden titles never appear.
create or replace function public.top_reserved_items(p_limit int default 10)
returns table (item_id bigint)
language sql stable security definer set search_path = public
as $$
  select r.item_id
  from public.reservations r
  join public.items i on i.id = r.item_id and not i.hidden
  where r.status in ('open', 'ordered', 'reordered', 'arrived')
  group by r.item_id, i.title, i.issue_number
  having sum(r.quantity) > 0
  order by sum(r.quantity) desc, i.title, i.issue_number nulls first, r.item_id
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
$$;

revoke execute on function public.top_reserved_items(int) from public;
grant execute on function public.top_reserved_items(int) to anon, authenticated;
