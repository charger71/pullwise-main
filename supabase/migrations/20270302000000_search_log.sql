-- What people search for, so staff can see what customers want and what the shop doesn't have.
-- Holds the words and how many titles they found, never who searched: no customer, no IP address.
-- Visitors add to it through log_search(); only staff can read it. Rows older than 90 days are removed as new ones arrive.

create table public.search_log (
  id          bigint generated always as identity primary key,
  term        text not null check (length(term) between 1 and 100),
  titles      integer not null check (titles >= 0),
  searched_at timestamptz not null default now()
);
create index search_log_searched_at_idx on public.search_log (searched_at desc);

alter table public.search_log enable row level security;
create policy "staff read search_log" on public.search_log for select using (public.is_staff());
grant select on public.search_log to authenticated;

create or replace function public.log_search(p_term text, p_titles int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_term text := left(regexp_replace(trim(coalesce(p_term, '')), '\s+', ' ', 'g'), 100);
begin
  if v_term = '' or p_titles is null or p_titles < 0 then
    return;
  end if;
  -- Anyone can call this, so a script hammering it stops being recorded rather than filling the table.
  if (select count(*) from public.search_log where searched_at > now() - interval '1 minute') >= 120 then
    return;
  end if;
  delete from public.search_log where searched_at < now() - interval '90 days';
  insert into public.search_log (term, titles) values (v_term, p_titles);
end;
$$;
revoke execute on function public.log_search(text, int) from public;
grant execute on function public.log_search(text, int) to anon, authenticated;

-- The most-searched words (upper and lower case count as the same search), with the latest spelling and result count.
-- Runs as the caller, so the staff-only policy above decides who gets rows.
create or replace function public.search_log_top(p_days int default 90)
returns table (term text, times int, titles int, last_at timestamptz)
language sql stable set search_path = public
as $$
  select (array_agg(l.term order by l.searched_at desc))[1],
         count(*)::int,
         (array_agg(l.titles order by l.searched_at desc))[1],
         max(l.searched_at)
  from public.search_log l
  where l.searched_at > now() - make_interval(days => p_days)
  group by lower(l.term)
  order by 2 desc, 4 desc
  limit 50;
$$;
revoke execute on function public.search_log_top(int) from public, anon;
grant execute on function public.search_log_top(int) to authenticated;
