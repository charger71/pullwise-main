-- Shop Settings → Logo, Colors & Fonts → Layout: the public site's top navigation, homepage hero and footer, as
-- { "header": "classic|centered|bold", "hero": "banner|split|covers|slim", "footer": "full|simple|signup" }.
-- Every key is optional; a missing or unknown value is today's look (js/layouts.js). The site Worker stamps the
-- picks on each page's <body> and draws the chosen hero, so the first paint already has the shop's layout.
alter table public.settings add column if not exists layout jsonb not null default '{}'::jsonb;
