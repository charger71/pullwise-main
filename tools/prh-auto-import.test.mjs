// node tools/prh-auto-import.test.mjs
import assert from 'node:assert/strict';
import { weekRanges, weekUrl, fetchRecords, summary, WEEKS } from './prh-auto-import.mjs';
import { unchanged } from '../js/import/apply.js';

// Windows: 13 seven-day spans from today, across a month and year end
const ranges = weekRanges('2026-12-28');
assert.equal(ranges.length, WEEKS);
assert.deepEqual(ranges[0], { from: '2026-12-28', to: '2027-01-03' });
assert.deepEqual(ranges[1], { from: '2027-01-04', to: '2027-01-10' });
assert.equal(ranges.at(-1).to, '2027-03-28');

// URL: PRH's MM/dd/yyyy dates, every title, no links (they'd echo the key)
const url = new URL(weekUrl({ from: '2026-10-28', to: '2026-11-03' }, 'k&y'));
assert.equal(url.pathname, '/resources/v2/title/domains/SALESPLATFORM/titles');
assert.equal(url.searchParams.get('onSaleFrom'), '10/28/2026');
assert.equal(url.searchParams.get('onSaleTo'), '11/03/2026');
assert.equal(url.searchParams.get('rows'), '0');
assert.equal(url.searchParams.get('suppressLinks'), 'true');
assert.equal(url.searchParams.get('api_key'), 'k&y');

// Fetching: each code once across weeks, an empty week is fine, any other error stops the run
const reply = (titles) => ({ status: 200, body: { data: { titles } } });
const pages = [reply([{ isbnStr: '1', title: 'A' }, { isbnStr: '2', title: 'B' }]), { status: 404, body: null }, reply([{ isbnStr: '2', title: 'B moved' }])];
const got = await fetchRecords(weekRanges('2026-10-28', 3), 'k', async () => pages.shift());
assert.deepEqual(got.map((t) => t.title), ['A', 'B moved']);
await assert.rejects(fetchRecords(weekRanges('2026-10-28', 1), 'k', async () => ({ status: 403, body: null })), /PRH answered 403 for 2026-10-28–2026-11-03/);

// Titles PRH agrees with are left out (no needless change for every shop to copy)
const item = { title: 'ARCHIE', issue_number: '2', variant: 'CVR A STUART IMMONEN', publisher: 'Oni Press', price: 4.99, release_date: '2026-10-28', upc: '64985600908102011' };
const row = { cover_url: 'https://images.pullwise.shop/c.jpg', title: 'ARCHIE', issue_number: '2', variant: 'CVR A STUART IMMONEN', publisher: 'Oni Press', retail_price: '4.99', release_date: '2026-10-28', foc_date: '2026-09-14', upc: '64985600908102011', isbn: null, creators: 'Ben H. Winters', mature: false };
assert.equal(unchanged(item, row), true, 'fields PRH leaves out (FOC, creators) and a price stored as text still match');
assert.equal(unchanged({ ...item, release_date: '2026-11-04' }, row), false, 'a slipped date');
assert.equal(unchanged({ ...item, price: 5.99 }, row), false, 'a price change');
assert.equal(unchanged(item, { ...row, cover_url: null }), false, 'still needs its cover');
assert.equal(unchanged(item, undefined), false, 'a new title');

// Recent Runs line
assert.equal(summary({ added: 40, updated: 30, unchanged: 1200, skipped: 52, duplicates: 0, covers: 38, coversMissing: 2 }),
  'PRH, next 13 weeks: 40 added, 30 refreshed, 1200 unchanged, 52 skipped, 38 covers, 2 without a cover yet');

console.log('prh auto-import tests passed');
