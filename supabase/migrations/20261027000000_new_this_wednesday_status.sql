-- "New This Wednesday": the tag for titles releasing (or released) this shop week.
-- Kept in its own migration because a new enum value can't be used in the same
-- transaction that adds it; the status job that uses it is in the next migration.
alter type public.item_status add value if not exists 'new_this_wednesday';
