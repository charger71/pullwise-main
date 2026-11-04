// Dashboard: the staff landing page. Reservation headlines (new orders, what's
// waiting to be ordered or picked up), the latest orders, a 30-day order
// chart, product stats (titles by status, next order cutoff, most-reserved
// titles, titles needing attention) and how many customers use the pull list
// app. Read-only; links out to the sections where things get changed.

import { $, $$, esc, must, withCustomers, solidIcon, findGuestMatches, setStatus, fmtDate, fmtDateTime, itemName, STATUS_LABELS, sortableTable, friendlyError, setupTabs, listLocations, fmtTime, toListTop } from '../lib.js';
import { lastReserveDay } from '../../js/site.js';
import { lastBackup } from '../backup.js';
import { LINE_STATUS_SHORT } from '../../js/labels.js';
import { addDays, todayIn, dayIn } from '../../js/dates.js';
import { APP_ENABLED, IS_CATALOG } from '../../js/config.js';

const ACTIVE = ['open', 'ordered', 'reordered', 'arrived'];
const DAYS = 30;
const LINE_FIELDS = 'id,order_id,quantity,status,arrived_on,item:items(id,title,issue_number,variant,publisher,foc_date,release_date,cover_url)';
let sb;
let settings;
let isOwner = false;

const today = () => todayIn(settings.timezone);
const dayKey = (iso) => dayIn(iso, settings.timezone);
const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** All rows of a query, 1000 at a time. */
async function all(makeQuery) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const data = await must(makeQuery().range(from, from + 999));
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}
const count = (q) => must(q);
const items = () => sb.from('items').select('id', { count: 'exact', head: true });

export async function mount(el, ctx) {
  isOwner = ctx.isOwner === true;
  sb = ctx.sb;
  settings = await must(sb.from('settings').select('hold_days,timezone,announcement,pull_list_email_enabled,pull_list_email_day,pull_list_email_hour,pull_list_email_last_sent,arrival_email_enabled').eq('id', 1).single());
  const locations = await listLocations(sb); // [] unless the shop has 2+ locations: then each gets its own tab
  el.innerHTML = `
    <div class="admin-title-row">
      <h1>Dashboard</h1>
      <p class="card__meta" data-asof></p>
    </div>
    <details class="fold fold--compact dash-announce-fold">
      <summary class="fold__head"><h2 id="dash-announce-title">Special Announcement<span class="fold__note" data-announce-sum>${esc(settings.announcement || 'None showing')}</span></h2></summary>
      <div class="fold__body">
    <form class="dash-announce" data-announce novalidate>
      <p class="admin-hint" id="dash-announce-hint">Shown in the bar at the very top of every public page — store closed, hours changed, etc. Add a link with [text](https://…) or [text](events.html); a bare https:// address also becomes a link. Use **bold** and *italics*. Leave blank for no announcement.</p>
      <div class="dash-announce__row">
        <input id="dash-announcement" name="announcement" aria-labelledby="dash-announce-title" aria-describedby="dash-announce-hint" maxlength="300" value="${esc(settings.announcement)}">
        <button class="btn btn--primary" type="submit">Save</button>
      </div>
      <p class="admin-status" role="status" data-announce-status></p>
    </form>
      </div>
    </details>
    <div class="admin-tabs" role="tablist">
      <button type="button" class="admin-tab" role="tab" data-tab="today">Today</button>
      ${locations.map((l) => `<button type="button" class="admin-tab" role="tab" data-tab="loc-${l.id}" data-icon="pin">${esc(l.name)}</button>`).join('')}
      <button type="button" class="admin-tab" role="tab" data-tab="trends">Trends</button>
      <button type="button" class="admin-tab" role="tab" data-tab="system">System</button>
    </div>
    <div data-tabpane="today">
    <p class="card__meta" data-scope hidden></p>
    <ul class="dash-tiles" data-tiles aria-busy="true"><li class="dash-tile"><p class="admin-hint loading">Loading…</p></li></ul>
    <div class="dash-grid">
      <section class="dash-card" aria-labelledby="dash-attn">
        <h2 id="dash-attn">Needs Attention</h2>
        <div data-attn aria-busy="true"></div>
      </section>
      <section class="dash-card" aria-labelledby="dash-cutoff">
        <div class="admin-title-row"><h2 id="dash-cutoff">Next Order Cutoff</h2><a class="btn btn--small btn--green" href="#reservations">Place Order →</a></div>
        <div data-cutoff aria-busy="true"></div>
      </section>
      <section class="dash-card dash-card--wide" aria-labelledby="dash-latest">
        <div class="admin-title-row"><h2 id="dash-latest">Latest Orders</h2><a class="btn btn--small btn--green" href="#reservations">All reservations →</a></div>
        <div data-latest aria-busy="true"></div>
      </section>
    </div>
    </div>
    <div data-tabpane="trends">
    <div class="dash-grid">
      <section class="dash-card dash-card--wide" aria-labelledby="dash-trend">
        <h2 id="dash-trend">Orders per Day · Last ${DAYS} days</h2>
        <div data-trend aria-busy="true"></div>
      </section>
      <section class="dash-card" aria-labelledby="dash-top">
        <h2 id="dash-top">Top 50</h2>
        <p class="admin-hint">Copies on open, ordered or arrived reservations.</p>
        <div data-top aria-busy="true"></div>
      </section>
      ${APP_ENABLED ? `<section class="dash-card" aria-labelledby="dash-app">
        <h2 id="dash-app">Pull List App</h2>
        <p class="admin-hint">Customers signed in to the shop’s app (your website address + /app) on their phones.</p>
        <div data-app aria-busy="true"></div>
      </section>` : ''}
      <section class="dash-card" aria-labelledby="dash-status">
        <div class="admin-title-row"><h2 id="dash-status">Titles by Status</h2><a class="btn btn--small btn--green" href="#titles">Titles →</a></div>
        <div data-status aria-busy="true"></div>
      </section>
    </div>
    </div>
    <div data-tabpane="system">
    <div class="dash-grid">
      <section class="dash-card dash-card--wide" aria-labelledby="dash-health">
        <h2 id="dash-health">System Health</h2>
        <p class="admin-hint" data-health-summary>Checking the scheduled jobs…</p>
        <div data-health aria-busy="true"></div>
      </section>
    </div>
    </div>`;
  $('[data-announce]', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = $('[data-announce-status]', el);
    setStatus(status, 'Saving…');
    try {
      const announcement = new FormData(e.target).get('announcement').toString().trim() || null;
      // Row-level security turns an update by a signed-out session into "0 rows", not an error.
      if (!(await must(sb.from('settings').update({ announcement }).eq('id', 1).select('id')))?.length) {
        throw Object.assign(new Error('You may have been signed out. Sign in again, then save once more.'), { code: 'P0001' });
      }
      $('[data-announce-sum]', el).textContent = announcement || 'None showing';
      setStatus(status, announcement ? `Saved ${fmtTime()} — showing on the site now.` : 'Saved — no announcement is showing.', 'ok');
    } catch (err) {
      setStatus(status, `Not saved: ${friendlyError(err)}`, 'error');
    }
  });
  $('[data-asof]', el).textContent = `As of ${fmtDateTime(new Date().toISOString())}`;

  // Each panel loads on its own so one slow or failing query doesn't blank the page.
  const panel = async (sel, fn) => {
    const box = $(sel, el);
    try {
      await fn(box);
    } catch (err) {
      console.error(err);
      box.innerHTML = `<p class="form-error">Couldn’t load: ${esc(friendlyError(err))}</p>`;
    }
    box.removeAttribute('aria-busy');
  };
  const lines = all(() => sb.from('reservations').select(LINE_FIELDS).in('status', ACTIVE).order('id'));
  const since = addDays(today(), -(DAYS - 1));
  const recent = all(() => sb.from('reservation_orders').select('id,created_at').gte('created_at', new Date(`${since}T00:00:00`).toISOString()).order('id'));
  lines.catch(() => {});
  recent.catch(() => {});

  // The Today panels, for the whole shop or (a store's tab) for one location. A newer choice wins if loads overlap.
  let todayReq = 0;
  let shown = null; // which location the Today panels show now: '' = all
  const loadToday = (location) => {
    const mine = ++todayReq;
    const stale = () => mine !== todayReq;
    const loc = location ? Number(location) : null;
    shown = location;
    const scope = $('[data-scope]', el);
    scope.hidden = loc == null;
    scope.textContent = loc == null ? '' : `${locations.find((l) => l.id === loc)?.name ?? 'This store'} only: its pull-list titles, pickups and customers.`;
    ['[data-tiles]', '[data-latest]', '[data-cutoff]', '[data-attn]'].forEach((sel) => $(sel, el).setAttribute('aria-busy', 'true'));
    const myLines = loc == null ? lines : all(() => sb.from('reservations').select(LINE_FIELDS).in('status', ACTIVE).eq('location_id', loc).order('id'));
    const myRecent = loc == null ? recent : all(() => sb.from('reservation_orders').select('id,created_at,reservations!inner(location_id)').eq('reservations.location_id', loc).gte('created_at', new Date(`${since}T00:00:00`).toISOString()).order('id'));
    myLines.catch(() => {});
    myRecent.catch(() => {});
    return Promise.all([
      panel('[data-tiles]', async (box) => {
        const [l, r] = [await myLines, await myRecent];
        if (!stale()) renderTiles(box, l, r);
      }),
      panel('[data-latest]', (box) => renderLatest(box, loc, stale)),
      panel('[data-cutoff]', async (box) => renderCutoff(box, await myLines, stale)),
      panel('[data-attn]', (box) => renderAttention(box, loc, stale)),
    ]);
  };
  // A store's tab shows the Today panels for that store (the tab bar hides every other pane, so bring Today back).
  setupTabs(el, 'admin-dashboard-tab', 'today', (tab) => {
    const location = tab.startsWith('loc-') ? tab.slice(4) : '';
    if (location) $('[data-tabpane="today"]', el).hidden = false;
    if (shown !== location && (tab === 'today' || location)) loadToday(location);
  });

  await Promise.all([
    shown === null ? loadToday('') : null,
    panel('[data-trend]', async (box) => renderTrend(box, await recent, since)),
    panel('[data-status]', renderStatus),
    APP_ENABLED ? panel('[data-app]', renderApp) : null, // only shops with the app (shops.json)
    panel('[data-top]', async (box) => renderTop(box, await lines)),
    panel('[data-health]', renderHealth),
  ]);
}

// ---------------------------------------------------------------------------

function renderTiles(box, lines, recent) {
  const t = today();
  const weekStart = addDays(t, -6);
  const prevStart = addDays(t, -13);
  const days = recent.map((o) => dayKey(o.created_at));
  const thisWeek = days.filter((d) => d >= weekStart).length;
  const lastWeek = days.filter((d) => d >= prevStart && d < weekStart).length;
  const copies = (status) => lines.filter((l) => l.status === status).reduce((n, l) => n + l.quantity, 0);
  const overdueBefore = addDays(t, -(settings.hold_days ?? 30));
  const overdue = lines.filter((l) => l.status === 'arrived' && l.arrived_on && l.arrived_on < overdueBefore);
  const pickupOrders = new Set(lines.filter((l) => l.status === 'arrived').map((l) => l.order_id)).size;
  const diff = thisWeek - lastWeek;

  const tile = (label, value, note, href, kind = '') =>
    `<li class="dash-tile${kind ? ` dash-tile--${kind}` : ''}">
      <a href="${href}">
        <span class="dash-tile__label">${label}</span>
        <span class="dash-tile__value">${value.toLocaleString()}</span>
        <span class="dash-tile__note">${note}</span>
      </a>
    </li>`;
  box.innerHTML = [
    tile('New orders · 7 days', thisWeek, diff === 0 ? `Same as the week before` : `${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)} vs. the week before (${lastWeek})`, '#reservations'),
    tile('Copies to order', copies('open'), 'Reserved, not yet ordered from the distributor', '#reservations'),
    tile('Ready for pickup', copies('arrived'), `Waiting on ${plural(pickupOrders, 'customer')}`, '#reservations'),
    tile('Past pickup window', overdue.length, overdue.length ? `${plural(overdue.length, 'title')} held over ${settings.hold_days ?? 30} days` : 'Nothing overdue', '#reservations', overdue.length ? 'alert' : ''),
  ].join('');
}

async function renderLatest(box, loc = null, stale = () => false) {
  // A store's tab lists only orders with a title at that store, and counts only those titles.
  let q = sb.from('reservation_orders').select(`id,name,phone,email,customer_id,created_at,customer:customers(id,name,phone,email),reservations${loc ? '!inner' : ''}(quantity,status,location_id)`);
  if (loc) q = q.eq('reservations.location_id', loc);
  const orders = await must(q.order('created_at', { ascending: false }).limit(10));
  await withCustomers(sb, orders);
  if (stale()) return;
  if (!orders.length) {
    box.innerHTML = '<p class="empty">No reservations yet.</p>';
    return;
  }
  box.innerHTML = `<div class="admin-table-wrap"><table class="admin-table dash-latest cards">
    <thead><tr><th scope="col" data-sort="text">Customer</th><th scope="col" data-sort="num" data-first="desc">Order</th><th scope="col" data-sort="text" data-first="desc">Placed</th><th scope="col" data-sort="num" data-first="desc">Titles</th><th scope="col" data-sort="text">Status</th><th scope="col"><span class="visually-hidden">View</span></th></tr></thead>
    <tbody>${orders
      .map((o) => {
        const lines = o.reservations ?? [];
        const copies = lines.reduce((n, l) => n + l.quantity, 0);
        const byStatus = Object.entries(lines.reduce((m, l) => ((m[l.status] = (m[l.status] ?? 0) + 1), m), {}));
        return `<tr>
          <td class="card-title"><strong>${esc(o.name)}</strong></td>
          <td class="nowrap" data-sort="${o.id}">#${o.id}</td>
          <td class="nowrap" data-sort="${esc(o.created_at)}">${fmtDateTime(o.created_at)}</td>
          <td class="center card-label" data-sort="${lines.length}">${lines.length}${copies !== lines.length ? `<span class="card__meta"> (${copies} copies)</span>` : ''}</td>
          <td class="card-wide">${byStatus.map(([s, n]) => `<span class="pill pill--${s}">${n > 1 || byStatus.length > 1 ? `${n} ` : ''}${LINE_STATUS_SHORT[s]}</span>`).join(' ')}</td>
          <td class="nowrap card-action">${o.customer_id ? `<a class="btn btn--ghost btn--small" href="#customers" data-customer="${o.customer_id}" aria-label="View customer ${esc(o.name)}">View<span class="dash-latest__more" aria-hidden="true"> customer</span></a>` : `<a class="btn btn--ghost btn--small" href="#reservations" data-guest="${o.id}" aria-label="View order ${o.id}">View<span class="dash-latest__more" aria-hidden="true"> order</span></a>`}</td>
        </tr>`;
      })
      .join('')}</tbody>
  </table></div>`;
  sortableTable($('table', box));
  // The destination screens read these on load: a customer id for Customers, a guest order id for Reservations.
  box.onclick = (e) => {
    const link = e.target.closest('[data-customer], [data-guest]');
    if (!link) return;
    try {
      if (link.dataset.customer) sessionStorage.setItem('admin-open-customer', link.dataset.customer);
      else sessionStorage.setItem('admin-open-guest', link.dataset.guest);
    } catch {
      /* the link still opens the screen */
    }
  };
}

function renderTrend(box, recent, since) {
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
  const fact = (n, text) => `<li${n ? '' : ' class="is-zero"'}><strong>${n.toLocaleString()}</strong> ${text}</li>`;
  box.innerHTML = `
    <p class="dash-big">${users.toLocaleString()} <span>${users === 1 ? 'customer uses' : 'customers use'} the app</span></p>
    <ul class="dash-facts">
      ${fact(week, 'opened it in the last 7 days')}
      ${fact(month, 'opened it in the last 30 days')}
      ${fact(notified, `${notified === 1 ? 'gets' : 'get'} notifications (${plural(devices.length, 'phone')})`)}
    </ul>`;
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

// Titles not out yet: pre-orders, and Coming Soon once customers can no longer add them (the shop orders until FOC).
const UPCOMING = ['pre_order', 'coming_soon'];

async function renderCutoff(box, lines, stale = () => false) {
  const t = today();
  const next = await must(sb.from('items').select('foc_date').in('status', UPCOMING).gte('foc_date', t).order('foc_date').limit(1));
  if (stale()) return;
  if (!next.length) {
    box.innerHTML = '<p class="empty">No upcoming order cutoffs.</p>';
    return;
  }
  const foc = next[0].foc_date;
  const titles = await count(items().in('status', UPCOMING).eq('foc_date', foc).eq('hidden', false));
  if (stale()) return;
  const onFoc = lines.filter((l) => l.status === 'open' && l.item?.foc_date === foc);
  const copies = onFoc.reduce((n, l) => n + l.quantity, 0);
  const daysLeft = Math.round((new Date(`${foc}T12:00:00`) - new Date(`${t}T12:00:00`)) / 86400000);
  box.innerHTML = `
    <p class="dash-big">${fmtDate(foc, { weekday: 'short', month: 'short', day: 'numeric' })} <span>${daysLeft === 0 ? 'today' : daysLeft === 1 ? 'tomorrow' : `in ${daysLeft} days`}</span></p>
    <ul class="dash-facts">
      <li>Customer reservations close <strong>${fmtDate(lastReserveDay(foc), { weekday: 'short', month: 'short', day: 'numeric' })}</strong> at midnight</li>
      <li><strong>${titles.toLocaleString()}</strong> pre-order ${titles === 1 ? 'title' : 'titles'} on this cutoff</li>
      <li><strong>${copies.toLocaleString()}</strong> reserved ${copies === 1 ? 'copy' : 'copies'} to order, for ${plural(new Set(onFoc.map((l) => l.order_id)).size, 'customer')}</li>
    </ul>`;
}

const TOP_TOTAL = 50;
const TOP_PAGE = 10;

/** Most Reserved: up to 50 titles with at least one copy reserved, numbered by rank (most copies first), sortable by any column, ten rows a page. */
function renderTop(box, lines) {
  const byItem = new Map();
  for (const l of lines) {
    if (!l.item) continue;
    const row = byItem.get(l.item.id) ?? { item: l.item, copies: 0 };
    row.copies += l.quantity;
    byItem.set(l.item.id, row);
  }
  const ranked = [...byItem.values()]
    .filter((r) => r.copies > 0)
    .sort((a, b) => b.copies - a.copies || itemName(a.item).localeCompare(itemName(b.item)))
    .slice(0, TOP_TOTAL)
    .map((r, i) => ({ ...r, rank: i + 1 }));
  if (!ranked.length) {
    box.innerHTML = '<p class="empty">No active reservations.</p>';
    return;
  }
  const pages = Math.ceil(ranked.length / TOP_PAGE);
  const state = { sort: 'rank', dir: 'asc', page: 0 };
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
    <div class="admin-pager" data-top-pager><button class="btn btn--ghost btn--small" type="button" data-top-prev>← Previous</button><span></span><button class="btn btn--ghost btn--small" type="button" data-top-next>Next →</button></div>`;
  const body = $('tbody', box);
  const pager = $('[data-top-pager]', box);
  pager.hidden = pages < 2;

  const draw = () => {
    const sign = state.dir === 'asc' ? 1 : -1;
    const rows = [...ranked].sort((a, b) => sign * SORTS[state.sort](a, b) || a.rank - b.rank);
    const start = state.page * TOP_PAGE;
    body.innerHTML = rows
      .slice(start, start + TOP_PAGE)
      .map((r) => `<tr>
        <td class="dash-top__rank">${r.rank}</td>
        <td class="dash-top__cover">${r.item.cover_url ? `<img class="thumb thumb--sm" src="${esc(r.item.cover_url)}" alt="" loading="lazy">` : '<span class="thumb thumb--sm thumb--none" aria-hidden="true"></span>'}</td>
        <td><strong>${esc(itemName(r.item))}</strong>${r.item.publisher ? `<br><span class="card__meta">${esc(r.item.publisher)}</span>` : ''}</td>
        <td class="nowrap">${r.item.release_date ? fmtDate(r.item.release_date, { month: 'short', day: 'numeric' }) : ''}</td>
        <td class="dash-top__n">${r.copies}</td></tr>`)
      .join('');
    $('span', pager).textContent = `${start + 1}–${Math.min(start + TOP_PAGE, ranked.length)} of ${ranked.length}`;
    $('[data-top-prev]', pager).disabled = state.page === 0;
    $('[data-top-next]', pager).disabled = state.page >= pages - 1;
  };
  sortableTable($('table', box), {
    sort: state.sort,
    dir: state.dir,
    onSort: (key, dir) => {
      Object.assign(state, { sort: key, dir, page: 0 });
      draw();
    },
  });
  const turnPage = (step) => ((state.page += step), toListTop(box.closest('.dash-card') ?? box), draw());
  $('[data-top-prev]', pager).addEventListener('click', () => turnPage(-1));
  $('[data-top-next]', pager).addEventListener('click', () => turnPage(1));
  draw();
}

async function renderAttention(box, loc = null, stale = () => false) {
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  // A store's tab covers only what belongs to that store; catalog and email problems are shop-wide, so they stay on Today.
  const scoped = loc != null;
  const customers = () => {
    const q = sb.from('customers').select('id', { count: 'exact', head: true });
    return scoped ? q.eq('home_location_id', loc) : q;
  };
  const heldBefore = addDays(today(), -(settings.hold_days ?? 30));
  const wide = (fn) => (scoped ? Promise.resolve(0) : fn());
  const overdueQuery = sb.from('reservations').select('id', { count: 'exact', head: true }).eq('status', 'arrived').lt('arrived_on', heldBefore);
  // Event signups nobody has looked at yet; a store's tab counts only signups for that store's events.
  const eventSignups = scoped
    ? sb.from('event_signups').select('id, events!inner(location_id)', { count: 'exact', head: true }).eq('events.location_id', loc)
    : sb.from('event_signups').select('id', { count: 'exact', head: true });
  const [guestMatches, overdue, failedEmails, signups, noEmail, noCover, noCategory, hidden, noPrice, newResponses, newEventSignups] = await Promise.all([
    wide(() => findGuestMatches(sb).then((m) => m.length)),
    count(scoped ? overdueQuery.eq('location_id', loc) : overdueQuery),
    wide(() => count(sb.from('email_log').select('id', { count: 'exact', head: true }).eq('status', 'failed').gte('created_at', weekAgo))),
    count(customers().not('user_id', 'is', null).gte('created_at', weekAgo)),
    count(customers().is('email', null)),
    wide(() => count(items().is('cover_url', null).eq('hidden', false))),
    wide(() => count(items().is('category_id', null).eq('hidden', false))),
    wide(() => count(items().eq('hidden', true))),
    wide(() => count(items().is('price', null).eq('hidden', false))),
    wide(() => count(sb.from('survey_responses').select('id', { count: 'exact', head: true }).eq('seen', false))),
    count(eventSignups.eq('seen', false)),
  ]);
  if (stale()) return;
  // Each row with something to fix links to the screen that fixes it, already filtered (the destination reads the hand-off).
  // `go.view` marks an item that is information rather than a problem: a quieter "View" button instead of "Fix".
  // Rows at zero are left off, so the card lists only what needs doing.
  const row = (n, text, go) => {
    if (!n) return '';
    const btn = go.view ? { cls: 'btn--ghost', icon: 'view', word: 'View' } : { cls: 'btn--primary', icon: 'fix', word: 'Fix' };
    return `<li class="has-fix"><span class="dash-facts__text"><strong>${n.toLocaleString()}</strong> <span>${text}</span></span><a class="btn ${btn.cls} btn--small" href="#${go.page}" data-go-page="${go.page}" data-go-key="${go.key}" data-go="${esc(JSON.stringify(go.filter))}" aria-label="${btn.word}: ${n.toLocaleString()} ${esc(text)}">${solidIcon(btn.icon, 16)} ${btn.word}</a></li>`;
  };
  // Owners: nag when the last backup download is more than a week old (or there never was one).
  const backup = isOwner && !scoped ? await lastBackup(sb).catch(() => undefined) : undefined;
  const backupRow = backup === undefined || (backup && backup.days <= 7) ? '' : `<li class="has-fix"><span class="dash-facts__text"><strong>${backup ? `${backup.days} days` : 'Never'}</strong> <span>${backup ? 'since the last backup' : 'backed up: download a backup'}</span></span><a class="btn btn--primary btn--small" href="#backup">${solidIcon('fix', 16)} Back up</a></li>`;
  const visible = { visibility: 'visible' };
  const rows = [
    backupRow,
    row(overdue, `${overdue === 1 ? 'title is' : 'titles are'} past the pickup window`, { page: 'reservations', key: 'admin-reservations-status', filter: 'overdue' }),
    scoped ? '' : row(failedEmails, `${failedEmails === 1 ? 'email' : 'emails'} failed to send in the last 7 days`, { page: 'emails', key: 'admin-emails-failed', filter: '1' }),
    scoped ? '' : row(guestMatches, `guest ${guestMatches === 1 ? 'order matches' : 'orders match'} an existing customer`, { page: 'customers', key: 'admin-customers-show', filter: 'link_guests' }),
    scoped ? '' : row(newResponses, `new survey ${newResponses === 1 ? 'response' : 'responses'} to read`, { page: 'surveys', key: 'admin-surveys-tab', filter: 'all', view: true }),
    row(newEventSignups, `new event ${newEventSignups === 1 ? 'signup' : 'signups'} to look at`, { page: 'events', key: 'admin-events-past', filter: 'signups', view: true }),
    row(signups, `${signups === 1 ? 'customer' : 'customers'} signed up this week`, { page: 'customers', key: 'admin-customers-show', filter: 'new_week', view: true }),
    row(noEmail, `${noEmail === 1 ? 'customer has' : 'customers have'} no email`, { page: 'customers', key: 'admin-customers-show', filter: 'no_email' }),
    scoped ? '' : row(noCover, `visible ${noCover === 1 ? 'title has' : 'titles have'} no cover`, { page: 'titles', key: 'admin-titles-filter', filter: { flag: 'no_cover', ...visible } }),
    scoped ? '' : row(noCategory, `visible ${noCategory === 1 ? 'title has' : 'titles have'} no category`, { page: 'titles', key: 'admin-titles-filter', filter: { category: 'none', ...visible } }),
    scoped ? '' : row(noPrice, `visible ${noPrice === 1 ? 'title has' : 'titles have'} no price`, { page: 'titles', key: 'admin-titles-filter', filter: { flag: 'no_price', ...visible } }),
    scoped ? '' : row(hidden, `${hidden === 1 ? 'title is' : 'titles are'} hidden from customers`, { page: 'titles', key: 'admin-titles-filter', filter: { flag: 'hidden' } }),
  ].join('');
  box.innerHTML = rows
    ? `<ul class="dash-facts">${rows}</ul><p class="admin-hint">Fix and View open the list already filtered to those items.</p>`
    : '<p class="empty">Nothing needs attention. All caught up.</p>';
  box.onclick = (e) => {
    const link = e.target.closest('[data-go]');
    if (!link) return;
    try {
      const filter = JSON.parse(link.dataset.go);
      sessionStorage.setItem(link.dataset.goKey, typeof filter === 'string' ? filter : JSON.stringify(filter));
    } catch {
      /* the link still opens the screen, just unfiltered */
    }
  };
}

// ---------------------------------------------------------------------------
// System Health: are the scheduled jobs running, and did the last run work?
// ---------------------------------------------------------------------------

const JOB_NAMES = {
  'flip-item-statuses': 'Title statuses',
  'apply-subscriptions': 'Pull list follows',
  'weekly-pull-list': 'Weekly pull list email',
  'arrival-email': '“Your books are in” email',
};
const JOB_HINTS = {
  'flip-item-statuses': 'moves titles to New This Wednesday, Just Arrived and in-store on their dates',
  'apply-subscriptions': 'adds new issues to the pull lists of customers who follow a series',
};
const STALE_MINUTES = 150; // every job runs hourly
// The master catalog's daily automatic imports (GitHub Actions, tools/*-auto-import.mjs), by their job_log name.
const DAILY_IMPORTS = { prh_import: 'Automatic PRH import', lunar_import: 'Automatic Lunar import' };
const DAILY_STALE_HOURS = 48; // they run every morning: two days without a run means the Action has stopped

/** "12 minutes ago", "3 hours ago", "2 days ago". */
function ago(iso) {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
  if (min < 2) return 'just now';
  if (min < 90) return `${min} minutes ago`;
  if (min < 48 * 60) return `${Math.round(min / 60)} hours ago`;
  return `${Math.round(min / 1440)} days ago`;
}
const daysSince = (day) => Math.round((Date.parse(`${today()}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86400000);
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const hourLabel = (h) => `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}`;

/**
 * One of the catalog's daily imports → a System Health row from its last job_log entry. A run that broke before it
 * could log anything (the Action itself failing) shows as no run for two days.
 */
function dailyImportRow(job, last) {
  const label = DAILY_IMPORTS[job];
  if (!last) return { level: 'warn', label, text: 'Has not run yet (a GitHub Action, every morning)' };
  const brief = last.message ? `: ${last.message.length > 140 ? `${last.message.slice(0, 140)}…` : last.message}` : '';
  if (!last.ok) return { level: 'bad', label, text: `Last run failed ${ago(last.created_at)}${brief}` };
  if (Date.now() - new Date(last.created_at) > DAILY_STALE_HOURS * 3600000) {
    return { level: 'warn', label, text: `Last ran ${ago(last.created_at)} (it should run every morning): check the Action on GitHub` };
  }
  return { level: 'ok', label, text: `Ran ${ago(last.created_at)}${brief}` };
}

/** One scheduled job → { level: ok | warn | bad, text } from its last run. */
function jobStatus(j) {
  if (!j.active) return { level: 'warn', text: 'Switched off' };
  if (!j.last_start) return { level: 'warn', text: 'Has not run yet' };
  if (j.last_status === 'failed') return { level: 'bad', text: `Last run failed ${ago(j.last_start)}${j.last_message ? `: ${j.last_message}` : ''}` };
  if (Date.now() - new Date(j.last_start) > STALE_MINUTES * 60000) return { level: 'warn', text: `Last ran ${ago(j.last_start)} (it should run every hour)` };
  return { level: 'ok', text: `Ran ${ago(j.last_start)}${j.failed_7d ? `; ${j.failed_7d} ${j.failed_7d === 1 ? 'run' : 'runs'} failed this week` : ''}` };
}

async function renderHealth(box) {
  const lastRun = (job) => must(sb.from('job_log').select('ok,message,created_at').eq('job', job).order('id', { ascending: false }).limit(1));
  const [health, imports, arrivals, ...daily] = await Promise.all([
    must(sb.rpc('staff_health')),
    lastRun('import'),
    must(sb.from('email_log').select('created_at,status').eq('kind', 'arrival').order('id', { ascending: false }).limit(1)),
    ...(IS_CATALOG ? Object.keys(DAILY_IMPORTS).map(lastRun) : []),
  ]);
  const rows = [];
  for (const j of health.jobs) {
    const st = jobStatus(j);
    let { level, text } = st;
    const parts = [text];
    if (j.name === 'weekly-pull-list') {
      if (!settings.pull_list_email_enabled) (level = 'off'), (parts[0] = 'Switched off in Emails');
      else {
        const sent = settings.pull_list_email_last_sent;
        parts.push(sent ? `Last sent ${fmtDate(sent, { month: 'short', day: 'numeric' })}${daysSince(sent) > 8 ? ` (${daysSince(sent)} days ago)` : ''}` : 'No email sent yet');
        parts.push(`goes out ${DAY_NAMES[settings.pull_list_email_day]}s at ${hourLabel(settings.pull_list_email_hour)}`);
        if (sent && daysSince(sent) > 8 && level === 'ok') level = 'warn';
      }
    } else if (j.name === 'arrival-email') {
      if (!settings.arrival_email_enabled) (level = 'off'), (parts[0] = 'Switched off in Emails');
      else {
        parts.push(arrivals[0] ? `Last sent ${ago(arrivals[0].created_at)}` : 'No arrival email sent yet');
        if (health.arrival_waiting) parts.push(`${plural(health.arrival_waiting, 'title')} waiting to be emailed`);
      }
    } else if (JOB_HINTS[j.name] && level === 'ok') {
      parts.push(JOB_HINTS[j.name]);
    }
    rows.push({ level, label: JOB_NAMES[j.name] ?? j.name, text: parts.join(' · ') });
  }
  const imp = imports[0];
  rows.push(
    imp
      ? { level: imp.ok ? 'ok' : 'bad', label: 'Last import', text: `${imp.ok ? 'Worked' : 'Failed'} ${ago(imp.created_at)}${imp.message ? `: ${imp.message.length > 140 ? `${imp.message.slice(0, 140)}…` : imp.message}` : ''}` }
      : { level: 'off', label: 'Last import', text: 'No imports yet' },
  );
  if (IS_CATALOG) Object.keys(DAILY_IMPORTS).forEach((job, i) => rows.push(dailyImportRow(job, daily[i][0])));
  if (health.http_errors_24h) rows.push({ level: 'bad', label: 'Email service', text: `${plural(health.http_errors_24h, 'call')} to send email failed in the last 24 hours: check the Emails log and the function logs` });

  const problems = rows.filter((r) => r.level === 'bad').length;
  const checks = rows.filter((r) => r.level === 'warn').length;
  $('[data-health-summary]').textContent = problems ? `${plural(problems, 'problem')} to look at${checks ? `, and ${checks} more to check` : ''}.` : checks ? `Nothing failed, but ${checks === 1 ? 'one item needs' : `${checks} items need`} a look.` : 'Everything scheduled is running.';
  const WORD = { ok: 'OK', warn: 'Check', bad: 'Problem', off: 'Off' };
  box.innerHTML = `<ul class="dash-health">${rows
    .map((r) => `<li class="is-${r.level}"><span class="dash-health__dot" aria-hidden="true"></span><span><strong>${esc(r.label)}</strong> <span class="visually-hidden">(${WORD[r.level]})</span><br><span class="card__meta">${esc(r.text)}</span></span></li>`)
    .join('')}</ul>`;
}
