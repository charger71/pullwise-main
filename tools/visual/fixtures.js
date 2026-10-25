// Made-up shop data for the screenshot checks (tools/visual): enough rows on every screen to show its states
// (overdue, blocked, long names, empty fields). Dates are relative to the frozen clock the capture sets.

const iso = (d) => new Date(Date.now() + d * 864e5).toISOString();
const q = (id, type, label, extra = {}) => ({ id, type, label, required: true, ...extra });
export const FIXTURES = {
  pages: { pages: [{ slug: 'about', title: 'About', placement: 'footer', lede_html: '<p>Welcome to our shop.</p>', body_html: '<p>We have been selling comics since 1994.</p><h2>Our story</h2><p>Family owned.</p>', meta_title: 'About us', meta_description: 'Who we are', updated_at: iso(-2) }] },
  news: { posts: [
    { id: 1, title: 'Free Comic Book Day is coming to the shop this spring', slug: 'fcbd', published_at: iso(-6), updated_at: iso(-6), excerpt: 'Join us', body: '<p>Details</p>', cover_url: null },
    { id: 2, title: 'New hours for the holidays', slug: 'hours', published_at: iso(9), updated_at: iso(-1) },
    { id: 3, title: 'Staff picks for October', slug: 'picks', published_at: null, updated_at: iso(-1) } ] },
  faq: { faqs: [
    { id: 1, question: 'How do pre-orders work?', answer_html: '<p>You reserve a title before it is released and we hold it for you.</p>', sort: 1 },
    { id: 2, question: 'Can I change or cancel a reservation after the order cutoff?', answer_html: '<p>Yes, until the order cutoff.</p>', sort: 2 },
    { id: 3, question: 'Do you ship?', answer_html: '<p>Ask us.</p>', sort: 3 } ] },
  surveys: { surveys: [
    { id: 1, title: 'Customer survey 2026', slug: 'customer-2026', is_open: true, created_at: iso(-10), questions: [q('a', 'rating', 'How was your visit?'), q('b', 'choice', 'How did you hear about us?', { options: ['Friend', 'Search', 'Social media'], other: true }), q('c', 'text', 'Anything else?', { required: false })], survey_responses: [{ count: 42 }], collect_email: true, intro: 'Tell us how we did.', thank_you: 'Thanks!', email_prompt: '' },
    { id: 2, title: 'Event interest poll', slug: 'events', is_open: false, created_at: iso(-30), questions: [q('a', 'yesno', 'Would you come to a game night?')], survey_responses: [{ count: 7 }] } ],
    survey_responses: [] , qr_codes: [{ slug: 'abc123', target_url: 'https://example.com/survey.html?s=customer-2026', scan_count: 12 }] },
  qr: { qr_codes: [
    { id: 1, name: 'Free Comic Book Day flyer', target_url: 'https://example.com/fcbd.html', forward: true, slug: 'fcbd1', fg: '#000000', bg: '#ffffff', notes: 'Printed on the window poster', scan_count: 31, last_scan_at: iso(-3), created_at: iso(-20) },
    { id: 2, name: 'Menu', target_url: 'https://example.com/menu', forward: false, slug: 'menu1', fg: '#000000', bg: '#ffffff', notes: '', scan_count: 0, created_at: iso(-40) } ] },
  series: {},
  staff: { staff_audit: [
    { id: 3, created_at: iso(-0.1), staff_name: 'Dana Whitfield', table_name: 'items', action: 'update', row_count: 2, summary: [{ label: 'Batman #1', changed: { price: 1, status: 1 } }, { label: 'Saga #70', changed: { price: 1 } }] },
    { id: 2, created_at: iso(-1), staff_name: 'Chris', table_name: 'settings', action: 'update', row_count: 1, summary: [{ label: 'Shop', changed: { hours: 1 } }] },
    { id: 1, created_at: iso(-3), staff_name: null, table_name: 'customers', action: 'insert', row_count: 14, summary: [] } ] },
  import: { settings: { timezone: 'America/New_York' },
    import_exclusions: [ { id: 1, kind: 'publisher', value: 'Avatar Press' }, { id: 2, kind: 'series', value: 'Garbage Pail Kids' }, { id: 3, kind: 'keyword', value: 'Blind Box' }, { id: 4, kind: 'mature', value: '' } ],
    job_log: [ { id: 3, created_at: iso(-0.2), job: 'import', ok: true, message: 'lunar-foc-0123.xlsx: 48 added, 12 updated, 3 skipped' }, { id: 2, created_at: iso(-1), job: 'status_flip', ok: true, message: '5 titles moved to New Arrivals' }, { id: 1, created_at: iso(-2), job: 'import', ok: false, message: 'prh-release.xlsx: The file is not a spreadsheet' } ] },
};
export const EXTRA = {
  media: { files: [
    { id: 'a', name: '17000-fcbd-flyer.jpg', metadata: { size: 245000 } },
    { id: 'b', name: '16999-store-front-photo-with-a-long-file-name.png', metadata: { size: 1480000 } },
    { id: 'c', name: '16998-logo.png', metadata: { size: 31000 } } ] },
  series: { rpc: {
    staff_list_series: [
      { key: 'absolute-batman', label: 'Absolute Batman', publisher: 'DC Comics', issues: 12, cover_url: null },
      { key: 'ultimate-spider-man', label: 'Ultimate Spider-Man (2024) Extended Title Edition', publisher: 'Marvel', issues: 18, cover_url: null },
      { key: 'saga', label: 'Saga', publisher: 'Image Comics', issues: 0, cover_url: null } ],
    staff_series_catalog_count: 482,
    staff_list_artists: [ { key: 'peach-momoko', name: 'Peach Momoko', credits: 14, covers: 9, blocked: false, source: 'credited' }, { key: 'tom-king', name: 'Tom King', credits: 40, covers: 0, blocked: false, source: 'staff' }, { key: 'some-name', name: 'Some Blocked Name', credits: 0, covers: 0, blocked: true, source: 'staff' } ] } },
};
EXTRA.staff = { rpc: { staff_list: [
  { user_id: 'u1', name: 'Dana Whitfield', email: 'dana@example.com', is_owner: true, is_super: false, last_sign_in_at: iso(-0.1) },
  { user_id: 'u2', name: 'Chris', email: 'chris.longer-address@example.com', is_owner: false, is_super: false, last_sign_in_at: iso(-4) },
  { user_id: 'u3', name: 'Support', email: 'support@pullwise.com', is_owner: true, is_super: true, last_sign_in_at: null } ] } };
FIXTURES.locations = { locations: [
  { id: 1, name: 'Downtown', is_default: true, street: '12 Main St', city: 'Springfield', region: 'IL', postal_code: '62701', phone: '(555) 123-4567', map_embed_url: '', hours: [ { days: ['Mo','Tu','We','Th','Fr'], open: '11:00', close: '19:00' }, { days: ['Sa','Su'], open: '10:00', close: '17:00' } ] },
  { id: 2, name: 'Westside', is_default: false, street: '900 West Ave', city: 'Springfield', region: 'IL', postal_code: '62704', phone: '', map_embed_url: '', hours: [ { days: ['Tu','We','Th'], open: '12:00', close: '18:00' } ] } ] };

const mkItem = (id, title, issue, publisher, price, foc, rel, extra = {}) => ({ id, title, issue_number: issue, variant: extra.variant ?? null, publisher, price, foc_date: foc, release_date: rel, cover_url: null, status: extra.status ?? 'pre_order', category: 'comics', distributor: extra.distributor ?? 'lunar', sku: 'SKU' + id, upc: '7' + String(id).padStart(11, '0'), staff_pick: !!extra.pick, hidden: false, badges: [], ...extra });
const ym = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
const ITEMS = [
  mkItem(1, 'Absolute Batman', '12', 'DC Comics', 4.99, ym(6), ym(34), { pick: true }),
  mkItem(2, 'Ultimate Spider-Man (2024) Extended Title Edition', '8', 'Marvel', 3.99, ym(6), ym(34), { variant: 'Cover B Momoko' }),
  mkItem(3, 'Saga', '70', 'Image Comics', 3.99, ym(13), ym(41), { status: 'pre_order' }),
  mkItem(4, 'Invincible Compendium Vol. 1', '', 'Image Comics', 24.99, ym(-3), ym(-1), { status: 'just_arrived' }),
  mkItem(5, 'Spawn', '350', 'Image Comics', 3.99, ym(-20), ym(-14), { status: 'available' }),
];
const L = (id, order_id, item, qty, status) => ({ id, order_id, item_id: item.id, quantity: qty, status, item, arrived_on: status === 'arrived' ? ym(-2) : null, location_id: null });
const R = [L(1, 1, ITEMS[0], 1, 'open'), L(2, 1, ITEMS[1], 2, 'open'), L(3, 1, ITEMS[2], 1, 'ordered'), L(4, 2, ITEMS[3], 1, 'arrived'), L(5, 3, ITEMS[4], 1, 'picked_up'), L(6, 2, ITEMS[0], 1, 'open')];
const ORDERS = [
  { id: 1, name: 'Dana Whitfield', phone: '(555) 123-4567', email: 'dana@example.com', kind: 'pull_list', created_at: new Date(Date.now() - 36e5).toISOString(), notes: 'Will pick up Saturday', customer_id: 11, phone_digits: '5551234567', customer: { id: 11, name: 'Dana Whitfield', phone: '(555) 123-4567', email: 'dana@example.com' }, reservations: R.filter((r) => r.order_id === 1) },
  { id: 2, name: 'Chris Long-Surname-Hyphenated', phone: '(555) 987-6543', email: 'chris@example.com', kind: 'guest', created_at: new Date(Date.now() - 864e5 * 3).toISOString(), notes: '', customer_id: null, phone_digits: '5559876543', customer: null, reservations: R.filter((r) => r.order_id === 2) },
  { id: 3, name: 'Sam Rivera', phone: '(555) 555-0101', email: '', kind: 'pull_list', created_at: new Date(Date.now() - 864e5 * 40).toISOString(), notes: '', customer_id: 12, phone_digits: '5555550101', customer: { id: 12, name: 'Sam Rivera', phone: '(555) 555-0101', email: '' }, reservations: R.filter((r) => r.order_id === 3) },
];
FIXTURES.reservations = { settings: { hold_days: 30, timezone: 'America/New_York' }, reservation_orders: ORDERS, reservations: R, items: ITEMS, customers: [{ id: 11, email: 'dana@example.com' }] };
EXTRA.reservations = { rpc: {} };
FIXTURES.titles = { settings: { timezone: 'America/New_York' }, items: ITEMS.map((i) => ({ ...i, home: false, hide: false, updated_at: new Date().toISOString() })), categories: [{ id: 1, slug: 'comics', name: 'Comics' }] };

const CUST = [
  { id: 11, first_name: 'Dana', last_name: 'Whitfield', name: 'Dana Whitfield', email: 'dana@example.com', phone: '(555) 123-4567', address1: '12 Main St', user_id: 'u-11', ship_arrivals: false, email_opt_in: true, notify_arrivals: true, overdue_count: 1, ready_count: 2, active_count: 6, last_updated: new Date(Date.now() - 864e5).toISOString(), notes_text: 'Likes variants', created_at: new Date().toISOString(), home_location_id: null },
  { id: 12, first_name: 'Sam', last_name: 'Rivera', name: 'Sam Rivera', email: '', phone: '(555) 555-0101', address1: '', user_id: null, ship_arrivals: false, email_opt_in: false, notify_arrivals: false, overdue_count: 0, ready_count: 0, active_count: 1, last_updated: new Date(Date.now() - 864e5 * 400).toISOString(), notes_text: '', created_at: new Date().toISOString(), home_location_id: null },
  { id: 13, first_name: '', last_name: '', name: '', email: 'long.address.that.keeps.going@example-domain.com', phone: '', address1: '', user_id: 'u-13', ship_arrivals: true, email_opt_in: true, notify_arrivals: true, overdue_count: 0, ready_count: 0, active_count: 0, last_updated: new Date(Date.now() - 864e5 * 5).toISOString(), notes_text: '', created_at: new Date().toISOString(), home_location_id: null },
];
FIXTURES.customers = { settings: { max_copies_per_title: 5, hold_days: 30, timezone: 'America/New_York', shop_name: "Pop's Comics", colors: {}, phone: '(555) 000-0000', logo_url: null, discount_enabled: false, discount_tiers: [] }, customer_list: CUST, customers: CUST, locations: [], customer_notes: { notes: 'Likes variants', updated_at: new Date().toISOString(), updated_by: null }, reservations: R, reservation_orders: ORDERS, staff: [], pull_list_log: [{ action: 'added', detail: 'Absolute Batman #12', staff_user: null, created_at: new Date().toISOString() }], subscriptions: [{ id: 1, kind: 'series', label: 'Absolute Batman', role: null, quantity: 1, all_covers: false }] };
EXTRA.customers = { rpc: { search_series: [], search_artists: [] } };

FIXTURES.events = { events: [{ id: 5, title: 'Free Comic Book Day', event_type: 'other', location: 'In store', starts_at: new Date(Date.now() + 864e5 * 9).toISOString(), ends_at: null, summary: 'Free comics!', description: '<p>Come</p>', image_url: null, signup_enabled: true, signup_capacity: 40, location_id: null }], event_signups: [], locations: [] };
export const CTX = {};
