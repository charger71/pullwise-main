// Sample data used when no Supabase project is configured (see config.js).
// Dates are relative to today so countdowns and "upcoming" filters stay live.

import { lastReserveDay } from './dates.js';

const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};
const at = (offset, hh, mm = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
};

export const settings = {
  shop_name: 'Your Comic Shop',
  tagline: 'Comics, collectibles & more',
  hero_headline: 'Comics. Collectibles. *Community.*',
  founded_year: 2020,
  street: '123 Main St',
  city: 'Your City',
  region: 'ST',
  postal_code: '00000',
  country: 'US',
  phone: '(555) 555-0142',
  email: 'hello@example.com',
  hours: [
    { days: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'], open: '11:00', close: '19:00' },
    { days: ['Su'], open: '12:00', close: '17:00' },
  ],
  socials: {
    instagram: 'https://instagram.com/',
    facebook: 'https://facebook.com/',
    whatnot: 'https://whatnot.com/',
  },
  colors: { primary: '#982c21', accent: '#e7b84b', ink: '#f4f0ea', paper: '#121212', footer: '#121212' },
  logo_url: null,
  map_embed_url: null,
  show_map: true,
  max_copies_per_title: 10,
  hold_days: 30,
  timezone: 'America/New_York',
};

export const categories = [
  { id: 1, name: 'Comics', slug: 'comics' },
  { id: 2, name: 'Trades', slug: 'trades' },
  { id: 3, name: 'Omnibuses', slug: 'omnibuses' },
  { id: 4, name: 'Records', slug: 'records' },
  { id: 5, name: 'Toys', slug: 'toys' },
  { id: 6, name: 'Funko Pops', slug: 'funko-pops' },
  { id: 7, name: 'Other', slug: 'other' },
  { id: 8, name: 'Action Figures', slug: 'action-figures' },
];

let nextId = 1;
const item = (o) => ({ id: nextId++, cover_url: null, description: null, staff_pick: false, featured: false, badges: [], ...o });

export const items = [
  // Pre-orders
  item({ title: 'Absolute Batman', issue_number: '14', publisher: 'DC', category_id: 1, status: 'pre_order', price: 4.99, foc_date: day(3), release_date: day(24), distributor: 'lunar' }),
  item({ title: 'Absolute Wonder Woman', issue_number: '13', publisher: 'DC', category_id: 1, status: 'pre_order', price: 4.99, foc_date: day(3), release_date: day(24), distributor: 'lunar' }),
  item({ title: 'Ultimate Spider-Man', issue_number: '24', publisher: 'Marvel', category_id: 1, status: 'pre_order', price: 4.99, foc_date: day(6), release_date: day(27), distributor: 'prh', staff_pick: true, badges: ['first_appearance'] }),
  item({ title: 'X-Men', issue_number: '22', publisher: 'Marvel', category_id: 1, status: 'pre_order', price: 4.99, foc_date: day(6), release_date: day(27), distributor: 'prh' }),
  item({ title: 'Batman: Hush 20th Anniversary Omnibus', publisher: 'DC', category_id: 3, status: 'pre_order', price: 125.0, foc_date: day(10), release_date: day(45), distributor: 'lunar' }),
  item({ title: 'Fantastic Four Vol. 4', publisher: 'Marvel', category_id: 2, status: 'pre_order', price: 19.99, foc_date: day(13), release_date: day(38), distributor: 'prh' }),
  item({ title: 'Transformers', issue_number: '30', publisher: 'Image', category_id: 1, status: 'pre_order', price: 3.99, foc_date: day(1), release_date: day(22), distributor: 'lunar', staff_pick: true }),
  // In stock
  item({ title: 'Superman', issue_number: '31', publisher: 'DC', category_id: 1, status: 'new_this_wednesday', price: 4.99 }),
  item({ title: 'Amazing Spider-Man', issue_number: '12', publisher: 'Marvel', category_id: 1, status: 'available', price: 4.99 }),
  item({ title: 'Saga Compendium Vol. 1', publisher: 'Image', category_id: 3, status: 'low_stock', price: 59.99, staff_pick: true }),
  item({ title: 'Monstress Vol. 9', publisher: 'Image', category_id: 2, status: 'new_this_wednesday', price: 19.99 }),
  item({ title: 'Watchmen (Deluxe)', publisher: 'DC', category_id: 2, status: 'sale', price: 29.99 }),
  item({ title: 'Rumours — Fleetwood Mac (LP)', publisher: 'Warner', category_id: 4, status: 'available', price: 27.99 }),
  item({ title: 'Kind of Blue — Miles Davis (LP)', publisher: 'Columbia', category_id: 4, status: 'low_stock', price: 24.99 }),
  item({ title: 'Marvel Legends Wolverine', publisher: 'Hasbro', category_id: 5, status: 'backorder', price: 24.99 }),
  item({ title: 'Funko Pop! Venom #1234', publisher: 'Funko', category_id: 6, status: 'clearance', price: 7.99 }),
  item({ title: 'Funko Pop! Harley Quinn', publisher: 'Funko', category_id: 6, status: 'sold_out', price: 12.99 }),
];

// As the database does (items_coming_soon trigger and the hourly status job): a pre-order past its cutoff is Coming Soon.
for (const i of items) if (i.status === 'pre_order' && i.foc_date && lastReserveDay(i.foc_date) < day(0)) i.status = 'coming_soon';

export const events = [
  { id: 1, title: 'New Comic Book Day Release Party', event_type: 'release_party', starts_at: at(3, 11), ends_at: at(3, 19), location: 'In store', description: '<p>Doors at 11. Free pizza while it lasts, and 10% off every new release.</p>', image_url: null },
  { id: 2, title: 'Pokémon TCG League Night', event_type: 'tournament', starts_at: at(5, 18), ends_at: at(5, 21), location: 'Back room', description: '<p>Casual standard-format play. All ages, all skill levels.</p>', image_url: null },
  { id: 3, title: 'Local Creator Signing', event_type: 'signing', starts_at: at(12, 13), ends_at: at(12, 16), location: 'In store', description: '<p>Meet local artists and get your books signed.</p>', image_url: null },
  { id: 4, title: 'Whatnot Livestream: Dollar-Bin Dig', event_type: 'livestream', starts_at: at(8, 20), ends_at: at(8, 22), location: 'Online', description: '<p>We dig through the dollar bins live. Bring your want list.</p>', image_url: null },
];

export const posts = [
  { id: 1, title: 'This Week in New Releases', slug: 'this-week-in-new-releases', excerpt: 'Our picks from this week’s wall — plus what to pre-order before cutoff.', body: '<p>Big week on the wall. Here are the books the staff can’t stop talking about…</p><p>And don’t forget: several cutoffs land this weekend. Check <a href="pre-orders.html">Pre-Orders</a>.</p>', published_at: at(-2, 9), cover_url: null },
  { id: 2, title: 'Our New Website Is Live', slug: 'new-website', excerpt: 'You can now reserve upcoming comics online and pay when you pick them up.', body: '<p>You can now reserve upcoming comics right here on the site. Add titles to your reservation list, leave your name and a phone or email, and pay when you pick them up.</p>', published_at: at(-9, 9), cover_url: null },
];
