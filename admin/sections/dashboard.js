// Dashboard: the staff landing page. Reservation headlines (new orders, what's
// waiting to be ordered or picked up), the latest orders, the next order cutoff,
// titles needing attention, a quick look at trends (the full set is in Analytics)
// and whether the scheduled jobs are running.
// Read-only; links out to the sections where things get changed.

import { $, esc, must, withCustomers, solidIcon, findGuestMatches, setStatus, fmtDate, fmtDateTime, sortableTable, friendlyError, setupTabs, listLocations, fmtTime, hintSlot, switchHtml } from '../lib.js';
import { lastReserveDay } from '../../js/dates.js';
import { lastBackup } from '../backup.js';
import { LINE_STATUS_SHORT } from '../../js/labels.js';
import { addDays } from '../../js/dates.js';
import { IS_CATALOG } from '../../js/config.js';
import { ACTIVE, DAYS, LINE_FIELDS, TREND_CARD, TOP_CARD, TOP_SEARCHES_CARD, useShop, today, dayKey, plural, all, count, items, loadPanel, activeLines, ordersSince, rememberLink, renderTrend, renderTop, renderTopSearches } from './analytics.js';

let sb;
let settings;
let isOwner = false;

export async function mount(el, ctx) {
  isOwner = ctx.isOwner === true;
  sb = ctx.sb;
  settings = await must(sb.from('settings').select('hold_days,timezone,announcement,pull_list_email_enabled,pull_list_email_day,pull_list_email_hour,pull_list_email_last_sent,arrival_email_enabled').eq('id', 1).single());
  useShop(sb, settings.timezone);
  const locations = await listLocations(sb); // [] unless the shop has 2+ locations: then each gets its own tab
  el.innerHTML = `
    <div class="admin-title-row">
      <h1>Dashboard</h1>
      <p class="card__meta" data-asof></p>
    </div>
    ${hintSlot()}
    <div class="admin-tabs" role="tablist">
      <button type="button" class="admin-tab" role="tab" data-tab="today">Today</button>
      ${locations.map((l) => `<button type="button" class="admin-tab" role="tab" data-tab="loc-${l.id}" data-icon="pin">${esc(l.name)}</button>`).join('')}
      <button type="button" class="admin-tab" role="tab" data-tab="trends">Trends</button>
      <button type="button" class="admin-tab" role="tab" data-tab="system">System</button>
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
      ${TREND_CARD}
      ${TOP_CARD}
      ${TOP_SEARCHES_CARD}
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

  const panel = (sel, fn) => loadPanel(el, sel, fn);
  const lines = activeLines();
  const since = addDays(today(), -(DAYS - 1));
  const recent = ordersSince(since);
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
  const todayHint = 'The shop at a glance: today’s numbers, anything that needs fixing (lines at zero are hidden), the next order cutoff and the latest orders.';
  const hints = {
    today: todayHint,
    ...Object.fromEntries(locations.map((l) => [`loc-${l.id}`, `${todayHint} This tab shows ${esc(l.name)} only.`])),
    trends: `A quick look: orders per day over the last ${DAYS} days, the most-reserved titles and what people search for most. Analytics has the full picture.`,
    system: 'Whether the shop’s scheduled jobs, such as the nightly backup and the weekly emails, are running on time.',
  };
  setupTabs(el, 'admin-dashboard-tab', 'today', (tab) => {
    const location = tab.startsWith('loc-') ? tab.slice(4) : '';
    if (location) $('[data-tabpane="today"]', el).hidden = false;
    if (shown !== location && (tab === 'today' || location)) loadToday(location);
  }, hints);

  await Promise.all([
    shown === null ? loadToday('') : null,
    panel('[data-trend]', async (box) => renderTrend(box, await recent, since)),
    panel('[data-top]', async (box) => renderTop(box, await lines)),
    panel('[data-top-searches]', renderTopSearches),
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
  const copies = (status) => lines.filter((l) => l.status === status && (status !== 'open' || l.counts_for_order !== false)).reduce((n, l) => n + l.quantity, 0);
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
  box.onclick = rememberLink;
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
  const onFoc = lines.filter((l) => l.status === 'open' && l.counts_for_order !== false && l.item?.foc_date === foc);
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
  'pickup-ladder': 'Unclaimed books reminders and pauses',
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
