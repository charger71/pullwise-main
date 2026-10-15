-- Collector badges staff set by hand (distributor sheets don't carry this).
-- Imports never touch this column.
alter table public.items
  add column badges text[] not null default '{}'
  constraint items_badges_chk check (
    badges <@ array['first_appearance', 'key_issue', 'first_issue', 'final_issue', 'milestone']
  );
