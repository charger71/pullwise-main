// Titles: every item (pre-orders and in-store stock). Search and filter, quick
// changes in the list (status, staff pick, hidden), a read-only info view (click
// the name), a full edit form, and who ordered each title.

import { $, $$, esc, must, toast, isPhone, openDialog, debounce, customerFilter, fmtDate, STATUS_LABELS, setStatus, sortableTable, titleFilter, solidIcon, friendlyError, hintFold, fetchAll, fmtDateTime, formatPhone, itemName, withCustomers, downloadCsv, listLocations, toListTop } from '../lib.js';
import { imageField, uploadImage } from '../images.js';
import { price } from '../../js/util.js';
import { LINE_STATUS, ITEM_BADGES } from '../../js/labels.js';
import { addDays, weekStart } from '../../js/dates.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, IS_CATALOG } from '../../js/config.js';
import { prhApiItem } from '../../js/import/distributors.js';

const PAGE = 50;
let state = { q: '', status: '', category: '', flag: '', visibility: '', sort: 'updated', dir: 'desc', offset: 0, foc: '', release: '' };
// Direction a sort starts in when picked from the Sort menu (headers toggle it).
const DEFAULT_DIR = { updated: 'desc', release: 'desc', staff_pick: 'desc', featured: 'desc', hidden: 'desc' };
const SORT_COLUMN = { updated: 'updated_at', foc: 'foc_date', release: 'release_date', status: 'status', staff_pick: 'staff_pick', featured: 'featured', hidden: 'hidden' };
let categories = [];
let sb;
let isOwner = false;

/** "Nov 4", or "Jan 6, 2027" when it isn't this year (a two-digit year read like a day). */
/** Google Images search for a title's cover, from what we know about it (opens in a new tab; admin only). */
const coverSearchUrl = (i) =>
  `https://www.google.com/search?tbm=isch&q=${encodeURIComponent([i.title, i.issue_number && `#${i.issue_number}`, i.variant, i.publisher, 'comic cover', i.upc || i.isbn].filter(Boolean).join(' '))}`;


const DEFAULT_STATE = { q: '', status: '', category: '', flag: '', visibility: '', sort: 'updated', dir: 'desc', offset: 0, foc: '', release: '' };

export async function mount(el, ctx) {
  sb = ctx.sb;
  isOwner = ctx.isOwner === true;
  // The Dashboard's Needs Attention links open the list already filtered (e.g. { flag: 'no_cover', visibility: 'visible' }).
  try {
    const wanted = sessionStorage.getItem('admin-titles-filter');
    if (wanted) {
      sessionStorage.removeItem('admin-titles-filter');
      state = { ...DEFAULT_STATE, ...JSON.parse(wanted) };
    }
  } catch {
    /* no hand-off */
  }
  categories = await must(sb.from('categories').select('id,name,slug').order('sort'));
  // On phones the less-used filters fold under "More filters" (open when one of them is set), so the list is on the first screen.
  const phone = isPhone();
  const moreOpen = ['flag', 'foc', 'release'].some((k) => state[k]) || (state.sort && state.sort !== 'updated');
  el.innerHTML = `
    <div class="admin-title-row">
      <h1>Titles</h1>
      <div class="admin-actions">
        ${IS_CATALOG ? '' : `<button class="btn btn--ghost" type="button" data-sync>${solidIcon('sync', 16)} <span>Sync now</span></button>`}
        <button class="btn btn--add" type="button" data-new>${solidIcon('add', 18)} New title</button>
      </div>
    </div>
    ${hintFold(`Every comic, book and product the shop sells. <strong>All</strong> lists everything, the FOC tab shows titles whose final order cutoff is this week (or next week, once this week’s has passed), and <strong>Out This Week</strong> shows what releases this week. Search and filter to narrow the list, then open a title to change its price, status, category or badges. Most titles arrive by import; add one here for anything else.${IS_CATALOG ? '' : ' New and changed titles come in from the master catalog every hour; <strong>Sync now</strong> brings them in straight away.'}${IS_CATALOG ? ' <strong>Export CSV</strong> saves every title the tab and filters are showing, across all pages, in the order shown.' : ''}`)}
    <div class="admin-tabs" role="tablist">
      <button type="button" class="admin-tab" role="tab" data-weektab="all">All</button>
      <button type="button" class="admin-tab" role="tab" data-weektab="foc">${focTabLabel()}</button>
      <button type="button" class="admin-tab" role="tab" data-weektab="release">Out This Week</button>
    </div>
    <form class="filters admin-filters admin-filters--wide-search" role="search" aria-label="Filter titles">
      <div class="field field--search"><label for="t-q">Search</label><input id="t-q" name="q" type="search" placeholder="Title, variant, creator, SKU or UPC" value="${esc(state.q)}"></div>
      <div class="field"><label for="t-status">Status</label><select id="t-status" name="status"><option value="">All</option>${Object.entries(STATUS_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
      <div class="field"><label for="t-category">Category</label><select id="t-category" name="category"><option value="">All</option>${categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}<option value="none">No category</option></select></div>
      ${phone ? `<details class="filters-more"${moreOpen ? ' open' : ''}>
        <summary>More filters</summary>
        <div class="filters-more__grid">` : ''}<div class="field"><label for="t-flag">Show</label>
          <select id="t-flag" name="flag">
          <option value="">Everything</option>
          <option value="staff_pick">Staff picks</option>
          <option value="featured">On homepage</option>
          <option value="hidden">Hidden</option>
          <option value="badged">Has collector badge</option>
          <option value="no_cover">No cover</option>
          <option value="no_price">No price</option>
          </select>
        </div>
      <div class="field"><label for="t-sort">Sort</label>
        <select id="t-sort" name="sort">
        <option value="updated">Recently changed</option>
        <option value="foc">Order cutoff</option>
        <option value="release">Release date</option>
        <option value="title">Title</option>
        <option value="publisher">Publisher</option>
        <option value="status">Status</option>
        <option value="staff_pick">Staff pick</option>
        <option value="featured">On homepage</option>
        <option value="hidden">Hidden</option>
        </select>
        </div>
      <div class="field"><label for="t-foc">FOC week</label><select id="t-foc" name="foc"><option value="">All weeks</option></select></div>
      <div class="field"><label for="t-release">Out week</label><select id="t-release" name="release"><option value="">All weeks</option></select></div>
      ${phone ? '</div></details>' : ''}
      ${IS_CATALOG ? '<div class="field"><button class="btn btn--ghost" type="button" data-export>Export CSV</button></div>' : ''}
    </form>
    <p class="results-count" role="status" data-count></p>
    <div class="admin-table-wrap"><table class="admin-table titles-table" data-sort-elsewhere>
      <thead>
        <tr>
        <th scope="col" colspan="2" data-sort="title">Title</th>
        <th scope="col" data-sort="status">Status</th>
        <th scope="col" data-sort="foc">Dates</th>
        <th scope="col" data-sort="staff_pick" data-first="desc">Staff</th>
        <th scope="col" data-sort="featured" data-first="desc">Home</th>
        <th scope="col" data-sort="hidden" data-first="desc">Hide</th>
        <th scope="col"><span class="visually-hidden">Edit</span>
        </th>
        </tr>
        </thead>
      <tbody></tbody>
    </table></div>
    <div class="admin-pager"><button class="btn btn--ghost" type="button" data-prev>← Previous</button><span data-page></span><button class="btn btn--ghost" type="button" data-next>Next →</button></div>`;

  const form = $('form', el);
  for (const [k, v] of Object.entries(state)) if (form.elements[k]) form.elements[k].value = v;
  $$('[data-weektab]', el).forEach((b) =>
    b.addEventListener('click', () => {
      const thisWeek = weekStart(localToday());
      const which = b.dataset.weektab;
      state = { ...state, foc: which === 'foc' ? focTabWeek() : '', release: which === 'release' ? thisWeek : '', offset: 0 };
      syncDateSelects(el);
      load(el);
    }),
  );
  markWeekTabs(el);
  let timer;
  form.addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const v = Object.fromEntries(new FormData(form));
      state = { ...state, ...v, dir: v.sort !== state.sort ? DEFAULT_DIR[v.sort] ?? 'asc' : state.dir, offset: 0 };
      headers.set(state.sort, state.dir);
      markWeekTabs(el);
      load(el);
    }, e.target.type === 'search' ? 300 : 0);
  });
  form.addEventListener('submit', (e) => e.preventDefault());
  const headers = sortableTable($('table', el), {
    sort: state.sort,
    dir: state.dir,
    onSort: (key, dir) => {
      state = { ...state, sort: key, dir, offset: 0 };
      form.elements.sort.value = key;
      load(el);
    },
  });
  // A new page starts at the top of the list, not down by the pager that was clicked.
  const turnPage = (offset) => ((state.offset = offset), toListTop($('[data-count]', el)), load(el));
  $('[data-prev]', el).addEventListener('click', () => turnPage(Math.max(0, state.offset - PAGE)));
  $('[data-next]', el).addEventListener('click', () => turnPage(state.offset + PAGE));
  $('[data-new]', el).addEventListener('click', () => edit(el, null));
  $('[data-sync]', el)?.addEventListener('click', (e) => syncNow(el, e.currentTarget));
  $('[data-export]', el)?.addEventListener('click', (e) => exportTitles(e.currentTarget));

  // Quick changes straight from the list.
  $('tbody', el).addEventListener('change', async (e) => {
    const row = e.target.closest('tr');
    const id = Number(row?.dataset.id);
    const field = e.target.dataset.field;
    if (!id || !field) return;
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    try {
      await must(sb.from('items').update({ [field]: value }).eq('id', id));
      toast(field === 'status' ? `Status: ${STATUS_LABELS[value]}` : `${{ staff_pick: 'Staff', featured: 'Home', hidden: 'Hide' }[field]} ${value ? 'on' : 'off'}`);
    } catch (err) {
      toast(`Not saved: ${friendlyError(err)}`, 'error');
      load(el);
    }
  });
  $('tbody', el).addEventListener('click', (e) => {
    const btn = e.target.closest('[data-edit]');
    if (btn) return edit(el, Number(btn.dataset.edit));
    const info = e.target.closest('[data-info]');
    if (info) return titleInfo(el, Number(info.dataset.info));
    const orders = e.target.closest('[data-orders]');
    if (orders) return whoOrdered(Number(orders.dataset.orders));
    // Click an FOC or Out date to see only the titles in that week (the dropdowns follow).
    const date = e.target.closest('[data-date]');
    if (date) {
      const key = date.dataset.dateField === 'foc_date' ? 'foc' : 'release';
      state = { ...state, [key]: weekStart(date.dataset.date), offset: 0 };
      syncDateSelects(el);
      load(el);
    }
  });
  loadDateOptions(el);
  await load(el);
}

/** Today as YYYY-MM-DD on this computer's clock (the shop's day, not UTC). */
const localToday = () => new Date().toLocaleDateString('en-CA');
/** The week the "FOC" tab shows: this week until Tuesday, then (from Wednesday, new-release day) next week's cutoffs. */
const focTabWeek = () => {
  const today = localToday();
  const weekday = new Date(`${today}T12:00:00`).getDay(); // 0 = Sunday
  return weekday >= 3 ? addDays(weekStart(today), 7) : weekStart(today);
};
const focTabLabel = () => (focTabWeek() === weekStart(localToday()) ? 'FOC This Week' : 'FOC Next Week');
/** The weeks the dropdowns list individually run from the shop week 13 weeks (about 3 months) back to the one 13 weeks ahead. Anything before is "Earlier", anything after is "Later". */
const windowStart = () => weekStart(addDays(localToday(), -91));
const laterFrom = () => addDays(weekStart(addDays(localToday(), 91)), 7);

/** Narrow a query to one dropdown choice: a shop week, "earlier", "later", or "none" (no date). */
function byWeek(q, column, value) {
  if (value === 'none') return q.is(column, null);
  if (value === 'earlier') return q.lt(column, windowStart());
  if (value === 'later') return q.gte(column, laterFrom());
  return q.gte(column, value).lt(column, addDays(value, 7));
}

/**
 * The FOC week and Out week dropdowns: one entry per shop week (Sunday to Saturday) with how many titles
 * fall in it: this week and the next 3 months (soonest first), a single "Later" entry for anything after that,
 * the past 3 months (most recent first), a single "Earlier" entry for anything before that, and "No date".
 */
async function loadDateOptions(el) {
  const counts = { foc: new Map(), release: new Map() };
  const none = { foc: 0, release: 0 };
  try {
    // Counted in the database (staff_item_week_counts), not by downloading every title's dates.
    for (const r of await must(sb.rpc('staff_item_week_counts'))) {
      if (r.w) counts[r.k].set(r.w, r.n);
      else none[r.k] = r.n;
    }
  } catch (err) {
    console.error('Could not load the date lists', err);
    return;
  }
  const today = localToday();
  const from = windowStart();
  const after = laterFrom();
  const titles = (n) => `${n.toLocaleString()} ${n === 1 ? 'title' : 'titles'}`;
  for (const [key, map] of Object.entries(counts)) {
    const select = $(`select[name="${key}"]`, el);
    if (!select) continue;
    const weeks = [...map.keys()].sort();
    const upcoming = weeks.filter((w) => addDays(w, 6) >= today && w < after);
    const later = weeks.filter((w) => w >= after).reduce((n, w) => n + map.get(w), 0);
    const recent = weeks.filter((w) => addDays(w, 6) < today && w >= from).reverse();
    const earlier = weeks.filter((w) => w < from).reduce((n, w) => n + map.get(w), 0);
    const opts = (list) => list.map((w) => `<option value="${w}">${esc(`${weekLabel(w)} · ${titles(map.get(w))}`)}</option>`).join('');
    const day = (iso) => esc(fmtDate(iso, { month: 'short', day: 'numeric' }));
    select.innerHTML = `<option value="">All weeks</option>${upcoming.length ? `<optgroup label="This week and the next 3 months">${opts(upcoming)}</optgroup>` : ''}${later ? `<option value="later">Later (from ${day(after)}) · ${titles(later)}</option>` : ''}${recent.length ? `<optgroup label="Past 3 months">${opts(recent)}</optgroup>` : ''}${earlier ? `<option value="earlier">Earlier (before ${day(from)}) · ${titles(earlier)}</option>` : ''}${none[key] ? `<option value="none">No date · ${titles(none[key])}</option>` : ''}`;
  }
  syncDateSelects(el);
}

/** "Oct 18–24" or "Dec 27 – Jan 2" for the week starting `start`, with the year when it isn't this year. */
function weekLabel(start) {
  const end = addDays(start, 6);
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  const a = fmtDate(start, { month: 'short', day: 'numeric' });
  const b = fmtDate(end, sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' });
  const year = start.slice(0, 4) === new Date().toISOString().slice(0, 4) ? '' : `, ${start.slice(0, 4)}`;
  return `${a}${sameMonth ? '–' : ' – '}${b}${year}`;
}

/** Show the chosen weeks in the dropdowns (a week picked by clicking a date in the list may not be in them yet). */
function markWeekTabs(el) {
  const thisWeek = weekStart(localToday());
  const current = !state.foc && !state.release ? 'all' : state.foc === focTabWeek() && !state.release ? 'foc' : state.release === thisWeek && !state.foc ? 'release' : '';
  $$('[data-weektab]', el).forEach((b) => b.setAttribute('aria-selected', b.dataset.weektab === current));
}

function syncDateSelects(el) {
  markWeekTabs(el);
  for (const key of ['foc', 'release']) {
    const select = $(`select[name="${key}"]`, el);
    if (!select) continue;
    if (state[key] && ![...select.options].some((o) => o.value === state[key])) select.append(new Option({ earlier: 'Earlier', later: 'Later', none: 'No date' }[state[key]] ?? weekLabel(state[key]), state[key]));
    select.value = state[key];
  }
}

/** The items query for the tab, filters and sort now chosen, so the list and its export always agree. */
function filteredTitles(columns, options) {
  let q = sb.from('items').select(columns, options);
  // Same matching as the site search ("spiderman 7" finds SPIDER-MAN #7), plus SKU, UPC and ISBN as typed.
  const match = titleFilter(state.q, { codes: true });
  if (match) q = q.or(match);
  if (state.status) q = q.eq('status', state.status);
  if (state.category === 'none') q = q.is('category_id', null);
  else if (state.category) q = q.eq('category_id', Number(state.category));
  if (state.foc) q = byWeek(q, 'foc_date', state.foc);
  if (state.release) q = byWeek(q, 'release_date', state.release);
  if (state.flag === 'staff_pick') q = q.eq('staff_pick', true);
  if (state.flag === 'featured') q = q.eq('featured', true);
  if (state.flag === 'hidden') q = q.eq('hidden', true);
  if (state.flag === 'badged') q = q.neq('badges', '{}');
  if (state.flag === 'no_cover') q = q.is('cover_url', null);
  if (state.flag === 'no_price') q = q.is('price', null);
  if (state.visibility === 'visible') q = q.eq('hidden', false);
  const asc = state.dir === 'asc';
  return state.sort === 'publisher' ? q.order('publisher', { ascending: asc, nullsFirst: false }).order('title', { ascending: true }).order('issue_number', { ascending: true }).order('variant', { ascending: true, nullsFirst: true })
    : state.sort === 'title' ? q.order('title', { ascending: asc }).order('issue_number', { ascending: asc }).order('variant', { ascending: asc, nullsFirst: asc })
    : q.order(SORT_COLUMN[state.sort] ?? 'updated_at', { ascending: asc, nullsFirst: false });
}

// The first columns use the Import screen's header names (js/import/distributors.js). ComicStore's Import also reads
// Distributor and Hidden, so its existing titles match on distributor + SKU instead of being added again.
const EXPORT_HEADER = ['Title', 'Issue', 'Variant', 'Publisher', 'Category', 'Price', 'FOC Date', 'Release Date', 'UPC', 'ISBN', 'SKU', 'Creators', 'Description', 'Mature', 'Cover URL', 'Status', 'Distributor', 'Hidden'];
const EXPORT_COLUMNS = 'title,issue_number,variant,publisher,category_id,price,foc_date,release_date,upc,isbn,sku,creators,description,mature,cover_url,status,distributor,hidden';
const yesNo = (v) => (v ? 'Y' : 'N');

/** Master catalog only: download every title the current tab and filters match, on all pages, in the list's order. */
async function exportTitles(btn) {
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Exporting…';
  try {
    const names = new Map(categories.map((c) => [c.id, c.name]));
    const items = await fetchAll(() => filteredTitles(EXPORT_COLUMNS).order('id'));
    if (!items.length) return toast('No titles match, so there is nothing to export.', 'error');
    downloadCsv(`titles-${localToday()}.csv`, EXPORT_HEADER, items.map((i) => [i.title, i.issue_number, i.variant, i.publisher, names.get(i.category_id), i.price, i.foc_date, i.release_date, i.upc, i.isbn, i.sku, i.creators, i.description, yesNo(i.mature), i.cover_url, STATUS_LABELS[i.status] ?? i.status, i.distributor, yesNo(i.hidden)]), { textColumns: ['Issue', 'UPC', 'ISBN', 'SKU'] });
    toast(`Exported ${items.length.toLocaleString()} ${items.length === 1 ? 'title' : 'titles'}.`);
  } catch (err) {
    toast(`Export failed: ${friendlyError(err)}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

// Sync now: starts the master catalog sync (staff_catalog_sync_now → the catalog-sync Edge Function), then watches
// catalog_sync_state until that run has finished and reloads the list.
const SYNC_POLL_MS = 5000;
const SYNC_WAIT_MS = 3 * 60000;

async function syncNow(el, btn) {
  btn.disabled = true;
  const text = $('span', btn); // beside the icon
  text.textContent = 'Syncing…';
  const done = () => ((btn.disabled = false), (text.textContent = 'Sync now'));
  let asked;
  try {
    asked = await must(sb.rpc('staff_catalog_sync_now'));
  } catch (err) {
    done();
    return toast(`Couldn’t start the sync: ${friendlyError(err)}`, 'error');
  }
  if (!asked.started) toast('A sync is already running; showing its result when it finishes.');
  const since = Date.parse(asked.requested_at);
  const until = Date.now() + SYNC_WAIT_MS;
  const check = async () => {
    if (!btn.isConnected) return;
    const st = await sb.from('catalog_sync_state').select('last_run_at,last_ok_at,last_error,last_inserted,last_updated').eq('id', 1).single().then((r) => r.data, () => null);
    if (st?.last_run_at && Date.parse(st.last_run_at) >= since) {
      done();
      if (st.last_ok_at !== st.last_run_at) return toast(`The sync failed: ${st.last_error ?? 'no reason given'}`, 'error');
      const n = (st.last_inserted ?? 0) + (st.last_updated ?? 0);
      toast(n ? `Synced: ${st.last_inserted ?? 0} new, ${st.last_updated ?? 0} updated.` : 'Synced: the titles were already up to date.');
      return load(el);
    }
    if (Date.now() > until) {
      done();
      return toast('The sync hasn’t answered yet. It keeps going on its own; check back in a few minutes.', 'error');
    }
    setTimeout(check, SYNC_POLL_MS);
  };
  setTimeout(check, SYNC_POLL_MS);
}

async function load(el) {
  const tbody = $('tbody', el);
  const wrap = tbody.closest('.admin-table-wrap');
  wrap.dataset.loading = ''; // the spinner over the list (see .admin-table-wrap[data-loading])
  $('[data-count]', el).textContent = 'Loading titles…';
  const q = filteredTitles('id,title,issue_number,variant,publisher,upc,isbn,status,foc_date,release_date,staff_pick,featured,hidden,cover_url,sku,distributor,category_id', { count: 'exact' });
  const { data, count, error } = await q.order('id').range(state.offset, state.offset + PAGE - 1);
  delete wrap.dataset.loading;
  if (error) {
    $('[data-count]', el).textContent = '';
    tbody.innerHTML = `<tr><td colspan="8" class="form-error">${esc(friendlyError(error))}</td></tr>`;
    return;
  }
  $('[data-count]', el).textContent = `${count.toLocaleString()} ${count === 1 ? 'title' : 'titles'}`;
  $('[data-page]', el).textContent = count ? `${state.offset + 1}–${Math.min(state.offset + PAGE, count)} of ${count.toLocaleString()}` : '';
  $('[data-prev]', el).disabled = state.offset === 0;
  $('[data-next]', el).disabled = state.offset + PAGE >= count;
  tbody.innerHTML = data.length
    ? data
        .map(
          (i) => `<tr data-id="${i.id}"${i.hidden ? ' class="is-hidden"' : ''}>
        <td class="tt-thumb">${i.cover_url ? `<img class="thumb" src="${esc(i.cover_url)}" alt="" loading="lazy">` : `<a class="thumb thumb--fix" href="${coverSearchUrl(i)}" target="_blank" rel="noopener noreferrer" title="Find a cover (opens Google Images in a new tab)" aria-label="Find a cover for ${esc(i.title)} (opens Google Images in a new tab)">${solidIcon('fix', 18)}<span>Fix</span></a>`}</td>
        <td class="tt-title"><button class="tt-datelink" type="button" data-info="${i.id}" title="See everything about this title"><strong>${esc(i.title)}${i.issue_number ? ` #${esc(i.issue_number)}` : ''}</strong></button>${i.variant ? `<br><span class="card__meta">${esc(i.variant)}</span>` : ''}<br><span class="card__meta">${esc(i.publisher ?? '')}${i.sku ? ` · ${esc(i.sku)}` : ''}</span><span class="tt-orders" data-orders-for="${i.id}"></span></td>
        <td class="tt-status"><label class="visually-hidden" for="st-${i.id}">Status</label><select id="st-${i.id}" data-field="status" class="select--small">${Object.entries(STATUS_LABELS).map(([v, l]) => `<option value="${v}"${v === i.status ? ' selected' : ''}>${l}</option>`).join('')}</select></td>
        <td class="nowrap tt-dates">${i.foc_date ? `<span><button class="tt-datelink" type="button" data-date-field="foc_date" data-date="${i.foc_date}" title="Show only titles with an order cutoff this week">FOC ${fmtDate(i.foc_date, { month: 'short', day: 'numeric' })}</button></span>` : ''}${i.release_date ? `<span><button class="tt-datelink" type="button" data-date-field="release_date" data-date="${i.release_date}" title="Show only titles out this week">Out ${fmtDate(i.release_date)}</button></span>` : ''}</td>
        <td class="center tt-flag tt-flag--1" data-label="Staff"><input type="checkbox" data-field="staff_pick" aria-label="Staff pick"${i.staff_pick ? ' checked' : ''}></td>
        <td class="center tt-flag tt-flag--2" data-label="Home"><input type="checkbox" data-field="featured" aria-label="Show on homepage"${i.featured ? ' checked' : ''}></td>
        <td class="center tt-flag tt-flag--3" data-label="Hide"><input type="checkbox" data-field="hidden" aria-label="Hidden from customers"${i.hidden ? ' checked' : ''}></td>
        <td class="tt-edit"><button class="btn btn--ghost btn--small" type="button" data-edit="${i.id}">${solidIcon('edit', 16)} Edit<span class="visually-hidden"> ${esc(i.title)}</span></button></td>
      </tr>`,
        )
        .join('')
    : '<tr><td colspan="8" class="empty">No titles match.</td></tr>';
  showOrderCounts(el, data.map((i) => i.id));
}

/** Lines that still count as someone wanting the title (not cancelled, not given up). */
const LIVE_LINE = ['open', 'ordered', 'reordered', 'arrived', 'picked_up'];

/** Under each title on the page: how many customers have it on order ("No orders" when none), as a link to the list of who. */
async function showOrderCounts(el, ids) {
  if (!ids.length) return;
  const { data, error } = await sb.from('reservations').select('item_id,quantity,order_id').in('item_id', ids).in('status', LIVE_LINE).limit(5000);
  const byItem = new Map();
  for (const l of data ?? []) {
    const t = byItem.get(l.item_id) ?? { orders: new Set(), copies: 0 };
    t.orders.add(l.order_id);
    t.copies += l.quantity;
    byItem.set(l.item_id, t);
  }
  if (error) return; // no count rather than a wrong "No orders"
  for (const id of ids) {
    const slot = $(`[data-orders-for="${id}"]`, el);
    if (!slot) continue; // the list was reloaded meanwhile
    const t = byItem.get(id);
    const who = t ? `${t.orders.size} ${t.orders.size === 1 ? 'order' : 'orders'}${t.copies !== t.orders.size ? ` · ${t.copies} copies` : ''}` : 'No orders';
    slot.innerHTML = `<br><button class="tt-datelink${t ? '' : ' text-muted'}" type="button" data-orders="${id}" title="See who ordered this title">${who}</button>`;
  }
}

/** Everyone who reserved a title: name (to their customer page or guest order), phone, email, copies, status and when. */
async function whoOrdered(itemId, { onLeave = () => true } = {}) {
  const d = openDialog('Who Ordered', '<p class="admin-hint" aria-busy="true">Loading…</p>', { wide: true });
  const body = $('.dialog__body', d);
  try {
    const [item, lines, locations] = await Promise.all([
      must(sb.from('items').select('id,title,issue_number,variant,publisher,foc_date,release_date,status,hidden').eq('id', itemId).single()),
      fetchAll(() => sb.from('reservations').select('id,quantity,status,created_at,location_id,order:reservation_orders(id,name,phone,email,customer_id,customer:customers(id,name,first_name,last_name,phone,email))').eq('item_id', itemId).order('id')),
      listLocations(sb),
    ]);
    // Guest orders placed with a customer's email show (and link to) that customer.
    await withCustomers(sb, lines.map((l) => l.order).filter(Boolean));
    const place = new Map(locations.map((l) => [l.id, l.name]));
    const live = lines.filter((l) => LIVE_LINE.includes(l.status));
    const rank = (l) => (LIVE_LINE.includes(l.status) ? 0 : 1);
    // Shown and sorted as "Last, First". Guest orders only have one name field: the last word is the surname.
    for (const l of lines) {
      const c = l.order?.customer;
      if (c?.last_name) Object.assign(l, { last: c.last_name, first: c.first_name ?? '' });
      else {
        const words = (l.order?.name || 'Unknown').trim().split(/\s+/);
        Object.assign(l, { last: words.pop(), first: words.join(' ') });
      }
    }
    const byName = (a, b) => a.last.localeCompare(b.last, undefined, { sensitivity: 'base' }) || a.first.localeCompare(b.first, undefined, { sensitivity: 'base' });
    lines.sort((a, b) => rank(a) - rank(b) || byName(a, b));
    const counts = new Map();
    for (const l of lines) counts.set(l.status, (counts.get(l.status) ?? 0) + 1);
    const dates = [item.foc_date && `FOC ${fmtDate(item.foc_date)}`, item.release_date && `Out ${fmtDate(item.release_date)}`].filter(Boolean).join(' · ');
    const name = (l) => {
      const label = `<strong>${esc([l.last, l.first].filter(Boolean).join(', '))}</strong>`;
      const o = l.order;
      if (!o) return label;
      if (o.customer_id) return `<a href="#customers" data-customer="${o.customer_id}">${label}</a>`;
      return `<a href="#reservations" data-guest="${o.id}">${label}</a> <span class="pill">Guest order</span>`;
    };
    const email = (l) => (l.order?.email ? `<button type="button" class="btn btn--ghost btn--small cust-email" title="Write an email to ${esc(l.order.email)}" aria-label="Email ${esc(l.order.name || l.order.email)}" data-email-to="${esc(l.order.email)}" data-email-name="${esc(l.first || l.order.name || '')}"${l.order.customer_id ? ` data-email-customer="${l.order.customer_id}"` : ''}>Email</button>` : '');
    body.innerHTML = `
      <p><strong>${esc(itemName(item))}</strong>${item.publisher ? ` · ${esc(item.publisher)}` : ''}${dates ? `<br><span class="card__meta">${dates}</span>` : ''}</p>
      ${IS_CATALOG ? '' : `<div class="admin-actions"><button class="btn btn--add btn--small" type="button" data-add-to-list>${solidIcon('add', 16)} Add to a pull list</button></div>`}
      <p class="results-count">${live.length} ${live.length === 1 ? 'order' : 'orders'} · ${live.reduce((n, l) => n + l.quantity, 0)} copies${counts.size ? ` <span class="card__meta">(${[...counts].map(([st, n]) => `${n} ${esc((LINE_STATUS[st] ?? st).toLowerCase())}`).join(', ')})</span>` : ''}</p>
      ${lines.length ? `<div class="admin-table-wrap"><table class="admin-table cards">
        <thead><tr><th scope="col" class="col-cust-name">Name</th><th scope="col">Phone</th><th scope="col">Email</th><th scope="col" class="center">Qty</th><th scope="col">Status</th><th scope="col">Placed</th>${place.size ? '<th scope="col">Location</th>' : ''}</tr></thead>
        <tbody>${lines.map((l) => `<tr${rank(l) ? ' class="is-hidden"' : ''}><td class="card-title">${name(l)}</td><td class="nowrap">${esc(formatPhone(l.order?.phone ?? ''))}</td><td class="card-action">${email(l)}</td><td class="center card-key card-label">${l.quantity}</td><td class="card-key"><span class="pill pill--${esc(l.status)}">${esc(LINE_STATUS[l.status] ?? l.status)}</span></td><td class="card__meta nowrap">${fmtDateTime(l.created_at)}</td>${place.size ? `<td>${esc(place.get(l.location_id) ?? '')}</td>` : ''}</tr>`).join('')}</tbody>
      </table></div>` : '<p class="empty">Nobody has ordered this title.</p>'}`;
    body.addEventListener('click', (e) => {
      if (e.target.closest('[data-add-to-list]')) return addToPullList(item, { onAdded: () => (d.close(), whoOrdered(itemId, { onLeave })) });
      const link = e.target.closest('[data-customer], [data-guest]');
      if (!link) return;
      if (!onLeave()) return e.preventDefault();
      try {
        if (link.dataset.customer) sessionStorage.setItem('admin-open-customer', link.dataset.customer);
        else sessionStorage.setItem('admin-open-guest', link.dataset.guest);
      } catch {
        /* the link still opens the list */
      }
      d.close();
    });
  } catch (err) {
    body.innerHTML = `<p class="form-error">${esc(friendlyError(err))}</p>`;
  }
}

/** Put this title on a customer's pull list, from Title Info or Who Ordered: find the customer (name, phone, email or
 *  #pickup code), choose the copies, Add. A pre-order or Coming Soon title goes on their list as the Customers screen
 *  adds it (staff_pull_list_add); a title that's out goes on as a re-order for them, as Ordering → Re-order does
 *  (staff_reorder). The dialog stays open for the next customer; onAdded runs when it closes after any adds. */
function addToPullList(item, { onAdded = () => {} } = {}) {
  const preorder = ['pre_order', 'coming_soon'].includes(item.status);
  if (item.hidden && preorder) return void openDialog('Add to a Pull List', `<p><strong>${esc(itemName(item))}</strong></p>
    <p class="admin-hint">This title is hidden from customers, so it can’t go on a pull list until it’s shown again (Edit → untick Hidden from customers).</p>`);
  const how = item.status === 'pre_order' ? 'It goes on their pull list and is ordered with the rest at the order cutoff.'
    : item.status === 'coming_soon' ? 'The order cutoff has passed: it goes on their pull list, but check the copies are in the distributor order.'
    : 'This title is already out, so it goes on their pull list as a re-order (Ordering → Re-order).';
  const d = openDialog('Add to a Pull List', `
    <p><strong>${esc(itemName(item))}</strong></p>
    <p class="admin-hint">${how}</p>
    <div class="field field--search"><label for="atl-q">Customer</label><input id="atl-q" type="search" placeholder="Name, phone, email or #pickup code" autocomplete="off"></div>
    <div data-atl-results></div>`);
  const results = $('[data-atl-results]', d);
  let added = 0;
  d.addEventListener('close', () => added && onAdded());
  const search = async (text) => {
    const q = text.trim();
    const code = q.match(/^#\s*(\d{1,9})$/)?.[1];
    const match = code ? null : customerFilter(q, { words: true });
    if (q.length < 2 || (!code && !match)) return void (results.innerHTML = '');
    const base = sb.from('customer_list').select('id,name,email,phone');
    const { data, error } = await (code ? base.eq('id', Number(code)) : base.or(match).order('name')).limit(8);
    if (error) return void (results.innerHTML = `<p class="form-error">${esc(friendlyError(error))}</p>`);
    results.innerHTML = data.length
      ? `<ul class="cust-results">${data.map((c) => `<li>
          <span><strong>${esc(c.name || c.email || 'No name')}</strong><br><span class="card__meta">${esc([`#${c.id}`, c.phone && formatPhone(c.phone), c.email].filter(Boolean).join(' · '))}</span></span>
          <span class="cust-results__act">
            <label class="visually-hidden" for="atl-qty-${c.id}">Copies</label><input id="atl-qty-${c.id}" class="cust-qty" type="number" min="1" max="100" value="1">
            <button class="btn btn--add btn--small" type="button" data-atl-add="${c.id}" aria-label="Add to ${esc(c.name || c.email || 'this customer')}'s pull list">${solidIcon('add', 16)} Add</button>
          </span></li>`).join('')}</ul>`
      : '<p class="empty">No customers match.</p>';
  };
  $('#atl-q', d).addEventListener('input', debounce((e) => search(e.target.value), 300));
  results.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-atl-add]');
    if (!btn) return;
    const customer = Number(btn.dataset.atlAdd);
    const who = btn.closest('li').querySelector('strong').textContent;
    const qty = Math.min(Math.max(Math.round(Number($(`#atl-qty-${customer}`, results).value)) || 1, 1), 100);
    btn.disabled = true;
    const { data, error } = preorder
      ? await sb.rpc('staff_pull_list_add', { p_customer: customer, p_item_id: item.id, p_quantity: qty, p_all_covers: false })
      : await sb.rpc('staff_reorder', { p_item_id: item.id, p_quantity: qty, p_customer: customer, p_location: null });
    if (error) return (btn.disabled = false), toast(friendlyError(error), 'error');
    if (preorder && !data?.added) return (btn.disabled = false), toast(`Already on ${who}'s pull list`, 'error');
    added++;
    btn.replaceWith(Object.assign(document.createElement('span'), { className: 'card__meta', textContent: '✓ Added' }));
    toast(`${itemName(item)} × ${qty} added to ${who}'s pull list${preorder ? '' : ' as a re-order'}`);
  });
  $('#atl-q', d).focus();
}

// After an edit or delete, the Titles list (when Title Info was opened from it) shows the change.
const refresh = (listEl) => listEl && (load(listEl), loadDateOptions(listEl));

/** Title Info opened from another screen (Ordering): the same dialog, with no Titles list to refresh after an edit. */
export async function showTitleInfo(ctx, id) {
  sb = ctx.sb;
  isOwner = ctx.isOwner === true;
  if (!categories.length) categories = await must(sb.from('categories').select('id,name,slug').order('sort'));
  return titleInfo(null, id);
}

/** Everything about one title at a glance (read-only), with Edit and Who ordered. Opened by clicking its name in the list. */
async function titleInfo(listEl, id) {
  const d = openDialog('Title Info', '<p class="admin-hint" aria-busy="true">Loading…</p>', { wide: true });
  const body = $('.dialog__body', d);
  try {
    const [item, lines] = await Promise.all([
      must(sb.from('items').select('*').eq('id', id).single()),
      must(sb.from('reservations').select('quantity,order_id').eq('item_id', id).in('status', LIVE_LINE).limit(5000)),
    ]);
    const orders = new Set(lines.map((l) => l.order_id)).size;
    const copies = lines.reduce((n, l) => n + l.quantity, 0);
    const category = categories.find((c) => c.id === item.category_id)?.name;
    const source = item.catalog_id ? 'Master catalog' : { lunar: 'Lunar', prh: 'PRH' }[item.distributor] ?? 'Added by hand';
    // Laid out like the shop's own title details (cover beside the title, description under it), plus what only staff see.
    const pills = [
      `<span class="pill pill--${esc(item.status)}">${esc(STATUS_LABELS[item.status] ?? item.status)}</span>`,
      ...[item.staff_pick && 'Staff pick', item.featured && 'On homepage', item.hidden && 'Hidden', item.mature && 'Mature readers'].filter(Boolean).map((f) => `<span class="pill">${esc(f)}</span>`),
      ...Object.entries(ITEM_BADGES).filter(([k]) => item.badges?.includes(k)).map(([, l]) => `<span class="pill">${esc(l)}</span>`),
    ];
    const retail = item.retail_price ?? item.price;
    const meta = [item.publisher, retail != null && `${price(retail)} retail`, item.shop_price != null && `${price(item.shop_price)} shop price`].filter(Boolean);
    const longDate = (iso) => fmtDate(iso, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const paragraphs = String(item.description ?? '').split(/\n{2,}/).map((t) => t.trim()).filter(Boolean);
    const more = [
      ['Category', category ?? 'None'],
      ['SKU', item.sku],
      ['UPC', item.upc],
      ['ISBN', item.isbn],
      ['Source', source],
      ['Last changed', fmtDateTime(item.updated_at)],
    ].filter(([, v]) => v);
    body.innerHTML = `
      <div class="title-info">
        <div class="title-info__media">${item.cover_url ? `<img class="thumb thumb--lg" src="${esc(item.cover_url)}" alt="Cover of ${esc(itemName(item))}">` : `<a class="thumb thumb--lg thumb--fix" href="${coverSearchUrl(item)}" target="_blank" rel="noopener noreferrer" aria-label="Find a cover for ${esc(item.title)} (opens Google Images in a new tab)">${solidIcon('fix', 24)}<span>Find a cover</span></a>`}</div>
        <div class="title-info__main">
          <p class="title-info__pills">${pills.join(' ')}</p>
          <h3 class="title-info__title">${esc(item.title)}${item.issue_number ? ` #${esc(item.issue_number)}` : ''}</h3>
          ${item.variant ? `<p class="title-info__variant">${esc(item.variant)}</p>` : ''}
          ${meta.length ? `<p class="card__meta">${meta.map(esc).join(' · ')}</p>` : ''}
          <dl class="info-list">
            ${item.foc_date ? `<dt>Order cutoff</dt><dd>${esc(longDate(item.foc_date))}</dd>` : ''}
            ${item.release_date ? `<dt>${item.release_date > new Date().toLocaleDateString('en-CA') ? 'Out' : 'Released'}</dt><dd>${esc(longDate(item.release_date))}</dd>` : ''}
            <dt>Orders</dt><dd><button class="tt-datelink" type="button" data-who-ordered>${orders ? `${orders} ${orders === 1 ? 'order' : 'orders'}${copies !== orders ? ` · ${copies} copies` : ''}` : 'No orders'}</button></dd>
          </dl>
          ${paragraphs.length ? `<div class="title-info__desc">${paragraphs.map((t) => `<p>${esc(t)}</p>`).join('')}</div>` : ''}
          ${item.creators ? `<p class="card__meta">By ${esc(item.creators)}</p>` : ''}
        </div>
      </div>
      <section class="title-info__more" aria-label="More about this title">
        <h4>More</h4>
        <dl class="info-list">${more.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      </section>
      <div class="admin-actions sticky-actions">
        <button class="btn btn--primary" type="button" data-edit-title>${solidIcon('edit', 16)} Edit</button>
        <button class="btn btn--ghost" type="button" data-who-ordered>${solidIcon('person', 16)} Who ordered</button>
        ${IS_CATALOG ? '' : `<button class="btn btn--add" type="button" data-add-to-list>${solidIcon('add', 16)} Add to a pull list</button>`}
      </div>`;
    $('[data-edit-title]', d).addEventListener('click', () => (d.close(), edit(listEl, id)));
    $('[data-add-to-list]', d)?.addEventListener('click', () => addToPullList(item, { onAdded: () => (d.close(), titleInfo(listEl, id)) }));
    $$('[data-who-ordered]', d).forEach((b) => b.addEventListener('click', () => whoOrdered(id, { onLeave: () => (d.close(), true) })));
  } catch (err) {
    body.innerHTML = `<p class="form-error">${esc(friendlyError(err))}</p>`;
  }
}

async function edit(listEl, id) {
  const item = id ? await must(sb.from('items').select('*').eq('id', id).single()) : { status: 'pre_order', distributor: 'other', mature: false, staff_pick: false, featured: false, hidden: false, badges: [] };
  const opt = (v, label, cur) => `<option value="${esc(v)}"${String(v) === String(cur ?? '') ? ' selected' : ''}>${esc(label)}</option>`;
  const d = openDialog(id ? 'Edit Title' : 'New Title', `
    <form class="admin-form" novalidate>
      ${item.catalog_id ? hintFold('From the master catalog. Its title, retail price, dates, description, creators and cover follow the catalog (checked hourly); your shop price, status, category, badges, staff pick, homepage and hidden are yours and never change.') : ''}
      ${!item.catalog_id && item.distributor && item.distributor !== 'other' ? hintFold(`Imported from ${item.distributor === 'lunar' ? 'Lunar' : 'PRH'} (${esc(item.sku)}). Re-importing its sheet refreshes title, retail price, dates and description, but never the shop price, status, category, badges, staff pick, homepage or hidden.`) : ''}
      <div class="form-grid form-grid--pairs">
        <div class="field span-2"><label for="e-title">Title <span class="req" aria-hidden="true">*</span></label><input id="e-title" name="title" required autocapitalize="words" value="${esc(item.title)}"></div>
        <div class="field"><label for="e-issue">Issue #</label><input id="e-issue" name="issue_number" value="${esc(item.issue_number)}"></div>
        <div class="field"><label for="e-publisher">Publisher</label><input id="e-publisher" name="publisher" autocapitalize="words" value="${esc(item.publisher)}"></div>
        <div class="field span-2"><label for="e-variant">Variant / edition</label><input id="e-variant" name="variant" autocapitalize="words" value="${esc(item.variant)}"></div>
        <div class="field"><label for="e-status">Status</label><select id="e-status" name="status">${Object.entries(STATUS_LABELS).map(([v, l]) => opt(v, l, item.status)).join('')}</select></div>
        <div class="field"><label for="e-category">Category</label><select id="e-category" name="category_id">${opt('', 'None', item.category_id)}${categories.map((c) => opt(c.id, c.name, item.category_id)).join('')}</select></div>
        <div class="field"><label for="e-retail">Retail price ($)</label><input id="e-retail" name="retail_price" type="number" inputmode="decimal" step="0.01" min="0" value="${item.retail_price ?? item.price ?? ''}"></div>
        <div class="field"><label for="e-shop-price">Shop price ($)</label><input id="e-shop-price" name="shop_price" type="number" inputmode="decimal" step="0.01" min="0" value="${item.shop_price ?? ''}" placeholder="Blank = retail"></div>
        <p class="field__hint span-2">Shop price is what customers are charged instead of retail (blank = sell at retail). Kept when the title is re-imported.</p>
        <div class="field"><label for="e-foc">Order cutoff (FOC)</label><input id="e-foc" name="foc_date" type="date" value="${item.foc_date ?? ''}"></div>
        <div class="field"><label for="e-release">Release date</label><input id="e-release" name="release_date" type="date" value="${item.release_date ?? ''}"></div>
        <div class="field field--full"><label for="e-creators">Creators</label><input id="e-creators" name="creators" autocapitalize="words" value="${esc(item.creators)}"></div>
        <div class="field"><label for="e-upc">UPC</label><input id="e-upc" name="upc" inputmode="numeric" value="${esc(item.upc)}"></div>
        <div class="field"><label for="e-isbn">ISBN</label><input id="e-isbn" name="isbn" value="${esc(item.isbn)}"></div>
        <div class="field"><label for="e-sku">SKU</label><input id="e-sku" name="sku" autocapitalize="characters" spellcheck="false" value="${esc(item.sku)}"></div>
        <p class="field__hint span-2">The distributor’s code for this title. Imports and the master catalog match titles by SKU, so if you change it, the next import adds a new title instead of updating this one.</p>
        ${IS_CATALOG ? `<div class="field span-2">
          <div class="admin-actions"><button class="btn btn--ghost btn--small" type="button" data-prh>Fill in from PRH</button><span class="admin-status" role="status" data-prh-status></span></div>
          <p class="field__hint">Looks the ISBN (or UPC) up at Penguin Random House and fills in the fields that are blank, and the cover if there isn’t one. Nothing you’ve typed is replaced.</p>
        </div>` : ''}
        <div class="field span-2"><label for="e-desc">Description</label><textarea id="e-desc" name="description" rows="4">${esc(item.description)}</textarea></div>
        <div class="field span-2 checks">
          <label><input type="checkbox" name="staff_pick"${item.staff_pick ? ' checked' : ''}> Staff pick</label>
          <label><input type="checkbox" name="featured"${item.featured ? ' checked' : ''}> Show on homepage</label>
          <label><input type="checkbox" name="hidden"${item.hidden ? ' checked' : ''}> Hidden from customers</label>
          <label><input type="checkbox" name="mature"${item.mature ? ' checked' : ''}> Mature readers</label>
        </div>
        <fieldset class="field span-2 checks"><legend>Collector badges</legend>
          ${Object.entries(ITEM_BADGES).map(([k, l]) => `<label><input type="checkbox" name="badges" value="${k}"${item.badges?.includes(k) ? ' checked' : ''}> ${l}</label>`).join('')}
        </fieldset>
        <div class="field span-2" data-cover></div>
      </div>
      <div class="admin-actions sticky-actions">
        <button class="btn btn--primary" type="submit">${id ? 'Save' : 'Create title'}</button>
        ${id ? `<button class="btn btn--ghost" type="button" data-who-ordered>${solidIcon('person', 16)} Who ordered</button>` : ''}
        ${id && isOwner ? `<button class="btn btn--danger" type="button" data-delete>${solidIcon('trash', 16)} Delete</button>` : ''}
        <span class="admin-status" role="status"></span>
      </div>
    </form>`, { wide: true });

  const cover = imageField($('[data-cover]', d), { folder: 'covers/manual', label: 'Cover image', maxSize: 1200, thumb: true });
  cover.set(item.cover_url, item.cover_thumb_url);
  const form = $('form', d);
  const status = $('.admin-status', d);
  // Following a name in Who Ordered leaves this screen, so it closes this dialog too (asking first if there are unsaved changes).
  let changed = false;
  form.addEventListener('input', () => (changed = true));
  $('[data-prh]', d)?.addEventListener('click', () => fillFromPrh(form, cover, $('[data-prh-status]', d)).then((n) => n && (changed = true)));
  $('[data-who-ordered]', d)?.addEventListener('click', () =>
    whoOrdered(id, { onLeave: () => (!changed || confirm('Leave without saving your changes to this title?') ? (d.close(), true) : false) }),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const text = (k) => f.get(k)?.trim() || null;
    const row = {
      title: text('title'), issue_number: text('issue_number'), variant: text('variant'), publisher: text('publisher'),
      status: f.get('status'), category_id: f.get('category_id') ? Number(f.get('category_id')) : null,
      retail_price: f.get('retail_price') ? Number(f.get('retail_price')) : null, shop_price: f.get('shop_price') ? Number(f.get('shop_price')) : null, foc_date: f.get('foc_date') || null, release_date: f.get('release_date') || null,
      creators: text('creators'), upc: text('upc'), isbn: text('isbn'), sku: text('sku'), description: text('description'),
      badges: f.getAll('badges'), staff_pick: f.has('staff_pick'), featured: f.has('featured'), hidden: f.has('hidden'), mature: f.has('mature'), cover_url: cover.get(), cover_thumb_url: cover.getThumb(),
    };
    if (!row.title) return setStatus(status, 'Please enter a title.', 'error');
    if (!id) row.distributor = 'other';
    const submit = $('button[type=submit]', form);
    if (submit.disabled) return; // already saving: a second click would add the title twice
    submit.disabled = true;
    setStatus(status, 'Saving…');
    try {
      if (id) await must(sb.from('items').update(row).eq('id', id));
      else await must(sb.from('items').insert(row));
      toast(id ? 'Title saved' : 'Title created');
      d.close();
      refresh(listEl);
    } catch (err) {
      setStatus(status, `Not saved: ${friendlyError(err)}`, 'error');
    } finally {
      submit.disabled = false;
    }
  });
  $('[data-delete]', d)?.addEventListener('click', async () => {
    // What deleting would touch: reservations stop it; exclusions are removed with it.
    const countOf = async (table) => (await sb.from(table).select('id', { count: 'exact', head: true }).eq('item_id', id)).count ?? 0;
    const [reserved, excluded] = await Promise.all([countOf('reservations'), sb.from('pull_list_exclusions').select('item_id', { count: 'exact', head: true }).eq('item_id', id).then((r) => r.count ?? 0)]).catch(() => [0, 0]);
    if (reserved) {
      return setStatus(status, `${reserved} ${reserved === 1 ? 'reservation is' : 'reservations are'} for this title, so it can’t be deleted. Tick “Hidden from customers” instead: it disappears from the site and keeps the history.`, 'error');
    }
    const notes = [];
    if (excluded) notes.push(`${excluded} ${excluded === 1 ? 'customer has' : 'customers have'} asked to keep this title off their pull list; ${excluded === 1 ? 'that request is' : 'those requests are'} removed too.`);
    if (item.distributor && item.distributor !== 'other') notes.push('It came from a distributor sheet: importing that sheet again adds it back. Hiding it keeps it off the site for good.');
    if (item.staff_pick || item.featured) notes.push(`It is currently ${[item.staff_pick && 'a staff pick', item.featured && 'on the home page'].filter(Boolean).join(' and ')}.`);
    if (!confirm([`Delete “${item.title}”? This can’t be undone.`, ...notes].join('\n\n'))) return;
    try {
      await must(sb.from('items').delete().eq('id', id));
      toast('Title deleted');
      d.close();
      refresh(listEl);
    } catch (err) {
      setStatus(status, err.code === '23503' ? 'Customers have reserved this title, so it can’t be deleted — mark it Hidden instead.' : `Not deleted: ${friendlyError(err)}`, 'error');
    }
  });
}

/**
 * "Fill in from PRH" (master catalog only): looks the form's ISBN or UPC up through the prh-lookup Edge Function
 * and fills in the blank fields, then the cover if there's none. Returns how many fields it filled.
 */
async function fillFromPrh(form, cover, status) {
  const code = (form.elements.isbn.value || form.elements.upc.value).replace(/[\s-]/g, '');
  if (!code) return setStatus(status, 'Enter an ISBN or UPC first.', 'error'), 0;
  const button = $('[data-prh]', form);
  button.disabled = true;
  setStatus(status, 'Looking it up…');
  try {
    const { data, error } = await sb.functions.invoke('prh-lookup', { body: { code } });
    if (error) throw new Error((await error.context?.json?.().catch(() => null))?.error ?? error.message);
    const found = prhApiItem(data.record, data.content);
    const inputs = { title: 'title', issue_number: 'issue_number', variant: 'variant', publisher: 'publisher', price: 'retail_price', foc_date: 'foc_date', release_date: 'release_date', creators: 'creators', upc: 'upc', isbn: 'isbn', description: 'description' };
    let filled = 0;
    for (const [field, name] of Object.entries(inputs)) {
      const input = form.elements[name];
      if (found[field] == null || input.value.trim()) continue;
      input.value = found[field];
      filled++;
    }
    const category = categories.find((c) => c.slug === found.category);
    if (category && !form.elements.category_id.value) (form.elements.category_id.value = String(category.id), filled++);
    if (found.mature && !form.elements.mature.checked) (form.elements.mature.checked = true, filled++);
    const needCover = !cover.get();
    if (needCover) setStatus(status, 'Getting the cover…');
    const gotCover = needCover && (await prhCover(code, cover).catch(() => false));
    const what = [filled && (filled === 1 ? '1 field' : `${filled} fields`), gotCover && 'the cover'].filter(Boolean).join(' and ');
    const noCover = needCover && !gotCover ? ' PRH has no cover for it yet.' : '';
    setStatus(status, what ? `Filled in ${what}. Check them, then save.${noCover}` : `PRH has nothing to add: every field it knows is already filled in.${noCover}`, what ? 'ok' : undefined);
    return filled + (gotCover ? 1 : 0);
  } catch (err) {
    setStatus(status, `Not looked up: ${friendlyError(err)}`, 'error');
    return 0;
  } finally {
    button.disabled = false;
  }
}

/** PRH's cover for a code, through fetch-cover (no CORS on PRH's images), uploaded like a cover picked by hand. */
async function prhCover(code, cover) {
  const { data: { session } } = await sb.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/fetch-cover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify({ url: `https://images.penguinrandomhouse.com/cover/${encodeURIComponent(code)}` }),
  });
  if (!res.ok) return false;
  const blob = await res.blob();
  if (blob.size < 1024) return false; // a blank placeholder, not a cover
  const saved = await uploadImage(new File([blob], `${code}.jpg`, { type: blob.type || 'image/jpeg' }), 'covers/manual', { maxSize: 1200, thumb: true });
  cover.set(saved.url, saved.thumbUrl);
  return true;
}

