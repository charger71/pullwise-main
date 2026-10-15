-- New pull list line status "Reordered": the shop ordered the title again (short shipment, reprint, lost box).
-- Added in its own migration because a new enum value can't be used until it is committed.
alter type public.reservation_status add value if not exists 'reordered' after 'ordered';
