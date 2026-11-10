// Run: node admin/backup.test.js
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { buildBackup, parseBackup, restoreOrder, restoreTables, stageTable, replaceImpact, failedTable, NOT_RESTORED, customerRows, CUSTOMER_HEADER, FORMAT } from './backup.js';

// Parents load before children (foreign keys stay on during a restore).
const order = restoreOrder(['reservations', 'customer_messages', 'item_creators', 'customers', 'items', 'reservation_orders', 'pull_list_log', 'settings']);
assert.ok(order.indexOf('customers') < order.indexOf('customer_messages'));
assert.ok(order.indexOf('items') < order.indexOf('item_creators'));
assert.ok(order.indexOf('customers') < order.indexOf('reservation_orders'));
assert.ok(order.indexOf('reservation_orders') < order.indexOf('reservations'));
assert.ok(order.indexOf('reservations') < order.indexOf('pull_list_log'));

// Reading a file: gzipped, plain JSON, and rejects anything else with a readable error.
const good = { format: FORMAT, taken_at: '2026-10-12T00:00:00Z', migration: '1', tables: { faqs: { rows: [{ id: 1 }] } } };
const fileOf = (name, bytes) => new File([bytes], name);
assert.deepEqual((await parseBackup(fileOf('b.json.gz', gzipSync(JSON.stringify(good))))).tables.faqs.rows, [{ id: 1 }]);
assert.deepEqual((await parseBackup(fileOf('b.json', JSON.stringify(good)))).migration, '1');
await assert.rejects(parseBackup(fileOf('x.json', JSON.stringify({ format: 'other', tables: {} }))), /isn’t a backup made by Download backup/);
// Backups from the original single-shop site (Pop's Comics) restore too, e.g. to fill the master catalog
assert.equal((await parseBackup(fileOf('popscomics-backup-2026-10-19.json', JSON.stringify({ ...good, format: 'popscomics-backup-1' })))).format, 'popscomics-backup-1');
await assert.rejects(parseBackup(fileOf('x.gz', 'not gzip')), /doesn’t look like a backup/);

// Sending tables: each in chunks of 400 rows (an empty table still sends one empty chunk), then ONE apply call for
// all of them, so the server loads them in a single transaction.
const calls = [];
const applied = { tables: [{ table: 'items', inserted: 950, rows_now: 950, orphans_skipped: 0 }, { table: 'faqs', inserted: 0, rows_now: 0, orphans_skipped: 0 }] };
const sb = { rpc: async (fn, args) => (calls.push([fn, args]), { data: fn === 'restore_apply_all' ? applied : null, error: null }) };
const rows = Array.from({ length: 950 }, (_, i) => ({ id: i }));
const progress = [];
const res = await restoreTables(sb, ['items', 'faqs'], (n) => (n === 'items' ? rows : []), { replace: true, onProgress: (t) => progress.push(t) });
assert.deepEqual(calls.filter(([f]) => f === 'restore_stage_put').map(([, a]) => [a.p_table, a.p_chunk, a.p_rows.length]), [['items', 0, 400], ['items', 1, 400], ['items', 2, 150], ['faqs', 0, 0]]);
assert.deepEqual(calls.filter(([f]) => f !== 'restore_stage_put'), [['restore_apply_all', { p_tables: ['items', 'faqs'], p_replace: true }]]);
assert.equal(calls.at(-1)[0], 'restore_apply_all');
assert.deepEqual(res, applied.tables);
assert.ok(progress.length >= 3);
calls.length = 0;
await stageTable(sb, 'faqs', []);
assert.deepEqual(calls.map(([f, a]) => [f, a.p_rows.length]), [['restore_stage_put', 0]]);

// A failed apply names its table first ("customers: ..."); the friendly error keeps the original in .raw.
assert.equal(failedTable({ message: 'friendly', raw: 'reservations: insert or update on table "reservations" violates foreign key' }), 'reservations');
assert.equal(failedTable(new Error('Only an owner can restore data.')), null);

// What a replace would do to other tables comes from the server, for the warning.
const impact = [{ table: 'subscriptions', action: 'deleted', via: ['customers'], rows: 2 }];
const isb = { rpc: async (fn, args) => (calls.push([fn, args]), { data: impact, error: null }) };
assert.deepEqual(await replaceImpact(isb, ['customers']), impact);
assert.deepEqual(calls.at(-1), ['restore_replace_impact', { p_tables: ['customers'] }]);

// The audit trail and job log are backed up but never offered for restore.
for (const t of ['staff', 'auth_users', 'staff_audit', 'job_log']) assert.ok(NOT_RESTORED.includes(t), t);
assert.ok(!NOT_RESTORED.includes('email_log'));

// Download backup reads the tables in the order backup_meta gives (children before parents), then the sign-in list.
const read = [];
const bsb = { rpc: async (fn, args) => {
  if (fn === 'backup_meta') return { data: { migration: '1', tables: [{ name: 'reservations', pk: 'id' }, { name: 'reservation_orders', pk: 'id' }] }, error: null };
  read.push(args.p_table);
  return { data: { count: 1, rows: [{ id: 1 }] }, error: null };
} };
const built = await buildBackup(bsb);
assert.deepEqual(read, ['reservations', 'reservation_orders', 'auth_users']);
assert.equal(built.rows, 3);

// Customer list: sorted by last name, plain Yes/No columns, nothing internal (ids, tokens) in the file.
const people = [
  { first_name: 'Zed', last_name: 'Adams', email: 'z@x.com', phone: '502-555-0100', address1: '1 Main St', city: 'Springfield', state: 'ST', zip: '40202', email_opt_in: true, notify_arrivals: false, ship_arrivals: false, user_id: 'abc', created_at: '2026-09-01T10:00:00Z', last_emailed_on: '2026-10-08' },
  { first_name: null, last_name: null, name: 'Guest Only', email: null, phone: '555', email_opt_in: false, notify_arrivals: true, ship_arrivals: true, user_id: null, created_at: '2026-10-01T10:00:00Z' },
  { first_name: 'Amy', last_name: 'Zimmer', email: 'a@x.com', phone: null, email_opt_in: true, notify_arrivals: true, ship_arrivals: false, user_id: null, created_at: '2026-08-01T00:00:00Z' },
];
const pages = [people, []]; // a short first page ends the paging
let requested = 0;
const csbStub = { from: () => { const o = { select: () => o, order: () => o, range: () => ({ then: (r) => r({ data: pages[requested++] ?? [], error: null }) }) }; return o; } };
const csv = await customerRows(csbStub);
assert.equal(csv.length, 3);
assert.equal(csv.find((r) => r[1] === 'Adams')[8], 'Yes');
assert.equal(csv.find((r) => r[1] === 'Adams')[11], 'Yes');
assert.equal(csv.find((r) => r[0] === 'Guest Only')[11], 'No');
assert.ok(csv.every((r) => r.length === CUSTOMER_HEADER.length));
assert.ok(!CUSTOMER_HEADER.join().toLowerCase().includes('token') && !JSON.stringify(csv).includes('abc'));
assert.equal(csv[0][1] === '' ? csv[0][0] : csv[0][1], 'Guest Only'); // no last name sorts first

console.log('backup tests passed');

// Nightly backups: listed through the Worker with the staff member's token, with how long each is kept.
{
  const { nightlyBackups, nightlyBackupFile } = await import('./backup.js');
  const nsb = { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } };
  const seen = [];
  const fetchOk = async (url, init) => {
    seen.push([url, init.headers.Authorization]);
    return url.includes('?file=')
      ? new Response(new Uint8Array(10))
      : Response.json({ files: [{ key: 'daily/demo/shop-backup-2026-11-04.json.gz', kind: 'daily', date: '2026-11-04', size: 1 }, { key: 'monthly/demo/shop-backup-2026-11-01.json.gz', kind: 'monthly', date: '2026-11-01', size: 1 }] });
  };
  assert.deepEqual((await nightlyBackups(nsb, fetchOk)).map((f) => f.keptUntil), ['2026-12-09', '2027-12-06']);
  const got = await nightlyBackupFile(nsb, 'daily/demo/shop-backup-2026-11-04.json.gz', fetchOk);
  assert.equal(got.name, 'shop-backup-2026-11-04.json.gz');
  assert.equal(got.file.size, 10);
  assert.deepEqual(seen, [['/__backups', 'Bearer tok'], ['/__backups?file=daily%2Fdemo%2Fshop-backup-2026-11-04.json.gz', 'Bearer tok']]);
  // The Worker's own message comes through; a plain 404 (no Worker: local or a preview build) says why.
  await assert.rejects(nightlyBackups(nsb, async () => Response.json({ error: 'Only an owner can see the backups.' }, { status: 403 })), /Only an owner/);
  await assert.rejects(nightlyBackups(nsb, async () => new Response('<html>', { status: 404 })), /only on the live site/);
}

// Media backup: every file in the bucket (folders too) goes into a valid .zip, with the same paths as in storage.
{
  const { buildMediaBackup, listBucketFiles } = await import('./backup.js');
  const { crc32 } = await import('./zip.js');
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const tree = {
    '': [{ name: 'library', id: null }, { name: 'covers', id: null }],
    library: [{ name: 'a.jpg', id: '1', metadata: { size: 3 } }, { name: 'b-sm.jpg', id: '2', metadata: { size: 2 } }],
    covers: [{ name: 'manual', id: null }],
    'covers/manual': [{ name: 'cover 1.jpg', id: '3', metadata: { size: 4 } }, { name: 'bad.jpg', id: '4', metadata: { size: 1 } }],
  };
  const bytesOf = { 'library/a.jpg': 'AAA', 'library/b-sm.jpg': 'BB', 'covers/manual/cover 1.jpg': 'CCCC' };
  const msb = { storage: { from: () => ({
    list: async (folder) => ({ data: tree[folder] ?? [], error: null }),
    download: async (path) => (bytesOf[path] ? { data: new Blob([bytesOf[path]]), error: null } : { data: null, error: new Error('gone') }),
  }) } };
  assert.deepEqual((await listBucketFiles(msb, 'media')).map((f) => f.path).sort(), ['covers/manual/bad.jpg', 'covers/manual/cover 1.jpg', 'library/a.jpg', 'library/b-sm.jpg']);
  const parts = [];
  const built = await buildMediaBackup(msb, () => {}, async (p) => parts.push(p));
  assert.equal(built.files, 3);
  assert.equal(built.failed, 1);
  assert.equal(built.parts, 1);
  assert.match(parts[0].name, /^shop-media-\d{4}-\d\d-\d\d\.zip$/);
  const built2 = await buildMediaBackup(msb, () => {}, async (p) => parts.push(p), 4); // a tiny limit splits it
  assert.ok(built2.parts >= 3);
  assert.match(parts.at(-1).name, /-part\d+of\d+\.zip$/);
  const { planMediaParts } = await import('./backup.js');
  assert.deepEqual(planMediaParts([{ path: 'a', size: 5 }, { path: 'b', size: 5 }, { path: 'c', size: 1 }], 8).map((g) => g.map((f) => f.path)), [['a'], ['b', 'c']]);
  const zipBlob = parts[0].file;
  const { writeFileSync } = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync } = await import('node:fs');
  const dir = mkdtempSync(`${process.env.TMPDIR ?? '/tmp'}/media-zip-`);
  writeFileSync(`${dir}/m.zip`, Buffer.from(await zipBlob.arrayBuffer()));
  try {
    const listing = execFileSync('unzip', ['-Z1', `${dir}/m.zip`], { encoding: 'utf8' });
    assert.deepEqual(listing.trim().split('\n').sort(), ['covers/manual/cover 1.jpg', 'library/a.jpg', 'library/b-sm.jpg']);
    execFileSync('unzip', ['-tq', `${dir}/m.zip`]);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err; // no unzip on this machine: the structure checks above still ran
  }
}

// Media restore: reads the archive back (ours and a deflated one), then uploads under the same paths.
{
  const { readMediaArchives, restoreMedia, buildMediaBackup } = await import('./backup.js');
  const store = {};
  const tree = { '': [{ name: 'library', id: null }], library: [{ name: 'a.jpg', id: '1', metadata: { size: 3 } }, { name: 'b.png', id: '2', metadata: { size: 2 } }] };
  const src = { storage: { from: () => ({
    list: async (f) => ({ data: tree[f] ?? [], error: null }),
    download: async (p) => ({ data: new Blob([p === 'library/a.jpg' ? 'AAA' : 'BB']), error: null }),
  }) } };
  const made = [];
  await buildMediaBackup(src, () => {}, async (p) => made.push(p.file));
  const entries = await readMediaArchives(made);
  assert.deepEqual(entries.map((e) => e.path), ['library/a.jpg', 'library/b.png']);
  assert.equal(new TextDecoder().decode(await entries[0].read()), 'AAA');
  // a deflated archive (made by Finder, say) reads too
  const raw = new TextEncoder().encode('hello hello hello');
  const def = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  const { crc32 } = await import('./zip.js');
  const nm = new TextEncoder().encode('library/c.jpg');
  const lh = new DataView(new ArrayBuffer(30)); lh.setUint32(0, 0x04034b50, true); lh.setUint16(8, 8, true); lh.setUint32(14, crc32(raw), true); lh.setUint32(18, def.length, true); lh.setUint32(22, raw.length, true); lh.setUint16(26, nm.length, true);
  const ch = new DataView(new ArrayBuffer(46)); ch.setUint32(0, 0x02014b50, true); ch.setUint16(10, 8, true); ch.setUint32(16, crc32(raw), true); ch.setUint32(20, def.length, true); ch.setUint32(24, raw.length, true); ch.setUint16(28, nm.length, true);
  const cdStart = 30 + nm.length + def.length;
  const eo = new DataView(new ArrayBuffer(22)); eo.setUint32(0, 0x06054b50, true); eo.setUint16(8, 1, true); eo.setUint16(10, 1, true); eo.setUint32(12, 46 + nm.length, true); eo.setUint32(16, cdStart, true);
  const deflated = await readMediaArchives([new Blob([lh.buffer, nm, def, ch.buffer, nm, eo.buffer])]);
  assert.equal(new TextDecoder().decode(await deflated[0].read()), 'hello hello hello');
  // unsafe or junk entries are skipped
  assert.deepEqual((await readMediaArchives([new Blob([])]).catch(() => 'bad')), 'bad');
  const dst = { storage: { from: () => ({
    list: async (f) => ({ data: f === '' ? [{ name: 'library', id: null }] : f === 'library' ? [{ name: 'a.jpg', id: '1', metadata: { size: 3 } }] : [], error: null }),
    upload: async (p, blob, opts) => (p.endsWith('.png') && opts.upsert === undefined ? { error: new Error('x') } : (store[p] = opts, { error: null })),
  }) } };
  const r = await restoreMedia(dst, entries);
  assert.deepEqual([r.uploaded, r.skipped, r.failed.length], [1, 1, 0]); // a.jpg was already there
  assert.equal(store['library/b.png'].contentType, 'image/png');
  const r2 = await restoreMedia(dst, entries, { overwrite: true });
  assert.deepEqual([r2.uploaded, r2.skipped], [2, 0]);
  assert.equal(store['library/a.jpg'].upsert, true);
}
