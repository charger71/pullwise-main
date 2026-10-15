-- New pull list line status "Not ordered": the shop decided not to order this title (for whatever reason).
-- It is not active: it leaves the To order list, the copy counts, the weekly email and the PDFs, and the customer sees
-- "Not ordered by the shop". Staff can change a line back from the status dropdown.
-- Added in its own migration because a new enum value can't be used until it is committed.
alter type public.reservation_status add value if not exists 'not_ordered' after 'reordered';
