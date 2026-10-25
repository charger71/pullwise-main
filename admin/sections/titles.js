// Titles: every item (pre-orders and in-store stock). Search and filter, quick
// changes in the list (status, staff pick, hidden), a full edit form, and who
// ordered each title.

import { $, $$, esc, must, toast, isPhone, openDialog, imageField, fmtDate, STATUS_LABELS, setStatus, sortableTable, titleFilter, solidIcon, friendlyError, hintFold, fetchAll, fmtDateTime, formatPhone, itemName, withCustomers, listLocations } from '../lib.js';
import { ITEM_BADGES } from '../../js/site.js';
import { LINE_STATUS } from '../../js/labels.js';
import { addDays, weekStart } from '../../js/dates.js';

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
  categories = await must(sb.from('categories').select('id,name').order('sort'));
  // On phones the less-used filters fold under "More filters" (open when one of them is set), so the list is on the first screen.
  const phone = isPhone();
  const moreOpen = ['flag', 'visibility', 'foc', 'release'].some((k) => state[k]) || (state.sort && state.sort !== 'updated');
  el.innerHTML = `
    <div class="admin-title-row">
      <h1>Titles</h1>
      <div class="admin-actions">
        <button class="btn btn--ghost" type="button" data-cleanup>Clean up old titles…</button>
        <button class="btn btn--add" type="button" data-new>${solidIcon('add', 18)} New title</button>
      </div>
    </div>
    <div class="admin-tabs" role="tablist">
      <button type="button" class="admin-tab" role="tab" data-weektab="all">All</button>
      <button type="button" class="admin-tab" role="tab" data-weektab="foc">${focTabLabel()}</button>
      <button type="button" class="admin-tab" role="tab" data-weektab="release">Out This Week</button>
    </div>
    <form class="filters admin-filters admin-filters--wide-search" role="search" aria-label="Filter titles">
      <div class="field field--search"><label for="t-q">Search</label><input id="t-q" name="q" type="search" placeholder="Title, variant, creator, SKU or UPC" value="${esc(state.q)}"></div>
      <div class="field"><label for="t-status">Status</label><select id="t-status" name="status"><option value="">All</option>${Object.entries(STATUS_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
      <div class="field"><label for="t-category">Category</label><select id="t-category" name="category"><option value="">All</option>${categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}<option value="none">No category</option></select></div>
      ${phone ? `<details class="filters-more"${moreOpen ? ' open' : ''}><summary>More filters</summary><div class="filters-more__grid">` : ''}<div class="field"><label for="t-flag">Show</label><select id="t-flag" name="flag"><option value="">Everything</option><option value="staff_pick">Staff picks</option><option value="featured">On homepage</option><option value="hidden">Hidden</option><option value="badged">Has collector badge</option><option value="no_cover">No cover</option><option value="no_price">No price</option></select></div>
      <div class="field"><label for="t-vis">Visibility</label><select id="t-vis" name="visibility"><option value="">Visible and hidden</option><option value="visible">Visible to customers</option></select></div>
      <div class="field"><label for="t-sort">Sort</label><select id="t-sort" name="sort"><option value="updated">Recently changed</option><option value="foc">Order cutoff</option><option value="release">Release date</option><option value="title">Title</option><option value="status">Status</option><option value="staff_pick">Staff pick</option><option value="featured">On homepage</option><option value="hidden">Hidden</option></select></div>
      <div class="field"><label for="t-foc">FOC week</label><select id="t-foc" name="foc"><option value="">All weeks</option></select></div>
      <div class="field"><label for="t-release">Out week</label><select id="t-release" name="release"><option value="">All weeks</option></select></div>
      ${phone ? '</div></details>' : ''}
    </form>
    <p class="results-count" role="status" data-count></p>
    <div class="admin-table-wrap"><table class="admin-table titles-table">
      <thead><tr><th scope="col" colspan="2" data-sort="title">Title</th><th scope="col" data-sort="status">Status</th><th scope="col" data-sort="foc">Cutoff / Out</th><th scope="col" data-sort="staff_pick" data-first="desc">Staff</th><th scope="col" data-sort="featured" data-first="desc">Home</th><th scope="col" data-sort="hidden" data-first="desc">Hide</th><th scope="col"><span class="visually-hidden">Edit</span></th></tr></thead>
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
  $('[data-prev]', el).addEventListener('click', () => ((state.offset = Math.max(0, state.offset - PAGE)), load(el)));
  $('[data-next]', el).addEventListener('click', () => ((state.offset += PAGE), load(el)));
  $('[data-new]', el).addEventListener('click', () => edit(el, null));
  $('[data-cleanup]', el).addEventListener('click', () => cleanUp(el));

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

async function load(el) {
  const tbody = $('tbody', el);
  tbody.setAttribute('aria-busy', 'true');
  let q = sb.from('items').select('id,title,issue_number,variant,publisher,upc,isbn,status,foc_date,release_date,staff_pick,featured,hidden,cover_url,sku,distributor,category_id', { count: 'exact' });
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
  q =
    state.sort === 'title' ? q.order('title', { ascending: asc }).order('issue_number', { ascending: asc }).order('variant', { ascending: asc, nullsFirst: asc })
    : q.order(SORT_COLUMN[state.sort] ?? 'updated_at', { ascending: asc, nullsFirst: false });
  const { data, count, error } = await q.order('id').range(state.offset, state.offset + PAGE - 1);
  tbody.removeAttribute('aria-busy');
  if (error) {
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
        <td class="tt-title"><strong>${esc(i.title)}${i.issue_number ? ` #${esc(i.issue_number)}` : ''}</strong>${i.variant ? `<br><span class="card__meta">${esc(i.variant)}</span>` : ''}<br><span class="card__meta">${esc(i.publisher ?? '')}${i.sku ? ` · ${esc(i.sku)}` : ''}</span><span class="tt-orders" data-orders-for="${i.id}"></span></td>
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

/** Under each title on the page: how many customers have it on order, as a link to the list of who. */
async function showOrderCounts(el, ids) {
  if (!ids.length) return;
  const { data } = await sb.from('reservations').select('item_id,quantity,order_id').in('item_id', ids).in('status', LIVE_LINE).limit(5000);
  const byItem = new Map();
  for (const l of data ?? []) {
    const t = byItem.get(l.item_id) ?? { orders: new Set(), copies: 0 };
    t.orders.add(l.order_id);
    t.copies += l.quantity;
    byItem.set(l.item_id, t);
  }
  for (const [id, t] of byItem) {
    const slot = $(`[data-orders-for="${id}"]`, el);
    if (!slot) continue; // the list was reloaded meanwhile
    const who = `${t.orders.size} ${t.orders.size === 1 ? 'order' : 'orders'}`;
    slot.innerHTML = `<br><button class="tt-datelink" type="button" data-orders="${id}" title="See who ordered this title">${who}${t.copies !== t.orders.size ? ` · ${t.copies} copies` : ''}</button>`;
  }
}

/** Everyone who reserved a title: name (to their customer page or guest order), phone, email, copies, status and when. */
async function whoOrdered(itemId) {
  const d = openDialog('Who Ordered', '<p class="admin-hint" aria-busy="true">Loading…</p>', { wide: true });
  const body = $('.dialog__body', d);
  try {
    const [item, lines, locations] = await Promise.all([
      must(sb.from('items').select('title,issue_number,variant,publisher,foc_date,release_date').eq('id', itemId).single()),
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
      <p class="results-count">${live.length} ${live.length === 1 ? 'order' : 'orders'} · ${live.reduce((n, l) => n + l.quantity, 0)} copies${counts.size ? ` <span class="card__meta">(${[...counts].map(([st, n]) => `${n} ${esc((LINE_STATUS[st] ?? st).toLowerCase())}`).join(', ')})</span>` : ''}</p>
      ${lines.length ? `<div class="admin-table-wrap"><table class="admin-table cards">
        <thead><tr><th scope="col" class="col-cust-name">Name</th><th scope="col">Phone</th><th scope="col">Email</th><th scope="col" class="center">Qty</th><th scope="col">Status</th><th scope="col">Placed</th>${place.size ? '<th scope="col">Location</th>' : ''}</tr></thead>
        <tbody>${lines.map((l) => `<tr${rank(l) ? ' class="is-hidden"' : ''}><td class="card-title">${name(l)}</td><td class="nowrap">${esc(formatPhone(l.order?.phone ?? ''))}</td><td class="card-action">${email(l)}</td><td class="center card-key card-label">${l.quantity}</td><td class="card-key"><span class="pill pill--${esc(l.status)}">${esc(LINE_STATUS[l.status] ?? l.status)}</span></td><td class="card__meta nowrap">${fmtDateTime(l.created_at)}</td>${place.size ? `<td>${esc(place.get(l.location_id) ?? '')}</td>` : ''}</tr>`).join('')}</tbody>
      </table></div>` : '<p class="empty">Nobody has ordered this title.</p>'}`;
    body.addEventListener('click', (e) => {
      const link = e.target.closest('[data-customer], [data-guest]');
      if (!link) return;
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

async function edit(listEl, id) {
  const item = id ? await must(sb.from('items').select('*').eq('id', id).single()) : { status: 'pre_order', distributor: 'other', mature: false, staff_pick: false, featured: false, hidden: false, badges: [] };
  const opt = (v, label, cur) => `<option value="${esc(v)}"${String(v) === String(cur ?? '') ? ' selected' : ''}>${esc(label)}</option>`;
  const d = openDialog(id ? 'Edit Title' : 'New Title', `
    <form class="admin-form" novalidate>
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
      ${item.catalog_id ? hintFold('From the master catalog. Its title, retail price, dates, description, creators and cover follow the catalog (checked hourly); your shop price, status, category, badges, staff pick, homepage and hidden are yours and never change.') : ''}
      ${!item.catalog_id && item.distributor && item.distributor !== 'other' ? hintFold(`Imported from ${item.distributor === 'lunar' ? 'Lunar' : 'PRH'} (${esc(item.sku)}). Re-importing its sheet refreshes title, retail price, dates and description, but never the shop price, status, category, badges, staff pick, homepage or hidden.`) : ''}
      <div class="admin-actions sticky-actions">
        <button class="btn btn--primary" type="submit">${id ? 'Save' : 'Create title'}</button>
        ${id && isOwner ? `<button class="btn btn--danger" type="button" data-delete>${solidIcon('trash', 16)} Delete</button>` : ''}
        <span class="admin-status" role="status"></span>
      </div>
    </form>`, { wide: true });

  const cover = imageField($('[data-cover]', d), { folder: 'covers/manual', label: 'Cover image', maxSize: 1200, thumb: true });
  cover.set(item.cover_url, item.cover_thumb_url);
  const form = $('form', d);
  const status = $('.admin-status', d);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const text = (k) => f.get(k)?.trim() || null;
    const row = {
      title: text('title'), issue_number: text('issue_number'), variant: text('variant'), publisher: text('publisher'),
      status: f.get('status'), category_id: f.get('category_id') ? Number(f.get('category_id')) : null,
      retail_price: f.get('retail_price') ? Number(f.get('retail_price')) : null, shop_price: f.get('shop_price') ? Number(f.get('shop_price')) : null, foc_date: f.get('foc_date') || null, release_date: f.get('release_date') || null,
      creators: text('creators'), upc: text('upc'), isbn: text('isbn'), description: text('description'),
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
      load(listEl);
      loadDateOptions(listEl);
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
      load(listEl);
      loadDateOptions(listEl);
    } catch (err) {
      setStatus(status, err.code === '23503' ? 'Customers have reserved this title, so it can’t be deleted — mark it Hidden instead.' : `Not deleted: ${friendlyError(err)}`, 'error');
    }
  });
}

/** Hides old titles (see staff_hide_old_titles): counts first, then asks. Hidden titles can be restored from the Hidden filter. */
async function cleanUp(el) {
  try {
    const { pre_orders: pre, in_store: store } = await must(sb.rpc('staff_hide_old_titles', { p_dry_run: true }));
    if (!pre && !store) return void toast('Nothing to clean up right now.');
    const lines = [store && `${store} in-store ${store === 1 ? 'title' : 'titles'} released over 180 days ago`, pre && `${pre} ${pre === 1 ? 'pre-order' : 'pre-orders'} released over 90 days ago`].filter(Boolean);
    if (!confirm(`Hide ${lines.join(' and ')}?\n\nTitles on someone's active pull list, staff picks, homepage titles and titles with no release date are skipped. You can restore any title by unticking Hidden.`)) return;
    await must(sb.rpc('staff_hide_old_titles', { p_dry_run: false }));
    toast(`Hid ${pre + store} old ${pre + store === 1 ? 'title' : 'titles'}`);
    load(el);
    loadDateOptions(el);
  } catch (err) {
    toast(friendlyError(err), 'error');
  }
}
