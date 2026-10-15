-- "Always skip" list for the admin Import page: publishers, series, title words, or all mature titles that
-- an import should leave out, whatever sheet they come on (staff manage it on the Import page).

create table public.import_exclusions (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('publisher', 'series', 'keyword', 'mature')),
  value      text not null default '' check (length(value) <= 200),
  created_at timestamptz not null default now(),
  -- 'mature' is a single on/off row; the others need a name.
  check ((kind = 'mature' and value = '') or (kind <> 'mature' and btrim(value) <> ''))
);
create unique index import_exclusions_unique on public.import_exclusions (kind, lower(btrim(value)));

alter table public.import_exclusions enable row level security;
create policy "staff all import_exclusions" on public.import_exclusions for all using (public.is_staff()) with check (public.is_staff());
