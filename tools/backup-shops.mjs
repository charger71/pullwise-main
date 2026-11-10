#!/usr/bin/env node
// Automatic nightly backup of every shop in shops.json (.github/workflows/backup.yml). Each shop's database is read
// exactly as Admin → Backup → Download backup reads it (admin/backup.js), with the shop's service key, and the
// same .json.gz file is saved to a PRIVATE R2 bucket (not the public media bucket):
//
//   daily/<shop>/shop-backup-YYYY-MM-DD.json.gz     kept 35 days
//   monthly/<shop>/shop-backup-YYYY-MM-01.json.gz   the first backup of each month, kept 400 days
//
// R2 deletes old files by itself (a lifecycle rule this script sets on every run). Each backup is recorded in the
// shop's job log, so it shows in Backup & Restore → Log and clears the Dashboard's "Back up" reminder.
//
//   node tools/backup-shops.mjs                # every shop
//   node tools/backup-shops.mjs --shop demo    # one shop
//
// Needs SUPABASE_ACCESS_TOKEN, CLOUDFLARE_API_TOKEN (with R2 edit) and CLOUDFLARE_ACCOUNT_ID, plus
// @supabase/supabase-js (the workflow installs it). BACKUP_BUCKET overrides the bucket name.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBackup, recordBackup } from '../admin/backup.js';
import { env, serviceClient } from './catalog-job.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/** The bucket the Worker binds as BACKUPS in wrangler.jsonc (Backup → Nightly Backups reads it from there). */
export function backupBucket(jsonc) {
  const config = JSON.parse(jsonc.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n'));
  const bucket = config.r2_buckets?.find((b) => b.binding === 'BACKUPS')?.bucket_name;
  if (!bucket) throw new Error('wrangler.jsonc needs the BACKUPS R2 bucket');
  return bucket;
}
const DAY = 86400;
export const LIFECYCLE = {
  rules: [
    { id: 'daily-backups', enabled: true, conditions: { prefix: 'daily/' }, deleteObjectsTransition: { condition: { type: 'Age', maxAge: 35 * DAY } } },
    { id: 'monthly-backups', enabled: true, conditions: { prefix: 'monthly/' }, deleteObjectsTransition: { condition: { type: 'Age', maxAge: 400 * DAY } } },
  ],
};

/** Where a shop's backup goes: the daily copy always, and a monthly copy on the 1st (UTC). */
export function backupKeys(shopId, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const name = `shop-backup-${day}.json.gz`;
  return [`daily/${shopId}/${name}`, ...(day.endsWith('-01') ? [`monthly/${shopId}/${name}`] : [])];
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

function r2(account, token) {
  const base = `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets`;
  const call = async (url, init = {}) => {
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } }).catch(() => null);
      if (res && (res.ok || res.status === 404 || (res.status < 500 && res.status !== 429))) return res;
      if (attempt >= 3) return res;
      await pause(2000 * attempt);
    }
  };
  const fail = async (what, res) => { throw new Error(`${what} (${res?.status ?? 'network error'}${res ? `: ${(await res.text()).slice(0, 300)}` : ''})`); };
  return {
    /** Make the bucket if it isn't there yet, and (re)set its clean-up rule. */
    async prepare(bucket) {
      const got = await call(`${base}/${bucket}`);
      if (got?.status === 404) {
        const made = await call(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: bucket }) });
        if (!made?.ok) await fail(`Couldn't create the R2 bucket ${bucket}`, made);
        console.log(`Created the private R2 bucket ${bucket}`);
      } else if (!got?.ok) await fail(`Couldn't read the R2 bucket ${bucket}`, got);
      const rule = await call(`${base}/${bucket}/lifecycle`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(LIFECYCLE) });
      if (!rule?.ok) await fail(`Couldn't set ${bucket}'s clean-up rule`, rule);
    },
    async put(bucket, key, bytes) {
      const res = await call(`${base}/${bucket}/objects/${key.split('/').map(encodeURIComponent).join('/')}`, { method: 'PUT', headers: { 'Content-Type': 'application/gzip' }, body: bytes });
      if (!res?.ok) await fail(`Couldn't save ${key} to R2`, res);
    },
  };
}

/** Back up the shops one at a time. A shop that fails is logged and the rest still run. Returns [{ shop, ok, message }]. */
export async function backupShops(shops, { clientFor, store, now = () => new Date(), log = console.log }) {
  const results = [];
  for (const shop of shops) {
    let sb = null;
    try {
      sb = await clientFor(shop);
      const built = await buildBackup(sb);
      const bytes = new Uint8Array(await built.file.arrayBuffer());
      const keys = backupKeys(shop.id, now());
      for (const key of keys) await store(key, bytes);
      await recordBackup(sb, 'Automatic nightly backup', built);
      const message = `${built.rows.toLocaleString('en-US')} rows in ${built.tables} tables (${(bytes.length / 1024 / 1024).toFixed(1)} MB) → ${keys.join(', ')}`;
      log(`✓ ${shop.id}: ${message}`);
      results.push({ shop: shop.id, ok: true, message });
    } catch (err) {
      const message = String(err?.raw ?? err?.message ?? err);
      log(`✗ ${shop.id}: ${message}`);
      await sb?.from('job_log').insert({ job: 'backup', ok: false, message: `Automatic nightly backup failed: ${message}`.slice(0, 900) }).catch(() => {});
      results.push({ shop: shop.id, ok: false, message });
    }
  }
  return results;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const only = args.includes('--shop') ? args[args.indexOf('--shop') + 1] : null;
  const all = JSON.parse(fs.readFileSync(path.join(ROOT, 'shops.json'), 'utf8')).shops;
  const shops = only ? all.filter((s) => s.id === only) : all;
  if (!shops.length) { console.error(`No shop "${only}" in shops.json`); process.exit(1); }
  const bucket = process.env.BACKUP_BUCKET || backupBucket(fs.readFileSync(path.join(ROOT, 'wrangler.jsonc'), 'utf8'));
  const store = r2(env('CLOUDFLARE_ACCOUNT_ID'), env('CLOUDFLARE_API_TOKEN'));
  env('SUPABASE_ACCESS_TOKEN');
  await store.prepare(bucket);
  const results = await backupShops(shops, { clientFor: serviceClient, store: (key, bytes) => store.put(bucket, key, bytes) });
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Automatic backup → R2 ${bucket}\n${results.map((r) => `- ${r.ok ? '✅' : '❌'} **${r.shop}**: ${r.message}`).join('\n')}\n`);
  }
  const failed = results.filter((r) => !r.ok);
  if (failed.length) { console.error(`${failed.length} of ${results.length} shops failed: ${failed.map((r) => r.shop).join(', ')}`); process.exit(1); }
}
