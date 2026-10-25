// Reservations: customer orders (each with one or more titles), per-title
// status, lookup by name/phone/email, CSV export — plus a "To order" view that
// totals reserved copies per title for each order cutoff.

import { $, $$, esc, must, toast, isPhone, hintFold, fmtDate, fmtDateTime, itemName, downloadCsv, sortableTable, customerFilter, withCustomers, formatPhone, solidIcon, friendlyError, fromError, anyOf, emailMatch, digitsMatch, loadSentMessages, listLocations, locationFilterField, fmtTime } from '../lib.js';
import { LINE_STATUS } from '../../js/labels.js';
import { addDays, todayIn, dayIn, stampIn, holdUntil as holdDate } from '../../js/dates.js';

const PAGE = 25;
const ITEM_FIELDS = 'id,title,issue_number,variant,publisher,price,foc_date,release_date';
let sb;
let settings;
// The To order view is built from a snapshot of open reservations. Remember when it was taken, and
// reload it when staff come back to the tab, so exports never use quantities from before an edit.
let toOrderBody = null;
let toOrderLoadedAt = 0;
let toOrderHooked = false;
const STALE_MS = 30000;

let state = { view: 'orders', q: '', location: '', status: 'active', sort: 'placed', dir: 'desc', offset: 0 };
// The status choices: the common views first, then each individual title status.
/** The one-tap filters above the list (the dropdown has every status). */
const QUICK_STATUS = { active: 'Active', arrived: 'Ready', overdue: 'Past pickup', ordered: 'Ordered', all: 'All' };
const ORDER_FILTERS = { active: 'Active (open, ordered or ready)', overdue: 'Past pickup window', all: 'Any status', ...LINE_STATUS };

/** Limit a reservations query to the location picked at the top of the screen (all locations when none is). */
const atLocation = (q) => (state.location ? q.eq('location_id', state.location) : q);
let locationNames = new Map(); // id → name, for a shop with 2+ locations
const locationSlug = () => (state.location && locationNames.get(Number(state.location)) ? `-${locationNames.get(Number(state.location)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}` : '');

const today = () => todayIn(settings.timezone);
const holdUntil = (line) => holdDate(line.arrived_on, settings.hold_days ?? 30);
/** "2026-10-01 18:43": a timestamp's date and time in the shop's time zone, for CSV exports. */
const placedAt = (ts) => `${dayIn(ts, settings.timezone)} ${new Intl.DateTimeFormat('en-GB', { timeZone: settings.timezone || undefined, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ts))}`;

export async function mount(el, ctx) {
  sb = ctx.sb;
  settings = await must(sb.from('settings').select('hold_days,timezone').eq('id', 1).single());
  el.innerHTML = `
    <h1>Ordering</h1>
    <div class="admin-tabs" role="tablist">
      <button type="button" class="admin-tab" role="tab" data-view="orders">Reservations</button>
      <button type="button" class="admin-tab" role="tab" data-view="toorder">Place Order</button>
      <button type="button" class="admin-tab" role="tab" data-view="past">Past Orders</button>
      <button type="button" class="admin-tab" role="tab" data-view="ready">Received</button>
    </div>
    <form class="filters admin-filters" data-location-bar hidden></form>
    <div data-body></div>`;
  // A shop with 2+ locations picks which one to work on; it applies to all three tabs (orders are placed and received per location).
  listLocations(sb).then((locations) => {
    if (!locations.length) return void (state.location = '');
    locationNames = new Map(locations.map((l) => [l.id, l.name]));
    if (state.location && !locationNames.has(Number(state.location))) state.location = '';
    const bar = $('[data-location-bar]', el);
    bar.innerHTML = locationFilterField(locations, state.location, 'r-loc');
    bar.hidden = false;
    bar.addEventListener('submit', (e) => e.preventDefault());
    bar.addEventListener('change', () => {
      state.location = bar.elements.location.value;
      state.offset = 0;
      render(el);
    });
    if (state.location) render(el); // a remembered choice: load with it
  });
  $$('[data-view]', el).forEach((b) =>
    b.addEventListener('click', () => {
      state.view = b.dataset.view;
      try {
        sessionStorage.setItem('admin-reservations-view', state.view);
      } catch {
        /* remembering the tab is optional */
      }
      render(el);
    }),
  );
  // A refresh stays on the tab you were on.
  try {
    const view = sessionStorage.getItem('admin-reservations-view');
    if (['orders', 'toorder', 'past', 'ready'].includes(view)) state.view = view;
  } catch {
    /* start on Orders */
  }
  // The Dashboard's Needs Attention "Fix" opens Orders already filtered (e.g. past the pickup window).
  try {
    const status = sessionStorage.getItem('admin-reservations-status');
    if (status) {
      sessionStorage.removeItem('admin-reservations-status');
      state = { ...state, view: 'orders', q: '', status, offset: 0 };
    }
  } catch {
    /* no hand-off */
  }
  // Opened from the Dashboard's "View order" on a guest order: go straight to that guest's page.
  let guest = null;
  try {
    guest = Number(sessionStorage.getItem('admin-open-guest')) || null;
    sessionStorage.removeItem('admin-open-guest');
  } catch {
    /* no stored hand-off */
  }
  if (guest) {
    state.view = 'orders';
    $$('[data-view]', el).forEach((b) => b.setAttribute('aria-selected', b.dataset.view === 'orders'));
    renderGuest($('[data-body]', el), guest);
  } else render(el);
}

function render(el) {
  $$('[data-view]', el).forEach((b) => b.setAttribute('aria-selected', b.dataset.view === state.view));
  const body = $('[data-body]', el);
  if (state.view === 'orders') renderOrders(body);
  else if (state.view === 'ready') renderReady(body);
  else if (state.view === 'past') renderPastOrders(body);
  else renderToOrder(body);
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

function renderOrders(body) {
  if (!ORDER_FILTERS[state.status]) state.status = 'active';
  body.innerHTML = `
    <form class="filters admin-filters orders-filters" role="search" aria-label="Find reservations">
      <div class="field field--search"><label for="r-q">Search</label><input id="r-q" name="q" type="search" placeholder="Customer name, phone, email or title" value="${esc(state.q)}"></div>
      <div class="status-chips" role="group" aria-label="Quick filters">${Object.entries(QUICK_STATUS).map(([v, l]) => `<button type="button" class="chip" data-quick="${v}" aria-pressed="${state.status === v}">${l}<span data-quick-count="${v}"></span></button>`).join('')}</div>
      <div class="field orders-filters__status"><label for="r-status">Titles that are</label><select id="r-status" name="status">${Object.entries(ORDER_FILTERS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
      <div class="field orders-filters__csv"><button class="btn btn--ghost" type="button" data-csv>Export CSV</button></div>
    </form>
    <p class="results-count" role="status" data-count></p>
    <div data-orders>
      <div class="admin-table-wrap"><table class="admin-table orders-table cards">
        <thead><tr><th scope="col" data-sort="name">Customer</th><th scope="col" class="center">Titles</th><th scope="col" data-sort="placed" data-first="desc">Placed</th><th scope="col">Type</th><th scope="col">Status</th><th scope="col"><span class="visually-hidden">Open</span></th></tr></thead>
        <tbody data-rows></tbody>
      </table></div>
    </div>
    <div class="admin-pager"><button class="btn btn--ghost" type="button" data-prev>← Newer</button><span data-page></span><button class="btn btn--ghost" type="button" data-next>Older →</button></div>`;
  const form = $('form', body);
  form.elements.status.value = state.status;
  let timer;
  form.addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state = { ...state, ...Object.fromEntries(new FormData(form)), offset: 0 };
      loadOrders(body);
    }, e.target.type === 'search' ? 300 : 0);
  });
  form.addEventListener('submit', (e) => e.preventDefault());
  const syncChips = () => $$('[data-quick]', form).forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.quick === form.elements.status.value)));
  form.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-quick]');
    if (!chip) return;
    form.elements.status.value = chip.dataset.quick;
    state = { ...state, ...Object.fromEntries(new FormData(form)), offset: 0 };
    syncChips();
    loadOrders(body);
  });
  form.elements.status.addEventListener('change', syncChips);
  sortableTable($('table', body), { sort: state.sort, dir: state.dir, onSort: (sort, dir) => ((state = { ...state, sort, dir, offset: 0 }), loadOrders(body)) });
  $('[data-prev]', body).addEventListener('click', () => ((state.offset = Math.max(0, state.offset - PAGE)), loadOrders(body)));
  $('[data-next]', body).addEventListener('click', () => ((state.offset += PAGE), loadOrders(body)));
  $('[data-csv]', body).addEventListener('click', () => exportCsv());
  $('[data-rows]', body).addEventListener('click', (e) => {
    const link = e.target.closest('[data-customer]');
    if (link) {
      try {
        sessionStorage.setItem('admin-open-customer', link.dataset.customer);
      } catch {
        /* the link still opens the customer list */
      }
      return;
    }
    const row = e.target.closest('tr[data-open]');
    if (!row) return;
    e.preventDefault();
    row.nextElementSibling?.matches('.order-expand') ? collapseOrder(row) : expandOrder(row);
  });
  bindOrderActions($('[data-rows]', body), body, () => loadOrders(body));
  // The "Past pickup window" choice shows how many orders are waiting past the hold window.
  sb.from('reservation_orders').select('id, reservations!inner(id)', { count: 'exact', head: true }).eq('reservations.status', 'arrived').lt('reservations.arrived_on', overdueBefore())
    .then(({ count }) => {
      const opt = $('option[value="overdue"]', form);
      if (opt && count) opt.textContent = `${ORDER_FILTERS.overdue} (${count})`;
      const chip = $('[data-quick-count="overdue"]', form);
      if (chip && count) chip.textContent = count;
    });
  loadOrders(body);
}

/** Change a title's status, or mark every arrived title picked up, then run `reload`. Also remembers which customer a link opens. */
function bindOrderActions(box, body, reload) {
  box.addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-line]');
    if (!sel) return;
    await setLineStatus([Number(sel.dataset.line)], sel.value);
    reload();
  });
  box.addEventListener('click', async (e) => {
    const cust = e.target.closest('[data-customer]');
    if (cust) {
      try {
        sessionStorage.setItem('admin-open-customer', cust.dataset.customer);
      } catch {
        /* the link still opens the customer list */
      }
      return;
    }
    const guest = e.target.closest('[data-guest]');
    if (guest) {
      e.preventDefault();
      return renderGuest(body, Number(guest.dataset.guest));
    }
    const all = e.target.closest('[data-all]');
    if (!all) return;
    await setLineStatus(all.dataset.lines.split(',').map(Number), all.dataset.all, ['arrived']);
    reload();
  });
}

/** Orders expanded in the list (kept open when the list reloads, e.g. after a status change). */
const openOrders = new Set();

/** Show an order's titles, statuses and messages in a row under its line in the list; click again to close. */
async function expandOrder(tr) {
  const id = Number(tr.dataset.open);
  let x = tr.nextElementSibling;
  if (!x?.matches('.order-expand')) {
    x = document.createElement('tr');
    x.className = 'order-expand card-expand';
    x.innerHTML = '<td colspan="6"><div data-order-box aria-busy="true"><p class="admin-hint">Loading…</p></div></td>';
    tr.after(x);
  }
  openOrders.add(id);
  tr.classList.add('is-open'); // the row's colour; the state itself is on its View / Hide button
  const view = $('button[data-open]', tr);
  if (view) (view.firstChild.textContent = 'Hide'), view.setAttribute('aria-expanded', 'true');
  const box = $('[data-order-box]', x);
  try {
    const o = await must(sb.from('reservation_orders').select(`*, customer:customers(id,name,phone,email), reservations(*, item:items(${ITEM_FIELDS}))`).eq('id', id).single());
    await withCustomers(sb, [o]);
    box.innerHTML = orderPanelHtml(o);
  } catch (err) {
    box.innerHTML = `<p class="form-error">${esc(friendlyError(err))}</p>`;
  }
  box.removeAttribute('aria-busy');
}

function collapseOrder(tr) {
  if (tr.nextElementSibling?.matches('.order-expand')) tr.nextElementSibling.remove();
  openOrders.delete(Number(tr.dataset.open));
  tr.classList.remove('is-open');
  const view = $('button[data-open]', tr);
  if (view) (view.firstChild.textContent = 'View'), view.setAttribute('aria-expanded', 'false');
}

/** An order's details, shown inside the list: order number, type and links, the green "mark all picked up" button, and every title with its status. */
function orderPanelHtml(o) {
  const t = today();
  const lines = [...(o.reservations ?? [])].sort((a, b) => (a.item?.release_date ?? '').localeCompare(b.item?.release_date ?? ''));
  const arrivedIds = lines.filter((l) => l.status === 'arrived').map((l) => l.id);
  return `<div class="order order--inline" data-order="${o.id}">
        <div class="order__toolbar">
          <p class="card__meta order__meta"><span class="order__id">Order #${o.id}</span> <span class="pill pill--${o.kind === 'pull_list' ? 'pull' : 'guest'}">${o.kind === 'pull_list' ? 'Pull list' : 'Guest order'}</span> <span>${lines.length} ${lines.length === 1 ? 'title' : 'titles'}</span> <span>${fmtDateTime(o.created_at)}</span></p>
          <div class="order__actions">
            ${o.unlinked_match ? `<a class="btn btn--primary btn--small" href="#customers" data-customer="${o.customer_id}" title="This guest order matches ${esc(o.name)}: open the customer to link it" aria-label="Fix: link guest order ${o.id} to ${esc(o.name)}">${solidIcon('fix', 16)} Fix</a>` : ''}
            ${arrivedIds.length > 1 ? `<button class="btn btn--small btn--green" type="button" data-all="picked_up" data-lines="${arrivedIds.join(',')}">Mark all ${arrivedIds.length} arrived titles picked up</button>` : ''}
            ${o.customer_id ? `<a class="btn btn--small btn--blue" href="#customers" data-customer="${o.customer_id}">View Customer</a>` : `<a class="btn btn--small btn--blue" href="#reservations" data-guest="${o.id}">View Customer</a>`}
          </div>
        </div>
        <table class="admin-table order__lines">
          <thead><tr><th scope="col">Title</th><th scope="col" class="col-qty">Qty</th><th scope="col" class="col-out">Out</th><th scope="col" class="col-status">Status</th></tr></thead>
          <tbody>${lines
            .map((l) => {
              const until = holdUntil(l);
              const overdue = l.status === 'arrived' && until && until < t;
              return `<tr${overdue ? ' class="is-overdue"' : ''}>
                <td class="col-title">${esc(l.item ? itemName(l.item) : `Title #${l.item_id}`)}</td>
                <td class="center col-qty">${l.quantity}</td>
                <td class="nowrap col-out">${fmtDate(l.item?.release_date, { month: 'short', day: 'numeric' })}</td>
                <td class="col-status">
                  <label class="visually-hidden" for="line-${l.id}">Status of ${esc(l.item?.title ?? '')}</label>
                  <select id="line-${l.id}" class="select--small" data-line="${l.id}">${Object.entries(LINE_STATUS).map(([v, lbl]) => `<option value="${v}"${v === l.status ? ' selected' : ''}>${lbl}</option>`).join('')}</select>
                  ${until && l.status === 'arrived' ? `<div class="card__meta">${overdue ? '<strong>Past pickup window</strong> — ' : ''}hold until ${fmtDate(until, { month: 'short', day: 'numeric' })}</div>` : ''}
                </td>
              </tr>`;
            })
            .join('')}</tbody>
        </table>
      </div>`;
}

/** Guest orders have no customer record: show their contact details and every order placed with the same phone or email. */
async function renderGuest(body, orderId) {
  body.innerHTML = '<p class="admin-hint" aria-busy="true">Loading…</p>';
  try {
    const first = await must(sb.from('reservation_orders').select('id,name,phone,email,phone_digits,notes,created_at').eq('id', orderId).single());
    const ors = anyOf(`id.eq.${Number(first.id)}`, digitsMatch('phone_digits', first.phone_digits), emailMatch('email', first.email));
    const orders = await must(sb.from('reservation_orders').select(`id,name,kind,created_at,reservations(id,quantity,status,item:items(${ITEM_FIELDS}))`).or(ors).order('created_at', { ascending: false }));
    body.innerHTML = `
      <p><button class="btn btn--ghost btn--small" type="button" data-back>← Back to reservations</button></p>
      <h2>${esc(first.name)} <span class="pill">Guest order</span></h2>
      <p class="admin-hint">Not signed up for a pull list. ${first.phone ? `<a href="tel:${esc(first.phone.replace(/[^\d+]/g, ''))}">${esc(formatPhone(first.phone))}</a>` : ''}${first.phone && first.email ? ' · ' : ''}${first.email ? `<a href="mailto:${esc(first.email)}">${esc(first.email)}</a>` : ''}</p>
      ${first.notes ? `<p>${esc(first.notes)}</p>` : ''}
      ${first.email ? `<details class="order__messages" data-messages-for data-customer="" data-email="${esc(first.email)}"><summary>Messages sent <span class="card__meta" data-messages-sum></span></summary><div data-messages></div></details>` : ''}
      ${orders.map((o) => `<h3>Order #${o.id} <span class="order__when">${fmtDateTime(o.created_at)}</span></h3>
        <table class="admin-table cards"><thead><tr><th scope="col">Title</th><th scope="col" class="col-qty">Qty</th><th scope="col">Out</th><th scope="col">Status</th></tr></thead>
        <tbody>${o.reservations.map((l) => `<tr>
          <td class="card-title">${esc(l.item ? itemName(l.item) : `Title #${l.item_id}`)}</td>
          <td class="center card-key card-label">${l.quantity}</td>
          <td class="nowrap card-key card-label">${fmtDate(l.item?.release_date, { month: 'short', day: 'numeric' })}</td>
          <td class="card-key">${esc(LINE_STATUS[l.status] ?? l.status)}</td>
          </tr>`).join('')}</tbody>
          </table>`).join('')}`;
  } catch (err) {
    body.innerHTML = `<p><button class="btn btn--ghost btn--small" type="button" data-back>← Back to reservations</button></p><p class="form-error">${esc(friendlyError(err))}</p>`;
  }
  watchMessages(body);
  $('[data-back]', body).addEventListener('click', () => renderOrders(body));
}

/** Messages sent panels open lazily (one query per panel, only when opened) and refresh when an email is sent. */
const showMessages = (panel) => loadSentMessages(sb, $('[data-messages]', panel), $('[data-messages-sum]', panel), { customerId: panel.dataset.customer || null, email: panel.dataset.email });
let messagesHandler = null;
function watchMessages(box) {
  if (!box.dataset.watching) {
    box.dataset.watching = '1';
    box.addEventListener('toggle', (e) => e.target.matches?.('[data-messages-for]') && e.target.open && showMessages(e.target), true); // toggle doesn't bubble
  }
  if (messagesHandler) window.removeEventListener('customer-email-sent', messagesHandler);
  messagesHandler = () => $$('[data-messages-for][open]', box).forEach(showMessages);
  window.addEventListener('customer-email-sent', messagesHandler);
}

/** Ids of the orders that have a line for a title matching `text` (title, with or without the issue number). Capped, newest first. */
async function orderIdsForTitle(text) {
  const t = text.trim().replace(/[%,()*\\]/g, ' ').replace(/\s+/g, ' ');
  if (t.length < 3) return [];
  const m = t.match(/^(.*?)\s*#?\s*(\d+)$/);
  let q = sb.from('items').select('id').limit(100);
  q = m && m[1] ? q.ilike('title', `%${m[1]}%`).eq('issue_number', m[2]) : q.ilike('title', `%${t}%`);
  const { data: items } = await q;
  if (!items?.length) return [];
  const { data: lines } = await atLocation(sb.from('reservations').select('order_id').in('item_id', items.map((i) => i.id))).order('id', { ascending: false }).limit(300);
  return [...new Set((lines ?? []).map((l) => Number(l.order_id)))];
}

/**
 * `.or()` filter for the Customer search box. Matches the name/phone/email an order was placed under, and
 * also customers who match today (by linked id or by email), so a renamed customer is found by their new name.
 */
async function orderMatch(text) {
  const base = customerFilter(text);
  if (!base) return '';
  const { data } = await sb.from('customers').select('id,email').or(customerFilter(text, { words: true })).limit(200);
  // Orders with a title matching the text too ("who reserved Batman #12?").
  const orderIds = await orderIdsForTitle(text);
  return anyOf(
    base,
    data?.length ? `customer_id.in.(${data.map((c) => Number(c.id)).join(',')})` : '',
    orderIds.length ? `id.in.(${orderIds.join(',')})` : '',
    (data ?? []).slice(0, 50).map((c) => emailMatch('email', c.email)),
  );
}

/** Orders query for the current filters. `inner` = only include matching lines. */
function ordersQuery(select, match, { count = false } = {}) {
  let q = sb.from('reservation_orders').select(select, count ? { count: 'exact' } : undefined);
  if (match) q = q.or(match);
  if (state.location) q = q.eq('reservations.location_id', state.location); // orders with a title picked up there
  if (state.status === 'active') q = q.in('reservations.status', ['open', 'ordered', 'reordered', 'arrived']);
  else if (state.status === 'overdue') q = q.eq('reservations.status', 'arrived').lt('reservations.arrived_on', overdueBefore());
  else if (state.status !== 'all') q = q.eq('reservations.status', state.status);
  return q.order(state.sort === 'name' ? 'name' : 'created_at', { ascending: state.dir === 'asc' }).order('id', { ascending: false });
}

const overdueBefore = () => addDays(today(), -(settings.hold_days ?? 30));

// Each list load is numbered, so a slow response for an earlier search can't overwrite a newer one.
let ordersReq = 0;

async function loadOrders(body) {
  const req = ++ordersReq;
  const box = $('[data-orders]', body);
  const rowsEl = $('[data-rows]', body);
  box.setAttribute('aria-busy', 'true');
  const match = await orderMatch(state.q);
  if (req !== ordersReq) return;
  const { data, count, error } = await ordersQuery(`*, customer:customers(id,name,phone,email), reservations!inner(*, item:items(${ITEM_FIELDS}))`, match, { count: true }).range(state.offset, state.offset + PAGE - 1);
  if (req !== ordersReq) return;
  box.removeAttribute('aria-busy');
  if (error) {
    rowsEl.innerHTML = `<tr><td colspan="6" class="form-error">${esc(friendlyError(error))}</td></tr>`;
    return;
  }
  $('[data-count]', body).textContent = `${count} ${count === 1 ? 'order' : 'orders'}`;
  $('[data-page]', body).textContent = count ? `${state.offset + 1}–${Math.min(state.offset + PAGE, count)} of ${count}` : '';
  $('[data-prev]', body).disabled = state.offset === 0;
  $('[data-next]', body).disabled = state.offset + PAGE >= count;
  if (!data.length) {
    rowsEl.innerHTML = `<tr><td colspan="6" class="empty">${state.q || state.status !== 'active' ? 'No orders match.' : 'No open reservations right now.'}</td></tr>`;
    return;
  }
  const t = today();
  await withCustomers(sb, data);
  if (req !== ordersReq) return;
  rowsEl.innerHTML = data
    .map((o) => {
      const lines = o.reservations;
      const counts = new Map();
      for (const l of lines) counts.set(l.status, (counts.get(l.status) ?? 0) + 1);
      const summary = [...counts].map(([st, n]) => `${n} ${LINE_STATUS[st] ?? st}`).join(' · ');
      const overdue = lines.some((l) => {
        const until = holdUntil(l);
        return l.status === 'arrived' && until && until < t;
      });
      return `<tr class="is-clickable${overdue ? ' is-overdue' : ''}" data-open="${o.id}">
        <td class="card-title"><a href="#reservations" data-open="${o.id}"><strong>${esc(o.name)}</strong></a><br><span class="card__meta">Order #${o.id}</span></td>
        <td class="center card-label">${lines.length}</td>
        <td class="nowrap card__meta">${fmtDateTime(o.created_at)}</td>
        <td><span class="pill pill--${o.kind === 'pull_list' ? 'pull' : 'guest'}">${o.kind === 'pull_list' ? 'Pull list' : 'Guest order'}</span></td>
        <td class="card-wide"><span>${esc(summary)}${overdue ? ' · <strong>past pickup</strong>' : ''}</span></td>
        <td class="nowrap card-action">${o.unlinked_match ? `<a class="btn btn--primary btn--small" href="#customers" data-customer="${o.customer_id}" title="This guest order matches ${esc(o.name)}: open the customer to link it" aria-label="Fix: link guest order ${o.id} to ${esc(o.name)}">${solidIcon('fix', 16)} Fix</a> ` : ''}<button class="btn btn--ghost btn--small" type="button" data-open="${o.id}" aria-expanded="false">View<span class="visually-hidden"> order ${o.id}</span></button>
          </td>
      </tr>`;
    })
    .join('');
  // Keep the orders that were open, open (a status change reloads the list).
  const stillShown = new Set(data.map((o) => o.id));
  for (const id of [...openOrders]) {
    if (!stillShown.has(id)) openOrders.delete(id);
    else expandOrder($(`tr[data-open="${id}"]`, rowsEl));
  }
}

/**
 * Change the status of reservation lines (ids go in the request body, so any number fits). Only lines still in one of
 * `from` change (any status when it's null), so a line someone changed meanwhile is left alone. Ready starts the hold
 * window: the database stamps today as the arrival date (the nightly flip does the same). Each change is written to
 * the customer's pull list history. Returns how many lines changed.
 */
async function updateLines(ids, status, from = null) {
  return must(sb.rpc('staff_set_line_status', { p_ids: ids, p_status: status, p_from: from }));
}

/** updateLines(), then say how many changed (and how many were skipped because they'd changed meanwhile). */
async function setLineStatus(ids, status, from = null) {
  try {
    const n = await updateLines(ids, status, from);
    const skipped = ids.length - n;
    if (!n) return void toast(`Nothing changed: ${ids.length === 1 ? 'that title' : 'those titles'} changed meanwhile.`, 'error');
    toast(`${n === 1 ? 'Title' : `${n} titles`} marked ${LINE_STATUS[status].toLowerCase()}${skipped ? ` (${skipped} changed meanwhile and left alone)` : ''}`);
  } catch (err) {
    toast(`Not saved: ${friendlyError(err)}`, 'error');
  }
}

async function exportCsv() {
  const rows = [];
  const match = await orderMatch(state.q);
  for (let from = 0; ; from += 1000) {
    const { data, error } = await ordersQuery(`*, customer:customers(id,name,phone,email), reservations!inner(*, item:items(${ITEM_FIELDS}))`, match).range(from, from + 999);
    if (error) return toast(`Export failed: ${friendlyError(error)}`, 'error');
    await withCustomers(sb, data);
    for (const o of data)
      for (const l of o.reservations)
        rows.push([o.id, placedAt(o.created_at), o.name, formatPhone(o.phone), o.email, l.item?.title, l.item?.issue_number, l.item?.variant, l.item?.publisher, l.quantity, l.item?.price, l.item?.foc_date, l.item?.release_date, LINE_STATUS[l.status], l.arrived_on, holdUntil(l)]);
    if (data.length < 1000) break;
  }
  downloadCsv(`reservations-${stamp()}.csv`, ['Order', 'Placed', 'Name', 'Phone', 'Email', 'Title', 'Issue', 'Variant', 'Publisher', 'Qty', 'Price', 'FOC', 'Release', 'Status', 'Arrived', 'Hold until'], rows);
  toast(`Exported ${rows.length} reserved ${rows.length === 1 ? 'title' : 'titles'}`);
}

// ---------------------------------------------------------------------------
// Mark ready: books are on the shelf today, so flip many titles to Ready at once
// ---------------------------------------------------------------------------

/** Open, ordered and reordered reservations, totalled per title. Titles releasing after this week (Sunday to Saturday) are listed only when asked for. */
async function renderReady(body) {
  // The instructions are long: folded away on phones, where they would fill the first screen.
  body.innerHTML = `${hintFold(`Every title releasing this week is listed, with the copies customers have reserved (open, ordered or reordered). Titles nobody reserved can’t be ticked. Titles out this week start ticked; ones with no release date, from earlier weeks, or only reordered (the replacement comes later) you tick by hand. Tick the ones that are in the shop today and mark them Ready — customers see them as ready for pickup and the hold window starts today.`)}
    <form class="filters admin-filters" role="search" aria-label="Find titles">
      <div class="field field--search"><label for="rd-q">Title</label><input id="rd-q" type="search" placeholder="Filter by title or publisher"></div>
      <div class="field"><label class="cust-export-opt" for="rd-future"><input type="checkbox" id="rd-future"> Include titles releasing after this week</label></div>
    </form>
    <div data-ready aria-busy="true"></div>`;
  const box = $('[data-ready]', body);
  const picked = new Set();
  let rows = [];
  let seeded = false;
  const weekStart = addDays(today(), -new Date(`${today()}T00:00:00Z`).getUTCDay());
  const weekEnd = addDays(weekStart, 6);

  async function load() {
    box.setAttribute('aria-busy', 'true');
    try {
      const lines = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await atLocation(sb.from('reservations').select(`id,quantity,order_id,status,item:items(${ITEM_FIELDS})`).in('status', ['open', 'ordered', 'reordered'])).order('id').range(from, from + 999);
        if (error) throw fromError(error);
        lines.push(...data);
        if (data.length < 1000) break;
      }
      const byItem = new Map();
      for (const l of lines) {
        if (!l.item) continue;
        const r = byItem.get(l.item.id) ?? { item: l.item, copies: 0, orders: new Set(), lineIds: [], onOrder: false };
        r.copies += l.quantity;
        if (l.status !== 'reordered') r.onOrder = true;
        r.orders.add(l.order_id);
        r.lineIds.push(l.id);
        byItem.set(l.item.id, r);
      }
      // Every title releasing this week is listed, reserved or not.
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from('items').select(ITEM_FIELDS).gte('release_date', weekStart).lte('release_date', weekEnd).order('id').range(from, from + 999);
        if (error) throw fromError(error);
        for (const item of data) if (!byItem.has(item.id)) byItem.set(item.id, { item, copies: 0, orders: new Set(), lineIds: [] });
        if (data.length < 1000) break;
      }
      rows = [...byItem.values()].sort((a, b) => itemName(a.item).localeCompare(itemName(b.item)));
    } catch (err) {
      box.removeAttribute('aria-busy');
      box.innerHTML = `<p class="form-error">${esc(friendlyError(err))}</p>`;
      return;
    }
    box.removeAttribute('aria-busy');
    draw();
  }

  const isOut = (r) => !r.item.release_date || r.item.release_date <= weekEnd;
  // Ticked to start: titles out this week with copies open or on order. Titles with no release date, from earlier
  // weeks, or only reordered (the replacement comes later) are listed but have to be ticked by hand.
  const startTicked = (r) => r.onOrder && r.item.release_date >= weekStart && r.item.release_date <= weekEnd;
  const visible = () => {
    const q = $('#rd-q', body).value.trim().toLowerCase();
    const future = $('#rd-future', body).checked;
    return rows.filter((r) => (future || isOut(r)) && (!q || `${itemName(r.item)} ${r.item.publisher ?? ''}`.toLowerCase().includes(q)));
  };

  function draw() {
    const list = visible();
    if (!seeded) {
      rows.filter(startTicked).forEach((r) => picked.add(r.item.id));
      seeded = true;
    }
    if (!list.length) {
      box.innerHTML = `<p class="empty">${rows.length ? 'No titles match.' : 'Nothing is releasing this week and nothing is waiting.'}</p>`;
      return;
    }
    const chosen = list.filter((r) => picked.has(r.item.id));
    const copies = chosen.reduce((n, r) => n + r.copies, 0);
    box.innerHTML = `<section class="fold fold--static fold--compact">
        <div class="fold__head">
          <h2>Arriving This Week<span class="fold__note">${list.length} ${list.length === 1 ? 'title' : 'titles'} · ${chosen.length} ticked</span></h2>
          <button type="button" class="btn btn--small btn--green" data-go${chosen.length ? '' : ' disabled'}>Mark ${chosen.length} ${chosen.length === 1 ? 'title' : 'titles'} (${copies} ${copies === 1 ? 'copy' : 'copies'}) ready</button>
        </div>
        <div class="fold__body">
        <p><button type="button" class="btn btn--ghost btn--small" data-pick="all">Tick all shown</button> <button type="button" class="btn btn--ghost btn--small" data-pick="none">Clear ticks</button></p>
      <table class="admin-table cards"><thead><tr><th scope="col"><span class="visually-hidden">Ready</span></th><th scope="col">Title</th><th scope="col">Publisher</th><th scope="col">Out</th><th scope="col" class="col-qty">Copies</th><th scope="col" class="col-qty">Customers</th></tr></thead>
      <tbody>${list.map((r) => `<tr>
        <td class="card-lead"><input type="checkbox" data-item="${r.item.id}" aria-label="Ready: ${esc(itemName(r.item))}"${picked.has(r.item.id) ? ' checked' : ''}${r.lineIds.length ? '' : ' disabled title="Nobody has reserved this title"'}>
        </td>
        <td class="card-title">${esc(itemName(r.item))}</td>
        <td>${esc(r.item.publisher ?? '')}</td>
        <td class="nowrap card-label">${r.item.release_date ? fmtDate(r.item.release_date, { month: 'short', day: 'numeric' }) : ''}</td>
        <td class="center card-key card-label">${r.copies ? `<strong>${r.copies}</strong>` : '—'}</td>
        <td class="center card-key card-label">${r.orders.size || '—'}</td>
        </tr>`).join('')}</tbody>
        </table>
        </div>
      </section>`;
  }

  $('form', body).addEventListener('input', draw);
  $('form', body).addEventListener('submit', (e) => e.preventDefault());
  box.addEventListener('change', (e) => {
    const cb = e.target.closest('[data-item]');
    if (!cb) return;
    cb.checked ? picked.add(Number(cb.dataset.item)) : picked.delete(Number(cb.dataset.item));
    draw();
  });
  box.addEventListener('click', async (e) => {
    if (e.target.closest('summary') && !e.target.closest('button')) e.preventDefault();
    const card = !e.target.closest('input, button, a, label, select') && e.target.closest('tbody tr');
    if (card && isPhone()) {
      const cb = $('input[data-item]:not([disabled])', card);
      if (cb) {
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return;
    }
    const pick = e.target.closest('[data-pick]');
    if (pick) {
      visible().filter((r) => r.lineIds.length).forEach((r) => (pick.dataset.pick === 'all' ? picked.add(r.item.id) : picked.delete(r.item.id)));
      return draw();
    }
    const go = e.target.closest('[data-go]');
    if (!go) return;
    const chosen = visible().filter((r) => picked.has(r.item.id));
    if (!chosen.length) return;
    const ids = chosen.flatMap((r) => r.lineIds);
    const copies = chosen.reduce((n, r) => n + r.copies, 0);
    if (!confirm(`Mark ${chosen.length} ${chosen.length === 1 ? 'title' : 'titles'} (${copies} ${copies === 1 ? 'copy' : 'copies'}) as ready for pickup today?\n\nCustomers who have arrival emails turned on will be notified.`)) return;
    go.disabled = true;
    try {
      // Only lines still open, ordered or reordered change, so a line staff changed meanwhile is left alone.
      const done = await updateLines(ids, 'arrived', ['open', 'ordered', 'reordered']);
      toast(`${done} ${done === 1 ? 'reservation' : 'reservations'} marked ready`);
      picked.clear();
      seeded = true;
    } catch (err) {
      toast(`Not saved: ${friendlyError(err)}`, 'error');
    }
    load();
  });
  load();
}

// ---------------------------------------------------------------------------
// To order: copies reserved per title, grouped by order cutoff
// ---------------------------------------------------------------------------

/**
 * Open reservations totalled per title, straight from the database:
 * { lines, groups (cutoff → item id → { item, copies, orders, lineIds }), focs, meta (item id → codes/distributor) },
 * or null when nothing is waiting to be ordered.
 */
async function loadToOrderData() {
  const lines = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await atLocation(sb.from('reservations').select(`id,quantity,order_id,item:items(${ITEM_FIELDS})`).eq('status', 'open')).order('id').range(from, from + 999);
    if (error) throw fromError(error);
    lines.push(...data);
    if (data.length < 1000) break;
  }
  if (!lines.length) return null;
  const groups = new Map();
  for (const l of lines) {
    const foc = l.item?.foc_date ?? 'No cutoff';
    if (!groups.has(foc)) groups.set(foc, new Map());
    const g = groups.get(foc);
    const row = g.get(l.item.id) ?? { item: l.item, copies: 0, orders: new Set(), lineIds: [] };
    row.copies += l.quantity;
    row.orders.add(l.order_id);
    row.lineIds.push(l.id);
    g.set(l.item.id, row);
  }
  // Product codes and distributors, a few hundred titles per request (a long id list overruns the URL, and a
  // response stops at 1000 rows).
  const ids = [...new Set(lines.map((l) => l.item.id))];
  const meta = new Map();
  for (let i = 0; i < ids.length; i += 300)
    for (const m of await must(sb.from('items').select('id,upc,isbn,sku,distributor').in('id', ids.slice(i, i + 300)))) meta.set(m.id, m);
  return { lines, groups, focs: [...groups.keys()].sort(), meta };
}

// Cutoffs left open on the To order tab (null until the tab has been shown).
let toOrderOpen = null;

async function renderToOrder(body) {
  const keep = { foc: $('#ot-foc', body)?.value ?? '', dist: $('#ot-dist', body)?.value ?? 'all' };
  toOrderBody = body;
  // Titles whose customer list is open, so a refresh can open them again.
  const openPeople = $$('[data-customers][aria-expanded="true"]', body).map((b) => b.dataset.customers);
  // The instructions are folded away on phones, where they would push the cutoffs off the first screen.
  body.innerHTML = `${hintFold(`Open reservations (not yet ordered from the distributor), totalled per title for each order cutoff. Export the order below (pick a cutoff to export just that one), then mark the cutoff as ordered once you've placed it. The list groups titles by distributor with the product code, and counts customer reservations (including pull lists) only.`)}<div data-order-tools>
    </div>
    <div data-groups aria-busy="true">
    </div>`;
  const box = $('[data-groups]', body);
  let loaded;
  try {
    loaded = await loadToOrderData();
  } catch (err) {
    box.innerHTML = `<p class="form-error">${esc(friendlyError(err))}</p>`;
    return;
  }
  box.removeAttribute('aria-busy');
  if (!loaded) {
    box.innerHTML = '<p class="empty">Nothing waiting to be ordered.</p>';
    return;
  }
  const { lines, groups } = loaded;
  const focs = [...groups.keys()].sort();
  // Cutoffs are collapsed except the first. A refresh keeps the ones you had open; if none of them is still
  // listed (a new week's cutoffs), the first opens again.
  const keepOpen = toOrderOpen && focs.some((f) => toOrderOpen.has(f)) ? toOrderOpen : new Set(focs.slice(0, 1));
  box.addEventListener('toggle', () => (toOrderOpen = new Set($$('.fold--compact[open]', box).map((d) => d.dataset.foc))), true);
  box.innerHTML = focs
    .map((foc) => {
      const rows = [...groups.get(foc).values()].sort((a, b) => itemName(a.item).localeCompare(itemName(b.item)));
      const copies = rows.reduce((n, r) => n + r.copies, 0);
      return `<details class="fold fold--compact" data-foc="${esc(foc)}"${keepOpen.has(foc) ? ' open' : ''}>
        <summary class="fold__head">
          <h2>${foc === 'No cutoff' ? 'No Order Cutoff' : `Cutoff ${fmtDate(foc, { weekday: 'short', month: 'short', day: 'numeric' })}`}<span class="fold__note">${rows.length} ${rows.length === 1 ? 'title' : 'titles'} · ${copies} ${copies === 1 ? 'copy' : 'copies'}</span></h2>
        </summary>
        <div class="fold__body">
        <div class="admin-actions toorder__actions"><button class="btn btn--green" type="button" data-ordered title="After you place this cutoff's order with the distributor">Mark ${copies} ${copies === 1 ? 'copy' : 'copies'} ordered</button></div>
        <table class="admin-table cards cards--slim">
          <thead><tr><th scope="col" data-sort="text">Title</th><th scope="col" data-sort="text">Distributor</th><th scope="col" data-sort="text">Publisher</th><th scope="col">UPC / SKU</th><th scope="col" data-sort="num" data-first="desc">Copies</th><th scope="col" data-sort="num" data-first="desc">Customers</th><th scope="col"><span class="visually-hidden">Not ordering</span></th></tr></thead>
          <tbody>${rows.map((r) => `<tr>
            <td class="card-title">${esc(itemName(r.item))}</td>
            <td>${esc(distributorName(loaded.meta.get(r.item.id)?.distributor ?? null))}</td>
            <td>${esc(r.item.publisher ?? '')}</td>
            <td class="nowrap">
            </td>
            <td class="center card-key card-label"><strong>${r.copies}</strong>
            </td>
            <td class="center card-key card-label"><button type="button" class="link-button" data-customers="${r.item.id}" title="See who reserved this title">${r.orders.size}</button>
            </td>
            <td class="center card-action"><button type="button" class="icon-btn icon-btn--remove" data-notordering="${r.item.id}" aria-label="Not ordering ${esc(itemName(r.item))}" title="We are not ordering this title">${solidIcon('skip')}</button>
            </td>
            </tr>`).join('')}</tbody>
        </table>
        </div>
      </details>`;
    })
    .join('');

  // Fill UPC/SKU (not in the embedded select above to keep it light).
  const { meta } = loaded;
  const codes = new Map([...meta].map(([id, i]) => [id, i.upc || i.isbn || i.sku || '']));
  toOrderLoadedAt = Date.now();
  setupOrderTools($('[data-order-tools]', body), groups, focs, meta, keep);
  hookToOrderRefresh();
  focs.forEach((foc) => {
    const rows = [...groups.get(foc).values()].sort((a, b) => itemName(a.item).localeCompare(itemName(b.item)));
    $$(`[data-foc="${CSS.escape(foc)}"] tbody tr`, box).forEach((tr, i) => (tr.children[3].textContent = codes.get(rows[i].item.id) ?? ''));
  });
  $$('.fold--compact table', box).forEach((t) => sortableTable(t));
  openPeople.forEach((id) => { const b = $(`[data-customers="${id}"]`, box); if (b) toggleCustomers(b); });
  // Sorting reorders rows, which would strand an open customer row: close them first.
  box.addEventListener('click', (e) => { if (e.target.closest('th[data-sort]')) $$('tr.toorder__people', box).forEach((r) => { r.previousElementSibling?.querySelector('[data-customers]')?.setAttribute('aria-expanded', 'false'); r.remove(); }); }, true);

  box.addEventListener('click', async (e) => {
    const cust = e.target.closest('[data-customers]');
    if (cust) return void toggleCustomers(cust);
    const skip = e.target.closest('[data-notordering]');
    if (skip) return void markNotOrdered(body, Number(skip.dataset.notordering), skip);
    const section = e.target.closest('[data-foc]');
    const orderedBtn = e.target.closest('[data-ordered]');
    if (!section || !orderedBtn) return;
    const foc = section.dataset.foc;
    const btn = orderedBtn;

    // Read the database again so "mark ordered" covers the latest reservations, not what this page loaded earlier.
    btn.disabled = true;
    let fresh;
    try {
      fresh = await loadToOrderData();
    } catch (err) {
      btn.disabled = false;
      return void toast(`Couldn’t load the latest quantities: ${friendlyError(err)}`, 'error');
    }
    btn.disabled = false;
    const freshRows = fresh?.groups.get(foc);
    if (!freshRows) {
      renderToOrder(body);
      return void toast('Nothing is waiting to be ordered for that cutoff any more.', 'error');
    }
    const rows = [...freshRows.values()];
    const changed = quantitiesKey(new Map([[foc, freshRows]])) !== quantitiesKey(new Map([[foc, groups.get(foc)]]));
    if (orderedBtn) {
      const lineIds = rows.flatMap((r) => r.lineIds);
      const copies = rows.reduce((n, r) => n + r.copies, 0);
      const note = changed ? 'Reservations changed since this page loaded.\n\n' : '';
      if (!confirm(`${note}Mark ${lineIds.length} reserved ${lineIds.length === 1 ? 'title' : 'titles'} (${copies} ${copies === 1 ? 'copy' : 'copies'}) for this cutoff as ordered from the distributor?`)) {
        if (changed) renderToOrder(body);
        return;
      }
      await setLineStatus(lineIds, 'ordered', ['open']);
      renderToOrder(body);
    }
  });
}

/**
 * "We're not ordering this title": every open reservation for it becomes Not ordered. It leaves the To order
 * list, and customers see it as "Not ordered by the shop" (staff can change a line back from the customer's pull list).
 */
async function markNotOrdered(body, itemId, btn) {
  btn.disabled = true;
  try {
    const lines = await must(atLocation(sb.from('reservations').select('id,quantity,item:items(title,issue_number,variant)').eq('status', 'open').eq('item_id', itemId)));
    if (!lines.length) {
      toast('Nothing is waiting to be ordered for that title any more.', 'error');
      return void renderToOrder(body);
    }
    const name = itemName(lines[0].item);
    const copies = lines.reduce((n, l) => n + l.quantity, 0);
    if (!confirm(`Mark ${name} as not ordered?\n\n${lines.length} ${lines.length === 1 ? 'reservation' : 'reservations'} (${copies} ${copies === 1 ? 'copy' : 'copies'}) will show "Not ordered" in the customers' pull lists and leave this list.`)) return;
    const done = await updateLines(lines.map((l) => l.id), 'not_ordered', ['open']);
    toast(`${name}: marked not ordered (${done} ${done === 1 ? 'reservation' : 'reservations'})`);
    renderToOrder(body);
  } catch (err) {
    toast(`Not saved: ${friendlyError(err)}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

/**
 * Expand or collapse a hidden row under a title listing who reserved it, laid out in columns. Place Order lists open
 * lines; a button with data-past lists the lines already ordered (PAST_STATUSES), each with where it stands now.
 */
async function toggleCustomers(btn) {
  const past = 'past' in btn.dataset;
  const tr = btn.closest('tr');
  const next = tr.nextElementSibling;
  if (next?.classList.contains('toorder__people')) {
    next.remove();
    return void btn.setAttribute('aria-expanded', 'false');
  }
  btn.setAttribute('aria-expanded', 'true');
  const row = document.createElement('tr');
  row.className = 'toorder__people';
  row.innerHTML = `<td colspan="${tr.children.length}" aria-busy="true">Loading…</td>`;
  tr.after(row);
  const cell = row.firstElementChild;
  try {
    const lines = await must(atLocation(sb.from('reservations').select('quantity,status,order:reservation_orders(id,name,customer:customers(name,first_name,last_name))').in('status', past ? PAST_STATUSES : ['open']).eq('item_id', Number(btn.dataset.customers))));
    // Sorted by last name and shown as "Last, First". Guest orders only have one name field: the last word is the surname.
    const people = lines.map((l) => {
      const c = l.order?.customer;
      if (c?.last_name) return { last: c.last_name, first: c.first_name ?? '', qty: l.quantity, status: l.status };
      const words = (c?.name || l.order?.name || 'Unknown').trim().split(/\s+/);
      const last = words.pop();
      return { last, first: words.join(' '), qty: l.quantity, status: l.status };
    }).map((p) => ({ ...p, name: [p.last, p.first].filter(Boolean).join(', ') }))
      .sort((a, b) => a.last.localeCompare(b.last, undefined, { sensitivity: 'base' }) || a.first.localeCompare(b.first, undefined, { sensitivity: 'base' }));
    cell.removeAttribute('aria-busy');
    cell.innerHTML = people.length
      ? `<ul class="toorder__list">${people.map((p) => `<li>${esc(p.name)}${p.qty > 1 ? ` <strong>×${p.qty}</strong>` : ''}${past ? ` <span class="card__meta">· ${esc(LINE_STATUS[p.status] ?? p.status)}</span>` : ''}</li>`).join('')}</ul>`
      : `<span class="empty">${past ? 'No ordered reservations for this title any more.' : 'No open reservations for this title any more.'}</span>`;
  } catch (err) {
    cell.removeAttribute('aria-busy');
    cell.innerHTML = `<span class="form-error">${esc(friendlyError(err))}</span>`;
  }
}

// ---------------------------------------------------------------------------
// Past orders: what was already ordered, grouped by order cutoff (read-only)
// ---------------------------------------------------------------------------

const PAST_STATUSES = ['ordered', 'reordered', 'arrived', 'picked_up'];

async function renderPastOrders(body) {
  // The instructions are folded away on phones, where they would push the cutoffs down the screen.
  body.innerHTML = `${hintFold(`Cutoffs that have already been ordered, newest first, with the copies reserved per title and where each line stands now. Read-only: use Place Order for anything still open.`)}<div data-groups aria-busy="true"></div>`;
  const box = $('[data-groups]', body);
  try {
    const lines = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await atLocation(sb.from('reservations').select(`id,quantity,order_id,status,item:items(${ITEM_FIELDS})`).in('status', PAST_STATUSES)).order('id').range(from, from + 999);
      if (error) throw fromError(error);
      lines.push(...data);
      if (data.length < 1000) break;
    }
    box.removeAttribute('aria-busy');
    if (!lines.length) return void (box.innerHTML = '<p class="empty">Nothing has been ordered yet.</p>');
    const groups = new Map();
    for (const l of lines) {
      if (!l.item) continue;
      const foc = l.item.foc_date ?? 'No cutoff';
      if (!groups.has(foc)) groups.set(foc, new Map());
      const g = groups.get(foc);
      const row = g.get(l.item.id) ?? { item: l.item, copies: 0, orders: new Set(), status: new Map() };
      row.copies += l.quantity;
      row.orders.add(l.order_id);
      row.status.set(l.status, (row.status.get(l.status) ?? 0) + l.quantity);
      g.set(l.item.id, row);
    }
    // Newest cutoff first; titles with no cutoff date last.
    const focs = [...groups.keys()].sort((a, b) => (a === 'No cutoff') - (b === 'No cutoff') || b.localeCompare(a));
    box.innerHTML = focs
      .map((foc) => {
        const rows = [...groups.get(foc).values()].sort((a, b) => itemName(a.item).localeCompare(itemName(b.item)));
        const copies = rows.reduce((n, r) => n + r.copies, 0);
        return `<details class="fold fold--compact">
          <summary class="fold__head"><h2>${foc === 'No cutoff' ? 'No Order Cutoff' : `Cutoff ${fmtDate(foc, { weekday: 'short', month: 'short', day: 'numeric' })}`}<span class="fold__note">${rows.length} ${rows.length === 1 ? 'title' : 'titles'} · ${copies} ${copies === 1 ? 'copy' : 'copies'}</span></h2></summary>
          <div class="fold__body"><table class="admin-table past-table cards">
            <thead><tr><th scope="col" data-sort="text">Title</th><th scope="col" data-sort="text">Publisher</th><th scope="col" data-sort="num" data-first="desc">Copies</th><th scope="col" data-sort="num" data-first="desc">Customers</th><th scope="col">Status</th></tr></thead>
            <tbody>${rows.map((r) => `<tr>
              <td class="card-title">${esc(itemName(r.item))}</td>
              <td>${esc(r.item.publisher ?? '')}</td>
              <td class="center card-key card-label"><strong>${r.copies}</strong>
              </td>
              <td class="center card-key card-label"><button type="button" class="link-button" data-customers="${r.item.id}" data-past title="See who ordered this title">${r.orders.size}</button></td>
              <td class="card-wide">${[...r.status].map(([st, n]) => `${n} ${esc((LINE_STATUS[st] ?? st).toLowerCase())}`).join(', ')}</td>
              </tr>`).join('')}</tbody>
          </table></div>
        </details>`;
      })
      .join('');
    $$('.fold--compact table', box).forEach((t) => sortableTable(t));
    // Sorting reorders rows, which would strand an open customer row: close them first.
    box.addEventListener('click', (e) => { if (e.target.closest('th[data-sort]')) $$('tr.toorder__people', box).forEach((r) => { r.previousElementSibling?.querySelector('[data-customers]')?.setAttribute('aria-expanded', 'false'); r.remove(); }); }, true);
    box.addEventListener('click', (e) => {
      const cust = e.target.closest('[data-customers]');
      if (cust) toggleCustomers(cust);
    });
  } catch (err) {
    box.innerHTML = `<p class="form-error">${esc(friendlyError(err))}</p>`;
  }
}

// ---------------------------------------------------------------------------
// Distributor order list: titles and copy counts to order, per distributor
// ---------------------------------------------------------------------------

const DISTRIBUTORS = { lunar: 'Lunar', prh: 'PRH', other: 'Other' };
const distributorName = (d) => DISTRIBUTORS[d] ?? 'Unassigned';
const stamp = () => stampIn(settings.timezone);

function setupOrderTools(box, groups, focs, meta, keep = {}) {
  const present = [...new Set([...meta.values()].map((m) => m.distributor ?? ''))].sort((a, b) => distributorName(a || null).localeCompare(distributorName(b || null)));
  box.innerHTML = `
    <section class="panel order-tools" aria-labelledby="ot-h">
      <h2 id="ot-h">Distributor Order List</h2>
      
      <div class="order-tools__row">
        <div class="field"><label for="ot-foc">Order cutoff</label><select id="ot-foc">
          <option value="">All open cutoffs</option>
          ${focs.map((f) => `<option value="${esc(f)}">${f === 'No cutoff' ? 'No cutoff' : esc(fmtDate(f, { weekday: 'short', month: 'short', day: 'numeric' }))}</option>`).join('')}
        </select></div>
        <div class="field"><label for="ot-dist">Distributor</label><select id="ot-dist">
          <option value="all">All distributors</option>
          ${present.map((d) => `<option value="${esc(d || 'none')}">${esc(distributorName(d || null))}</option>`).join('')}
        </select></div>
        <div class="field order-tools__btns">
          <span><button class="btn btn--primary" type="button" data-ot="csv">Export CSV</button>
          <button class="btn btn--ghost" type="button" data-ot="pdf">Export PDF</button></span></div>
      </div>
      <p class="card__meta" data-ot-summary></p>
      <p class="card__meta">Quantities as of ${esc(fmtTime())}. <button class="admin-link-button" type="button" data-ot-refresh>Refresh</button>. Exports always use the latest quantities, whatever this page shows.</p>
    </section>`;
  // Keep the same filters after a refresh.
  if (keep.foc && [...$('#ot-foc', box).options].some((o) => o.value === keep.foc)) $('#ot-foc', box).value = keep.foc;
  if (keep.dist && [...$('#ot-dist', box).options].some((o) => o.value === keep.dist)) $('#ot-dist', box).value = keep.dist;

  const select = (data, foc, dist) => {
    const byDist = new Map(); // distributor key -> rows
    for (const [f, items] of data.groups) {
      if (foc && f !== foc) continue;
      for (const r of items.values()) {
        const m = data.meta.get(r.item.id) ?? {};
        const key = m.distributor ?? '';
        if (dist !== 'all' && (key || 'none') !== dist) continue;
        byDist.set(key, [...(byDist.get(key) ?? []), { r, m }]);
      }
    }
    // Lunar, PRH, Other, then anything unassigned; titles A-Z within each.
    const order = ['lunar', 'prh', 'other', ''];
    return [...byDist]
      .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
      .map(([key, list]) => ({
        key,
        name: distributorName(key || null),
        rows: list
          .map(({ r, m }) => ({
            code: m.sku || m.isbn || m.upc || '',
            upc: m.upc || m.isbn || '',
            title: [r.item.title, r.item.issue_number && `#${r.item.issue_number}`].filter(Boolean).join(' '),
            issue: r.item.issue_number,
            baseTitle: r.item.title,
            variant: r.item.variant ?? '',
            publisher: r.item.publisher ?? '',
            price: r.item.price,
            release: r.item.release_date,
            foc: r.item.foc_date,
            copies: r.copies,
            customers: r.orders.size,
          }))
          .sort((a, b) => a.title.localeCompare(b.title) || a.variant.localeCompare(b.variant)),
      }));
  };

  const shown = { groups, meta }; // what the page is showing; exports re-read the database
  const summarise = () => {
    const sel = select(shown, $('#ot-foc', box).value, $('#ot-dist', box).value);
    const titles = sel.reduce((n, g) => n + g.rows.length, 0);
    const copies = sel.reduce((n, g) => n + g.rows.reduce((m, r) => m + r.copies, 0), 0);
    $('[data-ot-summary]', box).textContent = titles ? `${titles} ${titles === 1 ? 'title' : 'titles'}, ${copies} ${copies === 1 ? 'copy' : 'copies'}${sel.length > 1 ? `: ${sel.map((g) => `${g.name} ${g.rows.reduce((m, r) => m + r.copies, 0)}`).join(' · ')}` : ''}` : 'Nothing to order for that selection.';
    return sel;
  };
  box.addEventListener('change', summarise);
  summarise();

  box.addEventListener('click', async (e) => {
    if (e.target.closest('[data-ot-refresh]')) {
      toast('Refreshing quantities…');
      return void (await renderToOrder(box.closest('[data-body]')));
    }
    const btn = e.target.closest('[data-ot]');
    if (!btn) return;
    const foc = $('#ot-foc', box).value;
    const dist = $('#ot-dist', box).value;
    const body = box.closest('[data-body]');

    // Always export what is in the database right now, not what the page loaded earlier.
    btn.disabled = true;
    let fresh;
    try {
      fresh = await loadToOrderData();
    } catch (err) {
      btn.disabled = false;
      return void toast(`Couldn’t load the latest quantities: ${friendlyError(err)}`, 'error');
    }
    btn.disabled = false;
    const sel = fresh ? select(fresh, foc, dist) : [];
    if (!sel.length) {
      renderToOrder(body);
      return void toast('Nothing to order for that selection right now.', 'error');
    }
    // If anything moved since the page loaded, say so and bring the page up to date too.
    const changed = fresh && quantitiesKey(fresh.groups) !== quantitiesKey(shown.groups);
    if (changed) {
      toast('Reservations changed since this page loaded. Exporting the latest quantities.');
      setTimeout(() => renderToOrder(body), 0);
    }
    const slug = `${dist === 'all' ? 'all' : dist}-${foc ? foc.toLowerCase().replace(/\s+/g, '-') : 'all-cutoffs'}${locationSlug()}-${stamp()}`;
    if (btn.dataset.ot === 'csv') {
      const rows = sel.flatMap((g) => g.rows.map((r) => [g.name, r.code, r.upc, r.baseTitle, r.issue, r.variant, r.publisher, r.price, r.release, r.foc, r.copies, r.customers]));
      downloadCsv(`distributor-order-${slug}.csv`, ['Distributor', 'Product code', 'UPC/ISBN', 'Title', 'Issue', 'Variant', 'Publisher', 'Price', 'Release', 'FOC', 'Copies to order', 'Customers'], rows);
      toast(`Exported ${rows.length} ${rows.length === 1 ? 'title' : 'titles'}`);
      return;
    }
    btn.disabled = true;
    try {
      const { buildOrderSheetPdf } = await import('../order-sheet-pdf.js');
      const shop = await must(sb.from('settings').select('shop_name,colors').eq('id', 1).single());
      const subtitle = [foc ? (foc === 'No cutoff' ? 'No cutoff' : `Cutoff ${fmtDate(foc, { weekday: 'short', month: 'short', day: 'numeric' })}`) : 'All open cutoffs', dist === 'all' ? null : distributorName(dist === 'none' ? null : dist), state.location ? locationNames.get(Number(state.location)) : null].filter(Boolean).join(' · ');
      const pdf = await buildOrderSheetPdf({ shop, subtitle, today: today(), groups: sel });
      pdf.save(`distributor-order-${slug}.pdf`);
      toast(`PDF saved: ${pdf.titles} ${pdf.titles === 1 ? 'title' : 'titles'}, ${pdf.copies} ${pdf.copies === 1 ? 'copy' : 'copies'}`);
    } catch (err) {
      toast(`PDF failed: ${friendlyError(err)}`, 'error');
    }
    btn.disabled = false;
  });
}

/** A fingerprint of every title's copy count, to tell whether the data changed. */
const quantitiesKey = (groups) =>
  [...groups.values()].flatMap((items) => [...items.values()].map((r) => `${r.item.id}:${r.copies}`)).sort().join('|');

/** Reload the To order numbers when the staff member returns to this tab after a while. */
function hookToOrderRefresh() {
  if (toOrderHooked) return;
  toOrderHooked = true;
  const maybeRefresh = () => {
    if (document.visibilityState !== 'visible' || !toOrderBody?.isConnected || state.view !== 'toorder') return;
    if (Date.now() - toOrderLoadedAt <= STALE_MS) return;
    // The re-render empties the list while it loads, which would drop the page to the top: put it back after.
    const { scrollX, scrollY } = window;
    const wrap = toOrderBody.style.minHeight;
    toOrderBody.style.minHeight = `${toOrderBody.offsetHeight}px`;
    renderToOrder(toOrderBody).finally(() => {
      toOrderBody.style.minHeight = wrap;
      window.scrollTo(scrollX, scrollY);
    });
  };
  document.addEventListener('visibilitychange', maybeRefresh);
  window.addEventListener('focus', maybeRefresh);
}
