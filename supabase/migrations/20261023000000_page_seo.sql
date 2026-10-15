-- Per-page browser/Google title and description, edited on the Pages screen in the admin.
-- Blank = use the text written in the page's HTML. The home page is slug 'home'.
alter table public.pages
  add column meta_title text check (length(meta_title) <= 120),
  add column meta_description text check (length(meta_description) <= 320);
