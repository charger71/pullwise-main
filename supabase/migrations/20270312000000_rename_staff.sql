-- Change a staff member's name (Admin → Staff). Anyone on the staff can rename themselves (My Account); an owner can
-- rename anyone, except that only a Super Admin can rename another Super Admin. Recorded in the change log.

create or replace function public.rename_staff(p_user_id uuid, p_name text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_old text;
  v_target_super boolean;
begin
  if not public.is_staff() then raise exception 'Staff only.' using errcode = '42501'; end if;
  if v_name = '' or char_length(v_name) > 80 then raise exception 'Please enter a name (80 characters at most).' using errcode = '22023'; end if;
  select name, is_super into v_old, v_target_super from public.staff where user_id = p_user_id;
  if not found then raise exception 'That person isn''t on the staff list.' using errcode = 'P0002'; end if;
  if p_user_id <> auth.uid() then
    if not public.is_owner() then raise exception 'Only an owner can rename someone else.' using errcode = '42501'; end if;
    if v_target_super and not exists (select 1 from public.staff where user_id = auth.uid() and is_super) then
      raise exception 'Only a Super Admin can rename a Super Admin.' using errcode = '42501';
    end if;
  end if;
  if v_name = v_old then return; end if;
  update public.staff set name = v_name where user_id = p_user_id;
  insert into public.staff_audit (user_id, staff_name, table_name, action, summary)
  values (auth.uid(), (select name from public.staff where user_id = auth.uid()), 'staff', 'update',
          jsonb_build_array(jsonb_build_object('label', v_name, 'changed', jsonb_build_object('name', jsonb_build_object('from', v_old, 'to', v_name)))));
end;
$$;

revoke execute on function public.rename_staff(uuid, text) from public, anon;
grant execute on function public.rename_staff(uuid, text) to authenticated;
