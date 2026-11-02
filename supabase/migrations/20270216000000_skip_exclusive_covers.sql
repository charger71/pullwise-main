-- Covers a shop can't promise a customer stay out of the catalog: ratio and unlock covers ("1:25", "3 COPY UNLOCK"),
-- which depend on the shop's qualifying orders, and store and convention exclusives (Dynamite.com, DF, ComicXposure,
-- SDCC), which someone else sells. "Direct Market" and distributor (Lunar, PRH, Diamond) exclusives are the comic-shop
-- editions and stay. The importer skips the same covers (js/import/distributors.js skipReason); a title that comes in
-- another way (the catalog sync, a staff add) is hidden as it arrives, and staff can show it again.

create or replace function public.is_skipped_cover(p_text text)
returns boolean
language sql immutable
as $$
  select coalesce(public.is_incentive_variant(p_text)
    or (p_text ~* '\mEXCL(USIVE)?\M(?!\s+GIFTS)' and p_text !~* '\m(DIRECT\s+MARKET|DM|LUNAR|PRH|DIAMOND)\s+EXCL'), false);
$$;

create or replace function public._items_hide_skipped_cover()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if public.is_skipped_cover(new.title || ' ' || coalesce(new.variant, '')) then
    new.hidden := true;
  end if;
  return new;
end;
$$;

create trigger items_hide_skipped_cover
before insert on public.items
for each row execute function public._items_hide_skipped_cover();

-- The ones already in: hidden (customers' reservations for them stay on their lists).
update public.items set hidden = true
where not hidden and public.is_skipped_cover(title || ' ' || coalesce(variant, ''));
