// Writing a parsed distributor sheet into Supabase, for the admin Import page
// (signed-in staff). Parsing rules are in distributors.js; this file decides
// what changes in the database.
//
// Environment-specific pieces are passed in: how to fetch covers that live on
// another site (PRH, funko.com) — the browser goes via the fetch-cover Edge
// Function because of CORS — and, for the daily PRH import in Node
// (tools/prh-auto-import.mjs), where pictures are stored and how a card copy is made.

import { must } from '../util.js';
import { putMedia } from '../media-store.js';
import { addDays, weekStart } from '../dates.js';
import { autoBadges } from './distributors.js';

// Distributor fields refreshed on every import. Staff-owned fields (status,
// hidden, staff pick, category) are never overwritten on titles already imported.
const SYNCED = ['title', 'issue_number', 'variant', 'publisher', 'price', 'foc_date', 'release_date', 'upc', 'isbn', 'creators', 'mature', 'description'];
// Sheet field → items column where they differ. A sheet's price is the retail price; the shop's own price
// (shop_price) is set by staff and wins over it (items.price is kept as whichever applies, by a trigger).
const COLUMN = { price: 'retail_price' };
const col = (k) => COLUMN[k] ?? k;

function* chunks(arr, n) {
  for (let i = 0; i < arr.length; i += n) yield arr.slice(i, i + n);
}

async function pool(items, size, fn) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

/**
 * Status for a title imported for the first time, matching what the daily status
 * job would reach. Titles releasing later this week are "New This Wednesday" until
 * release day, then "Just Arrived" for the rest of the shop week (Sunday to Saturday);
 * older ones are Available; later ones are Pre-Orders. Nothing already out sits as a
 * Pre-Order that can't be reserved.
 */
function initialStatus(item, today) {
  const start = weekStart(today);
  if (!item.release_date || item.release_date >= addDays(start, 7)) return { status: 'pre_order' };
  if (item.release_date > today) return { status: 'new_this_wednesday' };
  return { status: item.release_date >= start ? 'just_arrived' : 'available', arrived_on: item.release_date };
}

/** Existing rows for these SKUs, keyed by SKU. */
async function existingBySku(sb, distributor, skus) {
  const map = new Map();
  for (const batch of chunks(skus, 200)) {
    const rows = await must(sb.from('items').select('sku,upc,cover_url,status').eq('distributor', distributor).in('sku', batch));
    rows.forEach((r) => map.set(r.sku, r));
  }
  return map;
}

/**
 * What an import would do, without writing anything. New rows whose UPC or ISBN
 * already belongs to another title (e.g. a Penguin Random House sheet listing a
 * graphic novel that came in on a Lunar sheet) are left out as `duplicates`: the
 * database allows each UPC once, and the same book shouldn't be listed twice.
 * Whichever listing was imported first stays. A title already stored whose sheet row now gives a UPC another title
 * holds (a mistake in the sheet, seen on Lunar) keeps its stored UPC and refreshes everything else: it comes back
 * without `upc` in `known`, and is listed in `upcClashes` for someone to check.
 * @returns {Promise<{ fresh: object[], known: object[], duplicates: object[], upcClashes: object[], existing: Map }>}
 */
export async function planImport(sb, { distributor, items }) {
  const existing = await existingBySku(sb, distributor, items.map((i) => i.sku));
  const unseen = items.filter((i) => !existing.has(i.sku));
  const moved = new Set(items.filter((i) => i.upc && existing.has(i.sku) && existing.get(i.sku).upc !== i.upc));
  const taken = new Map();
  for (const field of ['upc', 'isbn']) {
    const values = [...new Set([...unseen, ...(field === 'upc' ? moved : [])].map((i) => i[field]).filter(Boolean))];
    for (const batch of chunks(values, 200)) {
      const rows = await must(sb.from('items').select(`id,${field},title,issue_number,variant`).in(field, batch));
      rows.forEach((r) => taken.set(`${field}:${r[field]}`, r));
    }
  }
  const fresh = [];
  const duplicates = [];
  for (const i of unseen) {
    const keys = ['upc', 'isbn'].filter((f) => i[f]).map((f) => `${f}:${i[f]}`);
    const clash = keys.find((k) => taken.has(k));
    if (clash) duplicates.push({ ...i, existingTitle: taken.get(clash) });
    else {
      fresh.push(i);
      keys.forEach((k) => taken.set(k, i)); // a second row with the same UPC or ISBN in this sheet
    }
  }
  const upcClashes = [];
  const known = items.filter((i) => existing.has(i.sku)).map((i) => {
    if (!moved.has(i)) return i;
    const holder = taken.get(`upc:${i.upc}`);
    if (!holder) {
      taken.set(`upc:${i.upc}`, i);
      return i;
    }
    upcClashes.push({ ...i, existingTitle: holder });
    const { upc, ...rest } = i;
    return rest;
  });
  return { existing, fresh, known, duplicates, upcClashes };
}

const isPng = (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

async function sha1(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-1', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Cover bytes for an item: its picture in the sheet if it has a real one,
 * otherwise from another site via `fetchRemote`.
 */
async function coverBytes(item, { images, imagesByRow, fetchRemote }) {
  if (!item.cover) return null;
  // A better picture on the distributor's site (Lunar hi-res) wins; if it isn't
  // there or can't be fetched, fall through to the picture in the sheet.
  if (item.cover.preferUrl && item.cover.url) {
    const got = await fetchRemote({ url: item.cover.url }).catch(() => null);
    if (got?.bytes) return { ...got, hires: true };
  }
  if (item.cover.embedded || item.cover.row != null) {
    const read = item.cover.embedded ? images?.get(item.cover.embedded) : imagesByRow?.get(item.cover.row);
    const bytes = read ? await read() : null;
    // Tiny images are blank placeholders some exports use (e.g. a 186-byte solid square), not covers.
    if (bytes && bytes.length >= 1024) return { bytes, type: isPng(bytes) ? 'image/png' : 'image/jpeg' };
  }
  if (item.cover.funkoItem) return fetchRemote({ funkoItem: item.cover.funkoItem, keywords: item.cover.keywords });
  if (item.cover.url) return fetchRemote({ url: item.cover.url });
  return null;
}

async function uploadCover(sb, distributor, item, ctx) {
  const got = await coverBytes(item, ctx);
  if (!got?.bytes) return null;
  const extOf = (type) => (type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg');
  const ext = extOf(got.type);
  // A content fingerprint in the name gives every new image a new URL, so browser
  // and CDN caches (a week) never keep showing the picture it replaced.
  const hash = (await sha1(got.bytes)).slice(0, 10);
  const path = `covers/${distributor}/${item.sku.replace(/[^\w.-]/g, '_')}-${got.hires ? 'hires-' : ''}${hash}.${ext}`;
  const put = ctx.putMedia ?? putMedia;
  const url = await put(sb, path, got.bytes, { contentType: got.type, upsert: true, cacheControl: '604800' });
  // A small copy for cards and lists, so a page of covers isn't hundreds of KB per picture. If it can't be made
  // the title just uses the full-size cover.
  let thumbUrl = null;
  const thumb = ctx.makeThumb ? await ctx.makeThumb(got.bytes, got.type, item).catch(() => null) : null;
  if (thumb?.bytes) {
    const thumbPath = path.replace(/\.\w+$/, `-sm.${extOf(thumb.type)}`);
    thumbUrl = await put(sb, thumbPath, thumb.bytes, { contentType: thumb.type, upsert: true, cacheControl: '604800' });
  }
  return { url, thumbUrl };
}

/** A UPC clash for the logs: which title kept its UPC, and who holds the one the sheet gave it. */
export function upcClashLine(i) {
  const name = (t) => [t.title, t.issue_number && `#${t.issue_number}`, t.variant].filter(Boolean).join(' ');
  return `${i.sku} ${name(i)}: the sheet's UPC ${i.upc} is already on ${name(i.existingTitle)}`;
}

/**
 * Write a parsed sheet to the database.
 * @param sb        Supabase client allowed to write items and storage
 * @param parsed    parseSheet() result
 * @param opts      { images, imagesByRow, fetchRemote, makeThumb, putMedia, today, onSale, onProgress }
 *                  makeThumb(bytes, type, item) → { bytes, type } | null makes the small card copy of a cover;
 *                  putMedia(sb, path, bytes, opts) → url stores a picture (default: media-store.js)
 * @returns summary { added, updated, skipped, duplicates, upcClashes (lines), arrived, covers, coversMissing, coverErrors }
 */
export async function applyImport(sb, parsed, opts) {
  const { distributor, skipped } = parsed;
  const items = opts.onSale ? parsed.items.map((i) => ({ ...i, release_date: opts.onSale })) : parsed.items;
  const progress = opts.onProgress ?? (() => {});
  const first = await planImport(sb, { distributor, items });
  const categories = new Map((await must(sb.from('categories').select('id,slug'))).map((c) => [c.slug, c.id]));

  // Covers: for new titles and for known titles still missing one.
  const needCover = [...first.fresh, ...first.known].filter((i) => !first.existing.get(i.sku)?.cover_url);
  const coverUrls = new Map();
  const thumbUrls = new Map();
  const coverErrors = [];
  let done = 0;
  await pool(needCover, 6, async (item) => {
    try {
      const uploaded = await uploadCover(sb, distributor, item, opts);
      if (uploaded) {
        coverUrls.set(item.sku, uploaded.url);
        if (uploaded.thumbUrl) thumbUrls.set(item.sku, uploaded.thumbUrl);
      }
    } catch (err) {
      coverErrors.push(`${item.title}: ${err.message}`);
    }
    progress(`Covers ${++done} of ${needCover.length}`);
  });

  // Plan again right before writing: fetching covers takes a while, and titles saved in the meantime (another
  // import in another tab, or by hand) are updated rather than inserted a second time.
  const { existing, fresh, known, duplicates, upcClashes } = await planImport(sb, { distributor, items });
  // A title that gained a cover in the meantime keeps it.
  for (const i of known) if (existing.get(i.sku)?.cover_url) (coverUrls.delete(i.sku), thumbUrls.delete(i.sku));

  // undefined = the sheet doesn't provide this field: leave the stored value
  // alone (null still clears it). New rows just get NULL for it.
  const synced = (i) => Object.fromEntries(SYNCED.filter((k) => i[k] !== undefined).map((k) => [col(k), i[k] ?? null]));

  progress('Saving titles…');
  // New rows share one column set, so a bulk insert never NULLs anything by accident.
  const newRows = fresh.map((i) => ({
    ...Object.fromEntries(SYNCED.map((k) => [col(k), i[k] ?? null])),
    mature: i.mature ?? false, // NOT NULL; sheets without a rating column leave it undefined
    distributor,
    sku: i.sku,
    status: 'pre_order',
    arrived_on: null,
    ...initialStatus(i, opts.today),
    category_id: categories.get(i.category) ?? null,
    badges: autoBadges(i), // #1, one-shot, limited series, facsimile, blind bag
    cover_url: coverUrls.get(i.sku) ?? null,
    cover_thumb_url: thumbUrls.get(i.sku) ?? null,
  }));
  for (const batch of chunks(newRows, 100)) await must(sb.from('items').insert(batch));

  // Upsert on (distributor, sku) touching only synced columns (+ cover if newly
  // found). Every row in one bulk upsert must have the same columns — PostgREST
  // sets a column missing from some rows to NULL, which would wipe stored values —
  // so group rows by their exact column set first.
  const groups = new Map();
  for (const i of known) {
    const row = { ...synced(i), distributor, sku: i.sku, ...(coverUrls.has(i.sku) ? { cover_url: coverUrls.get(i.sku), cover_thumb_url: thumbUrls.get(i.sku) ?? null } : {}) };
    const key = Object.keys(row).sort().join(',');
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  for (const rows of groups.values()) {
    for (const batch of chunks(rows, 100)) await must(sb.from('items').upsert(batch, { onConflict: 'distributor,sku' }));
  }

  return {
    added: fresh.length,
    updated: known.length,
    skipped: skipped.length,
    duplicates: duplicates.length,
    upcClashes: upcClashes.map(upcClashLine),
    arrived: newRows.filter((r) => r.status !== 'pre_order').length,
    covers: coverUrls.size,
    coversMissing: Math.max(0, needCover.length - coverUrls.size),
    coverErrors,
  };
}

/**
 * Is a title already stored exactly as the sheet lists it (and with a cover)? The daily automatic imports leave
 * those out: re-saving them would mark them changed, and every shop would copy them all again each day.
 * Fields the sheet doesn't provide (undefined) don't count.
 */
export function unchanged(item, row) {
  if (!row?.cover_url) return false;
  return SYNCED.every((k) => {
    if (item[k] === undefined) return true;
    const a = item[k] ?? null;
    const b = row[col(k)] ?? null;
    return k === 'price' ? (a == null ? b == null : b != null && Number(a) === Number(b)) : a === b;
  });
}

/** A parsed sheet without the titles stored exactly as it lists them (see unchanged); `unchanged` is how many. */
export async function withoutUnchanged(sb, parsed) {
  const stored = new Map();
  const skus = parsed.items.map((i) => i.sku);
  for (const batch of chunks(skus, 200)) {
    const rows = await must(sb.from('items').select(`sku,cover_url,${SYNCED.map(col).join(',')}`).eq('distributor', parsed.distributor).in('sku', batch));
    rows.forEach((r) => stored.set(r.sku, r));
  }
  const items = parsed.items.filter((i) => !unchanged(i, stored.get(i.sku)));
  return { ...parsed, items, unchanged: parsed.items.length - items.length };
}

/** Record an import run in job_log (shown on the admin Import page). */
export async function logImport(sb, results) {
  const failed = results.some((r) => r.error);
  await sb.from('job_log').insert({
    job: 'import',
    ok: !failed,
    message: results
      .map((r) => (r.error ? `${r.file}: FAILED — ${r.error}` : `${r.file}: ${r.added} added, ${r.updated} updated, ${r.skipped} skipped`))
      .join('; '),
    detail: results,
  });
}
