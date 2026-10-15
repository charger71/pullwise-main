-- Staff screen (Admin → Staff): owners add and remove staff and reset passwords; every staff member
-- can see their own account and change their own password. Changes to staff accounts go through the
-- staff-admin Edge Function (it needs the service key); the staff table itself stays read-only to
-- signed-in users.

alter table public.staff add column is_owner boolean not null default false;
-- Everyone in the list today is the shop owner's own account.
update public.staff set is_owner = true;

create or replace function public.is_owner()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.staff where user_id = auth.uid() and is_owner);
$$;
grant execute on function public.is_owner() to authenticated;

-- Owners see every staff member (with their login email); other staff see only themselves.
create or replace function public.staff_list()
returns table (user_id uuid, name text, email text, is_owner boolean, created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public, auth
as $$
begin
  if not public.is_staff() then raise exception 'Staff only.' using errcode = '42501'; end if;
  return query
    select s.user_id, s.name, u.email::text, s.is_owner, s.created_at, u.last_sign_in_at
    from public.staff s join auth.users u on u.id = s.user_id
    where public.is_owner() or s.user_id = auth.uid()
    order by s.is_owner desc, s.name;
end;
$$;
grant execute on function public.staff_list() to authenticated;
