-- Nobody can place an order, add a title to a pull list or follow a series/artist without all four details:
-- first name, last name, email and phone. (Guest orders already needed phone and email; they now need a first AND
-- last name. Signed-in customers needed only a phone; staff adding for a customer needed nothing.)
-- Pull-list auto-adds for people who already follow something are unchanged.

create or replace function public._require_order_details(c public.customers, p_staff boolean default false)
returns void
language plpgsql stable set search_path = public
as $$
declare
  v_missing text[] := '{}';
begin
  if nullif(trim(c.first_name), '') is null then v_missing := array_append(v_missing, 'first name'); end if;
  if nullif(trim(c.last_name), '') is null then v_missing := array_append(v_missing, 'last name'); end if;
  if nullif(trim(c.email), '') is null then v_missing := array_append(v_missing, 'email address'); end if;
  if nullif(trim(c.phone), '') is null then v_missing := array_append(v_missing, 'phone number'); end if;
  if cardinality(v_missing) = 0 then
    return;
  end if;
  if p_staff then
    raise exception 'This customer is missing their %. Complete their profile (first name, last name, email and phone) before adding titles.',
      array_to_string(v_missing, ', ') using errcode = 'P0001';
  end if;
  raise exception 'Please add your % under My Profile before ordering. We need your first name, last name, email and phone.',
    array_to_string(v_missing, ', ') using errcode = 'P0001';
end;
$$;
revoke execute on function public._require_order_details(public.customers, boolean) from public, anon, authenticated;

-- Patch the existing functions in place (same approach as 20261216000000).
do $$
declare
  v_src text;
  v_old text;
  v_new text;
begin
  -- Signed-in customers: pull_list_add and pull_list_add_variants (replace the phone-only check).
  v_old := $old$  if c.phone is null or nullif(trim(c.phone), '') is null then
    raise exception 'Please add your phone number under My Pull List before adding titles.' using errcode = 'P0001';
  end if;$old$;
  v_new := '  perform public._require_order_details(c);';
  foreach v_src in array array['public.pull_list_add(bigint, int)', 'public.pull_list_add_variants(bigint, int)'] loop
    v_src := pg_get_functiondef(v_src::regprocedure);
    if position(v_old in v_src) = 0 then raise exception 'could not patch: phone check not found'; end if;
    execute replace(v_src, v_old, v_new);
  end loop;

  -- Staff adding titles for a customer.
  v_src := pg_get_functiondef('public.staff_pull_list_add(bigint, bigint, int, boolean)'::regprocedure);
  v_old := E'  select * into base from public.items where id = p_item_id;';
  if position(v_old in v_src) = 0 then raise exception 'could not patch staff_pull_list_add'; end if;
  execute replace(v_src, v_old, E'  perform public._require_order_details(c, true);\n' || v_old);

  -- Following a series or artist (customer and staff versions both go through _subscribe).
  v_src := pg_get_functiondef('public._subscribe(public.customers, text, text, text, text, int)'::regprocedure);
  v_old := E'begin\n  if p_quantity is null';
  if position(v_old in v_src) = 0 then raise exception 'could not patch _subscribe'; end if;
  execute replace(v_src, v_old, E'begin\n  perform public._require_order_details(c, public.is_staff() and c.user_id is distinct from auth.uid());\n  if p_quantity is null');

  -- Guest orders: a first AND last name (the form joins them into one name).
  v_src := pg_get_functiondef('public.create_reservation_order(text, text, text, jsonb, text)'::regprocedure);
  v_old := E'  if v_phone is null then\n    raise exception ''Please enter your phone number.''';
  if position(v_old in v_src) = 0 then raise exception 'could not patch create_reservation_order'; end if;
  execute replace(v_src, v_old, E'  if (public._split_name(v_name)).last_name is null then\n    raise exception ''Please enter your first and last name.'' using errcode = ''P0001'';\n  end if;\n' || v_old);
end $$;
