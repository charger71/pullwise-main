-- Graphic novels that came in on both a Lunar sheet and a Penguin Random House sheet were listed twice
-- (same ISBN, different UPC/SKU). Keep the Lunar listing (it carries the cutoff dates the pre-order flow
-- uses) and remove the PRH copy. Only copies with no reservations are removed. New imports now skip a
-- title whose ISBN is already in the catalog, so this doesn't come back.
delete from public.items p
where p.distributor = 'prh'
  and p.isbn is not null
  and exists (select 1 from public.items l where l.isbn = p.isbn and l.distributor = 'lunar')
  and not exists (select 1 from public.reservations r where r.item_id = p.id);
