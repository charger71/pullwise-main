// Calendar export helpers: single-event .ics files and Google/Outlook links.
// Each carries a link back to the event's page on the site.

import { SITE_URL } from './config.js';

// The text helpers below are the same as supabase/functions/calendar-feed/ical.js (the Edge Function deploys on
// its own, so it has its own copy); ics.test.js checks that they agree.
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©', reg: '®', trade: '™' };
const BLOCK = 'p|div|h[1-6]|ul|ol|blockquote|pre|table|tr|section|article|figure|figcaption|hr';

/** Plain text from the admin editor's HTML: one line per block, a blank line between paragraphs, entities decoded. */
export function htmlToText(html) {
  return String(html ?? '')
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<\/li\s*>/gi, '')
    .replace(new RegExp(`</?(?:${BLOCK})\\b[^>]*>`, 'gi'), '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] !== '#') return Object.hasOwn(NAMED, e.toLowerCase()) ? NAMED[e.toLowerCase()] : m;
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : m;
    })
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** An iCalendar TEXT value: backslash, comma, semicolon and newlines escaped. */
export const icsText = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\r?\n|\r/g, '\\n').replace(/[,;]/g, '\\$&');

const octets = (cp) => (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4);

/** RFC 5545 line folding: at most 75 octets (UTF-8 bytes) per line, continuing with CRLF + space; never splits a character. */
export function icsFold(line) {
  let out = '';
  let len = 0;
  for (const ch of String(line)) {
    const n = octets(ch.codePointAt(0));
    if (len + n > 75) {
      out += '\r\n ';
      len = 1;
    }
    out += ch;
    len += n;
  }
  return out;
}

const eventUrl = (e) => `${SITE_URL}/event.html?id=${e.id}`;
/** Description as plain text, ending with the link (calendar apps differ in whether they show a separate URL field). */
const details = (e) => `${htmlToText(e.description)}\n\nDetails: ${eventUrl(e)}`.trim();

const stamp = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const text = icsText;
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
  ].map(icsFold).join('\r\n') + '\r\n';
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
