-- "Clean up old titles": hides titles that are past their useful life so New Arrivals,
-- search and the admin lists stay current. Hiding is reversible (untick Hidden on a title).
--
--   * in-store titles (anything not a pre-order) released more than 180 days ago
--   * pre-orders whose release date passed more than 90 days ago
--
-- Never touched: titles with a pull-list line that is still active (open, ordered or
-- waiting for pickup), staff picks, titles on the homepage, titles with no release date
-- (toys, records and Funko Pops added by hand), and titles already hidden.
-- With p_dry_run (the default) it only counts.

create or replace function public.staff_hide_old_titles(p_dry_run boolean default true)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_today date := (now() at time zone (select timezone from public.settings where id = 1))::date;
  v_pre   int;
  v_store int;
begin
  if not public.is_staff() then
    raise exception 'Staff only.' using errcode = '42501';
  end if;

  create temp table _old_titles on commit drop as
    select i.id, (i.status = 'pre_order') as is_pre
    from public.items i
    where not i.hidden
      and not i.staff_pick
      and not i.featured
      and i.release_date is not null
      and i.release_date < v_today - case when i.status = 'pre_order' then 90 else 180 end
      and not exists (
        select 1 from public.reservations r
        where r.item_id = i.id and r.status in ('open', 'ordered', 'arrived')
      );

  select count(*) filter (where is_pre), count(*) filter (where not is_pre) into v_pre, v_store from _old_titles;

  if not p_dry_run then
    update public.items set hidden = true where id in (select id from _old_titles);
  end if;
  drop table _old_titles;

  return jsonb_build_object('pre_orders', v_pre, 'in_store', v_store);
end;
$$;
revoke execute on function public.staff_hide_old_titles(boolean) from public, anon;
grant execute on function public.staff_hide_old_titles(boolean) to authenticated;
