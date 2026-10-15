-- Who last changed each reservation line, and when.
--
-- A trigger stamps every insert and update, whichever way it arrives (a customer on the site,
-- staff in the admin, guest checkout, or the automatic follow / status jobs), so the admin can
-- show "last updated <when> by <who>" on a customer's pull list.
--
--   updated_via 'staff'    - a signed-in staff member (updated_by is their login)
--               'customer' - a signed-in customer (updated_by is their login)
--               'guest'    - guest checkout (no login)
--               'system'   - an automatic job: a series/artist follow, or the weekly status flip

alter table public.reservations
  add column updated_at  timestamptz not null default now(),
  add column updated_by  uuid references auth.users (id) on delete set null,
  add column updated_via text check (updated_via in ('staff', 'customer', 'guest', 'system'));

-- Existing lines: we know when they were created, but not who last touched them.
update public.reservations set updated_at = created_at;

create or replace function public.reservations_stamp()
returns trigger
language plpgsql set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  new.updated_at := now();
  new.updated_by := v_uid;
  new.updated_via := case
    when v_uid is not null and public.is_staff() then 'staff'
    when v_uid is not null then 'customer'
    when coalesce(auth.role(), '') = 'anon' then 'guest'
    else 'system'
  end;
  return new;
end;
$$;

create trigger reservations_stamp before insert or update on public.reservations
  for each row execute function public.reservations_stamp();
