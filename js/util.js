import { fromError } from './errors.js';
// Small helpers shared by the site, the admin and the command-line tools. No DOM, no
// dependencies, so it loads anywhere.

/** HTML-escape a value for text or attribute positions. */
export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Lower-case with accents removed: "Pokémon" → "pokemon". */
const plainText = (v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 's').toLowerCase();

/** A person's name as a key: "José García-López" → "jose garcia lopez". Matches the database's person_key(). */
export const nameKey = (v) => plainText(v).replace(/[^a-z0-9]+/g, ' ').trim();

/** Letters and digits only, so "Spider-Man", "spider man" and "SPIDERMAN" all become "spiderman". Matches the database's _squash(). */
export const squash = (v) => plainText(v).replace(/[^a-z0-9]/g, '');

/** The words of a search (max 6), punctuation and accents removed. */
export const searchWords = (v) => plainText(v).split(/[^a-z0-9]+/).filter(Boolean).slice(0, 6);

/** Unwrap a Supabase response, throwing a readable Error. */
export async function must(promise) {
  const { data, error, count } = await promise;
  if (error) throw fromError(error);
  return count != null && data == null ? count : data;
}

/** [value, count] pairs, most common first. */
export const tally = (values) => {
  const counts = {};
  values.forEach((v) => (counts[v] = (counts[v] ?? 0) + 1));
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
};

/** "Absolute Batman #25". */
export const itemTitle = (i) => (i.issue_number ? `${i.title} #${i.issue_number}` : i.title);

/**
 * A downsized copy of a picture in Supabase Storage (resized on the fly, so a 900 KB banner becomes a few hundred KB).
 * Any other address is returned unchanged. `format: 'origin'` keeps the original file type and `square: true` fits the picture inside a square, both for favicons.
 */
export function sizedImage(url, width, { quality = 75, format, square = false } = {}) {
  const m = /^(https:\/\/[^/?#]+\/storage\/v1\/)object\/public\/([^?#]+)$/.exec(url ?? '');
  if (!m) return url;
  // Given only a width, Supabase keeps the original height and crops the sides (a 2000x1125 banner at width 1400
  // comes back 1400x1125, a 250px logo at 160 comes back as a narrow strip). Giving it a tall box to fit inside
  // scales the whole picture instead; favicons ask for an exact square.
  const box = `&height=${square ? width : 2500}&resize=contain`;
  return `${m[1]}render/image/public/${m[2]}?width=${width}${box}&quality=${quality}${format ? `&format=${format}` : ''}`;
}

/** Widths the site asks for: the banner behind the home page headline, and the logo in the header. */
export const HERO_WIDTH = 1400;
export const LOGO_WIDTH = 320;

/** The home page banner headline as HTML: *words* in asterisks get the accent color. */
export const heroHeadlineHtml = (s) => esc(s.hero_headline || s.shop_name).replace(/\*([^*]+)\*/g, '<span>$1</span>');

/**
 * The small copy of a picture in the media bucket: the admin saves "name-sm.jpg" next to every cover and
 * Media Library upload it resizes. Any other address is returned unchanged. Pair it with `thumbFallback`,
 * because pictures uploaded before small copies existed don't have one.
 */
export const thumbOf = (url) => (/^https:\/\/[^/?#]+\/storage\/v1\/object\/public\/media\/.+\.\w+$/.test(url ?? '') ? url.replace(/\.\w+$/, '-sm.jpg') : url);

/** Attributes for an <img> whose src is thumbOf(url): if the small copy is missing it shows the full picture. */
export const thumbFallback = (url) => `data-full="${esc(url)}" onerror="this.onerror=null;this.src=this.dataset.full"`;

/** "5551234567" or "1-555-123-4567" → "(555) 123-4567"; anything that isn't a 10-digit US number is shown as typed. */
export function formatPhone(phone) {
  const d = String(phone ?? '').replace(/\D/g, '');
  const n = d.length === 11 && d[0] === '1' ? d.slice(1) : d;
  return n.length === 10 ? `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}` : String(phone ?? '');
}
