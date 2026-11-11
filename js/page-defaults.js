// Starting text for every editable page block and the FAQ. Staff change it on
// the admin page (stored in the `pages` and `faqs` tables); this file is only
// used for demo mode and to seed a new shop's database.
//
// HTML as the WYSIWYG editor produces it. {placeholders} are filled from shop
// settings when shown, e.g. {shop_name}, {website}, {max_copies_per_title}, {phone}.
// A <blockquote> shows as a highlighted callout box.

/** Every editable block: page key → which fields it has, for the admin editor.
 *  Blocks sharing a `group` are edited together on one admin screen. */
export const PAGE_BLOCKS = [
  { slug: 'home-top', group: 'Home', label: 'Text above Staff Picks', fields: ['body'] },
  { slug: 'home-preorders', group: 'Home', label: 'Closing soon for pre-order', fields: ['lede'] },
  { slug: 'home-funko', group: 'Home', label: 'Funko Pops', fields: ['lede'] },
  { slug: 'home-figures', group: 'Home', label: 'Action Figures', fields: ['lede'] },
  { slug: 'home-records', group: 'Home', label: 'Records', fields: ['lede'] },
  { slug: 'home-bottom', group: 'Home', label: 'Text above the email signup', fields: ['body'] },
  // Page title & description for Google; shown last on the admin screen like every page's.
  { slug: 'home', group: 'Home', label: 'Page title & description', fields: [] },
  { slug: 'pre-orders', label: 'Pre-Orders', fields: ['lede', 'body'] },
  { slug: 'new-arrivals', label: 'New Arrivals', fields: ['lede', 'body'] },
  { slug: 'calendar', label: 'Community Calendar', fields: ['lede'] },
  { slug: 'news', label: 'News', fields: ['lede'] },
  { slug: 'about', label: 'About', fields: ['lede', 'body'] },
  { slug: 'visit', label: 'Visit Us', fields: ['lede'] },
  { slug: 'we-buy-comics', label: 'We Buy Comics', fields: ['lede', 'body'] },
  { slug: 'gift-cards', label: 'Gift Cards', fields: ['lede', 'body'] },
  { slug: 'how-to', label: 'How To', fields: ['lede', 'body'] },
  { slug: 'faq', label: 'FAQ', fields: ['lede'] },
  { slug: 'privacy', label: 'Privacy', fields: ['lede', 'body'] },
  { slug: 'terms', label: 'Terms', fields: ['lede', 'body'] },
];

export const PAGES = {
  'home-figures': {
    lede: '<p>Action figures and collectibles, in the shop now and on the way.</p>',
  },
  'home-records': {
    lede: '<p>New and used vinyl — flip through the bins in person, or see what just came in.</p>',
  },
  'home-preorders': {
    lede: "<p>We place our orders with the distributors on the Final Order Cutoff (FOC) date. Add to your pull list by midnight the Saturday before and we'll order a copy just for you — pay when you pick it up.</p>",
  },
  'home-funko': {
    lede: '<p>New in the shop and coming soon — add upcoming Pops to your pull list and pay when you pick them up.</p>',
  },
  'home-newsletter': {
    lede: "<p>What's hitting the wall on Wednesday, plus pre-order reminders before cutoff.</p>",
  },
  'pre-orders': {
    lede: "<p>Add upcoming books to your pull list by <strong>midnight Saturday</strong> before the <strong>Final Order Cutoff</strong> and we'll order a copy with your name on it. <strong>Pay in-store at pickup.</strong></p>",
    body: "<ol><li>Tap <strong>Add to pull list</strong> on any title.</li><li>Sign in with your email to keep your list and get a weekly reminder, or just leave your name and a phone number and email.</li><li>We hold each title for a month after it arrives.</li></ol><p>Limit {max_copies_per_title} copies per customer per title. To change or cancel, edit your list online or call the shop. See our <a href=\"terms.html\">terms</a>.</p>",
  },
  'new-arrivals': {
    lede: "<p>What's on the shelves right now — comics, trades, omnibuses, records, toys and Funko Pops.</p>",
 
    body: "<blockquote>In-store stock can't be held or reserved: first to pay gets it. Want a guaranteed copy of something upcoming? <a href=\"pre-orders.html\">Pre-order it</a>.</blockquote>",
  },
  calendar: {
    lede: '<p>Signings, release parties, tournaments and livestreams. No RSVP needed — just show up.</p>',
  },
  news: {
    lede: '<p>New-release roundups and shop news.</p>',
  },
  about: {
    lede: '<p>Your neighborhood shop for comics, collectibles and more.</p>',
    body: "<p>Tell your shop's story here: when you opened, what you carry and who is behind the counter. Edit this text in Admin → Pages.</p><h2>The Crew</h2><p>Staff bios coming soon — in the meantime, come say hi at the counter.</p>",
  },
  visit: {
    lede: "<p>Stop by the shop — new comics every Wednesday, and we're always happy to help you find something good.</p>",
  },
  'gift-cards': {
    lede: "<p>Not sure what they're reading? A gift card is always the right size.</p>",
    body: '<h2>How They Work</h2><ul><li>Buy a gift card at the register in any amount.</li><li>Good for anything in the shop — comics, trades, records, toys, Funko Pops, and pre-orders at pickup.</li><li>Redeem in store. Any remaining balance stays on the card.</li></ul><blockquote>Online gift card purchases are coming later. For now, stop by or give us a call.</blockquote>',
  },
  'how-to': {
    lede: "<p>Everything you need to use your pull list: sign in, add titles, follow your favorite series and artists, and pick up your books. Questions? Call us at {phone}.</p>",
    body: "<h2>1. Sign in (no password needed)</h2><ol><li>Open <a href=\"account.html\">My Pull List</a> and type your email address.</li><li>Tap <strong>Email me a sign-in link</strong>. We'll email you a link and a 6-digit code.</li><li>Tap the link, or type the code into the box on the page. You're in, and you'll stay signed in on that device.</li></ol><p>Don't see the email? Check your spam folder. No account? You can still add titles as a guest with just your name and a phone number and email, but an account lets you change your list online and get reminders.</p><h2>2. Add titles to your pull list</h2><ol><li>Go to <a href=\"pre-orders.html\">Pre-Orders</a> and browse upcoming books, toys and Funko Pops.</li><li>Tap <strong>Add to pull list</strong> on anything you want. The button changes to “✓ On your pull list.” Tap it again to take it off.</li><li>Some issues have several covers. <strong>Add all covers</strong> adds every regular cover at once (ratio and other limited incentive covers are not included).</li></ol><blockquote>Add titles by <strong>midnight on the Saturday</strong> before the order cutoff shown on each card. After that we've placed the order. If you miss it, call the shop and we'll see what we can do.</blockquote><h2>3. Follow a series or artist</h2><p>Never miss an issue. Tap <strong>+ Follow</strong> on any card, then pick what to follow:</p><ul><li><strong>Series:</strong> every new issue is added to your pull list automatically.</li><li><strong>Cover artist:</strong> every cover that artist draws.</li><li><strong>Writer / artist:</strong> one cover of each issue they work on.</li></ul><p>See and change everything you follow on <a href=\"account.html\">My Pull List</a> under <strong>Following</strong>. Unfollowing stops new titles from being added; titles already on your list stay until you remove them.</p><h2>4. Manage your pull list</h2><ul><li><strong>Change a quantity</strong> using the number next to the title. It saves right away. The limit is {max_copies_per_title} copies per title.</li><li><strong>Remove</strong> a title you no longer want. If a follow added it, it won't come back.</li><li>You can make changes until the order cutoff. After that, call the shop.</li></ul><h2>5. Emails from us</h2><ul><li><strong>Weekly email:</strong> what's coming and what's on your list, plus a reminder before the cutoff.</li><li><strong>Ready for pickup:</strong> an email when your books are in.</li></ul><p>Both can be turned off any time in your profile on <a href=\"account.html\">My Pull List</a>, or with the unsubscribe link at the bottom of any email.</p><h2>6. Pick up and pay</h2><p>Come in any time after your books arrive and pay at the counter. There's nothing to pay online. We hold your books for {hold_days} days after they arrive, then release them back to stock.</p><p>Can't make it in? Call us at {phone}. Some customers have their books shipped; ask us how.</p><h2>7. Your profile and privacy</h2><p>Update your name, phone and address any time under <strong>Profile</strong> on <a href=\"account.html\">My Pull List</a>. To delete your account, use <strong>Delete my account</strong> below your profile; we keep your contact details and any books already ordered for you. To have those removed too, just ask us. See our <a href=\"privacy.html\">privacy page</a>.</p>",
  },
  faq: {
    lede: "<p>Answers to the questions we hear most at the counter. Don't see yours? Give us a call at {phone}.</p>",
  },
  privacy: {
    lede: '<p>{shop_name} collects only what we need to fulfill a reservation or event signup: your name, phone number and email address.</p>',
    body: "<ul><li>We use it only to contact you about your reservation, order status, or shop events you've signed up for.</li><li>We never sell, rent, or share it with third parties.</li><li>It's stored securely and kept only as long as needed for reservation history and customer service.</li><li>Delete your account any time on <a href=\"account.html\">My Pull List</a> (in our app: Account → Delete my account). That signs you out everywhere and stops following and notifications. We keep your name, contact details and any books we've already ordered for you, so we can reach you about them.</li><li>Just ask: contact the shop any time to find out what we have on file, or to have it removed.</li></ul><p>This site uses Google Analytics to understand how visitors use it. Analytics data is not linked to your reservations.</p>",
  },
  terms: {
    lede: "<p>The store policies that apply when you reserve through our website.</p>",
    body: '<ul><li><strong>Pre-orders only.</strong> Only upcoming Pre-Order titles can be reserved online. No payment is collected online — you pay in store at pickup.</li><li><strong>Reservation deadline.</strong> Reservations for a title close at midnight on the Saturday before its Final Order Cutoff (FOC) date, which is usually a Monday. That gives us time to collect the reservations and place the order.</li><li><strong>No holds on in-store stock.</strong> Items already on the shelf are first come, first paid, with no exceptions.</li><li><strong>Pickup window.</strong> Reservations are held for 1 month after the item arrives. Unclaimed reservations are released back to stock.</li><li><strong>Quantity limit.</strong> Up to {max_copies_per_title} copies per customer per title (subject to change).</li><li><strong>Changes &amp; cancellations.</strong> Contact the shop directly.</li></ul>',
  },
};

export const FAQS = [
  {
    question: 'How do pre-orders work?',
    answer: "<p>Browse <a href=\"pre-orders.html\">Pre-Orders</a>, add as many titles as you like to your pull list. Sign in with your email to keep and edit it online, or just leave your name and a phone number and email. You can add titles until midnight on the Saturday before the distributor's Final Order Cutoff (FOC), which is usually a Monday; we place our order on FOC day. You pay in store when you pick it up; we hold it for one month after it arrives.</p>",
  },
  {
    question: "Can you hold something that's already on the shelf?",
    answer: "<p>No. In-store stock is first come, first paid — no holds, no exceptions, so it's fair for everyone. If you want a guaranteed copy of an upcoming book, pre-order it.</p>",
  },
  {
    question: 'How do I change or cancel something on my pull list?',
    answer: "<p>If you have an account, <a href=\"account.html\">sign in</a> and change or remove titles yourself until the order cutoff. Otherwise call the shop at {phone} and give us the phone number you used. We'll look it up and take care of it.</p>",
  },
  {
    question: "What's the dollar-bin policy?",
    answer: '<p>Dollar-bin books are sold as-is. Policy details to be confirmed.</p>',
  },
  {
    question: 'Do you buy or trade comics and records?',
    answer: "<p>Yes — bring them in and we'll take a look. Trade-in and buy terms to be confirmed.</p>",
  },
];
