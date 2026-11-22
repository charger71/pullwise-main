// Filterable, searchable item listing shared by Pre-Orders and New Arrivals.
// Filter state is mirrored in the URL so filtered views can be shared/bookmarked.

import { getItems, getCategories, getPublishers, getSettings, searchSeries, getFocDates, logSearchWhenSettled, cancelSearchLog } from './data.js';
import { $, esc, STATUS, ITEM_BADGES, fmtDate, lastReserveDay } from './site.js';
import { renderGrid, itemCard, enableReservations, seriesCards, enableSeriesFollow } from './components.js';
import { listToolbar, sortFromUrl, SORTS } from './list-view.js';

/**
 * @param {object} o
 * @param {string[]} o.statuses   statuses this page shows
 * @param {boolean}  o.reservable show Reserve buttons
 * @param {string}   o.order
 * @param {Array<{name:string,label:string,options:Array<[string,string]>|Promise<Array<[string,string]>>,multiple?:boolean,pinned?:number|Promise<number>}>} o.filters
 *   `multiple` filters render as a checkbox dropdown and yield an array of values;
 *   `pinned` = how many leading options to set apart above a divider.
 *   `options` and `pinned` may be promises: the first page of titles loads while they do.
 * @param {boolean}  o.followSeries  show "+ Follow Series" on cards (New Arrivals)
 * @param {string[]} o.sorts  the sort select's choices (keys of SORTS in js/list-view.js), the page's usual order first
 * @param {(values:object)=>object} o.toQuery maps filter values → getItems() args
 */
export async function initCatalog({ statuses, reservable, order, sorts, filters, toQuery, followSeries = false }) {
  const form = $('#filters');
  const grid = $('#results');
  const countEl = $('#results-count');
  const params = new URLSearchParams(location.search);

  const PAGE = 48;
  let items = [];
  let total = 0;
  let query = {};
  let seq = 0;
  let timer;
  // The sort select (js/list-view.js) changes the order; its first choice is the page's usual one.
  const sortOrder = (key) => (key === sorts[0] ? order : SORTS[key][0]);
  let currentOrder = sortOrder(sortFromUrl(sorts));
  const queryFor = (values) => ({ statuses, order: currentOrder, q: values.q, ...toQuery(values) });
  // Start the first page from the URL's filters now, while the filter options load.
  const allFilters = filters;
  const urlValues = { q: params.get('q') ?? '' };
  for (const f of allFilters) urlValues[f.name] = f.multiple ? params.getAll(f.name) : params.get(f.name) ?? '';
  const earlyQuery = queryFor(urlValues);
  const firstPage = getItems({ ...earlyQuery, limit: PAGE, offset: 0, withCount: true });
  firstPage.catch(() => {}); // reported where it's used
  grid.setAttribute('aria-busy', 'true');

  filters = await loadFilters(filters);

  form.innerHTML =
    `<div class="field field--search"><label for="f-q">Search titles</label><input id="f-q" name="q" type="search" placeholder="e.g. Batman"></div>` +
    filters.map(filterControl).join('');

  // Restore from URL
  for (const el of form.elements) {
    if (!el.name || !params.has(el.name)) continue;
    if (el.type === 'checkbox') el.checked = params.getAll(el.name).includes(el.value);
    else el.value = params.get(el.name);
  }
  form.querySelectorAll('.multi').forEach(setupMulti);

  const readValues = () => {
    const fd = new FormData(form);
    const values = { q: fd.get('q') ?? '' };
    for (const f of allFilters) values[f.name] = f.multiple ? fd.getAll(f.name) : fd.get(f.name) ?? '';
    return values;
  };

  // Searching a title also brings up matching series (with a Follow link) above the results.
  const seriesBox = $('#series');
  let seriesSeq = 0;
  if (seriesBox) enableSeriesFollow($('#series-list'));
  async function showSeries(q) {
    if (!seriesBox) return;
    const mine = ++seriesSeq;
    const rows = q.trim().length >= 2 ? await searchSeries(q).catch((err) => (console.error(err), [])) : [];
    if (mine !== seriesSeq) return;
    seriesBox.hidden = !rows.length;
    $('#series-list').innerHTML = seriesCards(rows.slice(0, 6));
  }

  enableReservations(grid, (id) => items.find((i) => i.id === id));
  listToolbar({
    grid,
    countEl,
    page: document.body.dataset.page,
    sorts,
    onSort: (_, key) => {
      currentOrder = sortOrder(key);
      clearTimeout(timer);
      more.disabled = true;
      load();
    },
  });

  const more = document.createElement('button');
  more.className = 'btn btn--ghost show-more';
  more.type = 'button';
  more.hidden = true;
  grid.after(more);
  more.addEventListener('click', () => fetchPage(true));

  /** `early`: the first page already requested, used if the form ended up asking for the same thing. */
  async function load(early) {
    const values = readValues();
    const url = new URL(location.href);
    for (const [k, v] of Object.entries(values)) {
      url.searchParams.delete(k);
      for (const one of [v].flat()) if (one) url.searchParams.append(k, one);
    }
    history.replaceState(null, '', url);
    query = queryFor(values);
    showSeries(values.q);
    // (A URL value with no matching option, say a cutoff that has passed, isn't in the form, so that asks again.)
    await fetchPage(false, early && JSON.stringify(query) === JSON.stringify(earlyQuery) ? early : null);
  }

  async function fetchPage(append, pending) {
    const mine = ++seq;
    grid.setAttribute('aria-busy', 'true');
    more.disabled = true;
    try {
      // Show more reuses the first page's total instead of counting every match again.
      const { rows, count } = await (pending ?? getItems({ ...query, limit: PAGE, offset: append ? items.length : 0, withCount: true, knownCount: append ? total : undefined }));
      if (mine !== seq) return; // a newer search superseded this one
      total = count;
      if (append && rows.length < PAGE) total = items.length + rows.length; // the list ended sooner (titles went out of stock meanwhile)
      if (append) {
        const firstNew = items.length;
        items = items.concat(rows);
        grid.insertAdjacentHTML('beforeend', rows.map((i) => itemCard(i, { reservable, level: 2, followSeries })).join(''));
        // Move focus to the first newly loaded card for keyboard users.
        grid.children[firstNew]?.querySelector('button, a')?.focus();
      } else {
        items = rows;
        renderGrid(grid, items, { reservable, level: 2, followSeries }, 'No titles match those filters.');
        logSearchWhenSettled(query.q, count);
      }
      countEl.textContent = `${total} ${total === 1 ? 'title' : 'titles'}`;
      const remaining = total - items.length;
      more.hidden = remaining <= 0;
      more.textContent = `Show more (${remaining} left)`;
    } catch (err) {
      console.error(err);
      if (!append) grid.innerHTML = '<p class="empty">Couldn’t load titles right now. Please try again shortly.</p>';
    } finally {
      // A superseded response leaves the button alone: the newer load enables it when its page is in.
      if (mine === seq) {
        grid.removeAttribute('aria-busy');
        more.disabled = false;
      }
    }
  }

  form.addEventListener('input', (e) => {
    if (e.target.closest('.multi__search')) return; // filters the option list only
    clearTimeout(timer);
    cancelSearchLog();
    more.disabled = true; // until the new results are in, "Show more" would add to the old list
    timer = setTimeout(load, e.target.type === 'search' ? 250 : 0);
  });
  form.addEventListener('submit', (e) => e.preventDefault());
  await load(firstPage);
}

// Publishers pinned to the top of the Publisher filter come from shop settings
// (in that order, when they have titles); everyone else follows alphabetically.
const DEFAULT_PINNED = ['Marvel', 'DC', 'Image', 'Dark Horse', 'BOOM!', 'IDW', 'Dynamite'];

/** Publisher checkbox filter for items with the given statuses (its options and pinned count load in the background). */
export function publisherFilter(statuses) {
  const ready = Promise.all([getPublishers(statuses), getSettings()]).then(([publishers, settings]) => {
    const pinned = (settings.pinned_publishers ?? DEFAULT_PINNED).filter((p) => publishers.includes(p));
    const rest = publishers.filter((p) => !pinned.includes(p));
    return { options: [...pinned, ...rest].map((p) => [p, p]), pinned: pinned.length };
  });
  return { name: 'publisher', label: 'Publisher', options: ready.then((r) => r.options), pinned: ready.then((r) => r.pinned), multiple: true };
}

/** Order cutoff filter: one option per upcoming cutoff from `firstOpenFoc` on, with the last day to add titles for it. */
export function focFilter(firstOpenFoc) {
  const day = (d) => fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' });
  const options = getFocDates(['pre_order'], firstOpenFoc).then((dates) => dates.map((d) => [d, `${day(d)} — add by ${day(lastReserveDay(d))}`]));
  return { name: 'foc', label: 'Order cutoff', options };
}

/** Category options (a promise, for a filter's `options`). */
export async function categoryOptions() {
  return (await getCategories()).map((c) => [String(c.id), c.name]);
}

/** Collector badge checkbox filter (1st Appearance, Key Issue, …). */
export const badgeFilter = () => ({ name: 'badge', label: 'Badge', options: Object.entries(ITEM_BADGES), multiple: true });

export const statusOptions = (keys) => keys.map((k) => [k, STATUS[k].label]);

// ---------------------------------------------------------------------------
// Filter controls (also the pull list app's See all lists, js/pages/app.js)
// ---------------------------------------------------------------------------

/**
 * The filters with their options loaded. A filter whose options can't load is left out, like one with nothing to
 * choose from (e.g. no publishers yet); its value then reads as none.
 */
export async function loadFilters(filters) {
  const loaded = await Promise.all(
    filters.map(async (f) => {
      try {
        const [options, pinned] = await Promise.all([f.options, f.pinned]);
        return { ...f, options, pinned };
      } catch (err) {
        console.error(err);
        return { ...f, options: [] };
      }
    }),
  );
  return loaded.filter((f) => f.options.length);
}

/** A filter's control: a checkbox dropdown for `multiple` filters (run setupMulti on it), else a select. */
export const filterControl = (f) => (f.multiple ? multiSelect(f) : singleSelect(f));

function singleSelect(f) {
  return `<div class="field"><label for="f-${f.name}">${esc(f.label)}</label><select id="f-${f.name}" name="${f.name}">
    <option value="">All</option>${f.options.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}
  </select></div>`;
}

/** Dropdown of checkboxes: pick any number of values (none = all). */
function multiSelect(f) {
  const id = `f-${f.name}`;
  return `<div class="field multi">
    <span class="label" id="${id}-label">${esc(f.label)}</span>
    <button type="button" class="multi__button" aria-expanded="false" aria-controls="${id}-panel" aria-labelledby="${id}-label ${id}-summary">
      <span class="multi__summary" id="${id}-summary">All</span>
    </button>
    <div class="multi__panel" id="${id}-panel" hidden>
      ${f.options.length > 10 ? `<input type="search" class="multi__search" placeholder="Find a ${esc(f.label.toLowerCase())}" aria-label="Find a ${esc(f.label.toLowerCase())}">` : ''}
      <fieldset class="multi__options">
        <legend class="visually-hidden">${esc(f.label)}</legend>
        ${f.options
          .map(([v, l], i) => `${f.pinned && i === f.pinned ? '<hr class="multi__divider">' : ''}<label class="multi__option"><input type="checkbox" name="${f.name}" value="${esc(v)}"> ${esc(l)}</label>`)
          .join('')}
      </fieldset>
      <div class="multi__actions"><button type="button" class="multi__clear">Clear</button><button type="button" class="multi__done">Done</button></div>
    </div>
  </div>`;
}

export function setupMulti(root) {
  const button = $('.multi__button', root);
  const panel = $('.multi__panel', root);
  const summary = $('.multi__summary', root);
  const search = $('.multi__search', root);
  const boxes = [...root.querySelectorAll('input[type=checkbox]')];
  const labelOf = (box) => box.closest('label').textContent.trim();

  const summarize = () => {
    const picked = boxes.filter((b) => b.checked);
    summary.textContent = picked.length === 0 ? 'All' : picked.length === 1 ? labelOf(picked[0]) : `${picked.length} selected`;
  };
  const open = (show) => {
    panel.hidden = !show;
    button.setAttribute('aria-expanded', show);
    if (show) {
      // Keep the panel on screen when the field sits in a right-hand column.
      panel.style.left = '';
      const overflow = panel.getBoundingClientRect().right - (document.documentElement.clientWidth - 16);
      if (overflow > 0) panel.style.left = `${-overflow}px`;
    }
    if (show) (search ?? boxes[0])?.focus();
  };

  button.addEventListener('click', () => open(panel.hidden));
  root.addEventListener('change', summarize);
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) {
      e.preventDefault();
      open(false);
      button.focus();
    }
  });
  document.addEventListener('click', (e) => !root.contains(e.target) && open(false));
  root.addEventListener('focusout', (e) => e.relatedTarget && !root.contains(e.relatedTarget) && open(false));

  search?.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    boxes.forEach((b) => (b.closest('label').hidden = q && !labelOf(b).toLowerCase().includes(q)));
    const divider = $('.multi__divider', root);
    if (divider) divider.hidden = !!q; // while searching, show one flat list
  });
  $('.multi__clear', root).addEventListener('click', () => {
    if (!boxes.some((b) => b.checked)) return;
    boxes.forEach((b) => (b.checked = false));
    summarize();
    root.dispatchEvent(new Event('input', { bubbles: true })); // re-run the search
  });
  $('.multi__done', root).addEventListener('click', () => {
    open(false);
    button.focus();
  });
  summarize();
}
