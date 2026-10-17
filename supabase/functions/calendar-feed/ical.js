// iCalendar text helpers for the calendar feed. js/ics.js (single-event downloads on the site) has its own
// copy because this Edge Function deploys on its own; js/ics.test.js checks that the two agree.

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
