// Analytics: how the shop is doing, in tabs. Sales (orders per day, money, titles by status, most-reserved titles),
// Customers (who is drifting away, who uses the app) and Searches (what people look for).
// Read-only. Dashboard → Trends shows three of these cards for a quick look: it imports them from here,
// so the two screens always match.

import { $, $$, esc, must, fmtDate, fmtDateTime, itemName, STATUS_LABELS, sortableTable, friendlyError, setupTabs, toListTop, hintSlot, formatPhone, openEmailDialog } from '../lib.js';
import { moneySummary } from '../money.js';
import { addDays, weekStart, todayIn, dayIn } from '../../js/dates.js';
import { APP_ENABLED } from '../../js/config.js';

export const DAYS = 30;
const SEARCH_DAYS = 90; // the database keeps searches this long (supabase/migrations/…_search_log.sql)
const DRIFT_DAYS = 60;
const DEMAND_DAYS = 90;
const GROWTH_MONTHS = 12;
let sb;
let timezone;

/** Point the cards at this shop. Every screen that shows them calls this first. */
export function useShop(client, zone) {
  sb = client;
  timezone = zone;
}

export const today = () => todayIn(timezone);
export const dayKey = (iso) => dayIn(iso, timezone);
export const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const fact = (n, text, shown = n.toLocaleString()) => `<li${n ? '' : ' class="is-zero"'}><strong>${shown}</strong> ${text}</li>`;
const dollars = (n) => `$${Math.round(n).toLocaleString()}`;

/** All rows of a query, 1000 at a time. */
export async function all(makeQuery) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const data = await must(makeQuery().range(from, from + 999));
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}
export const count = (q) => must(q);
export const items = () => sb.from('items').select('id', { count: 'exact', head: true });

/** Fills one card on its own, so one slow or failing query doesn't blank the page. */
export async function loadPanel(el, sel, fn) {
  const box = $(sel, el);
  try {
    await fn(box);
  } catch (err) {
    console.error(err);
    box.innerHTML = `<p class="form-error">Couldn’t load: ${esc(friendlyError(err))}</p>`;
  }
  box.removeAttribute('aria-busy');
}

const startOfTrend = () => addDays(today(), -(DAYS - 1));
/**
 * Reservations still in progress, added up by the database (staff_line_summary) so the page never downloads every
 * line: copies to order and ready, overdue lines, copies per order cutoff, the most-reserved titles and their dollars.
 * `location` limits it to one store's lines; lines that arrived before `overdueBefore` count as overdue.
 */
export const activeSummary = (location = null, overdueBefore = null) => must(sb.rpc('staff_line_summary', { p_location: location, p_overdue_before: overdueBefore }));
/** The orders placed since a day. */
export const ordersSince = (since) => all(() => sb.from('reservation_orders').select('id,created_at').gte('created_at', new Date(`${since}T00:00:00`).toISOString()).order('id'));

const card = (id, title, data, { hint = '', wide = false, link = '' } = {}) => {
  const heading = `<h2 id="${id}">${title}</h2>`;
  return `<section class="dash-card${wide ? ' dash-card--wide' : ''}" aria-labelledby="${id}">
        ${link ? `<div class="admin-title-row">${heading}${link}</div>` : heading}
        ${hint ? `<p class="admin-hint">${hint}</p>` : ''}
        <div ${data} aria-busy="true"></div>
      </section>`;
};
export const TREND_CARD = card('dash-trend', `Orders per Day · Last ${DAYS} days`, 'data-trend', { wide: true });
export const TOP_CARD = card('dash-top', 'Top 50', 'data-top', { hint: 'Copies on open, ordered or arrived reservations.' });
export const TOP_SEARCHES_CARD = card('dash-top-searches', `Top Searches · Last ${SEARCH_DAYS} days`, 'data-top-searches', { hint: 'What people look for most in the shop’s search boxes and app. Red rows found no titles. Who searched isn’t recorded.' });

export async function mount(el, ctx) {
  const { timezone: zone } = await must(ctx.sb.from('settings').select('timezone').eq('id', 1).single());
  useShop(ctx.sb, zone);
  el.innerHTML = `
    <div class="admin-title-row">
      <h1>Analytics</h1>
      <p class="card__meta" data-asof></p>
    </div>
    ${hintSlot()}
    <div class="admin-tabs" role="tablist">
      <button type="button" class="admin-tab" role="tab" data-tab="sales">Sales</button>
      <button type="button" class="admin-tab" role="tab" data-tab="customers">Customers</button>
      <button type="button" class="admin-tab" role="tab" data-tab="searches">Searches</button>
    </div>
    <div data-tabpane="sales">
    <div class="dash-grid">
      ${TREND_CARD}
      <div class="dash-stack">
      ${TOP_CARD}
      ${card('dash-series', 'Most-Followed Series', 'data-series', { hint: `How many customers follow each series, the copies of each issue they ask for, and the follows added in the last ${DEMAND_DAYS} days.` })}
      </div>
      <div class="dash-stack">
      ${card('dash-money', 'Money · This week', 'data-money', { hint: 'Estimated at each title’s cover price, before pull list discounts. Customers pay in the store, so this isn’t sales.' })}
      ${card('dash-status', 'Titles by Status', 'data-status', { link: '<a class="btn btn--small btn--green" href="#titles">Titles →</a>' })}
      ${card('dash-publishers', 'Demand by Publisher', 'data-publishers', { hint: 'Each publisher’s share of the copies on open, ordered or arrived reservations. Imprints and similar spellings count under one name.' })}
      </div>
    </div>
    </div>
    <div data-tabpane="customers">
    <div class="dash-grid">
      ${card('dash-drift', 'Customers Drifting Away', 'data-drift', { wide: true, hint: `Pull list customers with books in who haven’t picked up in ${DRIFT_DAYS} days, or who have books past the pickup window (red rows). Biggest value first.` })}
      ${APP_ENABLED ? card('dash-app', 'Pull List App', 'data-app', { hint: 'Customers signed in to the shop’s app (your website address + /app) on their phones.' }) : ''}
      ${card('dash-growth', `Customer Growth · Last ${GROWTH_MONTHS} months`, 'data-growth', { hint: 'Customers added each month, by signing up or by staff, and how many orders came from customers rather than guests. This month is so far.' })}
    </div>
    </div>
    <div data-tabpane="searches">
    <div class="dash-grid">
      ${TOP_SEARCHES_CARD}
      ${card('dash-latest-searches', 'Search Log', 'data-latest-searches', { hint: 'Every search, newest first. Red rows found no titles.' })}
      ${card('dash-no-results', `Searches That Found Nothing · Last ${SEARCH_DAYS} days`, 'data-no-results', { hint: 'Words that found no titles the last time. A search on one page, like Pre-Orders, only looks there, so the shop may carry some of these.' })}
      ${card('dash-led', `Searches That Led to a Reservation · Last ${SEARCH_DAYS} days`, 'data-led', { hint: 'A title counts when it’s added within 30 minutes of a search, in the same browser tab, and a guest’s order goes through. It isn’t taken off if the title is removed later.' })}
      ${card('dash-waiting', 'Waiting for Stock', 'data-waiting', { hint: 'Titles customers asked to hear about when they’re in. A title leaves this list once those customers have been told.' })}
    </div>
    </div>`;
  $('[data-asof]', el).textContent = `As of ${fmtDateTime(new Date().toISOString())}`;
  setupTabs(el, 'admin-analytics-tab', 'sales', null, {
    sales: `What’s selling: orders per day over the last ${DAYS} days, the most-reserved titles, estimated money and how many held copies get picked up, how many titles have each status, and demand by series and publisher.`,
    customers: 'Who may need a call, how many customers use the pull list app, and how the customer base is growing.',
    searches: 'What people search for in the shop’s search boxes and app, which searches found nothing, which led to a reservation, and the titles customers are waiting on.',
  });

  const panel = (sel, fn) => loadPanel(el, sel, fn);
  const summary = activeSummary();
  const since = startOfTrend();
  const recent = ordersSince(since);
  summary.catch(() => {});
  recent.catch(() => {});
  await Promise.all([
    panel('[data-trend]', async (box) => renderTrend(box, await recent, since)),
    panel('[data-top]', async (box) => renderTop(box, (await summary).top)),
    panel('[data-money]', async (box) => renderMoney(box, (await summary).money)),
    panel('[data-status]', renderStatus),
    panel('[data-series]', renderSeries),
    panel('[data-publishers]', renderPublishers),
    panel('[data-drift]', renderDrift),
    APP_ENABLED ? panel('[data-app]', renderApp) : null, // only shops with the app (shops.json)
    panel('[data-growth]', renderGrowth),
    panel('[data-top-searches]', renderTopSearches),
    panel('[data-latest-searches]', renderLatestSearches),
    panel('[data-no-results]', renderNoResults),
    panel('[data-led]', renderLed),
    panel('[data-waiting]', renderWaiting),
  ]);
}

// ---------------------------------------------------------------------------

/** The destination screens read these on load: a customer id for Customers, a guest order id for Reservations. */
export function rememberLink(e) {
  const link = e.target.closest('[data-customer], [data-guest]');
  if (!link) return;
  try {
    if (link.dataset.customer) sessionStorage.setItem('admin-open-customer', link.dataset.customer);
    else sessionStorage.setItem('admin-open-guest', link.dataset.guest);
  } catch {
    /* the link still opens the screen */
  }
}

const TOP_TOTAL = 50;
const LIST_PAGE = 10;
const PAGER_HTML = '<div class="admin-pager"><button class="btn btn--ghost btn--small" type="button" data-prev>← Previous</button><span></span><button class="btn btn--ghost btn--small" type="button" data-next>Next →</button></div>';

/** Works the PAGER_HTML in `box` for a list of `total` rows; drawRows(start, end) fills in a page. Returns a function that goes back to the first page. */
function setupPager(box, total, drawRows) {
  const pager = $('.admin-pager', box);
  const pages = Math.ceil(total / LIST_PAGE);
  pager.hidden = pages < 2;
  let page = 0;
  const draw = () => {
    const start = page * LIST_PAGE;
    drawRows(start, start + LIST_PAGE);
    $('span', pager).textContent = `${start + 1}–${Math.min(start + LIST_PAGE, total)} of ${total}`;
    $('[data-prev]', pager).disabled = page === 0;
    $('[data-next]', pager).disabled = page >= pages - 1;
  };
  const turnPage = (step) => ((page += step), toListTop(box.closest('.dash-card') ?? box), draw());
  $('[data-prev]', pager).addEventListener('click', () => turnPage(-1));
  $('[data-next]', pager).addEventListener('click', () => turnPage(1));
  draw();
  return () => ((page = 0), draw());
}

/**
 * Most Reserved: up to 50 titles with at least one copy reserved, numbered by rank (most copies first), sortable by
 * any column, ten rows a page. `top` is activeSummary().top: { item, copies } for the top titles and any tied with
 * the 50th, so ties are broken by name here.
 */
export function renderTop(box, top) {
  const ranked = top
    .filter((r) => r.copies > 0)
    .sort((a, b) => b.copies - a.copies || itemName(a.item).localeCompare(itemName(b.item)))
    .slice(0, TOP_TOTAL)
    .map((r, i) => ({ ...r, rank: i + 1 }));
  if (!ranked.length) {
    box.innerHTML = '<p class="empty">No active reservations.</p>';
    return;
  }
  const state = { sort: 'rank', dir: 'asc' };
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const SORTS = {
    rank: (a, b) => a.rank - b.rank,
    title: (a, b) => collator.compare(itemName(a.item), itemName(b.item)),
    release: (a, b) => (!a.item.release_date !== !b.item.release_date ? (a.item.release_date ? -1 : 1) : (a.item.release_date ?? '').localeCompare(b.item.release_date ?? '')),
    copies: (a, b) => a.copies - b.copies,
  };

  box.innerHTML = `<div class="admin-table-wrap"><table class="admin-table dash-top">
      <thead><tr><th scope="col" data-sort="rank" aria-label="Rank">#</th><th scope="col" colspan="2" data-sort="title">Title</th><th scope="col" data-sort="release" data-first="asc">Out</th><th scope="col" data-sort="copies" data-first="desc">Copies</th></tr></thead>
      <tbody></tbody></table></div>
    ${PAGER_HTML}`;
  const body = $('tbody', box);

  const firstPage = setupPager(box, ranked.length, (start, end) => {
    const sign = state.dir === 'asc' ? 1 : -1;
    const rows = [...ranked].sort((a, b) => sign * SORTS[state.sort](a, b) || a.rank - b.rank);
    body.innerHTML = rows
      .slice(start, end)
      .map((r) => `<tr>
        <td class="dash-top__rank">${r.rank}</td>
        <td class="dash-top__cover">${r.item.cover_url ? `<img class="thumb thumb--sm" src="${esc(r.item.cover_url)}" alt="" loading="lazy">` : '<span class="thumb thumb--sm thumb--none" aria-hidden="true"></span>'}</td>
        <td><strong>${esc(itemName(r.item))}</strong>${r.item.publisher ? `<br><span class="card__meta">${esc(r.item.publisher)}</span>` : ''}</td>
        <td class="nowrap">${r.item.release_date ? fmtDate(r.item.release_date, { month: 'short', day: 'numeric' }) : ''}</td>
        <td class="dash-top__n">${r.copies}</td></tr>`)
      .join('');
  });
  sortableTable($('table', box), {
    sort: state.sort,
    dir: state.dir,
    onSort: (key, dir) => {
      Object.assign(state, { sort: key, dir });
      firstPage();
    },
  });
}

const SEARCH_LOG_MAX = 200;

/** A list, ten rows a page. `cols` is [heading, cell classes, row → text]; a row whose search found no titles is red. */
function renderRows(box, rows, cols, empty = 'No searches yet.') {
  if (!rows.length) {
    box.innerHTML = `<p class="empty">${empty}</p>`;
    return;
  }
  box.innerHTML = `<div class="admin-table-wrap"><table class="admin-table cards">
      <thead><tr>${cols.map(([head, , , tip]) => `<th scope="col"${tip ? ` title="${esc(tip)}"` : ''}>${head}</th>`).join('')}</tr></thead>
      <tbody></tbody></table></div>
    ${PAGER_HTML}`;
  setupPager(box, rows.length, (start, end) => {
    $('tbody', box).innerHTML = rows
      .slice(start, end)
      .map((r) => `<tr${r.titles === 0 ? ' class="is-overdue"' : ''}>${cols.map(([, cls, text]) => `<td class="${cls}">${esc(text(r))}</td>`).join('')}</tr>`)
      .join('');
  });
}

const SEARCH_TERM = ['Search', 'card-title', (r) => r.term];
const SEARCH_TITLES = ['Titles found', 'center card-label', (r) => r.titles.toLocaleString()];

const SEARCH_TIMES = ['Times', 'center card-key card-label', (r) => r.times.toLocaleString()];

export async function renderTopSearches(box) {
  renderRows(box, await must(sb.rpc('search_log_top', { p_days: SEARCH_DAYS })), [
    SEARCH_TERM,
    SEARCH_TIMES,
    SEARCH_TITLES,
    ['Last searched', 'nowrap', (r) => fmtDateTime(r.last_at)],
  ]);
}

async function renderLatestSearches(box) {
  renderRows(box, await must(sb.from('search_log').select('term,titles,searched_at').order('searched_at', { ascending: false }).limit(SEARCH_LOG_MAX)), [
    SEARCH_TERM,
    SEARCH_TITLES,
    ['When', 'nowrap', (r) => fmtDateTime(r.searched_at)],
  ]);
}

async function renderNoResults(box) {
  renderRows(box, await must(sb.rpc('search_log_no_results', { p_days: SEARCH_DAYS })), [
    SEARCH_TERM,
    SEARCH_TIMES,
    ['Last searched', 'nowrap', (r) => fmtDateTime(r.last_at)],
  ], 'Every recent search found something.');
}

/** How many searches end in a reservation, and the words behind them (search_log_reservations in the database). */
async function renderLed(box) {
  const rows = await must(sb.rpc('search_log_reservations', { p_days: SEARCH_DAYS }));
  if (!rows.length) return renderRows(box, rows, [], 'No reservations have followed a search yet.');
  const { found_searches: found, led_searches: led } = rows[0];
  box.innerHTML = `
    <p class="dash-big">${Math.round((led / found) * 100)}% <span>of searches that found titles led to a reservation</span></p>
    <ul class="dash-facts"><li>${led.toLocaleString()} of ${found.toLocaleString()} searches</li></ul>
    <div data-led-rows></div>`;
  renderRows($('[data-led-rows]', box), rows, [
    SEARCH_TERM,
    SEARCH_TIMES,
    ['Led to a reservation', 'center card-label', (r) => r.led.toLocaleString()],
    ['Titles reserved', 'center card-label', (r) => r.reserved.toLocaleString()],
    ['Last searched', 'nowrap', (r) => fmtDateTime(r.last_at)],
  ]);
}

/** Titles with stock alerts: who is waiting now (analytics_stock_alert_titles in the database). */
async function renderWaiting(box) {
  renderRows(box, await must(sb.rpc('analytics_stock_alert_titles')), [
    ['Title', 'card-title', itemName],
    ['Waiting', 'center card-key card-label', (r) => r.waiting.toLocaleString()],
    ['Last asked', 'nowrap', (r) => fmtDateTime(r.last_at)],
  ], 'Nobody is waiting on a title.');
}

/** The most-followed series (analytics_series_demand in the database). */
async function renderSeries(box) {
  renderRows(box, await must(sb.rpc('analytics_series_demand', { p_days: DEMAND_DAYS })), [
    ['Series', 'card-title', (r) => r.label],
    ['Followers', 'center card-key card-label', (r) => r.followers.toLocaleString()],
    ['CPI', 'center card-label', (r) => r.copies.toLocaleString(), 'Copies per issue'],
    [`${DEMAND_DAYS} Days`, 'center card-label', (r) => r.new_followers.toLocaleString(), `New in ${DEMAND_DAYS} days`],
  ], 'Nobody follows a series yet.');
}

const PUBLISHERS_SHOWN = 10;

/** Each publisher's share of the copies on reservations still in progress (analytics_publisher_demand in the database). */
async function renderPublishers(box) {
  const rows = await must(sb.rpc('analytics_publisher_demand'));
  if (!rows.length) {
    box.innerHTML = '<p class="empty">No active reservations.</p>';
    return;
  }
  const total = rows.reduce((n, r) => n + r.copies, 0);
  const more = rows.length - PUBLISHERS_SHOWN;
  box.innerHTML = `
    <p class="dash-big">${total.toLocaleString()} <span>${total === 1 ? 'copy' : 'copies'} reserved</span></p>
    <ul class="dash-bars">${rows
      .slice(0, PUBLISHERS_SHOWN)
      .map((r) => `<li>
        <span class="dash-bars__label">${esc(r.publisher)}</span>
        <span class="dash-bars__track"><span class="dash-bars__fill" style="width:${(r.copies / rows[0].copies) * 100}%"></span></span>
        <span class="dash-bars__value">${Math.round((r.copies / total) * 100)}%</span>
      </li>`)
      .join('')}</ul>
    ${more > 0 ? `<p class="card__meta">${plural(more, 'smaller publisher')} not shown.</p>` : ''}`;
}

/** New customers per month, and orders from customers versus guests (analytics_customer_growth in the database). */
async function renderGrowth(box) {
  const months = await must(sb.rpc('analytics_customer_growth', { p_months: GROWTH_MONTHS }));
  const sum = (key) => months.reduce((n, m) => n + m[key], 0);
  const [added, fromCustomers, fromGuests] = [sum('new_customers'), sum('customer_orders'), sum('guest_orders')];
  const max = Math.max(1, ...months.map((m) => m.new_customers));
  const month = (m) => fmtDate(m.month, { month: 'short', year: 'numeric' });
  box.innerHTML = `
    <p class="dash-big">${added.toLocaleString()} <span>new ${added === 1 ? 'customer' : 'customers'}</span></p>
    <ul class="dash-facts">
      ${fact(fromCustomers, `${fromCustomers === 1 ? 'order' : 'orders'} from customers`)}
      ${fact(fromGuests, `guest ${fromGuests === 1 ? 'order' : 'orders'}`)}
    </ul>
    <ul class="dash-bars">${months
      .map((m) => `<li>
        <span class="dash-bars__label">${month(m)}</span>
        <span class="dash-bars__track"><span class="dash-bars__fill" style="width:${(m.new_customers / max) * 100}%"></span></span>
        <span class="dash-bars__value">${m.new_customers.toLocaleString()}</span>
      </li>`)
      .join('')}</ul>
    <details class="dash-details"><summary>Show orders by month</summary>
      <table class="admin-table"><thead><tr><th scope="col">Month</th><th scope="col">New customers</th><th scope="col">Customer orders</th><th scope="col">Guest orders</th></tr></thead>
      <tbody>${months.map((m) => `<tr><td>${month(m)}</td><td>${m.new_customers.toLocaleString()}</td><td>${m.customer_orders.toLocaleString()}</td><td>${m.guest_orders.toLocaleString()}</td></tr>`).join('')}</tbody></table>
    </details>`;
}

/** Pull list customers worth a call: name, contact, last pickup, and what's waiting for them (drifting_customers in the database). */
async function renderDrift(box) {
  const rows = await must(sb.rpc('drifting_customers', { p_days: DRIFT_DAYS }));
  if (!rows.length) {
    box.innerHTML = '<p class="empty">Nobody right now. Everyone with books in has been by lately.</p>';
    return;
  }
  box.innerHTML = `<div class="admin-table-wrap"><table class="admin-table cards">
      <thead><tr><th scope="col">Name</th><th scope="col">Phone</th><th scope="col">Email</th><th scope="col">Last pickup</th><th scope="col">Waiting</th><th scope="col">Value</th></tr></thead>
      <tbody></tbody></table></div>
    ${PAGER_HTML}`;
  setupPager(box, rows.length, (start, end) => {
    $('tbody', box).innerHTML = rows
      .slice(start, end)
      .map((c) => `<tr${c.past_window ? ' class="is-overdue"' : ''}>
        <td class="card-title"><a href="#customers" data-customer="${c.id}"><strong>${esc(c.name || c.email || '(no name)')}</strong></a></td>
        <td class="nowrap">${esc(formatPhone(c.phone))}</td>
        <td class="card-action">${c.email ? `<button type="button" class="btn btn--ghost btn--small cust-email" title="Write an email to ${esc(c.email)}" aria-label="Email ${esc(c.name || c.email)}" data-email-to="${esc(c.email)}" data-email-name="${esc(c.first_name || c.name || '')}" data-email-customer="${c.id}">Email</button>` : ''}</td>
        <td class="nowrap card-label">${c.last_pickup ? fmtDate(dayKey(c.last_pickup), { month: 'short', day: 'numeric', year: 'numeric' }) : 'Never'}</td>
        <td class="center card-key card-label">${c.waiting.toLocaleString()}${c.past_window ? `<span class="card__meta"> (${c.past_window.toLocaleString()} past window)</span>` : ''}</td>
        <td class="center card-label">${dollars(Number(c.waiting_value))}</td>
      </tr>`)
      .join('');
  });
  box.onclick = (e) => {
    const mail = e.target.closest('[data-email-to]');
    if (mail) openEmailDialog({ to: mail.dataset.emailTo, name: mail.dataset.emailName, customerId: Number(mail.dataset.emailCustomer) });
    else rememberLink(e);
  };
}

export function renderTrend(box, recent, since) {
  const perDay = new Map();
  for (let i = 0; i < DAYS; i++) perDay.set(addDays(since, i), 0);
  for (const o of recent) {
    const k = dayKey(o.created_at);
    if (perDay.has(k)) perDay.set(k, perDay.get(k) + 1);
  }
  const days = [...perDay];
  const max = Math.max(1, ...days.map(([, n]) => n));
  const total = days.reduce((n, [, c]) => n + c, 0);
  const label = ([d, n]) => `${fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' })}: ${plural(n, 'order')}`;
  // Gridline at a round number near the top so the bars have a scale.
  const step = max <= 5 ? 1 : max <= 10 ? 2 : max <= 25 ? 5 : 10;
  const top = Math.ceil(max / step) * step;
  const t = today();
  box.innerHTML = `
    <p class="card__meta">${plural(total, 'order')} in the last ${DAYS} days · busiest day ${esc(label(days.reduce((a, b) => (b[1] > a[1] ? b : a))))}</p>
    <div class="dash-chart" role="img" aria-label="Bar chart of orders per day, ${plural(total, 'order')} in total. The table below has each day’s count.">
      <div class="dash-chart__axis" aria-hidden="true"><span>${top}</span><span>${top / 2 === Math.round(top / 2) ? top / 2 : ''}</span><span>0</span></div>
      <div class="dash-chart__plot">
        ${days.map(([d, n]) => `<div class="dash-chart__col" data-tip="${esc(label([d, n]))}"><span class="dash-chart__bar${d === t ? ' is-today' : ''}" style="height:${(n / top) * 100}%"></span></div>`).join('')}
      </div>
      <div class="dash-chart__tip" hidden></div>
    </div>
    <div class="dash-chart__x" aria-hidden="true"><span>${fmtDate(days[0][0], { month: 'short', day: 'numeric' })}</span><span>Today</span></div>
    <details class="dash-details"><summary>Show as table</summary>
      <table class="admin-table"><thead><tr><th scope="col">Day</th><th scope="col">Orders</th></tr></thead>
      <tbody>${days.slice().reverse().map(([d, n]) => `<tr><td>${fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' })}</td><td>${n}</td></tr>`).join('')}</tbody></table>
    </details>`;

  const chart = $('.dash-chart', box);
  const tip = $('.dash-chart__tip', box);
  $$('.dash-chart__col', box).forEach((col) => {
    col.addEventListener('pointerenter', () => {
      tip.textContent = col.dataset.tip;
      tip.hidden = false;
      const c = chart.getBoundingClientRect(), r = col.getBoundingClientRect();
      tip.style.left = `${Math.min(Math.max(r.left - c.left + r.width / 2, 70), c.width - 70)}px`;
    });
    col.addEventListener('pointerleave', () => (tip.hidden = true));
  });
}

/** How many customers use the app, lately, and with notifications on (app_visits, push_subscriptions). */
async function renderApp(box) {
  const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();
  const visits = () => sb.from('app_visits').select('customer_id', { count: 'exact', head: true });
  const [users, week, month, devices] = await Promise.all([
    count(visits()),
    count(visits().gte('last_seen_at', ago(7))),
    count(visits().gte('last_seen_at', ago(30))),
    all(() => sb.from('push_subscriptions').select('customer_id').order('id')),
  ]);
  const notified = new Set(devices.map((d) => d.customer_id)).size;
  box.innerHTML = `
    <p class="dash-big">${users.toLocaleString()} <span>${users === 1 ? 'customer uses' : 'customers use'} the app</span></p>
    <ul class="dash-facts">
      ${fact(week, 'opened it in the last 7 days')}
      ${fact(month, 'opened it in the last 30 days')}
      ${fact(notified, `${notified === 1 ? 'gets' : 'get'} notifications (${plural(devices.length, 'phone')})`)}
    </ul>`;
}

/** Estimated dollars reserved, in progress and picked up, and how much of what's held for people gets picked up. */
async function renderMoney(box, activeTotals) {
  const since = weekStart(today()); // this week, Sunday to today
  const fields = 'id,order_id,quantity,status,arrived_on,created_at,updated_at,item:items(price),placed:reservation_orders(customer_id)';
  const recent = await all(() => sb.from('reservations').select(fields).gte('updated_at', new Date(`${since}T00:00:00`).toISOString()).order('id'));
  const m = moneySummary({ recent, activeTotals, since, weeks: 1, dayOf: dayKey });
  box.innerHTML = `
    <p class="dash-big">${dollars(m.reserved)} <span>reserved</span></p>
    <ul class="dash-facts">
      ${fact(m.ready, 'ready for pickup now', dollars(m.ready))}
      ${fact(m.coming, 'reserved, not here yet', dollars(m.coming))}
      ${fact(m.pickedUp, 'picked up', dollars(m.pickedUp))}
      ${fact(m.perCustomer, `reserved per customer (${plural(m.customers, 'customer')})`, dollars(m.perCustomer))}
    </ul>
    ${m.pickupRate == null ? '<p class="empty">No held copies have been picked up or released yet.</p>' : `
    <p class="dash-big">${m.pickupRate}% <span>of held copies picked up</span></p>
    <ul class="dash-facts">
      ${fact(m.pickedCopies, m.pickedCopies === 1 ? 'copy picked up' : 'copies picked up')}
      ${fact(m.releasedCopies, m.releasedCopies === 1 ? 'copy released to the shelf' : 'copies released to the shelf')}
      ${m.typicalWait == null ? '' : fact(m.typicalWait, `${m.typicalWait === 1 ? 'day' : 'days'} is the typical wait from arrival to pickup`)}
    </ul>`}
    ${m.unpriced ? `<p class="card__meta">${plural(m.unpriced, 'line')} with no cover price ${m.unpriced === 1 ? 'isn’t' : 'aren’t'} in these dollars.</p>` : ''}`;
}

async function renderStatus(box) {
  const statuses = Object.keys(STATUS_LABELS);
  const [total, ...counts] = await Promise.all([count(items()), ...statuses.map((s) => count(items().eq('status', s)))]);
  const max = Math.max(1, ...counts);
  box.innerHTML = `
    <p class="dash-big">${total.toLocaleString()} <span>titles</span></p>
    <ul class="dash-bars">${statuses
      .map((s, i) => `<li>
        <span class="dash-bars__label"><span class="pill pill--${s}">${STATUS_LABELS[s]}</span></span>
        <span class="dash-bars__track"><span class="dash-bars__fill" style="width:${(counts[i] / max) * 100}%"></span></span>
        <span class="dash-bars__value">${counts[i].toLocaleString()}</span>
      </li>`)
      .join('')}</ul>`;
}
