-- Staff-only notice shown in a gold bar at the top of every admin page.
-- Edited in Shop settings; blank = hidden.
alter table public.settings add column admin_notice text check (length(admin_notice) <= 500);
