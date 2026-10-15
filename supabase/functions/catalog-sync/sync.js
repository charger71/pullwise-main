// The catalog sync itself, without any Deno or Supabase specifics, so Node can test it (sync.test.js).
// index.ts wires it to the shop's database and the catalog's public REST API.

/** Catalog columns copied to the shops (category comes through as its slug). */
export const FIELDS = [
  'id', 'title', 'issue_number', 'variant', 'publisher', 'retail_price', 'foc_date', 'release_date', 'upc', 'isbn',
  'creators', 'mature', 'description', 'cover_url', 'cover_thumb_url', 'distributor', 'sku', 'badges', 'updated_at',
];
export const PAGE_SIZE = 500;

/**
 * The catalog REST query for the next page after the cursor: oldest change first, ties broken by id, so a
 * page boundary inside one timestamp neither skips nor repeats a title.
 */
export function pageUrl(catalogUrl, cursor, limit = PAGE_SIZE) {
  const q = new URLSearchParams({
    select: `${FIELDS.join(',')},category:categories(slug)`,
    order: 'updated_at.asc,id.asc',
    limit: String(limit),
  });
  if (cursor?.at) q.set('or', `(updated_at.gt."${cursor.at}",and(updated_at.eq."${cursor.at}",id.gt.${cursor.id ?? 0}))`);
  return `${catalogUrl.replace(/\/+$/, '')}/rest/v1/items?${q}`;
}

/** A catalog row as catalog_apply() takes it. */
export function toRow(item) {
  const { category, updated_at, ...rest } = item;
  return { ...rest, category_slug: category?.slug ?? null };
}

/**
 * Copies catalog changes into the shop until there are none left or the time budget runs out (the next hourly
 * run carries on from the saved cursor).
 *
 * deps: fetchPage(url) → catalog rows; apply(rows) → { inserted, updated, unchanged, failed, error };
 *       saveCursor({ at, id }); now() → ms
 */
export async function runSync({ catalogUrl, cursor, budgetMs = 100_000 }, deps) {
  const started = deps.now();
  const totals = { inserted: 0, updated: 0, unchanged: 0, failed: 0, pages: 0, error: null, done: false };
  let at = cursor?.at ?? null;
  let id = cursor?.id ?? null;
  while (deps.now() - started < budgetMs) {
    const rows = await deps.fetchPage(pageUrl(catalogUrl, at ? { at, id } : null));
    if (!rows.length) {
      totals.done = true;
      break;
    }
    const r = await deps.apply(rows.map(toRow));
    for (const k of ['inserted', 'updated', 'unchanged', 'failed']) totals[k] += r[k] ?? 0;
    totals.error ??= r.error ?? null;
    totals.pages++;
    const last = rows[rows.length - 1];
    at = last.updated_at;
    id = last.id;
    await deps.saveCursor({ at, id });
    if (rows.length < PAGE_SIZE) {
      totals.done = true;
      break;
    }
  }
  return totals;
}

/** One line for the shop's Recent Runs list, or null when nothing changed (quiet hours stay out of the log). */
export function summary(t) {
  if (!t.inserted && !t.updated && !t.failed) return null;
  const parts = [`${t.inserted} new`, `${t.updated} updated`];
  if (t.failed) parts.push(`${t.failed} failed (${t.error})`);
  if (!t.done) parts.push('more next hour');
  return parts.join(', ');
}
