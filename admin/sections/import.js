// Import: drop distributor sheets (Lunar/PRH FOC or release sheets, Funko
// lists) or any spreadsheet with recognisable column headers, preview what will change, then import. Same parsing rules
// (js/import/distributors.js) and database logic (js/import/apply.js) as the
// command-line importer; covers from other sites come via the fetch-cover
// Edge Function because browsers can't read them directly.

import { readWorkbook, parseSheet } from '../../js/import/distributors.js';
import { planImport, applyImport, logImport } from '../../js/import/apply.js';
import { $, esc, must, setStatus, toast, fmtDate, fmtDateTime, processImage, loadScript, solidIcon, friendlyError, setupTabs, sortableTable, hintFold } from '../lib.js';
import { tally } from '../../js/util.js';
import { todayIn } from '../../js/dates.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../js/config.js';

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
export const hasUnsavedChanges = () => busy;

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
    <h1>Import Titles</h1>
    <div class="admin-tabs" role="tablist">
      <button type="button" class="admin-tab" role="tab" data-tab="files">Import Files</button>
      <button type="button" class="admin-tab" role="tab" data-tab="skip">Always Skip</button>
      <button type="button" class="admin-tab" role="tab" data-tab="runs">Recent Runs</button>
    </div>
    <div data-tabpane="files">
    ${hintFold(`Drop in this week's sheets as downloaded: Lunar or PRH FOC sheets, Lunar or PRH release sheets, or a Funko pre-order list. Any other spreadsheet (.xlsx, .xls or .csv) works too if it has a header row with a <strong>Title</strong> (or Name / Product) column and details such as Price, UPC, ISBN, SKU, Publisher, Release date or FOC date — pictures in the sheet become covers. You'll see what will change before anything is saved. Incentive covers and retailer bundles are always skipped, plus anything on the list below.`)}
    <label class="dropzone" for="import-files">
      <input id="import-files" type="file" accept=".xlsx,.xlsm,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" multiple class="visually-hidden">
      <strong>Choose spreadsheets</strong> or drop them here
    </label>
    <div data-files></div>
    </div>
    <div data-tabpane="skip">
    <details class="fold toorder fold--static exclusions" data-exclusions open>
      <summary class="fold__head"><h2>Always Skip</h2> <span class="card__meta" data-exclusion-count>Publishers, series, title words or mature titles to leave out of every import</span></summary>
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
    </details>
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
  setupTabs(el, 'admin-import-tab', 'files');
  mountExclusions(el);
  loadLog(el);
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

async function preview(el, card, name, parsed, book) {
  const today = shopToday();
  const render = async (onSale) => {
    const items = onSale ? parsed.items.map((i) => ({ ...i, release_date: onSale })) : parsed.items;
    const { fresh, known, duplicates } = await planImport(sb, { ...parsed, items });
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
      </ul>
      ${duplicates.length ? `<details><summary>${duplicates.length} already in the catalog under another listing</summary><ul class="skipped">${duplicates.map((d) => `<li>${esc(d.title)}${d.issue_number ? ` #${esc(d.issue_number)}` : ''} <span class="card__meta">— ${d.upc && d.existingTitle.upc === d.upc ? `UPC ${esc(d.upc)}` : `ISBN ${esc(d.isbn)}`} is “${esc(d.existingTitle.title)}${d.existingTitle.issue_number ? ` #${esc(d.existingTitle.issue_number)}` : ''}”</span></li>`).join('')}</ul></details>` : ''}
      ${released ? `<p class="notice">${released} new ${released === 1 ? 'title is' : 'titles are'} already out, so ${released === 1 ? 'it goes' : 'they go'} straight to New Arrivals.</p>` : ''}
      <p class="card__meta">On sale: ${onSaleDates.map(([d, n]) => `${n} × ${d === 'no date' ? 'no date' : fmtDate(d, { month: 'short', day: 'numeric' })}`).join(', ')}</p>
      <p class="card__meta">Categories: ${tally(items.map((i) => i.category ?? 'none')).map(([c, n]) => `${n} ${c}`).join(', ')}</p>`;
  };

  const n = Math.random().toString(36).slice(2);
  card.innerHTML = `
    <div class="admin-title-row"><h2>${esc(name)}</h2><span class="badge">${SOURCE[parsed.source ?? parsed.distributor] ?? parsed.distributor}</span></div>
    <div data-summary><p class="admin-hint">Checking what's already imported…</p></div>
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
      `✓ Imported: ${summary.added} added, ${summary.updated} updated${summary.duplicates ? `, ${summary.duplicates} already in the catalog` : ''}${summary.arrived ? `, ${summary.arrived} straight to New Arrivals` : ''}. Covers: ${summary.covers} saved${summary.coversMissing ? `, ${summary.coversMissing} not available` : ''}.`,
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

async function loadLog(el) {
  const box = $('[data-log]', el);
  const { data, error } = await sb.from('job_log').select('*').order('id', { ascending: false }).limit(15);
  if (error) {
    box.innerHTML = `<p class="form-error">${esc(friendlyError(error))}</p>`;
    return;
  }
  box.innerHTML = data.length
    ? `<div class="admin-table-wrap"><table class="admin-table run-log cards">
        <thead><tr><th scope="col" data-sort="text" data-first="desc">When</th><th scope="col" data-sort="text">Run</th><th scope="col" data-sort="text">Result</th><th scope="col">Details</th></tr></thead>
        <tbody>${data
          .map(
            (j) => `<tr class="${j.ok ? '' : 'is-overdue'}">
            <td class="nowrap card__meta card-key" data-sort="${esc(j.created_at)}">${fmtDateTime(j.created_at)}</td>
            <td class="card-title"><strong>${j.job === 'import' ? 'Import' : j.job === 'status_flip' ? 'Daily status update' : j.job === 'catalog_sync' ? 'Master catalog sync' : esc(j.job)}</strong></td>
            <td class="card-key">${j.ok ? 'OK' : '<span class="badge badge--sold_out">Failed</span>'}</td>
            <td class="card__meta card-wide">${esc(j.message ?? '')}</td>
          </tr>`,
          )
          .join('')}</tbody>
      </table></div>`
    : '<p class="empty">No runs yet.</p>';
  if (data.length) sortableTable($('.run-log', box));
}
