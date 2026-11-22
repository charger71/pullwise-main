-- System Health (staff_health) answers staff and, for the daily status email, the service role; nobody else
-- (20270411000000_staff_health_service_role.sql). Run with tools/test-db.sh. Rolled back; a failed check raises.
\set ON_ERROR_STOP on
set client_min_messages = warning;
begin;

do $$
declare
  h jsonb;
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  h := public.staff_health();
  if not (h ? 'jobs' and h ? 'arrival_waiting' and h ? 'http_errors_24h') then raise exception 'unexpected answer: %', h; end if;

  perform set_config('request.jwt.claim.role', 'anon', true);
  begin
    perform public.staff_health();
    raise exception 'a visitor should be refused';
  exception when sqlstate '42501' then null;
  end;
end $$;

do $$
begin
  if not has_function_privilege('service_role', 'public.staff_health()', 'execute') then raise exception 'service_role needs execute'; end if;
  if has_function_privilege('anon', 'public.staff_health()', 'execute') then raise exception 'anon must not have execute'; end if;
end $$;

rollback;
\echo 'staff_health tests passed'
