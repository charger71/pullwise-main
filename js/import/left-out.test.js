// node js/import/left-out.test.js
import assert from 'node:assert/strict';
import { leftOutRows, REASONS, filterLeftOut, reasonChoices, leftOutEmail } from './left-out.js';

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

// The email each daily run sends: counts by reason, every title grouped by reason, and the list as a CSV.
const mail = leftOutEmail({ source: 'prh', date: '2026-11-20', summary: 'PRH, next 13 weeks: 177 added', rows: [
  { sku: '75960621723600316', title: 'SPIDER-WOMAN #3 COVER D 1:25 VARIANT', reason: REASONS.ratio, detail: null },
  { sku: '9781799509882', title: 'Batman Vol. 2 <Blood & Money>', reason: REASONS.duplicate, detail: 'ISBN 9781799509882 is on “BATMAN (2025) HC VOL 02”' },
  { sku: '64985600889300141', title: 'ADVENTURE TIME #1 1:10 VAR', reason: REASONS.ratio, detail: null },
] });
assert.equal(mail.subject, 'Left out of the catalog: PRH, 3 titles (Nov 20)');
assert.match(mail.text, /PRH, next 13 weeks: 177 added/);
assert.match(mail.text, /Ratio \/ incentive cover \(2\)\n  ADVENTURE TIME #1 1:10 VAR — 64985600889300141\n  SPIDER-WOMAN/, 'grouped by reason, usual order, sorted by title, with counts');
assert.ok(mail.text.indexOf(REASONS.ratio) < mail.text.indexOf(REASONS.duplicate));
assert.match(mail.text, /Batman Vol\. 2 <Blood & Money> — 9781799509882 — ISBN 9781799509882 is on/, 'the detail follows the code');
assert.ok(mail.html.includes('Batman Vol. 2 &lt;Blood &amp; Money&gt;') && !mail.html.includes('<Blood'), 'titles are escaped in the HTML');
assert.match(mail.html, /<td>Ratio \/ incentive cover<\/td><td align="right">2<\/td>/, 'a count table at the top');
assert.equal(mail.csv.split('\r\n')[0], 'Title,Why,Detail,Code');
assert.equal(mail.csv.split('\r\n').length, 4);
assert.match(mail.csv, /"Batman Vol\. 2 <Blood & Money>"|Batman Vol\. 2 <Blood & Money>/);
assert.match(mail.csv, /,="9781799509882"/, 'codes stay text in a spreadsheet (no rounded UPCs)');
assert.equal(mail.filename, 'left-out-prh-2026-11-20.csv');
const none = leftOutEmail({ source: 'lunar', date: '2026-11-20', summary: 'Lunar, 13 of 13 sheets', rows: [] });
assert.equal(none.subject, 'Left out of the catalog: Lunar, nothing (Nov 20)');
assert.match(none.text, /Nothing was left out/);

// A big run stays under Gmail's ~102 KB clipping size: the first 900 titles are in the email, the rest only in the CSV.
const many = Array.from({ length: 1500 }, (_, i) => ({ sku: String(75960621000000000 + i), title: `SOME LONG SERIES NAME #${i} CVR D INC 1:25 ARTIST NAME VIRGIN VAR`, reason: i % 2 ? REASONS.ratio : REASONS.bundle, detail: null }));
const big = leftOutEmail({ source: 'lunar', date: '2026-11-20', summary: 'Lunar', rows: many });
assert.ok(big.html.length < 100_000, `HTML is ${big.html.length} bytes`);
assert.match(big.html, /600 more titles are in the attached CSV/);
assert.match(big.html, /…and 600 more in the CSV/, 'the group that was cut says how many more it has');
assert.equal(big.csv.split('\r\n').length, 1501, 'the CSV has every title');
assert.equal(big.text.split('\n').filter((l) => l.startsWith('  ')).length, 1500, 'the plain-text part lists every title');

console.log('left out tests passed');
