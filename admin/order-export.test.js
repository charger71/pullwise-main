// Run: node admin/order-export.test.js
import assert from 'node:assert/strict';
import { lunarCode, prhCode, lunarFile, prhExport, prhText, batches, prhXlsxFiles, toCsv, generalGroups, orderState, changeText, PRH_BATCH } from './order-export.js';
import { ZipBuilder, readZip } from './zip.js';

let id = 0;
const row = (more = {}) => ({
  item_id: ++id, title: 'Batman', issue_number: String(id), variant: null, publisher: 'DC', category: 'comics',
  price: 4.99, release_date: '2026-12-09', foc_date: '2026-11-16', distributor: 'lunar',
  sku: `1026DC${String(id).padStart(3, '0')}`, upc: `76194134182900${String(id).padStart(3, '0')}`, isbn: null,
  customer_copies: 0, shop_copies: 0, total: 0, submitted: null, ...more,
});

// Codes: Lunar uses the SKU; PRH the UPC for comics and the ISBN for books, each falling back to the other.
{
  assert.equal(lunarCode({ sku: ' 1026DC001 ' }), '1026DC001');
  assert.equal(lunarCode({ sku: null }), '');
  const book = { category: 'trades', upc: '9781779501127', isbn: '978-1-77950-112-7' };
  assert.equal(prhCode(book), '9781779501127');
  assert.equal(prhCode({ category: 'comics', upc: '761941341829 00111', isbn: '9781779501127' }), '76194134182900111');
  assert.equal(prhCode({ category: 'comics', upc: null, isbn: '9781779501127' }), '9781779501127', 'a comic with no UPC falls back to its ISBN');
  assert.equal(prhCode({ category: 'trades', upc: '761941341829', isbn: null }), '761941341829', 'a book with no ISBN falls back to its UPC');
  assert.equal(prhCode({ category: 'trades', isbn: '080442957x' }), '080442957X', 'a 10-digit ISBN ending in X');
  assert.equal(prhCode({ category: 'comics', upc: 'N/A', isbn: '' }), '', 'junk is not a code');
  assert.equal(prhCode({ category: 'comics', upc: '12345', isbn: null }), '', 'too short');
}

// Lunar file: full totals, 0 kept for titles sent before, titles never sent at 0 left out, missing SKUs listed.
{
  const rows = [
    row({ title: 'Absolute Batman', customer_copies: 3, shop_copies: 2, total: 5 }),
    row({ title: 'Wonder Woman', total: 0, submitted: 4 }), // sent before, now 0: goes in with 0
    row({ title: 'Superman', total: 0 }), // never sent, nothing to order: left out
    row({ title: 'Flash, The', total: 2, submitted: 2, variant: 'Cover B "Foil"' }),
    row({ title: 'Green Lantern', total: 6, sku: '' }), // no SKU: listed, left out
    row({ title: 'Aquaman', total: 0, submitted: 1, sku: null }), // sent before with no SKU now: still listed
  ];
  const f = lunarFile(rows, { foc: '2026-11-16' });
  assert.equal(f.filename, 'lunar-foc-edits-2026-11-16.csv');
  assert.deepEqual(f.header, ['Product Code', 'Quantity', 'Title', 'FOC', 'Publisher']);
  assert.deepEqual(f.lines.map((l) => [l[1], l[2]]), [[5, `Absolute Batman #${rows[0].issue_number}`], [0, `Wonder Woman #${rows[1].issue_number}`], [2, `Flash, The #${rows[3].issue_number} · Cover B "Foil"`]]);
  assert.equal(f.lines[0][0], rows[0].sku, 'the first column is the product code');
  assert.equal(f.titles, 3);
  assert.equal(f.copies, 7);
  assert.equal(f.zeros, 1);
  assert.deepEqual(f.missing.map((r) => r.title), ['Green Lantern', 'Aquaman']);
  // CSV text: quoted where needed, CRLF, no BOM.
  const csvLines = f.csv.split('\r\n');
  assert.equal(csvLines[0], 'Product Code,Quantity,Title,FOC,Publisher');
  assert.equal(csvLines[3], `${rows[3].sku},2,"Flash, The #${rows[3].issue_number} · Cover B ""Foil""",2026-11-16,DC`);
  assert.equal(csvLines.at(-1), '', 'ends with a line break');
  assert.notEqual(f.csv.charCodeAt(0), 0xfeff);
  assert.equal(lunarFile([], { foc: null }).filename, 'lunar-foc-edits-no-cutoff.csv');
  assert.equal(lunarFile([], { foc: '2026-11-16' }).titles, 0, 'nothing to export');
}

// PRH, first submission: full totals for titles with copies, no header, missing codes listed.
{
  const rows = [
    row({ distributor: 'prh', title: 'Spider-Man', total: 4 }),
    row({ distributor: 'prh', title: 'X-Men', total: 0 }),
    row({ distributor: 'prh', title: 'Saga Vol 1', category: 'trades', upc: null, isbn: '9781607066019', total: 2 }),
    row({ distributor: 'prh', title: 'Hulk', upc: null, isbn: null, total: 3 }),
  ];
  const p = prhExport(rows);
  assert.equal(p.mode, 'full');
  assert.deepEqual(p.lines.map((l) => [l.code, l.quantity]), [[rows[0].upc, 4], ['9781607066019', 2]]);
  assert.equal(p.titles, 2);
  assert.equal(p.copies, 6);
  assert.deepEqual(p.decreases, []);
  assert.deepEqual(p.missing.map((r) => r.title), ['Hulk']);
  assert.equal(prhText(p.lines), `${rows[0].upc},4\n9781607066019,2`);
}

// PRH after a submission: increases only (what wasn't sent yet), decreases listed for the cart, unchanged left out.
{
  const rows = [
    row({ distributor: 'prh', title: 'Up', total: 7, submitted: 4 }), // +3
    row({ distributor: 'prh', title: 'Same', total: 4, submitted: 4 }), // nothing
    row({ distributor: 'prh', title: 'Down', total: 1, submitted: 3 }), // lower by hand
    row({ distributor: 'prh', title: 'Gone', total: 0, submitted: 2 }), // lower to 0 by hand
    row({ distributor: 'prh', title: 'New', total: 5 }), // added after the first submission: all 5
    row({ distributor: 'prh', title: 'Down no code', upc: null, total: 0, submitted: 1 }),
  ];
  const p = prhExport(rows);
  assert.equal(p.mode, 'changes');
  assert.deepEqual(p.lines.map((l) => [l.row.title, l.quantity]), [['Up', 3], ['New', 5]]);
  assert.equal(p.copies, 8);
  assert.deepEqual(p.decreases.map((d) => [d.row.title, d.submitted, d.now]), [['Down', 3, 1], ['Gone', 2, 0], ['Down no code', 1, 0]]);
  assert.equal(p.decreases[2].code, '');
  assert.deepEqual(p.missing.map((r) => r.title), ['Down no code']);
  // Nothing new: nothing to paste.
  const none = prhExport([row({ distributor: 'prh', total: 2, submitted: 2 })]);
  assert.equal(none.titles, 0);
  assert.deepEqual(none.batches, []);
}

// Batches of 500: numbered, 1-based ranges, the last one short.
{
  assert.equal(PRH_BATCH, 500);
  const list = Array.from({ length: 1203 }, (_, i) => i);
  const b = batches(list);
  assert.deepEqual(b.map((x) => [x.n, x.from, x.to, x.items.length]), [[1, 1, 500, 500], [2, 501, 1000, 500], [3, 1001, 1203, 203]]);
  assert.deepEqual(batches(Array.from({ length: 500 }, (_, i) => i)).map((x) => x.items.length), [500], 'exactly 500 is one batch');
  assert.deepEqual(batches([]), []);
  const rows = Array.from({ length: 501 }, () => row({ distributor: 'prh', total: 1 }));
  assert.deepEqual(prhExport(rows).batches.map((x) => x.items.length), [500, 1]);
  assert.deepEqual(prhExport(rows, { size: 200 }).batches.map((x) => x.items.length), [200, 200, 101]);
}

// The .xlsx: two columns, the code kept as text, packed by the zip writer and readable back.
{
  const lines = [{ code: '0761941341829', quantity: 3 }, { code: 'A<&>', quantity: 1 }];
  const files = prhXlsxFiles(lines);
  assert.deepEqual(files.map(([p]) => p), ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/worksheets/sheet1.xml']);
  const sheet = files.at(-1)[1];
  assert.match(sheet, /<c r="A1" t="inlineStr"><is><t>0761941341829<\/t><\/is><\/c><c r="B1"><v>3<\/v><\/c>/);
  assert.match(sheet, /<t>A&lt;&amp;&gt;<\/t>/, 'text is escaped');
  const zip = new ZipBuilder();
  for (const [path, text] of files) zip.add(path, new TextEncoder().encode(text));
  const entries = await readZip(zip.finish());
  assert.deepEqual(entries.map((e) => e.name), files.map(([p]) => p));
  assert.equal(new TextDecoder().decode(await entries.at(-1).read()), sheet);
}

// CSV quoting.
assert.equal(toCsv(['a', 'b'], [['x,y', 'he said "hi"'], [null, 3]]), 'a,b\r\n"x,y","he said ""hi"""\r\n,3\r\n');

// The general list: titles with copies only, grouped Lunar, PRH, Other, unassigned, A to Z, with store copies.
{
  const names = { lunar: 'Lunar', prh: 'PRH', other: 'Other', '': 'Unassigned' };
  const g = generalGroups([
    row({ distributor: null, title: 'Zed', total: 1, customer_copies: 1 }),
    row({ distributor: 'prh', title: 'Bee', total: 2, shop_copies: 2 }),
    row({ distributor: 'lunar', title: 'Cat', total: 3, customer_copies: 1, shop_copies: 2 }),
    row({ distributor: 'lunar', title: 'Ant', total: 1, customer_copies: 1 }),
    row({ distributor: 'lunar', title: 'Nil', total: 0 }),
  ], names);
  assert.deepEqual(g.map((x) => x.name), ['Lunar', 'PRH', 'Unassigned']);
  assert.deepEqual(g[0].rows.map((r) => [r.baseTitle, r.customers, r.store, r.copies]), [['Ant', 1, 0, 1], ['Cat', 1, 2, 3]]);
}

// Where a title stands: to order, changed since sent, ordered, or nothing.
{
  const base = { customer_open: 0, shop_status: null, shop_saved: true, shop_copies: 0, total: 0, submitted: null };
  const st = (more) => orderState({ ...base, ...more });
  assert.equal(st({}), 'none');
  assert.equal(st({ customer_open: 2, total: 2 }), 'to_order', 'open customer lines');
  assert.equal(st({ shop_status: 'open', shop_copies: 3, total: 3 }), 'to_order', "the store's open row");
  assert.equal(st({ shop_saved: false, shop_copies: 2, total: 2 }), 'to_order', "last issue's number, not written yet");
  assert.equal(st({ shop_status: 'ordered', shop_copies: 2, total: 2 }), 'ordered', 'marked ordered before snapshots');
  assert.equal(st({ shop_status: 'ordered', shop_copies: 2, total: 2, submitted: 2 }), 'ordered');
  assert.equal(st({ shop_status: 'ordered', shop_copies: 3, total: 3, submitted: 2 }), 'changed', 'store copies raised after ordering');
  assert.equal(st({ total: 1, submitted: 2 }), 'changed', 'a customer cancelled');
  assert.equal(st({ total: 0, submitted: 2 }), 'changed', 'down to nothing: still needs lowering');
  assert.equal(st({ customer_open: 1, total: 3, submitted: 3 }), 'to_order', 'same total, but a new line to mark ordered');
  assert.equal(st({ total: 0, submitted: 0 }), 'none', 'sent as 0 and still 0');
  assert.equal(changeText(2), '+2');
  assert.equal(changeText(-1), '−1');
  assert.equal(changeText(0), '');
  assert.equal(changeText(null), '');
}

console.log('order-export tests passed');
