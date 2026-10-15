// Run: node tools/restore.test.js
import assert from 'node:assert/strict';
import { tableSql } from './restore.mjs';

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
console.log('restore tests passed');
