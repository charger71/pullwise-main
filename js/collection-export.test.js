import assert from 'node:assert/strict';
import { collectionCsv, locgFile, CSV_HEADER } from './collection-export.js';

const line = (item, quantity = 1) => ({ quantity, item });
const batman14 = { title: 'Absolute Batman', issue_number: '14', publisher: 'DC', release_date: '2026-11-04', price: 4.99, upc: '76194138465601411', isbn: null, variant: null };
const batman14b = { ...batman14, variant: 'Cover B Jock', upc: '76194138465601421' };
const spidey = { title: 'Ultimate Spider-Man', issue_number: '24', publisher: 'Marvel', release_date: '2026-10-28', price: '4.99', upc: '75960620984702411' };

// Spreadsheet: BOM, header, rows sorted by series then date then cover, every value as text (barcodes keep their digits).
const csv = collectionCsv([line(spidey), line(batman14b, 2), line(batman14)]);
assert.ok(csv.startsWith('﻿'));
const rows = csv.slice(1).trimEnd().split('\r\n');
assert.equal(rows[0], CSV_HEADER.join(','));
assert.deepEqual(rows.slice(1), [
  'Absolute Batman,14,,DC,2026-11-04,4.99,76194138465601411,,1',
  'Absolute Batman,14,Cover B Jock,DC,2026-11-04,4.99,76194138465601421,,2',
  'Ultimate Spider-Man,24,,Marvel,2026-10-28,4.99,75960620984702411,,1',
]);

// Quoting and formula injection; issue -1 stays as it is.
const odd = collectionCsv([line({ title: '=cmd', issue_number: '-1', publisher: 'Image, Inc.', variant: 'Cover "A"', price: null })]);
assert.equal(odd.slice(1).trimEnd().split('\r\n')[1], `'=cmd,-1,"Cover ""A""","Image, Inc.",,,,,1`);

// Titles the shop has taken down (no item, or the placeholder with no fields) are left out.
assert.equal(collectionCsv([{ quantity: 1, item: null }]).slice(1).trimEnd().split('\r\n').length, 1);

// League of Comic Geeks: no header, semicolons, one line per title (covers and copies count once).
assert.equal(locgFile([line(spidey), line(batman14b, 2), line(batman14)]), [
  'DC;Absolute Batman;Absolute Batman #14;2026-11-04',
  'Marvel;Ultimate Spider-Man;Ultimate Spider-Man #24;2026-10-28',
].join('\n') + '\n');
assert.equal(locgFile([line({ title: 'Love; Death', issue_number: null, publisher: null, release_date: null })]), ';Love, Death;Love, Death;\n');
assert.equal(locgFile([]), '');

console.log('collection-export tests passed');
