// Admin -> Backup (owners): reads every table through backup_meta / backup_page and builds ONE gzipped
// file in the browser. The pseudo-table auth_users is the customers' sign-ins (with password hashes), restored first. tools/restore.mjs turns that file back into SQL (see BACKUPS.md).

import { must } from '../js/util.js';
import { ZipBuilder, readZip } from './zip.js';

const PAGE = 1000;
export const FORMAT = 'shop-backup-1';
// Files this can restore: its own, and those made by the original single-shop site (Pop's Comics, ComicStore),
// which have the same layout. That's how a shop moving over, or the master catalog, is filled from an old site.
export const RESTORABLE_FORMATS = [FORMAT, 'popscomics-backup-1'];

/** Read every table. `onProgress(text)` is called as it goes. Returns { file (Blob), tables, rows, name }. */
export async function buildBackup(sb, onProgress = () => {}) {
  const meta = await must(sb.rpc('backup_meta'));
  // backup_meta lists child tables before their parents. Each page is read separately (not one snapshot), so reading
  // children first means a parent row is still there when its table is read after them, even if someone adds an
  // order mid-backup. The restore also skips (and counts) any child row whose parent didn't make it into the file.
  const list = [...meta.tables, { name: 'auth_users', pk: 'id', generated: [], identity_always: [] }];
  const out = { format: FORMAT, taken_at: new Date().toISOString(), migration: meta.migration, tables: {} };
  let total = 0;
  for (const [i, t] of list.entries()) {
    onProgress(`Reading ${t.name} (${i + 1} of ${list.length})…`);
    let rows = [];
    for (let attempt = 0; ; attempt++) {
      rows = [];
      let count = 0;
      for (let offset = 0; ; offset += PAGE) {
        const page = await must(sb.rpc('backup_page', { p_table: t.name, p_offset: offset, p_limit: PAGE }));
        count = Number(page.count);
        rows.push(...page.rows);
        if (page.rows.length < PAGE || rows.length >= count) break;
      }
      if (rows.length === count) break;
      if (attempt >= 2) throw new Error(`${t.name}: read ${rows.length} rows but the table has ${count}. Someone changed it while the backup ran; try again.`);
    }
    out.tables[t.name] = { pk: t.pk, generated: t.generated, identity_always: t.identity_always, rows };
    total += rows.length;
  }
  onProgress('Compressing…');
  const gz = new Response(new Blob([JSON.stringify(out)]).stream().pipeThrough(new CompressionStream('gzip')));
  const day = new Date().toLocaleDateString('en-CA');
  return { file: await gz.blob(), tables: list.length, rows: total, name: `shop-backup-${day}.json.gz` };
}

/** Every file in a storage bucket, folders included: [{ path, size }]. */
export async function listBucketFiles(sb, bucket, folder = '') {
  const out = [];
  const entries = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await must(sb.storage.from(bucket).list(folder, { limit: 1000, offset }));
    entries.push(...page);
    if (page.length < 1000) break;
  }
  for (const e of entries) {
    const path = folder ? `${folder}/${e.name}` : e.name;
    if (e.id) out.push({ path, size: e.metadata?.size ?? 0 });
    else out.push(...(await listBucketFiles(sb, bucket, path))); // an entry with no id is a folder
  }
  return out;
}

/** About how much goes in one media archive: small enough to build and save in the browser without running out of memory. */
export const MEDIA_PART_BYTES = 250 * 1024 * 1024;

/** Splits the files (by the sizes storage lists) into archives of about `limit` bytes each; a file bigger than that gets its own. */
export function planMediaParts(files, limit = MEDIA_PART_BYTES) {
  const parts = [];
  let cur = [];
  let size = 0;
  for (const f of files) {
    if (cur.length && size + f.size > limit) (parts.push(cur), (cur = []), (size = 0));
    cur.push(f);
    size += f.size;
  }
  if (cur.length) parts.push(cur);
  return parts;
}

/**
 * Every uploaded picture (the Media bucket) as one or more .zip archives, same folder names as in storage. Each archive
 * is built, handed to `onPart({ file, name, index, count, files })` to save, then dropped before the next is built, so a
 * big library never sits in memory all at once. Files that fail to download are counted, not hidden.
 * Returns { files, failed, parts, bytes }.
 */
export async function buildMediaBackup(sb, onProgress = () => {}, onPart = async () => {}, limit = MEDIA_PART_BYTES) {
  const listed = await listBucketFiles(sb, 'media');
  const plan = planMediaParts(listed, limit);
  const day = new Date().toLocaleDateString('en-CA');
  let done = 0;
  let failed = 0;
  let bytes = 0;
  for (const [i, group] of plan.entries()) {
    const zip = new ZipBuilder();
    const queue = [...group];
    let inPart = 0;
    await Promise.all(Array.from({ length: 6 }, async () => {
      for (let f = queue.shift(); f; f = queue.shift()) {
        const { data, error } = await sb.storage.from('media').download(f.path);
        if (error || !data) failed++;
        else {
          const buf = new Uint8Array(await data.arrayBuffer());
          zip.add(f.path, buf);
          bytes += buf.length;
          inPart++;
        }
        onProgress(`Reading pictures: ${++done} of ${listed.length}${plan.length > 1 ? ` (archive ${i + 1} of ${plan.length})` : ''}`);
      }
    }));
    const name = plan.length > 1 ? `shop-media-${day}-part${i + 1}of${plan.length}.zip` : `shop-media-${day}.zip`;
    await onPart({ file: zip.finish(), name, index: i + 1, count: plan.length, files: inPart });
  }
  return { files: listed.length - failed, failed, parts: plan.length, bytes };
}

const IMAGE_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif' };

/** The pictures in the picked media archives: [{ path, size, read }], skipping folders, Mac metadata and unsafe paths. */
export async function readMediaArchives(files) {
  const out = [];
  for (const file of files) {
    for (const e of await readZip(file)) {
      const path = e.name.replace(/^\.?\//, '');
      if (!path || path.endsWith('/') || path.startsWith('__MACOSX/') || /(^|\/)(\.DS_Store|\._[^/]*)$/.test(path)) continue;
      if (path.includes('\\') || path.split('/').some((seg) => seg === '..' || seg === '')) continue;
      out.push({ path, size: e.size, read: e.read });
    }
  }
  return out;
}

/**
 * Uploads the pictures back to the media bucket under their original paths. `overwrite` false leaves any picture that is
 * already there alone (only the missing ones come back). Returns { uploaded, skipped, failed: [path] }.
 */
export async function restoreMedia(sb, entries, { overwrite = false, onProgress = () => {} } = {}) {
  const have = overwrite ? new Set() : new Set((await listBucketFiles(sb, 'media')).map((f) => f.path));
  const todo = entries.filter((e) => !have.has(e.path));
  const result = { uploaded: 0, skipped: entries.length - todo.length, failed: [] };
  const queue = [...todo];
  let done = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let e = queue.shift(); e; e = queue.shift()) {
      try {
        const bytes = await e.read();
        const type = IMAGE_TYPES[e.path.split('.').pop().toLowerCase()] ?? 'application/octet-stream';
        const { error } = await sb.storage.from('media').upload(e.path, new Blob([bytes], { type }), { upsert: overwrite, contentType: type, cacheControl: '31536000' });
        if (error) throw error;
        result.uploaded++;
      } catch {
        result.failed.push(e.path);
      }
      onProgress(`Restoring pictures: ${++done} of ${todo.length}`);
    }
  }));
  return result;
}

/** Days since the last recorded backup download, or null if there never was one. */
export async function lastBackup(sb) {
  const { data } = await sb.from('job_log').select('created_at,message').eq('job', 'backup').eq('ok', true).order('id', { ascending: false }).limit(1);
  const row = data?.[0];
  return row ? { at: row.created_at, message: row.message, days: Math.floor((Date.now() - new Date(row.created_at)) / 86400000) } : null;
}

export async function recordBackup(sb, who, built) {
  await sb.from('job_log').insert({ job: 'backup', ok: true, message: `${who}: ${built.rows.toLocaleString()} rows in ${built.tables} tables (${(built.file.size / 1024 / 1024).toFixed(1)} MB)` });
}

// ---------------------------------------------------------------------------------------------------------
// Nightly backups (tools/backup-shops.mjs saves them to R2; worker/backups.js lists and serves them to owners)
// ---------------------------------------------------------------------------------------------------------

export const BACKUPS_URL = '/__backups';
/** How long R2 keeps each kind of file (tools/backup-shops.mjs → LIFECYCLE). */
export const KEPT_DAYS = { daily: 35, monthly: 400, weekly: 35 };

async function backupsFetch(sb, query, fetchFn) {
  const { data } = await sb.auth.getSession();
  const res = await fetchFn(`${BACKUPS_URL}${query}`, { headers: { Authorization: `Bearer ${data?.session?.access_token ?? ''}` } });
  if (res.ok) return res;
  const out = await res.json().catch(() => null);
  throw new Error(out?.error ?? (res.status === 404 ? 'Nightly backups are only on the live site.' : `The backups didn’t load (${res.status}).`));
}

/** This shop's nightly backup files, newest first: [{ key, kind, date, size, keptUntil }]. */
export async function nightlyBackups(sb, fetchFn = fetch) {
  const { files } = await (await backupsFetch(sb, '', fetchFn)).json();
  return files.map((f) => {
    const until = new Date(`${f.date}T00:00:00Z`);
    until.setUTCDate(until.getUTCDate() + (KEPT_DAYS[f.kind] ?? 0));
    return { ...f, keptUntil: until.toISOString().slice(0, 10) };
  });
}

/** One nightly file, as { file (Blob), name }. */
export async function nightlyBackupFile(sb, key, fetchFn = fetch) {
  const res = await backupsFetch(sb, `?file=${encodeURIComponent(key)}`, fetchFn);
  return { file: await res.blob(), name: key.split('/').pop() };
}

// ---------------------------------------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------------------------------------

/**
 * Tables a restore never writes: the staff list (re-add people under Staff), and
 * the audit trail and job log (so a restore can't rewrite the record of who did what). They are still backed up.
 */
export const NOT_RESTORED = ['staff', 'staff_audit', 'job_log', 'restore_stage'];
const CHUNK = 400;
// Parents before children, for showing the list (the server works out the real load order from the foreign keys).
const FIRST = ['auth_users', 'settings', 'locations', 'categories', 'customers', 'items', 'pages', 'events', 'posts', 'surveys', 'reservation_orders', 'reservations'];

export const restoreOrder = (names) => [...names].sort((a, b) => (FIRST.indexOf(a) + 1 || 99) - (FIRST.indexOf(b) + 1 || 99) || a.localeCompare(b));

/** Read a downloaded backup file (.json.gz or .json). Throws a readable error if it isn't one of ours. */
export async function parseBackup(file) {
  let data;
  try {
    const gz = /\.gz$/i.test(file.name) || new Uint8Array(await file.slice(0, 2).arrayBuffer()).join() === '31,139';
    data = gz ? await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).json() : JSON.parse(await file.text());
  } catch {
    throw new Error('That doesn’t look like a backup file. Pick a shop-backup-….json.gz file made by Download backup.');
  }
  if (!RESTORABLE_FORMATS.includes(data?.format) || typeof data.tables !== 'object') throw new Error('That file isn’t a backup made by Download backup.');
  return data;
}

/** Rows each table has right now. */
export async function currentCounts(sb, names) {
  const out = {};
  for (const n of names) out[n] = Number((await must(sb.rpc('backup_page', { p_table: n, p_offset: 0, p_limit: 1 }))).count);
  return out;
}

/**
 * Other tables that replacing `names` would empty or unlink through their foreign keys (ON DELETE CASCADE / SET NULL),
 * plus any that would refuse it: [{ table, action: 'deleted' | 'unlinked' | 'blocks', via: [tables], rows }].
 */
export const replaceImpact = (sb, names) => must(sb.rpc('restore_replace_impact', { p_tables: names }));

/** Upload one table's rows to the server's staging area, in chunks. Nothing is changed until restoreTables applies them. */
export async function stageTable(sb, name, rows) {
  const chunks = Math.max(1, Math.ceil(rows.length / CHUNK));
  for (let c = 0; c < chunks; c++) {
    await must(sb.rpc('restore_stage_put', { p_table: name, p_chunk: c, p_rows: rows.slice(c * CHUNK, (c + 1) * CHUNK) }));
  }
}

/**
 * Load the given tables from the backup in ONE transaction: if any table fails, none of them is changed.
 * replace = delete their current rows first. `onProgress(text)` is called while uploading.
 * Returns [{ table, inserted, rows_now, orphans_skipped }] in the order they were loaded.
 */
export async function restoreTables(sb, names, rowsOf, { replace = false, onProgress = () => {} } = {}) {
  for (const [i, n] of names.entries()) {
    onProgress(`Uploading ${n} (${i + 1} of ${names.length})…`);
    await stageTable(sb, n, rowsOf(n));
  }
  onProgress(`Loading ${names.length === 1 ? names[0] : `${names.length} tables`}…`);
  return (await must(sb.rpc('restore_apply_all', { p_tables: names, p_replace: replace }))).tables;
}

/** The table a failed restore_apply_all names at the start of its message ("customers: …"), if any. */
export const failedTable = (err) => String(err?.raw ?? err?.message ?? '').match(/^([a-z0-9_]+): /)?.[1] ?? null;

export async function recordRestore(sb, who, mode, results) {
  const ok = results.every((r) => !r.error);
  await sb.from('job_log').insert({
    job: 'restore',
    ok,
    message: `${who}: ${mode} — ${results.map((r) => (r.error ? `${r.table} FAILED (${r.error})` : `${r.table} ${r.inserted} loaded${r.orphans ? `, ${r.orphans} skipped (parent missing)` : ''}`)).join(', ')}`.slice(0, 900),
  });
}

// ---------------------------------------------------------------------------------------------------------
// Customer list (CSV)
// ---------------------------------------------------------------------------------------------------------

export const CUSTOMER_HEADER = ['First name', 'Last name', 'Email', 'Phone', 'Address', 'City', 'State', 'Zip', 'Weekly pull list email', '“Your books are in” email', 'Ship arrivals', 'Has website login', 'Joined', 'Last emailed'];
const yes = (v) => (v ? 'Yes' : 'No');

/** One CSV row per customer: contact details and email choices only (no internal ids or unsubscribe tokens). */
export async function customerRows(sb) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const data = await must(
      sb.from('customers').select('first_name,last_name,name,email,phone,address1,city,state,zip,email_opt_in,notify_arrivals,ship_arrivals,user_id,created_at,last_emailed_on').order('id').range(from, from + 999),
    );
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows
    .sort((a, b) => `${a.last_name ?? ''} ${a.first_name ?? ''}`.localeCompare(`${b.last_name ?? ''} ${b.first_name ?? ''}`, undefined, { sensitivity: 'base' }))
    .map((c) => [
      c.first_name ?? (c.last_name ? '' : c.name ?? ''), c.last_name ?? '', c.email ?? '', c.phone ?? '', c.address1 ?? '', c.city ?? '', c.state ?? '', c.zip ?? '',
      yes(c.email_opt_in), yes(c.notify_arrivals), yes(c.ship_arrivals), yes(c.user_id), (c.created_at ?? '').slice(0, 10), c.last_emailed_on ?? '',
    ]);
}

export const PULL_HEADER = ['First name', 'Last name', 'Email', 'Phone', 'Kind', 'Title or series', 'Issue', 'Variant', 'Publisher', 'Quantity', 'Status', 'Release date', 'Added'];
const STATUS_WORDS = { open: 'Open', ordered: 'Ordered', reordered: 'Reordered', not_ordered: 'Not ordered', arrived: 'Arrived' };
const IN_PLAY = Object.keys(STATUS_WORDS);

async function allRows(query) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const data = await must(query().range(from, from + 999));
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

/**
 * Every customer's current pull list for taking away: one row per title still in play (open, ordered, arrived) and one
 * per series or creator they follow (new issues are added to their list automatically). Customers with nothing on
 * their list still get a row, so the file is also the full customer list. Orders not linked to a customer are left out.
 */
export async function pullListRows(sb) {
  const customers = await allRows(() => sb.from('customers').select('id,first_name,last_name,name,email,phone').order('id'));
  const lines = await allRows(() => sb.from('reservations').select('id,quantity,status,created_at,item:items(title,issue_number,variant,publisher,release_date),order:reservation_orders!inner(customer_id)').in('status', IN_PLAY).order('id'));
  const follows = await allRows(() => sb.from('subscriptions').select('id,customer_id,kind,label,role,quantity,created_at').order('id'));
  const byCustomer = new Map(customers.map((c) => [c.id, []]));
  for (const l of lines) {
    const mine = byCustomer.get(l.order?.customer_id);
    if (mine) mine.push(['Title on pull list', l.item?.title ?? '', l.item?.issue_number ?? '', l.item?.variant ?? '', l.item?.publisher ?? '', l.quantity, STATUS_WORDS[l.status] ?? l.status, l.item?.release_date ?? '', (l.created_at ?? '').slice(0, 10)]);
  }
  for (const f of follows) {
    const mine = byCustomer.get(f.customer_id);
    if (mine) mine.push([f.kind === 'series' ? 'Follows series' : `Follows ${f.role === 'cover' ? 'cover artist' : 'creator'}`, f.label ?? '', '', '', '', f.quantity, '', '', (f.created_at ?? '').slice(0, 10)]);
  }
  return customers
    .sort((a, b) => `${a.last_name ?? ''} ${a.first_name ?? ''}`.localeCompare(`${b.last_name ?? ''} ${b.first_name ?? ''}`, undefined, { sensitivity: 'base' }))
    .flatMap((c) => {
      const who = [c.first_name ?? (c.last_name ? '' : c.name ?? ''), c.last_name ?? '', c.email ?? '', c.phone ?? ''];
      const mine = byCustomer.get(c.id);
      return mine.length ? mine.map((m) => [...who, ...m]) : [[...who, '', '', '', '', '', '', '', '', '']];
    });
}

export async function recordMediaBackup(sb, who, built) {
  await sb.from('job_log').insert({ job: 'media_backup', ok: built.failed === 0, message: `${who}: ${built.files.toLocaleString()} pictures in ${built.parts} ${built.parts === 1 ? 'file' : 'files'} (${(built.bytes / 1024 / 1024).toFixed(1)} MB)${built.failed ? `, ${built.failed} could not be read` : ''}` });
}

export async function recordMediaRestore(sb, who, mode, r) {
  await sb.from('job_log').insert({ job: 'media_restore', ok: r.failed.length === 0, message: `${who}: ${mode} — ${r.uploaded.toLocaleString()} pictures loaded, ${r.skipped.toLocaleString()} already there${r.failed.length ? `, ${r.failed.length} FAILED (${r.failed.slice(0, 3).join(', ')}${r.failed.length > 3 ? ', …' : ''})` : ''}` });
}
