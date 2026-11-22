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

const SOURCE_NAME = { prh: 'PRH', lunar: 'Lunar' };
const EMAIL_ROWS = 900; // titles listed in the email itself; the CSV has them all
const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const csvCell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // never run as a spreadsheet formula
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * The email a daily import sends after each run (tools/catalog-job.mjs emailLeftOut): how many titles it left out for
 * each reason, then every one grouped by reason and sorted by title, and the whole list as a CSV attachment.
 * @param source   'prh' | 'lunar'
 * @param date     the catalog's today, YYYY-MM-DD
 * @param summary  the run's Recent Runs line
 * @param rows     [{ sku, title, reason, detail }] (leftOutRows)
 * @returns { subject, html, text, csv, filename }
 */
export function leftOutEmail({ source, date, summary, rows }) {
  const name = SOURCE_NAME[source] ?? source;
  const day = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  const groups = reasonChoices(rows).map(({ reason, n }) => ({
    reason, n, rows: rows.filter((r) => r.reason === reason).sort((a, b) => collator.compare(a.title, b.title) || collator.compare(a.sku, b.sku)),
  }));
  const count = rows.length ? `${rows.length.toLocaleString()} ${rows.length === 1 ? 'title' : 'titles'}` : 'nothing';
  const subject = `Left out of the catalog: ${name}, ${count} (${day})`;
  const intro = `The ${name} daily import left these titles out of the master catalog. They're also on the catalog's Import → Left Out tab.`;
  const line = (r) => [r.title, r.sku, r.detail].filter(Boolean).join(' — ');

  const text = [
    `${name} import, ${day}: ${summary}`,
    '',
    rows.length ? intro : 'Nothing was left out of the catalog this run.',
    ...groups.flatMap((g) => ['', `${g.reason} (${g.n.toLocaleString()})`, ...g.rows.map((r) => `  ${line(r)}`)]),
  ].join('\n');

  // Gmail clips a message whose HTML passes about 102 KB, so rows carry no styles of their own (each table sets them
  // once) and a very long run lists its first EMAIL_ROWS titles here: the CSV attached always has every one.
  const font = 'font:14px/1.45 Arial,sans-serif;color:#222';
  let room = EMAIL_ROWS;
  const listed = groups.map((g) => {
    const shown = g.rows.slice(0, Math.max(0, room));
    room -= shown.length;
    return { ...g, shown };
  });
  const cut = rows.length - listed.reduce((n, g) => n + g.shown.length, 0);
  const html = `<div style="${font}">
<p style="margin:0 0 8px"><b>${escHtml(name)} import, ${escHtml(day)}</b><br>${escHtml(summary)}</p>
${rows.length ? `<p style="margin:0 0 12px">${escHtml(intro)} The attached CSV has the whole list.</p>
<table cellpadding="3" cellspacing="0" style="${font};margin:0 0 16px">${groups.map((g) => `<tr><td>${escHtml(g.reason)}</td><td align="right">${g.n.toLocaleString()}</td></tr>`).join('')}</table>
${listed.filter((g) => g.shown.length).map((g) => `<h3 style="font:bold 15px Arial,sans-serif;margin:18px 0 6px">${escHtml(g.reason)} (${g.n.toLocaleString()})</h3>
<table cellpadding="3" cellspacing="0" style="${font}">${g.shown.map((r) => `<tr><td>${escHtml(r.title)}</td><td>${escHtml(r.sku)}</td>${r.detail ? `<td>${escHtml(r.detail)}</td>` : ''}</tr>`).join('')}</table>${g.shown.length < g.n ? `<p style="margin:4px 0 0">…and ${(g.n - g.shown.length).toLocaleString()} more in the CSV.</p>` : ''}`).join('\n')}
${cut > 0 ? `<p style="margin:16px 0 0">${cut.toLocaleString()} more ${cut === 1 ? 'title is' : 'titles are'} in the attached CSV.</p>` : ''}` : '<p style="margin:0">Nothing was left out of the catalog this run.</p>'}
</div>`;

  const csv = [['Title', 'Why', 'Detail', 'Code'].join(','), ...groups.flatMap((g) => g.rows.map((r) => [csvCell(r.title), csvCell(r.reason), csvCell(r.detail), `="${String(r.sku).replace(/"/g, '""')}"`].join(',')))].join('\r\n');
  return { subject, html, text, csv, filename: `left-out-${source}-${date}.csv` };
}
