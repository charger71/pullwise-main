-- Short description (a lede) for each event, shown on the Calendar page; the full description is on the event's page.
alter table public.events add column summary text check (length(summary) <= 300);
