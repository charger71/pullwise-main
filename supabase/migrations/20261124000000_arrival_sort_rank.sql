-- Sort order for the New Arrivals page: New This Wednesday, then Just Arrived, then
-- everything in stock (Available, Low Stock, Sale, Clearance), then Backorder / Sold Out.
-- The item_status enum's own order can't be used (new_this_wednesday was added last), and
-- the page loads in batches, so the ranking has to be something the query can sort by.
alter table public.items
  add column arrival_rank smallint generated always as (
    case status
      when 'new_this_wednesday' then 0
      when 'just_arrived' then 1
      when 'backorder' then 3
      when 'sold_out' then 3
      else 2
    end
  ) stored;
create index items_arrival_rank_idx on public.items (arrival_rank, title);
