// What the app's notifications say: pure functions, so Node can test them (messages.test.js). index.ts sends them.
// A notification is { title, body, url, tag, icon, badge? }; sw.js shows it, and tapping it opens the app at `url`:
// the title's details when it's about one title, else My List. `badge` is the number for the app's icon.
// Notifications with the same tag replace each other on the phone, so a second "ready" push doesn't stack up.

/** "Absolute Batman #14", as on the site (js/util.js itemTitle). */
export const itemTitle = (i) => (i.issue_number ? `${i.title} #${i.issue_number}` : i.title);

/** "A", "A and B", "A, B and 3 more": at most `show` names. */
export function nameList(names, show = 2) {
  const n = names.length;
  if (n <= show) return n === 2 ? `${names[0]} and ${names[1]}` : names.join('');
  const more = n - show;
  return `${names.slice(0, show).join(', ')} and ${more} more`;
}

/** The distinct titles of some lines (several covers of one issue count once), in the order given. */
const titles = (lines) => [...new Set(lines.map((l) => itemTitle(l.item ?? { title: 'A title' })))];

/** Where tapping goes: one title's details (js/title-modal.js opens ?title=), or My List for several. */
const linkFor = (lines, names) => {
  const id = Number(lines[0]?.item?.id);
  return names.length === 1 && id > 0 ? `/app?title=${id}#list` : '/app#list';
};

/** Books newly ready for pickup; `readyCount` is every line waiting at the counter (the icon's number). */
export function arrivalMessage(lines, shopName = '', readyCount = lines.length) {
  const names = titles(lines);
  const at = shopName.trim() ? ` at ${shopName.trim()}` : '';
  return {
    title: names.length === 1 ? 'Your book is ready for pickup' : `${names.length} books are ready for pickup`,
    body: `${nameList(names)} ${names.length === 1 ? 'is' : 'are'} waiting for you${at}.`,
    url: linkFor(lines, names),
    tag: 'arrivals',
    badge: readyCount,
  };
}

/**
 * Titles a series or artist the customer follows added to their list. `skipUrl(line)` makes the one-tap Skip link
 * (weekly-pull-list's ?u=&skip=); a notice about a single line gets a Skip button (sw.js), several only open the list.
 */
export function newTitlesMessage(lines, { skipUrl } = {}) {
  const names = titles(lines);
  const msg = {
    title: names.length === 1 ? 'New on your pull list' : `${names.length} new titles on your pull list`,
    body: `${nameList(names)}, from what you follow. Remove any you don’t want before the order cutoff.`,
    url: linkFor(lines, names),
    tag: 'new-titles',
  };
  if (lines.length === 1 && lines[0].id && skipUrl) {
    msg.body = `${nameList(names)}, from what you follow. Tap Skip to take it off, or leave it and it stays.`;
    msg.skip = { url: skipUrl(lines[0]), title: names[0] };
  }
  return msg;
}

// Calendar days as YYYY-MM-DD (no time zones), as in weekly-pull-list/email.js.
const parse = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
export const addDays = (iso, n) => new Date(parse(iso) + n * 864e5).toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.round((parse(to) - parse(from)) / 864e5);

/** Today's date at the shop, YYYY-MM-DD. */
export const shopToday = (timeZone = 'America/New_York', now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

/** "Sat, Nov 7" for a YYYY-MM-DD date. */
export const dayLabel = (iso) => new Date(parse(iso)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

/** The last day a customer can change a title whose FOC is `foc`: the Saturday before it (js/dates.js lastReserveDay). */
export const lastChangeDay = (foc) => {
  const dow = new Date(parse(foc)).getUTCDay();
  return addDays(foc, -(dow === 6 ? 7 : dow + 1));
};

/** The FOC dates whose last day to change is `day` (the order cutoffs a reminder about `day` covers). */
export const focsChangingOn = (day) => [1, 2, 3, 4, 5, 6, 7].map((n) => addDays(day, n)).filter((foc) => lastChangeDay(foc) === day);

/**
 * Which pickup reminder a waiting line is due today: 1 after a week, 2 when two days of the hold are left (or fewer),
 * 0 for none. A line gets each at most once (`pickup_reminders` counts them), none once its hold is over, and a short
 * hold skips straight to the second. The hourly tick (push_notify_tick) checks the same.
 */
export function pickupDue(line, today, holdDays) {
  if (!line.arrived_on) return 0;
  const waited = daysBetween(line.arrived_on, today);
  const left = holdDays - waited;
  const had = line.pickup_reminders ?? 0;
  if (left < 0) return 0;
  if (left <= 2) return had < 2 ? 2 : 0;
  if (waited >= 7) return had < 1 ? 1 : 0;
  return 0;
}

/** Books still waiting at the counter. `stage` 2 is the last call; `holdUntil` the first of their holds to end. */
export function pickupReminderMessage(lines, { stage, holdUntil, shopName = '', readyCount = lines.length }) {
  const names = titles(lines);
  const at = shopName.trim() ? ` at ${shopName.trim()}` : '';
  const one = names.length === 1;
  return {
    title: stage === 2 ? `Last days to pick up your ${one ? 'book' : 'books'}` : one ? 'Your book is still waiting' : 'Your books are still waiting',
    body: stage === 2
      ? `Pick up ${nameList(names)}${at} by ${dayLabel(holdUntil)}, or ${one ? 'it' : 'they'} may go back on the shelf.`
      : `${nameList(names)} ${one ? 'is' : 'are'} waiting for you${at}. We’ll hold ${one ? 'it' : 'them'} until ${dayLabel(holdUntil)}.`,
    url: linkFor(lines, names),
    tag: 'pickup',
    badge: readyCount,
  };
}

/** The day before the last day to change the list (`day`): the open titles going into that order. */
export function cutoffMessage(lines, day) {
  const names = titles(lines);
  return {
    title: 'Last chance to change your pull list',
    body: `${nameList(names)}: change or remove ${names.length === 1 ? 'it' : 'them'} by tomorrow (${dayLabel(day)}), before the shop places its order.`,
    url: '/app#list',
    tag: 'cutoff',
  };
}

/** Statuses that mean a title is on the shop's shelf (what a "tell me when it's in" alert waits for). */
export const IN_STOCK = ['new_this_wednesday', 'just_arrived', 'available', 'low_stock', 'sale', 'clearance'];

/** Titles the customer asked about that are in the shop now. In-store titles can't be held, so it says so. */
export function inStockMessage(items, shopName = '') {
  const names = titles(items.map((item) => ({ item })));
  const at = shopName.trim() ? ` at ${shopName.trim()}` : '';
  const id = Number(items[0]?.id);
  return {
    title: names.length === 1 ? 'It’s in' : `${names.length} titles you asked about are in`,
    body: `${nameList(names)} ${names.length === 1 ? 'is' : 'are'} in${at}. In-store titles aren’t held, so come in soon.`,
    url: names.length === 1 && id > 0 ? `/app?title=${id}#hot` : '/app#hot',
    tag: 'in-stock',
  };
}

/** The first notification after turning them on, so the customer sees it works. */
export const testMessage = (shopName = '') => ({
  title: shopName.trim() || 'Notifications are on',
  body: 'Notifications are on. We’ll let you know when your books are ready for pickup.',
  url: '/app#me',
  tag: 'test',
});

// ---- Staff: live chat (admin/sw.js shows these; tapping opens the chat in the admin) ---------------------------------

const CHAT_SNIPPET = 140;

/** A visitor's chat message, for staff devices. `unread` is how many messages of theirs nobody has read yet. */
export function staffChatMessage({ id, name, body, unread = 1 }) {
  const who = String(name ?? '').trim() || 'A visitor';
  const text = String(body ?? '').replace(/\s+/g, ' ').trim();
  return {
    title: unread > 1 ? `${who} (${unread} new messages)` : `Chat from ${who}`,
    body: text.length > CHAT_SNIPPET ? `${text.slice(0, CHAT_SNIPPET - 1)}…` : text,
    url: `/admin/#chat/${Number(id)}`,
    tag: `chat-${Number(id)}`, // the same tag the admin's own alert uses, so one chat shows once
  };
}

/** The shop answered a customer's chat (one they started signed in). Tapping opens the app with the chat open. */
export function chatReplyMessage({ shopName = '', body = '' }) {
  const shop = String(shopName).trim();
  const text = String(body ?? '').replace(/\s+/g, ' ').trim();
  return {
    title: shop ? `${shop} replied` : 'The shop replied',
    body: text.length > CHAT_SNIPPET ? `${text.slice(0, CHAT_SNIPPET - 1)}…` : text,
    url: '/app?chat=1',
    tag: 'chat-reply', // one notice for the chat at a time
  };
}

/** The test a staff member sends to their own devices from the Chat screen. */
export const staffTestMessage = (shopName = '') => ({
  title: shopName.trim() ? `${shopName.trim()} · Staff` : 'Chat notifications are on',
  body: 'Chat notifications are on. We’ll let you know here when a visitor writes.',
  url: '/admin/#chat',
  tag: 'staff-test',
});

// ---- Shop news: staff write these themselves (admin/sections/notifications.js; the screen checks the same limits) ---

export const NEWS_TITLE_MAX = 60;
export const NEWS_BODY_MAX = 180;
export const NEWS_URL_MAX = 300;

/** Characters as a person counts them: an emoji is one. */
export const charCount = (s = '') => Array.from(String(s)).length;

/**
 * A link on the shop's own site: a path from its root, never another site (`//host`, a full URL, or a backslash,
 * which URL parsers read as `/`, so `/\host` is another site). No spaces or control characters.
 */
export const validNewsUrl = (url = '') => /^\/(?!\/)/.test(url) && url.length <= NEWS_URL_MAX && !/[\s\\\x00-\x1f\x7f]/.test(url);

/** Why this message can't be sent (a sentence for staff), or null when it's fine. No link opens the app. */
export function checkNews({ title = '', body = '', url = '' } = {}) {
  const t = String(title).trim();
  const b = String(body).trim();
  if (!t) return 'Write a title.';
  if (charCount(t) > NEWS_TITLE_MAX) return `Keep the title to ${NEWS_TITLE_MAX} characters.`;
  if (!b) return 'Write a message.';
  if (charCount(b) > NEWS_BODY_MAX) return `Keep the message to ${NEWS_BODY_MAX} characters.`;
  if (!validNewsUrl(url || '/app')) return 'The link must be a page on your own site.';
  return null;
}

/**
 * How many devices shop news sends to at the same time. It goes to every device, and one by one a few thousand would
 * outlast the function's time limit; 20 at once is still far below what the push services accept from one sender.
 */
export const NEWS_AT_ONCE = 20;

/** Run `fn` on every item, never more than `limit` at the same time (1 is a plain loop, in order). */
export async function eachAtOnce(items, limit, fn) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
}

/** The notification for one send (`id` from news_pushes): its own tag, so two sends don't replace each other. */
export const newsMessage = ({ id, title, body, url }) => ({
  title: String(title).trim(),
  body: String(body).trim(),
  url: url || '/app',
  tag: `news-${id}`,
});

/**
 * The app icon for notifications: the shop's tab icon (or logo) at 192px, squared by Supabase's image service, as in
 * the app's manifest (worker/shop-page.js appManifest). Only pictures in the shop's own storage are resized.
 */
export function notificationIcon(settings = {}) {
  const src = settings.favicon_url || settings.logo_url;
  const m = /^(https:\/\/[^/?#]+\/storage\/v1\/)object\/public\/([^?#]+)$/.exec(src ?? '');
  if (m) return `${m[1]}render/image/public/${m[2]}?width=192&height=192&resize=contain&quality=75&format=origin`;
  return /^https:\/\//.test(src ?? '') ? src : undefined;
}

/** A push service's answer meaning the phone or browser has dropped this subscription for good. */
export const subscriptionGone = (statusCode) => statusCode === 404 || statusCode === 410;
