-- Action Figures category (homepage shelf, filters, title editor).
insert into public.categories (name, slug, sort) values ('Action Figures', 'action-figures', 7)
on conflict (slug) do nothing;
