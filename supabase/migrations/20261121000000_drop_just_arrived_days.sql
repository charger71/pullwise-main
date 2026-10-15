-- settings.just_arrived_days is no longer used: since the weekly status flip
-- (20261028000000) Just Arrived lasts until the shop week rolls over on Sunday midnight,
-- not a fixed number of days. Nothing in the database or the site reads it.
alter table public.settings drop column if exists just_arrived_days;
