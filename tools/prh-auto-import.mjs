#!/usr/bin/env node
// Daily automatic PRH import into the master catalog: the comics and graphic novels Penguin Random House has going on
// sale in the next 13 weeks (Marvel, IDW, Oni, Boom, Dark Horse, Ignition and the rest), read from PRH's API instead
// of a sheet. New titles are added and known ones refreshed with the same code as Admin → Import (parsePrhApi →
// applyImport): the same skip rules (ratio variants, bundles, exclusives), the catalog's Always Skip list, badges and
// statuses, and staff-owned fields are never touched. Covers go to R2 for new titles and ones still missing one,
// with PRH's own resized copy as the card picture. Shops copy the titles in on their hourly catalog-sync.
//
// Run by the "Automatic PRH import" GitHub Action (daily, or by hand). Needs SUPABASE_ACCESS_TOKEN (the catalog's
// service key is read with it), CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (R2) and PRH_API_KEY, plus
// @supabase/supabase-js (the workflow installs it; the site itself has no dependencies).
//
//   node tools/prh-auto-import.mjs              # import
//   node tools/prh-auto-import.mjs --dry-run    # fetch and count what would be added or refreshed, change nothing

import { fileURLToPath } from 'node:url';
import { parsePrhApi } from '../js/import/distributors.js';
import { env, catalogShop, catalogClient, catalogToday, exclusions, download, r2PutMedia, logRun } from './catalog-job.mjs';

export const WEEKS = 13;
const API = 'https://api.penguinrandomhouse.com/resources/v2/title/domains/SALESPLATFORM/titles';

const mdy = (iso) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
const plusDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** The on-sale windows to ask PRH for: `weeks` 7-day spans from today (one request each keeps replies small). */
export function weekRanges(today, weeks = WEEKS) {
  return Array.from({ length: weeks }, (_, i) => ({ from: plusDays(today, i * 7), to: plusDays(today, i * 7 + 6) }));
}

/** PRH's list URL for one window. suppressLinks keeps the key out of the reply. */
export const weekUrl = ({ from, to }, key) =>
  `${API}?onSaleFrom=${encodeURIComponent(mdy(from))}&onSaleTo=${encodeURIComponent(mdy(to))}&rows=0&suppressLinks=true&api_key=${encodeURIComponent(key)}`;

/** Every title record in the windows, each once. */
export async function fetchRecords(ranges, key, fetchJson) {
  const byCode = new Map();
  for (const range of ranges) {
    const res = await fetchJson(weekUrl(range, key));
    if (res.status === 404) continue; // nothing on sale that week
    if (res.status !== 200) throw new Error(`PRH answered ${res.status} for ${range.from}–${range.to}`);
    for (const t of res.body?.data?.titles ?? []) byCode.set(String(t.isbnStr ?? t.isbn), t);
  }
  return [...byCode.values()];
}

/** The line for Import → Recent Runs. */
export function summary(r) {
  const parts = [`${r.added} added`, `${r.updated} refreshed`, `${r.unchanged ?? 0} unchanged`, `${r.skipped} skipped`];
  if (r.duplicates) parts.push(`${r.duplicates} already in from another sheet`);
  if (r.covers) parts.push(`${r.covers} covers`);
  if (r.coversMissing) parts.push(`${r.coversMissing} without a cover yet`);
  return `PRH, next ${WEEKS} weeks: ${parts.join(', ')}`;
}

const scrub = (s) => String(s).replace(/api_key=[^&\s)"']*/g, 'api_key=…');

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dryRun = process.argv.includes('--dry-run');
  let sb = null;
  try {
    const shop = catalogShop();
    const key = env('PRH_API_KEY');
    sb = await catalogClient(shop);
    const today = await catalogToday(sb);
    const records = await fetchRecords(weekRanges(today), key, async (url) => {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      return { status: res.status, body: res.status === 200 ? await res.json() : (await res.body?.cancel(), null) };
    });
    const { withoutUnchanged, planImport, applyImport } = await import('../js/import/apply.js');
    const parsed = await withoutUnchanged(sb, parsePrhApi(records, { exclusions: await exclusions(sb) }));
    console.log(`${records.length} PRH titles on sale ${today} to ${plusDays(today, WEEKS * 7 - 1)}: ${parsed.items.length} to import, ${parsed.unchanged} unchanged, ${parsed.skipped.length} skipped`);
    if (dryRun) {
      const plan = await planImport(sb, parsed);
      console.log(`Dry run: ${plan.fresh.length} new, ${plan.known.length} to refresh, ${plan.duplicates.length} already in from another sheet.`);
      process.exit(0);
    }
    const result = await applyImport(sb, parsed, {
      today,
      fetchRemote: ({ url }) => download(url),
      // PRH resizes its own covers: the card copy is the same picture 560 px wide (about 2x a phone card).
      makeThumb: (_bytes, _type, item) => download(`${item.cover.url}?width=560`),
      putMedia: r2PutMedia(shop),
      onProgress: () => {},
    });
    const message = summary({ ...result, unchanged: parsed.unchanged });
    console.log(`✓ ${message}`);
    result.coverErrors.slice(0, 20).forEach((e) => console.log(`  cover: ${e}`));
    await logRun(sb, { job: 'prh_import', title: 'Automatic PRH import', ok: true, message, detail: { ...result, coverErrors: result.coverErrors.slice(0, 50) } });
  } catch (err) {
    const message = scrub(err.message);
    console.error(`\n✗ ${message}`);
    await logRun(sb, { job: 'prh_import', title: 'Automatic PRH import', ok: false, message: `PRH import failed: ${message}` }).catch(() => {});
    process.exit(1);
  }
}
