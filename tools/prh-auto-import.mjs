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

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePrhApi } from '../js/import/distributors.js';
import { r2Settings } from './move-images-to-r2.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
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

// Item field → items column, for the comparison below (the same pairs applyImport writes).
const COLUMNS = { title: 'title', issue_number: 'issue_number', variant: 'variant', publisher: 'publisher', price: 'retail_price', foc_date: 'foc_date', release_date: 'release_date', upc: 'upc', isbn: 'isbn', creators: 'creators', mature: 'mature' };

/**
 * Is a title already in the catalog exactly as PRH lists it (and with a cover)? Those are left out of the import:
 * re-saving them would mark them changed, and every shop would copy them all again each day.
 */
export function unchanged(item, row) {
  if (!row?.cover_url) return false;
  return Object.entries(COLUMNS).every(([field, column]) => {
    if (item[field] === undefined) return true; // PRH doesn't say: the import leaves it alone
    const a = item[field];
    const b = row[column];
    return column === 'retail_price' ? Number(a) === Number(b) : (a ?? null) === (b ?? null);
  });
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
  const env = (k) => process.env[k] || (() => { throw new Error(`Set ${k}`); })();
  const dryRun = process.argv.includes('--dry-run');
  let sb = null;
  try {
    const shops = JSON.parse(fs.readFileSync(path.join(ROOT, 'shops.json'), 'utf8')).shops;
    const shop = shops.find((s) => s.catalog);
    if (!shop) throw new Error('No master catalog in shops.json');
    const key = env('PRH_API_KEY');
    const supabaseToken = env('SUPABASE_ACCESS_TOKEN');

    // The catalog's service key, read with the access token the deploy uses.
    const keys = await fetch(`https://api.supabase.com/v1/projects/${shop.projectRef}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${supabaseToken}` } });
    if (!keys.ok) throw new Error(`Couldn't read the catalog's keys (${keys.status})`);
    const serviceKey = (await keys.json()).find((k) => k.name === 'service_role')?.api_key;
    if (!serviceKey) throw new Error('The catalog has no service_role key');
    const { createClient } = await import('@supabase/supabase-js');
    sb = createClient(shop.supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const { data: settings } = await sb.from('settings').select('timezone').eq('id', 1).single();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: settings?.timezone || 'America/New_York' }).format(new Date());
    const records = await fetchRecords(weekRanges(today), key, async (url) => {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      return { status: res.status, body: res.status === 200 ? await res.json() : (await res.body?.cancel(), null) };
    });
    const { data: exclusions, error } = await sb.from('import_exclusions').select('kind,value');
    if (error) throw new Error(error.message);
    const all = parsePrhApi(records, { exclusions });
    const stored = new Map();
    const skus = all.items.map((i) => i.sku);
    for (let i = 0; i < skus.length; i += 200) {
      const { data: rows, error: e } = await sb.from('items').select(`sku,cover_url,${Object.values(COLUMNS).join(',')}`).eq('distributor', 'prh').in('sku', skus.slice(i, i + 200));
      if (e) throw new Error(e.message);
      rows.forEach((r) => stored.set(r.sku, r));
    }
    const parsed = { ...all, items: all.items.filter((i) => !unchanged(i, stored.get(i.sku))) };
    const same = all.items.length - parsed.items.length;
    console.log(`${records.length} PRH titles on sale ${today} to ${plusDays(today, WEEKS * 7 - 1)}: ${parsed.items.length} to import, ${same} unchanged, ${parsed.skipped.length} skipped`);
    if (dryRun) {
      const { planImport } = await import('../js/import/apply.js');
      const plan = await planImport(sb, parsed);
      console.log(`Dry run: ${plan.fresh.length} new, ${plan.known.length} to refresh, ${plan.duplicates.length} already in from another sheet.`);
      process.exit(0);
    }

    const { bucket, publicBase } = r2Settings(fs.readFileSync(path.join(ROOT, 'wrangler.jsonc'), 'utf8'));
    const cfToken = env('CLOUDFLARE_API_TOKEN');
    const account = env('CLOUDFLARE_ACCOUNT_ID');
    const download = async (url) => {
      for (let attempt = 1; ; attempt++) {
        const res = await fetch(url).catch(() => null);
        if (res?.status === 404) return null;
        if (res?.ok) {
          const bytes = new Uint8Array(await res.arrayBuffer());
          return bytes.length >= 1024 ? { bytes, type: res.headers.get('content-type') || 'image/jpeg' } : null; // a blank placeholder
        }
        if (attempt >= 3) throw new Error(`Couldn't download ${url} (${res?.status ?? 'network error'})`);
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    };
    // Stored under the catalog's id, as the Worker stores staff uploads (worker/media.js), and served from R2.
    const putMedia = async (_sb, objectPath, bytes, { contentType }) => {
      const objectKey = `${shop.id}/${objectPath}`.split('/').map(encodeURIComponent).join('/');
      for (let attempt = 1; ; attempt++) {
        const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${bucket}/objects/${objectKey}`, {
          method: 'PUT', headers: { Authorization: `Bearer ${cfToken}`, 'Content-Type': contentType, 'Cache-Control': 'public, max-age=604800' }, body: bytes,
        }).catch(() => null);
        if (res?.ok) return `${publicBase.replace(/\/+$/, '')}/${objectKey}`;
        if (attempt >= 3) throw new Error(`Couldn't upload ${objectPath} to R2 (${res?.status ?? 'network error'})`);
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    };

    const { applyImport } = await import('../js/import/apply.js');
    const result = await applyImport(sb, parsed, {
      today,
      fetchRemote: ({ url }) => download(url),
      // PRH resizes its own covers: the card copy is the same picture 560 px wide (about 2x a phone card).
      makeThumb: (_bytes, _type, item) => download(`${item.cover.url}?width=560`),
      putMedia,
      onProgress: () => {},
    });
    const message = summary({ ...result, unchanged: same });
    console.log(`✓ ${message}`);
    result.coverErrors.slice(0, 20).forEach((e) => console.log(`  cover: ${e}`));
    await sb.from('job_log').insert({ job: 'prh_import', ok: true, message, detail: { ...result, coverErrors: result.coverErrors.slice(0, 50) } });
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Automatic PRH import\n${message}\n`);
  } catch (err) {
    const message = scrub(err.message);
    console.error(`\n✗ ${message}`);
    await sb?.from('job_log').insert({ job: 'prh_import', ok: false, message: `PRH import failed: ${message}` });
    process.exit(1);
  }
}
