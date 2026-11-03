// node tools/lunar-auto-import.test.mjs
import assert from 'node:assert/strict';
import { sheetList, sheetUrl, sheetName, summary, FOC_WEEKS, RELEASE_WEEKS } from './lunar-auto-import.mjs';

// Which sheets: FOC Mondays from today, then this week's Wednesday (even if passed) and the next 4
const tue = sheetList('2026-11-03'); // a Tuesday
assert.equal(tue.length, FOC_WEEKS + RELEASE_WEEKS);
assert.deepEqual(tue.slice(0, 2), [{ kind: 'foc', date: '2026-11-09' }, { kind: 'foc', date: '2026-11-16' }]);
assert.deepEqual(tue[FOC_WEEKS - 1], { kind: 'foc', date: '2026-12-28' });
assert.deepEqual(tue.slice(FOC_WEEKS).map((s) => s.date), ['2026-11-04', '2026-11-11', '2026-11-18', '2026-11-25', '2026-12-02']);
assert.equal(sheetList('2026-11-09')[0].date, '2026-11-09', 'on a Monday, that day\'s FOC sheet');
assert.equal(sheetList('2026-11-06').find((s) => s.kind === 'release').date, '2026-11-04', 'on a Friday, the Wednesday just gone');
assert.equal(sheetList('2026-11-04').find((s) => s.kind === 'release').date, '2026-11-04', 'on a Wednesday, that day');
assert.equal(sheetList('2026-11-08').find((s) => s.kind === 'release').date, '2026-11-11', 'on a Sunday, the coming Wednesday');

// Links and names
assert.equal(sheetUrl({ kind: 'foc', date: '2026-11-09' }), 'https://www.lunardistribution.com/home/productdatafile?foc=11/9/2026');
assert.equal(sheetUrl({ kind: 'release', date: '2027-01-06' }), 'https://www.lunardistribution.com/home/productdatafile?release=1/6/2027');
assert.equal(sheetName({ kind: 'foc', date: '2026-11-09' }), 'FOC Nov 9');
assert.equal(sheetName({ kind: 'release', date: '2026-11-04' }), 'Release Nov 4');

// Recent Runs line
assert.equal(summary([
  { sheet: 'FOC Nov 9', added: 120, updated: 4, unchanged: 300, skipped: 30, covers: 118, coversMissing: 2 },
  { sheet: 'FOC Dec 28', missing: true },
  { sheet: 'Release Nov 4', added: 0, updated: 12, unchanged: 400, skipped: 25, covers: 0, coversMissing: 0 },
  { sheet: 'Release Nov 11', error: 'timed out' },
]), 'Lunar, 2 of 4 sheets: 120 added, 16 refreshed, 700 unchanged, 55 skipped, 118 covers, 2 without a cover yet. not out yet: FOC Dec 28. failed: Release Nov 11: timed out');

console.log('lunar auto-import tests passed');
