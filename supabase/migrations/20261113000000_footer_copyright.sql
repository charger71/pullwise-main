-- Footer copyright line, editable in Shop settings. {year} is replaced with the current year.
-- Blank = the default "© <year> <shop name>".
alter table public.settings add column copyright_text text check (length(copyright_text) <= 200);
