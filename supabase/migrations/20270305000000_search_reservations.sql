-- Which searches lead to a reservation. Each search row counts the titles reserved soon after it, in the browser that
-- searched. The log still holds no customer and no order, so who searched or what they reserved can't be worked out.

alter table public.search_log add column reserved integer not null default 0 check (reserved >= 0);

-- log_search() now also says which row it wrote, so the browser can credit that search later. Null when nothing was
-- recorded. The return type can't change in place, so it is replaced; a page still running the old code ignores it.
drop function public.log_search(text, int);
create function public.log_search(p_term text, p_titles int)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_term text := left(regexp_replace(trim(coalesce(p_term, '')), '\s+', ' ', 'g'), 100);
  v_id bigint;
begin
  if v_term = '' or p_titles is null or p_titles < 0 then
    return null;
  end if;
  -- Anyone can call this, so a script hammering it stops being recorded rather than filling the table.
  if (select count(*) from public.search_log where searched_at > now() - interval '1 minute') >= 120 then
    return null;
  end if;
  delete from public.search_log where searched_at < now() - interval '90 days';
  insert into public.search_log (term, titles) values (v_term, p_titles) returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.log_search(text, int) from public;
grant execute on function public.log_search(text, int) to anon, authenticated;

-- Adds reserved titles to a recent search that found something. Anyone can call this, like log_search(), but it only
-- changes that one counter, at most 50 at a time, and only for a day after the search.
create or replace function public.log_search_reserved(p_id bigint, p_titles int default 1)
returns void
language sql security definer set search_path = public
as $$
  update public.search_log
  set reserved = reserved + least(p_titles, 50)
  where id = p_id and p_titles > 0 and titles > 0 and searched_at > now() - interval '1 day';
$$;
revoke execute on function public.log_search_reserved(bigint, int) from public;
grant execute on function public.log_search_reserved(bigint, int) to anon, authenticated;

-- The words that led to reservations, most titles first. The last two columns repeat on every row: across all searches
-- in the period, how many found titles and how many of those led to a reservation.
create or replace function public.search_log_reservations(p_days int default 90)
returns table (term text, times int, led int, reserved int, last_at timestamptz, found_searches int, led_searches int)
language sql stable set search_path = public
as $$
  with recent as (
    select l.term, l.titles, l.reserved, l.searched_at
    from public.search_log l
    where l.searched_at > now() - make_interval(days => p_days)
  ),
  totals as (
    select (count(*) filter (where r.titles > 0))::int as found,
           (count(*) filter (where r.reserved > 0))::int as led
    from recent r
  )
  select t.term, t.times, t.led, t.reserved, t.last_at, z.found, z.led
  from (
    select (array_agg(r.term order by r.searched_at desc))[1] as term,
           count(*)::int as times,
           (count(*) filter (where r.reserved > 0))::int as led,
           sum(r.reserved)::int as reserved,
           max(r.searched_at) as last_at
    from recent r
    group by lower(r.term)
  ) t
  cross join totals z
  where t.reserved > 0
  order by t.reserved desc, t.last_at desc
  limit 50;
$$;
revoke execute on function public.search_log_reservations(int) from public, anon;
grant execute on function public.search_log_reservations(int) to authenticated;
