-- Pull list audit fixes.
--  1. Hidden titles: a customer couldn't read a title that had been hidden ("Clean up old titles" hides old ones,
--     history lines included), so My Pull List got lines with no title and failed to show. Customers can now read
--     the titles on their own list.
--  2. Unfollow removes the titles that follow added and that haven't been ordered (still open, before the order
--     cutoff), unless another of the customer's follows also covers them. They're deleted rather than cancelled, so
--     following again later adds them back. unfollow_preview() says how many would go, for the warning.
--  3. Changing a follow's copies updates every title it added that hasn't been ordered, within the copy limit.

-- 1 -------------------------------------------------------------------------------------------------------------
create or replace function public._my_item(p_item bigint)
returns boolean
language sql stable security definer set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1 from public.reservations r
    join public.reservation_orders o on o.id = r.order_id
    join public.customers c on c.id = o.customer_id
    where r.item_id = p_item and c.user_id = auth.uid());
$$;
revoke execute on function public._my_item(bigint) from public, anon;
grant execute on function public._my_item(bigint) to authenticated;

create policy "own list items read" on public.items for select to authenticated using (hidden and public._my_item(id));

-- 2 + 3 ---------------------------------------------------------------------------------------------------------
-- Does this follow cover this title (would it add it)?
create or replace function public._follow_covers(s public.subscriptions, i public.items)
returns boolean
language sql stable security definer set search_path = public
as $$
  select (s.kind = 'series' and i.series_key = s.key)
      or (s.kind = 'artist' and s.role = 'cover'
          and (exists (select 1 from public.item_creators ic where ic.item_id = i.id and ic.key = s.key and ic.role = 'cover')
               or (s.key like '% %' and i.variant_words like '% ' || s.key || ' %')))
      or (s.kind = 'artist' and s.role = 'creator'
          and exists (select 1 from public.item_creators ic where ic.item_id = i.id and ic.key = s.key));
$$;

-- The lines a follow added that haven't been ordered and can still change.
create or replace function public._follow_open_lines(s public.subscriptions)
returns setof public.reservations
language sql stable security definer set search_path = public
as $$
  select r.*
  from public.reservations r
  join public.reservation_orders o on o.id = r.order_id and o.customer_id = s.customer_id
  join public.items i on i.id = r.item_id
  where r.source = s.kind
    and r.status = 'open'
    and (i.foc_date is null or i.foc_date > public.reservations_close_through())
    and public._follow_covers(s, i);
$$;

-- Removes (or with p_dry_run only counts) the follow's open lines, then the follow itself. A title another of the
-- customer's follows also covers stays (that follow would only add it back). Returns how many came off the list.
create or replace function public._unfollow(s public.subscriptions, p_dry_run boolean)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_ids bigint[];
begin
  select coalesce(array_agg(l.id), '{}') into v_ids
  from public._follow_open_lines(s) l
  join public.items i on i.id = l.item_id
  where not exists (
    select 1 from public.subscriptions other
    where other.customer_id = s.customer_id and other.id <> s.id and public._follow_covers(other, i));
  if not p_dry_run then
    delete from public.reservations where id = any (v_ids);
    delete from public.subscriptions where id = s.id;
  end if;
  return cardinality(v_ids);
end;
$$;

drop function public.unfollow(bigint);
create function public.unfollow(p_id bigint)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  c public.customers := public._pull_list_customer();
  s public.subscriptions;
begin
  select * into s from public.subscriptions where id = p_id and customer_id = c.id;
  if s.id is null then return 0; end if;
  return public._unfollow(s, false);
end;
$$;

create or replace function public.unfollow_preview(p_id bigint)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  c public.customers := public._pull_list_customer();
  s public.subscriptions;
begin
  select * into s from public.subscriptions where id = p_id and customer_id = c.id;
  if s.id is null then return 0; end if;
  return public._unfollow(s, true);
end;
$$;

-- Staff versions, for a chosen customer (Admin -> Customers -> Follows).
create or replace function public.staff_unfollow(p_customer bigint, p_id bigint, p_dry_run boolean default false)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  s public.subscriptions;
begin
  if not public.is_staff() then raise exception 'Staff only.' using errcode = '42501'; end if;
  select * into s from public.subscriptions where id = p_id and customer_id = p_customer;
  if s.id is null then return 0; end if;
  return public._unfollow(s, p_dry_run);
end;
$$;

-- Copies of each issue: the follow and every title it added that hasn't been ordered. A title the copy limit
-- doesn't allow at the new quantity keeps its old one. Returns { updated, skipped }.
drop function public.set_follow_quantity(bigint, int);
create function public.set_follow_quantity(p_id bigint, p_quantity int)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  c         public.customers := public._pull_list_customer();
  s         public.subscriptions;
  l         public.reservations;
  item      public.items;
  v_updated int := 0;
  v_skipped int := 0;
  v_max     int;
begin
  if p_quantity is null or p_quantity < 1 or p_quantity > 100 then
    raise exception 'Quantity must be between 1 and 100.' using errcode = 'P0001';
  end if;
  -- More than the copy limit would stop the follow adding anything (every new issue would be over it).
  select coalesce(max_copies_per_title, 10) into v_max from public.settings where id = 1;
  if p_quantity > coalesce(v_max, 10) then
    raise exception 'Limit is % copies of each title.', coalesce(v_max, 10) using errcode = 'P0001';
  end if;
  update public.subscriptions set quantity = p_quantity where id = p_id and customer_id = c.id returning * into s;
  if s.id is null then
    return jsonb_build_object('updated', 0, 'skipped', 0);
  end if;
  for l in select * from public._follow_open_lines(s) where quantity <> p_quantity loop
    select * into item from public.items where id = l.item_id;
    if public._pull_list_problem(c, item, p_quantity, l.id) is null then
      update public.reservations set quantity = p_quantity where id = l.id;
      v_updated := v_updated + 1;
    else
      v_skipped := v_skipped + 1;
    end if;
  end loop;
  return jsonb_build_object('updated', v_updated, 'skipped', v_skipped);
end;
$$;

revoke execute on function
  public._follow_covers(public.subscriptions, public.items), public._follow_open_lines(public.subscriptions),
  public._unfollow(public.subscriptions, boolean)
from public, anon, authenticated;
revoke execute on function
  public.unfollow(bigint), public.unfollow_preview(bigint), public.staff_unfollow(bigint, bigint, boolean),
  public.set_follow_quantity(bigint, int)
from public, anon;
grant execute on function
  public.unfollow(bigint), public.unfollow_preview(bigint), public.staff_unfollow(bigint, bigint, boolean),
  public.set_follow_quantity(bigint, int)
to authenticated;
