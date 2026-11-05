-- Pages a shop has switched off (Admin → Pages): built-in ones from js/optional-pages.js (About, Visit Us, We Buy
-- Comics, Gift Cards, How To, FAQ) and any staff-made page, by slug. A page that is off leaves the menu, footer and
-- search, and its address shows the not-found page. Empty means every page is on.

alter table public.settings add column disabled_pages text[] not null default '{}';
