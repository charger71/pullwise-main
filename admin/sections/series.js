// Series: the site groups issues into series by a key made from the title ("GARGOYLES (2026)" →
// "gargoyles 2026"), which is what customers follow. When distributors name the same book two
// ways, merge them here: tick the series that are really one, choose the one to keep, merge.
// Customers following a merged-away series move to the one you keep, and future imports of the
// old title land on it too.

import { $, $$, esc, must, toast, setStatus, imageField, openDialog, sortableTable, debounce, solidIcon, friendlyError, setupTabs, fetchAll } from '../lib.js';

let sb;
let isOwner = false;

export async function mount(el, ctx) {
  sb = ctx.sb;
  isOwner = ctx.isOwner === true;
  el.innerHTML = `
    <h1>Series</h1>
    <div class="admin-tabs" role="tablist">
      <button type="button" class="admin-tab" role="tab" data-tab="list">All Series</button>
      <button type="button" class="admin-tab" role="tab" data-tab="add">Add Active Series</button>
    </div>
    <div data-tabpane="add">
    <details class="fold toorder fold--static series-add" open>
      <summary class="fold__head"><h2 id="series-add-h">Add Active Series</h2></summary>
      <div class="fold__body">
      <p class="admin-hint">Customers can only follow a series that is in the system, and a series appears when one of its issues is imported. Add the ongoing series here so they can be followed right away; each issue is added to followers’ pull lists as it is imported later. Upload a CSV with a <strong>Series</strong> column (optional <strong>Publisher</strong> and <strong>Cover URL</strong>, an https:// link to the cover image) or paste one series per line. Series already in the system are left alone, except that a Cover URL sets their cover. To remove one, find it below and press Delete (only series with no imported titles can be deleted). <span data-count></span></p>
      <div class="form-grid">
        <div class="field"><label for="sa-file">CSV file</label><input id="sa-file" type="file" accept=".csv,text/csv"></div>
        <div class="field span-2"><label for="sa-text">Or paste series names, one per line</label><textarea id="sa-text" rows="5" placeholder="Absolute Batman&#10;Ultimate Spider-Man"></textarea></div>
      </div>
      <div class="admin-actions"><button class="btn btn--add" type="button" data-sa-go>${solidIcon('add', 18)} Add series</button><span class="admin-status" role="status" data-sa-status></span></div>
      </div>
    </details>
    </div>
    <div data-tabpane="list">
    <p class="admin-hint">Find series that are really the same book, tick them, pick which one to keep, and merge. Every series is listed; type part of a title or publisher to narrow the list.</p>
    <form class="filters admin-filters admin-filters--one" role="search" aria-label="Find series">
      <div class="field field--search"><label for="s-q">Series</label><input id="s-q" type="search" placeholder="e.g. batman" autocomplete="off"></div>
    </form>
    <p class="results-count" data-series-count role="status"></p>
    <div data-results></div>
    </div>`;
  setupTabs(el, 'admin-series-tab', 'list');
  const form = $('form[role=search]', el);
  const status = $('[data-sa-status]', el);
  const showCount = () => sb.rpc('staff_series_catalog_count').then(({ data }) => ($('[data-count]', el).textContent = data != null ? `${Number(data).toLocaleString()} on the active list so far.` : ''));
  showCount();
  $('[data-sa-go]', el).addEventListener('click', async () => {
    const rows = [];
    try {
      const file = $('#sa-file', el).files[0];
      if (file) rows.push(...parseSeriesCsv(await file.text()));
      rows.push(...$('#sa-text', el).value.split(/\r?\n/).map((t) => t.trim()).filter(Boolean).map((title) => ({ title })));
      if (!rows.length) return setStatus(status, 'Choose a CSV or paste some series names first.', 'error');
      setStatus(status, `Adding ${rows.length.toLocaleString()} rows…`);
      let added = 0;
      for (let i = 0; i < rows.length; i += 500) added += await must(sb.rpc('staff_add_series', { p_rows: rows.slice(i, i + 500) }));
      setStatus(status, `Added ${added.toLocaleString()} new ${added === 1 ? 'series' : 'series'}; ${(rows.length - added).toLocaleString()} were already there or repeated (covers are applied to both).`, 'ok');
      $('#sa-file', el).value = '';
      $('#sa-text', el).value = '';
      showCount();
      search(true);
    } catch (err) {
      setStatus(status, friendlyError(err), 'error');
    }
  });
  const box = $('[data-results]', el);
  let labels = new Map();
  let covers = new Map();
  let all = null; // every series, loaded once and refreshed after a change
  const search = async (refresh = false) => {
    const q = $('#s-q', el).value.trim().toLowerCase();
    if (refresh === true || !all) {
      // A page at a time: one request returns at most 1,000 rows, and the shop has more series than that.
      try {
        all = await fetchAll(() => sb.rpc('staff_list_series'));
      } catch (err) {
        return void (box.innerHTML = `<p class="form-error">${esc(friendlyError(err))}</p>`);
      }
    }
    const data = q ? all.filter((r) => `${r.label} ${r.publisher ?? ''}`.toLowerCase().includes(q)) : all;
    $('[data-series-count]', el).textContent = q ? `${data.length.toLocaleString()} of ${all.length.toLocaleString()} series match “${q}”` : `${all.length.toLocaleString()} series`;
    labels = new Map(data.map((r) => [r.key, r.label]));
    covers = new Map(data.map((r) => [r.key, r.cover_url]));
    box.innerHTML = data.length
      ? `<form data-merge><div class="admin-table-wrap"><table class="admin-table series-table">
          <thead><tr><th scope="col" class="series-table__tick">Merge</th><th scope="col" class="series-table__tick">Keep</th><th scope="col" data-sort="text">Series</th><th scope="col" data-sort="text">Publisher</th><th scope="col" class="center" data-sort="num" data-first="desc">Issues</th><th scope="col">Cover &amp; delete</th></tr></thead>
          <tbody>${data
            .map((r) => `<tr title="${esc(r.key)}">
              <td class="series-table__tick"><input type="checkbox" name="from" value="${esc(r.key)}" aria-label="Merge ${esc(r.label)}"></td>
              <td class="series-table__tick"><input type="radio" name="keep" value="${esc(r.key)}" aria-label="Keep ${esc(r.label)}"></td>
              <td><strong>${esc(r.label)}</strong></td><td>${esc(r.publisher)}</td><td class="center">${r.issues}</td>
              <td class="series-table__acts">${r.cover_url ? `<img class="thumb" src="${esc(r.cover_url)}" alt="">` : ''}
                <button class="btn btn--ghost btn--small" type="button" data-cover="${esc(r.key)}">${r.cover_url ? 'Change cover' : 'Add cover'}</button>
                ${r.issues || !isOwner ? '' : `<button class="btn btn--danger btn--small" type="button" data-delete="${esc(r.key)}">${solidIcon('trash', 16)} Delete</button>`}</td></tr>`)
            .join('')}</tbody></table></div>
          <p class="series-merge__hint" data-hint role="status"></p>
          <p class="form-error" role="alert" data-error></p>
          <button class="btn btn--primary" type="submit" data-merge-btn disabled>Merge</button></form>`
      : '<p class="empty">No series match.</p>';
    if (data.length) sortableTable($('table', box));
    update();
  };

  /** Button and hint follow what is ticked: nothing can be merged until there is a series to keep and one to fold in. */
  const update = () => {
    const f = $('[data-merge]', box);
    if (!f) return;
    const keep = f.elements.keep?.value;
    $$('tbody tr', f).forEach((tr) => {
      const box = $('input[name=from]', tr);
      const isKeep = keep && $('input[name=keep]', tr).value === keep;
      if (isKeep) box.checked = false;
      box.disabled = !!isKeep;
      tr.classList.toggle('is-keep', !!isKeep);
      tr.classList.toggle('is-merge', box.checked);
    });
    const from = $$('input[name=from]:checked', f).map((i) => i.value);
    const btn = $('[data-merge-btn]', f);
    const hint = $('[data-hint]', f);
    btn.disabled = !(keep && from.length);
    btn.textContent = keep && from.length ? `Merge ${from.length} ${from.length === 1 ? 'series' : 'series'} into ${labels.get(keep)}` : 'Merge';
    hint.textContent = !keep && !from.length ? 'Choose the series to keep, then tick the ones to fold into it.'
      : !keep ? 'Now choose the series to keep.'
      : !from.length ? `Keeping ${labels.get(keep)}. Now tick the series to fold into it.`
      : 'Customers following the merged series will follow the one you keep, and future imports of the old titles land on it.';
  };
  form.addEventListener('input', debounce(() => search(), 200));
  form.addEventListener('submit', (e) => (e.preventDefault(), search()));
  search();

  box.addEventListener('change', update);
  box.addEventListener('click', async (e) => {
    const coverBtn = e.target.closest('[data-cover]');
    const delBtn = e.target.closest('[data-delete]');
    if (coverBtn) {
      const key = coverBtn.dataset.cover;
      const d = openDialog(`Series cover — ${labels.get(key)}`, `<div data-cover-field></div>
        <p class="field__hint">Shown with the series when customers search for it and in their Following list. Upload one here (cropped to a 2:3 cover shape), or choose a shared image from the Media Library so it is stored once and reused.</p>
        <div class="admin-actions"><button class="btn btn--primary" type="button" data-cover-save>Save cover</button><span class="admin-status" role="status"></span></div>`);
      const field = imageField($('[data-cover-field]', d), { folder: 'series', crop: 'cover', maxSize: 700, label: 'Cover image', library: true, thumb: true });
      field.set(covers.get(key));
      $('[data-cover-save]', d).addEventListener('click', async () => {
        const st = $('.admin-status', d);
        setStatus(st, 'Saving…');
        try {
          await must(sb.rpc('staff_set_series_cover', { p_key: key, p_title: labels.get(key), p_url: field.get() }));
          d.close();
          toast('Series cover saved');
          search(true);
        } catch (err) {
          setStatus(st, friendlyError(err), 'error');
        }
      });
    } else if (delBtn) {
      const key = delBtn.dataset.delete;
      if (!confirm(`Delete “${labels.get(key)}” from the series list? Anyone following it will stop following it. This can't be undone.`)) return;
      try {
        const follows = await must(sb.rpc('staff_delete_series', { p_key: key }));
        toast(`Series deleted${follows ? ` (${follows} ${follows === 1 ? 'follow' : 'follows'} removed)` : ''}`);
        search(true);
        showCount();
      } catch (err) {
        toast(friendlyError(err), 'error');
      }
    }
  });
  // Clicking anywhere on a row ticks it for merging.
  box.addEventListener('click', (e) => {
    const tr = e.target.closest('tbody tr');
    if (!tr || e.target.closest('input, label, button, a')) return;
    const tick = $('input[name=from]', tr);
    if (!tick.disabled) tick.checked = !tick.checked;
    update();
  });

  box.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const err = $('[data-error]', f);
    const keep = f.elements.keep?.value;
    const from = $$('input[name=from]:checked', f).map((i) => i.value).filter((k) => k !== keep);
    if (!keep || !from.length) return void (err.textContent = 'Choose a series to keep and tick at least one other to merge.');
    if (!confirm(`Merge ${from.length} ${from.length === 1 ? 'series' : 'series'} into ${labels.get(keep)}? Customers following them will follow ${labels.get(keep)} instead. This can't be undone from here.`)) return;
    try {
      let issues = 0;
      for (const k of from) issues += await must(sb.rpc('staff_merge_series', { p_from: k, p_to: keep }));
      toast(`Merged ${from.length} ${from.length === 1 ? 'series' : 'series'} (${issues} ${issues === 1 ? 'title' : 'titles'} moved)`);
      search(true);
    } catch (error) {
      err.textContent = friendlyError(error);
    }
  });
}

/** Rows of a CSV with a Series (or Title / Name) column and an optional Publisher column. */
function parseSeriesCsv(text) {
  const table = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"', i++);
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') (row.push(cell), (cell = ''));
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      table.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  table.push(row);
  const head = (table.shift() ?? []).map((h) => h.replace(/^\uFEFF/, '').trim().toLowerCase());
  const t = head.findIndex((h) => ['series', 'title', 'name', 'series title'].includes(h));
  if (t < 0) throw new Error('The CSV needs a header row with a “Series” column.');
  const p = head.indexOf('publisher');
  const cv = head.findIndex((h) => ['cover url', 'cover', 'image url', 'image', 'cover image'].includes(h));
  return table.map((r) => ({ title: (r[t] ?? '').trim(), publisher: p >= 0 ? (r[p] ?? '').trim() : '', cover_url: cv >= 0 ? (r[cv] ?? '').trim() : '' })).filter((r) => r.title);
}
