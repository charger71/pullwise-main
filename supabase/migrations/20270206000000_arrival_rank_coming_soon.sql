-- New Arrivals also lists "Coming Soon": pre-orders whose order cutoff has passed but that aren't out yet, which
-- used to show on neither Pre-Orders nor New Arrivals. They sort last, after Backorder / Sold Out.
-- A generated column's expression can't be changed in place, so the column (and its index) is made again.
alter table public.items drop column arrival_rank;
alter table public.items
  add column arrival_rank smallint generated always as (
    case status
      when 'new_this_wednesday' then 0
      when 'just_arrived' then 1
      when 'backorder' then 3
      when 'sold_out' then 3
      when 'pre_order' then 4
      else 2
    end
  ) stored;
create index items_arrival_rank_idx on public.items (arrival_rank, title);
