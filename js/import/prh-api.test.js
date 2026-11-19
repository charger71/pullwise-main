// node js/import/prh-api.test.js
import assert from 'node:assert/strict';
import { prhApiItem, parsePrhApi } from './distributors.js';

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

// Comics without an issue number still split off their cover, however the publisher writes it, so each cover is a
// variant of one title rather than a title of its own
const noIssue = (title) => { const i = prhApiItem({ title, format: { code: 'CB' } }, null); return [i.title, i.variant ?? null]; };
assert.deepEqual(noIssue('Hello Kitty: Cinnamoroll Cover A (Collar)'), ['Hello Kitty: Cinnamoroll', 'Cover A (Collar)']);
assert.deepEqual(noIssue('Hello Kitty: Cinnamoroll Variant B (Aning)'), ['Hello Kitty: Cinnamoroll', 'Variant B (Aning)']);
assert.deepEqual(noIssue('Valiant Beyond: All-New Harbinger Finale--The Wedding Variant B (Griffin Full Art Arcade Variant)'), ['Valiant Beyond: All-New Harbinger Finale--The Wedding', 'Variant B (Griffin Full Art Arcade Variant)']);
assert.deepEqual(noIssue('Love Ignited 2027 Cover B Nicoletta Baldari'), ['Love Ignited 2027', 'Cover B Nicoletta Baldari']);
assert.deepEqual(noIssue('Usagi Yojimbo Winter one-shot (CVR B) (Jared Cullum)'), ['Usagi Yojimbo Winter one-shot', '(CVR B) (Jared Cullum)']);
assert.deepEqual(noIssue('JOKER ONE SHOT CVR A'), ['JOKER ONE SHOT', 'CVR A'], 'Lunar’s way, as before');
assert.deepEqual(noIssue('Undercover Avengers Variant Edition'), ['Undercover Avengers Variant Edition', null], 'a word, not a cover letter');
assert.deepEqual(noIssue('Cover Me Softly'), ['Cover Me Softly', null]);

// The daily import's list: comics and graphic novels only, ratio covers (marked by PRH or in the title) skipped,
// each code once, then the catalog's Always Skip list
const rec = (code, title, extra = {}) => ({ isbnStr: code, title, graphicCategory: 'Comics', format: { code: 'CB' }, imprint: { description: 'Oni Press' }, price: [{ amount: 4.99, currencyCode: 'USD' }], onsale: '2026-10-28', ...extra });
const week = parsePrhApi([
  rec('64985600908102011', 'ARCHIE #2 CVR A STUART IMMONEN'),
  rec('64985600908102021', 'ARCHIE #2 CVR B FABIO MOON VAR', { coverVariantDesc: 'Variant' }),
  rec('64985600908102041', 'ARCHIE #2 CVR D INC 1:10 DAVID LOPEZ VAR', { coverVariantDesc: 'Incentive Variant' }),
  rec('75960621000000001', 'STAR WARS: THE BOOK OF BOBA FETT #4 RAHZZAH VARIANT', { coverVariantDesc: 'Incentive Variant', imprint: { description: 'Marvel Universe' } }),
  rec('9781496750000', 'A Classic Case of Murder', { graphicCategory: null, format: { code: 'HC' } }),
  rec('64985600908102011', 'ARCHIE #2 CVR A STUART IMMONEN'),
  rec('76156801628400211', 'Six of Us #2 (CVR A) (Gabriel Hernández Walta)', { imprint: { description: 'Dark Horse Comics' } }),
], { exclusions: [{ kind: 'publisher', value: 'Dark Horse Comics' }] });
assert.equal(week.distributor, 'prh');
assert.deepEqual(week.items.map((i) => i.sku), ['64985600908102011', '64985600908102021']);
assert.equal(week.items[0].title, 'ARCHIE');
assert.equal(week.items[0].issue_number, '2');
assert.equal(week.items[0].cover.url, 'https://images.penguinrandomhouse.com/cover/64985600908102011');
assert.deepEqual(week.skipped.map((s) => s.reason), ['Incentive / ratio variant', 'Incentive / ratio variant', 'Listed twice in this sheet', 'Excluded publisher: Dark Horse']);
assert.equal(week.items.some((i) => i.title.includes('Murder')), false, 'prose PRH also distributes is left out');

console.log('prh api tests passed');
