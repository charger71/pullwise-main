-- Indexes in the storefront's list order, so a page of titles is read already sorted and stops at 48.
--
-- New Arrivals (arrival group, then title / issue / cover) and Pre-Orders (order cutoff, then the same) sorted every
-- visible title on each page load: about 1-2 ms for the first page and 5-10 ms a few pages in on the biggest shops,
-- growing with the catalogue. With these the first page reads only the rows it shows: 0.15 ms, and New Arrivals five
-- pages in 0.8-0.9 ms. Both keep to visible titles, as the storefront always does (hidden = false).
-- The older items_arrival_rank_idx and items_foc_idx stay: jobs that also look at hidden titles use them.
-- (A release-date index was tried and left out: that list only shows the few hundred newest titles, which sort in a
-- moment, and Postgres walked the whole index instead.)

create index if not exists items_list_arrivals_idx
  on public.items (arrival_rank, title, issue_number nulls first, variant nulls first, id) where not hidden;
create index if not exists items_list_foc_idx
  on public.items (foc_date nulls last, title, issue_number nulls first, variant nulls first, id) where not hidden and status = 'pre_order';
