import assert from 'node:assert/strict';
import { applyExclusions, parseSheet } from './distributors.js';

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

// Funko pre-order list: figures differing only by Figure Type get their own SKU (the regular one keeps the plain
// SKU it was always imported under), and a row listed twice is dropped, for every kind of sheet.
const funkoHead = ['Release/By Date', 'Franchise', 'Pop Name/Wave', 'Figure Type', 'Distributor', 'MSRP (Est.)', 'Preorder Deadline'];
const funko = parseSheet([
  funkoHead,
  ['2026-12-01', 'Marvel', 'Venom', 'Pop! Deluxe', 'Funko', '$30', 'Open'],
  ['2026-12-01', 'Marvel', 'Venom', 'Pop!', 'Funko', '$12', 'Open'],
  ['2026-12-01', 'Marvel', 'Venom', 'Pop!', 'Funko', '$12', 'Open'],
  ['2026-12-01', 'Marvel', 'Carnage', 'Pop! Ride', 'Funko', '$40', 'Open'],
], { today: '2026-10-17' });
assert.deepEqual(funko.items.map((i) => i.sku), ['funko:marvel-venom--pop-deluxe', 'funko:marvel-venom', 'funko:marvel-carnage']);
assert.equal(funko.repeated, 1);
assert.deepEqual(funko.skipped.map((s) => s.reason), ['Listed twice in this sheet']);
const lunar = parseSheet([
  ['ProductCode', 'Title', 'RetailCost', 'Publisher', 'Description', 'FinalOrderCutoff', 'InstoreDate', 'UPC', 'ISBN', 'Writer', 'Artist', 'CoverArtist', 'Mature', 'Adult'],
  ['0926DC001', 'BATMAN #1 CVR A', '4.99', 'DC Comics', '', '2026-10-20', '2026-11-18', '', '', '', '', '', '', ''],
  ['0926DC001', 'BATMAN #1 CVR A', '4.99', 'DC Comics', '', '2026-10-20', '2026-11-18', '', '', '', '', '', '', ''],
], { today: '2026-10-17' });
assert.equal(lunar.items.length, 1);
assert.equal(lunar.skipped.at(-1).reason, 'Listed twice in this sheet');
console.log('sku repeats ok');
