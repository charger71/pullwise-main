// Parsing rules for distributor order sheets: Lunar and Penguin Random House
// (FOC and release sheets) and Funko retailer pre-order lists.
// Used by the admin Import page.
//
// Pure functions over plain row arrays — no I/O. Reading the .xlsx itself is
// done by readWorkbook(), which takes SheetJS and JSZip as parameters so the
// same code works in Node and the browser.

// ---------------------------------------------------------------------------
// Workbook reading
// ---------------------------------------------------------------------------

/**
 * @param {ArrayBuffer|Uint8Array} data  .xlsx file contents
 * @param {{ XLSX: any, JSZip: any }} libs
 * @returns {Promise<{ rows: any[][], images: Map<string, () => Promise<Uint8Array>>, imagesByRow: Map<number, () => Promise<Uint8Array>> }>}
 *   rows: first sheet as arrays of cell text, each with its 0-based sheet `rowNum`;
 *   images: embedded pictures keyed by drawing name (Lunar names each cover after
 *   its ProductCode); imagesByRow: the same pictures keyed by the sheet row they
 *   sit in, for sheets whose pictures are just "Image 1", "Image 2"…
 */
export async function readWorkbook(data, { XLSX, JSZip }) {
  const wb = XLSX.read(data, { type: 'array', cellDates: false });
  // Use the first sheet whose layout we recognise (a workbook may open on a
  // cover or notes tab), else the first sheet.
  const sheets = wb.SheetNames.map((name) => readSheet(XLSX, wb.Sheets[name]));
  const index = Math.max(0, sheets.findIndex((rows) => { try { return detectDistributor(rows); } catch { return false; } }));
  const rows = sheets[index] ?? [];

  const images = new Map();
  const imagesByRow = new Map();
  // Pictures are read from the first sheet only; .xls and .csv files have none.
  if (index !== 0) return { rows, images, imagesByRow };
  let zip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    return { rows, images, imagesByRow };
  }
  const drawings = Object.keys(zip.files).filter((p) => /^xl\/drawings\/drawing\d+\.xml$/.test(p));
  const attr = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
  for (const path of drawings) {
    const xml = await zip.file(path).async('string');
    const relsFile = zip.file(path.replace('drawings/', 'drawings/_rels/') + '.rels');
    if (!relsFile) continue;
    const rels = new Map(
      [...(await relsFile.async('string')).matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], 'Id'), attr(m[0], 'Target')]),
    );
    // Element names may or may not carry the xdr: prefix depending on the tool that wrote the file.
    for (const anchor of xml.matchAll(/<(?:xdr:)?(?:oneCellAnchor|twoCellAnchor)\b[\s\S]*?<\/(?:xdr:)?(?:oneCellAnchor|twoCellAnchor)>/g)) {
      const body = anchor[0];
      const pic = body.match(/<(?:xdr:)?pic>[\s\S]*?<\/(?:xdr:)?pic>/)?.[0];
      if (!pic) continue;
      const name = attr(pic.match(/<(?:xdr:)?cNvPr\b[^>]*>/)?.[0] ?? '', 'name');
      const target = rels.get(pic.match(/r:embed="([^"]+)"/)?.[1]);
      if (!target) continue;
      // Targets are relative to xl/drawings/ ("../media/x.png") or absolute ("/xl/media/x.png").
      const file = zip.file(target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\.\//, ''));
      if (!file) continue;
      const read = () => file.async('uint8array');
      if (name) images.set(name, read);
      const row = body.match(/<(?:xdr:)?from>[\s\S]*?<(?:xdr:)?row>(\d+)<\/(?:xdr:)?row>/)?.[1];
      if (row != null && !imagesByRow.has(Number(row))) imagesByRow.set(Number(row), read);
    }
  }
  return { rows, images, imagesByRow };
}

/**
 * One sheet as arrays of cell text (as displayed in Excel), each row carrying
 * its 0-based sheet `rowNum` and the underlying `raw` values — needed for long
 * numbers like UPCs, which Excel displays as 7.59606E+11.
 */
function readSheet(XLSX, sheet) {
  if (!sheet?.['!ref']) return [];
  // Keep blank rows while reading so each row's position is known, then drop them.
  const firstRow = XLSX.utils.decode_range(sheet['!ref']).s.r;
  const opts = { header: 1, defval: null, blankrows: true };
  const raw = XLSX.utils.sheet_to_json(sheet, { ...opts, raw: true });
  return XLSX.utils.sheet_to_json(sheet, { ...opts, raw: false })
    .map((r, i) => Object.assign(r, { rowNum: firstRow + i, raw: raw[i] ?? [] }))
    .filter((r) => r.some((c) => c != null && String(c).trim() !== ''));
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

// Ratio/incentive covers ("1:25", "3 COPY UNLOCK") depend on the shop's qualifying orders, so they can't
// be promised to a customer. Store and convention exclusives (Dynamite.com, SDCC) are sold by someone else;
// "Direct Market" and distributor exclusives are the comic-shop editions, and Dynamic Forces ("DF …") titles are a
// general release, so those stay.
// Retailer bundles and pallets aren't retail items. (Titles already in a shop are hidden by the same rules:
// public.is_skipped_cover in 20270216000000_skip_exclusive_covers.sql.)
const INCENTIVE = /\b1:\d+\b|\bINCV?\b|\bRI\b|\bRATIO\b|\bINCENTIVE\b|\b\d+\s*COPY\b/i;
const EXCLUSIVE = /\bEXCL(USIVE)?\b(?!\s+GIFTS)/i;
const SHOP_EDITION = /\b(DIRECT\s+MARKET|DM|LUNAR|PRH|DIAMOND|DF)\s+EXCL|^DF\b/i;
const BUNDLE = /\bBUNDLES?\b|\bPALLETS?\b|\(NET\)/i;

const PUBLISHER_NAMES = {
  'DC Comics': 'DC',
  'Marvel Universe': 'Marvel',
  'Image Comics': 'Image',
  'DYNAMITE Entertainment': 'Dynamite',
  'BOOM! Studios': 'BOOM!',
  'IDW Publishing': 'IDW',
  'Dark Horse Comics': 'Dark Horse',
};

const PUBLISHER_BY_LOWER = Object.fromEntries(Object.entries(PUBLISHER_NAMES).map(([k, v]) => [k.toLowerCase(), v]));

const normalizePublisher = (p) => (p ? PUBLISHER_BY_LOWER[p.trim().toLowerCase()] ?? p.trim() : null);

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const fullYear = (y) => (y.length === 2 ? `20${y}` : y);
const ymd = (y, m, d) => `${fullYear(y)}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/**
 * A date as sheets write it → 'YYYY-MM-DD'. Accepts '10/1/2026', '10/1/26',
 * '2026-10-01', 'Oct 1, 2026', 'October 1 2026', '1-Oct-26', a trailing time
 * ('10/1/2026 0:00'), and Excel date serial numbers (46296).
 */
function isoDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return excelSerial(v);
  const s = String(v).trim().replace(/[ T]\d{1,2}:\d{2}(:\d{2})?(\.\d+)?\s*([AP]M)?Z?$/i, '');
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return ymd(m[1], m[2], m[3]);
  m = s.match(/^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$/); // "Oct 1, 2026"
  if (m && MONTHS.includes(m[1].slice(0, 3).toLowerCase())) return ymd(m[3], MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, m[2]);
  m = s.match(/^(\d{1,2})[- ]([A-Za-z]{3,9})\.?[- ](\d{2}|\d{4})$/); // "1-Oct-26"
  if (m && MONTHS.includes(m[2].slice(0, 3).toLowerCase())) return ymd(m[3], MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, m[1]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) return ymd(m[3], m[1], m[2]);
  if (/^\d{5}(\.\d+)?$/.test(s)) return excelSerial(Number(s));
  return null;
}

/** Excel stores dates as days since 1899-12-30; accept roughly 1982–2119. */
function excelSerial(n) {
  if (!(n > 30000 && n < 80000)) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000).toISOString().slice(0, 10);
}

export function money(v) {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

const clean = (v) => {
  const s = v == null ? '' : String(v).trim();
  return s === '' ? null : s;
};

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', mdash: '—', ndash: '–', hellip: '…', bull: '•', eacute: 'é', egrave: 'è', ntilde: 'ñ', uuml: 'ü', ouml: 'ö', auml: 'ä', copy: '©', reg: '®', trade: '™' };

/** Distributor descriptions are HTML fragments; store them as plain text. */
function htmlToText(html) {
  if (!html) return null;
  const text = String(html)
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text || null;
}

/**
 * Split a distributor title into series title, issue number and variant.
 *   'ABSOLUTE BATMAN #25 CVR B J SCOTT CAMPBELL CARD STOCK VAR'
 *     → { title: 'ABSOLUTE BATMAN', issue_number: '25', variant: 'CVR B J SCOTT CAMPBELL CARD STOCK VAR' }
 *   'CALEXIT SAY GOODBYE TO HOLLYWOOD #3 (OF 3) (MR)'
 *     → { title: 'CALEXIT SAY GOODBYE TO HOLLYWOOD', issue_number: '3 (of 3)', variant: null, mature: true }
 */
function splitTitle(raw) {
  let s = String(raw)
    .replace(/\s*previously FOC'?d on [\d/-]+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const mature = /\(MR\)/i.test(s);
  s = s.replace(/\s*\(MR\)/gi, '').trim();

  const m = s.match(/^(.*?)\s+#(\d+(?:\.\d+)?[A-Z]?)\b\s*(.*)$/i);
  if (!m) {
    // No issue number (one-shots, specials): still split off a cover variant, written "CVR A" (Lunar), "(CVR A)"
    // (Dark Horse) or "Cover A" / "Variant B" (IDW, Alien Books, Ignition). The cover letter is a capital on its own,
    // so words like "Variant Edition" or "Cover Me" stay in the title.
    const cvr = s.match(/^(.*?)\s+(\(?[Cc][Vv][Rr] [A-Z]{1,2}\b.*|(?:Cover|COVER|Variant|VARIANT) [A-Z](?=$|[\s(]).*)$/);
    return cvr ? { title: cvr[1], issue_number: null, variant: cvr[2], mature } : { title: s, issue_number: null, variant: null, mature };
  }

  let [, title, issue, rest] = m;
  // Series-length notes belong with the issue number, not the cover variant.
  const of = rest.match(/^\(OF (\d+)\)\s*/i);
  if (of) {
    issue += ` (of ${of[1]})`;
    rest = rest.slice(of[0].length);
  }
  const oneShot = rest.match(/^\(ONE[- ]?SHOT\)\s*/i);
  if (oneShot) {
    issue += ' (one-shot)';
    rest = rest.slice(oneShot[0].length);
  }
  return { title: title.trim(), issue_number: issue, variant: clean(rest), mature };
}

function categorize({ rawTitle, format }) {
  if (/OMNIBUS/i.test(rawTitle)) return 'omnibuses';
  if (format) return format === 'CB' ? 'comics' : 'trades'; // PRH: CB comic, TR/HC/BX trade formats
  if (/\b(TP|HC|GN|SC|VOL|BOX SET|DLX ED|COMPENDIUM|GRAPHIC NOVEL)\b/i.test(rawTitle)) return 'trades';
  if (/#\d|\bONE[- ]?SHOT\b|\bPROG \d+/i.test(rawTitle)) return 'comics';
  return 'other'; // stationery, games, calendars and other odd items
}

function skipReason(rawTitle) {
  if (BUNDLE.test(rawTitle)) return 'Retailer bundle';
  if (INCENTIVE.test(rawTitle)) return 'Incentive / ratio variant';
  if (EXCLUSIVE.test(rawTitle) && !SHOP_EDITION.test(rawTitle)) return 'Store / convention exclusive';
  return null;
}

const splitCode = (code) => {
  const c = clean(code);
  if (!c) return { isbn: null, upc: null };
  return /^97[89]\d{10}$/.test(c) ? { isbn: c, upc: null } : { isbn: null, upc: c };
};

/**
 * Map header names → column index so column order changes don't break parsing.
 * `wanted` is { key: [label, field] }: the distributor's own header, and the general field (FIELD_HEADERS) whose
 * other names are tried when that header isn't there, so "RetailCost" renamed "SRP" is still the price.
 * A plain string is a header with no other names. Only `required` keys (by default all of them) stop the import.
 * Any other column the sheet doesn't have is listed in `missing`, and the parser leaves that field undefined so a
 * re-import keeps what titles already have.
 */
function columns(header, specs, required = Object.keys(specs)) {
  const wanted = Object.fromEntries(Object.entries(specs).map(([k, v]) => [k, [].concat(v)]));
  const names = header.map(normHeader);
  const idx = {};
  const used = new Set();
  // Exact headers first, so another column's own header is never taken as a stand-in.
  for (const [key, [label]] of Object.entries(wanted)) {
    const i = names.findIndex((n, j) => n === normHeader(label) && !used.has(j));
    if (i >= 0) (idx[key] = i, used.add(i));
  }
  const renamed = [];
  const missing = [];
  for (const [key, [label, field]] of Object.entries(wanted)) {
    if (idx[key] != null) continue;
    let i = -1;
    for (const alias of FIELD_HEADERS[field] ?? []) {
      i = names.findIndex((n, j) => n === alias && !used.has(j));
      if (i >= 0) break;
    }
    if (i >= 0) {
      idx[key] = i;
      used.add(i);
      renamed.push({ label, header: clean(header[i]) });
    } else if (required.includes(key)) {
      throw new Error(`Missing column "${label}" — has the sheet format changed?`);
    } else missing.push(label);
  }
  return { c: idx, renamed, missing };
}

/** A cell by column key, or undefined when the sheet has no such column. */
const cellOf = (c) => (r, key, fn = clean) => (c[key] == null ? undefined : fn(r[c[key]]));

// ---------------------------------------------------------------------------
// Distributors
// ---------------------------------------------------------------------------

// A Lunar or PRH sheet is known by its code column plus its usual cutoff column, or plus two of its other usual
// columns: with one of them renamed the sheet still gets its distributor's rules (covers, descriptions), and only
// that one field is missed.
const LUNAR_MARKS = ['finalordercutoff', 'instoredate', 'retailcost', 'coverartist'];
const PRH_MARKS = ['focdate', 'onsaledate', 'retailpriceus', 'imprint'];
const looksLike = (names, code, marks) =>
  names.includes(code) && (names.includes(marks[0]) || marks.filter((m) => names.includes(m)).length >= 2);

/** Find the header row and which distributor produced the sheet. */
function detectDistributor(rows) {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const cells = (rows[i] ?? []).map((c) => String(c ?? '').trim().toLowerCase());
    const names = (rows[i] ?? []).map(normHeader);
    if (looksLike(names, 'productcode', LUNAR_MARKS)) return { distributor: 'lunar', headerRow: i };
    if (looksLike(names, 'isbnupc', PRH_MARKS)) return { distributor: 'prh', headerRow: i };
    if (cells.includes('pop name/wave') && cells.includes('preorder deadline')) return { distributor: 'funko', headerRow: i };
    if (cells.includes('item name') && cells.includes('upc/ean') && cells.includes('box number')) return { distributor: 'funko-catalog', headerRow: i };
  }
  const generic = detectColumns(rows);
  if (generic) return { distributor: 'generic', ...generic };
  throw new Error(
    'Couldn’t find a header row. The sheet needs a column headed Title (or Name / Product) and at least one of Price, UPC, ISBN, SKU, Publisher, Release date or FOC date.',
  );
}

/**
 * @returns {{ distributor: string, items: object[], skipped: {sku:string,title:string,reason:string}[] }}
 *   items are ready for the `items` table, plus a `cover` descriptor:
 *   { embedded: '<drawing name>' }, { url: '<https url>' } or null.
 * @param {any[][]} rows
 * @param {{ today?: string, exclusions?: {kind:string,value:string}[] }} [opts]
 *   today: shop's date (YYYY-MM-DD), for deadlines that are already closed;
 *   exclusions: the shop's "always skip" list, see applyExclusions()
 */
export function parseSheet(rows, { today, exclusions } = {}) {
  return applyExclusions(parseRows(rows, today), exclusions);
}

function parseRows(rows, today) {
  return withoutRepeats(parseRowsBySource(rows, today));
}

/**
 * Each SKU once: the first row wins and later rows with the same SKU are skipped ("Listed twice in this sheet").
 * Two rows with one SKU would break the import: the insert hits the (distributor, sku) unique key, and a
 * re-import's upsert can't update the same row twice in one statement.
 */
function withoutRepeats(parsed) {
  const seen = new Set();
  const items = [];
  const repeats = [];
  for (const i of parsed.items) {
    if (seen.has(i.sku)) repeats.push({ sku: i.sku, title: [i.title, i.issue_number && `#${i.issue_number}`, i.variant].filter(Boolean).join(' '), reason: 'Listed twice in this sheet' });
    else (seen.add(i.sku), items.push(i));
  }
  return repeats.length ? { ...parsed, items, skipped: [...parsed.skipped, ...repeats], repeated: repeats.length } : parsed;
}

function parseRowsBySource(rows, today) {
  const { distributor, headerRow } = detectDistributor(rows);
  const header = rows[headerRow];
  const body = rows.slice(headerRow + 1);
  if (distributor === 'lunar') return { distributor, ...parseLunar(header, body) };
  if (distributor === 'prh') return { distributor, ...parsePRH(header, body) };
  // Funko items are stored with distributor 'other'.
  if (distributor === 'funko-catalog') return { distributor: 'other', source: 'funko', ...parseFunkoCatalog(header, body) };
  // Any other spreadsheet: stored as 'other', matched on SKU / UPC / ISBN.
  if (distributor === 'generic') return { distributor: 'other', source: 'sheet', ...parseGeneric(header, body, detectDistributor(rows).fields) };
  return { distributor: 'other', source: 'funko', ...parseFunko(header, body, today ?? new Date().toISOString().slice(0, 10)) };
}

const sameName = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
// PRH adds " (Hardcover)" / " (Paperback)" to a series title; a series rule should still match.
const withoutBinding = (s) => s.replace(/ (hardcover|paperback)$/, '');

// Collector badges a new title starts with, read from its title, issue number and cover variant. Staff can untick
// any of them; titles already imported keep the badges staff set.
const AUTO_BADGES = [
  // A #1: '1', '01', '1 (of 4)', '1 (one-shot)', '1A', but not '10', '1.5' or '0'.
  ['first_issue', (i) => /^0*1(?![\d.])/.test(i.issue_number ?? '')],
  // 'ONE SHOT', 'ONE-SHOT', 'ONESHOT', '1 SHOT', '1-SHOT', '1SHOT'.
  ['one_shot', (_, text) => /\b(?:one|1)[\s-]*shot\b/i.test(text)],
  // '#2 (of 6)': a mini or limited series.
  ['limited_series', (_, text) => /\(\s*of\s+\d+\s*\)/i.test(text)],
  // A reprint of an older comic: 'FACSIMILE EDITION', 'FACSIMILE ED'.
  ['facsimile', (_, text) => /\bfacsimile\b/i.test(text)],
  // Mystery bagged comics: 'BLIND BAG', 'BLIND-BAGGED' (not 'BLIND BOX': those are toys).
  ['blind_bag', (_, text) => /\bblind[\s-]*bag/i.test(text)],
];

/** The badges a newly imported title gets, e.g. ['first_issue', 'limited_series'] for 'X-MEN #1 (OF 5)'. */
export function autoBadges(item) {
  const text = [item.title, item.issue_number && `#${item.issue_number}`, item.variant].filter(Boolean).join(' ');
  return AUTO_BADGES.filter(([, test]) => test(item, text)).map(([badge]) => badge);
}

/**
 * Move items matching the shop's "always skip" list from `items` to `skipped`.
 * Rules: { kind: 'publisher' | 'series', value } matched by name ignoring case and
 * punctuation (publishers through the same short names the importer stores, so
 * "DC Comics" matches "DC"), { kind: 'keyword', value } for a word or phrase anywhere in the
 * title or cover variant (whole words: "ant" doesn't match "giant"), and { kind: 'mature' }
 * for every mature-rated title.
 */
export function applyExclusions(parsed, rules) {
  if (!rules?.length) return parsed;
  const publishers = new Set(rules.filter((r) => r.kind === 'publisher').map((r) => sameName(normalizePublisher(r.value))));
  const series = new Set(rules.filter((r) => r.kind === 'series').map((r) => sameName(r.value)));
  const keywords = rules.filter((r) => r.kind === 'keyword').map((r) => sameName(r.value)).filter(Boolean);
  const noMature = rules.some((r) => r.kind === 'mature');
  const items = [];
  const skipped = [...parsed.skipped];
  for (const i of parsed.items) {
    const title = sameName(i.title);
    const words = ` ${sameName(`${i.title} ${i.variant ?? ''}`)} `;
    const keyword = keywords.find((k) => words.includes(` ${k} `));
    const reason =
      (publishers.has(sameName(i.publisher)) && `Excluded publisher: ${i.publisher}`) ||
      ((series.has(title) || series.has(withoutBinding(title))) && `Excluded series: ${i.title}`) ||
      (keyword && `Title contains “${rules.find((r) => r.kind === 'keyword' && sameName(r.value) === keyword).value}”`) ||
      (noMature && i.mature && 'Mature title (excluded)');
    if (reason) skipped.push({ sku: i.sku, title: [i.title, i.issue_number && `#${i.issue_number}`, i.variant].filter(Boolean).join(' '), reason });
    else items.push(i);
  }
  return { ...parsed, items, skipped };
}

const LUNAR_HIRES = 'https://media.lunardistribution.com/images/covers/hires/';
/** A Lunar title's cover: the hi-res picture on Lunar's site, else the one embedded in the sheet (by its code). */
export const lunarCover = (sku) => ({ url: `${LUNAR_HIRES}${encodeURIComponent(sku)}.jpg`, preferUrl: true, embedded: sku });

function parseLunar(header, body) {
  const { c, renamed, missing } = columns(header, {
    code: ['ProductCode', 'sku'], title: ['Title', 'title'], price: ['RetailCost', 'price'], publisher: ['Publisher', 'publisher'],
    description: ['Description', 'description'], foc: ['FinalOrderCutoff', 'foc'], instore: ['InstoreDate', 'release'],
    upc: ['UPC', 'upc'], isbn: ['ISBN', 'isbn'], writer: ['Writer', 'creators'], artist: ['Artist', 'artist'],
    coverArtist: ['CoverArtist'], mature: ['Mature', 'mature'], adult: ['Adult'],
  }, ['code', 'title']);
  const cell = cellOf(c);
  const creatorKeys = ['writer', 'artist', 'coverArtist'].filter((k) => c[k] != null);
  const ratingKeys = ['mature', 'adult'].filter((k) => c[k] != null);
  const items = [];
  const skipped = [];
  for (const r of body) {
    const sku = clean(r[c.code]);
    const rawTitle = clean(r[c.title]);
    if (!sku || !rawTitle) continue;
    const reason = skipReason(rawTitle);
    if (reason) {
      skipped.push({ sku, title: rawTitle, reason });
      continue;
    }
    const t = splitTitle(rawTitle);
    const creators = [...new Set(creatorKeys.flatMap((k) => String(r[c[k]] ?? '').split(/\s*,\s*/)).filter(Boolean))];
    const flag = (k) => r[c[k]] === true || /^true$/i.test(String(r[c[k]] ?? ''));
    items.push({
      distributor: 'lunar',
      sku,
      title: t.title,
      issue_number: t.issue_number,
      variant: t.variant,
      publisher: cell(r, 'publisher', normalizePublisher),
      category: categorize({ rawTitle }),
      price: cell(r, 'price', money),
      foc_date: cell(r, 'foc', isoDate),
      release_date: cell(r, 'instore', isoDate),
      upc: cell(r, 'upc'),
      isbn: cell(r, 'isbn'),
      creators: creatorKeys.length ? creators.join(', ') || null : undefined,
      mature: t.mature || ratingKeys.some(flag) || (ratingKeys.length ? false : undefined),
      description: cell(r, 'description', htmlToText),
      // Lunar's hi-res cover by product code; the small picture in the sheet is the fallback.
      cover: lunarCover(sku),
    });
  }
  return { items, skipped, columnsRenamed: renamed, columnsMissing: missing };
}

// PRH's Format column: HC hardcover, TR trade paperback (CB comics, BX box sets and the rest keep their plain title).
const BINDING = { HC: 'Hardcover', TR: 'Paperback' };

function parsePRH(header, body) {
  const { c, renamed, missing } = columns(header, {
    code: ['ISBN/UPC', 'upc'], title: ['Title', 'title'], subtitle: ['Subtitle'], creators: ['Creators', 'creators'],
    imprint: ['Imprint', 'publisher'], price: ['Retail Price (US)', 'price'], format: ['Format', 'category'],
    foc: ['FOC Date', 'foc'], onsale: ['On-Sale Date', 'release'],
  }, ['code', 'title']);
  const cell = cellOf(c);
  const items = [];
  const skipped = [];
  for (const r of body) {
    const sku = clean(r[c.code]);
    const rawTitle = clean(r[c.title]);
    if (!sku || !rawTitle) continue;
    const reason = skipReason(rawTitle);
    if (reason) {
      skipped.push({ sku, title: rawTitle, reason });
      continue;
    }
    const t = splitTitle(rawTitle);
    const subtitle = cell(r, 'subtitle');
    const format = cell(r, 'format');
    const base = subtitle && !t.issue_number ? `${t.title}: ${subtitle}` : t.title;
    // The same book often comes as both a hardcover and a paperback, with the same name and a different price:
    // say which this is, unless the title already does.
    const binding = BINDING[format];
    items.push({
      distributor: 'prh',
      sku,
      title: binding && !/\b(hardcover|paperback)\b/i.test(base) ? `${base} (${binding})` : base,
      issue_number: t.issue_number,
      variant: t.variant,
      publisher: cell(r, 'imprint', normalizePublisher),
      category: categorize({ rawTitle, format }),
      price: cell(r, 'price', money),
      foc_date: cell(r, 'foc', isoDate),
      release_date: cell(r, 'onsale', isoDate),
      ...splitCode(sku),
      creators: cell(r, 'creators'),
      mature: t.mature,
      description: undefined, // PRH sheets have none: re-importing leaves the one prh-sync filled in
      cover: { url: `https://images.penguinrandomhouse.com/cover/${encodeURIComponent(sku)}` },
    });
  }
  return { items, skipped, columnsRenamed: renamed, columnsMissing: missing };
}

/**
 * A title from the PRH API (prh-lookup: data.titles[0] and data.content) as the same fields a PRH sheet row gives,
 * plus the description, for "Fill in from PRH" in Admin → Titles. Fields PRH doesn't send are left out.
 */
export function prhApiItem(record, content) {
  const rawTitle = clean(record.title) ?? '';
  const t = splitTitle(rawTitle);
  const subtitle = clean(record.subtitle);
  const format = clean(record.format?.code);
  const base = subtitle && !t.issue_number ? `${t.title}: ${subtitle}` : t.title;
  const binding = BINDING[format];
  const usd = (record.price ?? []).find((p) => p?.currencyCode === 'USD')?.amount;
  const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v ?? '') ? v : null);
  const fields = {
    title: binding && !/\b(hardcover|paperback)\b/i.test(base) ? `${base} (${binding})` : base,
    issue_number: t.issue_number,
    variant: t.variant,
    publisher: normalizePublisher(clean(record.imprint?.description)),
    category: categorize({ rawTitle, format }),
    price: Number.isFinite(usd) && usd > 0 ? usd : null,
    foc_date: date(record.focDate),
    release_date: date(record.onsale),
    ...splitCode(record.isbnStr ?? record.isbn),
    creators: clean(record.author),
    mature: t.mature || undefined,
    description: htmlToText(content?.flapcopy) ?? htmlToText(content?.keynote),
  };
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v != null && v !== ''));
}

// What the daily PRH import takes from the API's title list: comics and graphic novels, not the prose, stickers and
// other goods PRH also distributes.
const PRH_COMICS = new Set(['Comics', 'Graphic Novel']);

/**
 * PRH API title records (SALESPLATFORM's on-sale list) as a parsed sheet, for the daily PRH import
 * (tools/prh-auto-import.mjs) → applyImport: the same fields, skip rules and exclusions as importing a PRH sheet.
 * PRH marks ratio covers "Incentive Variant" even when the title doesn't say 1:25, so those are skipped too.
 */
export function parsePrhApi(records, { exclusions } = {}) {
  const items = [];
  const skipped = [];
  for (const r of records) {
    const sku = clean(r.isbnStr ?? r.isbn);
    const rawTitle = clean(r.title);
    if (!sku || !rawTitle || !PRH_COMICS.has(r.graphicCategory)) continue;
    const reason = (r.coverVariantDesc === 'Incentive Variant' && 'Incentive / ratio variant') || skipReason(rawTitle);
    if (reason) {
      skipped.push({ sku, title: rawTitle, reason });
      continue;
    }
    items.push({ ...prhApiItem(r, null), distributor: 'prh', sku, cover: { url: `https://images.penguinrandomhouse.com/cover/${encodeURIComponent(sku)}` } });
  }
  return applyExclusions(withoutRepeats({ distributor: 'prh', items, skipped }), exclusions);
}

const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');

/**
 * Funko retailer pre-order list: no UPC/SKU or images, and the deadline column
 * mixes dates with words ("FOC Closed", "Open - Limited").
 */
function parseFunko(header, body, today) {
  const { c } = columns(header, {
    release: 'Release/By Date', franchise: 'Franchise', name: 'Pop Name/Wave', type: 'Figure Type',
    source: 'Distributor', price: 'MSRP (Est.)', deadline: 'Preorder Deadline',
  });
  const items = [];
  for (const r of body) {
    const franchise = clean(r[c.franchise]);
    const name = clean(r[c.name]);
    if (!name) continue;
    const release = isoDate(r[c.release]);
    const deadline = clean(r[c.deadline]) ?? '';
    // Reservations close the Saturday before foc_date, same as comics:
    //   a date      → that date
    //   "Closed"    → today (closed now; shows up on New Arrivals once released)
    //   "Open…"     → no deadline given, so the release date
    const foc = isoDate(deadline) ?? (/closed/i.test(deadline) ? today : release);
    items.push({
      distributor: 'other',
      // No UPC in the sheet: a stable id from franchise + name so re-imports update in place (see funkoSkus for
      // figures that share a name).
      sku: `funko:${slug(`${franchise ?? ''} ${name}`)}`,
      title: franchise ? `${franchise} — ${name}` : name,
      issue_number: null,
      variant: clean(r[c.type]),
      publisher: 'Funko',
      category: 'funko-pops',
      price: money(r[c.price]),
      foc_date: foc,
      release_date: release,
      upc: null,
      isbn: null,
      creators: null,
      mature: false,
      description: [clean(r[c.source]) && `Distributor: ${clean(r[c.source])}`, deadline && `Preorder deadline: ${deadline}`].filter(Boolean).join('\n') || null,
      cover: null,
    });
  }
  return { items: funkoSkus(items), skipped: [] };
}

// The everyday figure type ("Pop!", "POP! Vinyl"), as opposed to Deluxe, Rides, Jumbo, Keychain…
const REGULAR_FUNKO = /^(funko\s+)?pop!?(\s+vinyl)?(\s+figures?)?$/i;

/**
 * Figures that differ only by Figure Type (a regular Pop and a Deluxe of the same character) would share the
 * franchise + name SKU. Within such a group the regular one (or, with none, the first listed) keeps the plain SKU and
 * the others get their type added ("funko:marvel-venom--pop-deluxe"). A figure with a name of its own keeps the
 * plain SKU whatever its type, so everything imported before this rule existed still updates in place.
 */
function funkoSkus(items) {
  const groups = new Map();
  for (const i of items) groups.set(i.sku, [...(groups.get(i.sku) ?? []), i]);
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const regular = (i) => !i.variant || REGULAR_FUNKO.test(i.variant);
    const plain = group.find(regular) ?? group[0];
    const samePlain = (i) => i === plain || (regular(i) && regular(plain)) || i.variant === plain.variant;
    for (const i of group) if (!samePlain(i)) i.sku = `${i.sku}--${slug(i.variant)}`;
  }
  return items; // rows that still share a SKU (same name and type) are true repeats, dropped by withoutRepeats
}

/**
 * Funko list with pictures, UPCs and box numbers. It has no preorder deadline,
 * and release dates may be vague ("Late Oct/Nov 2026"): those come through as
 * undefined, meaning "not in this sheet", so an import keeps whatever the item
 * already has rather than blanking it.
 */
function parseFunkoCatalog(header, body) {
  const { c } = columns(header, {
    itemNumber: 'Item Number', box: 'Box Number', name: 'Item Name', license: 'License',
    type: 'Product Type', price: 'MSRP', upc: 'UPC/EAN', source: 'Distributor', release: 'Release Date',
  });
  const items = [];
  for (const r of body) {
    const name = clean(r[c.name]);
    const upc = clean(r[c.upc]);
    if (!name || !upc) continue;
    const license = clean(r[c.license]);
    const releaseText = clean(r[c.release]);
    const box = clean(r[c.box]);
    items.push({
      distributor: 'other',
      sku: upc,
      title: license ? `${license} — ${name}` : name,
      issue_number: null,
      variant: [clean(r[c.type]), box && `#${box}`].filter(Boolean).join(' ') || null,
      publisher: 'Funko',
      category: 'funko-pops',
      price: money(r[c.price]),
      foc_date: undefined,
      release_date: isoDate(releaseText) ?? undefined,
      upc,
      isbn: null,
      creators: null,
      mature: false,
      description: [
        clean(r[c.itemNumber]) && `Funko item ${clean(r[c.itemNumber])}`,
        clean(r[c.source]) && `Distributor: ${clean(r[c.source])}`,
        releaseText && `Release: ${releaseText}`,
      ].filter(Boolean).join('\n') || null,
      // Picture from the sheet if it has a real one, else Funko's own product image
      // for this item number — accepted only if it also names this figure.
      cover: { row: r.rowNum, funkoItem: clean(r[c.itemNumber]), keywords: nameKeywords(name) },
    });
  }
  return { items, skipped: [] };
}

const GENERIC_WORDS = new Set(['pop', 'vinyl', 'figure', 'deluxe', 'super', 'sized', 'jumbo', 'comic', 'cover', 'series', 'wave', 'with', 'the', 'and']);

/** Distinctive words of a figure name, used to confirm a looked-up image is the right product. */
const nameKeywords = (name) =>
  [...new Set(String(name).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !GENERIC_WORDS.has(w)))];

// ---------------------------------------------------------------------------
// Any other spreadsheet
// ---------------------------------------------------------------------------

// Header names each field is recognised by, compared lowercase with spaces and
// punctuation removed ("Retail Price (US)" → "retailpriceus"). Earlier names win.
const FIELD_HEADERS = {
  title: ['title', 'fulltitle', 'itemtitle', 'producttitle', 'itemname', 'productname', 'itemdescription', 'productdescription', 'name', 'product', 'item', 'series', 'seriestitle', 'popnamewave', 'description'],
  issue: ['issue', 'issuenumber', 'issueno', 'issuenum', 'no', 'number'],
  variant: ['variant', 'variantdescription', 'cover', 'covervariant', 'edition', 'figuretype'],
  publisher: ['publisher', 'imprint', 'brand', 'manufacturer', 'vendor', 'license', 'franchise'],
  price: ['price', 'retailprice', 'retailpriceus', 'retail', 'retailcost', 'msrp', 'msrpest', 'srp', 'coverprice', 'unitprice', 'priceus', 'usprice'],
  foc: ['foc', 'focdate', 'finalordercutoff', 'finalorderdate', 'orderdeadline', 'preorderdeadline', 'orderby', 'orderbydate', 'deadline', 'cutoff', 'cutoffdate'],
  release: ['release', 'releasedate', 'releasebydate', 'onsale', 'onsaledate', 'instore', 'instoredate', 'streetdate', 'shipdate', 'expectedshipdate', 'estshipdate', 'availabledate', 'date'],
  upc: ['upc', 'upcean', 'upccode', 'ean', 'barcode', 'upcisbn', 'isbnupc', 'upcisbnean'],
  isbn: ['isbn', 'isbn13', 'isbn10', 'ean13'],
  sku: ['sku', 'itemcode', 'productcode', 'itemnumber', 'itemno', 'productid', 'itemid', 'stockcode', 'stocknumber', 'diamondcode', 'diamondno', 'lunarcode', 'ordercode', 'code', 'catalognumber', 'catalogno'],
  creators: ['creators', 'creator', 'creativeteam', 'writerartist', 'author', 'authors', 'writer', 'writers'],
  artist: ['artist', 'artists', 'coverartist', 'illustrator'],
  description: ['description', 'synopsis', 'solicitation', 'solicit', 'summary', 'notes', 'details'],
  category: ['category', 'format', 'type', 'producttype', 'itemtype', 'department', 'productcategory'],
  mature: ['mature', 'mr', 'adult', 'rating', 'agerating'],
  quantity: ['qty', 'quantity', 'ordered', 'orderqty', 'qtyordered', 'orderquantity', 'finalorder', 'myorder', 'units'],
  image: ['image', 'imageurl', 'cover url', 'coverurl', 'coverimage', 'coverimageurl', 'picture', 'photo', 'imagelink', 'thumbnail'],
};
const normHeader = (h) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
FIELD_HEADERS.image = FIELD_HEADERS.image.map(normHeader);

/** Match a row's cells to fields; each column is used once. */
function matchFields(header) {
  const names = header.map(normHeader);
  const used = new Set();
  const fields = {};
  for (const [field, aliases] of Object.entries(FIELD_HEADERS)) {
    for (const alias of aliases) {
      const i = names.findIndex((n, j) => n === alias && !used.has(j));
      if (i >= 0) {
        fields[field] = i;
        used.add(i);
        break;
      }
    }
  }
  return fields;
}

/** Header row of an arbitrary sheet: a title column plus at least one detail column. */
function detectColumns(rows) {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const fields = matchFields(rows[i] ?? []);
    if (fields.title == null) continue;
    const details = ['price', 'upc', 'isbn', 'sku', 'publisher', 'release', 'foc', 'issue'].filter((f) => fields[f] != null);
    if (details.length) return { headerRow: i, fields };
  }
  return null;
}

/** A product code as written, even when Excel stored it as a number. */
function codeCell(r, i) {
  if (i == null) return null;
  const raw = r.raw?.[i];
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw >= 1e15 ? null : raw.toFixed(0); // beyond this, digits are already lost
  const s = clean(r[i]);
  return s ? s.replace(/[\s-]/g, '') : null;
}

const CATEGORY_WORDS = [
  [/omnibus/i, 'omnibuses'],
  [/funko|\bpop\b|vinyl figure/i, 'funko-pops'],
  [/record|vinyl|\blp\b|album/i, 'records'],
  [/toy|figure|statue|plush|lego|action/i, 'toys'],
  [/trade|\btpb?\b|\bhc\b|hardcover|softcover|\bsc\b|graphic novel|\bgn\b|manga|book|collection|\b(TR|BX)\b/i, 'trades'],
  [/comic|periodical|single|floppy|\bcb\b|issue/i, 'comics'],
];

/**
 * Rows from any spreadsheet with recognisable headers. Columns the sheet
 * doesn't have come through as undefined, so re-importing never blanks what
 * a title already has.
 */
function parseGeneric(header, body, fields) {
  const cell = (r, f) => (fields[f] == null ? undefined : clean(r[fields[f]]));
  const has = (f) => fields[f] != null;
  const items = [];
  const skipped = [];
  const seen = new Set();
  for (const r of body) {
    const rawTitle = cell(r, 'title');
    if (!rawTitle || /^(grand )?totals?:?$/i.test(rawTitle)) continue;
    const upcCell = codeCell(r, fields.upc);
    const codes = upcCell ? (/^97[89]\d{10}$/.test(upcCell) ? { isbn: upcCell, upc: null } : { upc: upcCell, isbn: null }) : {};
    const isbn = codeCell(r, fields.isbn) ?? codes.isbn ?? null;
    const upc = codes.upc ?? null;
    const sku = codeCell(r, fields.sku) ?? upc ?? isbn;
    const label = [rawTitle, cell(r, 'issue') && `#${cell(r, 'issue')}`, cell(r, 'variant')].filter(Boolean).join(' ');

    const reason = skipReason(label);
    if (reason) {
      skipped.push({ sku: sku ?? '', title: label, reason });
      continue;
    }
    if (has('quantity')) {
      const qty = String(r[fields.quantity] ?? '').trim();
      if (qty !== '' && Number(qty) === 0) {
        skipped.push({ sku: sku ?? '', title: label, reason: 'Quantity 0 (not ordered)' });
        continue;
      }
    }

    // With its own issue column the title is used as is; otherwise split
    // "SERIES #3 CVR B …" the same way as distributor sheets.
    const t = has('issue') ? { title: rawTitle, issue_number: cell(r, 'issue')?.replace(/^#/, '') ?? null, variant: null, mature: /\(MR\)/i.test(rawTitle) } : splitTitle(rawTitle);
    if (has('issue')) t.title = t.title.replace(/\s*\(MR\)/gi, '').trim();
    const variant = has('variant') ? cell(r, 'variant') ?? t.variant : t.variant;
    const key = sku ?? `sheet:${slug([t.title, t.issue_number, variant].filter(Boolean).join(' '))}`;
    if (seen.has(key)) {
      skipped.push({ sku: key, title: label, reason: 'Listed twice in this sheet' });
      continue;
    }
    seen.add(key);

    const creators = has('creators') || has('artist')
      ? [...new Set([cell(r, 'creators'), cell(r, 'artist')].flatMap((v) => String(v ?? '').split(/\s*[,;/]\s*/)).filter(Boolean))].join(', ') || null
      : undefined;
    const matureCell = cell(r, 'mature');
    const categoryText = cell(r, 'category');
    const imageUrl = cell(r, 'image');
    const category = (categoryText && CATEGORY_WORDS.find(([re]) => re.test(categoryText))?.[1]) ?? categorize({ rawTitle: label });
    items.push({
      distributor: 'other',
      sku: key,
      title: t.title,
      // Only books have issue numbers. A figure's "#" or "Number" column is its collector number, and
      // keeping it would make every figure look like an issue of a series.
      issue_number: ['comics', 'trades', 'omnibuses'].includes(category) ? t.issue_number : null,
      variant: variant ?? null,
      publisher: has('publisher') ? normalizePublisher(cell(r, 'publisher')) : undefined,
      category,
      price: has('price') ? money(r[fields.price]) : undefined,
      foc_date: has('foc') ? isoDate(r.raw?.[fields.foc] ?? r[fields.foc]) ?? isoDate(r[fields.foc]) : undefined,
      release_date: has('release') ? isoDate(r.raw?.[fields.release] ?? r[fields.release]) ?? isoDate(r[fields.release]) : undefined,
      upc: has('upc') ? upc : undefined,
      isbn: has('isbn') || has('upc') ? isbn : undefined,
      creators,
      mature: t.mature || (matureCell != null && /^(y|yes|true|1|x|mr|mature|adult|m|18\+?|17\+?)$/i.test(matureCell)) || (has('mature') ? false : undefined),
      description: has('description') ? htmlToText(cell(r, 'description')) : undefined,
      // A picture in the row, else a linked image.
      cover: { row: r.rowNum, ...(imageUrl && /^https?:\/\//i.test(imageUrl) ? { url: imageUrl } : {}) },
    });
  }
  // Which sheet column fed each field, for the preview.
  const columnsUsed = Object.fromEntries(Object.entries(fields).map(([f, i]) => [f, clean(header[i])]));
  const ignored = header.map(clean).filter((h, i) => h && !Object.values(fields).includes(i));
  return { items, skipped, columnsUsed, ignored };
}
