// Calendar-date helpers shared by the site and the admin. Dates are YYYY-MM-DD strings;
// "today" follows the shop's timezone so cutoffs match what the database enforces.

/** Parse a YYYY-MM-DD date as a local calendar date (not UTC midnight). */
export const localDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** YYYY-MM-DD plus n days. */
export const addDays = (iso, n) => {
  const d = localDate(iso);
  d.setDate(d.getDate() + n);
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
};

/** The Sunday that starts the shop week containing `iso` (the week rolls over at Sunday midnight). */
export const weekStart = (iso) => addDays(iso, -localDate(iso).getDay());

const ymdIn = (date, timeZone) => {
  const opts = { year: 'numeric', month: '2-digit', day: '2-digit' };
  try {
    return new Intl.DateTimeFormat('en-CA', { ...opts, timeZone: timeZone || undefined }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-CA', opts).format(date); // unknown zone: use the browser's
  }
};

/** Today's date in `timeZone`, as YYYY-MM-DD. */
export const todayIn = (timeZone) => ymdIn(new Date(), timeZone);

/** The calendar date of a timestamp in `timeZone`, as YYYY-MM-DD. */
export const dayIn = (timestamp, timeZone) => ymdIn(new Date(timestamp), timeZone);

/** Last day a reservation that arrived on `arrivedOn` is held, or '' if it hasn't arrived. */
export const holdUntil = (arrivedOn, holdDays = 30) => (arrivedOn ? addDays(arrivedOn, holdDays) : '');

/** 2026-10-01-1843: date and time in `timeZone`, so two exports on one day never share a file name. */
export const stampIn = (timeZone) => {
  const t = new Intl.DateTimeFormat('en-GB', { timeZone: timeZone || undefined, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
  return `${todayIn(timeZone)}-${t.replace(':', '')}`;
};

/**
 * Last day customers can reserve a title whose FOC is `foc`: the Saturday before it (the
 * reservation closes at midnight that night). FOC is usually a Monday, so that gives the
 * shop Sunday and Monday to collect the reservations and place the order. The database
 * (reservations_close_saturday migration) and the weekly email (email.js, which has its own
 * copy because the Edge Function deploys on its own) apply the same rule; dates.test.js
 * checks that they agree.
 */
export const lastReserveDay = (foc) => {
  const dow = localDate(foc).getDay(); // 0 = Sunday … 6 = Saturday
  return addDays(foc, -(dow === 6 ? 7 : dow + 1));
};

/** "Thu, Oct 1, 6:43 PM" for a timestamp, in `timeZone`. */
export const whenIn = (timestamp, timeZone) =>
  timestamp ? new Date(timestamp).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: timeZone || undefined }) : '';

// ---------------------------------------------------------------------------
// The shop's timezone. The site (initPage) and the admin (once signed in) set it from Shop Settings, so "today" and
// the order cutoffs here match what the database enforces wherever the visitor or staff member is.
// ---------------------------------------------------------------------------

let shopZone; // undefined until set: the browser's own zone

/** The zone if this browser knows it, else undefined (the browser's own), so a typo in settings can't break dates. */
export const knownZone = (tz) => {
  try {
    return tz ? new Intl.DateTimeFormat('en-US', { timeZone: tz }).resolvedOptions().timeZone : undefined;
  } catch {
    return undefined;
  }
};

export const setShopTimeZone = (tz) => (shopZone = knownZone(tz));
export const shopTimeZone = () => shopZone;

/** Today's date in the shop's timezone, as YYYY-MM-DD. */
export const shopToday = () => todayIn(shopZone);

/** Whole days from today (shop time) until an ISO date (negative if past). */
export const daysUntil = (iso) => Math.round((localDate(iso) - localDate(shopToday())) / 86400000);

// Reservations close at midnight (shop time) on the Saturday before a title's FOC (usually a Monday), so the shop has
// time to collect and place the order. The database enforces the same rule in create_reservation_order().
export const cutoffPassed = (item) => !!item?.foc_date && daysUntil(lastReserveDay(item.foc_date)) < 0;

/** A date for display. Plain YYYY-MM-DD dates are calendar days and shown as-is; timestamps in `timeZone` (undefined: the browser's). */
export const fmtDateIn = (iso, opts = { month: 'short', day: 'numeric' }, timeZone) =>
  !iso ? ''
  : iso.length === 10 ? new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { ...opts, timeZone: 'UTC' })
  : new Date(iso).toLocaleDateString(undefined, { ...opts, timeZone });

/** A timestamp's time of day, in `timeZone` (undefined: the browser's). */
export const fmtTimeIn = (iso, timeZone) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone });
