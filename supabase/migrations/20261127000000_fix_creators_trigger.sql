-- Imports (and staff title edits) failed with "permission denied for function _sync_item_creators":
-- the trigger that keeps item_creators up to date ran as the signed-in staff member, who (after the
-- security hardening) can't call the private _sync_item_creators(). Run the trigger function as its
-- owner instead. Trigger functions aren't callable directly, so this exposes nothing new.
create or replace function public.items_sync_creators()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.creators is distinct from old.creators or new.variant is distinct from old.variant then
    perform public._sync_item_creators(new.id);
  end if;
  return null;
end;
$$;
