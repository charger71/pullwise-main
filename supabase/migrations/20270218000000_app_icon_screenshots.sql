-- The pull list app's Home Screen icon and install screenshots (Shop settings → Logo, Colors & Fonts → Pull List App,
-- shown only for shops with the app). Both are saved at an exact size by the admin, so the Worker's manifest can
-- state it: the icon 512 × 512 with room around the logo (Android's "maskable" icon, also used on iPhone), each
-- screenshot 1080 × 2340. Blank / empty = the manifest has no maskable icon or screenshots, as before.
alter table public.settings
  add column app_icon_url text,
  add column app_screenshots text[] not null default '{}';
