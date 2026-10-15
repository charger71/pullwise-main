-- Super Admin: a staff member above Owner. A Super Admin can't be removed or demoted by an Owner (or by anyone
-- through the admin or the staff-admin function), and an Owner can't reset their password.
--
--  * staff.is_super marks them. Super Admin always implies Owner (the check below), so every existing owner rule still applies.
--  * A trigger blocks deleting a Super Admin row and clearing is_super / is_owner on one. Even deleting their login
--    (which cascades to the staff row) is blocked.
--  * To change a Super Admin on purpose (promote someone, or retire one), do it in SQL with the guard switched off for
--    that transaction only:
--        begin;
--        select set_config('app.allow_super_change', 'on', true);
--        update public.staff set is_super = true, is_owner = true where user_id = '…';
--        commit;
--
-- No one is Super Admin after a fresh install; make the first one with the SQL above (see SETUP.md).

alter table public.staff add column is_super boolean not null default false;

alter table public.staff add constraint staff_super_is_owner check (not is_super or is_owner);

create or replace function public.is_super()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.staff where user_id = auth.uid() and is_super);
$$;
grant execute on function public.is_super() to authenticated;

create or replace function public._guard_super_staff()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if old.is_super and coalesce(current_setting('app.allow_super_change', true), '') <> 'on' then
    if tg_op = 'DELETE' then
      raise exception 'A Super Admin can''t be removed.' using errcode = '42501';
    elsif not new.is_super or not new.is_owner then
      raise exception 'A Super Admin can''t be demoted.' using errcode = '42501';
    end if;
  end if;
  return case tg_op when 'DELETE' then old else new end;
end;
$$;

create trigger staff_guard_super before update or delete on public.staff
  for each row execute function public._guard_super_staff();

-- The staff list now says who the Super Admin is (the return columns change, so the function is recreated).
drop function public.staff_list();
create function public.staff_list()
returns table (user_id uuid, name text, email text, is_owner boolean, is_super boolean, created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public, auth
as $$
begin
  if not public.is_staff() then raise exception 'Staff only.' using errcode = '42501'; end if;
  return query
    select s.user_id, s.name, u.email::text, s.is_owner, s.is_super, s.created_at, u.last_sign_in_at
    from public.staff s join auth.users u on u.id = s.user_id
    where public.is_owner() or s.user_id = auth.uid()
    order by s.is_super desc, s.is_owner desc, s.name;
end;
$$;
grant execute on function public.staff_list() to authenticated;
