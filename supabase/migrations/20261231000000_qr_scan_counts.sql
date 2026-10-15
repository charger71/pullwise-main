-- QR Codes: count how often each forwarding code is opened (go.html looks the code up through qr_target).
alter table public.qr_codes
  add column scan_count   bigint not null default 0,
  add column last_scan_at timestamptz;

create or replace function public.qr_target(p_slug text)
returns text
language plpgsql volatile security definer set search_path = public
as $$
declare v_url text;
begin
  update public.qr_codes set scan_count = scan_count + 1, last_scan_at = now()
  where slug = lower(p_slug) and forward
  returning target_url into v_url;
  return v_url;
end;
$$;

revoke execute on function public.qr_target(text) from public;
grant execute on function public.qr_target(text) to anon, authenticated;
