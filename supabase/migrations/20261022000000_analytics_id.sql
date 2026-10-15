-- Google Analytics 4 measurement ID, editable from Shop settings (blank = no tracking).
alter table public.settings add column ga_measurement_id text;
