-- A shop's own price for a title, which wins over the retail (cover) price from the distributor sheet or the
-- master catalog. Re-imports and catalog syncs only ever change retail_price, so a shop price survives them.
--
--   retail_price  from imports and the catalog
--   shop_price    set by staff; blank = sell at retail
--   price         what the shop charges: shop_price if set, else retail_price. Kept by a trigger, so everything
--                 that shows or totals a price (site, emails, PDFs, discounts, exports) keeps reading `price`.

alter table public.items
  add column retail_price numeric(8, 2) check (retail_price >= 0),
  add column shop_price   numeric(8, 2) check (shop_price >= 0);

comment on column public.items.retail_price is 'Cover / retail price from the distributor sheet or master catalog.';
comment on column public.items.shop_price is 'This shop''s own price; when set it wins over retail_price.';
comment on column public.items.price is 'What the shop charges: shop_price if set, else retail_price (kept by items_effective_price).';

update public.items set retail_price = price where retail_price is null;

create or replace function public.items_effective_price()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    -- Rows that only say `price` (older backups, older code) are taken as the retail price.
    new.retail_price := coalesce(new.retail_price, new.price);
  elsif new.price is distinct from old.price
    and new.retail_price is not distinct from old.retail_price
    and new.shop_price is not distinct from old.shop_price then
    new.retail_price := new.price;
  end if;
  new.price := coalesce(new.shop_price, new.retail_price);
  return new;
end;
$$;

create trigger items_effective_price before insert or update on public.items
  for each row execute function public.items_effective_price();
