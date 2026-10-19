#!/usr/bin/env node
// One-time move of a shop's covers and series images from Supabase storage (its own, or another project's, e.g.
// Pop's after a restore) into the shared R2 bucket, rewriting the addresses in that shop's database as it goes.
// Run by the "Move images to R2" GitHub Action; needs SUPABASE_ACCESS_TOKEN, CLOUDFLARE_API_TOKEN and
// CLOUDFLARE_ACCOUNT_ID. Bucket and public address come from wrangler.jsonc.
//
//   node tools/move-images-to-r2.mjs --shop catalog --dry-run    # count and show a few, change nothing
//   node tools/move-images-to-r2.mjs --shop catalog              # copy and rewrite
//
// Safe to stop and run again: each batch's addresses are rewritten right after its images are copied, and only
// addresses still pointing at Supabase storage are picked up. An image that can't be downloaded keeps its old
// address and is listed at the end. For the master catalog, every shop picks up the new addresses on its next
// hourly sync (rewriting a title marks it changed).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SUPABASE_MEDIA = /^https:\/\/[a-z0-9]{20}\.supabase\.co\/storage\/v1\/object\/public\/media\/([^?#]+)$/;
const BATCH = 100;
const PARALLEL = 6;

/** Every address in the shop's titles and series that still points at Supabase storage. */
export const FIND_SQL = `select distinct u from (
  select cover_url u from public.items union all select cover_thumb_url from public.items
  union all select cover_url from public.series_catalog) x
where u like 'https://%.supabase.co/storage/v1/object/public/media/%'
order by u;`;

const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;

/** Old address → { key in the bucket, new public address }. Objects live under the shop's id, as uploads do. */
export function target(url, shop, publicBase) {
  const m = SUPABASE_MEDIA.exec(url);
  if (!m) return null;
  const objectPath = m[1].split('/').map(decodeURIComponent).join('/');
  const key = `${shop.id}/${objectPath}`;
  return { from: url, key, to: `${publicBase.replace(/\/+$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}` };
}

/** One statement rewriting every column that can hold one of these addresses; returns the rows changed. */
export function rewriteSql(moves) {
  if (!moves.length) return null;
  const values = moves.map((m) => `(${lit(m.from)}, ${lit(m.to)})`).join(',\n  ');
  // One update per table: a row changed twice in one statement keeps only one of the changes, so a title's cover
  // and its small copy are rewritten together.
  return `with m(f, t) as (values\n  ${values}),
a as (update public.items i set
        cover_url = coalesce((select m.t from m where m.f = i.cover_url), i.cover_url),
        cover_thumb_url = coalesce((select m.t from m where m.f = i.cover_thumb_url), i.cover_thumb_url)
      where i.cover_url in (select f from m) or i.cover_thumb_url in (select f from m) returning 1),
c as (update public.series_catalog s set cover_url = m.t from m where s.cover_url = m.f returning 1)
select (select count(*) from a) + (select count(*) from c) as rewritten;`;
}

async function pool(items, size, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

/**
 * deps: sql(query) → rows; download(url) → { bytes, type } | null (gone); put(key, bytes, type); log(text)
 * Returns { found, copied, rewritten (titles and series changed), missing: [urls] }.
 */
export async function moveImages({ shop, publicBase, dryRun }, deps) {
  const urls = (await deps.sql(FIND_SQL)).map((r) => r.u);
  const moves = urls.map((u) => target(u, shop, publicBase)).filter(Boolean);
  const result = { found: moves.length, copied: 0, rewritten: 0, missing: [] };
  deps.log(`${moves.length} image address(es) still point at Supabase storage.`);
  if (dryRun) {
    moves.slice(0, 5).forEach((m) => deps.log(`  ${m.from}\n    → ${m.to}`));
    return result;
  }
  for (let i = 0; i < moves.length; i += BATCH) {
    const batch = moves.slice(i, i + BATCH);
    const done = [];
    await pool(batch, PARALLEL, async (m) => {
      const got = await deps.download(m.from);
      if (!got) return result.missing.push(m.from);
      await deps.put(m.key, got.bytes, got.type);
      done.push(m);
    });
    result.copied += done.length;
    const sql = rewriteSql(done);
    if (sql) result.rewritten += Number((await deps.sql(sql))[0]?.rewritten ?? 0);
    deps.log(`${Math.min(i + BATCH, moves.length)} of ${moves.length} done (${result.copied} copied, ${result.missing.length} missing)`);
  }
  return result;
}

/** Bucket name and public address from wrangler.jsonc (its comments are whole lines). */
export function r2Settings(jsonc) {
  const config = JSON.parse(jsonc.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n'));
  const bucket = config.r2_buckets?.find((b) => b.binding === 'MEDIA')?.bucket_name;
  const publicBase = config.vars?.MEDIA_PUBLIC_URL;
  if (!bucket || !publicBase) throw new Error('wrangler.jsonc needs the MEDIA R2 bucket and MEDIA_PUBLIC_URL');
  return { bucket, publicBase };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const shopId = args.includes('--shop') ? args[args.indexOf('--shop') + 1] || null : null;
    const dryRun = args.includes('--dry-run');
    const env = (k) => process.env[k] || (() => { throw new Error(`Set ${k}`); })();
    const shops = JSON.parse(fs.readFileSync(path.join(ROOT, 'shops.json'), 'utf8')).shops;
    const shop = shopId ? shops.find((s) => s.id === shopId) : shops.find((s) => s.catalog);
    if (!shop) throw new Error(shopId ? `No shop "${shopId}" in shops.json` : 'No master catalog in shops.json; pass --shop <id>');
    const { bucket, publicBase } = r2Settings(fs.readFileSync(path.join(ROOT, 'wrangler.jsonc'), 'utf8'));
    const supabaseToken = env('SUPABASE_ACCESS_TOKEN');
    const cfToken = dryRun ? '' : env('CLOUDFLARE_API_TOKEN');
    const account = dryRun ? '' : env('CLOUDFLARE_ACCOUNT_ID');
    console.log(`${dryRun ? 'Dry run for' : 'Moving'} ${shop.id} (${shop.projectRef}) → R2 bucket ${bucket}, served at ${publicBase}`);
    const r = await moveImages({ shop, publicBase, dryRun }, {
      log: (t) => console.log(t),
      sql: async (query) => {
        const res = await fetch(`https://api.supabase.com/v1/projects/${shop.projectRef}/database/query`, {
          method: 'POST', headers: { Authorization: `Bearer ${supabaseToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
        });
        if (!res.ok) throw new Error(`Supabase query failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
        return res.json();
      },
      download: async (url) => {
        for (let attempt = 1; ; attempt++) {
          const res = await fetch(url).catch(() => null);
          if (res?.status === 404 || res?.status === 400) return null;
          if (res?.ok) return { bytes: new Uint8Array(await res.arrayBuffer()), type: res.headers.get('content-type') || 'image/jpeg' };
          if (attempt >= 3) throw new Error(`Couldn't download ${url} (${res?.status ?? 'network error'})`);
          await new Promise((r) => setTimeout(r, 2000 * attempt));
        }
      },
      put: async (key, bytes, type) => {
        for (let attempt = 1; ; attempt++) {
          const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${bucket}/objects/${key.split('/').map(encodeURIComponent).join('/')}`, {
            method: 'PUT', headers: { Authorization: `Bearer ${cfToken}`, 'Content-Type': type, 'Cache-Control': 'public, max-age=604800' }, body: bytes,
          }).catch(() => null);
          if (res?.ok) return;
          if (attempt >= 3) throw new Error(`Couldn't upload ${key} to R2 (${res?.status ?? 'network error'}: ${res ? (await res.text()).slice(0, 200) : ''})`);
          await new Promise((r) => setTimeout(r, 2000 * attempt));
        }
      },
    });
    console.log(dryRun ? `\nDry run: ${r.found} to move. Run again without "dry run" to move them.`
      : `\n✓ ${r.copied} copied, ${r.rewritten} title(s) and series updated, ${r.missing.length} couldn't be downloaded (left as they were).`);
    r.missing.slice(0, 50).forEach((u) => console.log(`  missing: ${u}`));
    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, dryRun
        ? `### Dry run\n${r.found} image address(es) would move to R2.\n`
        : `### Images moved to R2\n${r.copied} copied, ${r.rewritten} title(s) and series updated, ${r.missing.length} missing.\n`);
    }
  } catch (err) {
    console.error(`\n✗ ${err.message}`);
    process.exit(1);
  }
}
