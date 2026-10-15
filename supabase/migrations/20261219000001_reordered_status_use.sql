-- "Reordered" (a damaged order that was ordered again) is an active line: it counts toward the 300-title list cap, keeps a
-- title from being hidden as old, and shows in the customer list's active count. Unlike "Ordered" it does NOT flip to Ready
-- on release day, because the replacement arrives later; staff mark it Ready by hand.

CREATE OR REPLACE FUNCTION public._pull_list_problem(c customers, item items, qty integer, skip_line bigint DEFAULT NULL::bigint)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_title    text := item.title || coalesce(' #' || item.issue_number, '') || coalesce(' (' || item.variant || ')', '');
  v_max      int;
  v_existing int;
begin
  if item.id is null or item.status <> 'pre_order' or item.hidden then
    return v_title || ' is no longer open for pre-order.';
  end if;
  if item.foc_date is not null and item.foc_date <= public.reservations_close_through() then
    return 'The order cutoff for ' || v_title || ' has passed.';
  end if;
  if qty is null or qty < 1 then
    return 'Quantity for ' || v_title || ' must be at least 1.';
  end if;
  select coalesce(max_copies_per_title, 10) into v_max from public.settings where id = 1;
  select coalesce(sum(r.quantity), 0) into v_existing
  from public.reservations r
  join public.reservation_orders o on o.id = r.order_id
  where r.item_id = item.id
    and r.status not in ('cancelled', 'released')
    and r.id is distinct from skip_line
    and (o.customer_id = c.id
      or (c.phone_digits is not null and o.phone_digits = c.phone_digits)
      or (c.email is not null and lower(o.email) = lower(c.email)));
  if v_existing + qty > v_max then
    return 'Limit is ' || v_max || ' copies per customer for ' || v_title
      || case when v_existing > 0 then ' (you already have ' || v_existing || ' on your list).' else '.' end;
  end if;
  -- Size cap (editing an existing line doesn't add one, so it is exempt).
  if skip_line is null and (
    select count(*) from public.reservations r join public.reservation_orders o on o.id = r.order_id
    where o.customer_id = c.id and r.status in ('open', 'ordered', 'reordered', 'arrived')
  ) >= 300 then
    return 'Your pull list is full (300 titles). Please call the shop.';
  end if;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.flip_item_statuses()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_today     date := public.shop_today();
  v_start     date := public.shop_today() - extract(dow from public.shop_today())::int;  -- this week's Sunday
  v_arrived   int;
  v_settled   int;
  v_released  int;
  v_reserved  int;
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
  get diagnostics v_released = row_count;

  -- Customers' reservations are ready as soon as the title is out.
  update public.reservations r
  set status = 'arrived', arrived_on = i.release_date
  from public.items i
  where r.item_id = i.id and r.status in ('open', 'ordered')
    and i.release_date <= v_today and i.status <> 'pre_order';
  get diagnostics v_reserved = row_count;

  if v_arrived + v_settled + v_released + v_reserved > 0 then
    insert into public.job_log (job, ok, message)
    values ('status_flip', true, format('%s marked new this week, %s moved to Available, %s became Just Arrived, %s reservations ready',
                                        v_arrived, v_settled, v_released, v_reserved));
  end if;
exception when others then
  insert into public.job_log (job, ok, message) values ('status_flip', false, sqlerrm);
end;
$function$;

CREATE OR REPLACE FUNCTION public.staff_hide_old_titles(p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        where r.item_id = i.id and r.status in ('open', 'ordered', 'reordered', 'arrived')
      );

  select count(*) filter (where is_pre), count(*) filter (where not is_pre) into v_pre, v_store from _old_titles;

  if not p_dry_run then
    update public.items set hidden = true where id in (select id from _old_titles);
  end if;
  drop table _old_titles;

  return jsonb_build_object('pre_orders', v_pre, 'in_store', v_store);
end;
$function$;

create or replace view public.customer_list with (security_invoker = true) as
SELECT c.id,
    c.user_id,
    c.email,
    c.phone,
    c.phone_digits,
    c.address1,
    c.city,
    c.state,
    c.zip,
    c.ship_arrivals,
    c.email_opt_in,
    c.created_at,
    c.updated_at,
    c.mature_ok,
    c.unsubscribe_token,
    c.last_emailed_on,
    c.first_name,
    c.last_name,
    c.name,
    c.notify_arrivals,
    COALESCE(s.ready, (0)::bigint) AS ready_count,
    COALESCE(s.active, (0)::bigint) AS active_count,
    s.last_updated,
    concat_ws(' · '::text,
        CASE
            WHEN (c.user_id IS NOT NULL) THEN 'Has account'::text
            ELSE 'No login'::text
        END,
        CASE
            WHEN c.ship_arrivals THEN 'Ships'::text
            ELSE NULL::text
        END,
        CASE
            WHEN (c.email IS NULL) THEN 'No email'::text
            ELSE NULL::text
        END,
        CASE
            WHEN ((c.email IS NOT NULL) AND (NOT c.email_opt_in)) THEN 'Email off'::text
            ELSE NULL::text
        END) AS notes_text
   FROM (customers c
     LEFT JOIN ( SELECT o.customer_id,
            count(*) FILTER (WHERE (r.status = 'arrived'::reservation_status)) AS ready,
            count(*) FILTER (WHERE (r.status = ANY (ARRAY['open'::reservation_status, 'ordered'::reservation_status, 'reordered'::reservation_status, 'arrived'::reservation_status]))) AS active,
            max(r.updated_at) AS last_updated
           FROM (reservations r
             JOIN reservation_orders o ON ((o.id = r.order_id)))
          WHERE (o.customer_id IS NOT NULL)
          GROUP BY o.customer_id) s ON ((s.customer_id = c.id)));
