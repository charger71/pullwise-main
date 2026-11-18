// Import: drop distributor sheets (Lunar/PRH FOC or release sheets, Funko
// lists) or any spreadsheet with recognisable column headers, preview what will change, then import. Same parsing rules
// (js/import/distributors.js) and database logic (js/import/apply.js) as the
// command-line importer; covers from other sites come via the fetch-cover
// Edge Function because browsers can't read them directly.

import { readWorkbook, parseSheet } from '../../js/import/distributors.js';
import { planImport, applyImport, logImport } from '../../js/import/apply.js';
import { $, esc, must, setStatus, toast, fmtDate, loadScript, solidIcon, friendlyError, setupTabs, hintFold, uid, downloadCsv, loadRunLog, hintSlot } from '../lib.js';
import { processImage } from '../images.js';
import { tally } from '../../js/util.js';
import { todayIn, addDays } from '../../js/dates.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, IS_CATALOG } from '../../js/config.js';
import { mountPullLists, pullImportBusy } from './import-pull-lists.js';

const SOURCE = { lunar: 'Lunar', prh: 'PRH', funko: 'Funko', sheet: 'Spreadsheet' };
const FIELD_LABEL = {
  title: 'Title', issue: 'Issue #', variant: 'Variant', publisher: 'Publisher', price: 'Price', foc: 'Order cutoff', release: 'Release date',
  upc: 'UPC', isbn: 'ISBN', sku: 'SKU', creators: 'Creators', artist: 'Artist', description: 'Description', category: 'Category',
  mature: 'Mature', quantity: 'Quantity', image: 'Cover image',
};
let sb;
let settings;
let libs;
let busy = false;
export const hasUnsavedChanges = () => busy || pullImportBusy();

/** SheetJS (ES module) and JSZip (classic script) on first use. */
async function loadLibs() {
  if (libs) return libs;
  const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs');
  if (!window.JSZip) {
    await loadScript('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js', 'Couldn’t load the spreadsheet reader');
  }
  return (libs = { XLSX, JSZip: window.JSZip });
}

const shopToday = () => todayIn(settings.timezone);

export async function mount(el, ctx) {
  sb = ctx.sb;
  settings = await must(sb.from('settings').select('timezone').eq('id', 1).single());
  el.innerHTML = `
    <h1>Import</h1>
    ${hintSlot()}
    <div class="admin-tabs" role="tablist">
      <button type="button" class="admin-tab" role="tab" data-tab="files">Import Files</button>
      <button type="button" class="admin-tab" role="tab" data-tab="pulls">Pull Lists</button>
      <button type="button" class="admin-tab" role="tab" data-tab="skip">Always Skip</button>
      <button type="button" class="admin-tab" role="tab" data-tab="runs">Recent Runs</button>
    </div>
    <div data-tabpane="files">
    <label class="dropzone" for="import-files">
      <input id="import-files" type="file" accept=".xlsx,.xlsm,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" multiple class="visually-hidden">
      <strong>Choose spreadsheets</strong> or drop them here
    </label>
    <div class="admin-actions">
      <button class="btn btn--ghost" type="button" data-sample>${solidIcon('download', 16)} Download sample CSV</button>
      <span class="card__meta">Every column the importer reads, with one made-up title per category</span>
    </div>
    <div data-files></div>
    ${IS_CATALOG ? `<section class="fold fold--compact fold--static" data-daily>
      <div class="fold__head"><h2>Daily imports</h2> <span class="card__meta">PRH and Lunar run by themselves every morning; run one now to pick up changes sooner</span></div>
      <div class="fold__body">
        ${Object.entries(DAILY).map(([source, name]) => `<div class="admin-actions">
          <button class="btn btn--ghost" type="button" data-run="${source}">Run ${name} import now</button>
          <span class="card__meta" data-run-state="${source}" role="status">Checking…</span>
        </div>`).join('')}
      </div>
    </section>` : ''}
    </div>
    <div data-tabpane="pulls"></div>
    <div data-tabpane="skip">
    <section class="fold fold--compact fold--static exclusions" data-exclusions>
      <div class="fold__head"><h2>Always Skip</h2> <span class="card__meta" data-exclusion-count>Publishers, series, title words or mature titles to leave out of every import</span></div>
      <div class="fold__body">
      <div data-exclusion-lists class="exclusions__chips"></div>
      <form class="exclusions__form" data-exclusion-form>
        <select name="kind" aria-label="What to skip"><option value="publisher">Publisher</option><option value="series">Series</option><option value="keyword">Word in title</option></select>
        <input name="value" type="text" maxlength="200" required aria-label="Name" placeholder="e.g. Avatar Press">
        <button class="btn btn--add" type="submit">${solidIcon('add', 18)} Add</button>
        <label class="exclusions__mature"><input type="checkbox" data-mature> Skip all mature (MR)</label>
        <span class="admin-status" role="status"></span>
      </form>
      </div>
    </section>
    </div>
    <div data-tabpane="runs">
      <div data-log></div>
    </div>`;
  const input = $('#import-files', el);
  const zone = $('.dropzone', el);
  input.addEventListener('change', () => addFiles(el, input.files));
  zone.addEventListener('dragover', (e) => (e.preventDefault(), zone.classList.add('is-over')));
  zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('is-over');
    addFiles(el, e.dataTransfer.files);
  });
  $('[data-sample]', el).addEventListener('click', downloadSample);
  setupTabs(el, 'admin-import-tab', 'files', undefined, {
    files: `Drop in this week's sheets as downloaded: Lunar or PRH FOC sheets, Lunar or PRH release sheets, or a Funko pre-order list. Any other spreadsheet (.xlsx, .xls or .csv) works too if it has a header row with a <strong>Title</strong> (or Name / Product) column and details such as Price, UPC, ISBN, SKU, Publisher, Release date or FOC date — pictures in the sheet become covers. You'll see what will change before anything is saved. New titles come in with their collector badges ticked when the title says so: <strong>First Issue</strong> (#1), <strong>One-Shot</strong>, <strong>Limited Series</strong> (“#2 (of 6)”), <strong>Facsimile</strong> and <strong>Blind Bag</strong>. Incentive covers and retailer bundles are always skipped, plus anything on the list below.`,
    pulls: `For a shop moving to Pullwise: one spreadsheet of your customers and the series each one takes (.xlsx, .xls or .csv). It can have one row per customer and title, one row per customer with all their titles in one cell, or one sheet per customer named after them — download the sample to see the columns. Check which column holds what, then every title is matched to a series: <strong>Matched</strong> lines are ready, <strong>Needs a look</strong> lines offer the closest series to choose from, and <strong>Not found</strong> lines can be searched for, added to the series catalog or skipped. Each choice is remembered, so the same spelling matches by itself next time. Customers already in Pullwise (same email, or same phone) are updated, never added twice, and keep the follows they have. Nothing is saved until you press <strong>Save</strong>; you can leave a review and resume it from Drafts. Saving adds each customer's follows and puts the titles open for pre-order now on their pull list (mature titles only for customers marked Mature OK). It sends no email.`,
  });
  mountExclusions(el);
  if (IS_CATALOG) mountDaily(el);
  mountPullLists($('[data-tabpane="pulls"]', el), { sb, onLog: () => loadLog(el) });
  loadLog(el);
}

// Sample sheet: the header names parseGeneric() recognises (js/import/distributors.js) and one made-up title for each
// category, so its Category words land on every category. Dates are counted from today so the sheet stays current.
const SAMPLE_HEADER = ['Title', 'Issue', 'Variant', 'Publisher', 'Category', 'Price', 'FOC Date', 'Release Date', 'UPC', 'ISBN', 'SKU', 'Creators', 'Artist', 'Description', 'Mature', 'Qty', 'Cover URL'];

function downloadSample() {
  const day = (n) => addDays(shopToday(), n);
  const rows = [
    ['Starfall Rangers', '1', 'Cover A', 'Image Comics', 'Comic', '3.99', day(14), day(42), '700000000011', '', 'SAMPLE-0001', 'Jane Doe', 'Ana Lima', 'A first issue: the new title comes in with its First Issue badge ticked.', 'N', '10', ''],
    ['Starfall Rangers', '1', 'Cover B Variant', 'Image Comics', 'Comic', '4.99', day(14), day(42), '700000000028', '', 'SAMPLE-0002', 'Jane Doe', 'Ray Okafor', 'A second cover of the same issue, listed as its own title.', 'N', '4', ''],
    ['Night Harbor', '2 (of 6)', '', 'Dark Horse Comics', 'Comic', '3.99', day(14), day(42), '700000000035', '', 'SAMPLE-0003', 'Sam Reyes', 'Mia Chen', 'Issue 2 of a six-issue limited series, rated mature.', 'Y', '6', ''],
    ['The Lantern Keeper One-Shot', '', '', 'BOOM! Studios', 'Comic', '5.99', day(7), day(35), '700000000042', '', 'SAMPLE-0004', 'Lee Park', 'Lee Park', 'A one-shot: no issue number needed.', 'N', '3', ''],
    ['Starfall Rangers Vol. 1', '', '', 'Image Comics', 'Trade Paperback', '16.99', day(21), day(56), '', '9798000000011', 'SAMPLE-0005', 'Jane Doe', 'Ana Lima', 'Collects issues 1–5. Trades, hardcovers, graphic novels and manga go under Trades.', 'N', '2', ''],
    ['Night Harbor Omnibus', '', 'Hardcover', 'Dark Horse Comics', 'Omnibus', '99.99', day(28), day(70), '', '9798000000028', 'SAMPLE-0006', 'Sam Reyes', 'Mia Chen', 'The whole series in one book.', 'Y', '1', ''],
    ['Pop! Starfall Ranger Captain', '', 'Glow in the Dark', 'Funko', 'Funko Pop', '14.99', day(30), day(90), '700000000059', '', 'SAMPLE-0007', '', '', 'A vinyl figure.', 'N', '6', ''],
    ['Starfall Rangers Action Figure', '', '', 'McFarlane Toys', 'Toy', '24.99', day(30), day(90), '700000000066', '', 'SAMPLE-0008', '', '', 'Figures, statues, plush and building sets go under Toys.', 'N', '2', ''],
    ['Starfall Rangers Original Soundtrack', '', 'Blue Vinyl', 'Mondo', 'Vinyl Record', '34.99', '', day(60), '700000000073', '', 'SAMPLE-0009', '', '', 'Records and albums.', 'N', '2', ''],
    ['Cosmic Heroes 2027 Wall Calendar', '', '', 'Marvel', 'Other', '17.99', '', day(28), '700000000080', '', 'SAMPLE-0010', '', '', 'Anything else: calendars, games, stationery.', 'N', '', ''],
  ];
  downloadCsv('import-titles-sample.csv', SAMPLE_HEADER, rows);
}

let exclusions = [];

async function loadExclusions() {
  exclusions = await must(sb.from('import_exclusions').select('id,kind,value').order('value'));
  return exclusions;
}

async function mountExclusions(el) {
  const box = $('[data-exclusions]', el);
  const status = $('[data-exclusion-form] .admin-status', box);
  const draw = () => {
    $('[data-mature]', box).checked = exclusions.some((r) => r.kind === 'mature');
    const rules = exclusions.filter((r) => r.kind !== 'mature');
    $('[data-exclusion-count]', box).textContent = rules.length ? `${rules.length} ${rules.length === 1 ? 'rule' : 'rules'}` : 'Publishers, series, title words or mature titles to leave out of every import';
    const KIND = { publisher: 'Publisher', series: 'Series', keyword: 'Word' };
    $('[data-exclusion-lists]', box).innerHTML = rules
      .map((r) => `<span class="exclusions__chip"><small>${KIND[r.kind]}</small> ${esc(r.value)} <button type="button" class="icon-btn icon-btn--remove icon-btn--sm" data-remove="${r.id}" aria-label="Remove ${esc(r.value)}" title="Remove">${solidIcon('remove', 18)}</button></span>`)
      .join('');
  };
  const act = async (fn, okText) => {
    try {
      await fn();
      await loadExclusions();
      draw();
      setStatus(status, okText, 'ok');
    } catch (err) {
      setStatus(status, friendlyError(err), 'error');
    }
  };
  try {
    await loadExclusions();
  } catch (err) {
    setStatus(status, `Couldn’t load the list: ${friendlyError(err)}`, 'error');
  }
  draw();
  $('[data-mature]', box).addEventListener('change', (e) =>
    act(
      () => must(e.target.checked ? sb.from('import_exclusions').insert({ kind: 'mature', value: '' }) : sb.from('import_exclusions').delete().eq('kind', 'mature')),
      e.target.checked ? 'Mature titles will be skipped.' : 'Mature titles will be imported.',
    ),
  );
  $('[data-exclusion-lists]', box).addEventListener('click', (e) => {
    const id = e.target.closest('[data-remove]')?.dataset.remove;
    if (!id) return;
    const rule = exclusions.find((r) => String(r.id) === id);
    if (!confirm(`Remove ${rule ? `“${rule.value}”` : 'this rule'} from the import exclusions? Matching titles will be imported again.`)) return;
    act(() => must(sb.from('import_exclusions').delete().eq('id', id)), 'Removed.');
  });
  $('[data-exclusion-form]', box).addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const value = f.value.value.trim();
    if (!value) return;
    if (exclusions.some((r) => r.kind === f.kind.value && r.value.toLowerCase() === value.toLowerCase())) return setStatus(status, 'Already on the list.', 'error');
    act(async () => {
      await must(sb.from('import_exclusions').insert({ kind: f.kind.value, value }));
      f.value.value = '';
    }, 'Added. It applies to sheets you drop in from now on.');
  });
}

async function addFiles(el, fileList) {
  const box = $('[data-files]', el);
  for (const file of fileList) {
    const card = document.createElement('section');
    card.className = 'import-card panel';
    card.innerHTML = `<h2>${esc(file.name)}</h2><p class="admin-status" role="status">Reading…</p>`;
    box.prepend(card);
    try {
      const { XLSX, JSZip } = await loadLibs();
      const book = await readWorkbook(new Uint8Array(await file.arrayBuffer()), { XLSX, JSZip });
      const parsed = parseSheet(book.rows, { today: shopToday(), exclusions: await loadExclusions() });
      await preview(el, card, file.name, parsed, book);
    } catch (err) {
      card.innerHTML = `<h2>${esc(file.name)}</h2><p class="form-error">Couldn’t read this file: ${esc(friendlyError(err))}</p>`;
    }
  }
}

// A Lunar or PRH sheet whose headers changed: columns read under another name, and ones it doesn't have.
function columnNotes({ columnsRenamed = [], columnsMissing = [] }) {
  const quoted = (list) => list.map((h) => `“${esc(h)}”`);
  const or = (list) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} or ${list.at(-1)}` : list[0]);
  const missing = columnsMissing.length
    ? `<p class="notice">This sheet has no ${or(quoted(columnsMissing))} ${columnsMissing.length === 1 ? 'column' : 'columns'}. Titles already imported keep what they have for ${columnsMissing.length === 1 ? 'it' : 'them'}; new titles come in without.</p>`
    : '';
  const renamed = columnsRenamed.length
    ? `<p class="admin-hint">Read ${columnsRenamed.map((r) => `“${esc(r.header)}” as ${esc(r.label)}`).join(', ')}.</p>`
    : '';
  return missing + renamed;
}

async function preview(el, card, name, parsed, book) {
  const today = shopToday();
  const render = async (onSale) => {
    const items = onSale ? parsed.items.map((i) => ({ ...i, release_date: onSale })) : parsed.items;
    const { fresh, known, duplicates, upcClashes } = await planImport(sb, { ...parsed, items });
    const go = $('[data-go]', card);
    if (!go.disabled) go.textContent = `Import ${fresh.length + known.length} ${fresh.length + known.length === 1 ? 'title' : 'titles'}`;
    const released = fresh.filter((i) => i.release_date && i.release_date <= today).length;
    const onSaleDates = tally(items.map((i) => i.release_date ?? 'no date')).slice(0, 6);
    $('[data-summary]', card).innerHTML = `
      <ul class="import-stats">
        <li><strong>${fresh.length}</strong> new</li>
        <li><strong>${known.length}</strong> already imported (prices, dates and descriptions refreshed)</li>
        <li><strong>${parsed.skipped.length}</strong> skipped</li>
        ${duplicates.length ? `<li><strong>${duplicates.length}</strong> left out — UPC or ISBN already on another title</li>` : ''}
        ${upcClashes.length ? `<li><strong>${upcClashes.length}</strong> keep their UPC — the sheet's is on another title</li>` : ''}
      </ul>
      ${duplicates.length ? `<details>
        <summary>${duplicates.length} already in the catalog under another listing</summary>
        <ul class="skipped">${duplicates.map((d) => `<li>${esc(d.title)}${d.issue_number ? ` #${esc(d.issue_number)}` : ''} <span class="card__meta">— ${d.upc && d.existingTitle.upc === d.upc ? `UPC ${esc(d.upc)}` : `ISBN ${esc(d.isbn)}`} is “${esc(d.existingTitle.title)}${d.existingTitle.issue_number ? ` #${esc(d.existingTitle.issue_number)}` : ''}”</span>
        </li>`).join('')}</ul>
        </details>` : ''}
      ${released ? `<p class="notice">${released} new ${released === 1 ? 'title is' : 'titles are'} already out, so ${released === 1 ? 'it goes' : 'they go'} straight to New Arrivals.</p>` : ''}
      <p class="card__meta">On sale: ${onSaleDates.map(([d, n]) => `${n} × ${d === 'no date' ? 'no date' : fmtDate(d, { month: 'short', day: 'numeric' })}`).join(', ')}</p>
      <p class="card__meta">Categories: ${tally(items.map((i) => i.category ?? 'none')).map(([c, n]) => `${n} ${c}`).join(', ')}</p>`;
  };

  const n = uid('f');
  card.innerHTML = `
    <div class="admin-title-row"><h2>${esc(name)}</h2><span class="pill">${SOURCE[parsed.source ?? parsed.distributor] ?? parsed.distributor}</span></div>
    <div data-summary><p class="admin-hint">Checking what's already imported…</p></div>
    ${columnNotes(parsed)}
    ${parsed.columnsUsed ? `<details><summary>Columns used</summary><ul class="skipped">${Object.entries(parsed.columnsUsed).map(([f, h]) => `<li><strong>${esc(FIELD_LABEL[f] ?? f)}</strong> ← “${esc(h)}”</li>`).join('')}${parsed.ignored.length ? `<li class="card__meta">Not used: ${parsed.ignored.map((h) => `“${esc(h)}”`).join(', ')}</li>` : ''}</ul></details>` : ''}
    ${parsed.skipped.length ? `<details><summary>${parsed.skipped.length} skipped ${parsed.skipped.length === 1 ? 'title' : 'titles'}</summary><div><ul class="skipped">${parsed.skipped.map((s) => `<li>${esc(s.title)} <span class="card__meta">— ${esc(s.reason)}</span></li>`).join('')}</ul></div></details>` : ''}
    <div class="form-grid form-grid--pairs import-options">
      <div class="field span-2"><label for="onsale-${n}">Shop on-sale day (optional)</label>
        <input id="onsale-${n}" type="date" data-onsale>
        <p class="field__hint">Use for release sheets when your new-release day differs from the distributor's date.</p></div>
    </div>
    <div class="admin-actions import-actions">
      <button class="btn btn--primary" type="button" data-go>Import ${parsed.items.length} titles</button>
      <button class="btn btn--ghost" type="button" data-cancel>Remove</button>
      <span class="admin-status" role="status"></span>
    </div>`;
  const onSaleInput = $('[data-onsale]', card);
  onSaleInput.addEventListener('change', () => render(onSaleInput.value || null));
  $('[data-cancel]', card).addEventListener('click', () => card.remove());
  $('[data-go]', card).addEventListener('click', () => run(el, card, name, parsed, book, onSaleInput.value || null));
  await render(null);
}

async function run(el, card, name, parsed, book, onSale) {
  const status = $('.admin-actions .admin-status', card);
  const go = $('[data-go]', card);
  // One import at a time: two sheets writing at once could both insert the same new titles.
  if (busy) return setStatus(status, 'Another import is still running. Import this one when it has finished.', 'error');
  go.disabled = true;
  $('[data-cancel]', card).disabled = true;
  busy = true;
  let result;
  try {
    const summary = await applyImport(sb, parsed, {
      images: book.images,
      imagesByRow: book.imagesByRow,
      onSale,
      today: shopToday(),
      fetchRemote,
      makeThumb,
      onProgress: (text) => setStatus(status, text),
    });
    result = { file: name, distributor: parsed.distributor, ...summary };
    setStatus(
      status,
      `✓ Imported: ${summary.added} added, ${summary.updated} updated${summary.duplicates ? `, ${summary.duplicates} already in the catalog` : ''}${summary.upcClashes.length ? `, ${summary.upcClashes.length} kept their UPC (the sheet's is on another title)` : ''}${summary.arrived ? `, ${summary.arrived} straight to New Arrivals` : ''}. Covers: ${summary.covers} saved${summary.coversMissing ? `, ${summary.coversMissing} not available` : ''}.`,
      'ok',
    );
    go.textContent = 'Imported';
    toast(`${name} imported`);
  } catch (err) {
    result = { file: name, error: err.raw ?? err.message };
    setStatus(status, `Import failed: ${friendlyError(err)}`, 'error');
    go.disabled = false;
  } finally {
    busy = false;
    $('[data-cancel]', card).disabled = false;
  }
  await logImport(sb, [result]).catch((err) => console.error('job_log', err));
  loadLog(el);
}

// Hosts the fetch-cover Edge Function will fetch from (it isn't an open proxy).
const PROXIED = new Set(['images.penguinrandomhouse.com', 'funko.com', 'media.lunardistribution.com']);

/**
 * Covers on other sites (PRH, funko.com, Lunar) via the fetch-cover Edge Function.
 * Called with fetch rather than functions.invoke, which reads image responses
 * as text and would corrupt the bytes. Image links from other spreadsheets are
 * fetched directly, which works when that site allows it (CORS); otherwise the
 * title just has no cover yet.
 */
async function fetchRemote(body) {
  if (body.url && !PROXIED.has(new URL(body.url).host)) {
    const res = await fetch(body.url).catch(() => null);
    const blob = res?.ok ? await res.blob() : null;
    if (!blob?.type.startsWith('image/')) return null;
    return { bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type };
  }
  const { data: { session } } = await sb.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/fetch-cover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify(body),
  });
  if (res.status === 404) return null; // no image for this item
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `cover service returned ${res.status}`);
  const blob = await res.blob();
  // Lunar's hi-res covers run ~2 MB; shrink them to a size that still looks sharp on a card.
  if (body.url && new URL(body.url).host === 'media.lunardistribution.com') {
    const small = await processImage(new File([blob], 'cover.jpg', { type: blob.type || 'image/jpeg' }), { maxSize: 1000 });
    return { bytes: new Uint8Array(await small.blob.arrayBuffer()), type: small.type };
  }
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type || 'image/jpeg' };
}

// The small copy of each cover used on cards and lists (long side 560 px is about 2x a phone card).
async function makeThumb(bytes, type) {
  const small = await processImage(new File([bytes], 'cover', { type }), { maxSize: 560, quality: 0.65 });
  return { bytes: new Uint8Array(await small.blob.arrayBuffer()), type: small.type };
}

// The catalog's daily import Actions, started and watched through the Worker (worker/catalog-import.js).
const DAILY = { prh: 'PRH', lunar: 'Lunar' };
const DAILY_URL = '/__catalog-import';
const POLL_MS = 15000;

async function dailyCall(init = {}) {
  const { data: { session } } = await sb.auth.getSession();
  const res = await fetch(DAILY_URL, { ...init, headers: { Authorization: `Bearer ${session?.access_token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error ?? `The import service answered ${res.status}`), { status: res.status });
  return body;
}

const when = (iso) => fmtDate(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
/** One Action's latest run → the words beside its button. */
function runText(r) {
  if (!r?.status) return 'Not run yet';
  if (r.status === 'queued' || r.status === 'waiting' || r.status === 'pending' || r.status === 'requested') return 'Waiting to start…';
  if (r.status !== 'completed') return `Running since ${when(r.started)}… (results show in Recent Runs)`;
  if (r.conclusion === 'success') return `Last ran ${when(r.started)}`;
  return `Last run ${r.conclusion === 'cancelled' ? 'was cancelled' : 'failed'} (${when(r.started)})`;
}

function mountDaily(el) {
  const box = $('[data-daily]', el);
  let timer = null;
  let wasRunning = false;
  const refresh = async () => {
    clearTimeout(timer);
    if (!box.isConnected) return;
    let runs;
    try {
      runs = await dailyCall();
    } catch (err) {
      for (const source of Object.keys(DAILY)) {
        setStatus($(`[data-run-state="${source}"]`, box), err.status === 404 ? err.message : friendlyError(err), 'error');
        $(`[data-run="${source}"]`, box).disabled = err.status === 404 || err.status === 403;
      }
      return;
    }
    let running = false;
    for (const source of Object.keys(DAILY)) {
      const r = runs[source];
      const busyNow = !!r?.status && r.status !== 'completed';
      running ||= busyNow;
      setStatus($(`[data-run-state="${source}"]`, box), runText(r), r?.status === 'completed' && r.conclusion !== 'success' ? 'error' : '');
      $(`[data-run="${source}"]`, box).disabled = busyNow;
    }
    if (wasRunning && !running) loadLog(el); // a run just finished: its line is in the log now
    wasRunning = running;
    if (running) timer = setTimeout(refresh, POLL_MS);
  };
  box.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-run]');
    if (!btn) return;
    const source = btn.dataset.run;
    btn.disabled = true;
    try {
      await dailyCall({ method: 'POST', body: JSON.stringify({ source }) });
      toast(`${DAILY[source]} import started. It takes a few minutes; the result shows in Recent Runs.`);
      setStatus($(`[data-run-state="${source}"]`, box), 'Waiting to start…');
      wasRunning = true;
      clearTimeout(timer);
      timer = setTimeout(refresh, POLL_MS); // GitHub lists the new run a few seconds after it is asked for
    } catch (err) {
      toast(err.status === 409 ? err.message : `Couldn’t start the ${DAILY[source]} import: ${friendlyError(err)}`, 'error');
      refresh();
    }
  });
  refresh();
}

const RUN_NAMES = { import: 'Import', pull_import: 'Pull list import', status_flip: 'Daily status update', catalog_sync: 'Master catalog sync', prh_sync: 'PRH title updates', prh_import: 'Automatic PRH import', lunar_import: 'Automatic Lunar import' };

function loadLog(el) {
  return loadRunLog(sb, $('[data-log]', el), { name: (job) => RUN_NAMES[job] ?? job });
}
