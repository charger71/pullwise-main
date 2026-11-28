// Holiday hours: dates when a shop (or one of its locations) keeps different hours, or is closed, on top of its
// weekly opening hours. Stored as settings.holiday_hours / locations.holiday_hours, a list of
//   { date: 'YYYY-MM-DD', label?: 'Christmas Day', closed: true }
//   { date: 'YYYY-MM-DD', label?: 'Christmas Eve', open: 'HH:MM', close: 'HH:MM' }
// Shared by the storefront (what customers see) and the admin (what staff save).

import { addDays, localDate } from './dates.js';

/** How far ahead the website lists holiday hours, in days. Further-off dates wait until they come into range. */
export const HOLIDAY_LOOKAHEAD_DAYS = 60;

const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d ?? '');
const isTime = (t) => /^\d{2}:\d{2}$/.test(t ?? '');

/** A well-formed entry: a date, and either closed or open and close times. */
export const validHoliday = (h) => !!h && isDate(h.date) && (h.closed === true || (isTime(h.open) && isTime(h.close)));

/** The entries from `today` on, earliest first, dropping any that aren't well formed. What staff save. */
export const futureHolidays = (list, today) =>
  (Array.isArray(list) ? list : []).filter((h) => validHoliday(h) && h.date >= today).sort((a, b) => a.date.localeCompare(b.date));

/** The entries from `today` through `days` ahead, earliest first. What customers see. */
export const upcomingHolidays = (list, today, days = HOLIDAY_LOOKAHEAD_DAYS) => {
  const last = addDays(today, days);
  return futureHolidays(list, today).filter((h) => h.date <= last);
};

/** An entry in the form the database keeps: closed entries carry no times, open ones no `closed`; a blank label is left out. */
export const tidyHoliday = ({ date, label, closed, open, close }) => {
  const name = (label ?? '').trim();
  return { date, ...(name ? { label: name } : {}), ...(closed ? { closed: true } : { open, close }) };
};

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/**
 * The hours on `today` ('YYYY-MM-DD' in the shop's zone): a well-formed holiday entry that day wins, else the weekly
 * entry ({ days: ['Mo', …], open, close }) for that weekday. { closed: true } on a day with neither, null for a shop
 * with no hours at all.
 */
export function todayHours(hours, holidays, today) {
  const holiday = (Array.isArray(holidays) ? holidays : []).find((h) => validHoliday(h) && h.date === today);
  if (holiday) return holiday.closed ? { closed: true } : { open: holiday.open, close: holiday.close };
  if (!hours?.length) return null;
  const day = WEEKDAYS[localDate(today).getDay()];
  const entry = hours.find((h) => h.days?.includes(day));
  return entry ? { open: entry.open, close: entry.close } : { closed: true };
}
