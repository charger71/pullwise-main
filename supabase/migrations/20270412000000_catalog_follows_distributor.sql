-- A shop's copy of a catalog title follows the catalog when the title moves to another distributor.
--
-- The Lunar import now takes over DC titles that the PRH import listed first (js/import/apply.js takesOver): the
-- catalog keeps the same title and switches it to Lunar's distributor and SKU, so DC books are ordered through Lunar.
-- catalog_apply only filled in a shop's distributor and SKU when it had none, so shops kept those titles under PRH.
-- Now a shop's linked title whose distributor differs from the catalog's takes the catalog's distributor and SKU,
-- unless another of the shop's titles already has them. A shop's own SKU under the same distributor is still kept.
-- Otherwise exactly as in 20270106000000_catalog_sync.sql.

create or replace function public.catalog_apply(p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  r          record;
  v_id       bigint;
  v_today    date := public.shop_today();
  v_start    date := public.shop_today() - extract(dow from public.shop_today())::int;  -- this week's Sunday
  v_status   public.item_status;
  v_ins      int := 0;
  v_upd      int := 0;
  v_same     int := 0;
  v_fail     int := 0;
  v_error    text;
  v_switch   boolean;
begin
  for r in
    select * from jsonb_to_recordset(p_rows) as x(
      id bigint, title text, issue_number text, variant text, publisher text, retail_price numeric,
      foc_date date, release_date date, upc text, isbn text, creators text, mature boolean, description text,
      cover_url text, cover_thumb_url text, distributor text, sku text, badges text[], category_slug text)
  loop
    begin
      v_id := null;
      select id into v_id from public.items where catalog_id = r.id;
      if v_id is null and r.sku is not null then
        select id into v_id from public.items where catalog_id is null and distributor = r.distributor and sku = r.sku;
      end if;
      if v_id is null and r.upc is not null then
        select id into v_id from public.items where catalog_id is null and upc = r.upc;
      end if;
      if v_id is null and r.isbn is not null then
        select id into v_id from public.items where catalog_id is null and isbn = r.isbn order by id limit 1;
      end if;

      if v_id is not null then
        -- The catalog moved this title to another distributor (Lunar taking over a DC title PRH listed first): the
        -- shop's copy follows, unless another of its titles already has that distributor and SKU.
        select r.sku is not null and i.sku is not null and i.distributor is distinct from r.distributor
               and not exists (select 1 from public.items o where o.distributor = r.distributor and o.sku = r.sku and o.id <> i.id)
          into v_switch
          from public.items i where i.id = v_id;
        update public.items i set
          catalog_id = r.id,
          title = r.title, issue_number = r.issue_number, variant = r.variant, publisher = r.publisher,
          retail_price = r.retail_price, foc_date = r.foc_date, release_date = r.release_date,
          isbn = r.isbn, creators = r.creators, mature = coalesce(r.mature, false), description = r.description,
          -- A shop's own cover stays if the catalog has none.
          cover_url = coalesce(r.cover_url, i.cover_url),
          cover_thumb_url = case when r.cover_url is not null then r.cover_thumb_url else i.cover_thumb_url end,
          -- UPC and SKU are unique per shop: only take the catalog's when no other title has it.
          upc = case when r.upc is null or exists (select 1 from public.items o where o.upc = r.upc and o.id <> i.id) then i.upc else r.upc end,
          distributor = case when v_switch or (i.sku is null and r.sku is not null
            and not exists (select 1 from public.items o where o.distributor = r.distributor and o.sku = r.sku and o.id <> i.id))
            then r.distributor else i.distributor end,
          sku = case when v_switch or (i.sku is null and r.sku is not null
            and not exists (select 1 from public.items o where o.distributor = r.distributor and o.sku = r.sku and o.id <> i.id))
            then r.sku else i.sku end
        where i.id = v_id
          and (v_switch or (i.catalog_id, i.title, i.issue_number, i.variant, i.publisher, i.retail_price, i.foc_date, i.release_date,
               i.isbn, i.creators, i.mature, i.description, i.cover_url, i.upc)
          is distinct from
              (r.id, r.title, r.issue_number, r.variant, r.publisher, r.retail_price, r.foc_date, r.release_date,
               r.isbn, r.creators, coalesce(r.mature, false), r.description, coalesce(r.cover_url, i.cover_url), coalesce(r.upc, i.upc)));
        if found then v_upd := v_upd + 1; else v_same := v_same + 1; end if;
      else
        -- The status a first import gives (js/import/apply.js initialStatus).
        v_status := case
          when r.release_date is null or r.release_date >= v_start + 7 then 'pre_order'
          when r.release_date > v_today then 'new_this_wednesday'
          when r.release_date >= v_start then 'just_arrived'
          else 'available' end;
        insert into public.items (
          catalog_id, title, issue_number, variant, publisher, retail_price, foc_date, release_date, isbn, creators, mature,
          description, cover_url, cover_thumb_url, badges, category_id, status, arrived_on, upc, distributor, sku)
        values (
          r.id, r.title, r.issue_number, r.variant, r.publisher, r.retail_price, r.foc_date, r.release_date, r.isbn, r.creators,
          coalesce(r.mature, false), r.description, r.cover_url, r.cover_thumb_url, coalesce(r.badges, '{}'),
          (select c.id from public.categories c where c.slug = r.category_slug),
          v_status, case when v_status in ('just_arrived', 'available') then r.release_date end,
          case when exists (select 1 from public.items o where o.upc = r.upc) then null else r.upc end,
          case when exists (select 1 from public.items o where o.distributor = r.distributor and o.sku = r.sku) then null else r.distributor end,
          case when exists (select 1 from public.items o where o.distributor = r.distributor and o.sku = r.sku) then null else r.sku end);
        v_ins := v_ins + 1;
      end if;
    exception when others then
      v_fail := v_fail + 1;
      v_error := coalesce(v_error, format('catalog title %s: %s', r.id, sqlerrm));
    end;
  end loop;
  return jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'unchanged', v_same, 'failed', v_fail, 'error', v_error);
end;
$$;
revoke execute on function public.catalog_apply(jsonb) from public, anon, authenticated;
grant execute on function public.catalog_apply(jsonb) to service_role;
