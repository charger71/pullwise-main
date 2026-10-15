-- Staff-saved customers need all four of first name, last name, email and phone
-- (was: first name, plus either email or phone). Only the checks change.

do $$
declare
  v_src text := pg_get_functiondef('public.staff_save_customer(bigint, jsonb)'::regprocedure);
  v_old text := $old$  if v_email is null and v_phone is null then
    raise exception 'Please enter an email or a phone number.' using errcode = 'P0001';
  end if;$old$;
  v_new text := $new$  if v_last is null then
    raise exception 'Please enter the customer''s last name.' using errcode = 'P0001';
  end if;
  if v_email is null then
    raise exception 'Please enter the customer''s email address.' using errcode = 'P0001';
  end if;
  if v_phone is null then
    raise exception 'Please enter the customer''s phone number.' using errcode = 'P0001';
  end if;$new$;
begin
  if position(v_old in v_src) = 0 then
    raise exception 'could not patch staff_save_customer: email/phone check not found';
  end if;
  execute replace(v_src, v_old, v_new);
end $$;
