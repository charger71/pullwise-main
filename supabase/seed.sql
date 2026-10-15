-- Starting data for a fresh shop project. Staff can change all of this
-- from the Shop Settings admin page afterward.

insert into public.settings (id, shop_name, tagline, hero_headline, founded_year, phone, email, hours, socials, colors)
values (
  1,
  'Your Comic Shop',
  'Comics, collectibles & more',
  'Comics. Collectibles. *Community.*',
  null,
  null,
  null,
  '[{"days":["Mo","Tu","We","Th","Fr","Sa"],"open":"11:00","close":"19:00"},{"days":["Su"],"open":"12:00","close":"17:00"}]',
  '{}',
  '{"primary":"#982c21","accent":"#e7b84b","ink":"#f4f0ea","paper":"#121212","footer":"#121212"}'
)
on conflict (id) do nothing;

insert into public.categories (name, slug, sort) values
  ('Comics',     'comics',     1),
  ('Trades',     'trades',     2),
  ('Omnibuses',  'omnibuses',  3),
  ('Records',    'records',    4),
  ('Toys',       'toys',       5),
  ('Funko Pops', 'funko-pops', 6),
  ('Action Figures', 'action-figures', 7),
  ('Other',      'other',      99)
on conflict (slug) do nothing;
