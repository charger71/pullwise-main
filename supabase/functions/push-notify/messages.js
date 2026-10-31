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

/** Titles a series or artist the customer follows added to their list. */
export function newTitlesMessage(lines) {
  const names = titles(lines);
  return {
    title: names.length === 1 ? 'New on your pull list' : `${names.length} new titles on your pull list`,
    body: `${nameList(names)}, from what you follow. Remove any you don’t want before the order cutoff.`,
    url: linkFor(lines, names),
    tag: 'new-titles',
  };
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

/** The first notification after turning them on, so the customer sees it works. */
export const testMessage = (shopName = '') => ({
  title: shopName.trim() || 'Notifications are on',
  body: 'Notifications are on. We’ll let you know when your books are ready for pickup.',
  url: '/app#me',
  tag: 'test',
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
