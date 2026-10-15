-- Editable page text: a lede (intro) for every page, a body for the longer
-- pages, and the FAQ list. Staff edit these with the WYSIWYG editor on the
-- admin page. HTML may contain {placeholders} filled from settings
-- ({shop_name}, {phone}, {max_copies_per_title}, …) when shown.
-- Starting text comes from js/page-defaults.js.

create table public.pages (
  slug       text primary key,
  lede_html  text,
  body_html  text,
  updated_at timestamptz not null default now()
);

create table public.faqs (
  id          bigint generated always as identity primary key,
  question    text not null check (length(question) between 1 and 300),
  answer_html text not null default '',
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index faqs_sort_idx on public.faqs (sort, id);

create trigger pages_touch before update on public.pages for each row execute function public.touch_updated_at();
create trigger faqs_touch  before update on public.faqs  for each row execute function public.touch_updated_at();

alter table public.pages enable row level security;
alter table public.faqs  enable row level security;

create policy "public read pages" on public.pages for select using (true);
create policy "public read faqs"  on public.faqs  for select using (true);
create policy "staff all pages"   on public.pages for all using (public.is_staff()) with check (public.is_staff());
create policy "staff all faqs"    on public.faqs  for all using (public.is_staff()) with check (public.is_staff());

-- About text now lives in pages.about (body); settings.about_html is no longer used.

insert into public.pages (slug, lede_html, body_html) values
  ('home-preorders', '<p>We place our orders with the distributors on the Final Order Cutoff (FOC) date. Reserve by the night before and we''ll order a copy just for you — pay when you pick it up.</p>', null),
  ('home-funko', '<p>New in the shop and coming soon — reserve upcoming Pops and pay when you pick them up.</p>', null),
  ('home-newsletter', '<p>What''s hitting the wall on Wednesday, plus pre-order reminders before cutoff.</p>', null),
  ('pre-orders', '<p>Reserve upcoming books by the night before the <strong>Final Order Cutoff (FOC)</strong> — the day we place our order with the distributor. We''ll order a copy with your name on it. <strong>No payment online: pay in-store at pickup.</strong></p>', null),
  ('new-arrivals', '<p>What''s on the shelves right now — comics, trades, omnibuses, records, toys and Funko Pops.</p>', null),
  ('calendar', '<p>Signings, release parties, tournaments and livestreams. No RSVP needed — just show up.</p>', null),
  ('news', '<p>New-release roundups and shop news.</p>', null),
  ('about', '<p>Your neighborhood shop for comics, collectibles and more.</p>', '<p>Tell your shop''s story here: when you opened, what you carry and who is behind the counter. Edit this text in Admin → Pages.</p><h2>The Crew</h2><p>Staff bios coming soon — in the meantime, come say hi at the counter.</p>'),
  ('visit', '<p>Stop by the shop — new comics every Wednesday, and we''re always happy to help you find something good.</p>', null),
  ('gift-cards', '<p>Not sure what they''re reading? A gift card is always the right size.</p>', '<h2>How they work</h2><ul><li>Buy a gift card at the register in any amount.</li><li>Good for anything in the shop — comics, trades, records, toys, Funko Pops, and pre-orders at pickup.</li><li>Redeem in store. Any remaining balance stays on the card.</li></ul><blockquote>Online gift card purchases are coming later. For now, stop by or give us a call.</blockquote>'),
  ('faq', '<p>Answers to the questions we hear most at the counter. Don''t see yours? Give us a call at {phone}.</p>', null),
  ('grading', '<p>We can submit your books to CGC (Certified Guaranty Company) for professional grading and slabbing.</p>', '<h2>How it works</h2><ol><li><strong>Bring your books in.</strong> We''ll look them over with you and talk through which ones are worth grading.</li><li><strong>Pick a service tier.</strong> CGC prices and turnaround times depend on the book''s value and the tier you choose.</li><li><strong>We pack and ship.</strong> Your books go to CGC with our regular submission.</li><li><strong>Pick them up.</strong> We''ll call you when your graded books are back at the shop.</li></ol><h2>Good to know</h2><ul><li>Grading fees are set by CGC and can change; we''ll give you a current quote before submitting.</li><li>Turnaround time depends on CGC''s queue, not ours.</li><li>Questions? Call or stop by the counter.</li></ul>'),
  ('privacy', '<p>{shop_name} collects only what we need to fulfill a reservation or event signup: your name, and a phone number and/or email address.</p>', '<ul><li>We use it only to contact you about your reservation, order status, or shop events you''ve signed up for.</li><li>We never sell, rent, or share it with third parties.</li><li>It''s stored securely and kept only as long as needed for reservation history and customer service.</li><li>Just ask: contact the shop any time to find out what we have on file, or to have it removed.</li></ul><p>This site uses Google Analytics to understand how visitors use it. Analytics data is not linked to your reservations.</p>'),
  ('terms', '<p>The store policies that apply when you reserve through our website.</p>', '<ul><li><strong>Pre-orders only.</strong> Only upcoming Pre-Order titles can be reserved online. No payment is collected online — you pay in store at pickup.</li><li><strong>Reservation deadline.</strong> Reservations for a title close at midnight the night before its Final Order Cutoff (FOC) date.</li><li><strong>No holds on in-store stock.</strong> Items already on the shelf are first come, first paid, with no exceptions.</li><li><strong>Pickup window.</strong> Reservations are held for 1 month after the item arrives. Unclaimed reservations are released back to stock.</li><li><strong>Quantity limit.</strong> Up to {max_copies_per_title} copies per customer per title (subject to change).</li><li><strong>Changes &amp; cancellations.</strong> Contact the shop directly.</li></ul>')
on conflict (slug) do nothing;

insert into public.faqs (question, answer_html, sort) values
  ('How do pre-orders work?', '<p>Browse <a href="pre-orders.html">Pre-Orders</a>, add as many titles as you like to your reservation list, then leave your name and a phone number or email. Reservations close at midnight the night before the distributor''s Final Order Cutoff (FOC); we place our order on FOC day. You pay in store when you pick it up; we hold it for one month after it arrives.</p>', 10),
  ('Can you hold something that''s already on the shelf?', '<p>No. In-store stock is first come, first paid — no holds, no exceptions, so it''s fair for everyone. If you want a guaranteed copy of an upcoming book, pre-order it.</p>', 20),
  ('How do I change or cancel a reservation?', '<p>Call the shop at {phone} and give us the phone number you reserved with. We''ll look it up and take care of it.</p>', 30),
  ('What''s the dollar-bin policy?', '<p>Dollar-bin books are sold as-is. Policy details to be confirmed.</p>', 40),
  ('Do you buy or trade comics and records?', '<p>Yes — bring them in and we''ll take a look. Trade-in and buy terms to be confirmed.</p>', 50),
  ('Do you help with CGC grading?', '<p>We do. See <a href="grading.html">CGC Grading</a> for how it works.</p>', 60);
