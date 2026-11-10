// Import -> Pull lists: a shop moving to Pullwise uploads one spreadsheet of its customers and the series each one
// takes. Steps: choose the file, check the columns, review every line, Save. The file is read here in the browser
// (admin/pull-import.js); the customers and lines are stored as a draft batch in the shop's own database, where the
// titles are matched to series and everything is saved (supabase/migrations/20270306000000_pull_list_import.sql).
// A draft can be left and resumed; nothing touches customers, follows or pull lists until Save. Saving sends no email.
// Not a screen of its own: import.js mounts it in its Pull lists tab.

import { $, $$, esc, must, setStatus, toast, uid, solidIcon, friendlyError, fetchAll, downloadCsv, fmtDateTime } from '../lib.js';
import {
  readSheets, detectLayout, describeColumns, buildImport, summarise, leftOverRows, FIELDS, FIELD_LABELS, LAYOUTS,
  SAMPLE_HEADER, SAMPLE_ROWS, LEFT_OVER_HEADER,
} from '../pull-import.js';
import { adminHash } from '../route.js';

const SAVE_CHUNK = 5; // customers per save call: each one may add its open titles, so keep each call short
const METHOD = { exact: 'Same name', alias: 'Matched before', staff: 'Chosen by staff', close: 'Chosen by staff' };

let sb;
let pane;
let onLog;
let busy = false;
export const pullImportBusy = () => busy;

// The batch being reviewed: { batch, customers: Map(ref -> row), lines: [] }
let state = null;

export function mountPullLists(el, ctx) {
  sb = ctx.sb;
  pane = el;
  onLog = ctx.onLog;
  pane.innerHTML = `
    <label class="dropzone" for="pull-file">
      <input id="pull-file" type="file" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" class="visually-hidden">
      <strong>Choose a spreadsheet</strong> or drop it here
    </label>
    <div class="admin-actions">
      <button class="btn btn--ghost" type="button" data-pull-sample>${solidIcon('download', 16)} Download sample CSV</button>
      <span class="card__meta">One row per customer and title, with every column the import reads</span>
    </div>
    <div data-pull-drafts></div>
    <div data-pull-work></div>`;
  const input = $('#pull-file', pane);
  const zone = $('.dropzone', pane);
  input.addEventListener('change', () => input.files[0] && openFile(input.files[0]).finally(() => (input.value = '')));
  zone.addEventListener('dragover', (e) => (e.preventDefault(), zone.classList.add('is-over')));
  zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('is-over');
    if (e.dataTransfer.files[0]) openFile(e.dataTransfer.files[0]);
  });
  $('[data-pull-sample]', pane).addEventListener('click', () => downloadCsv('pull-lists-sample.csv', SAMPLE_HEADER, SAMPLE_ROWS));
  loadDrafts();
}

const work = () => $('[data-pull-work]', pane);
const fullName = (c) => [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || c.phone || 'No name';
const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

// ---- Drafts ------------------------------------------------------------------------------------------------------------
async function loadDrafts() {
  const box = $('[data-pull-drafts]', pane);
  const all = await must(sb.from('import_batches').select('id,source_name,status,created_at,updated_at').in('status', ['draft', 'reviewing']).order('updated_at', { ascending: false }).limit(20)).catch(() => []);
  const rows = all.filter((b) => b.id !== state?.batch.id); // the one open below isn't listed again
  if (!rows.length) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = `
    <section class="fold fold--compact fold--static">
      <div class="fold__head"><h2>Drafts<span class="fold__note">Reviews not saved yet</span></h2></div>
      <div class="fold__body">
        <div class="admin-table-wrap"><table class="admin-table cards">
          <thead><tr><th scope="col">File</th><th scope="col">Started</th><th scope="col">Last change</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead>
          <tbody>${rows.map((b) => `
            <tr>
              <td class="card-title">${esc(b.source_name)}</td>
              <td>${esc(fmtDateTime(b.created_at))}</td>
              <td>${esc(fmtDateTime(b.updated_at))}</td>
              <td class="card-foot"><button class="btn btn--ghost btn--small" type="button" data-resume="${b.id}">Resume</button> <button class="btn btn--danger btn--small" type="button" data-discard="${b.id}" data-name="${esc(b.source_name)}">Discard</button></td>
            </tr>`).join('')}
          </tbody>
        </table></div>
      </div>
    </section>`;
  $$('[data-resume]', box).forEach((b) => b.addEventListener('click', () => openBatch(+b.dataset.resume)));
  $$('[data-discard]', box).forEach((b) => b.addEventListener('click', () => discard(+b.dataset.discard, b.dataset.name)));
}

async function discard(id, name) {
  if (!confirm(`Discard the draft from “${name}”? Customers already saved from it stay; the rest of the review is thrown away.`)) return;
  try {
    await must(sb.rpc('staff_import_discard', { p_batch: id }));
    if (state?.batch.id === id) {
      state = null;
      work().innerHTML = '';
    }
    toast('Draft discarded');
  } catch (err) {
    toast(`Not discarded: ${friendlyError(err)}`, 'error');
  }
  loadDrafts();
}

// ---- Step 1-2: read the file and check the columns ----------------------------------------------------------------------
async function openFile(file) {
  if (busy) return toast('Wait for the current step to finish.', 'error');
  const box = work();
  box.innerHTML = `<section class="panel"><h2>${esc(file.name)}</h2><p class="admin-hint" role="status">Reading the file…</p></section>`;
  let sheets;
  try {
    const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs');
    sheets = readSheets(new Uint8Array(await file.arrayBuffer()), XLSX);
    if (!sheets.length) throw new Error('The file has no rows.');
  } catch (err) {
    box.innerHTML = `<section class="panel"><h2>${esc(file.name)}</h2><p class="form-error" role="alert">Couldn’t read this file: ${esc(friendlyError(err))}</p></section>`;
    return;
  }
  const { headers, mapping } = describeColumns(sheets);
  const n = uid('pm');
  box.innerHTML = `
    <section class="panel">
      <div class="admin-title-row"><h2>${esc(file.name)}</h2><span class="pill">${plural(sheets.length, 'sheet')}</span></div>
      <p class="admin-hint">Check how the sheet is laid out and which column holds what. Columns the sheet doesn’t have can stay on “Not in this sheet”.</p>
      <div class="form-grid form-grid--pairs">
        <div class="field span-2"><label for="${n}-layout">Layout</label>
          <select id="${n}-layout" data-layout>${Object.entries(LAYOUTS).map(([k, v]) => `<option value="${k}"${k === detectLayout(sheets) ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select>
          <p class="field__hint">“One sheet per customer” takes each sheet’s name as the customer’s name.</p></div>
        ${FIELDS.map((f) => `
        <div class="field"><label for="${n}-${f}">${esc(FIELD_LABELS[f])}</label>
          <select id="${n}-${f}" data-field="${f}"><option value="">Not in this sheet</option>${headers.map((h) => `<option${mapping[f] === h ? ' selected' : ''}>${esc(h)}</option>`).join('')}</select></div>`).join('')}
      </div>
      <div data-pull-preview></div>
      <div class="admin-actions">
        <button class="btn btn--primary" type="button" data-pull-start>Match titles</button>
        <button class="btn btn--ghost" type="button" data-pull-cancel>Cancel</button>
        <span class="admin-status" role="status"></span>
      </div>
    </section>`;
  const read = () => {
    const map = Object.fromEntries($$('[data-field]', box).filter((s) => s.value).map((s) => [s.dataset.field, s.value]));
    return buildImport(sheets, map, $('[data-layout]', box).value);
  };
  const preview = () => {
    const { customers, lines, problems } = read();
    const flagged = customers.filter((c) => c.flags.includes('no_contact')).length;
    $('[data-pull-preview]', box).innerHTML = `
      <ul class="import-stats"><li><strong>${customers.length.toLocaleString()}</strong> ${customers.length === 1 ? 'customer' : 'customers'}</li><li><strong>${lines.length.toLocaleString()}</strong> ${lines.length === 1 ? 'title' : 'titles'}</li>${flagged ? `<li><strong>${flagged}</strong> with no email or phone</li>` : ''}</ul>
      ${problems.length ? `<details><summary>${plural(problems.length, 'row')} left out</summary><ul class="skipped">${problems.slice(0, 200).map((p) => `<li>${esc(p)}</li>`).join('')}</ul></details>` : ''}`;
    $('[data-pull-start]', box).disabled = !lines.length;
  };
  box.addEventListener('change', (e) => e.target.matches('select') && preview());
  $('[data-pull-cancel]', box).addEventListener('click', () => (box.innerHTML = ''));
  $('[data-pull-start]', box).addEventListener('click', () => start(file.name, read(), $('.admin-status', box)));
  preview();
}

// Stores the batch (customers, then lines), then matches it a step at a time.
async function start(name, { customers, lines }, status) {
  if (busy) return;
  busy = true;
  $('[data-pull-start]', work()).disabled = true;
  let batchId;
  try {
    setStatus(status, 'Saving the draft…');
    batchId = (await must(sb.from('import_batches').insert({ source_name: name.slice(0, 200) }).select('id').single())).id;
    for (let i = 0; i < customers.length; i += 500) {
      await must(sb.from('import_customers').insert(customers.slice(i, i + 500).map(({ flags, ...c }) => ({ ...c, batch_id: batchId }))));
    }
    for (let i = 0; i < lines.length; i += 1000) {
      await must(sb.from('import_lines').insert(lines.slice(i, i + 1000).map((l) => ({ ...l, batch_id: batchId }))));
    }
    await match(batchId, status, lines.length);
  } catch (err) {
    setStatus(status, `Stopped: ${friendlyError(err)}${batchId ? ' The draft is saved: resume it from Drafts.' : ''}`, 'error');
    $('[data-pull-start]', work()).disabled = false;
    busy = false;
    loadDrafts();
    return;
  }
  busy = false;
  await openBatch(batchId);
}

async function match(batchId, status, total) {
  for (;;) {
    const { remaining } = await must(sb.rpc('staff_import_match', { p_batch: batchId, p_limit: 300 }));
    if (!remaining) return;
    setStatus(status, `Matching titles… ${(total - remaining).toLocaleString()} of ${total.toLocaleString()}`);
  }
}

// ---- Step 3: review ------------------------------------------------------------------------------------------------------
async function openBatch(id) {
  const box = work();
  box.innerHTML = '<section class="panel"><p class="admin-hint" role="status">Loading the review…</p></section>';
  try {
    const batch = await must(sb.from('import_batches').select('id,source_name,status').eq('id', id).single());
    const unchecked = await must(sb.from('import_lines').select('id', { count: 'exact', head: true }).eq('batch_id', id).is('checked_at', null).then((r) => ({ data: r.count, error: r.error })));
    if (unchecked) await match(id, $('[role="status"]', box), unchecked);
    const [customers, lines] = await Promise.all([
      fetchAll(() => sb.from('import_customers').select('id,ref,first_name,last_name,email,phone,mature_ok,no_email,customer_id,was_new,status,error,follows_added,follows_existing,titles_added').eq('batch_id', id).order('id')),
      fetchAll(() => sb.from('import_lines').select('id,customer_ref,position,raw_title,raw_quantity,raw_notes,match_key,match_method,candidates,status').eq('batch_id', id).order('id')),
    ]);
    for (const c of customers) {
      c.flags = [];
      if (!c.email && !c.phone) c.flags.push('no_contact');
      if (!c.first_name) c.flags.push('no_name');
    }
    state = { batch, customers: new Map(customers.map((c) => [c.ref, c])), lines };
  } catch (err) {
    box.innerHTML = `<section class="panel"><p class="form-error" role="alert">Couldn’t open this import: ${esc(friendlyError(err))}</p></section>`;
    return;
  }
  renderReview();
  loadDrafts();
}

const linesOf = (ref) => state.lines.filter((l) => l.customer_ref === ref).sort((a, b) => a.position - b.position);
const labelOf = (l) => l.candidates?.find((c) => c.key === l.match_key)?.label ?? l.match_key;

function renderReview() {
  const box = work();
  const { batch } = state;
  box.innerHTML = `
    <section class="panel">
      <div class="admin-title-row"><h2>${esc(batch.source_name)}</h2></div>
      <div data-pull-summary></div>
      <div class="admin-actions">
        <button class="btn btn--ghost btn--small" type="button" data-pull-leftover>${solidIcon('download', 16)} Download skipped and not found</button>
        <button class="btn btn--danger btn--small" type="button" data-pull-discard>Discard this import</button>
      </div>
      <div data-pull-customers>${[...state.customers.values()].map((c) => customerFold(c)).join('')}</div>
      <div class="sticky-actions">
        <button class="btn btn--primary" type="button" data-pull-save>Save</button>
        <span class="admin-status" role="status" data-pull-save-status></span>
      </div>
      <div data-pull-results></div>
    </section>`;
  $('[data-pull-leftover]', box).addEventListener('click', () =>
    downloadCsv(`${batch.source_name.replace(/\.\w+$/, '')}-left-over.csv`, LEFT_OVER_HEADER, leftOverRows([...state.customers.values()], state.lines)));
  $('[data-pull-discard]', box).addEventListener('click', () => discard(batch.id, batch.source_name));
  $('[data-pull-save]', box).addEventListener('click', () => save());
  wireCustomers($('[data-pull-customers]', box));
  refreshSummary();
}

function refreshSummary() {
  const customers = [...state.customers.values()];
  const s = summarise(customers, state.lines);
  const saved = customers.filter((c) => c.status === 'saved').length;
  $('[data-pull-summary]', work()).innerHTML = `
    <ul class="import-stats">
      <li><strong>${s.customers.toLocaleString()}</strong> customers: ${s.new.toLocaleString()} new, ${s.existing.toLocaleString()} already in Pullwise${saved ? `, ${saved.toLocaleString()} saved` : ''}</li>
      <li><strong>${s.matched.toLocaleString()}</strong> matched</li>
      <li><strong>${s.review.toLocaleString()}</strong> need a look</li>
      <li><strong>${s.not_found.toLocaleString()}</strong> not found</li>
      <li><strong>${s.skipped.toLocaleString()}</strong> skipped</li>
    </ul>
    ${s.flagged ? `<p class="notice">${plural(s.flagged, 'customer has', 'customers have')} no email and no phone. They can’t be matched to someone already in Pullwise, so check they aren’t already there, and their pull list stays empty until a phone or email is added.</p>` : ''}`;
  const waiting = s.review + s.not_found;
  const toSave = customers.filter((c) => c.status !== 'saved').length;
  const btn = $('[data-pull-save]', work());
  btn.textContent = toSave ? `Save ${plural(toSave, 'customer')}` : 'Saved';
  btn.disabled = busy || waiting > 0 || !toSave;
  // The "decide first" reminder; a save's own result message is left alone.
  const status = $('[data-pull-save-status]', work());
  if (!busy && waiting) {
    setStatus(status, `Decide the ${plural(waiting, 'title')} that ${waiting === 1 ? 'needs' : 'need'} a look or ${waiting === 1 ? 'wasn’t' : 'weren’t'} found before saving.`);
    status.dataset.reminder = '1';
  } else if (!busy && status.dataset.reminder) {
    setStatus(status, '');
    delete status.dataset.reminder;
  }
}

function customerFold(c) {
  const lines = linesOf(c.ref);
  const group = (s) => lines.filter((l) => l.status === s);
  const waiting = group('review').length + group('not_found').length;
  const saved = c.status === 'saved';
  const pills = [
    c.customer_id && !saved ? '<span class="pill pill--info">In Pullwise</span>' : saved ? '' : '<span class="pill pill--new">New</span>',
    c.flags.includes('no_contact') ? '<span class="pill pill--warn">No email or phone</span>' : '',
    saved ? '<span class="pill pill--done">Saved</span>' : '',
    c.status === 'failed' ? '<span class="pill pill--failed">Not saved</span>' : '',
  ].join('');
  const note = [c.email, c.phone, plural(lines.length, 'title'), waiting ? `${waiting} to decide` : ''].filter(Boolean).map(esc).join(' · ');
  return `
    <details class="fold fold--compact pull-customer" data-ref="${esc(c.ref)}"${waiting || c.status === 'failed' ? ' open' : ''}>
      <summary class="fold__head"><h2>${esc(fullName(c))} ${pills}<span class="fold__note">${note}</span></h2></summary>
      <div class="fold__body">${customerBody(c, lines)}</div>
    </details>`;
}

function customerBody(c, lines) {
  const group = (s) => lines.filter((l) => l.status === s);
  const saved = c.status === 'saved';
  const warn = [
    c.status === 'failed' ? `<p class="form-error" role="alert">Not saved: ${esc(c.error ?? 'unknown error')}</p>` : '',
    c.flags.includes('no_name') ? '<p class="cust-warn">No name in the sheet: a new customer needs one, so this one won’t save.</p>' : '',
    c.mature_ok ? '<p class="admin-hint">Mature OK: mature titles of these series go on the list too.</p>' : '',
    c.no_email ? '<p class="admin-hint">No email: the weekly and arrival emails are switched off for this customer.</p>' : '',
    saved ? `<p class="admin-status admin-status--ok">Saved: ${plural(c.follows_added, 'follow')} added${c.follows_existing ? `, ${c.follows_existing} already followed (left as they were)` : ''}, ${plural(c.titles_added, 'title')} added to the pull list.</p>` : '',
  ].join('');
  const review = group('review');
  const missing = group('not_found');
  const matched = group('matched');
  const skipped = group('skipped');
  return `${warn}
    ${review.length ? `<h3 class="mt-8 mb-8">Needs a look (${review.length})</h3><div class="stack gap-12">${review.map((l) => reviewLine(l, saved)).join('')}</div>` : ''}
    ${missing.length ? `<h3 class="mt-16 mb-8">Not found (${missing.length})</h3><div class="stack gap-12">${missing.map((l) => missingLine(l, saved)).join('')}</div>` : ''}
    ${matched.length ? `<details class="pull-matched mt-16"${review.length || missing.length ? '' : ' open'}><summary>Matched (${matched.length})</summary>
      <div class="admin-table-wrap"><table class="admin-table cards">
        <thead><tr><th scope="col">In the sheet</th><th scope="col">Series</th><th scope="col">Copies</th><th scope="col">How</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead>
        <tbody>${matched.map((l) => `
          <tr>
            <td class="card-title">${esc(l.raw_title)}${l.raw_notes ? `<br><span class="card__meta">${esc(l.raw_notes)}</span>` : ''}</td>
            <td class="card-line">${esc(labelOf(l))}</td>
            <td class="center card-key card-label">${l.raw_quantity}</td>
            <td>${esc(METHOD[l.match_method] ?? '')}</td>
            <td class="card-foot">${saved ? '' : `<button class="btn btn--ghost btn--small" type="button" data-change="${l.id}">Change</button>`}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>
    </details>` : ''}
    ${skipped.length ? `<h3 class="mt-16 mb-8">Skipped (${skipped.length})</h3><ul class="skipped">${skipped.map((l) => `<li>${esc(l.raw_title)} ${saved ? '' : `<button class="link-button" type="button" data-change="${l.id}">Choose a series</button>`}</li>`).join('')}</ul>` : ''}`;
}

const lineLegend = (l) => `“${esc(l.raw_title)}”${l.raw_quantity > 1 ? ` × ${l.raw_quantity}` : ''}${l.raw_notes ? ` <span class="card__meta">${esc(l.raw_notes)}</span>` : ''}`;

function choices(l, options, disabled) {
  const name = uid('pc');
  return `${options.map((o) => `<label class="choice-list__option"><input type="radio" name="${name}" value="${esc(o.key)}" data-line="${l.id}"${disabled ? ' disabled' : ''}> ${esc(o.label)}${o.score != null ? ` <span class="card__meta">${Math.round(o.score * 100)}% alike</span>` : ''}</label>`).join('')}
    <label class="choice-list__option"><input type="radio" name="${name}" value="" data-line="${l.id}"${disabled ? ' disabled' : ''}> Skip this title</label>`;
}

function reviewLine(l, disabled) {
  return `<fieldset class="choice-list" data-line-box="${l.id}"><legend>${lineLegend(l)}</legend>${choices(l, l.candidates ?? [], disabled)}${searchBox(l, disabled)}</fieldset>`;
}

function missingLine(l, disabled) {
  return `<fieldset class="choice-list" data-line-box="${l.id}"><legend>${lineLegend(l)}</legend>${searchBox(l, disabled, true)}</fieldset>`;
}

function searchBox(l, disabled, withSkip = false) {
  if (disabled) return '';
  const id = uid('ps');
  return `
    <div class="pull-find">
      <form class="pull-find__form" data-find="${l.id}">
        <label class="visually-hidden" for="${id}">Find a series for “${esc(l.raw_title)}”</label>
        <input id="${id}" type="search" maxlength="200" value="${esc(l.raw_title)}">
        <button class="btn btn--ghost btn--small" type="submit">Find series</button>
        <button class="btn btn--ghost btn--small" type="button" data-add="${l.id}">${solidIcon('add', 16)} Add to series catalog</button>
        ${withSkip ? `<button class="btn btn--ghost btn--small" type="button" data-skip="${l.id}">Skip</button>` : ''}
      </form>
      <div data-found="${l.id}"></div>
    </div>`;
}

function wireCustomers(root) {
  root.addEventListener('change', (e) => {
    const r = e.target.closest('input[type="radio"][data-line]');
    if (r) decide(+r.dataset.line, r.value || null);
  });
  root.addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-find]');
    if (!form) return;
    e.preventDefault();
    const line = state.lines.find((l) => l.id === +form.dataset.find);
    const out = $(`[data-found="${line.id}"]`, root);
    const q = $('input', form).value.trim();
    if (q.length < 2) return (out.innerHTML = '<p class="admin-hint">Type at least two letters.</p>');
    out.innerHTML = '<p class="admin-hint" role="status">Searching…</p>';
    try {
      const found = await must(sb.rpc('staff_import_find_series', { p_q: q }));
      line.found = found;
      out.innerHTML = found.length
        ? `<fieldset class="choice-list mt-8"><legend>Series like “${esc(q)}”</legend>${choices(line, found, false)}</fieldset>`
        : `<p class="admin-hint" role="status">No series like “${esc(q)}”. Add it to the series catalog if it’s a new one.</p>`;
    } catch (err) {
      out.innerHTML = `<p class="form-error" role="alert">${esc(friendlyError(err))}</p>`;
    }
  });
  root.addEventListener('click', async (e) => {
    const add = e.target.closest('[data-add]');
    const skip = e.target.closest('[data-skip]');
    const change = e.target.closest('[data-change]');
    if (skip) decide(+skip.dataset.skip, null);
    if (change) {
      // Back to a decision: shows the search under the line (its candidates too, if it had any).
      const line = state.lines.find((l) => l.id === +change.dataset.change);
      line.status = line.candidates?.length > 1 || line.match_method === 'close' ? 'review' : 'not_found';
      line.reopened = true;
      rerender(line.customer_ref, line.id);
    }
    if (add) {
      const line = state.lines.find((l) => l.id === +add.dataset.add);
      const title = $('input', add.closest('form')).value.trim();
      if (!title) return;
      if (!confirm(`Add “${title}” to the series catalog and match this line to it?`)) return;
      await run(line, () => sb.rpc('staff_import_add_series', { p_line: line.id, p_title: title }), `“${title}” added to the series catalog`);
    }
  });
}

async function decide(lineId, key) {
  const line = state.lines.find((l) => l.id === lineId);
  await run(line, () => sb.rpc('staff_import_decide', { p_line: lineId, p_series_key: key }), key ? null : 'Skipped');
}

// One decision: saved at once (so the draft resumes where it was left), then the customer's fold redrawn. A choice
// that also matched the same spelling elsewhere in the sheet reloads the lines.
async function run(line, call, message) {
  const box = $(`[data-line-box="${line.id}"]`, work());
  box?.setAttribute('aria-busy', 'true');
  try {
    const res = await must(call());
    if (res.key) {
      line.status = 'matched';
      line.match_key = res.key;
      line.match_method = 'staff';
      if (!line.candidates?.some((c) => c.key === res.key)) line.candidates = [...(line.candidates ?? []), { key: res.key, label: res.label }];
    } else {
      line.status = 'skipped';
    }
    delete line.reopened;
    if (res.also) {
      const fresh = await fetchAll(() => sb.from('import_lines').select('id,customer_ref,position,raw_title,raw_quantity,raw_notes,match_key,match_method,candidates,status').eq('batch_id', state.batch.id).order('id'));
      const changed = new Set(fresh.filter((f) => state.lines.find((l) => l.id === f.id)?.status !== f.status).map((f) => f.customer_ref));
      state.lines = fresh;
      changed.forEach((ref) => rerender(ref));
      toast(`Matched — and ${plural(res.also, 'other line')} with the same spelling`);
    } else if (message) {
      toast(message);
    }
    rerender(line.customer_ref, line.id);
  } catch (err) {
    box?.removeAttribute('aria-busy');
    toast(`Not saved: ${friendlyError(err)}`, 'error');
  }
}

// Redraws one customer's fold body, keeping it open, and puts focus on the next line that still needs a decision.
function rerender(ref, focusAfter) {
  const fold = $(`.pull-customer[data-ref="${CSS.escape(ref)}"]`, work());
  if (!fold) return;
  const c = state.customers.get(ref);
  const wasOpen = fold.open;
  const tmp = document.createElement('div');
  tmp.innerHTML = customerFold(c);
  const next = tmp.firstElementChild;
  next.open = wasOpen || next.open;
  fold.replaceWith(next);
  refreshSummary();
  if (focusAfter != null) {
    const target = $('[data-line-box] input, [data-line-box] button', next) ?? $('summary', next);
    target?.focus();
  }
}

// ---- Step 4: save ----------------------------------------------------------------------------------------------------
async function save(refs = null) {
  if (busy) return;
  const todo = refs ?? [...state.customers.values()].filter((c) => c.status !== 'saved').map((c) => c.ref);
  if (!todo.length) return;
  const status = $('[data-pull-save-status]', work());
  delete status.dataset.reminder;
  busy = true;
  refreshSummary();
  const results = [];
  try {
    for (let i = 0; i < todo.length; i += SAVE_CHUNK) {
      setStatus(status, `Saving… ${Math.min(i, todo.length).toLocaleString()} of ${todo.length.toLocaleString()} customers`);
      const res = await must(sb.rpc('staff_import_pull_lists', { p: { batch_id: state.batch.id, refs: todo.slice(i, i + SAVE_CHUNK), final: i + SAVE_CHUNK >= todo.length } }));
      for (const r of res.results) {
        const c = state.customers.get(r.ref);
        Object.assign(c, { status: r.status, error: r.error ?? null, customer_id: r.customer_id ?? c.customer_id, was_new: r.was_new ?? c.was_new,
          follows_added: r.follows_added ?? 0, follows_existing: r.follows_existing ?? 0, titles_added: r.titles_added ?? 0, no_contact: r.no_contact });
        results.push(c);
      }
    }
  } catch (err) {
    setStatus(status, `Stopped: ${friendlyError(err)} Customers saved so far stay saved; press Save again for the rest.`, 'error');
  }
  busy = false;
  for (const c of results) rerender(c.ref);
  const failed = results.filter((c) => c.status === 'failed');
  if (results.length) {
    setStatus(status, failed.length ? `${plural(results.length - failed.length, 'customer')} saved, ${failed.length} not saved: see why below, then Retry.` : `✓ ${plural(results.length, 'customer')} saved.`, failed.length ? 'error' : 'ok');
    toast(failed.length ? `${failed.length} not saved` : 'Pull lists saved', failed.length ? 'error' : 'ok');
  }
  showResults();
  refreshSummary();
  onLog?.();
  loadDrafts();
}

function showResults() {
  const customers = [...state.customers.values()].filter((c) => c.status !== 'pending');
  const failed = customers.filter((c) => c.status === 'failed');
  if (!customers.length) return;
  $('[data-pull-results]', work()).innerHTML = `
    <h3 class="mt-16 mb-8">Results</h3>
    ${failed.length ? `<div class="admin-actions"><button class="btn btn--primary" type="button" data-pull-retry>Retry ${plural(failed.length, 'customer')} not saved</button></div>` : ''}
    <div class="admin-table-wrap"><table class="admin-table cards">
      <thead><tr><th scope="col">Customer</th><th scope="col">Result</th><th scope="col">Follows added</th><th scope="col">Titles added</th><th scope="col">Notes</th></tr></thead>
      <tbody>${customers.map((c) => `
        <tr${c.status === 'failed' ? ' class="is-overdue"' : ''}>
          <td class="card-title">${c.customer_id && c.status === 'saved' ? `<a href="${adminHash('customers', c.customer_id)}">${esc(fullName(c))}</a>` : esc(fullName(c))}</td>
          <td>${c.status === 'saved' ? `<span class="pill pill--done">${c.was_new ? 'Added' : 'Updated'}</span>` : '<span class="pill pill--failed">Not saved</span>'}</td>
          <td class="center card-key card-label">${c.status === 'saved' ? c.follows_added : ''}</td>
          <td class="center card-key card-label">${c.status === 'saved' ? c.titles_added : ''}</td>
          <td class="card-wide">${c.status === 'failed' ? esc(c.error ?? '') : c.no_contact || c.flags.includes('no_contact') ? 'Pull list fills once a phone or email is added' : c.follows_existing ? `${c.follows_existing} already followed, left as they were` : ''}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
  $('[data-pull-retry]', work())?.addEventListener('click', () => save(failed.map((c) => c.ref)));
}
