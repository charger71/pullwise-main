-- Custom code (e.g. a help-chat widget) that runs at the bottom of every public page. Edited in Shop settings (owners).
alter table public.settings add column footer_scripts text check (length(footer_scripts) <= 20000);
