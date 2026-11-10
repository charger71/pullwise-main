-- Admin → Emails → Look: two background colors for the customer emails. The page color is the backdrop behind the
-- email; the body color is the panel the text sits on. Blank keeps the old look (page #f4f1ea, body white). Other
-- staff may change them like the logo and the other two colors.

alter table public.settings
  add column email_page_color text constraint settings_email_page_color_check check (email_page_color is null or email_page_color ~ '^#[0-9a-fA-F]{6}$'),
  add column email_body_color text constraint settings_email_body_color_check check (email_body_color is null or email_body_color ~ '^#[0-9a-fA-F]{6}$');

-- Same as 20270113000000_admin_audit_fixes.sql A1, plus the two new columns in the list other staff may edit.
create or replace function public._settings_owner_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_bad text;
begin
  -- Scheduled jobs, the Edge functions and the SQL editor have no signed-in user.
  if auth.uid() is null or public.is_owner() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op <> 'UPDATE' then
    raise exception 'Only an owner can add or remove the shop settings.' using errcode = '42501';
  end if;
  select string_agg(e.key, ', ' order by e.key) into v_bad
  from jsonb_each(to_jsonb(new)) e
  where e.key <> all (array[
      'announcement',
      'pull_list_email_enabled', 'pull_list_email_day', 'pull_list_email_hour', 'pull_list_email_from', 'pull_list_email_last_sent',
      'email_logo_url', 'email_header_color', 'email_button_color', 'email_page_color', 'email_body_color',
      'arrival_email_enabled', 'arrival_email_after_hour', 'arrival_email_before_hour',
      'updated_at'])
    and (to_jsonb(old) -> e.key) is distinct from e.value;
  if v_bad is not null then
    raise exception 'Only an owner can change these shop settings: %.', v_bad using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Same as 20270128000000_newsletter_embed.sql, plus the two background colors (a key left out keeps its value).
create or replace function public.staff_save_email_settings(p jsonb, p_signup_html text)
returns void
language plpgsql security invoker set search_path = public
as $$
declare
  v_id int;
begin
  if not public.is_staff() then
    raise exception 'Staff only. You may have been signed out: sign in again and save.' using errcode = '42501';
  end if;
  update public.settings set
    pull_list_email_enabled   = case when p ? 'pull_list_email_enabled'   then (p ->> 'pull_list_email_enabled')::boolean    else pull_list_email_enabled end,
    pull_list_email_day       = case when p ? 'pull_list_email_day'       then (p ->> 'pull_list_email_day')::smallint      else pull_list_email_day end,
    pull_list_email_hour      = case when p ? 'pull_list_email_hour'      then (p ->> 'pull_list_email_hour')::smallint     else pull_list_email_hour end,
    pull_list_email_from      = case when p ? 'pull_list_email_from'      then nullif(trim(p ->> 'pull_list_email_from'), '') else pull_list_email_from end,
    email_logo_url            = case when p ? 'email_logo_url'            then nullif(p ->> 'email_logo_url', '')       else email_logo_url end,
    email_header_color        = case when p ? 'email_header_color'        then nullif(p ->> 'email_header_color', '')   else email_header_color end,
    email_button_color        = case when p ? 'email_button_color'        then nullif(p ->> 'email_button_color', '')   else email_button_color end,
    email_page_color          = case when p ? 'email_page_color'          then nullif(p ->> 'email_page_color', '')     else email_page_color end,
    email_body_color          = case when p ? 'email_body_color'          then nullif(p ->> 'email_body_color', '')     else email_body_color end,
    arrival_email_enabled     = case when p ? 'arrival_email_enabled'     then (p ->> 'arrival_email_enabled')::boolean      else arrival_email_enabled end,
    arrival_email_after_hour  = case when p ? 'arrival_email_after_hour'  then (p ->> 'arrival_email_after_hour')::smallint  else arrival_email_after_hour end,
    arrival_email_before_hour = case when p ? 'arrival_email_before_hour' then (p ->> 'arrival_email_before_hour')::smallint else arrival_email_before_hour end,
    newsletter_embed          = case when p ? 'newsletter_embed'          then nullif(trim(p ->> 'newsletter_embed'), '') else newsletter_embed end
  where id = 1
  returning id into v_id;
  if v_id is null then
    raise exception 'Nothing was saved. You may have been signed out: sign in again and save.' using errcode = 'P0001';
  end if;
  insert into public.pages (slug, lede_html) values ('home-newsletter', p_signup_html)
  on conflict (slug) do update set lede_html = excluded.lede_html;
end;
$$;
revoke execute on function public.staff_save_email_settings(jsonb, text) from public, anon;
grant execute on function public.staff_save_email_settings(jsonb, text) to authenticated;
