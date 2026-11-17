// Reservations: customer orders (each with one or more titles), per-title
// status, lookup by name/phone/email, CSV export — plus a "To order" view that
// totals reserved copies per title for each order cutoff.

import { $, $$, esc, must, toast, isPhone, hintFold, fmtDate, fmtDateTime, itemName, downloadCsv, sortableTable, customerFilter, withCustomers, formatPhone, solidIcon, friendlyError, fromError, anyOf, emailMatch, digitsMatch, loadSentMessages, listLocations, locationFilterField, fmtTime, fetchAll, debounce, titleFilter, STATUS_LABELS, toListTop, hintSlot, setHint, openDialog } from '../lib.js';
import { LINE_STATUS } from '../../js/labels.js';
import { addDays, todayIn, dayIn, stampIn, holdUntil as holdDate } from '../../js/dates.js';
import { renderStoreOrder } from './store-order.js';
import { generalGroups, lunarFile, prhExport, prhText, prhXlsxFiles, rowName, orderState, changeText, PRH_BATCH } from '../order-export.js';

const PAGE = 25;
/** An order's kind as a pill: a customer's pull list, a re-order (ordered after the cutoff), or a guest order. */
const kindPill = (kind) => (kind === 'pull_list' ? '<span class="pill pill--pull">Pull list</span>' : kind === 'reorder' ? '<span class="pill pill--info">Re-order</span>' : '<span class="pill pill--off">Guest order</span>');
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
    ${hintSlot()}
    <div class="admin-tabs" role="tablist">
      <button type="button" class="admin-tab" role="tab" data-view="orders">Reservations</button>
      <button type="button" class="admin-tab" role="tab" data-view="storeorder">Store Order</button>
      <button type="button" class="admin-tab" role="tab" data-view="toorder">Place Order</button>
      <button type="button" class="admin-tab" role="tab" data-view="ready">Received</button>
      <button type="button" class="admin-tab" role="tab" data-view="reorder">Re-order</button>
    </div>
    <form class="filters admin-filters" data-location-bar hidden></form>
    <div data-body></div>`;
  // A shop with 2+ locations picks which one to work on; it applies to every tab (orders are placed and received per location).
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
    if (['orders', 'storeorder', 'toorder', 'past', 'ready', 'reorder'].includes(view)) state.view = view === 'past' ? 'toorder' : view;
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
  setHint(el, ''); // each view puts its own How this works in the slot above the tabs
  if (state.view === 'orders') renderOrders(body);
  else if (state.view === 'ready') renderReady(body);
  else if (state.view === 'reorder') renderReorders(body);
  else if (state.view === 'storeorder') renderStoreOrder(body, { sb, location: state.location ? Number(state.location) : null, needsLocation: !state.location && locationNames.size > 1, today: today() });
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
  const turnPage = (offset) => ((state.offset = offset), toListTop($('[data-count]', body)), loadOrders(body));
  $('[data-prev]', body).addEventListener('click', () => turnPage(Math.max(0, state.offset - PAGE)));
  $('[data-next]', body).addEventListener('click', () => turnPage(state.offset + PAGE));
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
          <p class="card__meta order__meta"><span class="order__id">Order #${o.id}</span> ${kindPill(o.kind)} <span>${lines.length} ${lines.length === 1 ? 'title' : 'titles'}</span> <span>${fmtDateTime(o.created_at)}</span></p>
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
        <td>${kindPill(o.kind)}</td>
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

/**
 * Open, ordered and reordered reservations, and the store's ordered copies, totalled per title. Titles releasing after
 * this week (Sunday to Saturday) are listed only when asked for.
 */
async function renderReady(body) {
  // The instructions are long: folded away on phones, where they would fill the first screen.
  setHint(body, `Every title releasing this week is listed, with the copies customers have reserved (open, ordered or reordered) and the store’s own copies on order. Titles with nothing coming can’t be ticked; tick Only titles with copies coming to hide them. Click a column heading to sort by it. Titles out this week start ticked; ones with no release date, from earlier weeks, or only reordered (the replacement comes later) you tick by hand. Tick the ones that are in the shop today and mark them Ready — customers see them as ready for pickup and the hold window starts today, and the store’s copies are marked received.`);
  body.innerHTML = `
    <form class="filters admin-filters" role="search" aria-label="Find titles">
      <div class="field field--search"><label for="rd-q">Title</label><input id="rd-q" type="search" placeholder="Filter by title or publisher"></div>
      <div class="field"><label class="cust-export-opt" for="rd-future"><input type="checkbox" id="rd-future"> Include titles releasing after this week</label></div>
    </form>
    <div data-ready aria-busy="true"></div>`;
  const box = $('[data-ready]', body);
  const picked = new Set();
  let rows = [];
  let seeded = false;
  // Column sort, kept across redraws (ticking a title redraws the table). Starts by title, A to Z.
  let sort = { key: 'title', dir: 'asc' };
  // "Only titles with copies coming" sits in the tick-buttons row, which is redrawn with the table, so its state lives here.
  let onlyReserved = false;
  const weekStart = addDays(today(), -new Date(`${today()}T00:00:00Z`).getUTCDay());
  const weekEnd = addDays(weekStart, 6);

  async function load() {
    box.setAttribute('aria-busy', 'true');
    try {
      const lines = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await atLocation(sb.from('reservations').select(`id,quantity,order_id,status,item:items(${ITEM_FIELDS})`).in('status', WAITING_STATUSES)).order('id').range(from, from + 999);
        if (error) throw fromError(error);
        lines.push(...data);
        if (data.length < 1000) break;
      }
      const byItem = new Map();
      for (const l of lines) {
        if (!l.item) continue;
        const r = byItem.get(l.item.id) ?? blank(l.item);
        r.copies += l.quantity;
        if (l.status !== 'reordered') r.onOrder = true;
        r.orders.add(l.order_id);
        r.lineIds.push(l.id);
        byItem.set(l.item.id, r);
      }
      // The store's copies on order (ordered, not yet received).
      for (let from = 0; ; from += 1000) {
        const { data, error } = await atLocation(sb.from('shop_order_lines').select(`id,quantity,item:items(${ITEM_FIELDS})`).eq('status', 'ordered')).order('id').range(from, from + 999);
        if (error) throw fromError(error);
        for (const s of data) {
          if (!s.item) continue;
          const r = byItem.get(s.item.id) ?? blank(s.item);
          r.store += s.quantity;
          r.shopIds.push(s.id);
          r.onOrder = true;
          byItem.set(s.item.id, r);
        }
        if (data.length < 1000) break;
      }
      // Every title releasing this week is listed, reserved or not.
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from('items').select(ITEM_FIELDS).gte('release_date', weekStart).lte('release_date', weekEnd).order('id').range(from, from + 999);
        if (error) throw fromError(error);
        for (const item of data) if (!byItem.has(item.id)) byItem.set(item.id, blank(item));
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

  /** A title's row: customer copies (lineIds: their lines) and the store's copies on order (shopIds: their rows). */
  const blank = (item) => ({ item, copies: 0, store: 0, orders: new Set(), lineIds: [], shopIds: [], onOrder: false });
  /** Something is coming for the title: customer lines or store copies (only these can be ticked). */
  const coming = (r) => r.lineIds.length || r.shopIds.length;
  const isOut = (r) => !r.item.release_date || r.item.release_date <= weekEnd;
  // Ticked to start: titles out this week with copies open or on order. Titles with no release date, from earlier
  // weeks, or only reordered (the replacement comes later) are listed but have to be ticked by hand.
  const startTicked = (r) => r.onOrder && r.item.release_date >= weekStart && r.item.release_date <= weekEnd;
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const SORT_VALUE = {
    title: (r) => itemName(r.item),
    publisher: (r) => r.item.publisher ?? '',
    out: (r) => r.item.release_date ?? '',
    customers: (r) => r.copies,
    store: (r) => r.store,
    copies: (r) => r.copies + r.store,
  };
  const byColumn = (a, b) => {
    const val = SORT_VALUE[sort.key];
    const x = val(a), y = val(b);
    if (!x !== !y) return !x ? 1 : -1; // blanks last either way
    const c = typeof x === 'number' ? x - y : collator.compare(x, y);
    return (sort.dir === 'asc' ? c : -c) || collator.compare(itemName(a.item), itemName(b.item));
  };
  const visible = () => {
    const q = $('#rd-q', body).value.trim().toLowerCase();
    const future = $('#rd-future', body).checked;
    return rows
      .filter((r) => (future || isOut(r)) && (!onlyReserved || coming(r)) && (!q || `${itemName(r.item)} ${r.item.publisher ?? ''}`.toLowerCase().includes(q)))
      .sort(byColumn);
  };

  function draw() {
    // Titles whose customer list is open, so the redraw (a tick, a sort, a filter) can open them again.
    const openPeople = $$('[data-customers][aria-expanded="true"]', box).map((b) => b.dataset.customers);
    const list = visible();
    if (!seeded) {
      rows.filter(startTicked).forEach((r) => picked.add(r.item.id));
      seeded = true;
    }
    const onlyBox = `<label class="cust-export-opt ready-picks__only" for="rd-reserved"><input type="checkbox" id="rd-reserved"${onlyReserved ? ' checked' : ''}> Only titles with copies coming</label>`;
    if (!list.length) {
      // Keep the tick-box when it is what emptied the list, so it can be unticked.
      box.innerHTML = `${onlyReserved ? `<div class="admin-actions ready-picks">${onlyBox}</div>` : ''}<p class="empty">${rows.length ? 'No titles match.' : 'Nothing is releasing this week and nothing is waiting.'}</p>`;
      return;
    }
    const chosen = list.filter((r) => picked.has(r.item.id));
    const copies = chosen.reduce((n, r) => n + r.copies + r.store, 0);
    box.innerHTML = `<section class="fold fold--static fold--compact">
        <div class="fold__head">
          <h2>Arriving This Week<span class="fold__note">${list.length} ${list.length === 1 ? 'title' : 'titles'} · ${chosen.length} ticked</span></h2>
          <button type="button" class="btn btn--small btn--green" data-go${chosen.length ? '' : ' disabled'}>Mark ${chosen.length} ${chosen.length === 1 ? 'title' : 'titles'} (${copies} ${copies === 1 ? 'copy' : 'copies'}) ready</button>
        </div>
        <div class="fold__body">
        <div class="admin-actions ready-picks"><button type="button" class="btn btn--ghost btn--small" data-pick="all">Tick all shown</button><button type="button" class="btn btn--ghost btn--small" data-pick="none">Clear ticks</button>${onlyBox}</div>
      <table class="admin-table cards"><thead><tr><th scope="col"><span class="visually-hidden">Ready</span></th><th scope="col" data-sort="title">Title</th><th scope="col" data-sort="publisher">Publisher</th><th scope="col" data-sort="out">Out</th><th scope="col" class="col-qty" data-sort="customers" data-first="desc">Customers</th><th scope="col" class="col-qty" data-sort="store" data-first="desc">Store</th><th scope="col" class="col-qty" data-sort="copies" data-first="desc">Copies</th></tr></thead>
      <tbody>${list.map((r) => `<tr>
        <td class="card-lead"><input type="checkbox" data-item="${r.item.id}" aria-label="Ready: ${esc(itemName(r.item))}"${picked.has(r.item.id) ? ' checked' : ''}${coming(r) ? '' : ' disabled title="Nothing is coming for this title: no reservations or store copies on order"'}>
        </td>
        <td class="card-title">${esc(itemName(r.item))}</td>
        <td>${esc(r.item.publisher ?? '')}</td>
        <td class="nowrap card-label">${r.item.release_date ? fmtDate(r.item.release_date, { month: 'short', day: 'numeric' }) : ''}</td>
        <td class="center card-key card-label">${r.copies ? `<button type="button" class="link-button" data-customers="${r.item.id}" data-waiting title="See who reserved this title">${r.copies}</button>` : '—'}</td>
        <td class="center card-key card-label">${r.store || '—'}</td>
        <td class="center card-key card-label">${r.copies + r.store ? `<strong>${r.copies + r.store}</strong>` : '—'}</td>
        </tr>`).join('')}</tbody>
        </table>
        </div>
      </section>`;
    sortableTable($('table', box), { sort: sort.key, dir: sort.dir, onSort: (key, dir) => ((sort = { key, dir }), draw()) });
    openPeople.forEach((id) => { const b = $(`[data-customers="${id}"]`, box); if (b) toggleCustomers(b); });
  }

  $('form', body).addEventListener('input', draw);
  $('form', body).addEventListener('submit', (e) => e.preventDefault());
  box.addEventListener('change', (e) => {
    if (e.target.id === 'rd-reserved') {
      onlyReserved = e.target.checked;
      return draw();
    }
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
    const cust = e.target.closest('[data-customers]');
    if (cust) return void toggleCustomers(cust);
    const pick = e.target.closest('[data-pick]');
    if (pick) {
      visible().filter(coming).forEach((r) => (pick.dataset.pick === 'all' ? picked.add(r.item.id) : picked.delete(r.item.id)));
      return draw();
    }
    const go = e.target.closest('[data-go]');
    if (!go) return;
    const chosen = visible().filter((r) => picked.has(r.item.id));
    if (!chosen.length) return;
    const ids = chosen.flatMap((r) => r.lineIds);
    const shopIds = chosen.flatMap((r) => r.shopIds);
    const copies = chosen.reduce((n, r) => n + r.copies, 0);
    const store = chosen.reduce((n, r) => n + r.store, 0);
    const what = [copies && `${copies} customer ${copies === 1 ? 'copy' : 'copies'} ready for pickup today`, store && `${store} store ${store === 1 ? 'copy' : 'copies'} received`].filter(Boolean).join(', and ');
    if (!confirm(`Mark ${chosen.length} ${chosen.length === 1 ? 'title' : 'titles'} as in: ${what}?${copies ? '\n\nCustomers who have arrival emails turned on will be notified.' : ''}`)) return;
    go.disabled = true;
    try {
      // Only lines still open, ordered or reordered change, so a line staff changed meanwhile is left alone; likewise
      // only store rows still ordered.
      const done = ids.length ? await updateLines(ids, 'arrived', WAITING_STATUSES) : 0;
      const got = shopIds.length ? await must(sb.rpc('staff_receive_shop_copies', { p_ids: shopIds })) : 0;
      toast([ids.length && `${done} ${done === 1 ? 'reservation' : 'reservations'} marked ready`, shopIds.length && `store copies of ${got} ${got === 1 ? 'title' : 'titles'} received`].filter(Boolean).join(' · '));
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
// Place Order: copies to order per title (customers + store), grouped by order cutoff
// ---------------------------------------------------------------------------

/** The location picked at the top of the screen, as the ordering functions take it (null: all, or the only one). */
const orderLocation = () => (state.location ? Number(state.location) : null);

/** One cutoff's titles with copies to order or sent before (staff_order_rows). foc: a date, or 'No cutoff'. */
const loadCutoffRows = (foc, dist = 'all') =>
  fetchAll(() => sb.rpc('staff_order_rows', { p_foc: foc === 'No cutoff' ? null : foc, p_distributor: dist, p_location: orderLocation(), p_ordering_only: true }));

/**
 * Place Order's numbers, straight from the database: cutoff ('No cutoff' for titles without one) → order rows.
 * Customer copies, store copies and totals come from the same function as Store Order and the distributor files,
 * so the screen and the exports can't disagree. Only cutoffs with copies or something sent are read.
 */
async function loadOrderData() {
  const cutoffs = await must(sb.rpc('staff_order_cutoffs', { p_distributor: 'all', p_location: orderLocation() }));
  const wanted = cutoffs.filter((c) => c.total > 0 || c.submitted_at);
  const lists = await Promise.all(wanted.map((c) => loadCutoffRows(c.foc_date ?? 'No cutoff')));
  const groups = new Map();
  wanted.forEach((c, i) => { if (lists[i].length) groups.set(c.foc_date ?? 'No cutoff', lists[i]); });
  return groups;
}

/**
 * Needs ordering: copies not marked ordered yet, or a total that no longer matches what was sent (see orderState in
 * order-export.js). These are the titles Mark ordered sends and the CSV and PDF list.
 */
const pending = (r) => ['to_order', 'changed'].includes(orderState(r));

/**
 * Open lines the database holds back from the ordering numbers (counts_for_order is false: a paused customer's titles
 * before their cutoff, or an account waiting for approval): { copies, customers }.
 */
async function loadHeld() {
  let copies = 0;
  const orders = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await atLocation(sb.from('reservations').select('quantity,order_id').eq('status', 'open').eq('reorder', false).eq('counts_for_order', false)).order('id').range(from, from + 999);
    if (error) throw fromError(error);
    for (const l of data) (copies += l.quantity), orders.add(l.order_id);
    if (data.length < 1000) break;
  }
  return { copies, customers: orders.size };
}

/** A row's distributor key: lunar, prh, other, or none. */
const distOf = (r) => r.distributor || 'none';

/** Only one distributor's titles ('all' keeps every title), dropping cutoffs left empty: cutoff → rows. */
const forDistributor = (groups, dist) =>
  dist === 'all' ? groups : new Map([...groups].map(([foc, rows]) => [foc, rows.filter((r) => distOf(r) === dist)]).filter(([, rows]) => rows.length));

/** A cutoff that hasn't passed yet (the shop's today counts as not passed). */
const upcoming = (foc) => foc !== 'No cutoff' && foc >= today();

/** A fingerprint of the titles still to order and their totals, to tell whether the numbers changed. */
const pendingKey = (rows) => rows.filter(pending).map((r) => `${r.item_id}:${r.total}`).sort().join('|');

/** The store's copies for a row, marked when they are last issue's number (not saved for this title yet). */
const storeCell = (r) =>
  !r.shop_saved && r.shop_copies > 0 ? `<span title="Last issue’s number">${r.shop_copies}<span class="visually-hidden"> (last issue’s number)</span></span>` : `${r.shop_copies || '–'}`;

/** What the distributor has for a title, as a button to change it (an order placed or changed on their own site). */
const sentCell = (r) =>
  `<td class="center card-key card-label" data-sort="${r.submitted ?? -1}"><button type="button" class="link-button" data-sent="${r.item_id}" title="What the distributor has. Change it for an order placed or changed on their site">${r.submitted ?? '–'}</button></td>`;

/** Copies now less copies sent: "+2", "−1", or empty when they match. */
const changeCell = (r) => `<td class="center card-key card-label" data-sort="${r.change ?? 0}">${r.change ? `<strong>${changeText(r.change)}</strong>` : ''}</td>`;

/** A title sent under one cutoff whose date has since moved: it shows under the new one with what was sent. */
const movedPill = (r) =>
  r.foc_moved ? ` <span class="pill pill--warn" title="Sent under the ${r.submitted_foc ? esc(fmtDate(r.submitted_foc, { month: 'short', day: 'numeric' })) : 'earlier'} cutoff">FOC date moved</span>` : '';

/** The customer copies, as a button listing who reserved them (statuses: 'all' or 'past'). */
const customersCell = (r, which) =>
  r.customer_copies ? `<button type="button" class="link-button" data-customers="${r.item_id}" data-${which} title="See who reserved this title">${r.customer_copies}</button>` : '–';

// Cutoffs left open on the To order tab (null until the tab has been shown).
let toOrderOpen = null;

async function renderToOrder(body) {
  const keep = { foc: $('#ot-foc', body)?.value ?? '', dist: $('#ot-dist', body)?.value ?? 'all' };
  toOrderBody = body;
  // Titles whose customer list is open, so a refresh can open them again.
  const openPeople = $$('[data-groups] [data-customers][aria-expanded="true"]', body).map((b) => b.dataset.customers);
  // The instructions are folded away on phones, where they would push the cutoffs off the first screen.
  setHint(body, `Copies to order per title for each order cutoff: Customers is what customers reserved (including pull lists), Store the store’s own copies from the Store Order tab (last issue’s number until someone changes it), and Copies the total that goes to the distributor. Once a cutoff is marked ordered, Sent shows what the distributor has for each title and Change how far Copies has moved since; changed titles come back to the top to send again (click Sent to correct it for an order placed on the distributor’s own site). Pick one cutoff and Lunar or PRH for the file to upload or paste on their site, or export the list as a CSV or PDF; then mark the cutoff ordered once you’ve placed it, which records what was sent for each title. A cutoff ordered before its date stays here marked Ordered until the date passes, then moves to Past orders at the bottom.`);
  body.innerHTML = `<div data-order-tools>
    </div>
    <div data-groups aria-busy="true">
    </div>
    <details class="fold past-orders" data-past${pastOpen ? ' open' : ''}>
      <summary class="fold__head"><h2>Past orders</h2></summary>
      <div class="fold__body" data-past-list></div>
    </details>`;
  const past = $('[data-past]', body);
  // Loaded the first time it is opened (and again after a refresh if it was left open).
  const loadPast = () => { if (past.open && !past.dataset.loaded) { past.dataset.loaded = '1'; renderPastOrders($('[data-past-list]', past)); } };
  past.addEventListener('toggle', (e) => { if (e.target !== past) return; pastOpen = past.open; loadPast(); });
  loadPast();
  const box = $('[data-groups]', body);
  let all, held;
  try {
    [all, held] = await Promise.all([loadOrderData(), loadHeld()]);
  } catch (err) {
    box.innerHTML = `<p class="form-error">${esc(friendlyError(err))}</p>`;
    return;
  }
  box.removeAttribute('aria-busy');
  const heldNote = held.copies
    ? `<p class="admin-hint">Not counted: ${held.copies} ${held.copies === 1 ? 'copy' : 'copies'} for ${held.customers} ${held.customers === 1 ? 'customer' : 'customers'} whose pull list is paused or whose account is waiting for approval. They count again if the customer is resumed or approved before the cutoff. See Customers → Unclaimed.</p>`
    : '';
  if (!all.size) {
    box.innerHTML = `${heldNote}<p class="empty">Nothing waiting to be ordered.</p>`;
    return;
  }
  toOrderLoadedAt = Date.now();
  setupOrderTools($('[data-order-tools]', body), all, keep);
  hookToOrderRefresh();
  const ordinal = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const sum = (rows) => rows.reduce((n, r) => n + r.total, 0);
  // The cutoffs drawn for the distributor picked in the tools: "mark ordered" then covers only that distributor.
  let groups = all;
  const draw = () => {
    const dist = $('#ot-dist', body)?.value ?? 'all';
    groups = forDistributor(all, dist);
    // Cutoffs with something still to order, and every cutoff shown (ordered early ones too).
    const shown = [...groups.keys()].filter((f) => groups.get(f).some((r) => orderState(r) !== 'none')).sort();
    const focs = shown.filter((f) => groups.get(f).some(pending));
    // Cutoffs are collapsed except the first. A refresh keeps the ones you had open; if none of them is still
    // listed (a new week's cutoffs), the first opens again.
    const keepOpen = toOrderOpen && shown.some((f) => toOrderOpen.has(f)) ? toOrderOpen : new Set((focs.length ? focs : shown).slice(0, 1));
    const from = dist === 'all' ? '' : ` from ${distributorName(dist === 'none' ? null : dist)}`;
    box.innerHTML = heldNote + (focs.length ? '' : `<p class="empty">Nothing waiting to be ordered${esc(from)}.</p>`) + shown
      .map((foc) => {
        const rows = groups.get(foc).filter(pending);
        const ordered = groups.get(foc).filter((r) => orderState(r) === 'ordered');
        const copies = sum(rows);
        const doneCopies = sum(ordered);
        // Sent before: Sent and Change columns, and Mark ordered counts titles (a change can be down to 0 copies).
        const sentAny = groups.get(foc).some((r) => r.submitted != null);
        const changed = rows.filter((r) => orderState(r) === 'changed').length;
        const note = rows.length
          ? `${ordinal(rows.length, 'title', 'titles')} · ${ordinal(copies, 'copy', 'copies')}${changed ? ` · ${changed} changed since sent` : ''}${ordered.length ? ` · ${doneCopies} already ordered` : ''}`
          : `${ordinal(ordered.length, 'title', 'titles')} · ${ordinal(doneCopies, 'copy', 'copies')} ordered`;
        return `<details class="fold fold--compact" data-foc="${esc(foc)}"${keepOpen.has(foc) ? ' open' : ''}>
        <summary class="fold__head">
          <h2>${foc === 'No cutoff' ? 'No Order Cutoff' : `Cutoff ${fmtDate(foc, { weekday: 'short', month: 'short', day: 'numeric' })}`}${rows.length ? '' : ' <span class="pill pill--ordered">Ordered</span>'}<span class="fold__note">${note}</span></h2>
        </summary>
        <div class="fold__body">
${rows.length ? `        <div class="admin-actions toorder__actions"><button class="btn btn--green" type="button" data-ordered title="${sentAny ? 'After you send the changes to the distributor: records each title’s new total as sent' : 'After you place this cutoff’s order with the distributor'}">${sentAny ? `Mark ${ordinal(rows.length, 'title', 'titles')} ordered` : `Mark ${copies} ${copies === 1 ? 'copy' : 'copies'} ordered`}</button></div>
        <table class="admin-table cards cards--slim" data-to-order>
          <thead><tr><th scope="col" data-sort="text">Title</th><th scope="col" data-sort="text">Distributor</th><th scope="col">UPC / SKU</th><th scope="col" data-sort="num" data-first="desc">Customers</th><th scope="col" data-sort="num" data-first="desc">Store</th><th scope="col" data-sort="num" data-first="desc">Copies</th>${sentAny ? '<th scope="col" data-sort="num" data-first="desc">Sent</th><th scope="col" data-sort="num" data-first="desc">Change</th>' : ''}<th scope="col"><span class="visually-hidden">Not ordering</span></th></tr></thead>
          <tbody>${rows.map((r) => `<tr>
            <td class="card-title">${esc(itemName(r))}${movedPill(r)}</td>
            <td>${esc(distributorName(r.distributor))}</td>
            <td class="nowrap">${esc(r.upc || r.isbn || r.sku || '')}</td>
            <td class="center card-key card-label">${customersCell(r, 'all')}
            </td>
            <td class="center card-key card-label">${storeCell(r)}</td>
            <td class="center card-key card-label"><strong>${r.total}</strong></td>
            ${sentAny ? sentCell(r) + changeCell(r) : ''}
            <td class="center card-action">${r.customer_open ? `<button type="button" class="icon-btn icon-btn--remove" data-notordering="${r.item_id}" aria-label="Not ordering ${esc(itemName(r))} for customers" title="We are not ordering this title for customers">${solidIcon('skip')}</button>` : ''}
            </td>
            </tr>`).join('')}</tbody>
        </table>
` : ''}        ${ordered.length ? `${rows.length ? '<h3 class="mt-16 mb-8">Already ordered</h3>' : ''}<table class="admin-table cards cards--slim">
          <thead><tr><th scope="col" data-sort="text">Title</th><th scope="col" data-sort="text">Distributor</th><th scope="col">UPC / SKU</th><th scope="col" data-sort="num" data-first="desc">Customers</th><th scope="col" data-sort="num" data-first="desc">Store</th><th scope="col" data-sort="num" data-first="desc">Copies</th>${sentAny ? '<th scope="col" data-sort="num" data-first="desc">Sent</th>' : ''}</tr></thead>
          <tbody>${ordered.map((r) => `<tr>
            <td class="card-title">${esc(itemName(r))}${movedPill(r)}</td>
            <td>${esc(distributorName(r.distributor))}</td>
            <td class="nowrap">${esc(r.upc || r.isbn || r.sku || '')}</td>
            <td class="center card-key card-label">${customersCell(r, 'past')}</td>
            <td class="center card-key card-label">${storeCell(r)}</td>
            <td class="center card-key card-label"><strong>${r.total}</strong></td>
            ${sentAny ? sentCell(r) : ''}
            </tr>`).join('')}</tbody>
        </table>` : ''}
        </div>
      </details>`;
      })
      .join('');
    $$('.fold--compact table', box).forEach((t) => sortableTable(t));
  };
  draw();
  openPeople.forEach((id) => { const b = $(`[data-customers="${id}"]`, box); if (b) toggleCustomers(b); });
  $('#ot-dist', body)?.addEventListener('change', draw);
  box.addEventListener('toggle', () => (toOrderOpen = new Set($$('.fold--compact[open]', box).map((d) => d.dataset.foc))), true);
  // Sorting reorders rows, which would strand an open customer row: close them first.
  box.addEventListener('click', (e) => { if (e.target.closest('th[data-sort]')) $$('tr.toorder__people', box).forEach((r) => { r.previousElementSibling?.querySelector('[data-customers]')?.setAttribute('aria-expanded', 'false'); r.remove(); }); }, true);

  box.addEventListener('click', async (e) => {
    const cust = e.target.closest('[data-customers]');
    if (cust) return void toggleCustomers(cust);
    const skip = e.target.closest('[data-notordering]');
    if (skip) return void markNotOrdered(body, Number(skip.dataset.notordering), skip);
    const sentBtn = e.target.closest('[data-sent]');
    if (sentBtn) return void editSent(body, [...all.values()].flat().find((r) => r.item_id === Number(sentBtn.dataset.sent)));
    const section = e.target.closest('[data-foc]');
    const btn = e.target.closest('[data-ordered]');
    if (!section || !btn) return;
    const foc = section.dataset.foc;
    if (!state.location && locationNames.size > 1) return void toast('Pick a location at the top first: each location orders on its own.', 'error');

    // Read the database again so "mark ordered" covers the latest numbers, not what this page loaded earlier.
    const dist = $('#ot-dist', body)?.value ?? 'all';
    btn.disabled = true;
    let fresh;
    try {
      fresh = await loadCutoffRows(foc, dist);
    } catch (err) {
      btn.disabled = false;
      return void toast(`Couldn’t load the latest quantities: ${friendlyError(err)}`, 'error');
    }
    btn.disabled = false;
    const rows = fresh.filter(pending);
    if (!rows.length) {
      renderToOrder(body);
      return void toast('Nothing is waiting to be ordered for that cutoff any more.', 'error');
    }
    const changed = pendingKey(fresh) !== pendingKey(groups.get(foc) ?? []);
    const copies = sum(rows);
    const note = changed ? 'Quantities changed since this page loaded.\n\n' : '';
    const down = rows.filter((r) => r.submitted != null && r.total < r.submitted).length;
    const lower = down ? `\n\n${ordinal(down, 'title went', 'titles went')} down since it was sent: lower ${down === 1 ? 'it' : 'them'} on the distributor’s site first (Lunar’s FOC edits file does it; in the PRH cart it’s by hand).` : '';
    if (!confirm(`${note}Mark ${rows.length} ${rows.length === 1 ? 'title' : 'titles'} (${copies} ${copies === 1 ? 'copy' : 'copies'}, customers and store) for this cutoff as ordered from ${dist === 'all' ? 'the distributor' : distributorName(dist === 'none' ? null : dist)}? Each title’s total is recorded as sent.${lower}`)) {
      if (changed) renderToOrder(body);
      return;
    }
    // One submission per distributor: what was sent is kept per title, against the distributor it went to.
    btn.disabled = true;
    const byDist = new Map();
    for (const r of rows) byDist.set(distOf(r), [...(byDist.get(distOf(r)) ?? []), r]);
    let titles = 0;
    let sent = 0;
    try {
      for (const [d, list] of byDist) {
        const res = await must(sb.rpc('staff_mark_ordered', { p_foc: foc === 'No cutoff' ? null : foc, p_distributor: d, p_location: orderLocation(), p_lines: list.map((r) => ({ item_id: r.item_id, quantity: r.total })) }));
        titles += res.titles;
        sent += res.copies;
      }
      toast(`Marked ${titles} ${titles === 1 ? 'title' : 'titles'} (${sent} ${sent === 1 ? 'copy' : 'copies'}) ordered`);
    } catch (err) {
      toast(`Not marked ordered: ${friendlyError(err)}`, 'error');
    }
    renderToOrder(body);
  });
}

/**
 * Correct what the distributor has for a title: an order placed or changed on their own site (not through Pullwise's
 * file). Recorded as a manual submission with an optional note; Sent and Change then follow it.
 */
function editSent(body, r) {
  if (!r) return;
  if (!state.location && locationNames.size > 1) return void toast('Pick a location at the top first: each location orders on its own.', 'error');
  const name = itemName(r);
  const d = openDialog(`Copies sent: ${name}`, `
    <p>How many copies does the distributor have for this title now? Use this for an order placed or changed on their own site. Change then counts from this number.</p>
    <p class="admin-hint">Copies now: ${r.total} (customers ${r.customer_copies}, store ${r.shop_copies}). Sent so far: ${r.submitted ?? 'nothing'}.</p>
    <div class="field"><label for="sent-qty">Copies the distributor has</label><input id="sent-qty" class="cust-qty" type="number" inputmode="numeric" min="0" max="9999" step="1" value="${r.submitted ?? r.total}"></div>
    <div class="field"><label for="sent-note">Note (optional, staff only)</label><input id="sent-note" type="text" maxlength="500" placeholder="e.g. Added 2 on Lunar’s site"></div>
    <p class="form-error" role="alert" data-sent-error></p>
    <div class="admin-actions"><button class="btn btn--primary" type="button" data-go>Save</button><button class="btn btn--ghost" type="button" data-cancel>Cancel</button></div>`);
  const qty = $('#sent-qty', d);
  qty.select();
  $('[data-cancel]', d).addEventListener('click', () => d.close());
  const go = async () => {
    const n = Number(qty.value);
    if (qty.value.trim() === '' || !Number.isInteger(n) || n < 0 || n > 9999) {
      qty.setAttribute('aria-invalid', 'true');
      return void ($('[data-sent-error]', d).textContent = 'Enter a whole number from 0 to 9999.');
    }
    const btn = $('[data-go]', d);
    btn.disabled = true;
    const { error } = await sb.rpc('staff_set_submitted', { p_item_id: r.item_id, p_quantity: n, p_location: orderLocation(), p_note: $('#sent-note', d).value.trim() || null });
    if (error) {
      btn.disabled = false;
      return void ($('[data-sent-error]', d).textContent = friendlyError(error));
    }
    d.close();
    toast(`${name}: ${n} ${n === 1 ? 'copy' : 'copies'} sent`);
    renderToOrder(body);
  };
  $('[data-go]', d).addEventListener('click', go);
  qty.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
}

/**
 * "We're not ordering this title": every open reservation for it becomes Not ordered. It leaves the To order
 * list, and customers see it as "Not ordered by the shop" (staff can change a line back from the customer's pull list).
 * If the title's order cutoff later moves to a date still open, the lines open again (a database trigger).
 */
async function markNotOrdered(body, itemId, btn) {
  btn.disabled = true;
  try {
    const lines = await must(atLocation(sb.from('reservations').select('id,quantity,item:items(title,issue_number,variant)').eq('status', 'open').eq('reorder', false).eq('counts_for_order', true).eq('item_id', itemId)));
    if (!lines.length) {
      toast('Nothing is waiting to be ordered for that title any more.', 'error');
      return void renderToOrder(body);
    }
    const name = itemName(lines[0].item);
    const copies = lines.reduce((n, l) => n + l.quantity, 0);
    if (!confirm(`Mark ${name} as not ordered?\n\n${lines.length} ${lines.length === 1 ? 'reservation' : 'reservations'} (${copies} ${copies === 1 ? 'copy' : 'copies'}) will show "Not ordered" in the customers' pull lists and leave this list. If its order cutoff is moved later, they open again.`)) return;
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
 * Expand or collapse a hidden row under a title listing who reserved it, laid out in columns. A plain button lists
 * open lines; one with data-all (Place Order) the open lines and those already ordered, a button with data-past lists the lines already ordered (PAST_STATUSES), and one with data-waiting the lines
 * Received can mark ready (WAITING_STATUSES), each with where it stands now. Re-order lines are listed only by Received
 * and by a button with data-reorder (the Re-order tab's open lines).
 */
async function toggleCustomers(btn) {
  const past = 'past' in btn.dataset;
  const every = 'all' in btn.dataset;
  const waiting = 'waiting' in btn.dataset;
  const reorder = 'reorder' in btn.dataset;
  const statuses = past ? PAST_STATUSES : waiting ? WAITING_STATUSES : every ? ['open', ...PAST_STATUSES] : ['open'];
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
  // A customer's name opens their record under Customers (guest orders have none, so their names stay plain).
  cell.addEventListener('click', (e) => {
    const link = e.target.closest('[data-customer]');
    if (!link) return;
    try {
      sessionStorage.setItem('admin-open-customer', link.dataset.customer);
    } catch {
      /* the link still opens the customer list */
    }
  });
  try {
    let q = sb.from('reservations').select('quantity,status,order:reservation_orders(id,name,customer_id,customer:customers(name,first_name,last_name))').in('status', statuses).eq('item_id', Number(btn.dataset.customers));
    if (!waiting) q = q.eq('reorder', reorder);
    const lines = await must(atLocation(q));
    // Sorted by last name and shown as "Last, First". Guest orders only have one name field: the last word is the surname.
    const people = lines.map((l) => {
      const c = l.order?.customer;
      const id = l.order?.customer_id ?? null;
      if (c?.last_name) return { last: c.last_name, first: c.first_name ?? '', qty: l.quantity, status: l.status, id };
      const words = (c?.name || l.order?.name || 'Unknown').trim().split(/\s+/);
      const last = words.pop();
      return { last, first: words.join(' '), qty: l.quantity, status: l.status, id };
    }).map((p) => ({ ...p, name: [p.last, p.first].filter(Boolean).join(', ') }))
      .sort((a, b) => a.last.localeCompare(b.last, undefined, { sensitivity: 'base' }) || a.first.localeCompare(b.first, undefined, { sensitivity: 'base' }));
    cell.removeAttribute('aria-busy');
    cell.innerHTML = people.length
      ? `<ul class="toorder__list">${people.map((p) => `<li>${p.id ? `<a href="#customers" data-customer="${p.id}">${esc(p.name)}</a>` : esc(p.name)}${p.qty > 1 ? ` <strong>×${p.qty}</strong>` : ''}${past || waiting || every ? ` <span class="card__meta">· ${esc(LINE_STATUS[p.status] ?? p.status)}</span>` : ''}</li>`).join('')}</ul>`
      : `<span class="empty">${past ? 'No ordered reservations for this title any more.' : waiting ? 'No reservations waiting for this title any more.' : every ? 'No reservations for this title any more.' : 'No open reservations for this title any more.'}</span>`;
  } catch (err) {
    cell.removeAttribute('aria-busy');
    cell.innerHTML = `<span class="form-error">${esc(friendlyError(err))}</span>`;
  }
}

// ---------------------------------------------------------------------------
// Past orders: what was already ordered, grouped by order cutoff (read-only)
// ---------------------------------------------------------------------------

const PAST_STATUSES = ['ordered', 'reordered', 'arrived', 'picked_up'];
// Lines Received lists and can mark ready.
const WAITING_STATUSES = ['open', 'ordered', 'reordered'];

// Whether Place Order's Past orders section is open, kept across refreshes.
let pastOpen = false;

/** Place Order's Past orders section: passed cutoffs, newest first, each loading its titles when opened. */
async function renderPastOrders(box) {
  box.innerHTML = '<p class="admin-hint">Cutoffs that have passed and were ordered, newest first. Open one to see each title’s copies (the same numbers as above), what was sent to the distributor, and where each copy stands now.</p><div data-past-cutoffs aria-busy="true"></div>';
  box = $('[data-past-cutoffs]', box);
  let cutoffs;
  try {
    cutoffs = await must(sb.rpc('staff_past_cutoffs', { p_location: orderLocation() }));
  } catch (err) {
    box.removeAttribute('aria-busy');
    return void (box.innerHTML = `<p class="form-error">${esc(friendlyError(err))}</p>`);
  }
  box.removeAttribute('aria-busy');
  if (!cutoffs.length) return void (box.innerHTML = '<p class="empty">No past cutoffs yet. Cutoffs ordered early stay on Place Order until their date passes.</p>');
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  box.innerHTML = cutoffs
    .map((c) => {
      const foc = c.foc_date ?? 'No cutoff';
      return `<details class="fold fold--compact" data-past-foc="${esc(foc)}">
        <summary class="fold__head"><h2>${foc === 'No cutoff' ? 'No Order Cutoff' : `Cutoff ${fmtDate(foc, { weekday: 'short', month: 'short', day: 'numeric' })}`}<span class="fold__note">${plural(c.titles, 'title', 'titles')} · ${plural(c.total, 'copy', 'copies')}${c.shop_copies ? ` (${c.shop_copies} store)` : ''}</span></h2></summary>
        <div class="fold__body" data-past-body></div>
      </details>`;
    })
    .join('');
  // Each cutoff's titles load the first time it is opened.
  box.addEventListener('toggle', (e) => {
    const d = e.target.closest?.('[data-past-foc]');
    if (d?.open && !d.dataset.loaded) loadPastCutoff(d);
  }, true);
  // Sorting reorders rows, which would strand an open customer row: close them first.
  box.addEventListener('click', (e) => { if (e.target.closest('th[data-sort]')) $$('tr.toorder__people', box).forEach((r) => { r.previousElementSibling?.querySelector('[data-customers]')?.setAttribute('aria-expanded', 'false'); r.remove(); }); }, true);
  box.addEventListener('click', (e) => {
    const cust = e.target.closest('[data-customers]');
    if (cust) toggleCustomers(cust);
  });
}

/** One past cutoff's titles (staff_order_rows), with where each title's copies stand now. */
async function loadPastCutoff(d) {
  d.dataset.loaded = '1';
  const out = $('[data-past-body]', d);
  // Busy only while it loads (a closed cutoff left marked busy would keep the page's loading spinner up).
  out.setAttribute('aria-busy', 'true');
  try {
    const rows = await loadCutoffRows(d.dataset.pastFoc);
    // Where the customers' copies stand now: their lines' statuses, a few hundred titles per request.
    const status = new Map();
    const ids = rows.map((r) => r.item_id);
    for (let i = 0; i < ids.length; i += 300) {
      const lines = await must(atLocation(sb.from('reservations').select('item_id,quantity,status').in('item_id', ids.slice(i, i + 300)).in('status', PAST_STATUSES).eq('reorder', false)));
      for (const l of lines) {
        const m = status.get(l.item_id) ?? new Map();
        m.set(l.status, (m.get(l.status) ?? 0) + l.quantity);
        status.set(l.item_id, m);
      }
    }
    const sent = rows.some((r) => r.submitted != null);
    const where = (r) => [
      ...[...(status.get(r.item_id) ?? [])].map(([st, n]) => `${n} ${esc((LINE_STATUS[st] ?? st).toLowerCase())}`),
      r.shop_copies && r.shop_status ? `${r.shop_copies} store ${r.shop_status === 'received' ? 'received' : r.shop_status === 'ordered' ? 'ordered' : esc(r.shop_status)}` : '',
    ].filter(Boolean).join(', ');
    out.innerHTML = rows.length
      ? `<table class="admin-table past-table cards">
        <thead><tr><th scope="col" data-sort="text">Title</th><th scope="col" data-sort="num" data-first="desc">Customers</th><th scope="col" data-sort="num" data-first="desc">Store</th><th scope="col" data-sort="num" data-first="desc">Copies</th>${sent ? '<th scope="col" data-sort="num" data-first="desc">Sent</th>' : ''}<th scope="col">Status</th></tr></thead>
        <tbody>${rows.map((r) => `<tr>
          <td class="card-title">${esc(itemName(r))}</td>
          <td class="center card-key card-label">${customersCell(r, 'past')}</td>
          <td class="center card-key card-label">${r.shop_copies || '–'}</td>
          <td class="center card-key card-label"><strong>${r.total}</strong></td>
          ${sent ? `<td class="center card-key card-label">${r.submitted ?? '–'}</td>` : ''}
          <td class="card-wide">${where(r)}</td>
          </tr>`).join('')}</tbody>
      </table>`
      : '<p class="empty">No titles in this cutoff any more.</p>';
    const table = $('table', out);
    if (table) sortableTable(table);
  } catch (err) {
    delete d.dataset.loaded; // opening it again tries again
    out.innerHTML = `<p class="form-error">${esc(friendlyError(err))}</p>`;
  }
  out.removeAttribute('aria-busy');
}

// ---------------------------------------------------------------------------
// Distributor order list: titles and copy counts to order, per distributor
// ---------------------------------------------------------------------------

const DISTRIBUTORS = { lunar: 'Lunar', prh: 'PRH', other: 'Other' };
const distributorName = (d) => DISTRIBUTORS[d] ?? 'Unassigned';
const stamp = () => stampIn(settings.timezone);

function setupOrderTools(box, groups, keep = {}) {
  const focs = [...groups.keys()].sort();
  const present = [...new Set([...groups.values()].flat().map((r) => r.distributor ?? ''))].sort((a, b) => distributorName(a || null).localeCompare(distributorName(b || null)));
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
      <div class="order-file" data-ot-file></div>
      <p class="card__meta">Quantities as of ${esc(fmtTime())}. <button class="admin-link-button" type="button" data-ot-refresh>Refresh</button>. Exports always use the latest quantities, whatever this page shows.</p>
    </section>`;
  // Keep the same filters after a refresh.
  if (keep.foc && [...$('#ot-foc', box).options].some((o) => o.value === keep.foc)) $('#ot-foc', box).value = keep.foc;
  if (keep.dist && [...$('#ot-dist', box).options].some((o) => o.value === keep.dist)) $('#ot-dist', box).value = keep.dist;

  /** The titles still to order for a cutoff ('' for all) and distributor, grouped for the CSV and PDF. */
  const select = (data, foc, dist) =>
    generalGroups([...forDistributor(data, dist)].filter(([f]) => !foc || f === foc).flatMap(([, rows]) => rows.filter(pending)), { ...DISTRIBUTORS, '': distributorName(null) });

  const fileBox = $('[data-ot-file]', box);
  const summarise = () => {
    const foc = $('#ot-foc', box).value;
    const dist = $('#ot-dist', box).value;
    const sel = select(groups, foc, dist);
    const titles = sel.reduce((n, g) => n + g.rows.length, 0);
    const copies = sel.reduce((n, g) => n + g.rows.reduce((m, r) => m + r.copies, 0), 0);
    $('[data-ot-summary]', box).textContent = titles ? `${titles} ${titles === 1 ? 'title' : 'titles'}, ${copies} ${copies === 1 ? 'copy' : 'copies'} to order${sel.length > 1 ? `: ${sel.map((g) => `${g.name} ${g.rows.reduce((m, r) => m + r.copies, 0)}`).join(' · ')}` : ''}` : 'Nothing to order for that selection.';
    fileBox.innerHTML = distributorFileHtml(foc, dist, foc ? forDistributor(groups, dist).get(foc) ?? [] : []);
  };
  box.addEventListener('change', summarise);
  summarise();

  box.addEventListener('click', async (e) => {
    if (e.target.closest('[data-ot-refresh]')) {
      toast('Refreshing quantities…');
      return void (await renderToOrder(box.closest('[data-body]')));
    }
    const file = e.target.closest('[data-file]');
    if (file) return void distributorFile(file, fileBox, $('#ot-foc', box).value, $('#ot-dist', box).value);
    const copy = e.target.closest('[data-prh-copy], [data-prh-xlsx]');
    if (copy) return void prhBatch(copy, fileBox);
    const btn = e.target.closest('[data-ot]');
    if (!btn) return;
    const foc = $('#ot-foc', box).value;
    const dist = $('#ot-dist', box).value;
    const body = box.closest('[data-body]');

    // Always export what is in the database right now, not what the page loaded earlier.
    btn.disabled = true;
    let fresh;
    try {
      fresh = await loadOrderData();
    } catch (err) {
      btn.disabled = false;
      return void toast(`Couldn’t load the latest quantities: ${friendlyError(err)}`, 'error');
    }
    btn.disabled = false;
    const sel = select(fresh, foc, dist);
    if (!sel.length) {
      renderToOrder(body);
      return void toast('Nothing to order for that selection right now.', 'error');
    }
    // If anything moved since the page loaded, say so and bring the page up to date too.
    const key = (g) => [...g].map(([f, rows]) => `${f}=${pendingKey(rows)}`).sort().join(';');
    if (key(fresh) !== key(groups)) {
      toast('Quantities changed since this page loaded. Exporting the latest quantities.');
      setTimeout(() => renderToOrder(body), 0);
    }
    const slug = `${dist === 'all' ? 'all' : dist}-${foc ? foc.toLowerCase().replace(/\s+/g, '-') : 'all-cutoffs'}${locationSlug()}-${stamp()}`;
    if (btn.dataset.ot === 'csv') {
      const rows = sel.flatMap((g) => g.rows.map((r) => [g.name, r.code, r.upc, r.baseTitle, r.issue, r.variant, r.publisher, r.price, r.release, r.foc, r.customers, r.store, r.copies]));
      downloadCsv(`distributor-order-${slug}.csv`, ['Distributor', 'Product code', 'UPC/ISBN', 'Title', 'Issue', 'Variant', 'Publisher', 'Price', 'Release', 'FOC', 'Customer copies', 'Store copies', 'Copies to order'], rows);
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

// ---------------------------------------------------------------------------
// Distributor files: Lunar's FOC edits CSV and PRH's cart paste, one cutoff and one distributor at a time.
// Built by admin/order-export.js from fresh rows; the panel under the cutoff and distributor pickers.
// ---------------------------------------------------------------------------

const FILE_DISTS = ['lunar', 'prh'];

/** The distributor file part of the tools panel, for the cutoff and distributor picked (rows: that cutoff's, loaded). */
function distributorFileHtml(foc, dist, rows) {
  if (dist !== 'all' && !FILE_DISTS.includes(dist))
    return `<p class="card__meta">${esc(distributorName(dist === 'none' ? null : dist))} titles go out with the CSV or PDF: only Lunar and PRH have a file of their own.</p>`;
  if (!foc || dist === 'all') return '<p class="card__meta">Pick one cutoff and Lunar or PRH above for the file to upload or paste on the distributor’s site.</p>';
  if (dist === 'lunar')
    return `<h3>Lunar FOC edits</h3>
      <p class="admin-hint">Upload this file on Lunar’s <strong>Upload FOC Edits</strong> page only. It sets each title’s quantity to the full total (titles sent before and now at 0 go in with 0). Lunar’s other ordering pages add to what’s there, which would double the order.</p>
      <div class="admin-actions"><button class="btn btn--primary" type="button" data-file="lunar">Download Lunar file</button></div>
      <div data-file-out></div>`;
  const sent = rows.some((r) => r.submitted != null);
  return `<h3>PRH cart paste</h3>
    <p class="admin-hint">PRH’s paste adds to the cart and takes at most ${PRH_BATCH} titles at a time, so the lines come in numbered batches. ${sent ? 'This cutoff was sent before: the lines hold only what was added since. Anything that went down is listed to change by hand in the PRH cart.' : 'Nothing was sent for this cutoff yet: the lines hold each title’s full total.'}</p>
    <div class="admin-actions"><button class="btn btn--primary" type="button" data-file="prh">${sent ? 'Get PRH changes' : 'Get PRH lines'}</button></div>
    <div data-file-out></div>`;
}

/** Titles left out of a file for want of a code, as a list under the button. */
const missingHtml = (missing, what) =>
  missing.length
    ? `<div class="order-file__list"><p class="admin-status admin-status--error">${missing.length} ${missing.length === 1 ? 'title has' : 'titles have'} no ${what} and ${missing.length === 1 ? 'is' : 'are'} left out. Add ${missing.length === 1 ? 'it' : 'them'} on the distributor’s site by hand, or fix the code in Titles:</p>
      <ul>${missing.map((r) => `<li>${esc(rowName(r))} <span class="card__meta">· ${r.total} ${r.total === 1 ? 'copy' : 'copies'}</span></li>`).join('')}</ul></div>`
    : '';

// The PRH lines last built, for the batch buttons: { lines, batches, foc }.
let prhBuilt = null;

async function distributorFile(btn, fileBox, foc, dist) {
  const out = $('[data-file-out]', fileBox);
  btn.disabled = true;
  let rows;
  try {
    rows = await loadCutoffRows(foc, dist);
  } catch (err) {
    btn.disabled = false;
    return void toast(`Couldn’t load the latest quantities: ${friendlyError(err)}`, 'error');
  }
  btn.disabled = false;
  if (dist === 'lunar') {
    const f = lunarFile(rows, { foc: foc === 'No cutoff' ? null : foc });
    out.innerHTML = missingHtml(f.missing, 'Lunar product code (SKU)') + (f.titles ? `<p class="card__meta" role="status">Saved ${esc(f.filename)}: ${f.titles} ${f.titles === 1 ? 'title' : 'titles'}, ${f.copies} ${f.copies === 1 ? 'copy' : 'copies'}${f.zeros ? ` (${f.zeros} at 0)` : ''}. Upload it on Upload FOC Edits.</p>` : `<p class="empty" role="status">Nothing to export: no title in this cutoff has copies to order or was sent before.</p>`);
    if (f.titles) downloadText(f.filename, f.csv, 'text/csv');
    return;
  }
  const p = prhExport(rows);
  prhBuilt = { ...p, foc };
  const date = foc === 'No cutoff' ? 'no-cutoff' : foc;
  out.innerHTML = missingHtml(p.missing, 'UPC or ISBN')
    + (p.titles
      ? `<p class="card__meta" role="status">${p.mode === 'changes' ? 'Added since the last order' : 'Full order'}: ${p.titles} ${p.titles === 1 ? 'title' : 'titles'}, ${p.copies} ${p.copies === 1 ? 'copy' : 'copies'}${p.batches.length > 1 ? ` in ${p.batches.length} batches` : ''}. Copy a batch and paste it into the PRH cart, one batch at a time.</p>
        <ol class="order-file__batches">${p.batches.map((b) => `<li><span>${p.batches.length > 1 ? `Batch ${b.n} · titles ${b.from}–${b.to}` : `${b.items.length} ${b.items.length === 1 ? 'title' : 'titles'}`} · ${b.items.reduce((n, l) => n + l.quantity, 0)} copies</span>
          <span class="order-file__acts"><button class="btn btn--primary btn--small" type="button" data-prh-copy="${b.n}">Copy</button><button class="btn btn--ghost btn--small" type="button" data-prh-xlsx="${b.n}" data-name="prh-order-${esc(date)}${p.batches.length > 1 ? `-batch-${b.n}` : ''}${locationSlug()}.xlsx">Download .xlsx</button><span class="pill pill--done" data-copied="${b.n}" hidden>Copied</span></span></li>`).join('')}</ol>`
      : `<p class="empty" role="status">${p.mode === 'changes' ? 'Nothing new to add to the PRH cart since the last order.' : 'Nothing to export: no title in this cutoff has copies to order.'}</p>`)
    + (p.decreases.length
      ? `<div class="order-file__list"><p><strong>Lower by hand in the PRH cart</strong> (a paste can only add):</p>
        <table class="admin-table cards"><thead><tr><th scope="col">Title</th><th scope="col">UPC / ISBN</th><th scope="col" class="center">Sent</th><th scope="col" class="center">Now</th></tr></thead>
        <tbody>${p.decreases.map((d) => `<tr><td class="card-title">${esc(rowName(d.row))}</td><td class="nowrap">${esc(d.code || '–')}</td><td class="center card-key card-label">${d.submitted}</td><td class="center card-key card-label"><strong>${d.now}</strong></td></tr>`).join('')}</tbody></table></div>`
      : '');
}

/** Copy one PRH batch to the clipboard, or save it as an .xlsx, and mark it Copied. */
async function prhBatch(btn, fileBox) {
  const n = Number(btn.dataset.prhCopy ?? btn.dataset.prhXlsx);
  const batch = prhBuilt?.batches.find((b) => b.n === n);
  if (!batch) return;
  if (btn.dataset.prhXlsx) {
    const { ZipBuilder } = await import('../zip.js');
    const zip = new ZipBuilder();
    for (const [path, text] of prhXlsxFiles(batch.items)) zip.add(path, new TextEncoder().encode(text));
    downloadBlob(btn.dataset.name, new Blob([zip.finish()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  } else {
    try {
      await navigator.clipboard.writeText(prhText(batch.items));
    } catch {
      return void toast('Couldn’t copy to the clipboard. Download the .xlsx instead.', 'error');
    }
    toast(`Copied ${batch.items.length} ${batch.items.length === 1 ? 'line' : 'lines'} for the PRH cart`);
  }
  const mark = $(`[data-copied="${n}"]`, fileBox);
  if (mark) mark.hidden = false;
}

/** Save a Blob as a file. */
function downloadBlob(filename, blob) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Save text as a file exactly as built (no byte-order mark: the distributor's upload reads it as it is). */
const downloadText = (filename, text, type) => downloadBlob(filename, new Blob([text], { type }));

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

// ---------------------------------------------------------------------------
// Re-order: any title ordered after its cutoff (trades and omnibuses stay in print), for the shelf or for a customer.
// Customer lines are reservations with reorder = true; shelf copies are stock_reorders rows.
// ---------------------------------------------------------------------------

const REORDER_ITEM = `${ITEM_FIELDS},upc,isbn,sku,distributor,status`;
// Who the next re-order is for: null is the shelf, else { id, name } (kept while staff switch tabs).
let reorderFor = null;

/**
 * Re-order lines and shelf re-orders with this status, totalled per title:
 * item id → { item, copies, shelf, orders (customer orders), lineIds, stockIds }.
 */
async function loadReorders(status) {
  const [lines, stock] = await Promise.all([
    fetchAll(() => {
      const q = atLocation(sb.from('reservations').select(`id,quantity,order_id,item:items(${REORDER_ITEM})`).eq('reorder', true).eq('status', status));
      return (status === 'open' ? q.eq('counts_for_order', true) : q).order('id');
    }),
    fetchAll(() => atLocation(sb.from('stock_reorders').select(`id,quantity,item:items(${REORDER_ITEM})`).eq('status', status)).order('id')),
  ]);
  const rows = new Map();
  const row = (item) => rows.get(item.id) ?? rows.set(item.id, { item, copies: 0, shelf: 0, orders: new Set(), lineIds: [], stockIds: [] }).get(item.id);
  for (const l of lines) {
    const r = row(l.item);
    r.copies += l.quantity;
    r.orders.add(l.order_id);
    r.lineIds.push(l.id);
  }
  for (const s of stock) {
    const r = row(s.item);
    r.copies += s.quantity;
    r.shelf += s.quantity;
    r.stockIds.push(s.id);
  }
  return rows;
}

/** Only one distributor's titles ('all' keeps every title, 'none' the unassigned ones), A-Z. */
const reorderRows = (rows, dist) =>
  [...rows.values()].filter((r) => dist === 'all' || (r.item.distributor || 'none') === dist).sort((a, b) => itemName(a.item).localeCompare(itemName(b.item)));

async function renderReorders(body) {
  const keepDist = $('#ro-dist', body)?.value ?? 'all';
  const keepQ = $('#ro-q', body)?.value ?? '';
  setHint(body, `Order any title from the distributor after its order cutoff: trades and omnibuses stay in print, so they can be ordered any time after release. Coming Soon titles (past their cutoff, not out yet) are where most re-orders happen. Search the catalog (pre-orders aren't listed: they go through Place Order), pick the copies and who they're for (the shelf, or a customer: the copy goes on their pull list), and add it to the re-order list. Signed-in customers can also order released trades and omnibuses themselves from the title's details on the site. Export the list for the distributor, then mark it ordered. When the copies come in, mark customers' copies Ready on Received and shelf copies received here.`);
  body.innerHTML = `
    <section class="fold fold--compact fold--static">
      <div class="fold__head"><h2 id="ro-find">Find a Title</h2></div>
      <div class="fold__body">
        <div class="field"><label for="ro-cust">For a customer</label>
          <input id="ro-cust" type="search" placeholder="Name, phone or email (leave empty for the shelf)" autocomplete="off"></div>
        <div data-ro-custs></div>
        <p class="card__meta" data-ro-for></p>
        <form class="cust-search" data-ro-search role="search"><label class="visually-hidden" for="ro-q">Find any title</label>
          <input id="ro-q" type="search" placeholder="${isPhone(599) ? 'Search any title' : 'Search any title, cover, creator, UPC or ISBN'}" autocomplete="off"></form>
        <div data-ro-results></div>
      </div>
    </section>
    <div data-ro-tools></div>
    <div data-ro-list aria-busy="true"></div>`;
  const results = $('[data-ro-results]', body);
  const custs = $('[data-ro-custs]', body);
  const showFor = () => {
    $('[data-ro-for]', body).innerHTML = reorderFor
      ? `Re-ordering for <strong>${esc(reorderFor.name)}</strong> (on their pull list). <button class="admin-link-button" type="button" data-ro-shelf>Order for the shelf instead</button>`
      : 'Re-ordering for the shelf.';
  };
  showFor();

  const searchTitles = async (text) => {
    const match = titleFilter(text, { codes: true });
    if (text.trim().length < 2 || !match) return void (results.innerHTML = '');
    // Pre-orders go through Place Order (customers reserve them before the cutoff), so they're left out here.
    const { data, error } = await sb.from('items').select(REORDER_ITEM).neq('status', 'pre_order').or(match).order('title').order('issue_number').order('variant').limit(30);
    if (error) return void (results.innerHTML = `<p class="form-error">${esc(friendlyError(error))}</p>`);
    results.innerHTML = data.length
      ? `<ul class="cust-results">${data
          .map((i) => `<li>
          <span><strong>${esc(itemName(i))}</strong><br><span class="card__meta">${esc([i.publisher, i.release_date && `${i.release_date > today() ? 'Out' : 'Released'} ${fmtDate(i.release_date, { month: 'short', day: 'numeric', year: 'numeric' })}`, STATUS_LABELS[i.status], distributorName(i.distributor ?? null), i.upc || i.isbn || i.sku].filter(Boolean).join(' · '))}</span></span>
          <span class="cust-results__act">
            <label class="visually-hidden" for="rq-${i.id}">Copies</label><input id="rq-${i.id}" class="cust-qty" type="number" min="1" max="100" value="1">
            <button class="btn btn--add btn--small" type="button" data-ro-add="${i.id}" aria-label="Re-order ${esc(itemName(i))}">${solidIcon('add', 16)} Re-order</button>
          </span></li>`)
          .join('')}</ul>`
      : '<p class="empty">No titles match (pre-orders aren’t listed here).</p>';
  };
  const searchCustomers = async (text) => {
    const match = customerFilter(text, { words: true });
    if (text.trim().length < 2 || !match) return void (custs.innerHTML = '');
    const { data, error } = await sb.from('customers').select('id,name,first_name,last_name,phone,email').or(match).order('last_name').order('name').limit(8);
    if (error) return void (custs.innerHTML = `<p class="form-error">${esc(friendlyError(error))}</p>`);
    custs.innerHTML = data.length
      ? `<ul class="cust-results">${data
          .map((c) => `<li><span><strong>${esc(c.last_name ? [c.last_name, c.first_name].filter(Boolean).join(', ') : c.name || c.email)}</strong><br><span class="card__meta">${esc([c.phone && formatPhone(c.phone), c.email].filter(Boolean).join(' · '))}</span></span>
          <span class="cust-results__act"><button class="btn btn--ghost btn--small" type="button" data-ro-pick="${c.id}" data-name="${esc(c.name || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email)}">Pick</button></span></li>`)
          .join('')}</ul>`
      : '<p class="empty">No customers match.</p>';
  };
  $('#ro-cust', body).addEventListener('input', debounce((e) => searchCustomers(e.target.value), 300));
  $('[data-ro-search]', body).addEventListener('input', debounce((e) => searchTitles(e.target.value), 300));
  $('[data-ro-search]', body).addEventListener('submit', (e) => e.preventDefault());
  custs.addEventListener('click', (e) => {
    const pick = e.target.closest('[data-ro-pick]');
    if (!pick) return;
    reorderFor = { id: Number(pick.dataset.roPick), name: pick.dataset.name };
    custs.innerHTML = '';
    $('#ro-cust', body).value = '';
    showFor();
  });
  $('[data-ro-for]', body).addEventListener('click', (e) => {
    if (!e.target.closest('[data-ro-shelf]')) return;
    reorderFor = null;
    showFor();
  });
  results.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-ro-add]');
    if (!btn) return;
    const id = Number(btn.dataset.roAdd);
    const qty = Math.min(Math.max(Math.round(Number($(`#rq-${id}`, results).value)) || 1, 1), 100);
    btn.disabled = true;
    const { error } = await sb.rpc('staff_reorder', { p_item_id: id, p_quantity: qty, p_customer: reorderFor?.id ?? null, p_location: state.location ? Number(state.location) : null });
    btn.disabled = false;
    if (error) return void toast(friendlyError(error), 'error');
    toast(`${btn.closest('li').querySelector('strong').textContent} × ${qty} added to the re-order list${reorderFor ? ` for ${reorderFor.name}` : ' for the shelf'}`);
    drawList();
  });
  if (keepQ) {
    $('#ro-q', body).value = keepQ;
    searchTitles(keepQ);
  }

  const box = $('[data-ro-list]', body);
  const tools = $('[data-ro-tools]', body);
  let open = new Map();
  let ordered = new Map();
  const dist = () => $('#ro-dist', body)?.value ?? keepDist;
  const ordinal = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  const table = (rows, { action }) => `<table class="admin-table cards cards--slim">
      <thead><tr><th scope="col" data-sort="text">Title</th><th scope="col" data-sort="text">Distributor</th><th scope="col" data-sort="text">Publisher</th><th scope="col">UPC / SKU</th><th scope="col" data-sort="num" data-first="desc">Copies</th><th scope="col" data-sort="num" data-first="desc">Shelf</th><th scope="col" data-sort="num" data-first="desc">Customers</th><th scope="col"><span class="visually-hidden">${action === 'remove' ? 'Not re-ordering' : 'Shelf copies in'}</span></th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td class="card-title">${esc(itemName(r.item))}</td>
        <td>${esc(distributorName(r.item.distributor ?? null))}</td>
        <td>${esc(r.item.publisher ?? '')}</td>
        <td class="nowrap">${esc(r.item.upc || r.item.isbn || r.item.sku || '')}</td>
        <td class="center card-key card-label"><strong>${r.copies}</strong></td>
        <td class="center card-key card-label">${r.shelf || '—'}</td>
        <td class="center card-key card-label">${r.orders.size ? `<button type="button" class="link-button" data-customers="${r.item.id}" data-reorder${action === 'remove' ? '' : ' data-past'} title="See who this title is re-ordered for">${r.orders.size}</button>` : '—'}</td>
        <td class="center card-action">${action === 'remove'
          ? `<button type="button" class="icon-btn icon-btn--remove" data-ro-remove="${r.item.id}" aria-label="Not re-ordering ${esc(itemName(r.item))}" title="We are not re-ordering this title">${solidIcon('skip')}</button>`
          : r.shelf ? `<button type="button" class="btn btn--green btn--small" data-ro-received="${r.item.id}" title="The shelf copies are in the shop">Shelf copies in</button>` : ''}</td>
        </tr>`).join('')}</tbody>
    </table>`;

  const draw = () => {
    const d = dist();
    const rows = reorderRows(open, d);
    const done = reorderRows(ordered, d);
    const copies = rows.reduce((n, r) => n + r.copies, 0);
    const from = d === 'all' ? '' : ` from ${distributorName(d === 'none' ? null : d)}`;
    $('[data-ro-summary]', tools).textContent = rows.length ? `${ordinal(rows.length, 'title', 'titles')}, ${ordinal(copies, 'copy', 'copies')} to re-order${from}.` : `Nothing to re-order${from}.`;
    box.innerHTML = `<details class="fold fold--compact" open>
        <summary class="fold__head"><h2>To Re-order<span class="fold__note">${rows.length ? `${ordinal(rows.length, 'title', 'titles')} · ${ordinal(copies, 'copy', 'copies')}` : 'Nothing yet'}</span></h2></summary>
        <div class="fold__body">${rows.length
          ? `<div class="admin-actions toorder__actions"><button class="btn btn--green" type="button" data-ro-ordered title="After you place the re-order with the distributor">Mark ${ordinal(copies, 'copy', 'copies')} ordered</button></div>${table(rows, { action: 'remove' })}`
          : `<p class="empty">Nothing waiting to be re-ordered${esc(from)}. Search for a title above to add one.</p>`}</div>
      </details>
      <details class="fold fold--compact"${done.length ? ' open' : ''}>
        <summary class="fold__head"><h2>On Order<span class="fold__note">${done.length ? `${ordinal(done.length, 'title', 'titles')} · ${ordinal(done.reduce((n, r) => n + r.copies, 0), 'copy', 'copies')}` : 'Nothing on order'}</span></h2></summary>
        <div class="fold__body">${done.length
          ? `<p class="admin-hint">Re-ordered and waiting to come in. Customers' copies: mark them Ready on Received.</p>${table(done, { action: 'received' })}`
          : '<p class="empty">No re-orders on order.</p>'}</div>
      </details>`;
    $$('table', box).forEach((t) => sortableTable(t));
  };

  const drawList = async () => {
    box.setAttribute('aria-busy', 'true');
    try {
      [open, ordered] = await Promise.all([loadReorders('open'), loadReorders('ordered')]);
    } catch (err) {
      box.removeAttribute('aria-busy');
      return void (box.innerHTML = `<p class="form-error">${esc(friendlyError(err))}</p>`);
    }
    box.removeAttribute('aria-busy');
    const present = [...new Set([...open.values(), ...ordered.values()].map((r) => r.item.distributor ?? ''))].sort((a, b) => distributorName(a || null).localeCompare(distributorName(b || null)));
    const was = dist();
    tools.innerHTML = `<section class="panel order-tools" aria-labelledby="ro-tools-h">
        <h2 id="ro-tools-h">Distributor Re-order List</h2>
        <div class="order-tools__row">
          <div class="field"><label for="ro-dist">Distributor</label><select id="ro-dist">
            <option value="all">All distributors</option>
            ${present.map((d) => `<option value="${esc(d || 'none')}">${esc(distributorName(d || null))}</option>`).join('')}
          </select></div>
          <div class="field order-tools__btns">
            <span><button class="btn btn--primary" type="button" data-ro-export="csv">Export CSV</button>
            <button class="btn btn--ghost" type="button" data-ro-export="pdf">Export PDF</button></span></div>
        </div>
        <p class="card__meta" data-ro-summary></p>
      </section>`;
    if ([...$('#ro-dist', tools).options].some((o) => o.value === was)) $('#ro-dist', tools).value = was;
    draw();
  };

  tools.addEventListener('change', draw);
  tools.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-ro-export]');
    if (!btn) return;
    // Always export what is in the database right now.
    btn.disabled = true;
    let rows;
    try {
      open = await loadReorders('open');
      rows = reorderRows(open, dist());
    } catch (err) {
      btn.disabled = false;
      return void toast(`Couldn’t load the latest re-orders: ${friendlyError(err)}`, 'error');
    }
    draw();
    btn.disabled = false;
    if (!rows.length) return void toast('Nothing to re-order for that selection right now.', 'error');
    const order = ['lunar', 'prh', 'other', ''];
    const groups = [...new Set(rows.map((r) => r.item.distributor ?? ''))]
      .sort((a, b) => order.indexOf(a) - order.indexOf(b))
      .map((key) => ({
        key,
        name: distributorName(key || null),
        rows: rows.filter((r) => (r.item.distributor ?? '') === key).map((r) => ({
          code: r.item.sku || r.item.isbn || r.item.upc || '',
          upc: r.item.upc || r.item.isbn || '',
          title: [r.item.title, r.item.issue_number && `#${r.item.issue_number}`].filter(Boolean).join(' '),
          issue: r.item.issue_number,
          baseTitle: r.item.title,
          variant: r.item.variant ?? '',
          publisher: r.item.publisher ?? '',
          price: r.item.price,
          release: r.item.release_date,
          copies: r.copies,
          shelf: r.shelf,
          customers: r.orders.size,
        })),
      }));
    const d = dist();
    const slug = `${d}${locationSlug()}-${stamp()}`;
    if (btn.dataset.roExport === 'csv') {
      const csv = groups.flatMap((g) => g.rows.map((r) => [g.name, r.code, r.upc, r.baseTitle, r.issue, r.variant, r.publisher, r.price, r.release, r.copies, r.shelf, r.customers]));
      downloadCsv(`distributor-reorder-${slug}.csv`, ['Distributor', 'Product code', 'UPC/ISBN', 'Title', 'Issue', 'Variant', 'Publisher', 'Price', 'Release', 'Copies to order', 'For the shelf', 'Customers'], csv);
      return void toast(`Exported ${csv.length} ${csv.length === 1 ? 'title' : 'titles'}`);
    }
    btn.disabled = true;
    try {
      const { buildOrderSheetPdf } = await import('../order-sheet-pdf.js');
      const shop = await must(sb.from('settings').select('shop_name,colors').eq('id', 1).single());
      const subtitle = ['Re-order', d === 'all' ? null : distributorName(d === 'none' ? null : d), state.location ? locationNames.get(Number(state.location)) : null].filter(Boolean).join(' · ');
      const pdf = await buildOrderSheetPdf({ shop, subtitle, today: today(), groups });
      pdf.save(`distributor-reorder-${slug}.pdf`);
      toast(`PDF saved: ${pdf.titles} ${pdf.titles === 1 ? 'title' : 'titles'}, ${pdf.copies} ${pdf.copies === 1 ? 'copy' : 'copies'}`);
    } catch (err) {
      toast(`PDF failed: ${friendlyError(err)}`, 'error');
    }
    btn.disabled = false;
  });

  // Sorting reorders rows, which would strand an open customer row: close them first.
  box.addEventListener('click', (e) => { if (e.target.closest('th[data-sort]')) $$('tr.toorder__people', box).forEach((r) => { r.previousElementSibling?.querySelector('[data-customers]')?.setAttribute('aria-expanded', 'false'); r.remove(); }); }, true);
  box.addEventListener('click', async (e) => {
    const cust = e.target.closest('[data-customers]');
    if (cust) return void toggleCustomers(cust);
    const btn = e.target.closest('[data-ro-ordered], [data-ro-remove], [data-ro-received]');
    if (!btn) return;
    btn.disabled = true;
    try {
      if (btn.matches('[data-ro-received]')) {
        const r = ordered.get(Number(btn.dataset.roReceived));
        if (!confirm(`Mark ${ordinal(r.shelf, 'shelf copy', 'shelf copies')} of ${itemName(r.item)} as in the shop?`)) return;
        await must(sb.from('stock_reorders').update({ status: 'received', received_at: new Date().toISOString() }).in('id', r.stockIds).eq('status', 'ordered'));
        toast(`${itemName(r.item)}: shelf copies in`);
        return void drawList();
      }
      // Read the database again so the change covers the latest re-orders, not what this page loaded earlier.
      open = await loadReorders('open');
      const rows = btn.matches('[data-ro-remove]') ? [open.get(Number(btn.dataset.roRemove))].filter(Boolean) : reorderRows(open, dist());
      if (!rows.length) {
        toast('Nothing is waiting to be re-ordered there any more.', 'error');
        return void drawList();
      }
      const lineIds = rows.flatMap((r) => r.lineIds);
      const stockIds = rows.flatMap((r) => r.stockIds);
      const copies = rows.reduce((n, r) => n + r.copies, 0);
      if (btn.matches('[data-ro-remove]')) {
        const r = rows[0];
        if (!confirm(`Take ${itemName(r.item)} off the re-order list?${r.shelf ? `\n\n${ordinal(r.shelf, 'shelf copy is', 'shelf copies are')} cancelled.` : ''}${lineIds.length ? `\n\n${ordinal(lineIds.length, 'customer re-order', 'customer re-orders')} will show "Not ordered" on their pull lists.` : ''}`)) return;
        if (stockIds.length) await must(sb.from('stock_reorders').update({ status: 'cancelled' }).in('id', stockIds).eq('status', 'open'));
        if (lineIds.length) await updateLines(lineIds, 'not_ordered', ['open']);
        toast(`${itemName(r.item)}: not re-ordering`);
      } else {
        const d = dist();
        if (!confirm(`Mark ${ordinal(rows.length, 'title', 'titles')} (${ordinal(copies, 'copy', 'copies')}) as re-ordered from ${d === 'all' ? 'the distributor' : distributorName(d === 'none' ? null : d)}?`)) return;
        if (stockIds.length) await must(sb.from('stock_reorders').update({ status: 'ordered', ordered_at: new Date().toISOString() }).in('id', stockIds).eq('status', 'open'));
        if (lineIds.length) await updateLines(lineIds, 'ordered', ['open']);
        toast(`${ordinal(copies, 'copy', 'copies')} marked ordered`);
      }
      drawList();
    } catch (err) {
      toast(`Not saved: ${friendlyError(err)}`, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  drawList();
}
