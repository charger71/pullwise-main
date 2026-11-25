-- Which titles a customer can order a copy of themselves (pull_list_reorder, from a title's details on the site or in
-- the app): a trade or omnibus at any time outside the pre-order window, since they stay in print. Comics go out of
-- print, so re-ordering one, Coming Soon included, is staff only (Ordering → Re-order, staff_reorder, unchanged).
-- Replaces 20270215000000_reorder_coming_soon_comics.sql. Re-orders customers already placed stay on their pull lists.
create or replace function public._reorderable(item public.items)
returns boolean
language sql stable security definer set search_path = public
as $$
  select item.id is not null and not item.hidden and item.status <> 'pre_order'
    and exists (select 1 from public.categories k where k.id = item.category_id and k.slug in ('trades', 'omnibuses'));
$$;
