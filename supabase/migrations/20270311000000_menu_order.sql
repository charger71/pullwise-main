-- The order of the website's links (Admin → Pages): `menu_order` for the main menu, `footer_order` for the footer.
-- Main menu keys are js/site.js NAV entries (`page`) and staff-made menu pages (`page:<slug>`); footer keys are the
-- links' addresses (about.html, page.html?slug=…). Links not listed keep their usual place after the listed ones;
-- My Pull List is always last in the menu whatever this says. Empty means the usual order.

alter table public.settings add column menu_order text[] not null default '{}';
alter table public.settings add column footer_order text[] not null default '{}';
