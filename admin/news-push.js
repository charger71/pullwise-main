// Shop news (Admin → Notifications): what the screen works out and says. Pure functions, so Node can test them
// (news-push.test.js); sections/notifications.js shows them. The server checks the message again
// (supabase/functions/push-notify/messages.js checkNews).

const URL_MAX = 300;

/** Where a tap opens, besides a page on the shop's website. */
export const APP_TARGETS = [
  { value: '/app', label: 'The app' },
  { value: '/app#list', label: 'My List' },
  { value: '/app#hot', label: 'Hot' },
  { value: '/app#shop', label: 'Shop' },
];

const OWN_SITE = 'Use a page on your own site, like /news/big-sale.';

/** A page on the shop's site, as the path a notice opens: a full address must be on this shop's own `host`. */
export function toNewsPath(input, host) {
  const v = String(input ?? '').trim();
  if (!v) return { path: '/app' };
  if (/[\\\x00-\x1f\x7f]/.test(v)) return { error: OWN_SITE }; // a browser reads \ as /, so /\host is another site
  let path;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith('//')) {
    let url;
    try {
      url = new URL(v, `https://${host}`);
    } catch {
      return { error: OWN_SITE };
    }
    if (url.host !== host || !/^https?:$/.test(url.protocol)) return { error: OWN_SITE };
    path = url.pathname + url.search + url.hash;
  } else {
    path = v.startsWith('/') ? v : `/${v}`;
  }
  if (/\s/.test(path)) return { error: 'A link can’t have spaces in it.' };
  if (path.length > URL_MAX) return { error: 'That link is too long.' };
  return { path };
}

/** The newest send that went to customers (not a test, not failed); rows come newest first. */
export const lastReal = (rows) => rows.find((r) => !r.test && r.status !== 'failed') ?? null;

/** Calendar days between `iso` and `now`, in local time: 0 is today. */
export function daysAgo(iso, now = new Date()) {
  const day = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((day(now) - day(new Date(iso))) / 86400000);
}

const when = (days) => (days <= 0 ? 'earlier today' : days === 1 ? 'yesterday' : `${days} days ago`);

/** "Last sent 3 days ago by Sam", or "Never sent". */
export function lastSentText(rows, now = new Date()) {
  const last = lastReal(rows);
  if (!last) return 'Never sent';
  return `Last sent ${when(daysAgo(last.created_at, now))}${last.sent_by_name ? ` by ${last.sent_by_name}` : ''}`;
}

/** The confirm dialog's warning when the shop sent one less than 3 days ago; null otherwise. */
export function recentWarning(rows, now = new Date()) {
  const last = lastReal(rows);
  if (!last) return null;
  const days = daysAgo(last.created_at, now);
  return days < 3 ? `You sent one ${when(days)}.` : null;
}

const devicesText = (n) => `${n} device${n === 1 ? '' : 's'}`;

/** How many devices a send reaches now. */
export const reachText = (n) => (n > 0 ? `Reaches ${devicesText(n)}` : 'No customers have shop news turned on yet.');

/** What a test send did. */
export const testResultText = (devices) =>
  devices > 0
    ? `Test sent to your ${devicesText(devices)}.`
    : 'You have no devices with the app’s notifications on. Sign in to the app with this account and turn notifications on, then try again.';

// A send still "sending" after this long was stopped by the server's time limit before it could say how it went.
const STUCK_AFTER = 10 * 60000;
const stuck = (row, now) => row.status === 'sending' && now - new Date(row.created_at) > STUCK_AFTER;

/** Whether any row is still going out, so the screen should look again shortly. */
export const stillSending = (rows, now = new Date()) => rows.some((r) => r.status === 'sending' && !stuck(r, now));

/** One history row's outcome. */
export function rowSummary(row, now = new Date()) {
  if (stuck(row, now)) return `Didn’t finish: may have reached only some of ${devicesText(row.devices ?? 0)}`;
  if (row.status === 'sending') return 'Sending…';
  if (row.status === 'failed') return `Failed: ${row.error ?? 'unknown error'}`;
  return devicesText(row.devices ?? 0) + (row.failed > 0 ? ` · ${row.failed} failed` : '');
}
