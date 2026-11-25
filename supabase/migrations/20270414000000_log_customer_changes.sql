-- A customer's Recent Changes (Customers → a customer → Changes) shows the customer's own changes too, not only staff's.
--
-- What a customer does on the site or in the app goes through many functions (adding titles, re-orders, variants,
-- quantity and status changes, follows and unfollows), so instead of logging in each one, triggers on reservations
-- and subscriptions add a pull_list_log row whenever the signed-in customer changes their own list or follows.
-- Staff changes are logged by the admin as before, and jobs with no one signed in (the nightly sweeps) are left out,
-- so nothing is logged twice.
--
-- by_customer marks those rows: the admin shows "Customer" for them, a staff member's name for staff rows, and
-- "Automatic" for rows with neither (a sweep, or a cutoff move).

alter table public.pull_list_log add column by_customer boolean not null default false;

-- The customer whose signed-in account is making this change, or null (staff, a job, or someone else's list).
create or replace function public._acting_customer(p_customer bigint)
returns bigint
language sql stable security definer set search_path = public
as $$
  select c.id from public.customers c
  where c.id = p_customer and c.user_id is not null and c.user_id = auth.uid() and not public.is_staff();
$$;
revoke execute on function public._acting_customer(bigint) from public, anon, authenticated;

create or replace function public._log_customer_line_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_line     public.reservations := case when tg_op = 'DELETE' then old else new end;
  v_customer bigint;
  v_name     text;
begin
  if auth.uid() is null then return null; end if; -- a job: nothing to log here
  select public._acting_customer(o.customer_id) into v_customer from public.reservation_orders o where o.id = v_line.order_id;
  if v_customer is null then return null; end if;
  select i.title || coalesce(' #' || nullif(i.issue_number, ''), '') || coalesce(' · ' || nullif(i.variant, ''), '')
    into v_name from public.items i where i.id = v_line.item_id;

  if tg_op = 'INSERT' then
    insert into public.pull_list_log (customer_id, reservation_id, staff_user, by_customer, action, detail)
    values (v_customer, new.id, null, true, 'added', v_name || ' × ' || new.quantity);
  elsif tg_op = 'DELETE' then
    -- The line is gone, so the row can't point at it.
    insert into public.pull_list_log (customer_id, reservation_id, staff_user, by_customer, action, detail)
    values (v_customer, null, null, true, 'removed', v_name);
  else
    if new.status is distinct from old.status then
      insert into public.pull_list_log (customer_id, reservation_id, staff_user, by_customer, action, detail)
      values (v_customer, new.id, null, true, 'status',
              v_name || ': ' || public._line_status_label(old.status) || ' → ' || public._line_status_label(new.status));
    end if;
    if new.quantity is distinct from old.quantity then
      insert into public.pull_list_log (customer_id, reservation_id, staff_user, by_customer, action, detail)
      values (v_customer, new.id, null, true, 'quantity', v_name || ': ' || old.quantity || ' → ' || new.quantity);
    end if;
  end if;
  return null;
end;
$$;
revoke execute on function public._log_customer_line_change() from public, anon, authenticated;

create trigger reservations_log_customer_change
after insert or delete or update of status, quantity on public.reservations
for each row execute function public._log_customer_line_change();

create or replace function public._log_customer_follow_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_sub      public.subscriptions := case when tg_op = 'DELETE' then old else new end;
  v_customer bigint;
  v_what     text;
begin
  if auth.uid() is null then return null; end if;
  v_customer := public._acting_customer(v_sub.customer_id);
  if v_customer is null then return null; end if;
  v_what := case when v_sub.kind = 'series' then 'Series: '
                 when v_sub.role = 'cover' then 'Cover artist: '
                 else 'Writer / artist: ' end || v_sub.label;

  if tg_op = 'INSERT' then
    insert into public.pull_list_log (customer_id, staff_user, by_customer, action, detail)
    values (v_customer, null, true, 'followed', v_what || ' × ' || new.quantity || case when new.all_covers then ', all covers' else '' end);
  elsif tg_op = 'DELETE' then
    insert into public.pull_list_log (customer_id, staff_user, by_customer, action, detail)
    values (v_customer, null, true, 'unfollowed', v_what);
  else
    if new.quantity is distinct from old.quantity then
      insert into public.pull_list_log (customer_id, staff_user, by_customer, action, detail)
      values (v_customer, null, true, 'follow', v_what || ': ' || old.quantity || ' → ' || new.quantity || ' per issue');
    end if;
    if new.all_covers is distinct from old.all_covers then
      insert into public.pull_list_log (customer_id, staff_user, by_customer, action, detail)
      values (v_customer, null, true, 'follow', v_what || ': all covers ' || case when new.all_covers then 'on' else 'off' end);
    end if;
  end if;
  return null;
end;
$$;
revoke execute on function public._log_customer_follow_change() from public, anon, authenticated;

create trigger subscriptions_log_customer_change
after insert or delete or update of quantity, all_covers on public.subscriptions
for each row execute function public._log_customer_follow_change();
