// The header's search box: finds customers (name, email, phone, #pickup code) and titles (the same matching as the Titles screen,
// plus SKU, UPC and ISBN) from any screen. It is a combobox: results show in a list under the box as staff type, the
// arrow keys move through them and Enter opens one. A customer opens on Customers; a title opens its Title Info dialog
// over the screen staff are on. The last row of each group opens that screen's full list already searched.
// "/" anywhere outside a field jumps to the box.

import { $, esc, formatPhone, itemName, customerFilter, titleFilter } from './lib.js';

const CUSTOMERS = 5;
const TITLES = 6;

let sb;
let isOwner = false;
let run = 0; // the latest search: a slower, earlier one must not draw over it
let options = []; // the rows staff can move through, in order: { el, open }
let active = -1;

const box = () => $('#admin-search');
const input = () => $('#admin-search-q');
const panel = () => $('#admin-search-results');

/** Show the search box once a staff member is signed in (hidden again by lockOut()). */
export function startHeaderSearch(ctx) {
  sb = ctx.sb;
  isOwner = ctx.isOwner === true;
  box().hidden = false;
}

function setOpen(open) {
  panel().hidden = !open;
  input().setAttribute('aria-expanded', String(open));
  if (!open) setActive(-1);
}

function setActive(i) {
  options.forEach((o, n) => o.el.setAttribute('aria-selected', String(n === i)));
  active = i;
  const el = options[i]?.el;
  if (el) {
    input().setAttribute('aria-activedescendant', el.id);
    el.scrollIntoView({ block: 'nearest' });
  } else input().removeAttribute('aria-activedescendant');
}

/** Hand the search to a list screen and open it there (Titles and Customers read these on mount). */
function openList(section, key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* the screen just opens unsearched */
  }
  location.hash === `#${section}` ? window.dispatchEvent(new HashChangeEvent('hashchange')) : (location.hash = `#${section}`);
}

const openCustomer = (id) => (location.hash = `#customers/${id}`);

async function openTitle(id) {
  const { showTitleInfo } = await import('./sections/titles.js');
  showTitleInfo({ sb, isOwner }, id);
}

function render(q, customers, titles) {
  options = [];
  const row = (html, open) => {
    const id = `admin-search-opt-${options.length}`;
    options.push({ id, open });
    return `<li class="admin-search__option" role="option" id="${id}" aria-selected="false">${html}</li>`;
  };
  const group = (label, rows) => `<li class="admin-search__group" role="presentation"><span class="admin-search__label" aria-hidden="true">${label}</span><ul role="group" aria-label="${label}">${rows}</ul></li>`;
  const quoted = `“${esc(q)}”`;
  const customerRows = customers.map((c) =>
    row(`<span class="admin-search__main">${esc(c.name || c.email || 'No name')}</span><span class="admin-search__meta">${esc([c.email, c.phone && formatPhone(c.phone)].filter(Boolean).join(' · '))}</span>`, () => openCustomer(c.id)),
  ).join('') + (customers.length ? row(`<span class="admin-search__more">All customers matching ${quoted}</span>`, () => openList('customers', 'admin-customers-q', q)) : '');
  const titleRows = titles.map((t) =>
    row(`${t.cover_url ? `<img class="thumb thumb--sm" src="${esc(t.cover_url)}" alt="" loading="lazy">` : '<span class="thumb thumb--sm admin-search__nocover" aria-hidden="true"></span>'}<span class="admin-search__text"><span class="admin-search__main">${esc(itemName(t))}</span><span class="admin-search__meta">${esc(t.publisher || '')}</span></span>`, () => openTitle(t.id)),
  ).join('') + (titles.length ? row(`<span class="admin-search__more">All titles matching ${quoted}</span>`, () => openList('titles', 'admin-titles-filter', JSON.stringify({ q }))) : '');
  panel().innerHTML = customers.length || titles.length
    ? (customerRows ? group('Customers', customerRows) : '') + (titleRows ? group('Titles', titleRows) : '')
    : `<li class="admin-search__empty" role="presentation">Nothing found for ${quoted}.</li>`;
  options.forEach((o) => (o.el = document.getElementById(o.id)));
  $('#admin-search-status').textContent = customers.length || titles.length
    ? `${customers.length} ${customers.length === 1 ? 'customer' : 'customers'} and ${titles.length} ${titles.length === 1 ? 'title' : 'titles'} found.`
    : 'Nothing found.';
  setActive(-1);
  setOpen(true);
}

async function search() {
  const q = input().value.trim();
  const mine = ++run;
  if (q.length < 2) {
    panel().innerHTML = '';
    options = [];
    $('#admin-search-status').textContent = '';
    return setOpen(false);
  }
  // "#123" is a customer's pickup code (their number), as in the Customers search box.
  const code = q.match(/^#\s*(\d{1,9})$/)?.[1];
  const people = code ? '' : customerFilter(q, { words: true });
  const items = code ? '' : titleFilter(q, { codes: true });
  const [c, t] = await Promise.all([
    code ? sb.from('customer_list').select('id,name,email,phone').eq('id', Number(code)).limit(1)
    : people ?sb.from('customer_list').select('id,name,email,phone').or(people).order('name').limit(CUSTOMERS) : { data: [] },
    items ? sb.from('items').select('id,title,issue_number,variant,publisher,cover_url').or(items).order('release_date', { ascending: false, nullsFirst: false }).limit(TITLES) : { data: [] },
  ]);
  if (mine !== run || input().value.trim() !== q) return;
  render(q, c.data ?? [], t.data ?? []);
}

function choose(i) {
  const o = options[i];
  if (!o) return;
  setOpen(false);
  input().blur();
  o.open();
}

let timer;
export function setupHeaderSearch() {
  const q = input();
  // Phones have room for one word in the box (the label still names both).
  const narrow = window.matchMedia('(max-width: 599px)');
  const fitPlaceholder = () => (q.placeholder = narrow.matches ? 'Search' : 'Search customers and titles…');
  narrow.addEventListener('change', fitPlaceholder);
  fitPlaceholder();
  q.addEventListener('input', () => (clearTimeout(timer), (timer = setTimeout(search, 250))));
  q.addEventListener('focus', () => options.length && q.value.trim().length >= 2 && setOpen(true));
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!options.length) return;
      e.preventDefault();
      if (panel().hidden) setOpen(true);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((active + step + options.length + (active < 0 && step < 0 ? 1 : 0)) % options.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0) choose(active);
      else if (options.length) choose(0);
    } else if (e.key === 'Escape') {
      if (!panel().hidden) {
        e.stopPropagation();
        setOpen(false);
      } else if (q.value) q.value = '';
    }
  });
  $('#admin-search').addEventListener('submit', (e) => e.preventDefault());
  // mousedown, not click: the box would lose focus (and close the list) before a click lands.
  panel().addEventListener('mousedown', (e) => {
    const li = e.target.closest('[role="option"]');
    if (!li) return;
    e.preventDefault();
    choose(options.findIndex((o) => o.el === li));
  });
  document.addEventListener('click', (e) => !e.target.closest('#admin-search') && setOpen(false));
  q.addEventListener('blur', () => setTimeout(() => !box().contains(document.activeElement) && setOpen(false), 0));
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || box().hidden) return;
    if (e.target.closest('input, textarea, select, [contenteditable="true"], .ql-editor, dialog[open]')) return;
    e.preventDefault();
    q.focus();
    q.select();
  });
}
