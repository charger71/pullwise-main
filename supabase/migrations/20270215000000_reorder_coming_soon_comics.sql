-- Customers can order a copy of a Coming Soon comic too, not only a trade or omnibus: past the pre-order cutoff is
-- when most re-orders happen. Released comics still can't be ordered online (they go out of print). As in
-- 20270214000000_coming_soon_flip.sql, plus comics.
create or replace function public._reorderable(item public.items)
returns boolean
language sql stable security definer set search_path = public
as $$
  select item.id is not null and not item.hidden and item.status <> 'pre_order'
    and exists (
      select 1 from public.categories k
      where k.id = item.category_id
        and (k.slug in ('trades', 'omnibuses') and (item.status = 'coming_soon' or item.release_date is null or item.release_date <= public.shop_today())
             or k.slug = 'comics' and item.status = 'coming_soon'));
$$;
