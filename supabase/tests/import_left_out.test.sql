-- Import → Left Out: each daily import replaces its own source's list (20270410000000_import_left_out.sql).
-- Run with tools/test-db.sh. Everything happens in one transaction that is rolled back. A failed check raises an exception.
\set ON_ERROR_STOP on
set client_min_messages = warning;
begin;

do $$
declare
  n int;
begin
  n := public.catalog_replace_left_out('prh', '[
    {"sku": "A1", "title": "ARCHIE #2 CVR D INC 1:10", "reason": "Ratio / incentive cover", "detail": null},
    {"sku": "A2", "title": "SIX OF US #2", "reason": "Always Skip list", "detail": "Excluded publisher: Dark Horse"},
    {"sku": "", "title": "NO CODE", "reason": "Retailer bundle"}
  ]');
  if n <> 2 then raise exception 'expected 2 PRH rows saved (one has no code), got %', n; end if;
  perform public.catalog_replace_left_out('lunar', '[{"sku": "L1", "title": "BATMAN #1 BUNDLE", "reason": "Retailer bundle", "detail": ""}]');
  if (select detail from public.import_left_out where sku = 'L1') is not null then raise exception 'an empty detail is stored as null'; end if;

  -- The next PRH run replaces PRH's list and leaves Lunar's alone.
  perform public.catalog_replace_left_out('prh', '[{"sku": "A3", "title": "BEN 10 #1 DYNAMITE COM VAR", "reason": "Store or convention exclusive"}]');
  if (select array_agg(sku order by sku) from public.import_left_out where source = 'prh') <> array['A3'] then
    raise exception 'PRH list should be just A3, got %', (select array_agg(sku) from public.import_left_out where source = 'prh');
  end if;
  if not exists (select 1 from public.import_left_out where source = 'lunar' and sku = 'L1') then raise exception 'Lunar list should be untouched'; end if;

  -- An empty run clears its list.
  perform public.catalog_replace_left_out('lunar', '[]');
  if exists (select 1 from public.import_left_out where source = 'lunar') then raise exception 'an empty Lunar run should clear Lunar''s list'; end if;

  begin
    perform public.catalog_replace_left_out('funko', '[]');
    raise exception 'an unknown source should be refused';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- Only the import jobs write it; staff only read it.
do $$
begin
  if has_function_privilege('authenticated', 'public.catalog_replace_left_out(text, jsonb)', 'execute') then
    raise exception 'signed-in users must not be able to replace the list';
  end if;
  if not has_function_privilege('service_role', 'public.catalog_replace_left_out(text, jsonb)', 'execute') then
    raise exception 'the import jobs (service role) must be able to replace the list';
  end if;
end $$;

rollback;
\echo 'import_left_out tests passed'
