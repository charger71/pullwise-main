// Ordering → Store Order: every title for one order cutoff and distributor, A to Z, where staff enter the store's own
// (shelf) copies next to what customers reserved. Each number saves as it is typed; a title with no number yet starts
// at the series' every-issue number, else last issue's. The rows and totals come from staff_order_rows /
// staff_order_cutoffs (20270403000000_shop_ordering.sql, 20270404000000_shop_order_helps.sql), the same numbers
// Place Order and the exports use.

import { $, esc, must, toast, itemName, friendlyError, fmtDate, fmtTime, fetchAll, debounce, setHint } from '../lib.js';

const DISTRIBUTORS = { lunar: 'Lunar', prh: 'PRH', other: 'Other' };
const KEEP_KEY = 'admin-store-order';
const SAVE_MS = 600;
const SUMMARY_MS = 1200;

/** "Thu, Nov 26" */
const cutoffName = (foc) => fmtDate(foc, { weekday: 'short', month: 'short', day: 'numeric' });
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
/** The product code the distributor goes by: Lunar's own code, else the UPC (comics) or ISBN (books). */
const codeOf = (r) => (r.distributor === 'lunar' ? r.sku || r.upc || r.isbn : r.upc || r.isbn || r.sku) || '';

function remembered() {
  try {
    return JSON.parse(sessionStorage.getItem(KEEP_KEY)) ?? {};
  } catch {
    return {}; // remembering the choice is optional
  }
}
function remember(v) {
  try {
    sessionStorage.setItem(KEEP_KEY, JSON.stringify(v));
  } catch {
    /* remembering the choice is optional */
  }
}

/**
 * @param {HTMLElement} body  the Ordering screen's tab area
 * @param {{ sb: object, location: number|null, needsLocation: boolean, today: string }} ctx
 *   location: the location picked at the top of the screen (null: all, or the shop's only one);
 *   needsLocation: the shop has 2+ locations and none is picked, so numbers can be read but not entered.
 */
export async function renderStoreOrder(body, { sb, location, needsLocation, today }) {
  setHint(body, `Every title for one order cutoff, A to Z, whether customers reserved it or not. Type how many copies the store wants for its shelves in Store; each number saves as you type, and Enter goes to the next title (Shift+Enter to the one above). A title starts at the series’ every-issue number if you set one, else at last issue’s store number, and that number is ordered unless you change it (0 orders none). Under each title: what last issue had (store copies of the total ordered), and once you type a number of your own, Use to go back to the starting number or Every issue to keep yours for every new issue of the series (Stop ends it). Customers shows the copies customers have reserved, and Copies the total that goes to the distributor. Numbers can change until the cutoff passes. Place Order exports the totals and marks them ordered.`);
  const keep = remembered();
  const dist = DISTRIBUTORS[keep.dist] ? keep.dist : 'lunar';
  body.innerHTML = `
    <section class="panel order-tools" aria-labelledby="so-h">
      <h2 id="so-h">Store Order</h2>
      <div class="order-tools__row">
        <div class="field"><label for="so-foc">Order cutoff</label><select id="so-foc" disabled><option>Loading…</option></select></div>
        <div class="field"><label for="so-dist">Distributor</label><select id="so-dist">${Object.entries(DISTRIBUTORS).map(([k, v]) => `<option value="${k}"${k === dist ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="field field--search"><label for="so-q">Find</label><input id="so-q" type="search" placeholder="Title or code" autocomplete="off"></div>
      </div>
      <p class="card__meta" data-so-summary role="status"></p>
      <p class="card__meta">Customer numbers as of <span data-so-time>${esc(fmtTime())}</span>. <button class="admin-link-button" type="button" data-so-refresh>Refresh</button></p>
      ${needsLocation ? '<p class="notice">Pick a location at the top of the screen to enter store copies. The numbers below add up every location.</p>' : ''}
    </section>
    <div data-so-list aria-busy="true"></div>`;
  const focSel = $('#so-foc', body);
  const distSel = $('#so-dist', body);
  const find = $('#so-q', body);
  const list = $('[data-so-list]', body);
  const summary = $('[data-so-summary]', body);

  let rows = []; // the rows for the cutoff shown, kept up to date from each save's answer
  let cutoff = null; // the cutoff's totals (staff_order_cutoffs)
  const timers = new Map(); // item id → the save waiting for typing to stop
  const seq = new Map(); // item id → number of the latest save sent, so an older answer can't overwrite a newer one
  const sent = new Map(); // item id → the last number sent (Enter and leaving the box both save: send it once)

  const summaryText = () => {
    if (!cutoff) return '';
    const money = Number(cutoff.cost).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
    return `${plural(cutoff.all_titles, 'title', 'titles')} · ${plural(cutoff.shop_copies, 'store copy', 'store copies')} · ${plural(cutoff.customer_copies, 'customer copy', 'customer copies')} · ${plural(cutoff.total, 'copy', 'copies')} to order (${money} at cover price)`;
  };

  async function loadCutoffs() {
    const all = await must(sb.rpc('staff_order_cutoffs', { p_distributor: distSel.value, p_location: location }));
    return all.filter((c) => c.foc_date && c.foc_date >= today);
  }

  const refreshSummary = debounce(async () => {
    const foc = focSel.value;
    try {
      const all = await loadCutoffs();
      cutoff = all.find((c) => c.foc_date === foc) ?? cutoff;
      if (focSel.value === foc) summary.textContent = summaryText();
    } catch {
      /* the summary catches up on the next save or refresh */
    }
  }, SUMMARY_MS);

  /** The number a title starts at without one of its own: the series' every-issue number, else last issue's. */
  const startAt = (r) => r.series_qty ?? r.last_issue_shop;

  /** The line under a title: last issue, the series' every-issue number, and the buttons that use them. */
  function helpHtml(r) {
    const name = itemName(r);
    const parts = [];
    if (r.last_issue_total != null) parts.push(`Last issue ${r.last_issue_shop ?? 0} store of ${r.last_issue_total}`);
    if (r.series_qty != null) parts.push(`Every issue ${r.series_qty}${needsLocation ? '' : ` <button type="button" class="admin-link-button" data-series-stop="${r.item_id}" aria-label="Stop the every-issue number for ${esc(name)}">Stop</button>`}`);
    if (!needsLocation) {
      const start = startAt(r);
      if (r.shop_saved && start != null && start !== r.shop_copies)
        parts.push(`<button type="button" class="admin-link-button" data-use-start="${r.item_id}" title="Go back to ${r.series_qty != null ? 'the series’ every-issue number' : 'last issue’s number'}" aria-label="Use ${start} for ${esc(name)}">Use ${start}</button>`);
      if (r.shop_saved && r.shop_copies > 0 && r.series_qty !== r.shop_copies)
        parts.push(`<button type="button" class="admin-link-button" data-series-set="${r.item_id}" title="Order ${r.shop_copies} store ${r.shop_copies === 1 ? 'copy' : 'copies'} of every new issue in this series" aria-label="Order ${r.shop_copies} of every issue of ${esc(name)}">Every issue</button>`);
    }
    return parts.join(' · ');
  }

  function rowHtml(r) {
    const name = itemName(r);
    const fromSeries = !r.shop_saved && r.series_qty != null;
    const fromLast = !r.shop_saved && !fromSeries && r.shop_copies > 0;
    const from = fromSeries ? 'the series’ every-issue number' : fromLast ? 'last issue’s number' : '';
    return `<tr data-item="${r.item_id}">
      <td class="card-title">${esc(name)}<span class="qty-help" data-help="${r.item_id}">${helpHtml(r)}</span><span class="admin-status admin-status--error qty-error" data-err="${r.item_id}" role="status"></span></td>
      <td class="nowrap">${esc(codeOf(r))}</td>
      <td class="center card-key card-label">${r.customer_copies || '–'}</td>
      <td class="center card-key card-label"><label class="visually-hidden" for="so-q-${r.item_id}">Store copies, ${esc(name)}${from ? ` (${from})` : ''}</label><input id="so-q-${r.item_id}" class="cust-qty" type="number" inputmode="numeric" min="0" max="999" step="1" value="${r.shop_copies || (r.shop_saved ? '0' : '')}" data-qty="${r.item_id}"${from ? ` title="${from[0].toUpperCase()}${from.slice(1)}"` : ''}${needsLocation ? ' disabled' : ''}></td>
      <td class="center card-key card-label"><strong data-total="${r.item_id}">${r.total || '–'}</strong></td>
    </tr>`;
  }

  function drawRows() {
    const q = find.value.trim().toLowerCase();
    const shown = q ? rows.filter((r) => `${itemName(r)} ${codeOf(r)}`.toLowerCase().includes(q)) : rows;
    const foc = focSel.value;
    list.innerHTML = `<section class="fold fold--compact fold--static">
      <div class="fold__head"><h2>Cutoff ${esc(cutoffName(foc))} · ${esc(DISTRIBUTORS[distSel.value])}<span class="fold__note">${q ? `${plural(shown.length, 'title', 'titles')} found` : 'every title, A to Z'}</span></h2></div>
      <div class="fold__body">${shown.length ? `<table class="admin-table cards cards--slim">
        <thead><tr><th scope="col">Title</th><th scope="col">UPC / SKU</th><th scope="col" class="center">Customers</th><th scope="col" class="center">Store</th><th scope="col" class="center">Copies</th></tr></thead>
        <tbody>${shown.map(rowHtml).join('')}</tbody>
      </table>` : `<p class="empty">${q ? 'No titles match.' : 'No titles in this cutoff.'}</p>`}</div>
    </section>`;
  }

  async function loadRows() {
    list.setAttribute('aria-busy', 'true');
    const foc = focSel.value;
    try {
      const got = await fetchAll(() => sb.rpc('staff_order_rows', { p_foc: foc, p_distributor: distSel.value, p_location: location }));
      if (focSel.value !== foc) return; // another cutoff was picked meanwhile
      rows = got;
      $('[data-so-time]', body).textContent = fmtTime();
      drawRows();
    } catch (err) {
      list.innerHTML = `<p class="form-error">${esc(friendlyError(err))}</p>`;
    }
    list.removeAttribute('aria-busy');
  }

  async function loadAll() {
    focSel.disabled = true;
    list.setAttribute('aria-busy', 'true');
    let focs;
    try {
      focs = await loadCutoffs();
    } catch (err) {
      focSel.innerHTML = '<option>–</option>';
      list.removeAttribute('aria-busy');
      list.innerHTML = `<p class="form-error">${esc(friendlyError(err))}</p>`;
      return;
    }
    if (!focs.length) {
      focSel.innerHTML = '<option>None</option>';
      summary.textContent = '';
      list.removeAttribute('aria-busy');
      list.innerHTML = `<p class="empty">No upcoming order cutoffs for ${esc(DISTRIBUTORS[distSel.value])}. Titles appear here once their order cutoff is imported.</p>`;
      return;
    }
    const want = focs.some((c) => c.foc_date === keep.foc) ? keep.foc : focs[0].foc_date;
    focSel.innerHTML = focs.map((c) => `<option value="${esc(c.foc_date)}"${c.foc_date === want ? ' selected' : ''}>${esc(cutoffName(c.foc_date))}</option>`).join('');
    focSel.disabled = false;
    cutoff = focs.find((c) => c.foc_date === want);
    summary.textContent = summaryText();
    await loadRows();
  }

  /** Save one title's number; `typing` skips a blank box (the number isn't finished yet). */
  async function save(input, { typing = false } = {}) {
    const id = Number(input.dataset.qty);
    clearTimeout(timers.get(id));
    timers.delete(id);
    const err = $(`[data-err="${id}"]`, list);
    const raw = input.value.trim();
    if (typing && raw === '') return;
    const qty = raw === '' ? 0 : Number(raw);
    if (!Number.isInteger(qty) || qty < 0 || qty > 999) {
      input.setAttribute('aria-invalid', 'true');
      err.textContent = '0 to 999';
      return;
    }
    const row = rows.find((r) => r.item_id === id);
    if (sent.has(id) ? sent.get(id) === qty : row?.shop_saved && row.shop_copies === qty) return; // nothing new to save
    const n = (seq.get(id) ?? 0) + 1;
    seq.set(id, n);
    sent.set(id, qty);
    try {
      const [fresh] = await must(sb.rpc('staff_set_shop_qty', { p_item_id: id, p_quantity: qty, p_location: location }));
      if (seq.get(id) !== n || !fresh) return; // a newer number was typed meanwhile
      Object.assign(row ?? {}, fresh);
      input.removeAttribute('aria-invalid');
      input.removeAttribute('title');
      err.textContent = '';
      const total = $(`[data-total="${id}"]`, list);
      if (total) total.textContent = fresh.total || '–';
      const help = $(`[data-help="${id}"]`, list);
      if (help) help.innerHTML = helpHtml(row ?? fresh);
      refreshSummary();
    } catch (e) {
      if (seq.get(id) !== n) return;
      sent.delete(id); // the same number can be tried again
      input.setAttribute('aria-invalid', 'true');
      err.textContent = `Not saved: ${friendlyError(e)}`;
    }
  }

  list.addEventListener('input', (e) => {
    const input = e.target.closest('[data-qty]');
    if (!input) return;
    const id = Number(input.dataset.qty);
    clearTimeout(timers.get(id));
    timers.set(id, setTimeout(() => save(input, { typing: true }), SAVE_MS));
  });
  list.addEventListener('change', (e) => {
    const input = e.target.closest('[data-qty]');
    if (input) save(input);
  });
  // Enter saves and moves down the list; Shift+Enter moves up.
  list.addEventListener('keydown', (e) => {
    const input = e.target.closest('[data-qty]');
    if (!input || e.key !== 'Enter') return;
    e.preventDefault();
    save(input);
    const boxes = [...list.querySelectorAll('[data-qty]')];
    const next = boxes[boxes.indexOf(input) + (e.shiftKey ? -1 : 1)];
    if (next) {
      next.focus();
      next.select();
    }
  });

  // Use (back to the starting number), Every issue and Stop: each saves at once and redraws the title's row.
  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-use-start], [data-series-set], [data-series-stop]');
    if (!btn) return;
    const id = Number(btn.dataset.useStart ?? btn.dataset.seriesSet ?? btn.dataset.seriesStop);
    const row = rows.find((r) => r.item_id === id);
    if (!row) return;
    clearTimeout(timers.get(id));
    timers.delete(id);
    btn.disabled = true;
    try {
      const [fresh] = await must(
        'useStart' in btn.dataset
          ? sb.rpc('staff_clear_shop_qty', { p_item_id: id, p_location: location })
          : sb.rpc('staff_set_series_qty', { p_item_id: id, p_quantity: 'seriesSet' in btn.dataset ? row.shop_copies : null, p_location: location }),
      );
      if (!fresh) return;
      Object.assign(row, fresh);
      seq.set(id, (seq.get(id) ?? 0) + 1); // an answer to an earlier typed number mustn't land on top
      sent.delete(id);
      const tr = btn.closest('tr');
      tr.outerHTML = rowHtml(row);
      $(`[data-qty="${id}"]`, list)?.focus();
      toast('useStart' in btn.dataset ? `${itemName(row)}: back to ${row.shop_copies}` : 'seriesSet' in btn.dataset ? `Every issue: ${row.series_qty} store ${row.series_qty === 1 ? 'copy' : 'copies'}` : 'Every-issue number stopped');
      refreshSummary();
    } catch (err) {
      btn.disabled = false;
      const msg = $(`[data-err="${id}"]`, list);
      if (msg) msg.textContent = `Not saved: ${friendlyError(err)}`;
    }
  });

  find.addEventListener('input', debounce(drawRows, 150));
  focSel.addEventListener('change', async () => {
    remember({ dist: distSel.value, foc: focSel.value });
    keep.foc = focSel.value;
    find.value = '';
    try {
      cutoff = (await loadCutoffs()).find((c) => c.foc_date === focSel.value) ?? null;
    } catch {
      cutoff = null;
    }
    summary.textContent = summaryText();
    loadRows();
  });
  distSel.addEventListener('change', () => {
    remember({ dist: distSel.value });
    keep.foc = '';
    find.value = '';
    loadAll();
  });
  $('[data-so-refresh]', body).addEventListener('click', () => {
    toast('Refreshing…');
    loadAll();
  });

  await loadAll();
}
