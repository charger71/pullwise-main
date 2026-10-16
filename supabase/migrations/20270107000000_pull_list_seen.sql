-- "New" highlight for titles a follow added to a pull list (source 'series' / 'artist', by the hourly
-- sweep or right when the customer follows). A line is new until the customer next opens My Pull List.
-- Kept in its own table so a page visit doesn't touch customers (and its audit log).
-- No row yet means the customer hasn't opened the list since this shipped; the page then treats
-- follow-added lines from the last 7 days as new.

create table public.pull_list_seen (
  customer_id bigint primary key references public.customers (id) on delete cascade,
  seen_at     timestamptz not null default now()
);
alter table public.pull_list_seen enable row level security;
create policy "staff read pull_list_seen" on public.pull_list_seen for select using (public.is_staff());
create policy "own pull_list_seen read" on public.pull_list_seen for select
  using (customer_id in (select id from public.customers where user_id = auth.uid()));
revoke all on public.pull_list_seen from anon;
revoke insert, update, delete on public.pull_list_seen from authenticated;
grant select on public.pull_list_seen to authenticated;

-- The customer opened My Pull List: records now and returns when they last looked (null the first time).
create or replace function public.pull_list_mark_seen()
returns timestamptz
language plpgsql security definer set search_path = public
as $$
declare
  c      public.customers := public._pull_list_customer();
  v_prev timestamptz;
begin
  select seen_at into v_prev from public.pull_list_seen where customer_id = c.id;
  insert into public.pull_list_seen (customer_id, seen_at) values (c.id, now())
  on conflict (customer_id) do update set seen_at = excluded.seen_at;
  return v_prev;
end;
$$;
revoke execute on function public.pull_list_mark_seen() from public, anon;
grant execute on function public.pull_list_mark_seen() to authenticated;
