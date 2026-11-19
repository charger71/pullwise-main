// Run: node tools/restore.test.js
import assert from 'node:assert/strict';
import { tableSql, main } from './restore.mjs';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const rows = Array.from({ length: 1500 }, (_, i) => ({ id: i + 1, title: `It's #${i}`, search_norm: 'x', note: 'a'.repeat(1000) }));
const meta = { pk: 'id', generated: ['search_norm'], identity_always: ['id'] };

const parts = tableSql('items', meta, rows);
assert.ok(parts.length > 1, 'a big table is split into parts');
for (const p of parts) {
  assert.ok(p.length < 1_000_000, 'each part stays under the request limit');
  assert.ok(p.startsWith('begin;') && p.trimEnd().endsWith('commit;'), 'each part is its own transaction');
  const cols = p.match(/insert into public\."items" \(([^)]*)\)/)[1];
  assert.ok(!cols.includes('search_norm') && cols.includes('title'), 'generated columns are not written');
  assert.ok(p.includes('overriding system value') && p.includes('on conflict do nothing'));
}
assert.ok(parts.at(-1).includes('setval('), 'identity counter is moved past the restored ids');
assert.ok(parts.join('').includes("It''s #7"), 'quotes are escaped');

const replaced = tableSql('items', meta, rows, { replace: true });
assert.ok(replaced[0].includes('delete from public."items";'), 'replace deletes first');
assert.ok(!replaced.slice(1).some((p) => p.includes('delete from')), 'only the first part deletes');
assert.ok(!replaced.join('').includes('on conflict'), 'replace mode does not need conflict handling');

assert.equal(tableSql('empty', { pk: 'id', generated: [], identity_always: [] }, []).length, 1);
// A restore that brings back titles ends by starting the catalog sync over, and the sync position is never restored
// (20270409000000_restore_resyncs_catalog.sql does the same for restores from Admin -> Staff -> Backup).
const dir = mkdtempSync(join(tmpdir(), 'restore-test-'));
const backup = (tables) => {
  const file = join(dir, `b${Math.random().toString(36).slice(2)}.json.gz`);
  const t = Object.fromEntries(Object.entries(tables).map(([n, rows]) => [n, { pk: 'id', generated: [], identity_always: [], rows }]));
  writeFileSync(file, gzipSync(JSON.stringify({ format: 'shop-backup-1', tables: t })));
  return file;
};
const log = console.log;
console.log = () => {};
const withItems = main([backup({ items: [{ id: 1, title: 'A' }], catalog_sync_state: [{ id: 1, cursor_at: '2026-11-03T00:00:00Z', cursor_id: 9 }], categories: [{ id: 1 }] }), join(dir, 'a')]);
const noItems = main([backup({ categories: [{ id: 1 }] }), join(dir, 'b')]);
console.log = log;
assert.ok(!withItems.some((f) => f.includes('restore-catalog_sync_state')), 'the sync position is never restored');
assert.ok(withItems.at(-1).endsWith('restore-catalog-sync-reset.sql'), 'restoring titles ends with the sync reset');
assert.match(readFileSync(withItems.at(-1), 'utf8'), /update public\.catalog_sync_state set cursor_at = null, cursor_id = null where id = 1;/);
assert.deepEqual(readFileSync(join(dir, 'a', 'restore-all.txt'), 'utf8').trim().split('\n'), withItems, 'restore-all.txt lists it last');
assert.ok(!noItems.some((f) => f.includes('catalog-sync-reset')), 'no titles, no reset');

console.log('restore tests passed');
