-- Repeating events: staff create a series in one go (every day / week / 2 weeks / month until a date). Each date is its
-- own events row, so signups, spots, edits and deletes work per date as before. series_id links the rows of one series,
-- so staff can delete "this and all later" ones together. Null for a one-off event.
alter table public.events add column series_id uuid;
create index events_series_id_idx on public.events (series_id) where series_id is not null;
