// What the master catalog's daily imports left out, and why, for Import → Left Out (tools/prh-auto-import.mjs and
// tools/lunar-auto-import.mjs save it after each run; admin/sections/import.js shows it).

/** The reasons a title is left out, as staff read them. */
export const REASONS = {
  ratio: 'Ratio / incentive cover',
  exclusive: 'Store or convention exclusive',
  bundle: 'Retailer bundle',
  alwaysSkip: 'Always Skip list',
  duplicate: 'Already in from another distributor',
};

// The parsers' skip reasons (js/import/distributors.js: skipReason, applyExclusions) → the group they belong to.
// An Always Skip rule keeps its own wording as the detail ("Excluded publisher: Dark Horse").
const GROUPS = [
  [/^Incentive \/ ratio variant$/, REASONS.ratio],
  [/^Store \/ convention exclusive$/, REASONS.exclusive],
  [/^Retailer bundle$/, REASONS.bundle],
  [/^(Excluded (publisher|series): |Title contains |Mature title \(excluded\))/, REASONS.alwaysSkip, true],
];
// A title listed twice in one sheet still comes in once: it isn't left out.
const NOT_LEFT_OUT = /^Listed twice in this sheet$/;

/**
 * The left-out list for one import run: its skipped titles and the ones left out because their UPC or ISBN is already
 * on another title. Each SKU once, the first reason winning (a Lunar title is on its FOC sheet and its release sheet).
 * @param parsed      { skipped: [{ sku, title, reason }] } (parseSheet / parsePrhApi; Lunar: every sheet's, in order)
 * @param duplicates  [{ sku, title, on, code }] (applyImport's duplicateTitles)
 * @returns [{ sku, title, reason, detail }]
 */
export function leftOutRows(parsed, duplicates = []) {
  const rows = new Map();
  const add = (row) => row.sku && !rows.has(row.sku) && rows.set(row.sku, row);
  for (const s of parsed.skipped ?? []) {
    if (NOT_LEFT_OUT.test(s.reason)) continue;
    const group = GROUPS.find(([re]) => re.test(s.reason));
    add({ sku: s.sku, title: s.title, reason: group ? group[1] : s.reason, detail: group?.[2] ? s.reason : null });
  }
  for (const d of duplicates) add({ sku: d.sku, title: d.title, reason: REASONS.duplicate, detail: `${d.code} is on “${d.on}”` });
  return [...rows.values()];
}

/** Rows matching the filters: every word of `q` in the title, code or detail; one distributor; one reason. */
export function filterLeftOut(rows, { q = '', source = '', reason = '' } = {}) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((r) => {
    if (source && r.source !== source) return false;
    if (reason && r.reason !== reason) return false;
    const text = `${r.title} ${r.sku} ${r.detail ?? ''}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

/** The Why choices: every reason with its count, the usual ones first, then any others. */
export function reasonChoices(rows) {
  const counts = new Map();
  for (const r of rows) counts.set(r.reason, (counts.get(r.reason) ?? 0) + 1);
  const order = Object.values(REASONS);
  return [...counts].sort(([a], [b]) => ((order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99)) || a.localeCompare(b)).map(([reason, n]) => ({ reason, n }));
}
