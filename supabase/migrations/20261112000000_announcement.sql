-- Special announcement shown in the bar at the very top of every public page
-- (store closed, hours changed, …). Edited in Shop settings; blank = no announcement.
alter table public.settings add column announcement text check (length(announcement) <= 300);
