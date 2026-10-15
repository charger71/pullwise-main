-- Header option: show the shop name next to the logo (otherwise the logo replaces it).
alter table public.settings add column show_name_with_logo boolean not null default false;
