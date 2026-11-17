-- Holiday hours: dates when the shop keeps different hours, or is closed, on top of its weekly opening hours.
-- Each entry is { "date": "2026-12-25", "label": "Christmas Day", "closed": true } or
-- { "date": "2026-12-24", "label": "Christmas Eve", "open": "10:00", "close": "15:00" }.
-- Kept on settings and on each location like `hours`, and the shop's default location stays in step with Shop
-- Settings (see 20270202000000_first_location_two_way_sync.sql, whose triggers are redefined here with the new column).

alter table public.settings  add column if not exists holiday_hours jsonb not null default '[]';
alter table public.locations add column if not exists holiday_hours jsonb not null default '[]';

alter table public.settings  add constraint settings_holiday_hours_array  check (jsonb_typeof(holiday_hours) = 'array');
alter table public.locations add constraint locations_holiday_hours_array check (jsonb_typeof(holiday_hours) = 'array');

-- Start the default location from what Shop Settings has (both are empty on existing shops, but stay safe).
update public.locations l set holiday_hours = s.holiday_hours from public.settings s where s.id = 1 and l.is_default;

create or replace function public._settings_sync_location()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.locations) then
    insert into public.locations (name, street, city, region, postal_code, country, phone, hours, holiday_hours, map_embed_url, is_default)
    values (new.shop_name, new.street, new.city, new.region, new.postal_code, new.country, new.phone, new.hours, new.holiday_hours, new.map_embed_url, true);
    return null;
  end if;
  update public.locations
     set street = new.street, city = new.city, region = new.region, postal_code = new.postal_code, country = new.country,
         phone = new.phone, hours = new.hours, holiday_hours = new.holiday_hours, map_embed_url = new.map_embed_url,
         name = case when (select count(*) from public.locations) = 1 then new.shop_name else name end,
         updated_at = now()
   where is_default
     and (street, city, region, postal_code, country, phone, hours, holiday_hours, map_embed_url,
          case when (select count(*) from public.locations) = 1 then name end)
         is distinct from
         (new.street, new.city, new.region, new.postal_code, new.country, new.phone, new.hours, new.holiday_hours, new.map_embed_url,
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
         phone = new.phone, hours = new.hours, holiday_hours = new.holiday_hours, map_embed_url = new.map_embed_url
   where id = 1
     and (street, city, region, postal_code, country, phone, hours, holiday_hours, map_embed_url)
         is distinct from
         (new.street, new.city, new.region, new.postal_code, new.country, new.phone, new.hours, new.holiday_hours, new.map_embed_url);
  return null;
end;
$$;
