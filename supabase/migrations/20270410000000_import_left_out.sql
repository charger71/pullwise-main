-- Import → Left Out (master catalog): the titles the daily PRH and Lunar imports left out of the catalog, and why. Each
-- run replaces its own source's list (tools/prh-auto-import.mjs, tools/lunar-auto-import.mjs, through
-- catalog_replace_left_out), so the list is always what the latest run saw: ratio covers, store and convention
-- exclusives, retailer bundles, the Always Skip list, and titles whose UPC or ISBN is already on another title.
-- Every shop gets the table; only the catalog's is ever filled.

create table public.import_left_out (
  source  text not null check (source in ('prh', 'lunar')),
  sku     text not null,                -- the distributor's code (PRH: ISBN or UPC; Lunar: product code)
  title   text not null,                -- as the distributor lists it
  reason  text not null,                -- the group staff filter by (js/import/left-out.js REASONS)
  detail  text,                         -- the rule that matched, or the title already holding the UPC or ISBN
  seen_at timestamptz not null default now(),
  primary key (source, sku)
);
alter table public.import_left_out enable row level security;
create policy "staff read left out" on public.import_left_out for select using ((select public.is_staff()));

-- Replace one source's list with p_rows ([{ sku, title, reason, detail }]) in one go, so staff never see it half
-- written. Called only by the daily imports (service role).
create or replace function public.catalog_replace_left_out(p_source text, p_rows jsonb)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_n int;
begin
  if p_source not in ('prh', 'lunar') then raise exception 'Unknown source %', p_source using errcode = '22023'; end if;
  delete from public.import_left_out where source = p_source;
  insert into public.import_left_out (source, sku, title, reason, detail)
  select distinct on (x.sku) p_source, x.sku, x.title, x.reason, nullif(x.detail, '')
  from jsonb_to_recordset(coalesce(p_rows, '[]')) as x(sku text, title text, reason text, detail text)
  where x.sku is not null and x.sku <> '' and x.title is not null and x.reason is not null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public.catalog_replace_left_out(text, jsonb) from public, anon, authenticated;
grant execute on function public.catalog_replace_left_out(text, jsonb) to service_role;
