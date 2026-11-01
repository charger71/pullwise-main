-- "Coming Soon": a pre-order whose order cutoff has passed, not out yet. Until now the site worked this out from the
-- FOC date and only changed the label; as a status of its own, every query and report sees the same thing.
-- Kept in its own migration because a new enum value can't be used in the same transaction that adds it; the status
-- job and the filters that use it are in the next migration.
alter type public.item_status add value if not exists 'coming_soon' after 'pre_order';
