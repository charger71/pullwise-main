-- Home page banner headline, so each shop sets its own.
-- Words wrapped in *asterisks* are shown in the accent color. Empty = shop name.
alter table public.settings add column hero_headline text;
