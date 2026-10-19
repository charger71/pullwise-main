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
