-- The pull list app's Hot tab ranks its Order Cutoff Soon and New This Week rows by how much customers pull them: given
-- the titles in a row, the ten with the most copies reserved (open, ordered, reordered, arrived or picked up), most
-- first; titles nobody has pulled yet keep the order they were given in, after the rest.
-- Public, like top_reserved_items: returns only item ids (no counts, no customer data). Hidden titles never appear.
create or replace function public.rank_by_pulls(p_ids bigint[])
returns table (item_id bigint)
language sql stable security definer set search_path = public
as $$
  select x.id
  from unnest(p_ids[1:60]) with ordinality as x(id, pos)
  join public.items i on i.id = x.id and not i.hidden
  left join public.reservations r
    on r.item_id = x.id and r.status in ('open', 'ordered', 'reordered', 'arrived', 'picked_up')
  group by x.id, x.pos
  order by coalesce(sum(r.quantity), 0) desc, x.pos
  limit 10;
$$;

revoke execute on function public.rank_by_pulls(bigint[]) from public;
grant execute on function public.rank_by_pulls(bigint[]) to anon, authenticated;
