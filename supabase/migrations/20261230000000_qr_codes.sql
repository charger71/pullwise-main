-- Admin -> QR Codes: saved QR codes staff can create, edit, download and print.
-- A code can point straight at its web address, or at a shop link (go.html?c=<slug>) that forwards to the
-- address saved here, so the address can be changed later without reprinting the code.

create table public.qr_codes (
  id         bigint generated always as identity primary key,
  name       text not null check (length(name) between 1 and 120),
  target_url text not null check (length(target_url) between 1 and 2000),
  forward    boolean not null default true,
  slug       text not null unique check (slug ~ '^[a-z0-9]{6,20}$'),
  fg         text not null default '#000000' check (fg ~ '^#[0-9a-fA-F]{6}$'),
  bg         text not null default '#ffffff' check (bg ~ '^#[0-9a-fA-F]{6}$'),
  notes      text not null default '' check (length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger qr_codes_touch before update on public.qr_codes for each row execute function public.touch_updated_at();

alter table public.qr_codes enable row level security;
create policy "staff all qr_codes" on public.qr_codes for all using (public.is_staff()) with check (public.is_staff());

-- Public: where does this shop link forward to? Only codes set to forward are answered.
create or replace function public.qr_target(p_slug text)
returns text
language sql stable security definer set search_path = public
as $$ select target_url from public.qr_codes where slug = lower(p_slug) and forward $$;

revoke execute on function public.qr_target(text) from public;
grant execute on function public.qr_target(text) to anon, authenticated;

-- Change log, like the other content tables.
create trigger audit_ins after insert on public.qr_codes referencing new table as new_rows for each statement execute function public._audit_ins('id');
create trigger audit_upd after update on public.qr_codes referencing old table as old_rows new table as new_rows for each statement execute function public._audit_upd('id', '');
create trigger audit_del after delete on public.qr_codes referencing old table as old_rows for each statement execute function public._audit_del('id');
