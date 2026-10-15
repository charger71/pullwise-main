-- Comic shop site — initial schema
-- One Supabase project per shop: nothing here is shop-specific except the
-- single settings row, which staff edit from the Shop Settings admin page.

create extension if not exists pg_trgm;
-- Scheduled jobs (status flip, emails) and the HTTP calls they make. Turned on here so a fresh project needs
-- nothing switched on in the dashboard first.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- Staff
-- Staff accounts are Supabase auth users listed here. Public sign-ups should be
-- disabled in the Supabase dashboard; staff are invited individually.
-- ---------------------------------------------------------------------------
create table public.staff (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);

create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.staff where user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Shop settings (single row). Customer-facing pages read everything from here.
-- ---------------------------------------------------------------------------
create table public.settings (
  id           smallint primary key default 1 check (id = 1),
  shop_name    text not null,
  tagline      text,
  founded_year smallint,
  street       text,
  city         text,
  region       text,
  postal_code  text,
  country      text default 'US',
  phone        text,
  email        text,
  -- [{ "days": ["Mo","Tu","We"], "open": "11:00", "close": "19:00" }, ...] (schema.org day codes)
  hours        jsonb not null default '[]',
  -- { "instagram": "...", "facebook": "...", "whatnot": "...", ... }
  socials      jsonb not null default '{}',
  -- { "primary": "#c8102e", "accent": "#ffd100", "ink": "#141414", "paper": "#fffaf0" }
  colors       jsonb not null default '{}',
  logo_url     text,
  map_embed_url text,
  about_html   text,
  -- Reservation policy knobs (plan: "may change later")
  max_copies_per_title smallint not null default 10,
  hold_days            smallint not null default 30,
  just_arrived_days    smallint not null default 7,
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Catalog: one table for both Pre-Orders and New Arrivals, split by status.
-- ---------------------------------------------------------------------------
create table public.categories (
  id    serial primary key,
  name  text not null unique,
  slug  text not null unique,
  sort  smallint not null default 0
);

create type public.item_status as enum (
  'available', 'just_arrived', 'sold_out', 'backorder',
  'pre_order', 'low_stock', 'sale', 'clearance'
);

create table public.items (
  id            bigint generated always as identity primary key,
  title         text not null,
  issue_number  text,
  publisher     text,
  category_id   int references public.categories (id) on delete set null,
  status        public.item_status not null default 'available',
  cover_url     text,
  description   text,
  price         numeric(8, 2),
  release_date  date,
  foc_date      date,
  arrived_on    date,
  isbn          text,
  upc           text,
  distributor   text check (distributor in ('lunar', 'prh', 'other')),
  staff_pick    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index items_status_idx on public.items (status);
create index items_foc_idx on public.items (foc_date) where status = 'pre_order';
create index items_title_trgm_idx on public.items using gin (title gin_trgm_ops);
create unique index items_upc_idx on public.items (upc) where upc is not null;

-- ---------------------------------------------------------------------------
-- Reservations (pre-orders only). A reservation order is one customer
-- submission holding one or more titles. Each line keeps its own status,
-- since titles in the same order arrive on different dates. The public can't
-- read or write these tables directly — they go through
-- create_reservation_order() below.
-- ---------------------------------------------------------------------------
create type public.reservation_status as enum (
  'open', 'ordered', 'arrived', 'picked_up', 'released', 'cancelled'
);

create table public.reservation_orders (
  id           bigint generated always as identity primary key,
  name         text not null check (length(name) between 1 and 120),
  phone        text check (length(phone) <= 40),
  email        text check (length(email) <= 254),
  -- Normalised contact used for dupe checks and staff lookup by phone
  phone_digits text generated always as (nullif(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), '')) stored,
  notes        text,
  client_ip    inet,
  created_at   timestamptz not null default now(),
  constraint reservation_orders_contact_chk check (phone is not null or email is not null)
);

create index reservation_orders_phone_idx on public.reservation_orders (phone_digits);
create index reservation_orders_email_idx on public.reservation_orders (lower(email));
create index reservation_orders_ip_time_idx on public.reservation_orders (client_ip, created_at);

create table public.reservations (
  id          bigint generated always as identity primary key,
  order_id    bigint not null references public.reservation_orders (id) on delete cascade,
  item_id     bigint not null references public.items (id) on delete restrict,
  quantity    smallint not null check (quantity between 1 and 100),
  status      public.reservation_status not null default 'open',
  arrived_on  date,
  created_at  timestamptz not null default now(),
  unique (order_id, item_id)
);

create index reservations_item_idx on public.reservations (item_id);
create index reservations_order_idx on public.reservations (order_id);

-- p_items: [{ "item_id": 12, "quantity": 2 }, ...]
-- All-or-nothing: if any line fails validation, nothing is saved and the
-- error names the title so the customer can fix their list.
create or replace function public.create_reservation_order(
  p_name    text,
  p_phone   text,
  p_email   text,
  p_items   jsonb,
  p_website text default null  -- honeypot: real users never fill this in
)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_name     text := nullif(trim(p_name), '');
  v_phone    text := nullif(trim(p_phone), '');
  v_email    text := nullif(lower(trim(p_email)), '');
  v_digits   text;
  v_max      smallint;
  v_ip       inet;
  v_order_id bigint;
  v_line     record;
  v_item     public.items;
  v_title    text;
  v_existing int;
begin
  -- Silently accept bots so they don't learn the field is a trap.
  if coalesce(p_website, '') <> '' then
    return 0;
  end if;

  if v_name is null then
    raise exception 'Please enter your name.' using errcode = 'P0001';
  end if;
  if v_phone is null and v_email is null then
    raise exception 'Please give a phone number or email.' using errcode = 'P0001';
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That email address doesn''t look right.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Your reservation list is empty.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'That''s a lot of titles for one order — please call the shop.' using errcode = 'P0001';
  end if;

  -- Rate limit by client IP (PostgREST forwards request headers).
  begin
    v_ip := split_part(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ',', 1)::inet;
  exception when others then
    v_ip := null;
  end;
  if v_ip is not null and (
    select count(*) from public.reservation_orders
    where client_ip = v_ip and created_at > now() - interval '10 minutes'
  ) >= 10 then
    raise exception 'Too many reservations in a short time — please try again later or call the shop.' using errcode = 'P0001';
  end if;

  select max_copies_per_title into v_max from public.settings where id = 1;
  v_max := coalesce(v_max, 10);
  v_digits := nullif(regexp_replace(coalesce(v_phone, ''), '\D', '', 'g'), '');

  insert into public.reservation_orders (name, phone, email, client_ip)
  values (v_name, v_phone, v_email, v_ip)
  returning id into v_order_id;

  for v_line in
    select (e ->> 'item_id')::bigint as item_id, sum((e ->> 'quantity')::int) as quantity
    from jsonb_array_elements(p_items) e
    group by 1
  loop
    select * into v_item from public.items where id = v_line.item_id;
    v_title := coalesce(v_item.title || coalesce(' #' || v_item.issue_number, ''), 'One of those titles');

    if v_item.id is null or v_item.status <> 'pre_order' then
      raise exception '% is no longer open for pre-order — please remove it from your list.', v_title using errcode = 'P0001';
    end if;
    if v_item.foc_date is not null and v_item.foc_date < current_date then
      raise exception 'The order cutoff for % has passed — please remove it from your list.', v_title using errcode = 'P0001';
    end if;
    if v_line.quantity is null or v_line.quantity < 1 then
      raise exception 'Quantity for % must be at least 1.', v_title using errcode = 'P0001';
    end if;

    -- Per-customer, per-title copy limit (matched on phone digits or email),
    -- counting earlier orders as well as this one.
    select coalesce(sum(r.quantity), 0) into v_existing
    from public.reservations r
    join public.reservation_orders o on o.id = r.order_id
    where r.item_id = v_item.id
      and r.order_id <> v_order_id
      and r.status not in ('cancelled', 'released')
      and ((v_digits is not null and o.phone_digits = v_digits)
        or (v_email is not null and lower(o.email) = v_email));

    if v_existing + v_line.quantity > v_max then
      if v_existing > 0 then
        raise exception 'Limit is % copies per customer for % (you already have % reserved).',
          v_max, v_title, v_existing using errcode = 'P0001';
      end if;
      raise exception 'Limit is % copies per customer for %.', v_max, v_title using errcode = 'P0001';
    end if;

    insert into public.reservations (order_id, item_id, quantity)
    values (v_order_id, v_item.id, v_line.quantity);
  end loop;

  return v_order_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Community calendar
-- ---------------------------------------------------------------------------
create table public.events (
  id           bigint generated always as identity primary key,
  title        text not null,
  event_type   text not null default 'other'
               check (event_type in ('signing', 'release_party', 'tournament', 'sale', 'livestream', 'other')),
  starts_at    timestamptz not null,
  ends_at      timestamptz,
  location     text,
  description  text,  -- HTML from the WYSIWYG editor
  image_url    text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index events_starts_idx on public.events (starts_at);

-- ---------------------------------------------------------------------------
-- Blog / news
-- ---------------------------------------------------------------------------
create table public.posts (
  id            bigint generated always as identity primary key,
  title         text not null,
  slug          text not null unique,
  excerpt       text,
  body          text,  -- HTML from the WYSIWYG editor
  cover_url     text,
  published_at  timestamptz,  -- null = draft
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Job log: import, email, and status-flip jobs record every run here so
-- failures are visible in the admin page (and trigger a staff email).
-- ---------------------------------------------------------------------------
create table public.job_log (
  id         bigint generated always as identity primary key,
  job        text not null,
  ok         boolean not null,
  message    text,
  detail     jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- updated_at bookkeeping
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger settings_touch before update on public.settings for each row execute function public.touch_updated_at();
create trigger items_touch    before update on public.items    for each row execute function public.touch_updated_at();
create trigger events_touch   before update on public.events   for each row execute function public.touch_updated_at();
create trigger posts_touch    before update on public.posts    for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Daily status flip: Pre-Order → Just Arrived on release date,
-- Just Arrived → Available after settings.just_arrived_days.
-- ---------------------------------------------------------------------------
create or replace function public.flip_item_statuses()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_days     smallint;
  v_arrived  int;
  v_settled  int;
begin
  select just_arrived_days into v_days from public.settings where id = 1;

  with arrived as (
    update public.items
    set status = 'just_arrived', arrived_on = current_date
    where status = 'pre_order' and release_date <= current_date
    returning id
  ), res as (
    update public.reservations r
    set status = 'arrived', arrived_on = current_date
    from arrived a
    where r.item_id = a.id and r.status in ('open', 'ordered')
    returning r.id
  )
  select count(*) into v_arrived from arrived;

  update public.items
  set status = 'available'
  where status = 'just_arrived'
    and arrived_on <= current_date - coalesce(v_days, 7);
  get diagnostics v_settled = row_count;

  insert into public.job_log (job, ok, message)
  values ('status_flip', true, format('%s arrived, %s moved to Available', v_arrived, v_settled));
exception when others then
  insert into public.job_log (job, ok, message) values ('status_flip', false, sqlerrm);
end;
$$;

-- Scheduled hourly in 20270104000000_schedule_status_flip.sql.

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.staff        enable row level security;
alter table public.settings     enable row level security;
alter table public.categories   enable row level security;
alter table public.items        enable row level security;
alter table public.reservation_orders enable row level security;
alter table public.reservations enable row level security;
alter table public.events       enable row level security;
alter table public.posts        enable row level security;
alter table public.job_log      enable row level security;

-- Public reads
create policy "public read settings"   on public.settings   for select using (true);
create policy "public read categories" on public.categories for select using (true);
create policy "public read items"      on public.items      for select using (true);
create policy "public read events"     on public.events     for select using (true);
create policy "public read posts"      on public.posts      for select
  using (published_at is not null and published_at <= now() or public.is_staff());

-- Staff writes
create policy "staff all settings"     on public.settings     for all using (public.is_staff()) with check (public.is_staff());
create policy "staff all categories"   on public.categories   for all using (public.is_staff()) with check (public.is_staff());
create policy "staff all items"        on public.items        for all using (public.is_staff()) with check (public.is_staff());
create policy "staff all events"       on public.events       for all using (public.is_staff()) with check (public.is_staff());
create policy "staff all posts"        on public.posts        for all using (public.is_staff()) with check (public.is_staff());
create policy "staff all reservation_orders" on public.reservation_orders for all using (public.is_staff()) with check (public.is_staff());
create policy "staff all reservations" on public.reservations for all using (public.is_staff()) with check (public.is_staff());
create policy "staff read job_log"     on public.job_log      for select using (public.is_staff());
create policy "staff read staff"       on public.staff        for select using (public.is_staff());

-- Reservations: anon may only call the function, never touch the tables.
revoke all on public.reservation_orders from anon;
revoke all on public.reservations from anon;
grant execute on function public.create_reservation_order(text, text, text, jsonb, text) to anon, authenticated;
revoke execute on function public.flip_item_statuses() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage buckets: covers, event photos, logo, and the general media library.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;

create policy "public read media" on storage.objects for select using (bucket_id = 'media');
create policy "staff write media" on storage.objects for insert with check (bucket_id = 'media' and public.is_staff());
create policy "staff update media" on storage.objects for update using (bucket_id = 'media' and public.is_staff());
create policy "staff delete media" on storage.objects for delete using (bucket_id = 'media' and public.is_staff());
