// Customers & pull lists: find a customer (in the store or on the phone), edit their
// profile (including the shipping address for phone-pay customers) and their pull list.
// Quantity and status changes are plain updates (staff have full access to reservations);
// adding titles goes through staff_pull_list_add(), which can also add past the cutoff.
// Every change is recorded in pull_list_log and shown under "Recent changes".

import { $, $$, esc, must, toast, fmtDate, fmtDateTime, itemName, downloadCsv, sortableTable, debounce, customerFilter, titleFilter, formatPhone, solidIcon, findGuestMatches, friendlyError, fromError, anyOf, emailMatch, digitsMatch, loadSentMessages, mountEmailForm } from '../lib.js';
import { cutoffPassed } from '../../js/site.js';
import { LINE_STATUS, LINE_STATUS_SHORT } from '../../js/labels.js';
import { whenIn, todayIn, stampIn, holdUntil as holdDate } from '../../js/dates.js';

const SOURCE = { manual: 'Customer', variant: 'Customer (all covers)', series: 'Series follow', artist: 'Artist follow', staff: 'Staff' };
const ITEM_FIELDS = 'id,title,issue_number,variant,publisher,price,series_key,foc_date,release_date,status';
const PAGE = 25;
let sb;
let settings;
let state = { q: '', show: '', sort: 'name', dir: 'asc', offset: 0, customerId: null, showCancelled: false };

// What the Pull List panel is showing right now, so its Export button matches the screen.
let shownLines = [];
// When the pull list last changed and by whom (across every line, cancelled ones included).
let lastUpdate = null;

// Status icons for the list: only problems get an icon, so a clean row is blank. All are solid shapes (holes are cut out of the
// path with even-odd fill). Red = needs action, amber = minor. [markup, label, extra class, short label for the legend]
const ICON = {
  overdue: ['<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM11 6h2v5.1l3.3 1.9-1 1.7L11 12.2z"/>', 'Past pickup window', '', 'Past pickup'],
  noAddress: ['<path d="M3 11.5 12 3l9 8.5V21H3zM10.9 10h2.2v5.6h-2.2zM12 17.2a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6z"/>', 'Ships arrivals but has no address', '', 'No address'],
  noEmail: ['<path d="M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM4 5.4 12 11l8-5.6v2L12 13 4 7.4z"/>', 'No email address', '', 'No email'],
  emailOff: ['<path d="M7.5 2h2v3h-2zM14.5 2h2v3h-2zM5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM5 9.5h14V11H5z"/>', 'Weekly email off', '', 'Weekly email off'],
  arrivalsOff: ['<path d="M12 3a6 6 0 0 0-6 6v5l-1.5 2.5h15L18 14V9a6 6 0 0 0-6-6zM9.5 18.5h5a2.5 2.5 0 0 1-5 0z"/>', 'Arrival emails off', '', 'Arrival email off'],
  noName: ['<path d="M12 3a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM3 21c0-4.4 4-7 9-7s9 2.6 9 7z"/><path d="M9.5 5.5h5v1.6h-5z" style="fill:#fff"/>', 'No name saved', '', 'No name'],
  noPhone: ['<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>', 'No phone number', '', 'No phone'],
  noLogin: ['<path d="M9 4.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM2 21c0-4 3-6.5 7-6.5s7 2.5 7 6.5z"/><path d="m17.5 6.5 4 4m0-4-4 4" style="fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round"/>', 'No login (no online account)', ' is-minor', 'No login'],
};
/** Fix button for rows with an action-needed (red) icon; opens the customer to correct it. Minor issues (no login) don't get one. */
const needsFix = (c) => statusKeys(c).some((k) => !ICON[k][2].includes('is-minor'));
const iconHtml = (k) =>
  `<span class="cust-icon is-solid ${ICON[k][2].includes('is-minor') ? '' : 'is-alert'}${ICON[k][2]}" role="img" aria-label="${ICON[k][1]}" title="${ICON[k][1]}"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k][0]}</svg></span>`;
const statusKeys = (c) =>
  [
    c.overdue_count > 0 && 'overdue',
    c.ship_arrivals && !c.address1?.trim() && 'noAddress',
    !c.email ? 'noEmail' : !c.email_opt_in && 'emailOff',
    c.email && c.notify_arrivals === false && 'arrivalsOff',
    !c.first_name?.trim() && !c.last_name?.trim() && 'noName',
    !c.phone && 'noPhone',
    !c.user_id && 'noLogin',
  ].filter(Boolean);
const statusIcons = (c) => statusKeys(c).map(iconHtml).join('');
/** Key to the Status column, one entry per icon. The icons here are decorative; the text carries the meaning. */
const iconLegend = () =>
  `<ul class="cust-legend" aria-label="Status icon key">${Object.keys(ICON)
    .map((k) => `<li><span class="cust-icon is-solid ${ICON[k][2].includes('is-minor') ? '' : 'is-alert'}${ICON[k][2]}" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[k][0]}</svg></span>${ICON[k][3]}</li>`)
    .join('')}</ul>`;

const whenLabel = (iso) => whenIn(iso, settings.timezone);
const shortDate = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: settings.timezone || undefined });

/** "Jane Smith (customer)", "Test Staff (staff)", "Guest checkout", "Automatic", or '' when unknown. */
const whoLabel = (l, c, staffNames) =>
  ({
    staff: `${staffNames.get(l.updated_by) ?? 'Staff'} (staff)`,
    customer: `${c.name || c.email || 'Customer'} (customer)`,
    guest: 'Guest checkout',
    system: 'Automatic',
  })[l.updated_via] ?? '';

const ITEM_HEADER = ['Title', 'Issue', 'Variant', 'Publisher', 'Qty', 'Price', 'Line total', 'FOC', 'Release', 'Status', 'Added by', 'Arrived', 'Hold until', 'Added'];
const CSV_HEADER = ['Customer', 'Phone', 'Email', 'Address', 'City', 'State', 'Zip', 'Ships', ...ITEM_HEADER];

const shopToday = () => todayIn(settings.timezone);
const stamp = () => stampIn(settings.timezone);
const holdUntil = (l) => holdDate(l.arrived_on, settings.hold_days ?? 30);
const fullName = (c) => [c.last_name, c.first_name].filter(Boolean).join(', ');

/** The title columns of a pull-list line (everything after the customer details). */
const itemCells = (l) => [
  l.item?.title, l.item?.issue_number, l.item?.variant, l.item?.publisher, l.quantity, l.item?.price,
  l.item?.price != null ? (l.item.price * l.quantity).toFixed(2) : '', l.item?.foc_date, l.item?.release_date,
  LINE_STATUS_SHORT[l.status] ?? l.status, SOURCE[l.source] ?? l.source, l.arrived_on, holdUntil(l), l.created_at?.slice(0, 10),
];
/** Batch export: one row per line, with the customer's details repeated so the file stands alone. */
const csvRow = (c, l) => [fullName(c), formatPhone(c.phone), c.email, c.address1, c.city, c.state, c.zip, c.ship_arrivals ? 'Yes' : '', ...itemCells(l)];
const byRelease = (a, b) => (a.item?.release_date ?? '9').localeCompare(b.item?.release_date ?? '9') || itemName(a.item ?? {}).localeCompare(itemName(b.item ?? {}));
const fileSlug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'customer';

export async function mount(el, ctx) {
  sb = ctx.sb;
  settings = await must(sb.from('settings').select('max_copies_per_title,hold_days,timezone,shop_name,colors,phone,logo_url,discount_enabled,discount_tiers').eq('id', 1).single());
  // "View customer" on the Reservations page hands over which customer to open.
  let handedOff = false;
  try {
    // The Dashboard's Needs Attention links open the list already filtered.
    const show = sessionStorage.getItem('admin-customers-show');
    if (show) {
      handedOff = true;
      sessionStorage.removeItem('admin-customers-show');
      state = { ...state, q: '', show, offset: 0, customerId: null };
    }
    const wanted = sessionStorage.getItem('admin-open-customer');
    if (wanted) {
      sessionStorage.removeItem('admin-open-customer');
      state.customerId = Number(wanted);
    }
  } catch {
    /* ignore */
  }
  try {
    if (!handedOff) state.show = sessionStorage.getItem('admin-customers-tab') ?? state.show;
    else sessionStorage.setItem('admin-customers-tab', state.show);
  } catch {
    /* start on All customers */
  }
  if (['no_email', 'link_guests'].includes(state.show)) state.show = 'to_fix'; // the two old tabs, from a link or a remembered choice
  state.customerId ? renderCustomer(el) : renderList(el);
}

/** "Smith, Jane" for the list (sorted by last name); just the first name when there's no last name. */
const listName = (c) => [c.last_name, c.first_name].filter(Boolean).join(', ') || c.email || '(no name)';

// ---------------------------------------------------------------------------
// Customer list
// ---------------------------------------------------------------------------

function renderList(el) {
  state.customerId = null;
  el.innerHTML = `
    <div class="admin-title-row">
      <h1>Customers</h1>
      <div class="admin-actions cust-head-actions">
        <label class="cust-export-opt" title="Also export picked-up, released and cancelled titles"><input type="checkbox" data-export-history> Include past titles</label>
        <button class="btn btn--ghost" type="button" data-export-all>Export all pull lists (CSV)</button>
        <button class="btn btn--ghost" type="button" data-export-customers title="One page per customer, to print and put in their bag">Print all pull lists (PDF)</button>
        <button class="btn btn--primary" type="button" data-new>+ New customer</button>
      </div>
    </div>
    <p class="admin-hint">Customers who made an account on the site, and ones you add here. Open one to edit their pull list while they're in the store or on the phone.</p>
    <div class="admin-tabs" role="tablist">
      <button type="button" class="admin-tab" role="tab" data-show="">All Customers</button>
      <button type="button" class="admin-tab" role="tab" data-show="new_week">New This Week <span class="admin-tab__badge" data-new-count hidden></span></button>
      <button type="button" class="admin-tab" role="tab" data-show="to_fix">Needs Attention</button>
    </div>
    <form class="filters admin-filters" role="search" aria-label="Find customers">
      <div class="field field--search"><label for="c-q">Customer</label><input id="c-q" name="q" type="search" placeholder="Name, phone or email" value="${esc(state.q)}"></div>
    </form>
    <p class="results-count" role="status" data-count></p>
    ${iconLegend()}
    <div class="admin-table-wrap"><table class="admin-table">
      <thead><tr><th scope="col" class="col-cust-name" data-sort="name">Name</th><th scope="col" data-sort="phone">Phone</th><th scope="col" data-sort="email">Email</th><th scope="col" class="center" data-sort="ready">Ready</th><th scope="col" class="center" data-sort="active">Active</th><th scope="col" data-sort="updated">Last updated</th><th scope="col" data-sort="notes">Status</th></tr></thead>
      <tbody data-rows></tbody>
    </table></div>
    <div class="admin-pager"><button class="btn btn--ghost" type="button" data-prev>← Previous</button><span data-page></span><button class="btn btn--ghost" type="button" data-next>Next →</button></div>`;
  const form = $('form', el);
  const markShowTab = () => $$('[data-show]', el).forEach((b) => b.setAttribute('aria-selected', b.dataset.show === state.show));
  markShowTab();
  $$('[data-show]', el).forEach((b) =>
    b.addEventListener('click', () => {
      state.show = b.dataset.show;
      state.offset = 0;
      try {
        sessionStorage.setItem('admin-customers-tab', state.show);
      } catch {
        /* remembering the tab is optional */
      }
      markShowTab();
      loadList(el);
    }),
  );
  let timer;
  form.addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.q = form.elements.q.value;
      state.offset = 0;
      loadList(el);
    }, e.target.type === 'search' ? 300 : 0);
  });
  form.addEventListener('submit', (e) => e.preventDefault());
  sortableTable($('table', el), { sort: state.sort, dir: state.dir, onSort: (sort, dir) => ((state = { ...state, sort, dir, offset: 0 }), loadList(el)) });
  $('[data-prev]', el).addEventListener('click', () => ((state.offset = Math.max(0, state.offset - PAGE)), loadList(el)));
  $('[data-next]', el).addEventListener('click', () => ((state.offset += PAGE), loadList(el)));
  $('[data-export-all]', el).addEventListener('click', (e) => exportAll(e.currentTarget, $('[data-export-history]', el).checked));
  $('[data-export-customers]', el).addEventListener('click', (e) => exportCustomersPdf(e.currentTarget));
  $('[data-new]', el).addEventListener('click', () => {
    state.customerId = 'new';
    renderCustomer(el);
  });
  $('[data-rows]', el).addEventListener('click', (e) => {
    if (e.target.closest('[data-email-to]')) return; // the email link opens the compose box
    const row = e.target.closest('[data-open]');
    if (!row) return;
    e.preventDefault();
    state.customerId = Number(row.dataset.open);
    renderCustomer(el);
  });
  // How many customers signed up in the last 7 days, shown on the tab.
  sb.from('customer_list').select('id', { count: 'exact', head: true }).not('user_id', 'is', null).gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString())
    .then(({ count }) => {
      const badge = $('[data-new-count]', el);
      if (badge && count) (badge.textContent = count), (badge.hidden = false);
    });
  loadList(el);
}

async function loadList(el) {
  let q = sb.from('customer_list').select('id,first_name,last_name,name,email,phone,address1,user_id,ship_arrivals,email_opt_in,notify_arrivals,overdue_count,ready_count,active_count,last_updated,notes_text', { count: 'exact' });
  const match = customerFilter(state.q, { words: true }); // "Smith Jane" finds Jane Smith too
  if (match) q = q.or(match);
  if (state.show === 'to_fix') {
    // No name or email address saved, or earlier guest orders that match them and aren't linked yet.
    const ids = [...new Set((await findGuestMatches(sb)).map((m) => m.customer_id))];
    const missing = 'email.is.null,first_name.is.null,first_name.eq.,last_name.is.null,last_name.eq.';
    q = q.or(ids.length ? `${missing},id.in.(${ids.join(',')})` : missing);
  }
  if (state.show === 'new_week') q = q.not('user_id', 'is', null).gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString());
  const asc = state.dir === 'asc';
  q =
    state.sort === 'email' ? q.order('email', { ascending: asc, nullsFirst: false })
    : state.sort === 'phone' ? q.order('phone_digits', { ascending: asc, nullsFirst: false })
    : state.sort === 'ready' ? q.order('ready_count', { ascending: asc })
    : state.sort === 'active' ? q.order('active_count', { ascending: asc })
    : state.sort === 'updated' ? q.order('last_updated', { ascending: asc, nullsFirst: false })
    : state.sort === 'notes' ? q.order('notes_text', { ascending: asc })
    : q.order('last_name', { ascending: asc, nullsFirst: false }).order('first_name', { ascending: asc, nullsFirst: false });
  const { data, count, error } = await q.order('id').range(state.offset, state.offset + PAGE - 1);
  const body = $('[data-rows]', el);
  if (error) return void (body.innerHTML = `<tr><td colspan="7" class="form-error">${esc(friendlyError(error))}</td></tr>`);
  $('[data-count]', el).textContent = `${count} ${count === 1 ? 'customer' : 'customers'}`;
  $('[data-page]', el).textContent = count ? `${state.offset + 1}–${Math.min(state.offset + PAGE, count)} of ${count}` : '';
  $('[data-prev]', el).disabled = state.offset === 0;
  $('[data-next]', el).disabled = state.offset + PAGE >= count;
  body.innerHTML = data.length
    ? data
        .map((c) => {
          return `<tr class="is-clickable" data-open="${c.id}">
            <td><a href="#customers" data-open="${c.id}"><strong>${esc(listName(c))}</strong></a></td>
            <td class="nowrap">${esc(formatPhone(c.phone))}</td>
            <td>${c.email ? `<button type="button" class="btn btn--ghost btn--small cust-email" title="Write an email to ${esc(c.email)}" aria-label="Email ${esc(c.name || c.email)}" data-email-to="${esc(c.email)}" data-email-name="${esc(c.first_name || c.name || '')}" data-email-customer="${c.id}">Email</button>` : ''}</td>
            <td class="center">${c.ready_count ? `<span class="dash-pill dash-pill--arrived">${c.ready_count}</span>` : '<span class="card__meta">–</span>'}</td>
            <td class="center">${c.active_count || '<span class="card__meta">–</span>'}</td>
            <td class="card__meta nowrap">${c.last_updated ? esc(shortDate(c.last_updated)) : ''}</td>
            <td class="nowrap"><span class="cust-status"><span class="cust-icons">${statusIcons(c)}</span>${needsFix(c) ? `<a class="btn btn--primary btn--small" href="#customers" data-open="${c.id}" aria-label="Fix ${esc(listName(c))}">${solidIcon('fix', 16)} Fix</a>` : ''}</span></td></tr>`;
        })
        .join('')
    : `<tr><td colspan="7" class="empty">${state.q ? 'No customers match.' : 'No customers yet.'}</td></tr>`;
}

// ---------------------------------------------------------------------------
// One customer
// ---------------------------------------------------------------------------

async function loadNotes(el, c) {
  const form = $('[data-notes]', el);
  const area = form.elements.notes;
  const meta = $('[data-notes-meta]', form);
  const err = $('[data-notes-error]', form);
  const row = await must(sb.from('customer_notes').select('notes,updated_at,updated_by').eq('customer_id', c.id).maybeSingle());
  area.value = row?.notes ?? '';
  area.disabled = false;
  form.querySelector('button').disabled = false;
  const stamp = async (r) => {
    if (!r) return (meta.textContent = '');
    const who = r.updated_by ? (await sb.from('staff').select('name').eq('user_id', r.updated_by).maybeSingle()).data?.name : null;
    meta.textContent = `Last saved ${whenLabel(r.updated_at)}${who ? ` by ${who}` : ''}`;
  };
  stamp(row);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    const { error } = await sb.rpc('staff_save_customer_notes', { p_customer: c.id, p_notes: area.value });
    if (error) return void (err.textContent = friendlyError(error));
    toast('Notes saved');
    const saved = await must(sb.from('customer_notes').select('notes,updated_at,updated_by').eq('customer_id', c.id).maybeSingle());
    area.value = saved?.notes ?? '';
    stamp(saved);
  });
}

async function renderCustomer(el) {
  const isNew = state.customerId === 'new';
  const customer = isNew ? null : await must(sb.from('customers').select('*').eq('id', state.customerId).maybeSingle());
  if (!isNew && !customer) {
    toast('That customer no longer exists.', 'error');
    return renderList(el);
  }
  const c = customer ?? { first_name: '', last_name: '', name: '', email: '', phone: '', address1: '', city: '', state: '', zip: '', ship_arrivals: false, email_opt_in: true, notify_arrivals: true };
  const field = (id, label, value, attrs = '') => `<div class="field"><label for="cu-${id}">${label}</label><input id="cu-${id}" name="${id}" value="${esc(value)}" ${attrs}></div>`;
  el.innerHTML = `
    <p><a href="#customers" data-back>← All customers</a></p>
    <div class="admin-title-row"><h1>${isNew ? 'New Customer' : esc(c.name || c.email || '(no name)')}</h1>${isNew ? '' : `<div class="cust-contact">${c.phone ? `<a class="cust-contact__phone" href="tel:${esc(c.phone.replace(/[^\d+]/g, ''))}">${esc(formatPhone(c.phone))}</a>` : ''}${c.email ? `<a class="btn btn--ghost btn--small" href="mailto:${esc(c.email)}" data-email-to="${esc(c.email)}" data-email-name="${esc(c.first_name || c.name || '')}" data-email-customer="${c.id}">Email customer</a>` : ''}</div>`}</div>
    ${isNew ? '' : `<div class="admin-tabs" role="tablist">
      <button type="button" class="admin-tab" role="tab" data-ctab="pull">Pull List</button>
      <button type="button" class="admin-tab" role="tab" data-ctab="profile">Profile</button>
      <button type="button" class="admin-tab" role="tab" data-ctab="messages">Messages</button>
      <button type="button" class="admin-tab" role="tab" data-ctab="changes">Changes</button>
    </div>`}
    <div class="cust-grid${isNew ? ' cust-grid--new' : ''}">
      <div class="cust-main">
        <div data-pane="profile">
        <details class="fold toorder fold--static cust-profile" data-profile-panel open>
          <summary class="fold__head"><h2 id="cu-profile">Profile</h2>${isNew ? '' : `<span class="card__meta cust-profile__sum">${esc([c.email, formatPhone(c.phone), [c.city, c.state].filter(Boolean).join(', ')].filter(Boolean).join(' · '))}</span>`}</summary>
        <div class="fold__body"><form data-profile novalidate>
          <div class="cust-fields">
          ${field('first_name', 'First name <span class="req" aria-hidden="true">*</span>', c.first_name, 'maxlength="80" required autocomplete="off"')}
          ${field('last_name', 'Last name <span class="req" aria-hidden="true">*</span>', c.last_name, 'maxlength="80" required autocomplete="off"')}
          ${field('email', 'Email <span class="req" aria-hidden="true">*</span>', c.email, `type="email" maxlength="254" required autocomplete="off"${c.user_id ? ' readonly' : ''}`)}
          ${field('phone', 'Phone <span class="req" aria-hidden="true">*</span>', c.phone, 'type="tel" maxlength="40" required autocomplete="off"')}
          <p class="field__hint span-all">${c.user_id ? 'This customer has an account, so the email can’t be changed here. <span class="req">*</span> = required.' : 'The email lets them log in and get the weekly email. <span class="req">*</span> = required.'}</p>
          ${field('address1', 'Address', c.address1, 'maxlength="200" autocomplete="off"').replace('class="field"', 'class="field span-all"')}
          ${field('city', 'City', c.city, 'maxlength="100" autocomplete="off"')}
          <div class="cust-row">${field('state', 'State', c.state, 'maxlength="50" autocomplete="off"')}${field('zip', 'Zip code', c.zip, 'maxlength="20" autocomplete="off"')}</div>
          </div>
          <div class="field field--check"><input id="cu-ship" name="ship_arrivals" type="checkbox"${c.ship_arrivals ? ' checked' : ''}><label for="cu-ship">Ship this customer’s arrivals (pays by phone)</label></div>
          <div class="field field--check"><input id="cu-optin" name="email_opt_in" type="checkbox"${c.email_opt_in ? ' checked' : ''}><label for="cu-optin">Send the weekly pull list email</label></div>
          <div class="field field--check"><input id="cu-arrivals" name="notify_arrivals" type="checkbox"${c.notify_arrivals !== false ? ' checked' : ''}><label for="cu-arrivals">Email when their books are ready for pickup</label></div>
          <p class="form-error" role="alert" data-error></p>
          <button class="btn btn--primary" type="submit">${isNew ? 'Create customer' : 'Save profile'}</button>
          ${isNew ? '' : `<button class="btn btn--danger" type="button" data-delete>${solidIcon('trash', 16)} Delete customer…</button>`}
        </form></div>
        </details>
      ${isNew ? '</div>' : `
        <details class="fold toorder fold--static" open>
          <summary class="fold__head"><h2 id="cu-notes">Notes<span class="toorder__count">Private to staff. Customers never see these.</span></h2></summary>
          <div class="fold__body"><form data-notes>
            <div class="field"><label class="visually-hidden" for="cu-notes-text">Notes about ${esc(c.name || 'this customer')}</label>
              <textarea id="cu-notes-text" name="notes" rows="4" maxlength="5000" placeholder="Pickup preferences, who else can collect, anything worth remembering" disabled></textarea></div>
            <p class="form-error" role="alert" data-notes-error></p>
            <button class="btn btn--primary btn--small" type="submit" disabled>Save notes</button>
            <span class="card__meta" data-notes-meta></span>
          </form></div>
        </details>
        </div>
        <div data-pane="pull">
        <details class="fold toorder fold--static" open>
          <summary class="fold__head"><h2 id="cu-list">Pull List<span class="toorder__count" data-list-count></span></h2>
            <label class="cust-toggle"><input type="checkbox" data-cancelled${state.showCancelled ? ' checked' : ''}> Show cancelled</label>
            <button class="btn btn--small" type="button" data-export-pdf>Export PDF</button>
          </summary>
          <div class="fold__body">
          <p class="card__meta cust-lastupdate" data-lastupdate></p>
          <div data-orders aria-busy="true"></div>
          </div>
        </details>
        <details class="fold toorder fold--static" open>
          <summary class="fold__head"><h2 id="cu-add">Add to Pull List</h2></summary>
          <div class="fold__body">
          <form class="cust-search" data-search role="search"><label class="visually-hidden" for="cu-q">Find a pre-order title</label>
            <input id="cu-q" type="search" placeholder="Search pre-order titles, covers or creators" autocomplete="off"></form>
          <p class="admin-hint">Adding past an order cutoff or the copy limit is allowed here; you'll be told if the cutoff has passed.</p>
          <div data-results></div>
          </div>
        </details>
        <details class="fold toorder fold--static" open>
          <summary class="fold__head"><h2 id="cu-follow">Follows<span class="toorder__count" data-follow-count>New issues from these are added to the pull list automatically.</span></h2></summary>
          <div class="fold__body">
          <p class="admin-hint">Following fills in the open pre-orders right away.</p>
          <form class="cust-search" data-follow-search role="search">
            <div class="cust-follow-row">
              <label class="visually-hidden" for="cf-q">Series or artist name</label>
              <input id="cf-q" type="search" placeholder="Search series or artist" autocomplete="off">
            </div>
          </form>
          <div data-follow-results></div>
          <div data-follows></div>
          </div>
        </details>
        </div>
        <div data-pane="messages">
        <details class="fold toorder fold--static" open>
          <summary class="fold__head"><h2>Email Customer</h2><span class="toorder__count">${c.email ? esc(c.email) : 'No email address saved'}</span></summary>
          <div class="fold__body" data-compose>${c.email ? '' : '<p class="admin-hint">Add an email address on the Profile tab to email this customer.</p>'}</div>
        </details>
        <details class="fold toorder fold--static cust-profile cust-log" open>
          <summary class="fold__head"><h2 id="cu-messages">Messages Sent</h2><span class="card__meta cust-profile__sum" data-messages-sum></span></summary>
          <div class="fold__body" data-messages></div>
        </details>
        </div>
        <div data-pane="changes">
        <details class="fold toorder fold--static cust-profile cust-log" open>
          <summary class="fold__head"><h2 id="cu-log">Recent Changes</h2><span class="card__meta cust-profile__sum" data-log-sum></span></summary>
          <div class="fold__body" data-log></div>
        </details>
        </div>
      `}
      </div>
    </div>`;

  // The panels inside a tab are always open: clicking a header does nothing.
  $$('.fold--static > summary', el).forEach((sm) => sm.addEventListener('click', (e) => e.target.closest('button, input, label, a, select') || e.preventDefault()));
  const showTab = (tab) => {
    $$('[data-ctab]', el).forEach((b) => b.setAttribute('aria-selected', b.dataset.ctab === tab));
    $$('[data-pane]', el).forEach((p) => (p.hidden = !isNew && p.dataset.pane !== tab));
  };
  let tab = 'pull';
  try {
    tab = sessionStorage.getItem('admin-customer-tab') || tab;
  } catch {
    /* start on Pull List */
  }
  showTab(['pull', 'profile', 'messages', 'changes'].includes(tab) ? tab : 'pull');
  $$('[data-ctab]', el).forEach((b) =>
    b.addEventListener('click', () => {
      showTab(b.dataset.ctab);
      try {
        sessionStorage.setItem('admin-customer-tab', b.dataset.ctab);
      } catch {
        /* remembering the tab is optional */
      }
    }),
  );
  $('[data-back]', el).addEventListener('click', (e) => {
    e.preventDefault();
    renderList(el);
  });
  const form = $('[data-profile]', el);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('[data-error]', el);
    err.textContent = '';
    const v = Object.fromEntries(new FormData(form));
    // First name, last name, email and phone are all required.
    const missing = [['first_name', 'first name'], ['last_name', 'last name'], ['email', 'email address'], ['phone', 'phone number']].find(([k]) => !String(v[k] ?? '').trim());
    if (missing) {
      err.textContent = `Please enter the customer’s ${missing[1]}.`;
      return void form.elements[missing[0]].focus();
    }
    const payload = { ...v, ship_arrivals: form.elements.ship_arrivals.checked, email_opt_in: form.elements.email_opt_in.checked, notify_arrivals: form.elements.notify_arrivals.checked };
    const { data: id, error } = await sb.rpc('staff_save_customer', { p_id: isNew ? null : c.id, p: payload });
    if (error) return void (err.textContent = friendlyError(error));
    toast(isNew ? 'Customer created' : 'Profile saved');
    state.customerId = id;
    renderCustomer(el);
  });
  if (isNew) return;

  $('[data-delete]', el).addEventListener('click', async () => {
    const who = c.name || c.email || 'this customer';
    if (!confirm(`Permanently delete ${who}?\n\nThis removes their profile, pull list, orders, follows, notes and login. It can't be undone.`)) return;
    const err = $('[data-error]', el);
    err.textContent = '';
    const { error } = await sb.rpc('staff_delete_customer', { p_id: c.id });
    if (error) return void (err.textContent = friendlyError(error));
    toast('Customer deleted');
    renderList(el);
  });

  loadNotes(el, c);
  loadMessages(el, c);
  $('[data-search]', el).addEventListener('input', debounce((e) => searchTitles(el, c, e.target.value), 300));
  $('[data-search]', el).addEventListener('submit', (e) => e.preventDefault());
  $('[data-results]', el).addEventListener('click', (e) => addFromResult(el, c, e));
  $('[data-export-pdf]', el).addEventListener('click', (e) => exportCustomerPdf(e.currentTarget, c));
  $('[data-cancelled]', el).addEventListener('change', (e) => {
    state.showCancelled = e.target.checked;
    loadOrders(el, c);
  });
  if (c.email) mountEmailForm($('[data-compose]', el), { to: c.email, name: c.first_name || c.name, customerId: c.id });
  loadOrders(el, c);
  loadLog(el, c);
  setupFollows(el, c);
}

async function log(customerId, reservationId, action, detail) {
  const { error } = await sb.from('pull_list_log').insert({ customer_id: customerId, reservation_id: reservationId, action, detail });
  if (error) console.error('Could not write pull list log', error);
}

// ---------------------------------------------------------------------------
// Pull list: lines, edits, unlinked guest orders
// ---------------------------------------------------------------------------

async function loadOrders(el, c) {
  const box = $('[data-orders]', el);
  box.setAttribute('aria-busy', 'true');
  try {
    const lines = await must(
      sb.from('reservations')
        .select(`id,quantity,status,source,arrived_on,created_at,updated_at,updated_by,updated_via,item:items(${ITEM_FIELDS}),order:reservation_orders!inner(customer_id)`)
        .eq('order.customer_id', c.id)
        .order('created_at', { ascending: false })
        .limit(500),
    );
    const unlinked = await findUnlinked(c);
    const staffNames = new Map((await must(sb.from('staff').select('user_id,name'))).map((m) => [m.user_id, m.name]));
    const latest = lines.reduce((a, l) => (!a || l.updated_at > a.updated_at ? l : a), null);
    lastUpdate = latest ? { at: latest.updated_at, who: whoLabel(latest, c, staffNames) } : null;
    const lastEl = $('[data-lastupdate]', el);
    if (lastEl) lastEl.textContent = lastUpdate ? `Last updated ${whenLabel(lastUpdate.at)}${lastUpdate.who ? ` by ${lastUpdate.who}` : ''}` : '';
    const shown = lines.filter((l) => state.showCancelled || l.status !== 'cancelled')
      .sort((a, b) => (a.item?.release_date ?? '9999').localeCompare(b.item?.release_date ?? '9999') || itemName(a.item).localeCompare(itemName(b.item)));
    shownLines = shown;
    const countEl = $('[data-list-count]', el);
    if (countEl) countEl.textContent = `${shown.length} ${shown.length === 1 ? 'title' : 'titles'}`;
    box.innerHTML = `
      ${unlinked.length ? `<p class="notice cust-link">${unlinked.length} earlier guest ${unlinked.length === 1 ? 'order matches' : 'orders match'} this customer’s phone or email but ${unlinked.length === 1 ? 'isn’t' : 'aren’t'} linked yet.
        <button class="btn btn--primary btn--small" type="button" data-link>Link ${unlinked.length === 1 ? 'it' : 'them'}</button></p>` : ''}
      ${shown.length ? summaryChips(shown) : ''}
      ${shown.length ? `<div class="admin-table-wrap"><table class="admin-table cust-lines">
        <thead><tr><th scope="col">Title</th><th scope="col" class="cl-out">Out</th><th scope="col" class="cl-qty">Qty</th><th scope="col" class="cl-status">Status</th><th scope="col" class="cl-by">Added by</th><th scope="col" class="cl-rm"><span class="visually-hidden">Remove</span></th></tr></thead>
        <tbody>${groupedRows(shown, c, staffNames)}</tbody></table></div>` : '<p class="empty">Nothing on this customer’s pull list yet.</p>'}`;
    box.onchange = (e) => editLine(el, c, lines, e);
    box.onclick = async (e) => {
      const rm = e.target.closest('[data-remove]');
      if (rm) return editLine(el, c, lines, { target: rm, remove: true });
      if (e.target.closest('[data-link]')) {
        try {
          await must(sb.from('reservation_orders').update({ customer_id: c.id }).in('id', unlinked.map((o) => o.id)));
          await log(c.id, null, 'linked', `${unlinked.length} guest order${unlinked.length === 1 ? '' : 's'} linked`);
          toast('Linked');
          loadOrders(el, c);
          loadLog(el, c);
        } catch (err) {
          toast(`Not linked: ${friendlyError(err)}`, 'error');
        }
      }
    };
  } catch (err) {
    box.innerHTML = `<p class="form-error">${esc(friendlyError(err))}</p>`;
  }
  box.removeAttribute('aria-busy');
}

const ACTIVE_STATUSES = ['open', 'ordered', 'reordered', 'arrived'];

/** Open titles a series/artist follow added in the last week (the hourly sweep, or when the follow was made). */
const autoAddedRecently = (l) => ['series', 'artist'].includes(l.source) && l.status === 'open' && Date.now() - new Date(l.created_at) < 7 * 864e5;

/** "1 ready for pickup · 3 open · 1 ordered · 2 past": the state of the list at a glance. */
function summaryChips(lines) {
  const n = (fn) => lines.filter(fn).length;
  const chip = (count, label, cls) => (count ? `<span class="dash-pill dash-pill--${cls}">${count} ${label}</span>` : '');
  const copies = lines.filter((l) => ACTIVE_STATUSES.includes(l.status)).reduce((sum, l) => sum + l.quantity, 0);
  const chips = [
    chip(n((l) => l.status === 'arrived'), 'ready for pickup', 'arrived'),
    chip(n((l) => l.status === 'open'), 'open', 'open'),
    chip(n((l) => l.status === 'ordered'), 'ordered', 'ordered'),
    chip(n((l) => l.status === 'reordered'), 'reordered', 'reordered'),
    chip(n((l) => l.status === 'not_ordered'), 'not ordered', 'not_ordered'),
    chip(n((l) => !ACTIVE_STATUSES.includes(l.status) && l.status !== 'not_ordered'), 'past', 'released'),
    chip(n(autoAddedRecently), 'new from follows this week', 'new'),
  ].join(' ');
  return `<p class="cust-chips">${chips}${copies ? ` <span class="card__meta">${copies} ${copies === 1 ? 'copy' : 'copies'} active</span>` : ''}</p>`;
}

/** Rows grouped as Ready for pickup / Open & ordered / Not ordered / Past, with group headings when more than one group has titles. */
function groupedRows(lines, c, staffNames) {
  const groups = [
    ['Ready for pickup', (l) => l.status === 'arrived'],
    ['Open & ordered', (l) => ['open', 'ordered', 'reordered'].includes(l.status)],
    ['Not ordered', (l) => l.status === 'not_ordered'],
    ['Past', (l) => !ACTIVE_STATUSES.includes(l.status) && l.status !== 'not_ordered'],
  ].map(([title, fn]) => [title, lines.filter(fn)]).filter(([, rows]) => rows.length);
  return groups
    .map(([title, rows]) => `${groups.length > 1 ? `<tr class="cust-lines__group"><th colspan="6" scope="colgroup">${esc(title)} (${rows.length})</th></tr>` : ''}${rows.map((l, i) => lineRow(l, c, staffNames, i % 2 === 1)).join('')}`)
    .join('');
}

function lineRow(l, c, staffNames, alt = false) {
  const closed = cutoffPassed(l.item) && l.status === 'open';
  const tip = `Last updated ${whenLabel(l.updated_at)}${l.updated_via ? ` by ${whoLabel(l, c, staffNames)}` : ''}`;
  const rowClass = [l.status === 'cancelled' && 'is-hidden', alt && 'is-alt'].filter(Boolean).join(' ');
  return `<tr${rowClass ? ` class="${rowClass}"` : ''}${autoAddedRecently(l) ? ' data-auto-new' : ''} title="${esc(tip)}">
    <td class="cl-title">${autoAddedRecently(l) ? `<span class="dash-pill dash-pill--new" title="Added automatically by a follow on ${esc(whenLabel(l.created_at))}">New</span> ` : ''}${esc(l.item ? itemName(l.item) : `Title #${l.item_id}`)}${l.updated_via && l.updated_via !== 'customer' ? `<br><span class="cust-updated">Updated ${esc(whenLabel(l.updated_at))} by ${esc(whoLabel(l, c, staffNames))}</span>` : ''}${closed ? '<br><span class="cust-warn">Order cutoff has passed — the order may already be in</span>' : ''}</td>
    <td class="nowrap cl-out">${fmtDate(l.item?.release_date, { month: 'short', day: 'numeric' })}</td>
    <td class="cl-qty"><label class="visually-hidden" for="cq-${l.id}">Copies of ${esc(l.item?.title ?? '')}</label>
      <input id="cq-${l.id}" class="cust-qty" type="number" inputmode="numeric" min="1" max="100" value="${l.quantity}" data-qty="${l.id}"></td>
    <td class="cl-status"><label class="visually-hidden" for="cs-${l.id}">Status of ${esc(l.item?.title ?? '')}</label>
      <select id="cs-${l.id}" class="select--small" data-status="${l.id}">${Object.entries(LINE_STATUS).map(([v, lbl]) => `<option value="${v}"${v === l.status ? ' selected' : ''}>${lbl}</option>`).join('')}</select></td>
    <td class="card__meta cl-by">${esc(SOURCE[l.source] ?? l.source)}</td>
    <td class="cl-rm">${l.status === 'cancelled' ? '' : `<button class="icon-btn icon-btn--remove" type="button" data-remove="${l.id}" aria-label="Remove ${esc(l.item?.title ?? '')} from pull list" title="Remove from pull list">${solidIcon('remove')}</button>`}</td>
  </tr>`;
}

async function editLine(el, c, lines, e) {
  const t = e.target;
  const id = Number(t.dataset.qty ?? t.dataset.status ?? t.dataset.remove);
  const line = lines.find((l) => l.id === id);
  if (!line) return;
  const name = itemName(line.item);
  try {
    if (t.dataset.qty) {
      const q = Math.min(Math.max(Math.round(Number(t.value)) || 1, 1), 100);
      await must(sb.from('reservations').update({ quantity: q }).eq('id', id));
      await log(c.id, id, 'quantity', `${name}: ${line.quantity} → ${q}`);
      toast(`${name}: ${q} ${q === 1 ? 'copy' : 'copies'}`);
    } else if (t.dataset.status) {
      await must(sb.from('reservations').update({ status: t.value }).eq('id', id));
      await log(c.id, id, 'status', `${name}: ${LINE_STATUS[line.status]} → ${LINE_STATUS[t.value]}`);
      toast(`${name}: ${LINE_STATUS[t.value].toLowerCase()}`);
    } else if (e.remove) {
      const who = c.name || 'this customer';
      const ask = line.status === 'open' ? `Remove ${name} from ${who}'s pull list?` : `${name} is already ${LINE_STATUS[line.status].toLowerCase()}. Remove it from ${who}'s pull list anyway?`;
      if (!confirm(ask)) return;
      await must(sb.from('reservations').update({ status: 'cancelled' }).eq('id', id));
      await log(c.id, id, 'removed', name);
      toast(`Removed ${name}`);
    }
  } catch (err) {
    toast(`Not saved: ${friendlyError(err)}`, 'error');
  }
  loadOrders(el, c);
  loadLog(el, c);
}

/** Guest orders not yet linked to anyone that match this customer's phone or email. */
async function findUnlinked(c) {
  const match = anyOf(emailMatch('email', c.email), digitsMatch('phone_digits', c.phone_digits));
  if (!match) return [];
  return must(sb.from('reservation_orders').select('id').is('customer_id', null).or(match));
}

// ---------------------------------------------------------------------------
// Adding titles
// ---------------------------------------------------------------------------

async function searchTitles(el, c, text) {
  const box = $('[data-results]', el);
  const match = titleFilter(text);
  if (text.trim().length < 2 || !match) return void (box.innerHTML = '');
  // Same matching as the site search ("spiderman 7" finds SPIDER-MAN #7).
  const { data, error } = await sb
    .from('items')
    .select(ITEM_FIELDS)
    .eq('status', 'pre_order').eq('hidden', false)
    .or(match)
    .order('title').order('issue_number').order('variant')
    .limit(30);
  if (error) return void (box.innerHTML = `<p class="form-error">${esc(friendlyError(error))}</p>`);
  box.innerHTML = data.length
    ? `<ul class="cust-results">${data
        .map((i) => `<li>
          <span><strong>${esc(itemName(i))}</strong><br><span class="card__meta">${esc([i.publisher, i.release_date && `Out ${fmtDate(i.release_date, { month: 'short', day: 'numeric' })}`, i.foc_date && `FOC ${fmtDate(i.foc_date, { month: 'short', day: 'numeric' })}`].filter(Boolean).join(' · '))}${cutoffPassed(i) ? ' <span class="cust-warn">cutoff passed</span>' : ''}</span></span>
          <span class="cust-results__act">
            <label class="visually-hidden" for="aq-${i.id}">Copies</label><input id="aq-${i.id}" class="cust-qty" type="number" min="1" max="100" value="1">
            <button class="btn btn--add btn--small" type="button" data-add="${i.id}" aria-label="Add ${esc(itemName(i))} to pull list">${solidIcon('add', 16)} Add</button>
            <button class="btn btn--add btn--small" type="button" data-addall="${i.id}" aria-label="Add every cover of ${esc(itemName(i))}">${solidIcon('addAll', 16)} All covers</button>
          </span></li>`)
        .join('')}</ul>`
    : '<p class="empty">No open pre-order titles match.</p>';
}

async function addFromResult(el, c, e) {
  const btn = e.target.closest('[data-add], [data-addall]');
  if (!btn) return;
  const allCovers = btn.dataset.addall != null;
  const itemId = Number(btn.dataset.add ?? btn.dataset.addall);
  const qty = Math.max(1, Math.round(Number($(`#aq-${itemId}`, el).value)) || 1);
  if (allCovers && !confirm(`Add every open cover of this issue to ${c.name || 'this customer'}'s pull list, ${qty} ${qty === 1 ? 'copy' : 'copies'} each?`)) return;
  btn.disabled = true;
  const { data, error } = await sb.rpc('staff_pull_list_add', { p_customer: c.id, p_item_id: itemId, p_quantity: qty, p_all_covers: allCovers });
  btn.disabled = false;
  if (error) return void toast(friendlyError(error), 'error');
  const { added, skipped, closed } = data;
  toast(`Added ${added} ${added === 1 ? 'title' : 'titles'}${skipped ? ` (${skipped} already on the list)` : ''}${closed ? ` — ${closed} past the order cutoff, check with the distributor order` : ''}`, closed ? 'error' : 'ok');
  loadOrders(el, c);
  loadLog(el, c);
}

let messagesSentHandler = null;
/** Emails staff sent to this customer from the compose box (newest first; click one to read it). */
async function loadMessages(el, c) {
  const box = $('[data-messages]', el);
  const sum = $('[data-messages-sum]', el);
  if (messagesSentHandler) window.removeEventListener('customer-email-sent', messagesSentHandler);
  messagesSentHandler = () => $('[data-messages]', el) && loadMessages(el, c);
  window.addEventListener('customer-email-sent', messagesSentHandler);
  await loadSentMessages(sb, box, sum, { customerId: c.id, email: c.email });
}

async function loadLog(el, c) {
  const box = $('[data-log]', el);
  const sum = $('[data-log-sum]', el);
  try {
    const SHOW = 5;
    const rows = await must(sb.from('pull_list_log').select('action,detail,staff_user,created_at').eq('customer_id', c.id).order('created_at', { ascending: false }).limit(SHOW));
    if (!rows.length) {
      if (sum) sum.textContent = 'No staff changes yet';
      return void (box.innerHTML = '<p class="empty">No staff changes yet.</p>');
    }
    const staff = new Map((await must(sb.from('staff').select('user_id,name'))).map((s) => [s.user_id, s.name]));
    const who = (r) => staff.get(r.staff_user) ?? 'Staff';
    if (sum) sum.textContent = `Latest ${fmtDateTime(rows[0].created_at)} by ${who(rows[0])}`;
    box.innerHTML = `<ul class="job-log">${rows
      .map((r) => `<li><span class="job-log__when">${fmtDateTime(r.created_at)}</span><span>${esc(who(r))}</span><span class="job-log__msg">${esc(r.action)}: ${esc(r.detail ?? '')}</span></li>`)
      .join('')}</ul>${rows.length === SHOW ? `<p class="cust-log__more">Showing the latest ${SHOW}.</p>` : ''}`;
  } catch (err) {
    box.innerHTML = `<p class="form-error">${esc(friendlyError(err))}</p>`;
  }
}

// ---------------------------------------------------------------------------
// Follows (series / artist subscriptions)
// ---------------------------------------------------------------------------

const ROLE_LABEL = { cover: 'Cover artist', creator: 'Writer / artist' };

function setupFollows(el, c) {
  const list = $('[data-follows]', el);
  const results = $('[data-follow-results]', el);
  const form = $('[data-follow-search]', el);

  const load = async () => {
    try {
      const subs = await must(sb.from('subscriptions').select('id,kind,label,role,quantity').eq('customer_id', c.id).order('label'));
      list.innerHTML = subs.length
        ? `<ul class="job-log cust-follows">${subs
            .map((f) => `<li><span><strong>${esc(f.label)}</strong> <span class="card__meta">${f.kind === 'series' ? 'Series' : ROLE_LABEL[f.role]} · ${f.quantity} ${f.quantity === 1 ? 'copy' : 'copies'} of each</span></span>
              <button class="btn btn--danger btn--small" type="button" data-unfollow="${f.id}" data-label="${esc(f.label)}" aria-label="Unfollow ${esc(f.label)}">${solidIcon('unfollow', 16)} Unfollow</button></li>`)
            .join('')}</ul>`
        : '<p class="empty">Not following anything.</p>';
      const fc = $('[data-follow-count]', el);
      if (fc) fc.textContent = subs.length ? `${subs.length} ${subs.length === 1 ? 'follow' : 'follows'}` : 'Not following anything';
    } catch (err) {
      list.innerHTML = `<p class="form-error">${esc(friendlyError(err))}</p>`;
    }
  };
  load();

  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-unfollow]');
    if (!btn) return;
    if (!confirm(`Unfollow ${btn.dataset.label}? New issues will stop being added to ${c.name || 'this customer'}'s pull list.`)) return;
    try {
      await must(sb.from('subscriptions').delete().eq('id', Number(btn.dataset.unfollow)));
      await log(c.id, null, 'unfollowed', btn.dataset.label);
      toast(`Unfollowed ${btn.dataset.label}`);
      load();
      loadLog(el, c);
    } catch (err) {
      toast(`Not saved: ${friendlyError(err)}`, 'error');
    }
  });

  // One box for both: series and artists are searched together and listed under their own headings.
  let lastQuery = '';
  const search = async () => {
    const q = $('#cf-q', el).value.trim();
    lastQuery = q;
    if (q.length < 2) return void (results.innerHTML = '');
    const [series, artists] = await Promise.all([sb.rpc('search_series', { p_q: q }), sb.rpc('search_artists', { p_q: q })]);
    if (lastQuery !== q) return; // a newer search is already running
    const error = series.error ?? artists.error;
    if (error) return void (results.innerHTML = `<p class="form-error">${esc(friendlyError(error))}</p>`);
    const seriesRows = series.data.map((r) => `<li><span><strong>${esc(r.label)}</strong> <span class="card__meta">${r.issues ? `${r.issues} ${r.issues === 1 ? 'issue' : 'issues'}` : 'on the active list, no issues yet'}</span></span>
        <span class="cust-results__act"><button class="btn btn--add btn--small" type="button" data-fs="${esc(r.key)}" aria-label="Follow ${esc(r.label)}">${solidIcon('follow', 16)} Follow</button></span></li>`);
    // issues = 0: named only in cover text (a variant cover artist), so there are no books to follow.
    const artistRows = artists.data.map((r) => `<li><span><strong>${esc(r.name)}</strong> <span class="card__meta">${r.covers} covers${r.issues ? ` · ${r.issues} books` : ' (named in cover text)'}</span></span>
        <span class="cust-results__act">
          <button class="btn btn--add btn--small" type="button" data-fa="${esc(r.name)}" data-role="cover">${solidIcon('follow', 16)} Follow covers</button>
          ${r.issues ? `<button class="btn btn--add btn--small" type="button" data-fa="${esc(r.name)}" data-role="creator">${solidIcon('follow', 16)} Follow books</button>` : ''}</span></li>`);
    results.innerHTML = seriesRows.length || artistRows.length
      ? `${seriesRows.length ? `<h3 class="cust-results__head">Series</h3><ul class="cust-results">${seriesRows.join('')}</ul>` : ''}
         ${artistRows.length ? `<h3 class="cust-results__head">Artists &amp; writers</h3><ul class="cust-results">${artistRows.join('')}</ul>` : ''}`
      : '<p class="empty">No series or artists match.</p>';
  };
  form.addEventListener('input', debounce(search, 300));
  form.addEventListener('submit', (e) => (e.preventDefault(), search()));

  results.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-fs], [data-fa]');
    if (!btn) return;
    btn.disabled = true;
    const { data, error } = btn.dataset.fs
      ? await sb.rpc('staff_follow_series', { p_customer: c.id, p_key: btn.dataset.fs })
      : await sb.rpc('staff_follow_artist', { p_customer: c.id, p_name: btn.dataset.fa, p_role: btn.dataset.role });
    btn.disabled = false;
    if (error) return void toast(friendlyError(error), 'error');
    await log(c.id, null, 'followed', btn.dataset.fs ? `series ${btn.dataset.fs}` : `${btn.dataset.fa} (${ROLE_LABEL[btn.dataset.role].toLowerCase()})`);
    toast(`Following. ${data.added} open ${data.added === 1 ? 'title' : 'titles'} added to the pull list.`);
    btn.disabled = true;
    if (btn.classList.contains('icon-btn')) {
      btn.title = 'Following';
      btn.setAttribute('aria-label', 'Following');
    } else btn.textContent = 'Following ✓';
    load();
    loadOrders(el, c);
    loadLog(el, c);
  });
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/** Every customer's pull list in one file, sorted by customer then release date. */
async function exportAll(btn, includeHistory) {
  btn.disabled = true;
  try {
    const lines = [];
    for (let from = 0; ; from += 1000) {
      let q = sb
        .from('reservations')
        .select('quantity,status,source,arrived_on,created_at,item:items(title,issue_number,variant,publisher,price,foc_date,release_date),order:reservation_orders!inner(customer_id,customer:customers(first_name,last_name,email,phone,address1,city,state,zip,ship_arrivals))')
        .not('order.customer_id', 'is', null)
        .order('id');
      if (!includeHistory) q = q.in('status', ['open', 'ordered', 'reordered', 'arrived']);
      const { data, error } = await q.range(from, from + 999);
      if (error) throw fromError(error);
      lines.push(...data);
      if (data.length < 1000) break;
    }
    if (!lines.length) return void toast('No pull-list titles to export.', 'error');
    const rows = lines
      .map((l) => ({ l, c: l.order.customer }))
      .sort((a, b) => fullName(a.c).localeCompare(fullName(b.c)) || byRelease(a.l, b.l))
      .map(({ l, c }) => csvRow(c, l));
    downloadCsv(`pull-lists-${stamp()}.csv`, CSV_HEADER, rows);
    toast(`Exported ${rows.length} ${rows.length === 1 ? 'title' : 'titles'} for ${new Set(lines.map((l) => l.order.customer_id)).size} customers`);
  } catch (err) {
    toast(`Export failed: ${friendlyError(err)}`, 'error');
  }
  btn.disabled = false;
}

/** Everyone's current pull list in one PDF, a page (or more) per customer in last-name order, to print for their bags. */
async function exportCustomersPdf(btn) {
  btn.disabled = true;
  try {
    const byCustomer = new Map();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb
        .from('reservations')
        .select('quantity,status,arrived_on,item:items(title,issue_number,variant,publisher,price,series_key,foc_date,release_date),order:reservation_orders!inner(customer_id,customer:customers(first_name,last_name,email,phone))')
        .not('order.customer_id', 'is', null)
        .in('status', ['open', 'ordered', 'reordered', 'arrived'])
        .order('id')
        .range(from, from + 999);
      if (error) throw fromError(error);
      for (const l of data) {
        const c = byCustomer.get(l.order.customer_id) ?? { c: l.order.customer, lines: [] };
        c.lines.push(l);
        byCustomer.set(l.order.customer_id, c);
      }
      if (data.length < 1000) break;
    }
    if (!byCustomer.size) return void toast('No pull-list titles to print.', 'error');
    const customers = [...byCustomer.values()]
      .sort((a, b) => fullName(a.c).localeCompare(fullName(b.c), undefined, { sensitivity: 'base' }))
      .map(({ c, lines }) => ({ name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || 'Customer', phone: c.phone, lines }));
    const { buildAllPullListsPdf } = await import('../pull-list-pdf.js');
    const pdf = await buildAllPullListsPdf({ shop: settings, customers, holdDays: settings.hold_days ?? 30, today: shopToday() });
    if (!pdf.customers) return void toast('Nobody has anything ready for pickup or due at their next FOC.', 'error');
    pdf.save(`pull-lists-${stamp()}.pdf`);
    toast(`PDF saved: ${pdf.customers} ${pdf.customers === 1 ? 'customer' : 'customers'}, ${pdf.titles} ${pdf.titles === 1 ? 'title' : 'titles'}`);
  } catch (err) {
    toast(`PDF failed: ${friendlyError(err)}`, 'error');
  }
  btn.disabled = false;
}

/** A printable PDF of the customer's current pull list (open, ordered and arrived titles). */
async function exportCustomerPdf(btn, c) {
  if (!shownLines.some((l) => ['open', 'ordered', 'reordered', 'arrived'].includes(l.status))) return void toast('Nothing on this pull list to export.', 'error');
  btn.disabled = true;
  try {
    const { buildPullListPdf } = await import('../pull-list-pdf.js');
    const pdf = await buildPullListPdf({ shop: settings, customerName: c.name || c.email || 'Customer', customerPhone: c.phone, lines: shownLines, holdDays: settings.hold_days ?? 30, today: shopToday(), lastUpdated: lastUpdate ? `Last updated ${whenLabel(lastUpdate.at)}${lastUpdate.who ? ` by ${lastUpdate.who}` : ''}` : '' });
    if (!pdf.count) {
      btn.disabled = false;
      return void toast('Nothing ready for pickup and nothing due at the next FOC.', 'error');
    }
    pdf.save(`pull-list-${fileSlug(c.name ?? c.email ?? 'customer')}-${stamp()}.pdf`);
    toast(`PDF saved: ${pdf.count} ${pdf.count === 1 ? 'title' : 'titles'}`);
  } catch (err) {
    toast(`PDF failed: ${friendlyError(err)}`, 'error');
  }
  btn.disabled = false;
}
