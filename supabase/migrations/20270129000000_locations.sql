-- Multi-location groundwork. A shop (this project: the settings row, domain, branding) owns one or more
-- locations. Nothing customer-facing changes: every shop gets exactly one location, copied from its settings,
-- and every row that means "where this is picked up or handled" points at it. See README → "Adding a second location".

create table public.locations (
  id            bigint generated always as identity primary key,
  name          text not null check (length(name) between 1 and 120),
  street        text,
  city          text,
  region        text,
  postal_code   text,
  country       text default 'US',
  phone         text,
  -- [{ "days": ["Mo","Tu"], "open": "11:00", "close": "19:00" }, ...] (same shape as settings.hours)
  hours         jsonb not null default '[]',
  map_embed_url text,
  -- The shop's first location. Code that doesn't care about locations uses this one.
  is_default    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index locations_one_default on public.locations (is_default) where is_default;

alter table public.locations enable row level security;
create policy "public read locations" on public.locations for select using (true);
create policy "staff all locations"   on public.locations for all using (public.is_staff()) with check (public.is_staff());

-- The default location's id (null before the shop has one). Stable, so it can be a column default.
create or replace function public.default_location_id()
returns bigint
language sql stable security definer set search_path = public
as $$
  select id from public.locations where is_default;
$$;

-- Backfill: one location per existing shop, copied from its settings row.
insert into public.locations (name, street, city, region, postal_code, country, phone, hours, map_embed_url, is_default)
select shop_name, street, city, region, postal_code, country, phone, hours, map_embed_url, true
from public.settings
where id = 1 and not exists (select 1 from public.locations);

-- While a shop has a single location, Shop Settings stays the place staff edit its address and hours: this keeps
-- the location in step (and creates it when seed.sql inserts the settings row on a fresh project). Once a second
-- location exists the first is edited on its own and this stops touching it.
create or replace function public._settings_sync_location()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.locations) then
    insert into public.locations (name, street, city, region, postal_code, country, phone, hours, map_embed_url, is_default)
    values (new.shop_name, new.street, new.city, new.region, new.postal_code, new.country, new.phone, new.hours, new.map_embed_url, true);
  elsif (select count(*) from public.locations) = 1 then
    update public.locations
       set name = new.shop_name, street = new.street, city = new.city, region = new.region,
           postal_code = new.postal_code, country = new.country, phone = new.phone, hours = new.hours,
           map_embed_url = new.map_embed_url, updated_at = now()
     where is_default;
  end if;
  return null;
end;
$$;
create trigger settings_sync_location after insert or update on public.settings
  for each row execute function public._settings_sync_location();

-- Where things get picked up or handled. The default fills existing rows (a stable default is applied without
-- rewriting them) and new ones, so nothing that inserts these rows has to know about locations yet.
alter table public.reservations
  add column location_id bigint references public.locations (id) on delete restrict default public.default_location_id();
alter table public.events
  add column location_id bigint references public.locations (id) on delete restrict default public.default_location_id();
alter table public.customers
  add column home_location_id bigint references public.locations (id) on delete restrict default public.default_location_id();
-- Staff: null means every location.
alter table public.staff
  add column location_id bigint references public.locations (id) on delete cascade;

create index reservations_location_idx on public.reservations (location_id);
create index events_location_idx on public.events (location_id);
create index customers_home_location_idx on public.customers (home_location_id);
