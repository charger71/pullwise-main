// Customer pull list import: reading the spreadsheet in the browser, before anything goes to the database. Plain
// functions over arrays of cell text (no DOM, no Supabase), so they run and are tested in Node
// (admin/pull-import.test.js). The screen is admin/sections/import-pull-lists.js; matching and saving are in the
// database (supabase/migrations/20270306000000_pull_list_import.sql).
//
// Three layouts:
//   rows   - one row per customer and title (customers repeat down the sheet)
//   cell   - one row per customer, all their titles in one cell (split on new lines, commas and semicolons)
//   sheets - one sheet per customer, named after them; each row is a title

export const FIELDS = ['name', 'first_name', 'last_name', 'email', 'phone', 'title', 'quantity', 'notes', 'mature', 'no_email'];
export const FIELD_LABELS = {
  name: 'Customer name', first_name: 'First name', last_name: 'Last name', email: 'Email', phone: 'Phone',
  title: 'Title', quantity: 'Quantity', notes: 'Notes', mature: 'Mature OK', no_email: 'No email',
};
export const LAYOUTS = { rows: 'One row per customer and title', cell: 'One row per customer, titles in one cell', sheets: 'One sheet per customer' };

const MAX_QTY = 100;

/** Every sheet of a workbook as rows of trimmed cell text. XLSX is SheetJS, passed in so this runs anywhere. */
export function readSheets(data, XLSX) {
  const wb = XLSX.read(data, { type: 'array', cellDates: false });
  return wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '', blankrows: false })
      .map((r) => r.map((c) => String(c ?? '').trim())),
  })).filter((s) => s.rows.some((r) => r.some(Boolean)));
}

const norm = (h) => String(h ?? '').toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').trim();

// Header words per field, most specific first. A header is matched whole first, then by the words it contains.
const HEADERS = {
  no_email: ['no email', 'no emails', 'do not email', 'dont email', 'don t email', 'email opt out', 'opt out', 'opted out', 'unsubscribed', 'no mail'],
  mature: ['mature ok', 'mature', 'mature readers', 'adult', 'adults', '18+', 'mr ok', 'mr'],
  first_name: ['first name', 'first', 'given name', 'forename', 'fname'],
  last_name: ['last name', 'last', 'surname', 'family name', 'lname'],
  name: ['customer name', 'customer', 'name', 'full name', 'client', 'client name', 'subscriber', 'member', 'patron'],
  email: ['email', 'e mail', 'email address', 'e mail address', 'mail'],
  phone: ['phone', 'phone number', 'telephone', 'tel', 'mobile', 'cell', 'cell phone', 'contact number', 'phone #'],
  title: ['title', 'titles', 'series', 'comic', 'comics', 'book', 'books', 'pull', 'pulls', 'pull list', 'subscription', 'subscriptions', 'item', 'items'],
  quantity: ['qty', 'quantity', 'copies', 'count', '#', 'number of copies', 'no of copies', 'amount'],
  notes: ['notes', 'note', 'comments', 'comment', 'remarks', 'instructions'],
};
// Words that, inside a longer header, point at a field ("Customer Email" -> email, "Series Title" -> title).
const WORDS = {
  no_email: [/\bno (e ?)?mail/, /\bopt(ed)? out/, /\bunsubscribe/, /\bdo ?n.?t (e ?)?mail/],
  mature: [/\bmature\b/, /\badult/],
  first_name: [/\bfirst\b/, /\bgiven\b/],
  last_name: [/\blast\b/, /\bsurname\b/, /\bfamily\b/],
  email: [/\be ?mail\b/],
  phone: [/\bphone\b/, /\bmobile\b/, /\bcell\b/, /\btel\b/],
  quantity: [/\bqty\b/, /\bquantity\b/, /\bcopies\b/],
  notes: [/\bnotes?\b/, /\bcomments?\b/],
  title: [/\btitles?\b/, /\bseries\b/, /\bcomics?\b/, /\bpulls?\b/],
  name: [/\bname\b/, /\bcustomer\b/],
};

/**
 * Guesses which column holds each field from the header row. Returns { field: column index } for the fields found;
 * each column is used once, most specific field first ("No email" is not the email column).
 */
export function guessColumns(headers) {
  const hs = headers.map(norm);
  const out = {};
  const used = new Set();
  const take = (field, test) => {
    if (out[field] !== undefined) return;
    const i = hs.findIndex((h, n) => h && !used.has(n) && test(h));
    if (i >= 0) {
      out[field] = i;
      used.add(i);
    }
  };
  for (const field of Object.keys(HEADERS)) take(field, (h) => HEADERS[field].includes(h));
  for (const field of Object.keys(WORDS)) take(field, (h) => WORDS[field].some((re) => re.test(h)));
  // A full name alongside first and last: keep the split ones.
  if (out.first_name !== undefined && out.name !== undefined && out.last_name !== undefined) delete out.name;
  return out;
}

/**
 * The header row: the first of the top ten rows with two known column names, or one that is exactly a known name
 * ("Title" over a list of titles), else -1 (no header). A heading such as "Pull lists, March" is not a header.
 */
export function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const n = Object.keys(guessColumns(rows[i])).length;
    if (n >= 2 || (n === 1 && rows[i].some((h) => Object.values(HEADERS).some((list) => list.includes(norm(h)))))) return i;
  }
  return -1;
}

const SPLIT = /\r?\n|;|,/;

/** One cell of titles into titles: split on new lines, semicolons and commas; blanks dropped. */
export function splitTitles(cell) {
  return String(cell ?? '').split(SPLIT).map((t) => t.trim()).filter(Boolean);
}

/**
 * A trailing quantity off a title: "Saga x2", "Saga x 2", "Saga ×2", "Saga *2", "Saga (x2)", "Saga - 2 copies",
 * "Saga 2 copies", "Saga qty 2". Returns { title, quantity } with quantity null when there was none. An issue or
 * year number on its own ("Batman 2025", "Spawn #350") is left alone.
 */
export function stripQuantity(text) {
  const t = String(text ?? '').trim();
  const m = t.match(/^(.*?)[\s\-–:,]*(?:\(\s*)?(?:[x×*]\s*(\d{1,3})|(\d{1,3})\s*x|qty\.?\s*:?\s*(\d{1,3})|(\d{1,3})\s*(?:copies|copy|cps?))(?:\s*\))?$/i);
  if (!m || !m[1].trim()) return { title: t, quantity: null };
  // "Batman 2x" needs a space or bracket before the number, so "X-Men 92" or "Spider-Man 2099x" aren't cut.
  const n = +(m[2] ?? m[3] ?? m[4] ?? m[5]);
  if (m[3] !== undefined && !/[\s(]\d{1,3}\s*x\)?$/i.test(t)) return { title: t, quantity: null };
  if (!(n >= 1)) return { title: t, quantity: null };
  return { title: m[1].trim(), quantity: Math.min(n, MAX_QTY) };
}

/** "Smith, Jane" or "Jane Smith" into first and last; one word is a first name. */
export function splitName(full) {
  const s = String(full ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return { first_name: null, last_name: null };
  const comma = s.match(/^([^,]+),\s*(.+)$/);
  if (comma) return { first_name: comma[2].trim(), last_name: comma[1].trim() };
  const i = s.lastIndexOf(' ');
  return i < 0 ? { first_name: s, last_name: null } : { first_name: s.slice(0, i), last_name: s.slice(i + 1) };
}

/** A yes in a Mature OK or No email column: y, yes, true, 1, x, ✓. */
export const isYes = (v) => /^(y|yes|true|1|x|✓|✔|ok)$/i.test(String(v ?? '').trim());

export const looksLikeEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
export const phoneDigits = (p) => String(p ?? '').replace(/\D/g, '');

/** A whole-number quantity cell (1-100), or null. */
function quantityCell(v) {
  const n = parseInt(String(v ?? '').replace(/[^\d]/g, ''), 10);
  return n >= 1 ? Math.min(n, MAX_QTY) : null;
}

/**
 * Which layout a workbook looks like, given the columns guessed on its first sheet.
 *   sheets - several sheets and no customer column, or one sheet with titles and no customer column
 *   cell   - at least a third of the title cells hold more than one title
 *   rows   - otherwise
 */
export function detectLayout(sheets) {
  const first = sheets[0];
  if (!first) return 'rows';
  const h = findHeaderRow(first.rows);
  const cols = h >= 0 ? guessColumns(first.rows[h]) : {};
  const hasCustomer = ['name', 'first_name', 'last_name', 'email', 'phone'].some((f) => cols[f] !== undefined);
  if (!hasCustomer) return 'sheets';
  if (cols.title === undefined) return 'rows';
  const cells = first.rows.slice(h + 1).map((r) => r[cols.title]).filter(Boolean);
  const multi = cells.filter((c) => splitTitles(c).length > 1).length;
  return cells.length && multi / cells.length >= 1 / 3 ? 'cell' : 'rows';
}

/** The headers to offer in the mapping dropdowns, and the guessed mapping by header text (works across sheets). */
export function describeColumns(sheets) {
  const headers = [];
  for (const s of sheets) {
    const h = findHeaderRow(s.rows);
    if (h >= 0) for (const name of s.rows[h]) if (name && !headers.includes(name)) headers.push(name);
  }
  const guess = guessColumns(headers);
  return { headers, mapping: Object.fromEntries(Object.entries(guess).map(([f, i]) => [f, headers[i]])) };
}

/** A customer's grouping key: email, else phone digits, else name; the key is what the database calls ref. */
export function customerRef({ email, phone, first_name, last_name }) {
  if (email) return `e:${email.toLowerCase()}`;
  const d = phoneDigits(phone);
  if (d.length >= 7) return `p:${d.slice(-10)}`;
  const n = [first_name, last_name].filter(Boolean).join(' ').toLowerCase().replace(/\s+/g, ' ').trim();
  return n ? `n:${n}` : null;
}

/**
 * The workbook as customers and lines, ready to store.
 * @param {{ name: string, rows: string[][] }[]} sheets
 * @param {{ [field]: string }} mapping  header text per field (from the mapping screen)
 * @param {'rows'|'cell'|'sheets'} layout
 * @returns {{ customers: object[], lines: object[], problems: string[] }}
 *   customers: { ref, first_name, last_name, email, phone, mature_ok, no_email, flags: [] }
 *     flags: no_contact (no email and no phone), bad_email (left out), no_name
 *   lines: { customer_ref, position, raw_title, raw_quantity, raw_notes }
 */
export function buildImport(sheets, mapping, layout) {
  const customers = new Map();
  const lines = [];
  const problems = [];
  const counter = new Map();

  const addCustomer = (c) => {
    const ref = customerRef(c);
    if (!ref) return null;
    const had = customers.get(ref);
    if (had) {
      // the same customer on another row: fill in what the first row lacked; a yes anywhere counts
      for (const k of ['first_name', 'last_name', 'email', 'phone']) had[k] ||= c[k];
      had.mature_ok ||= c.mature_ok;
      had.no_email ||= c.no_email;
      return ref;
    }
    customers.set(ref, { ref, ...c });
    return ref;
  };

  const addLine = (ref, title, qtyCell, notes) => {
    const { title: raw, quantity } = stripQuantity(title);
    if (!raw) return;
    const position = (counter.get(ref) ?? 0) + 1;
    counter.set(ref, position);
    lines.push({
      customer_ref: ref,
      position,
      raw_title: raw.slice(0, 300),
      raw_quantity: quantityCell(qtyCell) ?? quantity ?? 1,
      raw_notes: notes ? String(notes).slice(0, 1000) : null,
    });
  };

  for (const sheet of layout === 'sheets' ? sheets : sheets.slice(0, 1)) {
    const h = findHeaderRow(sheet.rows);
    const header = h >= 0 ? sheet.rows[h] : [];
    const col = Object.fromEntries(FIELDS.map((f) => [f, mapping[f] ? header.indexOf(mapping[f]) : -1]));
    const cell = (row, f) => (col[f] >= 0 ? String(row[col[f]] ?? '').trim() : '');
    const body = sheet.rows.slice(h + 1);

    if (layout === 'sheets') {
      // The sheet is the customer: its name (or a name column, if the sheet has one), titles down the rows.
      const named = body.find((r) => cell(r, 'name') || cell(r, 'first_name'));
      const person = named
        ? { ...splitName(cell(named, 'name')), ...(cell(named, 'first_name') ? { first_name: cell(named, 'first_name'), last_name: cell(named, 'last_name') || null } : {}) }
        : splitName(sheet.name);
      const email = body.map((r) => cell(r, 'email')).find(Boolean) || null;
      const phone = body.map((r) => cell(r, 'phone')).find(Boolean) || null;
      const ref = addCustomer({
        ...person, email, phone,
        mature_ok: body.some((r) => isYes(cell(r, 'mature'))),
        no_email: body.some((r) => isYes(cell(r, 'no_email'))),
      });
      if (!ref) continue;
      const titleCol = col.title >= 0 ? col.title : 0; // a sheet with no header is just a list of titles
      for (const r of body) {
        const t = String(r[titleCol] ?? '').trim();
        if (t && !(h < 0 && guessColumns([t]).title !== undefined)) addLine(ref, t, cell(r, 'quantity'), cell(r, 'notes'));
      }
      continue;
    }

    if (col.title < 0) {
      problems.push('Choose which column holds the titles.');
      break;
    }
    body.forEach((r, i) => {
      const titleCell = cell(r, 'title');
      const split = cell(r, 'first_name')
        ? { first_name: cell(r, 'first_name'), last_name: cell(r, 'last_name') || null }
        : splitName(cell(r, 'name'));
      const c = {
        ...split,
        email: cell(r, 'email') || null,
        phone: cell(r, 'phone') || null,
        mature_ok: isYes(cell(r, 'mature')),
        no_email: isYes(cell(r, 'no_email')),
      };
      const ref = addCustomer(c);
      if (!ref) {
        if (titleCell) problems.push(`Row ${h + i + 2}: no customer name, email or phone, so its titles were left out.`);
        return;
      }
      const titles = layout === 'cell' ? splitTitles(titleCell) : [titleCell].filter(Boolean);
      // In the one-cell layout a quantity column can't say which title it is for: quantities come from "x2".
      for (const t of titles) addLine(ref, t, layout === 'cell' && titles.length > 1 ? '' : cell(r, 'quantity'), cell(r, 'notes'));
    });
  }

  const out = [...customers.values()].map((c) => {
    const flags = [];
    let email = c.email ? c.email.trim() : null;
    if (email && !looksLikeEmail(email)) {
      flags.push('bad_email');
      email = null;
    }
    const phone = c.phone ? c.phone.trim() : null;
    if (!email && !phone) flags.push('no_contact');
    if (!c.first_name) flags.push('no_name');
    return {
      ref: c.ref,
      first_name: c.first_name ? c.first_name.slice(0, 80) : null,
      last_name: c.last_name ? c.last_name.slice(0, 80) : null,
      email: email ? email.slice(0, 254) : null,
      phone: phone ? phone.slice(0, 40) : null,
      mature_ok: !!c.mature_ok,
      no_email: !!c.no_email,
      flags,
    };
  });
  // Customers with no titles at all are left out (an address list, a blank row with only a name).
  const withLines = new Set(lines.map((l) => l.customer_ref));
  return { customers: out.filter((c) => withLines.has(c.ref)), lines, problems };
}

/** The review's counts. lines carry status: matched | review | not_found | skipped. */
export function summarise(customers, lines) {
  const by = (s) => lines.filter((l) => l.status === s).length;
  return {
    customers: customers.length,
    new: customers.filter((c) => !c.customer_id).length,
    existing: customers.filter((c) => c.customer_id).length,
    flagged: customers.filter((c) => c.flags?.includes('no_contact')).length,
    lines: lines.length,
    matched: by('matched'),
    review: by('review'),
    not_found: by('not_found'),
    skipped: by('skipped'),
  };
}

// The sample CSV: one row per customer and title, every column the importer reads.
export const SAMPLE_HEADER = ['Customer name', 'Email', 'Phone', 'Title', 'Quantity', 'Notes', 'Mature OK', 'No email'];
export const SAMPLE_ROWS = [
  ['Jane Smith', 'jane@example.com', '(555) 123-4567', 'Starfall Rangers', '1', 'Cover A only', '', ''],
  ['Jane Smith', 'jane@example.com', '(555) 123-4567', 'Night Harbor x2', '', '', 'Y', ''],
  ['Sam Lee', 'sam@example.com', '', 'Absolute Batman', '2', '', '', ''],
  ['Sam Lee', 'sam@example.com', '', 'Starfal Rangers', '1', 'Misspelt on purpose: shows a close match', '', ''],
  ['Pat Jones', '', '555-987-6543', 'The Lantern Keeper', '1', '', '', 'Y'],
  ['Walk-in Wendy', '', '', 'Saga', '1', 'No email or phone: allowed, but flagged', '', ''],
];

/** Skipped and not-found lines as CSV rows (for downloadCsv), with who they were for. */
export function leftOverRows(customers, lines) {
  const who = new Map(customers.map((c) => [c.ref, c]));
  return lines
    .filter((l) => l.status === 'skipped' || l.status === 'not_found')
    .map((l) => {
      const c = who.get(l.customer_ref) ?? {};
      return [[c.first_name, c.last_name].filter(Boolean).join(' '), c.email ?? '', c.phone ?? '', l.raw_title, String(l.raw_quantity ?? 1), l.raw_notes ?? '', l.status === 'skipped' ? 'Skipped' : 'Not found'];
    });
}
export const LEFT_OVER_HEADER = ['Customer name', 'Email', 'Phone', 'Title', 'Quantity', 'Notes', 'Why'];
