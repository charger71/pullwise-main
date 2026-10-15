-- Weekly rhythm for New Arrivals, in the shop's timezone. The shop week runs Sunday to Saturday.
--   * Sunday midnight: pre-orders releasing that week (Wednesday) become "New This Wednesday"
--     and appear on New Arrivals; last week's arrivals ("Just Arrived") become Available.
--   * Tuesday midnight (start of Wednesday, the release day): "New This Wednesday" becomes "Just Arrived".
--   * Reservations flip to "arrived" on the release date itself.
-- The job is idempotent, so run it hourly: it takes effect in the first hour after midnight
-- shop time whatever the timezone. (Replaces the daily job from the init migration.)

create or replace function public.flip_item_statuses()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_today     date := public.shop_today();
  v_start     date := public.shop_today() - extract(dow from public.shop_today())::int;  -- this week's Sunday
  v_arrived   int;
  v_settled   int;
begin
  -- Last week's arrivals settle into Available.
  update public.items
  set status = 'available'
  where status in ('just_arrived', 'new_this_wednesday')
    and coalesce(release_date, arrived_on) < v_start;
  get diagnostics v_settled = row_count;

  -- Pre-orders releasing this week are "New This Wednesday" until release day, then "Just Arrived";
  -- ones that somehow missed their week go straight to Available.
  with arrived as (
    update public.items
    set status = case when release_date < v_start then 'available'::public.item_status
                      when release_date > v_today then 'new_this_wednesday'::public.item_status
                      else 'just_arrived'::public.item_status end,
        arrived_on = least(release_date, v_today)
    where status = 'pre_order' and release_date < v_start + 7
    returning id
  )
  select count(*) into v_arrived from arrived;

  -- Release day has come: the tag changes to Just Arrived.
  update public.items
  set status = 'just_arrived', arrived_on = release_date
  where status = 'new_this_wednesday' and release_date <= v_today;

  -- Customers' reservations are ready as soon as the title is out.
  update public.reservations r
  set status = 'arrived', arrived_on = i.release_date
  from public.items i
  where r.item_id = i.id and r.status in ('open', 'ordered')
    and i.release_date <= v_today and i.status <> 'pre_order';

  insert into public.job_log (job, ok, message)
  values ('status_flip', true, format('%s marked new this week, %s moved to Available', v_arrived, v_settled));
exception when others then
  insert into public.job_log (job, ok, message) values ('status_flip', false, sqlerrm);
end;
$$;

-- Runs hourly: scheduled in 20270104000000_schedule_status_flip.sql.
