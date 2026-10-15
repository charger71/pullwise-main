-- A small copy of each cover for cards and lists (the full-size cover_url stays for the title details window).
-- Pages use cover_thumb_url when it's set and fall back to cover_url, so titles without one still show a picture.
alter table public.items add column if not exists cover_thumb_url text check (length(cover_thumb_url) <= 1000);
