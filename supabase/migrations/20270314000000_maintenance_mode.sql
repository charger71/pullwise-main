-- Maintenance mode: when on, every public page of the shop (and the pull list app) is covered by a "be right back"
-- screen showing the message below. Switched on and off by an owner from the Dashboard; the staff admin is not
-- affected. It only changes what visitors see: it doesn't stop the database from answering.
-- Owner-only without touching the guard: _settings_owner_guard (20270308000000_email_background_colors.sql) lets other
-- staff change only the columns it lists, so these two are refused for them like every other unlisted column.
-- Safe on a populated settings row: the new flag defaults to false (off) and the message to null.
alter table public.settings
  add column maintenance_mode boolean not null default false,
  add column maintenance_message text check (length(maintenance_message) <= 500);
