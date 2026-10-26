-- Shop Settings → Logo, Colors & Fonts: the public site's fonts. One entry per slot (display, heading, body);
-- a missing slot uses the site's default. A slot is a built-in font ({ "font": "bangers" }, js/theme-vars.js
-- FONT_LIBRARY) or a font file staff uploaded ({ "upload": "<storage URL>", "name": "…" }); the display slot may
-- also say { "caps": false }. The site Worker writes them into each page's <head> with the colors.
alter table public.settings add column if not exists fonts jsonb not null default '{}'::jsonb;
