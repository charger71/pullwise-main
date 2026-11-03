// node js/import/prh-api.test.js
import assert from 'node:assert/strict';
import { prhApiItem } from './distributors.js';

// A Marvel comic, as SALESPLATFORM sends it
const comic = prhApiItem({
  isbnStr: '75960621436500421', title: 'SPIDER-MAN/HULK: FIRE AND BRIMSTONE #4 ROGE ANTONIO VARIANT', subtitle: null,
  author: 'Kevin Smith', onsale: '2026-11-25', focDate: '2026-10-19', format: { code: 'CB', description: 'Comic Book' },
  imprint: { code: 'Y6', description: 'Marvel Universe' },
  price: [{ amount: 6.25, currencyCode: 'CAD' }, { amount: 4.99, currencyCode: 'USD' }],
}, null);
assert.equal(comic.title, 'SPIDER-MAN/HULK: FIRE AND BRIMSTONE');
assert.equal(comic.issue_number, '4');
assert.equal(comic.variant, 'ROGE ANTONIO VARIANT');
assert.equal(comic.category, 'comics');
assert.equal(comic.price, 4.99);
assert.equal(comic.foc_date, '2026-10-19');
assert.equal(comic.release_date, '2026-11-25');
assert.equal(comic.upc, '75960621436500421');
assert.equal(comic.creators, 'Kevin Smith');
assert.equal('isbn' in comic, false, 'fields PRH has nothing for are left out');
assert.equal('description' in comic, false);

// A hardcover, as PRH.US sends it, with its flap copy
const book = prhApiItem({
  isbn: 9780593135204, isbnStr: '9780593135204', title: 'Project Hail Mary', subtitle: 'A Novel', author: 'Andy Weir',
  onsale: '2021-05-04', focDate: null, format: { code: 'HC' }, imprint: { description: 'Ballantine Books' },
  price: [{ amount: 32, currencyCode: 'USD' }],
}, { flapcopy: '<b>#1 BESTSELLER</b><br><br>Ryland Grace&rsquo;s mission.', keynote: 'Short' });
assert.equal(book.title, 'Project Hail Mary: A Novel (Hardcover)', 'same binding rule as the PRH sheet');
assert.equal(book.isbn, '9780593135204');
assert.equal(book.category, 'trades');
assert.equal(book.description, '#1 BESTSELLER\n\nRyland Grace’s mission.');
assert.equal('foc_date' in book, false);
assert.equal(prhApiItem({ title: 'X', price: [] }, { flapcopy: null, keynote: '<p>Pitch</p>' }).description, 'Pitch');

console.log('prh api tests passed');
