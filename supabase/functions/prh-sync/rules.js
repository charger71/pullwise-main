// What prh-sync changes on a title, without any Deno or Supabase specifics, so Node can test it (rules.test.js).
// index.ts wires it to the catalog's database and the PRH API.

export const API = 'https://api.penguinrandomhouse.com/resources/v2/title/domains';

// Where PRH keeps a title: books by ISBN in PRH.US; comics by their 17-digit UPC only in SALESPLATFORM (other
// domains answer 404 for them). SALESPLATFORM is the fallback for an ISBN PRH.US doesn't know.
export function lookupPlan({ isbn, upc }) {
  if (isbn) return [{ domain: 'PRH.US', code: isbn }, { domain: 'SALESPLATFORM', code: isbn }];
  if (upc) return [{ domain: 'SALESPLATFORM', code: upc }];
  return [];
}

export const titleUrl = ({ domain, code }, key) => `${API}/${domain}/titles/${encodeURIComponent(code)}?api_key=${encodeURIComponent(key)}`;
export const contentUrl = ({ domain, code }, key) => `${API}/${domain}/titles/${encodeURIComponent(code)}/content?api_key=${encodeURIComponent(key)}`;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', mdash: '—', ndash: '–', hellip: '…', bull: '•', eacute: 'é', egrave: 'è', ntilde: 'ñ', uuml: 'ü', ouml: 'ö', auml: 'ä', copy: '©', reg: '®', trade: '™' };

/** PRH copy is an HTML fragment; store it as plain text (the same rules as the importer's htmlToText). */
export function htmlToText(html) {
  if (!html) return null;
  const text = String(html)
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text || null;
}

const isoDate = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const usd = (prices) => {
  const p = (prices ?? []).find((x) => x?.currencyCode === 'USD');
  return Number.isFinite(p?.amount) && p.amount > 0 ? p.amount : null;
};

/**
 * The changes for one title, given what PRH sent: only fields that differ, so a title PRH agrees with isn't
 * touched at all. Dates and the retail price follow PRH, like re-importing a sheet (PRH never clears them: a
 * missing value leaves ours). Description and creators are only filled in when the title has none, so staff
 * edits stay.
 * @param item     prh_sync_batch row
 * @param record   PRH title (data.titles[0])
 * @param content  PRH content (data.content), or null
 */
export function changes(item, record, content) {
  const patch = {};
  const onsale = isoDate(record.onsale);
  if (onsale && onsale !== item.release_date) patch.release_date = onsale;
  const foc = isoDate(record.focDate);
  if (foc && foc !== item.foc_date) patch.foc_date = foc;
  const price = usd(record.price);
  if (price != null && price !== Number(item.retail_price)) patch.retail_price = price;
  if (!item.description?.trim()) {
    const text = htmlToText(content?.flapcopy) ?? htmlToText(content?.keynote);
    if (text) patch.description = text;
  }
  const author = record.author?.trim();
  if (!item.creators?.trim() && author) patch.creators = author;
  return patch;
}

/**
 * Look one title up: the first domain that knows it, then its copy (only when the title needs a description).
 * @param fetchJson  (url) → { status, body }
 * @returns { found, domain, record, content }
 */
export async function lookup(item, key, fetchJson) {
  for (const place of lookupPlan(item)) {
    const res = await fetchJson(titleUrl(place, key));
    if (res.status === 404) continue;
    if (res.status !== 200) throw new Error(`PRH answered ${res.status}`);
    const record = res.body?.data?.titles?.[0];
    if (!record) continue;
    let content = null;
    if (!item.description?.trim()) {
      const c = await fetchJson(contentUrl(place, key));
      if (c.status === 200) content = c.body?.data?.content ?? null;
      else if (c.status !== 404) throw new Error(`PRH answered ${c.status}`);
    }
    return { found: true, domain: place.domain, record, content };
  }
  return { found: false, domain: null, record: null, content: null };
}

/** One line for Import → Recent Runs, or null when the run did nothing worth showing. */
export function summary({ checked, updated, notFound, failed, descriptions }) {
  if (!updated && !failed) return null;
  const parts = [`${checked} checked`, `${updated} updated`];
  if (descriptions) parts.push(`${descriptions} descriptions added`);
  if (notFound) parts.push(`${notFound} not found at PRH`);
  if (failed) parts.push(`${failed} failed`);
  return parts.join(', ');
}
