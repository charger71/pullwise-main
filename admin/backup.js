// Admin -> Staff -> Backup (owners): reads every table through backup_meta / backup_page and builds ONE gzipped
// file in the browser. tools/restore.mjs turns that file back into SQL (see BACKUPS.md).

import { must } from '../js/util.js';

const PAGE = 1000;
export const FORMAT = 'shop-backup-1';

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
// Restore
// ---------------------------------------------------------------------------------------------------------

/**
 * Tables a restore never writes: the staff list (re-add people under Staff), the sign-in list (reference only), and
 * the audit trail and job log (so a restore can't rewrite the record of who did what). They are still backed up.
 */
export const NOT_RESTORED = ['staff', 'auth_users', 'staff_audit', 'job_log', 'restore_stage'];
const CHUNK = 400;
// Parents before children, for showing the list (the server works out the real load order from the foreign keys).
const FIRST = ['settings', 'categories', 'customers', 'items', 'pages', 'events', 'posts', 'surveys', 'reservation_orders', 'reservations'];

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
  if (data?.format !== FORMAT || typeof data.tables !== 'object') throw new Error('That file isn’t a Pop’s Comics backup.');
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
