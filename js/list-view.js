// The toolbar above a title grid (Pre-Orders, New Arrivals, Search), like the staff admin's list toolbar: the count on
// the left; a sort select and a Grid / List switch on the right. The sort is in the URL (?sort=, so a sorted view can be
// shared); the view is remembered on the device, per page.

import { esc } from './util.js';

/** Sort choices a page can offer: value → [getItems() order, label]. */
export const SORTS = {
  foc: ['foc', 'Order cutoff (soonest)'],
  arrivals: ['arrivals', 'Newest arrivals'],
  relevance: [undefined, 'Best match'],
  title: ['title', 'Title A–Z'],
  title_desc: ['title_desc', 'Title Z–A'],
  released: ['released', 'Release date (newest)'],
  released_asc: ['released_asc', 'Release date (soonest)'],
  price: ['price', 'Price (low to high)'],
  price_desc: ['price_desc', 'Price (high to low)'],
  publisher: ['publisher', 'Publisher A–Z'],
};

// The same stroke icons and switch as the Calendar's List / Calendar toggle (.view-toggle in site.css).
const ICONS = {
  grid: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
};
const icon = (name) => `<svg class="btn__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;

const viewKey = (page) => `pw-view:${page}`;

/** The sort key in the URL, if it is one of `sorts`; else the first (the page's usual order). */
export function sortFromUrl(sorts) {
  const s = new URLSearchParams(location.search).get('sort');
  return sorts.includes(s) ? s : sorts[0];
}

/**
 * Put the toolbar in front of `grid`, moving `countEl` into it.
 * @param {object} o
 * @param {HTMLElement} o.grid      the .grid of title cards
 * @param {HTMLElement} o.countEl   the page's .results-count
 * @param {string}      o.page      names the remembered view (the body's data-page)
 * @param {string[]}    o.sorts     keys of SORTS, the page's usual order first
 * @param {(order:string|undefined, key:string)=>void} o.onSort  runs when the visitor picks another sort
 * @returns {{ sort: string }}      the sort the page starts on
 */
export function listToolbar({ grid, countEl, page, sorts, onSort }) {
  const sort = sortFromUrl(sorts);
  const bar = document.createElement('div');
  bar.className = 'list-toolbar';
  bar.innerHTML = `<div class="list-toolbar__controls">
      <label class="visually-hidden" for="list-sort">Sort titles</label>
      <select id="list-sort" class="list-toolbar__sort">${sorts.map((k) => `<option value="${esc(k)}"${k === sort ? ' selected' : ''}>${esc(SORTS[k][1])}</option>`).join('')}</select>
      <div class="view-toggle" role="group" aria-label="Show titles as">
        <button class="btn btn--small btn--ghost" type="button" data-view="grid" aria-pressed="false" aria-label="Grid" title="Grid">${icon('grid')}</button>
        <button class="btn btn--small btn--ghost" type="button" data-view="list" aria-pressed="false" aria-label="List" title="List">${icon('list')}</button>
      </div>
    </div>`;
  grid.before(bar);
  bar.prepend(countEl);

  const select = bar.querySelector('select');
  select.addEventListener('change', () => {
    const url = new URL(location.href);
    if (select.value === sorts[0]) url.searchParams.delete('sort');
    else url.searchParams.set('sort', select.value);
    history.replaceState(null, '', url);
    onSort(SORTS[select.value][0], select.value);
  });

  const show = (v) => {
    grid.classList.toggle('grid--list', v === 'list');
    bar.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
  };
  let saved = 'grid';
  try {
    if (localStorage.getItem(viewKey(page)) === 'list') saved = 'list';
  } catch {
    /* start on the grid */
  }
  show(saved);
  bar.querySelectorAll('[data-view]').forEach((b) =>
    b.addEventListener('click', () => {
      show(b.dataset.view);
      try {
        localStorage.setItem(viewKey(page), b.dataset.view);
      } catch {
        /* remembering the view is optional */
      }
    }),
  );
  return { sort };
}
