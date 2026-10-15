import assert from 'node:assert/strict';
import { applyExclusions } from './distributors.js';

const item = (title, publisher, mature = false) => ({ sku: title, title, issue_number: '1', variant: null, publisher, mature });
const parsed = {
  distributor: 'lunar',
  items: [item('HELLBLAZER', 'DC'), item('BATMAN', 'DC'), item('CRIMINAL', 'Image', true), item('LOCKE & KEY (Hardcover)', 'IDW'), item('SAGA', 'Image')],
  skipped: [],
};
const titles = (r) => r.items.map((i) => i.title);

assert.equal(applyExclusions(parsed, []), parsed);
assert.deepEqual(titles(applyExclusions(parsed, [{ kind: 'publisher', value: 'dc comics' }])), ['CRIMINAL', 'LOCKE & KEY (Hardcover)', 'SAGA']);
assert.deepEqual(titles(applyExclusions(parsed, [{ kind: 'series', value: 'Hellblazer' }, { kind: 'series', value: 'locke and key' }])), ['BATMAN', 'CRIMINAL', 'LOCKE & KEY (Hardcover)', 'SAGA']);
assert.deepEqual(titles(applyExclusions(parsed, [{ kind: 'series', value: 'locke & key' }])), ['HELLBLAZER', 'BATMAN', 'CRIMINAL', 'SAGA']);
const mature = applyExclusions(parsed, [{ kind: 'mature', value: '' }]);
assert.deepEqual(titles(mature), ['HELLBLAZER', 'BATMAN', 'LOCKE & KEY (Hardcover)', 'SAGA']);
assert.equal(mature.skipped[0].reason, 'Mature title (excluded)');
const kw = applyExclusions(parsed, [{ kind: 'keyword', value: 'key' }, { kind: 'keyword', value: 'sag' }]);
assert.deepEqual(titles(kw), ['HELLBLAZER', 'BATMAN', 'CRIMINAL', 'SAGA']);
assert.equal(kw.skipped[0].reason, 'Title contains “key”');
console.log('exclusions ok');
