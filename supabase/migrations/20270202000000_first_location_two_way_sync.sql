-- Shop Settings and the shop's first (default) location share an address, phone, hours and map. They now stay in
-- step in both directions, however many locations the shop has: edit either one and the other follows.
-- (Before, Shop Settings only fed the first location while it was the only one, so editing the first location
-- in Admin → Locations left Shop Settings showing the old details.)
-- The shop name is shared only while there is a single location: later, a location's name is its own ("Downtown").
-- Each side writes only when something differs, so the two triggers can't loop.

create or replace function public._settings_sync_location()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.locations) then
    insert into public.locations (name, street, city, region, postal_code, country, phone, hours, map_embed_url, is_default)
    values (new.shop_name, new.street, new.city, new.region, new.postal_code, new.country, new.phone, new.hours, new.map_embed_url, true);
    return null;
  end if;
  update public.locations
     set street = new.street, city = new.city, region = new.region, postal_code = new.postal_code, country = new.country,
         phone = new.phone, hours = new.hours, map_embed_url = new.map_embed_url,
         name = case when (select count(*) from public.locations) = 1 then new.shop_name else name end,
         updated_at = now()
   where is_default
     and (street, city, region, postal_code, country, phone, hours, map_embed_url,
          case when (select count(*) from public.locations) = 1 then name end)
         is distinct from
         (new.street, new.city, new.region, new.postal_code, new.country, new.phone, new.hours, new.map_embed_url,
          case when (select count(*) from public.locations) = 1 then new.shop_name end);
  return null;
end;
$$;

create or replace function public._location_sync_settings()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  update public.settings
     set street = new.street, city = new.city, region = new.region, postal_code = new.postal_code, country = new.country,
         phone = new.phone, hours = new.hours, map_embed_url = new.map_embed_url
   where id = 1
     and (street, city, region, postal_code, country, phone, hours, map_embed_url)
         is distinct from
         (new.street, new.city, new.region, new.postal_code, new.country, new.phone, new.hours, new.map_embed_url);
  return null;
end;
$$;
create trigger locations_sync_settings after insert or update on public.locations
  for each row when (new.is_default) execute function public._location_sync_settings();
