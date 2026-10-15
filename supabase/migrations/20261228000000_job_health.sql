-- Dashboard "System Health" card: when each scheduled (pg_cron) job last ran and whether it succeeded, how many
-- arrived titles are waiting for their "your books are in" email, and failed Edge-function calls in the last day.
-- Staff only. cron.* and net.* are not readable from the browser, so this reads them for staff.
create or replace function public.staff_health()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_jobs    jsonb;
  v_waiting int := 0;
  v_errors  int := 0;
begin
  if not public.is_staff() then raise exception 'Staff only.' using errcode = '42501'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'name', j.jobname, 'schedule', j.schedule, 'active', j.active,
      'last_start', d.start_time, 'last_status', d.status, 'last_message', left(d.return_message, 300),
      'failed_7d', (select count(*) from cron.job_run_details x where x.jobid = j.jobid and x.status = 'failed' and x.start_time > now() - interval '7 days')
    ) order by j.jobid), '[]'::jsonb)
  into v_jobs
  from cron.job j
  left join lateral (select start_time, status, return_message from cron.job_run_details where jobid = j.jobid order by start_time desc limit 1) d on true;

  -- Same test the arrival-email job uses to decide who gets an email.
  select count(*) into v_waiting
  from public.reservations r
  join public.reservation_orders o on o.id = r.order_id
  join public.customers c on c.id = o.customer_id
  where r.status = 'arrived' and r.arrival_notified_at is null and c.email is not null and c.notify_arrivals;

  begin
    select count(*) into v_errors from net._http_response where created > now() - interval '24 hours' and (status_code is null or status_code >= 400);
  exception when others then v_errors := 0;
  end;

  return jsonb_build_object('jobs', v_jobs, 'arrival_waiting', v_waiting, 'http_errors_24h', v_errors);
end;
$$;

revoke execute on function public.staff_health() from public, anon;
grant execute on function public.staff_health() to authenticated;
