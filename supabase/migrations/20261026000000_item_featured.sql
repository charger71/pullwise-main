-- Staff-chosen titles for the homepage shelves ("Closing soon" for pre-orders,
-- "New this week" for in-store titles). Imports never touch this column.
alter table public.items add column featured boolean not null default false;
