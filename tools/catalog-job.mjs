// What the daily automatic imports into the master catalog share (tools/prh-auto-import.mjs,
// tools/lunar-auto-import.mjs): the catalog's database through its service key, covers written straight to R2
// under the catalog's id (as the Worker stores staff uploads, worker/media.js), downloads that retry, and the run's
// line in Import → Recent Runs. Needs SUPABASE_ACCESS_TOKEN, CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, plus
// @supabase/supabase-js (the workflows install it).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { r2Settings } from './move-images-to-r2.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const env = (k) => process.env[k] || (() => { throw new Error(`Set ${k}`); })();
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** The master catalog's entry in shops.json. */
export function catalogShop() {
  const shop = JSON.parse(fs.readFileSync(path.join(ROOT, 'shops.json'), 'utf8')).shops.find((s) => s.catalog);
  if (!shop) throw new Error('No master catalog in shops.json');
  return shop;
}

/** A Supabase client for any shop with its service key, read with the access token the deploy uses. */
export async function serviceClient(shop) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${shop.projectRef}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${env('SUPABASE_ACCESS_TOKEN')}` } });
  if (!res.ok) throw new Error(`Couldn't read ${shop.id}'s keys (${res.status})`);
  const serviceKey = (await res.json()).find((k) => k.name === 'service_role')?.api_key;
  if (!serviceKey) throw new Error(`${shop.id} has no service_role key`);
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(shop.supabaseUrl, serviceKey, { auth: { persistSession: false } });
}

/** The catalog's client (see serviceClient). */
export const catalogClient = serviceClient;

/** Today in the catalog's own timezone (Shop Settings), as YYYY-MM-DD. */
export async function catalogToday(sb) {
  const { data } = await sb.from('settings').select('timezone').eq('id', 1).single();
  return new Intl.DateTimeFormat('en-CA', { timeZone: data?.timezone || 'America/New_York' }).format(new Date());
}

/** The catalog's Always Skip list. */
export async function exclusions(sb) {
  const { data, error } = await sb.from('import_exclusions').select('kind,value');
  if (error) throw new Error(error.message);
  return data;
}

/** Bytes and type of a picture, or null when there isn't one (404, or a tiny blank placeholder). Retries twice. */
export async function download(url) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url).catch(() => null);
    if (res?.status === 404) return null;
    if (res?.ok) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      return bytes.length >= 1024 ? { bytes, type: res.headers.get('content-type')?.split(';')[0] || 'image/jpeg' } : null;
    }
    if (attempt >= 3) throw new Error(`Couldn't download ${url} (${res?.status ?? 'network error'})`);
    await pause(2000 * attempt);
  }
}

/** applyImport's putMedia for the catalog: the picture straight into R2, returning its public address. */
export function r2PutMedia(shop) {
  const { bucket, publicBase } = r2Settings(fs.readFileSync(path.join(ROOT, 'wrangler.jsonc'), 'utf8'));
  const token = env('CLOUDFLARE_API_TOKEN');
  const account = env('CLOUDFLARE_ACCOUNT_ID');
  return async (_sb, objectPath, bytes, { contentType }) => {
    const objectKey = `${shop.id}/${objectPath}`.split('/').map(encodeURIComponent).join('/');
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${bucket}/objects/${objectKey}`, {
        method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType, 'Cache-Control': 'public, max-age=604800' }, body: bytes,
      }).catch(() => null);
      if (res?.ok) return `${publicBase.replace(/\/+$/, '')}/${objectKey}`;
      if (attempt >= 3) throw new Error(`Couldn't upload ${objectPath} to R2 (${res?.status ?? 'network error'})`);
      await pause(2000 * attempt);
    }
  };
}

/**
 * Replace a source's list in Import → Left Out (rows from js/import/left-out.js leftOutRows). A failure here doesn't
 * fail the import: the titles are already saved, so it is only reported in the run's log.
 */
export async function saveLeftOut(sb, source, rows) {
  const { data, error } = await sb.rpc('catalog_replace_left_out', { p_source: source, p_rows: rows });
  if (error) {
    console.log(`  left-out list not saved: ${error.message}`);
    return null;
  }
  return data;
}

/**
 * Email what a run left out (js/import/left-out.js leftOutEmail) to LEFT_OUT_EMAIL (comma-separated addresses), through
 * Resend with the RESEND_API_KEY and RESEND_FROM repository secrets, with the list as a CSV attachment. Recorded in the
 * catalog's Admin → Emails. Skipped, with a line in the log, when any of the three isn't set; a failure here never fails
 * the import.
 * @param fetchFn  for tests
 * @returns 'sent' | 'skipped' | 'failed'
 */
export async function emailLeftOut(sb, { mail, sentBy }, fetchFn = fetch) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  const to = (process.env.LEFT_OUT_EMAIL ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const missing = [!key && 'RESEND_API_KEY', !from && 'RESEND_FROM', !to.length && 'LEFT_OUT_EMAIL'].filter(Boolean);
  if (missing.length) {
    console.log(`  left-out email not sent: set ${missing.join(', ')}`);
    return 'skipped';
  }
  let error = null;
  try {
    const res = await fetchFn('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from, to, subject: mail.subject, html: mail.html, text: mail.text,
        attachments: [{ filename: mail.filename, content: Buffer.from(`\ufeff${mail.csv}`, 'utf8').toString('base64') }],
      }),
    });
    if (!res.ok) error = `Resend: ${(await res.json().catch(() => ({}))).message ?? res.status}`;
  } catch (err) {
    error = `Resend: ${err.message}`;
  }
  console.log(error ? `  left-out email not sent: ${error}` : `  left-out email sent to ${to.join(', ')}`);
  const logged = await sb?.from('email_log').insert({ kind: 'left_out', to_email: to.join(', '), subject: mail.subject, body: mail.text.slice(0, 20000), status: error ? 'failed' : 'sent', error, sent_by: sentBy });
  if (logged?.error) console.log(`  email log not written: ${logged.error.message}`);
  return error ? 'failed' : 'sent';
}

/** Record a run in job_log (Import → Recent Runs) and the GitHub run's summary. */
export async function logRun(sb, { job, title, ok, message, detail }) {
  await sb?.from('job_log').insert({ job, ok, message, detail });
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${title}\n${message}\n`);
}
