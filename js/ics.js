// Calendar export helpers: single-event .ics files and Google/Outlook links.
// Each carries a link back to the event's page on the site.

import { SITE_URL } from './config.js';

const eventUrl = (e) => `${SITE_URL}/event.html?id=${e.id}`;
const plain = (html) => String(html ?? '').replace(/<[^>]+>/g, '').trim();
/** Description as plain text, ending with the link (calendar apps differ in whether they show a separate URL field). */
const details = (e) => `${plain(e.description)}\n\nDetails: ${eventUrl(e)}`.trim();

const stamp = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const text = (s) => String(s ?? '').replace(/<[^>]+>/g, '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, '\\$&');
const endOf = (e) => e.ends_at ?? new Date(new Date(e.starts_at).getTime() + 2 * 3600000).toISOString();

export function icsFor(e, shopName, host) {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${text(shopName)}//Events//EN`,
    'BEGIN:VEVENT',
    `UID:event-${e.id}@${host}`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(e.starts_at)}`,
    `DTEND:${stamp(endOf(e))}`,
    `SUMMARY:${text(e.title)}`,
    `DESCRIPTION:${text(details(e))}`,
    `URL:${eventUrl(e)}`,
    `LOCATION:${text(e.location ? `${shopName} — ${e.location}` : shopName)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

export function googleLink(e, location) {
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.title,
    dates: `${stamp(e.starts_at)}/${stamp(endOf(e))}`,
    details: details(e),
    location,
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}

export function outlookLink(e, location) {
  const p = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: e.title,
    startdt: new Date(e.starts_at).toISOString(),
    enddt: new Date(endOf(e)).toISOString(),
    body: details(e),
    location,
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${p}`;
}
