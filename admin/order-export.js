// Distributor order files, built from the rows staff_order_rows returns (one cutoff, one distributor). Pure functions:
// no DOM and no database, so node can test them (admin/order-export.test.js). The screen downloads or copies what
// these return.
//
// - Lunar: a CSV for Lunar's "Upload FOC Edits" page, which OVERWRITES each title's quantity. So the file always holds
//   full current totals, and a title sent earlier that is now 0 goes in with 0 (left out, Lunar would keep the old number).
// - PRH: "code,quantity" lines with no header, pasted into the PRH cart, which ADDS them and takes at most 500 titles
//   at a time. So a title goes in with what hasn't been sent yet (its total less what was submitted), never the full
//   total again, and anything lower than what was sent is listed for staff to change by hand in the cart.
// - Titles with no usable code are listed apart and left out of every file.

/**
 * Where a title stands on Place Order:
 * - 'to_order': copies not marked ordered yet (customer lines still open, the store's open row, or last issue's number
 *   not yet written as the title's own);
 * - 'changed': sent before, and the total no longer matches what was sent (up or down);
 * - 'ordered': everything sent or marked ordered, nothing changed;
 * - 'none': nothing to order and nothing sent.
 * The submitted number belongs to the title, so a title whose cutoff moved after it was sent is judged the same way
 * under its new cutoff.
 */
export function orderState(r) {
  const open = r.customer_open > 0 || r.shop_status === 'open' || (!r.shop_saved && r.shop_copies > 0);
  if (r.submitted == null) return r.total > 0 ? (open ? 'to_order' : 'ordered') : 'none';
  if (r.total !== r.submitted) return 'changed';
  if (open) return 'to_order';
  return r.total > 0 ? 'ordered' : 'none';
}

/** "+2", "−1" (a real minus sign) or "" for no change. */
export const changeText = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '');

/** PRH's cart takes at most this many titles per paste. */
export const PRH_BATCH = 500;

const digits = (s) => String(s ?? '').replace(/[\s-]/g, '');

/** Lunar's product code: the item's SKU, as Lunar's catalog gives it ('' when the title has none). */
export const lunarCode = (row) => String(row.sku ?? '').trim();

/**
 * PRH's code: the UPC for comics and the ISBN for books (trades, omnibuses and the rest), each falling back to the
 * other when it's missing. Spaces and dashes are dropped; anything else that isn't a digit (or an ISBN's final X)
 * means the code isn't usable.
 */
export function prhCode(row) {
  const upc = digits(row.upc);
  const isbn = digits(row.isbn).toUpperCase();
  const okUpc = /^\d{12,17}$/.test(upc) ? upc : '';
  const okIsbn = /^(\d{13}|\d{9}[\dX])$/.test(isbn) ? isbn : '';
  return (row.category === 'comics' ? okUpc || okIsbn : okIsbn || okUpc) || '';
}

/** How a row is named in lists: "Title #1 · Variant". */
export const rowName = (r) => [r.title, r.issue_number && `#${r.issue_number}`].filter(Boolean).join(' ') + (r.variant ? ` · ${r.variant}` : '');

/** Titles that would go in a file but have no usable code. */
const missingOf = (rows, codeOf) => rows.filter((r) => !codeOf(r));

/** CSV text: cells quoted when they hold a comma, quote or line break; lines end in CRLF. */
export function toCsv(header, lines) {
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...lines].map((l) => l.map(cell).join(',')).join('\r\n') + '\r\n';
}

/**
 * The Lunar "Upload FOC Edits" file for one cutoff.
 * rows: order rows for the cutoff (Lunar titles). A title goes in when it has copies (total > 0) or was sent before
 * (submitted is not null), with its full total, 0 included. Titles with no SKU are left out and listed in missing.
 * @returns {{ filename: string, header: string[], lines: Array<Array<string|number>>, csv: string, titles: number,
 *   copies: number, zeros: number, missing: object[] }}
 */
export function lunarFile(rows, { foc }) {
  const wanted = rows.filter((r) => r.total > 0 || r.submitted != null);
  const ready = wanted.filter((r) => lunarCode(r));
  const header = ['Product Code', 'Quantity', 'Title', 'FOC', 'Publisher'];
  const lines = ready.map((r) => [lunarCode(r), r.total, rowName(r), r.foc_date ?? '', r.publisher ?? '']);
  return {
    filename: `lunar-foc-edits-${foc ?? 'no-cutoff'}.csv`,
    header,
    lines,
    csv: toCsv(header, lines),
    titles: lines.length,
    copies: ready.reduce((n, r) => n + r.total, 0),
    zeros: ready.filter((r) => r.total === 0).length,
    missing: missingOf(wanted, lunarCode),
  };
}

/** Splits a list into numbered batches of at most `size`: [{ n, from, to, items }], n and from/to counting from 1. */
export function batches(list, size = PRH_BATCH) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push({ n: out.length + 1, from: i + 1, to: Math.min(i + size, list.length), items: list.slice(i, i + size) });
  return out;
}

/**
 * The PRH paste for one cutoff.
 * Each title goes in with what hasn't been sent yet: its total less what was submitted (0 when never sent). Before
 * anything was sent that is the full total ('full'); after, only increases ('changes'). Titles now below what was sent
 * are listed in decreases, for staff to lower by hand in the PRH cart (a paste can only add). Titles with no usable
 * code are left out and listed in missing.
 * @returns {{ mode: 'full'|'changes', lines: Array<{ code: string, quantity: number, row: object }>, batches: Array,
 *   titles: number, copies: number, decreases: Array<{ row: object, code: string, submitted: number, now: number }>,
 *   missing: object[] }}
 */
export function prhExport(rows, { size = PRH_BATCH } = {}) {
  const mode = rows.some((r) => r.submitted != null) ? 'changes' : 'full';
  const adds = rows.filter((r) => r.total - (r.submitted ?? 0) > 0);
  const lower = rows.filter((r) => r.submitted != null && r.total < r.submitted);
  const lines = adds.filter((r) => prhCode(r)).map((r) => ({ code: prhCode(r), quantity: r.total - (r.submitted ?? 0), row: r }));
  return {
    mode,
    lines,
    batches: batches(lines, size),
    titles: lines.length,
    copies: lines.reduce((n, l) => n + l.quantity, 0),
    decreases: lower.map((r) => ({ row: r, code: prhCode(r), submitted: r.submitted, now: r.total })),
    missing: missingOf([...adds, ...lower], prhCode),
  };
}

/** The text to paste: one "code,quantity" line per title, no header. */
export const prhText = (lines) => lines.map((l) => `${l.code},${l.quantity}`).join('\n');

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * A minimal .xlsx workbook (one sheet, two columns: code as text so leading zeros and long UPCs survive, quantity
 * as a number, no header), as [path, text] files for a zip. admin/zip.js packs them.
 */
export function prhXlsxFiles(lines, { sheet = 'PRH order' } = {}) {
  const rowsXml = lines
    .map((l, i) => `<row r="${i + 1}"><c r="A${i + 1}" t="inlineStr"><is><t>${xml(l.code)}</t></is></c><c r="B${i + 1}"><v>${Number(l.quantity)}</v></c></row>`)
    .join('');
  return [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(sheet.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>`],
  ];
}

/**
 * The general order list (every distributor, CSV and PDF), grouped by distributor: Lunar, PRH, Other, then titles
 * with none; A to Z within each. Each row keeps customer copies, store copies and the total (copies to order).
 * names: distributor key → display name.
 */
export function generalGroups(rows, names) {
  const rank = (k) => ({ lunar: 0, prh: 1, other: 2 })[k] ?? 3;
  const by = new Map();
  for (const r of rows) {
    if (!(r.total > 0)) continue;
    const key = r.distributor ?? '';
    by.set(key, [...(by.get(key) ?? []), r]);
  }
  return [...by]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([key, list]) => ({
      key,
      name: names[key] ?? names[''] ?? key,
      rows: list
        .map((r) => ({
          code: r.sku || r.isbn || r.upc || '',
          upc: r.upc || r.isbn || '',
          title: [r.title, r.issue_number && `#${r.issue_number}`].filter(Boolean).join(' '),
          baseTitle: r.title,
          issue: r.issue_number,
          variant: r.variant ?? '',
          publisher: r.publisher ?? '',
          price: r.price,
          release: r.release_date,
          foc: r.foc_date,
          customers: r.customer_copies,
          store: r.shop_copies,
          copies: r.total,
        }))
        .sort((a, b) => a.title.localeCompare(b.title) || a.variant.localeCompare(b.variant)),
    }));
}
