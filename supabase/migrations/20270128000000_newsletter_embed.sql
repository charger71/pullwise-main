-- Email list signup on every page: the shop pastes the form code from its email service (EmailOctopus, Mailchimp,
-- Klaviyo, ...) into Emails → Weekly Email Signup. Empty hides the whole signup section in the footer.
-- Only owners can change it (it's code that runs on the public site): it isn't in _settings_owner_guard's list of
-- columns other staff may edit, so the guard rejects a change from anyone else.

alter table public.settings add column if not exists newsletter_embed text;

-- Same as 20270113000000_admin_audit_fixes.sql D2, plus newsletter_embed (a key left out keeps its value).
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
