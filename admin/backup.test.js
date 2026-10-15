// Run: node admin/backup.test.js
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { parseBackup, restoreOrder, restoreTable, customerRows, CUSTOMER_HEADER, FORMAT } from './backup.js';

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
await assert.rejects(parseBackup(fileOf('x.json', JSON.stringify({ format: 'other', tables: {} }))), /isn’t a Pop/);
await assert.rejects(parseBackup(fileOf('x.gz', 'not gzip')), /doesn’t look like a backup/);

// Sending a table: chunks of 400 rows, then one apply call; an empty table still sends one empty chunk.
const calls = [];
const sb = { rpc: async (fn, args) => (calls.push([fn, args]), { data: fn === 'restore_apply' ? { inserted: 1, rows_now: 1 } : null, error: null }) };
const rows = Array.from({ length: 950 }, (_, i) => ({ id: i }));
const res = await restoreTable(sb, 'items', rows, { replace: true });
assert.deepEqual(calls.filter(([f]) => f === 'restore_stage_put').map(([, a]) => [a.p_chunk, a.p_rows.length]), [[0, 400], [1, 400], [2, 150]]);
assert.deepEqual(calls.at(-1), ['restore_apply', { p_table: 'items', p_replace: true }]);
assert.equal(res.inserted, 1);
calls.length = 0;
await restoreTable(sb, 'faqs', [], {});
assert.deepEqual(calls.map(([f]) => f), ['restore_stage_put', 'restore_apply']);
assert.equal(calls[0][1].p_rows.length, 0);

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
