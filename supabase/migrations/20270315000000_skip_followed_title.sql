-- "Skip" in the notification and the weekly email for a title a follow added to the pull list.
--
-- The link carries the customer's unsubscribe_token (the same private token the unsubscribe link uses) and the
-- line's id. The weekly-pull-list function calls this with the service role after the customer taps Skip and
-- confirms (a GET only shows a button, so a mail scanner opening the link skips nothing).
--
-- It does what pull_list_remove() does for a customer signed in: the line is cancelled (staff keep the history)
-- and the removal is remembered in pull_list_exclusions so the follow doesn't add it back. It only touches a line
-- a follow added (source 'series' / 'artist') that is still open and before the order cutoff.
--
-- Returns { result, title }; result is one of
--   'skipped'  - removed now
--   'already'  - it was removed earlier (by them or in the app): nothing to do
--   'closed'   - past the order cutoff, or already ordered: the shop has to change it
--   'invalid'  - no such customer or line, or not a title a follow added

create or replace function public.skip_followed_line(p_token uuid, p_line bigint)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  c    public.customers;
  r    public.reservations;
  item public.items;
begin
  select * into c from public.customers where unsubscribe_token = p_token;
  if c.id is null then
    return jsonb_build_object('result', 'invalid');
  end if;

  select r2.* into r
  from public.reservations r2 join public.reservation_orders o on o.id = r2.order_id
  where r2.id = p_line and o.customer_id = c.id and o.kind = 'pull_list' and r2.source in ('series', 'artist')
  for update of r2;
  if r.id is null then
    return jsonb_build_object('result', 'invalid');
  end if;

  select * into item from public.items where id = r.item_id;
  if r.status = 'cancelled' then
    return jsonb_build_object('result', 'already', 'title', item.title || coalesce(' #' || item.issue_number, ''));
  end if;
  if r.status <> 'open' or (item.foc_date is not null and item.foc_date <= public.reservations_close_through()) then
    return jsonb_build_object('result', 'closed', 'title', item.title || coalesce(' #' || item.issue_number, ''));
  end if;

  update public.reservations set status = 'cancelled' where id = r.id;
  insert into public.pull_list_exclusions (customer_id, item_id) values (c.id, r.item_id) on conflict do nothing;
  return jsonb_build_object('result', 'skipped', 'title', item.title || coalesce(' #' || item.issue_number, ''));
end;
$$;

revoke execute on function public.skip_followed_line(uuid, bigint) from public, anon, authenticated;
grant execute on function public.skip_followed_line(uuid, bigint) to service_role;
