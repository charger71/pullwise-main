// Unit tests for admin/pull-import.js: column guessing, layout detection, title splitting, quantity stripping, names
// and building customers and lines from each layout. Run: node admin/pull-import.test.js
import assert from 'node:assert/strict';
import {
  guessColumns, findHeaderRow, splitTitles, stripQuantity, splitName, isYes, detectLayout, describeColumns,
  customerRef, buildImport, summarise, leftOverRows, readSheets, SAMPLE_HEADER, SAMPLE_ROWS,
} from './pull-import.js';

let failures = 0;
const test = (name, fn) => {
  try {
    fn();
  } catch (e) {
    failures++;
    console.error(`FAIL ${name}\n  ${String(e.message).split('\n').join('\n  ')}`);
  }
};

// ---- Columns -------------------------------------------------------------------------------------------------------
test('guesses columns from common headers', () => {
  assert.deepEqual(guessColumns(['Customer', 'E-mail', 'Phone #', 'Series', 'Qty', 'Notes', 'Mature OK', 'No Email']),
    { name: 0, email: 1, phone: 2, title: 3, quantity: 4, notes: 5, mature: 6, no_email: 7 });
});
test('"No email" and "Opt out" are not the email column', () => {
  const g = guessColumns(['Email Opt Out', 'Customer Email', 'Name']);
  assert.equal(g.no_email, 0);
  assert.equal(g.email, 1);
  assert.equal(g.name, 2);
});
test('first and last name columns, and words inside longer headers', () => {
  assert.deepEqual(guessColumns(['First Name', 'Surname', 'Mobile', 'Pull List Titles', 'Copies']),
    { first_name: 0, last_name: 1, phone: 2, title: 3, quantity: 4 });
});
test('a full name next to first and last keeps the split ones', () => {
  const g = guessColumns(['Name', 'First', 'Last', 'Title']);
  assert.equal(g.name, undefined);
  assert.equal(g.first_name, 1);
  assert.equal(g.last_name, 2);
});
test('unknown headers are left out', () => {
  assert.deepEqual(guessColumns(['Store', 'Date joined', '']), {});
});
test('finds the header row under a title line', () => {
  assert.equal(findHeaderRow([['Pull lists, March'], [], ['Name', 'Title'], ['Jane', 'Saga']]), 2);
  assert.equal(findHeaderRow([['Saga'], ['Spawn']]), -1);
});

// ---- Titles and quantities -----------------------------------------------------------------------------------------
test('splits a cell of titles on new lines, commas and semicolons', () => {
  assert.deepEqual(splitTitles('Saga\nSpawn; Absolute Batman,  Night Harbor x2\r\n'), ['Saga', 'Spawn', 'Absolute Batman', 'Night Harbor x2']);
  assert.deepEqual(splitTitles(''), []);
});
test('strips a trailing quantity', () => {
  const cases = {
    'Saga x2': ['Saga', 2], 'Saga x 2': ['Saga', 2], 'Saga X3': ['Saga', 3], 'Saga ×2': ['Saga', 2], 'Saga *2': ['Saga', 2],
    'Saga (x2)': ['Saga', 2], 'Saga - 2 copies': ['Saga', 2], 'Saga 2 copies': ['Saga', 2], 'Saga 1 copy': ['Saga', 1],
    'Saga qty 4': ['Saga', 4], 'Saga Qty: 4': ['Saga', 4], 'Saga 2x': ['Saga', 2], 'Saga (2x)': ['Saga', 2], 'Saga x500': ['Saga', 100],
  };
  for (const [input, [title, quantity]] of Object.entries(cases)) assert.deepEqual(stripQuantity(input), { title, quantity }, input);
});
test('leaves issue numbers, years and names alone', () => {
  for (const t of ['Batman 2025', 'Spawn #350', 'X-Men 92', 'Spider-Man 2099', 'Spider-Man 2099x', 'Batman x Superman', 'Saga x0', 'x2', 'Gen 13', 'Batman (2016)']) {
    assert.deepEqual(stripQuantity(t), { title: t, quantity: null }, t);
  }
});

// ---- People ----------------------------------------------------------------------------------------------------------
test('splits names', () => {
  assert.deepEqual(splitName('Jane Smith'), { first_name: 'Jane', last_name: 'Smith' });
  assert.deepEqual(splitName('Smith, Jane'), { first_name: 'Jane', last_name: 'Smith' });
  assert.deepEqual(splitName('Mary Ann  Smith'), { first_name: 'Mary Ann', last_name: 'Smith' });
  assert.deepEqual(splitName('Prince'), { first_name: 'Prince', last_name: null });
  assert.deepEqual(splitName(''), { first_name: null, last_name: null });
});
test('yes values', () => {
  for (const v of ['Y', 'yes', 'TRUE', '1', 'x', '✓']) assert.ok(isYes(v), v);
  for (const v of ['', 'N', 'no', '0', 'maybe']) assert.ok(!isYes(v), v);
});
test('customer refs: email, then phone digits, then name', () => {
  assert.equal(customerRef({ email: 'Jane@Example.com', phone: '555 123 4567' }), 'e:jane@example.com');
  assert.equal(customerRef({ phone: '+1 (555) 123-4567' }), 'p:5551234567');
  assert.equal(customerRef({ first_name: 'Jane', last_name: 'Smith' }), 'n:jane smith');
  assert.equal(customerRef({}), null);
});

// ---- Layouts ---------------------------------------------------------------------------------------------------------
const rowsSheet = { name: 'Sheet1', rows: [['Customer name', 'Email', 'Phone', 'Title', 'Quantity', 'Notes', 'Mature OK', 'No email'],
  ['Jane Smith', 'jane@example.com', '555-123-4567', 'Saga', '', 'Cover A', '', ''],
  ['Jane Smith', 'JANE@example.com', '', 'Night Harbor x2', '', '', 'Y', ''],
  ['Sam Lee', '', '555 987 6543', 'Spawn', '3', '', '', 'yes'],
  ['', '', '', 'Orphan title', '', '', '', ''],
  ['Walk In', '', '', 'Saga', '', '', '', '']] };
const cellSheet = { name: 'Pulls', rows: [['Name', 'Email', 'Titles'],
  ['Jane Smith', 'jane@example.com', 'Saga\nNight Harbor x2\nSpawn'],
  ['Sam Lee', 'sam@example.com', 'Absolute Batman; Spawn'],
  ['Pat Jones', 'pat@example.com', 'Saga']] };
const perCustomer = [
  { name: 'Jane Smith', rows: [['Title', 'Qty'], ['Saga', '1'], ['Night Harbor', '2']] },
  { name: 'Smith, Bob', rows: [['Spawn'], ['Saga x3']] },
];

test('detects each layout', () => {
  assert.equal(detectLayout([rowsSheet]), 'rows');
  assert.equal(detectLayout([cellSheet]), 'cell');
  assert.equal(detectLayout(perCustomer), 'sheets');
  assert.equal(detectLayout([{ name: 'Jane', rows: [['Saga'], ['Spawn']] }]), 'sheets');
});
test('describes columns across sheets and guesses the mapping by header text', () => {
  const { headers, mapping } = describeColumns([rowsSheet]);
  assert.equal(headers.length, 8);
  assert.deepEqual(mapping, { name: 'Customer name', email: 'Email', phone: 'Phone', title: 'Title', quantity: 'Quantity', notes: 'Notes', mature: 'Mature OK', no_email: 'No email' });
});

test('one row per customer and title', () => {
  const { mapping } = describeColumns([rowsSheet]);
  const { customers, lines, problems } = buildImport([rowsSheet], mapping, 'rows');
  assert.equal(customers.length, 3);
  const jane = customers.find((c) => c.ref === 'e:jane@example.com');
  assert.deepEqual({ ...jane }, { ref: 'e:jane@example.com', first_name: 'Jane', last_name: 'Smith', email: 'jane@example.com', phone: '555-123-4567', mature_ok: true, no_email: false, flags: [] });
  const sam = customers.find((c) => c.ref === 'p:5559876543');
  assert.equal(sam.no_email, true);
  assert.deepEqual(customers.find((c) => c.ref === 'n:walk in').flags, ['no_contact']);
  assert.deepEqual(lines.filter((l) => l.customer_ref === jane.ref).map((l) => [l.position, l.raw_title, l.raw_quantity, l.raw_notes]),
    [[1, 'Saga', 1, 'Cover A'], [2, 'Night Harbor', 2, null]]);
  assert.equal(lines.find((l) => l.customer_ref === sam.ref).raw_quantity, 3, 'quantity column');
  assert.equal(problems.length, 1, 'the row with no customer');
  assert.match(problems[0], /^Row 5:/);
});
test('the quantity column wins over "x2"', () => {
  const sheet = { name: 'S', rows: [['Name', 'Email', 'Title', 'Qty'], ['Jo', 'jo@example.com', 'Saga x2', '5']] };
  const { lines } = buildImport([sheet], describeColumns([sheet]).mapping, 'rows');
  assert.deepEqual([lines[0].raw_title, lines[0].raw_quantity], ['Saga', 5]);
});
test('one row per customer, titles in one cell', () => {
  const { customers, lines } = buildImport([cellSheet], describeColumns([cellSheet]).mapping, 'cell');
  assert.equal(customers.length, 3);
  assert.deepEqual(lines.filter((l) => l.customer_ref === 'e:jane@example.com').map((l) => [l.raw_title, l.raw_quantity]),
    [['Saga', 1], ['Night Harbor', 2], ['Spawn', 1]]);
  assert.equal(lines.length, 6);
});
test('one sheet per customer', () => {
  const { customers, lines } = buildImport(perCustomer, describeColumns(perCustomer).mapping, 'sheets');
  assert.deepEqual(customers.map((c) => [c.ref, c.first_name, c.last_name, c.flags]),
    [['n:jane smith', 'Jane', 'Smith', ['no_contact']], ['n:bob smith', 'Bob', 'Smith', ['no_contact']]]);
  assert.deepEqual(lines.map((l) => [l.customer_ref, l.raw_title, l.raw_quantity]),
    [['n:jane smith', 'Saga', 1], ['n:jane smith', 'Night Harbor', 2], ['n:bob smith', 'Spawn', 1], ['n:bob smith', 'Saga', 3]]);
});
test('a bad email is flagged and left out', () => {
  const sheet = { name: 'S', rows: [['Name', 'Email', 'Phone', 'Title'], ['Jo Doe', 'jo at example', '555 222 3333', 'Saga']] };
  const { customers } = buildImport([sheet], describeColumns([sheet]).mapping, 'rows');
  assert.equal(customers[0].email, null);
  assert.deepEqual(customers[0].flags, ['bad_email']);
});
test('no title column is a problem, not a crash', () => {
  const sheet = { name: 'S', rows: [['Name', 'Email'], ['Jo', 'jo@example.com']] };
  const { customers, problems } = buildImport([sheet], describeColumns([sheet]).mapping, 'rows');
  assert.equal(customers.length, 0);
  assert.deepEqual(problems, ['Choose which column holds the titles.']);
});

// ---- Review helpers --------------------------------------------------------------------------------------------------
test('summary counts and the left-over CSV', () => {
  const customers = [{ ref: 'a', first_name: 'Jo', last_name: 'Doe', email: 'jo@example.com', customer_id: 4, flags: [] }, { ref: 'b', first_name: 'Al', flags: ['no_contact'] }];
  const lines = [
    { customer_ref: 'a', raw_title: 'Saga', raw_quantity: 1, status: 'matched' },
    { customer_ref: 'a', raw_title: 'Zzyzx', raw_quantity: 2, raw_notes: 'odd', status: 'not_found' },
    { customer_ref: 'b', raw_title: 'Spawn', raw_quantity: 1, status: 'skipped' },
    { customer_ref: 'b', raw_title: 'Sagga', raw_quantity: 1, status: 'review' },
  ];
  assert.deepEqual(summarise(customers, lines), { customers: 2, new: 1, existing: 1, flagged: 1, lines: 4, matched: 1, review: 1, not_found: 1, skipped: 1 });
  assert.deepEqual(leftOverRows(customers, lines), [
    ['Jo Doe', 'jo@example.com', '', 'Zzyzx', '2', 'odd', 'Not found'],
    ['Al', '', '', 'Spawn', '1', '', 'Skipped'],
  ]);
});
test('the sample CSV reads back as the one-row-per-title layout, every column guessed', () => {
  const sheet = { name: 'sample', rows: [SAMPLE_HEADER, ...SAMPLE_ROWS] };
  assert.equal(detectLayout([sheet]), 'rows');
  const { mapping } = describeColumns([sheet]);
  assert.deepEqual(Object.keys(mapping).sort(), ['email', 'mature', 'name', 'no_email', 'notes', 'phone', 'quantity', 'title']);
  const { customers, lines } = buildImport([sheet], mapping, 'rows');
  assert.equal(customers.length, 4);
  assert.equal(lines.length, 6);
  assert.deepEqual(customers.find((c) => c.first_name === 'Walk-in').flags, ['no_contact']);
});
test('readSheets: every non-empty sheet, cells as trimmed text', () => {
  const XLSX = {
    read: () => ({ SheetNames: ['A', 'Empty', 'B'], Sheets: { A: 'a', Empty: 'e', B: 'b' } }),
    utils: { sheet_to_json: (s) => ({ a: [[' Name ', 3], ['Jo', null]], e: [['', '']], b: [['Saga']] })[s] },
  };
  assert.deepEqual(readSheets(new Uint8Array(), XLSX), [{ name: 'A', rows: [['Name', '3'], ['Jo', '']] }, { name: 'B', rows: [['Saga']] }]);
});

if (failures) {
  console.error(`\n${failures} pull import test${failures === 1 ? '' : 's'} failed`);
  process.exit(1);
}
console.log('pull import tests passed');
