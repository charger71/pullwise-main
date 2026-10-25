// Series: the site groups issues into series by a key made from the title ("GARGOYLES (2026)" →
// "gargoyles 2026"), which is what customers follow. When distributors name the same book two
// ways, merge them here: tick the series that are really one, choose the one to keep, merge.
// Customers following a merged-away series move to the one you keep, and future imports of the
// old title land on it too.

import { $, $$, esc, must, hintFold, toast, setStatus, imageField, openDialog, sortableTable, debounce, solidIcon, friendlyError, setupTabs, fetchAll, fmtDate } from '../lib.js';

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
      <button type="button" class="admin-tab" role="tab" data-tab="artists">Creatives</button>
    </div>
    <div data-tabpane="add">
    <details class="fold fold--compact fold--static series-add" open>
      <summary class="fold__head"><h2 id="series-add-h">Add Active Series</h2></summary>
      <div class="fold__body">
      ${hintFold(`Customers can only follow a series that is in the system, and a series appears when one of its issues is imported. Add the ongoing series here so they can be followed right away; each issue is added to followers’ pull lists as it is imported later. Upload a CSV with a <strong>Series</strong> column (optional <strong>Publisher</strong> and <strong>Cover URL</strong>, an https:// link to the cover image) or paste one series per line. Series already in the system are left alone, except that a Cover URL sets their cover. To remove one, find it below and press Delete (only series with no imported titles can be deleted). <span data-count></span>`)}
      <div class="form-grid form-grid--pairs">
        <div class="field span-2"><label for="sa-file">CSV file</label><input id="sa-file" type="file" accept=".csv,text/csv"></div>
        <div class="field span-2"><label for="sa-text">Or paste series names, one per line</label><textarea id="sa-text" rows="5" placeholder="Absolute Batman&#10;Ultimate Spider-Man"></textarea></div>
      </div>
      <div class="admin-actions sticky-actions"><button class="btn btn--add" type="button" data-sa-go>${solidIcon('add', 18)} Add series</button><span class="admin-status" role="status" data-sa-status></span></div>
      </div>
    </details>
    </div>
    <div data-tabpane="artists" hidden>
    <details class="fold fold--compact fold--static series-add" open>
      <summary class="fold__head"><h2 id="artist-add-h">Add or Block Creatives</h2></summary>
      <div class="fold__body">
      ${hintFold(`The list of writers, artists, colorists, editors and other creatives, and what the artist search on the site checks. Everyone credited on an imported title is added automatically. Add a cover artist who only appears in cover text (for example “CVR A PEACH MOMOKO”) so the search finds that exact name. Block a name that keeps showing up as a creative but isn’t one (for example a series); blocked names are never offered to customers. Use Edit in the list below to fix a spelling.`)}
      <div class="form-grid artist-add">
        <div class="field"><label for="ar-add">Add creatives, one per line</label><textarea id="ar-add" rows="3" placeholder="Peach Momoko"></textarea>
          <div class="admin-actions"><button class="btn btn--add" type="button" data-ar-add>${solidIcon('add', 18)} Add creatives</button></div></div>
        <div class="field"><label for="ar-block">Block a name</label><input id="ar-block" type="text" placeholder="Absolute Batman" autocomplete="off">
          <div class="admin-actions"><button class="btn btn--danger" type="button" data-ar-block>${solidIcon('remove', 18)} Block name</button></div></div>
      </div>
      <p class="admin-status" role="status" data-ar-status></p>
      </div>
    </details>
    <form class="filters admin-filters" role="search" aria-label="Find creatives" data-ar-form>
      <div class="field field--search"><label for="ar-q">Creatives</label><input id="ar-q" type="search" placeholder="e.g. momoko" autocomplete="off"></div>
      <div class="field"><label for="ar-show">Show</label><select id="ar-show"><option value="">All</option><option value="staff">Added by staff</option><option value="blocked">Blocked</option></select></div>
    </form>
    <div class="admin-title-row"><p class="results-count m-0" data-ar-count role="status"></p><div class="field m-0" data-ar-jump></div></div>
    <div data-ar-results></div>
    </div>
    <div data-tabpane="list">
    ${hintFold(`Find series that are really the same book, tick them, pick which one to keep, and merge. Every series is listed; type part of a title or publisher to narrow the list.`)}
    <form class="filters admin-filters admin-filters--one" role="search" aria-label="Find series">
      <div class="field field--search"><label for="s-q">Series</label><input id="s-q" type="search" placeholder="e.g. batman" autocomplete="off"></div>
    </form>
    <p class="results-count" data-series-count role="status"></p>
    <div data-results></div>
    </div>`;
  let artists = null; // loads the Creatives tab; set once the tab's code is mounted
  setupTabs(el, 'admin-series-tab', 'list', (tab) => tab === 'artists' && artists?.());
  const form = $('[data-tabpane=list] form[role=search]', el);
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
      setStatus(status, `Added ${added.toLocaleString()} new series; ${(rows.length - added).toLocaleString()} were already there or repeated (covers are applied to both).`, 'ok');
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
      ? `<form data-merge><div class="admin-table-wrap"><table class="admin-table series-table cards">
          <thead><tr><th scope="col" class="series-table__tick">Merge</th><th scope="col" class="series-table__tick">Keep</th><th scope="col" data-sort="text">Series</th><th scope="col" data-sort="text">Publisher</th><th scope="col" class="center" data-sort="num" data-first="desc">Issues</th><th scope="col">Cover &amp; delete</th></tr></thead>
          <tbody>${data
            .map((r) => `<tr title="${esc(r.key)}">
              <td class="series-table__tick card-key card-label"><input type="checkbox" name="from" value="${esc(r.key)}" aria-label="Merge ${esc(r.label)}"></td>
              <td class="series-table__tick card-key card-label"><input type="radio" name="keep" value="${esc(r.key)}" aria-label="Keep ${esc(r.label)}"></td>
              <td class="card-title"><strong>${esc(r.label)}</strong></td><td>${esc(r.publisher)}</td><td class="center card-key card-label">${r.issues}</td>
              <td class="series-table__acts card-foot">${r.cover_url ? `<img class="thumb" src="${esc(r.cover_url)}" alt="">` : ''}
                <button class="btn btn--ghost btn--small" type="button" data-cover="${esc(r.key)}">${r.cover_url ? 'Change cover' : 'Add cover'}<span class="visually-hidden"> for ${esc(r.label)}</span></button>
                ${r.issues || !isOwner ? '' : `<button class="btn btn--danger btn--small" type="button" data-delete="${esc(r.key)}">${solidIcon('trash', 16)} Delete<span class="visually-hidden"> ${esc(r.label)}</span></button>`}</td></tr>`)
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
    btn.textContent = keep && from.length ? `Merge ${from.length} series into ${labels.get(keep)}` : 'Merge';
    hint.textContent = !keep && !from.length ? 'Choose the series to keep, then tick the ones to fold into it.'
      : !keep ? 'Now choose the series to keep.'
      : !from.length ? `Keeping ${labels.get(keep)}. Now tick the series to fold into it.`
      : 'Customers following the merged series will follow the one you keep, and future imports of the old titles land on it.';
  };
  form.addEventListener('input', debounce(() => search(), 200));
  form.addEventListener('submit', (e) => (e.preventDefault(), search()));
  search();
  artists = mountArtists(el, sb, isOwner);
  if (!$('[data-tabpane=artists]', el).hidden) artists();

  box.addEventListener('change', update);
  box.addEventListener('click', async (e) => {
    const coverBtn = e.target.closest('[data-cover]');
    const delBtn = e.target.closest('[data-delete]');
    if (coverBtn) {
      const key = coverBtn.dataset.cover;
      const d = openDialog(`Series cover — ${labels.get(key)}`, `<div data-cover-field></div>
        <p class="field__hint">Shown with the series when customers search for it and in their Following list. Upload one here (cropped to a 2:3 cover shape), or choose a shared image from the Media Library so it is stored once and reused.</p>
        <div class="admin-actions sticky-actions"><button class="btn btn--primary" type="button" data-cover-save>Save cover</button><span class="admin-status" role="status"></span></div>`);
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
    if (!confirm(`Merge ${from.length} series into ${labels.get(keep)}? Customers following them will follow ${labels.get(keep)} instead. This can't be undone from here.`)) return;
    try {
      let issues = 0;
      for (const k of from) issues += await must(sb.rpc('staff_merge_series', { p_from: k, p_to: keep }));
      toast(`Merged ${from.length} series (${issues} ${issues === 1 ? 'title' : 'titles'} moved)`);
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

/** Admin > Series > Creatives: the list the artist search checks (see the creator_catalog migration). */
function mountArtists(el, sb, isOwner) {
  const status = $('[data-ar-status]', el);
  const box = $('[data-ar-results]', el);
  const PAGE = 100;
  /** A count that opens the list of titles it was made from. */
  const count = (r, kind) => (r[kind] ? `<button class="admin-link-button" type="button" data-titles="${kind}" data-key="${esc(r.key)}" aria-label="${r[kind]} ${kind} for ${esc(r.name)}: show titles">${r[kind]}</button>` : '0');
  let all = null;
  let page = 0;
  const load = async (refresh = false) => {
    if (refresh === true || !all) {
      try {
        all = await fetchAll(() => sb.rpc('staff_list_artists'));
      } catch (err) {
        return void (box.innerHTML = `<p class="form-error">${esc(friendlyError(err))}</p>`);
      }
    }
    const q = $('#ar-q', el).value.trim().toLowerCase();
    const show = $('#ar-show', el).value;
    const data = all.filter((r) => (!q || r.name.toLowerCase().includes(q)) && (!show || (show === 'blocked' ? r.blocked : r.source === 'staff')));
    $('[data-ar-count]', el).textContent = q || show ? `${data.length.toLocaleString()} of ${all.length.toLocaleString()} creatives` : `${all.length.toLocaleString()} creatives`;
    page = Math.min(page, Math.max(0, Math.ceil(data.length / PAGE) - 1));
    const rows = data.slice(page * PAGE, (page + 1) * PAGE);
    // Jump straight to a page; each is labelled with the names it starts and ends on.
    const pages = Math.ceil(data.length / PAGE);
    const stem = (r) => r.name.slice(0, 3);
    $('[data-ar-jump]', el).innerHTML = pages > 1
      ? `<label for="ar-jump" class="visually-hidden">Go to page</label><select id="ar-jump" aria-label="Go to page">${Array.from({ length: pages }, (_, n) => `<option value="${n}"${n === page ? ' selected' : ''}>Page ${n + 1} · ${esc(stem(data[n * PAGE]))}–${esc(stem(data[Math.min(data.length, (n + 1) * PAGE) - 1]))}</option>`).join('')}</select>`
      : '';
    box.innerHTML = data.length
      ? `<div class="admin-table-wrap"><table class="admin-table cards"><thead><tr><th scope="col" >Name</th><th scope="col" class="center">Credits</th><th scope="col" class="center">Covers</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
          <tbody>${rows.map((r) => `<tr${r.blocked ? ' class="is-overdue"' : ''}><td class="card-title"><strong>${esc(r.name)}</strong></td><td class="center card-key card-label">${count(r, 'credits')}</td><td class="center card-key card-label">${count(r, 'covers')}</td>
            <td>${r.blocked ? 'Blocked' : r.source === 'staff' ? 'Added by staff' : 'Credited'}</td>
            <td class="nowrap card-foot"><span class="cluster gap-6">
              <button class="btn btn--ghost btn--small" type="button" data-edit="${esc(r.key)}">${solidIcon('edit', 16)} Edit<span class="visually-hidden"> ${esc(r.name)}</span></button>
              ${r.blocked
                ? `<button class="icon-btn icon-btn--add" type="button" data-block="${esc(r.key)}" data-to="no" aria-label="Unblock ${esc(r.name)}" title="Unblock">${solidIcon('add')}</button>`
                : `<button class="icon-btn icon-btn--remove" type="button" data-block="${esc(r.key)}" data-to="yes" aria-label="Block ${esc(r.name)}" title="Block this name">${solidIcon('remove')}</button>`}
              ${isOwner && !r.credits ? `<button class="btn btn--danger btn--small" type="button" data-del="${esc(r.key)}">${solidIcon('trash', 16)} Delete<span class="visually-hidden"> ${esc(r.name)}</span></button>` : ''}</span></td></tr>`).join('')}</tbody></table></div>
        ${data.length > PAGE ? `<div class="admin-pager"><button class="btn btn--ghost" type="button" data-ar-prev ${page ? '' : 'disabled'}>← Previous</button><span>${page * PAGE + 1}–${page * PAGE + rows.length} of ${data.length.toLocaleString()}</span><button class="btn btn--ghost" type="button" data-ar-next ${(page + 1) * PAGE < data.length ? '' : 'disabled'}>Next →</button></div>` : ''}`
      : '<p class="empty">No creatives match.</p>';
  };
  const run = async (fn, done) => {
    try {
      await fn();
      setStatus(status, done, 'ok');
      load(true);
    } catch (err) {
      setStatus(status, friendlyError(err), 'error');
    }
  };
  $('[data-ar-add]', el).addEventListener('click', () => {
    const names = $('#ar-add', el).value.split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
    if (!names.length) return setStatus(status, 'Type at least one name first.', 'error');
    run(async () => {
      await must(sb.rpc('staff_add_artists', { p_names: names }));
      $('#ar-add', el).value = '';
    }, `Added ${names.length} ${names.length === 1 ? 'name' : 'names'} (any already on the list are now unblocked).`);
  });
  $('[data-ar-block]', el).addEventListener('click', () => {
    const name = $('#ar-block', el).value.trim();
    if (!name) return setStatus(status, 'Type the name to block first.', 'error');
    if (!confirm(`Block “${name}”? It will no longer be offered in the artist search.`)) return;
    run(async () => {
      await must(sb.rpc('staff_block_artist', { p_name: name }));
      $('#ar-block', el).value = '';
    }, `“${name}” will no longer be offered in the artist search.`);
  });
  $('[data-ar-jump]', el).addEventListener('change', (e) => ((page = Number(e.target.value)), load()));
  $('[data-ar-form]', el).addEventListener('input', debounce(() => ((page = 0), load()), 200));
  $('[data-ar-form]', el).addEventListener('submit', (e) => (e.preventDefault(), (page = 0), load()));
  box.addEventListener('click', async (e) => {
    if (e.target.closest('[data-ar-prev], [data-ar-next]')) {
      page += e.target.closest('[data-ar-next]') ? 1 : -1;
      load();
      $('[data-ar-count]', el).scrollIntoView({ block: 'start' });
      return;
    }
    const b = e.target.closest('[data-block]');
    const d = e.target.closest('[data-del]');
    const tl = e.target.closest('[data-titles]');
    if (tl) {
      const cur = all.find((r) => r.key === tl.dataset.key);
      const kind = tl.dataset.titles;
      const dlg = openDialog(`${cur?.name ?? ''} — ${kind === 'covers' ? 'covers' : 'credits'}`, '<p class="admin-hint" role="status">Loading…</p>', { wide: true });
      try {
        const rows = await fetchAll(() => sb.rpc('staff_artist_titles', { p_key: tl.dataset.key, p_kind: kind }));
        $('.dialog__body', dlg).innerHTML = `<p class="admin-hint">${kind === 'covers'
          ? 'Titles whose cover is by this creative: credited as the cover artist, or named in the cover text.'
          : 'Titles that credit this person.'} ${rows.length.toLocaleString()} ${rows.length === 1 ? 'title' : 'titles'}; faded ones are hidden on the site.</p>
          ${rows.length ? `<div class="admin-table-wrap"><table class="admin-table cards"><thead><tr><th scope="col">Cover</th><th scope="col">Title</th><th scope="col">Publisher</th><th scope="col">Release</th></tr></thead><tbody>${rows
            .map((t) => `<tr${t.hidden ? ' class="is-hidden"' : ''}><td>${t.cover_url ? `<img class="thumb thumb--sm" src="${esc(t.cover_url)}" alt="" loading="lazy">` : ''}</td>
              <td class="card-title"><strong>${esc(t.title)}${t.issue_number ? ` #${esc(t.issue_number)}` : ''}</strong>${t.variant ? `<br><span class="card__meta">${esc(t.variant)}</span>` : ''}</td>
              <td class="card-key">${esc(t.publisher)}</td><td class="nowrap card-key card-label">${t.release_date ? fmtDate(t.release_date) : ''}</td></tr>`)
            .join('')}</tbody></table></div>` : '<p class="empty">No titles.</p>'}`;
      } catch (err) {
        $('.dialog__body', dlg).innerHTML = `<p class="form-error" role="alert">${esc(friendlyError(err))}</p>`;
      }
      return;
    }
    const ed = e.target.closest('[data-edit]');
    if (ed) {
      // Edit in place: the name cell becomes a text box with Save and Cancel; Enter saves, Escape cancels.
      const cur = all.find((r) => r.key === ed.dataset.edit);
      const cell = ed.closest('tr').firstElementChild;
      if ($('input', cell)) return $('input', cell).focus();
      cell.innerHTML = `<div class="cluster gap-6"><label class="visually-hidden" for="ar-name">Name of ${esc(cur?.name ?? '')}</label>
        <input id="ar-name" class="flex-1" type="text" maxlength="200" value="${esc(cur?.name ?? '')}" autocomplete="off">
        <button class="btn btn--primary btn--small" type="button" data-ar-save>Save</button>
        <button class="btn btn--ghost btn--small" type="button" data-ar-cancel>Cancel</button></div>
        <p class="form-error m-0 mt-4" role="alert" data-ar-error></p>`;
      const input = $('input', cell);
      input.focus();
      input.select();
      const save = async () => {
        const name = input.value.trim();
        const err = $('[data-ar-error]', cell);
        if (!name) return void (err.textContent = 'Enter a name.');
        if (name === cur?.name) return load();
        err.textContent = '';
        try {
          await must(sb.rpc('staff_rename_artist', { p_key: ed.dataset.edit, p_name: name }));
          toast('Creative renamed');
          load(true);
        } catch (error) {
          err.textContent = friendlyError(error);
        }
      };
      $('[data-ar-save]', cell).addEventListener('click', save);
      $('[data-ar-cancel]', cell).addEventListener('click', () => load());
      input.addEventListener('keydown', (k) => {
        if (k.key === 'Enter') (k.preventDefault(), save());
        else if (k.key === 'Escape') load();
      });
      return;
    }
    const nameOf = (key) => all.find((r) => r.key === key)?.name ?? 'this name';
    if (b) {
      const blocking = b.dataset.to === 'yes';
      if (blocking && !confirm(`Block “${nameOf(b.dataset.block)}”? It will no longer be offered in the artist search.`)) return;
      run(() => must(sb.rpc('staff_set_artist_blocked', { p_key: b.dataset.block, p_blocked: blocking })), blocking ? 'Blocked.' : 'Unblocked.');
    } else if (d && confirm(`Remove “${nameOf(d.dataset.del)}” from the creative list? It comes back if it is credited on a title again.`)) run(() => must(sb.rpc('staff_delete_artist', { p_key: d.dataset.del })), 'Removed.');
  });
  return () => load();
}
