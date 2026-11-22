#!/usr/bin/env node
// Daily automatic Lunar import into the master catalog. Lunar's sheets are public links: the FOC sheets for the next
// 52 Mondays bring new titles (everything Lunar has posted: full sheets about 11 weeks out, a few titles up to half a
// year, then empty sheets, which are passed over), and the release sheets for this week and the next 4 Wednesdays catch slipped dates and
// price changes. Each goes through the same code as Admin → Import (readWorkbook → parseSheet with the catalog's
// Always Skip list → applyImport): the same skip rules, badges and statuses, and staff-owned fields are never touched.
// Titles already stored exactly as a sheet lists them are left out, so shops don't copy them again. What the sheets
// list but the catalog doesn't take (and why) is listed in Import → Left Out.
//
// DC titles PRH listed first are switched to Lunar's listing when a sheet lists them (js/import/apply.js takesOver):
// the same title, now with Lunar's code, details and cover, so shops order them through Lunar.
//
// Covers: Lunar's hi-res picture (anything from 60 KB to 18 MB) shrunk to 1000 px on its long side, as the Import
// page does, plus the 560 px card copy, both into R2; the small picture in the sheet when there's no hi-res one.
// Only for new titles and ones still missing a cover.
//
// Run by the "Automatic Lunar import" GitHub Action (daily, or by hand). Needs SUPABASE_ACCESS_TOKEN,
// CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (tools/catalog-job.mjs), plus @supabase/supabase-js, xlsx, jszip
// and sharp (the workflow installs them; the site itself has no dependencies).
//
//   node tools/lunar-auto-import.mjs              # import
//   node tools/lunar-auto-import.mjs --dry-run    # download and count what would be added or refreshed, change nothing
//   node tools/lunar-auto-import.mjs --fill-covers   # only give every Lunar title with no cover the one on Lunar's
//                                                    # site now, whatever its dates, no sheets
//   node tools/lunar-auto-import.mjs --switch-dc     # only switch DC titles listed under PRH to Lunar, reading the
//                                                    # usual sheets plus the FOC sheets of the past 26 Mondays

import { fileURLToPath } from 'node:url';
import { readWorkbook, parseSheet, lunarCover } from '../js/import/distributors.js';
import { leftOutRows, leftOutEmail } from '../js/import/left-out.js';
import { catalogShop, catalogClient, catalogToday, exclusions, download, r2PutMedia, logRun, saveLeftOut, emailLeftOut } from './catalog-job.mjs';

export const FOC_WEEKS = 52;
export const RELEASE_WEEKS = 5;
export const SWITCH_BACK_WEEKS = 26;
const SHEETS = 'https://www.lunardistribution.com/home/productdatafile';

const plusDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();
/** The first `day` (0 Sunday … 6 Saturday) on or after `iso`. */
const nextDay = (iso, day) => plusDays(iso, (day - weekday(iso) + 7) % 7);

/**
 * The sheets to read, FOC sheets first: the next 52 FOC Mondays (from today), then the release sheets for this
 * week's Wednesday (even when it has passed: late changes) and the next 4.
 */
export function sheetList(today) {
  const mondays = Array.from({ length: FOC_WEEKS }, (_, i) => plusDays(nextDay(today, 1), i * 7));
  const thisWednesday = plusDays(nextDay(today, 3), weekday(today) > 3 ? -7 : 0);
  const wednesdays = Array.from({ length: RELEASE_WEEKS }, (_, i) => plusDays(thisWednesday, i * 7));
  return [...mondays.map((date) => ({ kind: 'foc', date })), ...wednesdays.map((date) => ({ kind: 'release', date }))];
}

/** --switch-dc's sheets: the usual ones, then the FOC sheets of the past `back` Mondays, most recent first. */
export function switchSheetList(today, back = SWITCH_BACK_WEEKS) {
  const lastMonday = plusDays(nextDay(today, 1), -7);
  return [...sheetList(today), ...Array.from({ length: back }, (_, i) => ({ kind: 'foc', date: plusDays(lastMonday, -i * 7) }))];
}

/** Lunar's link for one sheet: M/D/YYYY, no leading zeros. */
export const sheetUrl = ({ kind, date }) => {
  const [y, m, d] = date.split('-').map(Number);
  return `${SHEETS}?${kind}=${m}/${d}/${y}`;
};

/** "FOC Nov 9" / "Release Nov 4", for the log. */
export const sheetName = ({ kind, date }) =>
  `${kind === 'foc' ? 'FOC' : 'Release'} ${new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;

/** The line for Import → Recent Runs after --fill-covers. */
export function fillSummary(r) {
  const parts = [`${r.filled} of ${r.missing} titles without a cover got one`, `${r.stillMissing} still have none on Lunar's site`];
  if (r.errors.length) parts.push(`${r.errors.length} failed`);
  return `Lunar cover fill: ${parts.join(', ')}`;
}

/** The line for Import → Recent Runs. */
export function summary(results) {
  const read = results.filter((r) => !r.missing && !r.error);
  const sum = (k) => read.reduce((n, r) => n + (r[k] ?? 0), 0);
  const parts = [`${sum('added')} added`, `${sum('updated')} refreshed`, `${sum('unchanged')} unchanged`, `${sum('skipped')} skipped`];
  const clashes = read.reduce((n, r) => n + (r.upcClashes?.length ?? 0), 0);
  if (clashes) parts.push(`${clashes} kept their UPC (the sheet's is on another title)`);
  if (sum('switched')) parts.push(`${sum('switched')} DC titles switched from PRH`);
  if (sum('covers')) parts.push(`${sum('covers')} covers`);
  if (sum('coversMissing')) parts.push(`${sum('coversMissing')} without a cover yet`);
  const notYet = results.filter((r) => r.missing).map((r) => r.sheet);
  const failed = results.filter((r) => r.error).map((r) => `${r.sheet}: ${r.error}`);
  return [`Lunar, ${read.length} of ${results.length} sheets: ${parts.join(', ')}`,
    // Most of a year's sheets far out are empty: name them only when there are a few.
    notYet.length ? `not out yet: ${notYet.length > 3 ? `${notYet.length} sheets` : notYet.join(', ')}` : '', failed.length ? `failed: ${failed.join('; ')}` : ''].filter(Boolean).join('. ');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dryRun = process.argv.includes('--dry-run');
  let sb = null;
  try {
    const shop = catalogShop();
    sb = await catalogClient(shop);
    const today = await catalogToday(sb);
    const rules = await exclusions(sb);
    const XLSX = await import('xlsx');
    const JSZip = (await import('jszip')).default;
    const sharp = (await import('sharp')).default;
    const { withoutUnchanged, planImport, applyImport, upcClashLine } = await import('../js/import/apply.js');
    // The same sizes and quality as the Import page (processImage): covers 1000 px, card copies 560 px.
    const shrink = async (bytes, size, quality) => ({
      bytes: new Uint8Array(await sharp(bytes).rotate().resize(size, size, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality, mozjpeg: true }).toBuffer()),
      type: 'image/jpeg',
    });
    const putMedia = dryRun ? null : r2PutMedia(shop);
    const fetchRemote = async ({ url }) => {
      const got = await download(url);
      return got && shrink(got.bytes, 1000, 86);
    };
    const makeThumb = (bytes) => shrink(bytes, 560, 65);

    // Reads a sheet: its rows and pictures, or null when it isn't out (or lists nothing) yet.
    const readSheet = async (sheet) => {
      const res = await fetch(sheetUrl(sheet));
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok || !type.includes('spreadsheet')) {
        await res.body?.cancel();
        return null;
      }
      const book = await readWorkbook(new Uint8Array(await res.arrayBuffer()), { XLSX, JSZip });
      let parsed;
      try {
        parsed = parseSheet(book.rows, { today, exclusions: rules });
      } catch {
        return null; // an empty sheet: no titles listed for that date yet
      }
      if (parsed.distributor !== 'lunar') throw new Error(`doesn't look like a Lunar sheet (${parsed.source ?? parsed.distributor})`);
      return { book, parsed };
    };

    if (process.argv.includes('--switch-dc')) {
      // Only the switches: a past sheet's other details are older than what the daily run has stored since.
      let switched = 0;
      const lines = [];
      const failed = [];
      for (const sheet of switchSheetList(today)) {
        const name = sheetName(sheet);
        try {
          const got = await readSheet(sheet);
          if (!got) continue;
          const plan = await planImport(sb, got.parsed);
          if (!plan.takeovers.length) continue;
          const skus = new Set(plan.takeovers.map((i) => i.sku));
          const result = await applyImport(sb, { ...got.parsed, items: got.parsed.items.filter((i) => skus.has(i.sku)), skipped: [] }, {
            images: got.book.images, imagesByRow: got.book.imagesByRow, today, fetchRemote, makeThumb, putMedia, onProgress: () => {},
          });
          switched += result.switched;
          lines.push(...result.switchedTitles);
          console.log(`${name}: ${result.switched} switched`);
          result.switchedTitles.forEach((t) => console.log(`  ${t}`));
        } catch (err) {
          failed.push(`${name}: ${err.message}`);
          console.log(`${name}: FAILED — ${err.message}`);
        }
      }
      const { count } = await sb.from('items').select('id', { count: 'exact', head: true }).eq('distributor', 'prh').ilike('publisher', 'DC%');
      const message = `Lunar DC switch: ${switched} DC titles switched from PRH to Lunar, ${count ?? '?'} DC titles still listed under PRH (not on Lunar's sheets yet)${failed.length ? `. failed: ${failed.join('; ')}` : ''}`;
      console.log(`\n✓ ${message}`);
      await logRun(sb, { job: 'lunar_import', title: 'Lunar DC switch', ok: !failed.length, message, detail: { switched, titles: lines.slice(0, 200), failed } });
      process.exit(failed.length ? 1 : 0);
    }

    if (process.argv.includes('--fill-covers')) {
      const { fillMissingCovers } = await import('../js/import/apply.js');
      // No sheet here, so a title only gets Lunar's hi-res picture.
      const result = await fillMissingCovers(sb, { distributor: 'lunar', cover: (sku) => ({ ...lunarCover(sku), embedded: null }), fetchRemote, makeThumb, putMedia });
      const message = fillSummary(result);
      console.log(`✓ ${message}`);
      result.errors.slice(0, 20).forEach((e) => console.log(`  cover: ${e}`));
      await logRun(sb, { job: 'lunar_import', title: 'Lunar cover fill', ok: true, message, detail: { ...result, errors: result.errors.slice(0, 50) } });
      process.exit(0);
    }

    const results = [];
    // Import → Left Out: every sheet's skipped titles and duplicates, in sheet order (leftOutRows keeps each SKU once).
    const skipped = [];
    const duplicates = [];
    for (const sheet of sheetList(today)) {
      const name = sheetName(sheet);
      try {
        const got = await readSheet(sheet);
        if (!got) {
          results.push({ sheet: name, missing: true });
          console.log(`${name}: not out yet, or no titles listed`);
          continue;
        }
        const { book, parsed } = got;
        skipped.push(...parsed.skipped);
        const todo = await withoutUnchanged(sb, parsed);
        if (dryRun) {
          const plan = await planImport(sb, todo);
          const upcClashes = plan.upcClashes.map(upcClashLine);
          results.push({ sheet: name, added: plan.fresh.length, updated: plan.known.filter((i) => !i.coverOnly).length, unchanged: todo.unchanged, skipped: parsed.skipped.length, upcClashes });
          console.log(`${name}: ${plan.fresh.length} new, ${plan.known.filter((i) => !i.coverOnly).length} to refresh, ${todo.unchanged} unchanged, ${parsed.skipped.length} skipped`);
          upcClashes.forEach((c) => console.log(`  UPC: ${c}`));
          continue;
        }
        const result = await applyImport(sb, todo, {
          images: book.images,
          imagesByRow: book.imagesByRow,
          today,
          fetchRemote,
          makeThumb,
          putMedia,
          onProgress: () => {},
        });
        const { duplicateTitles, switchedTitles, ...counts } = result;
        duplicates.push(...duplicateTitles);
        results.push({ sheet: name, ...counts, unchanged: todo.unchanged });
        console.log(`${name}: ${result.added} added, ${result.updated} refreshed, ${todo.unchanged} unchanged, ${result.skipped} skipped, ${result.covers} covers`);
        result.upcClashes.forEach((c) => console.log(`  UPC: ${c}`));
        result.switchedTitles.forEach((t) => console.log(`  switched: ${t}`));
        result.coverErrors.slice(0, 10).forEach((e) => console.log(`  cover: ${e}`));
      } catch (err) {
        results.push({ sheet: name, error: err.message });
        console.log(`${name}: FAILED — ${err.message}`);
      }
    }

    const message = summary(results);
    console.log(`\n${dryRun ? 'Dry run: ' : '✓ '}${message}`);
    if (dryRun) process.exit(0);
    const failed = results.some((r) => r.error);
    // A run that couldn't read every sheet keeps the last full list rather than dropping that sheet's titles from it.
    if (!failed) {
      const leftOutList = leftOutRows({ skipped }, duplicates);
      const leftOut = await saveLeftOut(sb, 'lunar', leftOutList);
      if (leftOut != null) console.log(`  ${leftOut} titles listed in Import → Left Out`);
      await emailLeftOut(sb, { mail: leftOutEmail({ source: 'lunar', date: today, summary: message, rows: leftOutList }), sentBy: 'Automatic Lunar import' });
    }
    await logRun(sb, { job: 'lunar_import', title: 'Automatic Lunar import', ok: !failed, message, detail: results.map(({ coverErrors, ...r }) => ({ ...r, coverErrors: coverErrors?.slice(0, 20) })) });
    if (failed) process.exit(1);
  } catch (err) {
    console.error(`\n✗ ${err.message}`);
    await logRun(sb, { job: 'lunar_import', title: 'Automatic Lunar import', ok: false, message: `Lunar import failed: ${err.message}` }).catch(() => {});
    process.exit(1);
  }
}
