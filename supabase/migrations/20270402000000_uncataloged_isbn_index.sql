-- Catalog sync: find a shop's own title by ISBN without scanning every title.
--
-- catalog_apply matches each incoming catalog title to a shop title by catalog id, then SKU, then UPC (all indexed),
-- then ISBN among titles not yet linked to the catalog, which had no index: every new title in a batch that wasn't
-- matched earlier scanned all ~9,000 titles (about 6.6 ms each), so a batch of new titles took 0.5-1.9 seconds.
-- Only titles not linked to the catalog are in this index (none on most shops), so it costs next to nothing to keep.
-- That lookup: 6.6 ms -> 0.03-0.05 ms.

create index if not exists items_uncataloged_isbn_idx on public.items (isbn, id) where catalog_id is null and isbn is not null;
