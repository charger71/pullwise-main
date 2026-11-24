// The Help topics, in the order the Help screen lists them. Each topic's text is admin/help/articles/<id>.js.
//
//   screens  the admin screens (route names in admin.js) whose How this works links to this topic
//   video    the walk-through's file in admin/help/media (<video>.mp4, .jpg poster, .vtt captions), made by
//            tools/help-capture (npm run help:capture); null for a topic with pictures only
//
// The shots and videos an article uses must be ones tools/help-capture/walkthroughs.mjs makes: help.test.js checks.

export const GROUPS = [
  ['start', 'Getting started'],
  ['pull', 'Pull lists and ordering'],
  ['web', 'Your website'],
  ['shop', 'Shop setup'],
];

export const TOPICS = [
  { id: 'getting-started', group: 'start', title: 'Getting around the admin', summary: 'Signing in, the menu, How this works, and what to do when a screen looks out of date.', screens: [], video: 'getting-started' },
  { id: 'your-week', group: 'start', title: 'A week in Pullwise', summary: 'Which screen to open on which day: order cutoffs, new-release day and pickups.', screens: [], video: null },
  { id: 'dashboard', group: 'start', title: 'The Dashboard', summary: 'Today’s orders, what needs attention, trends and the scheduled jobs.', screens: ['dashboard'], video: 'dashboard' },

  { id: 'ordering', group: 'pull', title: 'Reservations and title statuses', summary: 'Find an order and move its titles from open to ordered, ready and picked up.', screens: ['reservations'], video: null },
  { id: 'place-order', group: 'pull', title: 'Placing your order at the cutoff', summary: 'Store copies, totals and the Lunar and PRH order files.', screens: [], video: 'place-order' },
  { id: 'receiving', group: 'pull', title: 'New-release day: receiving books', summary: 'Mark what came in as ready, and re-order titles after the cutoff.', screens: [], video: 'receiving' },
  { id: 'customers', group: 'pull', title: 'Customers and pull lists', summary: 'Find a customer, add or change titles at the counter, and add a new customer.', screens: ['customers'], video: 'customers' },
  { id: 'accounts', group: 'pull', title: 'Approvals, unclaimed books and pauses', summary: 'Approve new accounts, follow up on books left waiting, and pause or resume a pull list.', screens: [], video: 'accounts' },
  { id: 'titles', group: 'pull', title: 'Titles and the catalog', summary: 'Where titles come from, FOC and Out This Week, staff picks, and fixing a title.', screens: ['titles'], video: 'titles' },
  { id: 'series', group: 'pull', title: 'Series and creators', summary: 'Merge series named two ways, set covers, and manage the series customers can follow.', screens: ['series'], video: null },
  { id: 'emails', group: 'pull', title: 'Customer emails', summary: 'The weekly pull list email, “your books are in”, previews and tests.', screens: ['emails'], video: 'emails' },
  { id: 'chat', group: 'pull', title: 'Live chat', summary: 'Turning chat on and off, answering visitors, and tidying old chats.', screens: ['chat'], video: null },
  { id: 'notifications', group: 'pull', title: 'Notifications to app users', summary: 'Tell everyone with the app about a sale, a big release or a closure, and test it on your own phone first.', screens: ['notifications'], video: null },

  { id: 'news-events', group: 'web', title: 'News posts and events', summary: 'Write a post, add an event to the calendar, and see who signed up.', screens: ['news', 'events'], video: 'news-events' },
  { id: 'pages', group: 'web', title: 'Pages, menu and FAQ', summary: 'Change a page’s words, add a page, reorder the menu and edit the FAQ.', screens: ['pages', 'faq'], video: null },
  { id: 'media', group: 'web', title: 'Media library', summary: 'Upload pictures and files, and copy a link to use elsewhere.', screens: ['media'], video: null },
  { id: 'qr-surveys', group: 'web', title: 'QR codes and surveys', summary: 'Make a printable QR code, run a survey and read the results.', screens: ['qr', 'surveys'], video: null },

  { id: 'settings', group: 'shop', title: 'Shop settings', summary: 'Hours, logo and colors, online links, pre-order rules and pickup rules.', screens: ['settings', 'locations'], video: null },
  { id: 'staff', group: 'shop', title: 'Staff and your account', summary: 'Change your password, add a staff member and read the change log.', screens: ['staff'], video: null },
  { id: 'import', group: 'shop', title: 'Importing titles and pull lists', summary: 'Distributor sheets, bringing in a shop’s existing pull lists, and Always Skip.', screens: ['import'], video: null },
  { id: 'analytics-backup', group: 'shop', title: 'Analytics and backups', summary: 'Sales and search trends, downloading a backup, and restoring.', screens: ['analytics', 'backup'], video: null },
];

/** The topic a screen's How this works links to, or undefined. */
export const topicForScreen = (screen) => TOPICS.find((t) => t.screens.includes(screen));

/** Videos and pictures that tools/help-capture has made (kept up to date by the capture run). */
export { CAPTURED } from './media/captured.js';
