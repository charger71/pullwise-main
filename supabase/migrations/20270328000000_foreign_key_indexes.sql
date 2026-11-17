-- Indexes for foreign keys that grow with use and had none.
--
--   pull_list_log.reservation_id   every deleted reservation line (cancellations, follow sweeps, merges) clears its
--                                  log rows' link, which scanned the whole log; the log only grows.
--   pull_list_exclusions.item_id   deleting a title (catalog cleanup, merges) scanned every exclusion.
--   items.category_id              the storefront's category pages and the Titles filter; deleting a category.
--
-- Small tables today, so building these takes moments.

create index if not exists pull_list_log_reservation_idx on public.pull_list_log (reservation_id) where reservation_id is not null;
create index if not exists pull_list_exclusions_item_idx on public.pull_list_exclusions (item_id);
create index if not exists items_category_idx on public.items (category_id) where category_id is not null;
