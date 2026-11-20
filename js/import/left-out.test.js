// node js/import/left-out.test.js
import assert from 'node:assert/strict';
import { leftOutRows, REASONS, filterLeftOut, reasonChoices } from './left-out.js';

const skipped = [
  { sku: 'A1', title: 'ARCHIE #2 CVR D INC 1:10 DAVID LOPEZ VAR', reason: 'Incentive / ratio variant' },
  { sku: 'A2', title: 'BLADE RUNNER #1 SDCC EXCLUSIVE FOIL VAR', reason: 'Store / convention exclusive' },
  { sku: 'A3', title: 'BATMAN #1 RETAILER BUNDLE', reason: 'Retailer bundle' },
  { sku: 'A4', title: 'SIX OF US #2 (CVR A)', reason: 'Excluded publisher: Dark Horse' },
  { sku: 'A5', title: 'SAGA #74', reason: 'Excluded series: SAGA' },
  { sku: 'A6', title: 'SPAWN #400 ANT VAR', reason: 'Title contains “ant”' },
  { sku: 'A7', title: 'CROSSED #1', reason: 'Mature title (excluded)' },
  { sku: 'A8', title: 'ARCHIE #2 CVR A', reason: 'Listed twice in this sheet' },
  { sku: 'A9', title: 'ODD THING', reason: 'Something new' },
];
const duplicates = [{ sku: 'B1', title: 'X-MEN UNITED #10', on: 'X-MEN UNITED #10 CVR A', code: 'UPC 75960621443301011' }];

const rows = leftOutRows({ skipped }, duplicates);
const by = Object.fromEntries(rows.map((r) => [r.sku, r]));

assert.equal(by.A1.reason, REASONS.ratio);
assert.equal(by.A1.detail, null, 'a plain rule needs no detail');
assert.equal(by.A2.reason, REASONS.exclusive);
assert.equal(by.A3.reason, REASONS.bundle);
for (const sku of ['A4', 'A5', 'A6', 'A7']) assert.equal(by[sku].reason, REASONS.alwaysSkip, sku);
assert.equal(by.A4.detail, 'Excluded publisher: Dark Horse', 'the Always Skip rule that matched is kept');
assert.equal(by.A8, undefined, 'a title listed twice still comes in once, so it is not left out');
assert.equal(by.A9.reason, 'Something new', 'an unknown reason is shown as it is');
assert.equal(by.B1.reason, REASONS.duplicate);
assert.equal(by.B1.detail, 'UPC 75960621443301011 is on “X-MEN UNITED #10 CVR A”');
assert.equal(by.B1.title, 'X-MEN UNITED #10');

// Each SKU once (Lunar lists a title on its FOC sheet and again on its release sheet): the first reason wins.
const twice = leftOutRows({ skipped: [skipped[0], { ...skipped[0], reason: 'Retailer bundle' }] }, [{ ...duplicates[0], sku: 'A1' }]);
assert.equal(twice.length, 1);
assert.equal(twice[0].reason, REASONS.ratio);

assert.deepEqual(leftOutRows({ skipped: [] }, []), []);
assert.deepEqual(leftOutRows({ skipped: [{ sku: '', title: 'NO CODE', reason: 'Retailer bundle' }] }, []), [], 'a row without a code cannot be listed');

// Import → Left Out's filters and its Why choices.
const list = [
  { source: 'prh', sku: '75960621443301021', title: 'X-MEN UNITED #10 JUSTIN MASON VARIANT', reason: REASONS.duplicate, detail: 'UPC 75960621443301021 is on “X-MEN UNITED #10”' },
  { source: 'lunar', sku: '1026DE8339', title: 'BEN 10 #6 CVR ZS DYNAMITE COM VAR', reason: REASONS.exclusive, detail: null },
  { source: 'lunar', sku: '0426MP0001', title: 'COFFIN GIRLS #1 10 COPY UNLOCK VAR', reason: REASONS.ratio, detail: null },
  { source: 'prh', sku: '9781506754208', title: 'Six of Us #2', reason: REASONS.alwaysSkip, detail: 'Excluded publisher: Dark Horse' },
  { source: 'prh', sku: 'Z', title: 'ODD', reason: 'Something new', detail: null },
];
const skus = (rows) => rows.map((r) => r.sku);
assert.equal(filterLeftOut(list).length, 5, 'no filters: everything');
assert.deepEqual(skus(filterLeftOut(list, { q: 'ben 10' })), ['1026DE8339'], 'every word, any case');
assert.deepEqual(skus(filterLeftOut(list, { q: '75960621443301021' })), ['75960621443301021'], 'by code');
assert.deepEqual(skus(filterLeftOut(list, { q: 'dark horse' })), ['9781506754208'], 'by detail');
assert.deepEqual(skus(filterLeftOut(list, { source: 'lunar' })), ['1026DE8339', '0426MP0001']);
assert.deepEqual(skus(filterLeftOut(list, { source: 'prh', reason: REASONS.alwaysSkip })), ['9781506754208']);
assert.deepEqual(filterLeftOut(list, { q: 'ben', source: 'prh' }), []);
assert.deepEqual(reasonChoices([...list, list[1]]).map((c) => `${c.reason} ${c.n}`), [
  `${REASONS.ratio} 1`, `${REASONS.exclusive} 2`, `${REASONS.alwaysSkip} 1`, `${REASONS.duplicate} 1`, 'Something new 1',
], 'the usual reasons in their order, with counts, then any others');

console.log('left out tests passed');
