-- Option to show a Google Map on the Home page ("Come visit") and the Visit page.
-- The map comes from settings.map_embed_url if set, otherwise from the address.
alter table public.settings add column show_map boolean not null default true;
