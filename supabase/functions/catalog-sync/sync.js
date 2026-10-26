// The catalog sync itself, without any Deno or Supabase specifics, so Node can test it (sync.test.js).
// index.ts wires it to the shop's database and the catalog's public REST API.

/** Catalog columns copied to the shops (category comes through as its slug). */
export const FIELDS = [
  'id', 'title', 'issue_number', 'variant', 'publisher', 'retail_price', 'foc_date', 'release_date', 'upc', 'isbn',
  'creators', 'mature', 'description', 'cover_url', 'cover_thumb_url', 'distributor', 'sku', 'badges', 'updated_at',
];
export const PAGE_SIZE = 500;

/**
 * What a shop copies from the catalog, in this order: the titles, then the Series list and series merges, the
 * Artists list and artist renames. Each is read oldest change first (`id` breaks ties) and applied by its own database function.
 */
export const STREAMS = {
  items: { path: 'items', select: `${FIELDS.join(',')},category:categories(slug)`, id: 'id', rpc: 'catalog_apply' },
  series: { path: 'series_catalog', select: 'key,title,publisher,cover_url,updated_at', id: 'key', rpc: 'catalog_apply_series', label: 'Series list' },
  series_merges: { path: 'series_aliases', select: 'from_key,to_key,updated_at', id: 'from_key', rpc: 'catalog_apply_series_merges', label: 'Series merges' },
  artists: { path: 'creator_catalog', select: 'key,name,source,blocked,updated_at', id: 'key', rpc: 'catalog_apply_artists', label: 'Artists list' },
  artist_renames: { path: 'creator_aliases_named', select: 'from_key,to_key,to_name,updated_at', id: 'from_key', rpc: 'catalog_apply_artist_renames', label: 'Artist renames' },
};
export const LISTS = ['series', 'series_merges', 'artists', 'artist_renames'];

/** A PostgREST filter value: numbers as they are, text quoted (a key can hold spaces or commas). */
const value = (v) => (typeof v === 'number' ? String(v) : `"${String(v).replace(/[\\"]/g, '\\$&')}"`);

/**
 * The catalog REST query for the next page after the cursor: oldest change first, ties broken by id, so a
 * page boundary inside one timestamp neither skips nor repeats a row.
 */
export function pageUrl(catalogUrl, cursor, limit = PAGE_SIZE, stream = STREAMS.items) {
  const q = new URLSearchParams({
    select: stream.select,
    order: `updated_at.asc,${stream.id}.asc`,
    limit: String(limit),
  });
  if (cursor?.at) q.set('or', `(updated_at.gt."${cursor.at}",and(updated_at.eq."${cursor.at}",${stream.id}.gt.${value(cursor.id ?? 0)}))`);
  return `${catalogUrl.replace(/\/+$/, '')}/rest/v1/${stream.path}?${q}`;
}

/** A catalog row as its apply function takes it. */
export function toRow(item, stream = STREAMS.items) {
  const { category, updated_at, ...rest } = item;
  return stream === STREAMS.items ? { ...rest, category_slug: category?.slug ?? null } : rest;
}

/**
 * Copies one stream's catalog changes into the shop until there are none left or the time budget runs out (the next
 * hourly run carries on from the saved cursor).
 *
 * deps: fetchPage(url) → catalog rows; apply(rows) → { inserted, updated, unchanged, failed, error };
 *       saveCursor({ at, id }); now() → ms
 */
export async function runSync({ catalogUrl, cursor, budgetMs = 100_000, stream = STREAMS.items }, deps) {
  const started = deps.now();
  const totals = { inserted: 0, updated: 0, unchanged: 0, failed: 0, pages: 0, error: null, done: false };
  let at = cursor?.at ?? null;
  let id = cursor?.id ?? null;
  while (deps.now() - started < budgetMs) {
    const rows = await deps.fetchPage(pageUrl(catalogUrl, at ? { at, id } : null, PAGE_SIZE, stream));
    if (!rows.length) {
      totals.done = true;
      break;
    }
    const r = await deps.apply(rows.map((row) => toRow(row, stream)));
    for (const k of ['inserted', 'updated', 'unchanged', 'failed']) totals[k] += r[k] ?? 0;
    totals.error ??= r.error ?? null;
    totals.pages++;
    const last = rows[rows.length - 1];
    at = last.updated_at;
    id = last[stream.id];
    await deps.saveCursor({ at, id });
    if (rows.length < PAGE_SIZE) {
      totals.done = true;
      break;
    }
  }
  return totals;
}

/** One line for the shop's Recent Runs list, or null when nothing changed (quiet hours stay out of the log). */
export function summary(t, label) {
  if (!t.inserted && !t.updated && !t.failed) return null;
  const parts = [`${t.inserted} new`, `${t.updated} updated`];
  if (t.failed) parts.push(`${t.failed} failed (${t.error})`);
  if (!t.done) parts.push('more next hour');
  return (label ? `${label}: ` : '') + parts.join(', ');
}

/** The titles' line and each list's, e.g. "3 new, 1 updated; Series list: 2 new, 0 updated", or null. */
export function summaryAll(byStream) {
  const lines = Object.entries(byStream).map(([name, t]) => t && summary(t, STREAMS[name].label)).filter(Boolean);
  return lines.length ? lines.join('; ') : null;
}
