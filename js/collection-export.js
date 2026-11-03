/**
 * My Pull List → Export my comics: the books a customer has picked up, as a file their comic collection app can
 * import. Two layouts:
 * - a spreadsheet (CSV) with a header row, for CLZ Comics, ComicBase, Key Collector, iCollect and Excel. Those apps
 *   let the customer match each column to a field; the barcode (UPC) is what they match a book to their database by.
 * - League of Comic Geeks' Bulk Import file: no header, semicolons, one line per title: publisher; series;
 *   "series #issue"; release date (the layout third-party tools use to feed it; LoCG doesn't publish one).
 */

export const CSV_HEADER = ['Series', 'Issue', 'Variant', 'Publisher', 'Release Date', 'Cover Price', 'Barcode', 'ISBN', 'Quantity'];

// Spreadsheet formula injection: a cell starting with = + @ (or a tab or return) gets a leading apostrophe, as in the
// staff exports (admin/lib.js downloadCsv). A minus only when no digit follows, so issue -1 stays a number.
const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+@\t\r]|^-(?!\d)/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One row per picked-up line (`{ quantity, item }`), sorted by series then release date. */
export function collectionCsv(lines) {
  const rows = sorted(lines).map(({ quantity, item: i }) => [i.title, i.issue_number, i.variant, i.publisher, i.release_date, i.price == null ? '' : Number(i.price).toFixed(2), i.upc, i.isbn, quantity ?? 1]);
  // A byte-order mark so Excel reads it as UTF-8; Windows line ends, as CSV expects.
  return '﻿' + [CSV_HEADER, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** League of Comic Geeks: one line per title (it counts a title once, however many copies or covers). */
export function locgFile(lines) {
  // The layout has no quoting, so a semicolon or line break inside a field becomes a comma or a space.
  const field = (v) => String(v ?? '').replace(/;/g, ',').replace(/[\r\n]+/g, ' ').trim();
  const seen = new Set();
  const out = [];
  for (const { item: i } of sorted(lines)) {
    const name = i.issue_number ? `${i.title} #${i.issue_number}` : i.title;
    const line = [i.publisher, i.title, name, i.release_date].map(field).join(';');
    if (seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out.join('\n') + (out.length ? '\n' : '');
}

const sorted = (lines) =>
  lines
    .filter((l) => l.item?.title)
    .slice()
    .sort((a, b) => a.item.title.localeCompare(b.item.title) || (a.item.release_date ?? '').localeCompare(b.item.release_date ?? '') || (a.item.variant ?? '').localeCompare(b.item.variant ?? ''));

/**
 * Hand the file to the customer. In the installed app a download link can go nowhere (an iPhone Home Screen app has
 * no Downloads), so it opens the share sheet when the device can share files; otherwise it downloads.
 */
export async function saveFile(name, text, type, { share = false } = {}) {
  const file = new File([text], name, { type });
  if (share && navigator.canShare?.({ files: [file] })) {
    try {
      return await navigator.share({ files: [file], title: name });
    } catch (err) {
      if (err?.name === 'AbortError') return; // closed the share sheet
    }
  }
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
