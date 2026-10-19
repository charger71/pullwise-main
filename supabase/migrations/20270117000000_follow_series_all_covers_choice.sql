-- Following a series can choose all covers straight away (the follow buttons offer "Main cover" / "All covers"),
-- instead of only switching it afterwards in the Following list. p_all_covers: true / false sets it, null leaves an
-- existing follow as it is (a new follow starts on the main cover). Returns { id, added } as before, where `added`
-- also counts the covers switching to all covers brought in.

drop function public.follow_series(text, int);
create function public.follow_series(p_key text, p_quantity int default 1, p_all_covers boolean default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  c     public.customers := public._pull_list_customer();
  v_key text := public._series_resolve(p_key);
  v_res jsonb;
  s     public.subscriptions;
begin
  v_res := public._subscribe(c, 'series', v_key, coalesce(public._series_label(v_key), v_key), null, p_quantity);
  select * into s from public.subscriptions where id = (v_res->>'id')::bigint;
  if p_all_covers is not null and p_all_covers is distinct from s.all_covers then
    v_res := v_res || jsonb_build_object('added', (v_res->>'added')::int + (public._set_follow_all_covers(s, p_all_covers)->>'added')::int);
  end if;
  return v_res;
end;
$$;

drop function public.staff_follow_series(bigint, text, int);
create function public.staff_follow_series(p_customer bigint, p_key text, p_quantity int default 1, p_all_covers boolean default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  c     public.customers;
  v_key text := public._series_resolve(p_key);
  v_res jsonb;
  s     public.subscriptions;
begin
  if not public.is_staff() then raise exception 'Staff only.' using errcode = '42501'; end if;
  select * into c from public.customers where id = p_customer;
  if c.id is null then raise exception 'That customer no longer exists.' using errcode = 'P0001'; end if;
  v_res := public._subscribe(c, 'series', v_key, coalesce(public._series_label(v_key), v_key), null, p_quantity);
  select * into s from public.subscriptions where id = (v_res->>'id')::bigint;
  if p_all_covers is not null and p_all_covers is distinct from s.all_covers then
    v_res := v_res || jsonb_build_object('added', (v_res->>'added')::int + (public._set_follow_all_covers(s, p_all_covers)->>'added')::int);
  end if;
  return v_res;
end;
$$;

revoke execute on function public.follow_series(text, int, boolean), public.staff_follow_series(bigint, text, int, boolean) from public, anon;
grant execute on function public.follow_series(text, int, boolean), public.staff_follow_series(bigint, text, int, boolean) to authenticated;
