-- When each customer opens the pull list app (app.html), for the app numbers on the staff Dashboard (Trends → Pull
-- List App): how many customers use it, and how many opened it lately. One row per customer, kept apart from
-- `customers` so opening the app doesn't count as an edit to their record (its "last updated" and change log).

create table public.app_visits (
  customer_id   bigint primary key references public.customers (id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);
alter table public.app_visits enable row level security;
-- Staff read the numbers; customers record their own visit through the function below.
create policy "staff read app visits" on public.app_visits for select using (public.is_staff());

-- The signed-in customer opened the app. At most one write an hour, however often it's opened.
create or replace function public.mark_app_seen()
returns void
language sql security definer set search_path = public
as $$
  insert into public.app_visits (customer_id)
  select id from public.customers where user_id = auth.uid()
  on conflict (customer_id) do update set last_seen_at = now()
  where app_visits.last_seen_at < now() - interval '1 hour';
$$;
revoke execute on function public.mark_app_seen() from public, anon;
grant execute on function public.mark_app_seen() to authenticated;
