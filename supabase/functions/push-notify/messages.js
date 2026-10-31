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
