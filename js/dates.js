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
