// What tools/help-capture records: one walk-through per Help topic that has pictures or a video. Each runs on its own,
// signed in as staff, starting at `start` (an admin address), and follows its steps in order. A step can:
//
//   say: 'Caption text'      show a caption (it stays up, long enough to read, until the next one)
//   go: '#customers'         open a screen
//   click: '<selector>'      glide the pointer there, ring it, click it
//   type: '<selector>', text: 'Saga'   click a field and type (search and filter boxes only)
//   select: '<selector>', index: 1 | value: 'lunar'   pick an option in a drop-down
//   point: '<selector>'      ring something without clicking it (unpoint: true clears the ring)
//   press: 'Escape'          press a key
//   shot: 'name'             save admin/help/media/name.png (captions and pointer hidden);
//                            highlight: '<selector>' rings one thing in the picture, area: '<selector>' crops to it
//   wait: 1500               hold this step longer (ms) than the caption needs
//   optional: true           skip the step (with a warning) when its target isn't there, e.g. a tab switched off
//
// Selectors are Playwright's (CSS, plus :has-text("…")). Only ever read: never click Save, Send, Delete, Approve or
// Mark… here. The capture stops any request that would change data anyway, but a walk-through that tries one fails.
// Pictures and videos come from the demo shop, so pick demo data that reads well and shows no real person.

export const VIEWPORT = { width: 1280, height: 800 };

const nav = (screen) => `.admin-nav a[href="#${screen}"]`;
const tab = (name) => `#section [role="tab"]:has-text("${name}")`;
const HINT = '#section h1 .icon-btn--hint';
const CLOSE = 'dialog[open] .dialog__close';

export const WALKTHROUGHS = [
  {
    id: 'getting-started',
    video: true,
    start: '#dashboard',
    steps: [
      { say: 'This is the staff admin. Every screen is in the menu on the left.', point: '.admin-nav', shot: 'admin-overview' },
      { say: 'Screens are grouped: Pull List, Website, and Utilities for owners.', point: '.admin-nav__heading:has-text("Website")' },
      { say: 'Every screen has a ? beside its title. It explains what the screen does.', click: HINT, shot: 'how-this-works' },
      { say: 'The link at the bottom opens the full guide for that screen.', point: 'dialog[open] [data-help-link]' },
      { click: CLOSE },
      { say: 'Help is always at the bottom of the menu.', click: nav('help'), shot: 'help-index' },
      { say: 'Your name, top right, opens My account and Sign out.', click: '#account-btn', shot: 'account-menu', highlight: '#account-menu' },
      { press: 'Escape' },
    ],
  },
  {
    id: 'dashboard',
    video: true,
    start: '#dashboard',
    steps: [
      { click: tab('Today') },
      { say: 'The Dashboard opens on Today: what needs doing now.', shot: 'dashboard-today' },
      { say: 'The tiles count new orders, copies to order and books ready for pickup.', point: '#section .dash-tile' },
      { say: 'Needs Attention lists problems, each with a button that takes you to the fix.', point: '#dash-attn', shot: 'dashboard-attention', highlight: '#dash-attn' },
      { say: 'The Special Announcement bar shows across the top of your website. Click it to change it.', point: '#dash-announce-title' },
      { say: 'Trends shows orders per day and the most-reserved titles.', click: tab('Trends'), shot: 'dashboard-trends' },
      { say: 'System shows whether the nightly jobs and backups ran on time.', click: tab('System'), shot: 'dashboard-system' },
      { click: tab('Today') },
    ],
  },
  {
    id: 'ordering',
    video: false,
    start: '#reservations',
    steps: [
      { click: tab('Reservations') },
      { shot: 'ordering-reservations' },
      { click: '#section [data-body] tbody tr', shot: 'ordering-order-open', optional: true },
    ],
  },
  {
    id: 'place-order',
    video: true,
    start: '#reservations',
    steps: [
      { say: 'At each order cutoff, start on Ordering → Store Order.', click: tab('Store Order') },
      { say: 'A shop with more than one location picks the location first.', select: '#r-loc', index: 1, shot: 'store-order', optional: true },
      { say: 'Type the copies the store wants for its shelves. Each number saves as you type.', point: '#section [data-body] input[type="number"], #section [data-body] input[inputmode="numeric"]', optional: true },
      { say: 'Customers shows what customers reserved. Copies is the total sent to the distributor.', unpoint: true },
      { say: 'Then open Place Order. It lists every title to order, cutoff by cutoff.', click: tab('Place Order'), shot: 'place-order' },
      { say: 'Pick one cutoff…', select: '#ot-foc', index: 1 },
      { say: '…and Lunar or PRH, for the file to upload or paste on their site.', select: '#ot-dist', value: 'lunar', shot: 'place-order-lunar', highlight: '#section .order-tools' },
      { say: 'Lunar gets a file for its Upload FOC Edits page. PRH gets lines to paste into its cart.', point: '#section [data-file]' },
      { say: 'Once the order is placed on their site, mark the cutoff ordered here.', unpoint: true, wait: 2500 },
    ],
  },
  {
    id: 'receiving',
    video: true,
    start: '#reservations',
    steps: [
      { say: 'On new-release day, open Ordering → Received.', click: tab('Received'), shot: 'received' },
      { say: 'Every title out this week is listed, with the copies customers reserved and the store ordered.', point: '#section [data-ready] table' },
      { say: 'Only titles with copies coming hides the rest.', click: '#rd-reserved' },
      { say: 'Tick what came in: Tick all shown, then untick anything that didn’t arrive.', click: '#section button:has-text("Tick all shown")' },
      { say: 'Then Mark … ready. Customers see their books as ready for pickup.', point: '#section [data-go]', shot: 'received-mark-ready', highlight: '#section [data-go]' },
      { say: 'Re-order is for titles past their cutoff, like trades that stay in print.', click: tab('Re-order'), shot: 'reorder' },
    ],
  },
  {
    id: 'customers',
    video: true,
    start: '#customers',
    steps: [
      { click: tab('All Customers') },
      { say: 'Customers lists everyone with an account, and anyone you add.', shot: 'customers-list' },
      { say: 'Search by name, phone, email or pickup code.', type: '#c-q', text: 'Bishop' },
      { say: 'Open a customer to see their pull list.', click: '#section [data-rows] tr [data-open]' },
      { say: 'Pull List shows everything they have reserved and the series they follow.', click: tab('Pull List'), shot: 'customer-pull-list' },
      { say: 'Add to Pull List finds a pre-order title to add while they’re at the counter.', point: '#cu-add', shot: 'customer-add-title', highlight: '#cu-add' },
      { say: 'Profile holds their details and private notes.', click: tab('Profile'), shot: 'customer-profile' },
      { click: '#section [data-back]' },
      { say: 'New customer adds someone who doesn’t have an account yet.', point: '#section [data-new]' },
    ],
  },
  {
    id: 'accounts',
    video: true,
    start: '#customers',
    steps: [
      { say: 'Unclaimed lists customers whose books have waited too long.', click: tab('Unclaimed'), shot: 'customers-unclaimed' },
      { say: 'Approvals lists new accounts and orders waiting for a yes from staff.', click: tab('Approvals'), shot: 'customers-approvals', optional: true },
      { say: 'The rules are under Shop Settings → Pickups & Accounts.', go: '#settings' },
      { click: tab('Pickups') },
      { say: 'Turn on pausing for unclaimed books, and verification for new accounts.', shot: 'settings-pickups' },
    ],
  },
  {
    id: 'titles',
    video: true,
    start: '#titles',
    steps: [
      { say: 'Titles lists every comic, book and product the catalog brings in.', click: tab('All'), shot: 'titles-all' },
      { say: 'The FOC tab shows titles whose order cutoff is coming up: this week, or next week from Wednesday.', click: '#section [data-weektab="foc"]', shot: 'titles-foc' },
      { say: 'Out This Week shows what releases on Wednesday.', click: tab('Out This Week') },
      { say: 'Click a title to see everything about it, change its status, or mark it a staff pick.', click: tab('All') },
    ],
  },
  {
    id: 'emails',
    video: true,
    start: '#emails',
    steps: [
      { say: 'Email Settings sets when the weekly and “your books are in” emails go out.', click: tab('Email Settings'), shot: 'emails-settings' },
      { say: 'Send is where you check an email before customers get it.', click: tab('Send'), shot: 'emails-send' },
      { say: 'Preview shows the email as a customer will see it.', click: '#section [data-email="preview"]' },
      { point: 'dialog[open] .email-preview', shot: 'emails-preview', wait: 2500 },
      { click: CLOSE },
      { say: 'Send a test to me emails it to you. Never use Send to everyone to test.', point: '#section [data-email="test"]' },
      { say: 'Email Log lists what was sent and when.', click: tab('Email Log'), shot: 'emails-log' },
    ],
  },
  {
    id: 'news-events',
    video: true,
    start: '#news',
    steps: [
      { say: 'News lists your posts: published, scheduled and drafts.', click: tab('All'), shot: 'news-list' },
      { say: 'New post opens a full page with the editor, a picture and a publish date.', click: '#section [data-new]', shot: 'news-editor' },
      { say: 'Events works the same way, and adds them to the calendar on your site.', go: '#events' },
      { click: tab('Upcoming'), shot: 'events-list' },
      { say: 'Event Signups shows who signed up for each event.', click: tab('Event Signups'), shot: 'events-signups' },
    ],
  },
  {
    id: 'website',
    video: false,
    start: '#pages',
    steps: [
      { click: tab('All Pages'), shot: 'pages-list' },
      { click: tab('Menu Order'), shot: 'pages-menu-order' },
      { go: '#faq', shot: 'faq' },
      { go: '#media', wait: 2500 },
      { shot: 'media' },
      { go: '#qr', shot: 'qr' },
      { go: '#surveys', shot: 'surveys' },
    ],
  },
  {
    id: 'setup',
    video: false,
    start: '#settings',
    steps: [
      { click: tab('Shop'), shot: 'settings-shop' },
      { click: tab('Logo'), shot: 'settings-look' },
      { click: tab('Pre-Orders'), shot: 'settings-stock' },
      { go: '#staff' },
      { click: tab('My Account'), shot: 'staff-my-account' },
      { click: tab('Change Log'), shot: 'staff-change-log' },
      { go: '#series' },
      { click: tab('All Series'), shot: 'series-list' },
      { go: '#import' },
      { click: tab('Import Files'), shot: 'import-files' },
      { click: tab('Always Skip'), shot: 'import-skip' },
      { go: '#chat', shot: 'chat' },
      { go: '#analytics', wait: 3000 },
      { shot: 'analytics' },
      { go: '#backup' },
      { click: tab('Backups'), shot: 'backup' },
    ],
  },
];

/** Every screenshot the walk-throughs make. */
export const SHOTS = WALKTHROUGHS.flatMap((w) => w.steps.filter((s) => s.shot).map((s) => s.shot));
/** Every video they make. */
export const VIDEOS = WALKTHROUGHS.filter((w) => w.video).map((w) => w.id);
