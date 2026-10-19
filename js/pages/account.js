// Customer account: sign in with an emailed link or 6-digit code, edit the
// profile, and manage the pull list under this email. Everything the page
// reads or writes is limited to the signed-in customer by row-level security;
// claim_customer() links the record, and create_my_customer() creates it from the first-sign-in form.

import { initPage, $, esc, fmtDate, itemFullTitle, itemTitle, cover, price, cutoffPassed } from '../site.js';
import { DEMO, supabase, getSettings, searchSeries, searchArtists } from '../data.js';
import { SITE_URL } from '../config.js';
import { LINE_STATUS_CUSTOMER as LINE_STATUS } from '../labels.js';
import { whenIn as whenLabel } from '../dates.js';
import { thumbOf, thumbFallback, artistMeta } from '../util.js';
import * as pull from '../customer.js';
import * as guest from '../reservation-list.js';
import { seriesCount, discountFor, totals, tiersFrom } from '../discount.js';

const root = $('#account');

// An emailed link that has expired or was already used comes back with the reason in the address
// (#error=access_denied&error_code=otp_expired&error_description=…). Read it before supabase-js looks at the
// address, then tidy the address so a reload doesn't show it again.
let linkError = (() => {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(location.search);
  const get = (k) => hash.get(k) ?? query.get(k);
  const code = get('error_code') ?? get('error');
  if (!code && !get('error_description')) return null;
  for (const k of ['error', 'error_code', 'error_description']) query.delete(k);
  const rest = query.toString();
  history.replaceState(history.state, '', `${location.pathname}${rest ? `?${rest}` : ''}${hash.has('error') || hash.has('error_code') ? '' : location.hash}`);
  return /otp_expired|access_denied|expired|invalid/i.test(`${code} ${get('error_description') ?? ''}`)
    ? 'That sign-in link has expired or was already used — enter the code from the email, or request a new link below.'
    : 'That sign-in link didn’t work — enter the code from the email, or request a new link below.';
})();

await initPage();
if (DEMO) {
  root.innerHTML = '<p class="empty">Customer accounts aren’t available in demo mode.</p>';
} else {
  const sb = await supabase();
  // Clicking the emailed link returns here with the session in the URL; supabase-js picks it up.
  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') show(sb);
  });
  show(sb);
}

let showing; // 'in' | 'out': avoids redrawing (and wiping a half-edited form) on token refresh
async function show(sb) {
  const { data } = await sb.auth.getSession();
  const state = data.session ? 'in' : 'out';
  if (state === showing) return;
  showing = state;
  if (state === 'in') {
    try {
      await signedIn(sb, data.session.user);
    } catch (err) {
      console.error(err);
      showing = null;
      root.innerHTML = `<p class="form-error" role="alert">${esc(errText(err))}</p><p><button class="btn" type="button" data-out>Sign out</button></p>`;
      $('[data-out]', root).addEventListener('click', () => sb.auth.signOut());
    }
  } else {
    signedOut(sb);
  }
}

// Errors from customer.js are already worded for customers; anything else goes through the same mapping.
const errText = (err) => (err && 'signIn' in err ? err.message : pull.customerMessage(err));

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------

// Where the emailed link brings the customer back. On the live site always use the public https
// address, even if they happened to open the page over http; locally, stay on localhost.
function redirectUrl() {
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  return local ? new URL('account.html', location.href).href : `${SITE_URL.replace(/\/$/, '')}/account.html`;
}

function signedOut(sb) {
  const linkNote = linkError; // once: not again after a later sign-out
  linkError = null;
  root.innerHTML = `
    <div class="panel account-panel">
      <h2>Sign in</h2>
      <p>Enter your email and we’ll send you a link and a 6-digit code. No password needed — if you’re new, this creates your account.</p>
      <form id="email-form" novalidate>
        <div class="field">
          <label for="a-email">Email</label>
          <input id="a-email" name="email" type="email" autocomplete="email" required maxlength="254">
        </div>
        <p class="form-error" role="alert">${esc(linkNote ?? '')}</p>
        <button class="btn btn--primary" type="submit">Email me a sign-in link</button>
      </form>
      <form id="code-form" hidden novalidate>
        <p role="status">Check your email. Click the link, or enter the code here.</p>
        <div class="field">
          <label for="a-code">6-digit code</label>
          <input id="a-code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="8" required>
        </div>
        <p class="form-error" role="alert"></p>
        <button class="btn btn--primary" type="submit">Sign in</button>
        <button class="btn btn--ghost" type="button" data-back>Use a different email</button>
      </form>
    </div>`;
  const emailForm = $('#email-form', root);
  const codeForm = $('#code-form', root);
  let email = '';

  emailForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.form-error', emailForm);
    const btn = $('button', emailForm);
    email = emailForm.elements.email.value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return void (err.textContent = 'That email address doesn’t look right.');
    err.textContent = '';
    btn.disabled = true;
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectUrl() } });
    btn.disabled = false;
    if (error) return void (err.textContent = error.status === 429 ? 'Too many tries — please wait a minute and try again.' : pull.customerMessage(error));
    emailForm.hidden = true;
    codeForm.hidden = false;
    $('#a-code').focus();
  });

  codeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.form-error', codeForm);
    err.textContent = '';
    const token = codeForm.elements.code.value.replace(/\s/g, '');
    const { error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
    if (error) err.textContent = 'That code didn’t work. Check it and try again, or request a new one.';
  });
  $('[data-back]', codeForm).addEventListener('click', () => {
    codeForm.hidden = true;
    emailForm.hidden = false;
    $('#a-email').focus();
  });
}

// ---------------------------------------------------------------------------
// Signed in: profile and reservations
// ---------------------------------------------------------------------------

async function signedIn(sb, user) {
  await pull.initCustomer(); // other parts of the page (list bar, buttons) read the shared state
  const { data: customer, error } = await sb.rpc('claim_customer');
  if (error) throw pull.customerError(error);
  // A first sign-in has no customer record yet (id null). Ask for a name and phone before anything else.
  if (!customer.id || !customer.first_name?.trim() || !customer.last_name?.trim() || !customer.phone?.trim()) return setupProfile(sb, user, customer);

  root.innerHTML = `
    <p class="account-who">Signed in as <strong>${esc(user.email)}</strong> · <button class="link-button" type="button" data-out>Sign out</button></p>
    <div class="account-grid">
      <div class="account-col">
        <section class="panel" aria-labelledby="orders-h">
          <h2 id="orders-h" tabindex="-1">Coming Up</h2>
          <p class="visually-hidden" role="status" aria-live="polite" data-orders-status></p>
          <div data-orders><p class="empty loading">Loading…</p></div>
        </section>
        <section class="panel" aria-labelledby="follow-h">
          <h2 id="follow-h">Following</h2>
          <p class="field__hint">New issues from anything you follow are added to your pull list automatically, until the order cutoff. A series adds its main cover; tick <strong>All covers</strong> to get every variant too (never incentive covers). Remove any you don’t want from Coming Up.</p>
          <form class="follow-form" data-follow-search role="search">
            <div class="follow-form__row">
              <label class="visually-hidden" for="f-q">Search for a series or artist to follow</label>
              <input id="f-q" type="search" placeholder="Search for a series or artist to follow" autocomplete="off">
            </div>
          </form>
          <div data-follow-results></div>
          <div data-follows></div>
        </section>
      </div>
      <div class="account-col">
      <p class="callout">We reserve the right to cancel any pre-order for any reason, and pre-orders over $100 may require a deposit. See our <a href="terms.html">terms</a>.</p>
      <section class="panel" aria-labelledby="profile-h">
        <h2 id="profile-h">My Profile</h2>
        <form id="profile-form" novalidate>
          <div class="account-row">
            <div class="field"><label for="p-first">First name (required to place orders)</label><input id="p-first" name="first_name" autocomplete="given-name" required maxlength="80" value="${esc(customer.first_name)}"></div>
            <div class="field"><label for="p-last">Last name (required to place orders)</label><input id="p-last" name="last_name" autocomplete="family-name" required maxlength="80" value="${esc(customer.last_name)}"></div>
          </div>
          <div class="field"><label for="p-phone">Phone (required to place orders)</label><input id="p-phone" name="phone" type="tel" autocomplete="tel" required maxlength="40" value="${esc(customer.phone)}"></div>
          <fieldset class="account-fieldset">
            <legend>Shipping address</legend>
            <p class="field__hint">Only needed if you pay by phone and have your books shipped.</p>
            <div class="field"><label for="p-address1">Address</label><input id="p-address1" name="address1" autocomplete="address-line1" maxlength="200" value="${esc(customer.address1)}"></div>
            <div class="field"><label for="p-city">City</label><input id="p-city" name="city" autocomplete="address-level2" maxlength="100" value="${esc(customer.city)}"></div>
            <div class="account-row">
              <div class="field"><label for="p-state">State</label><input id="p-state" name="state" autocomplete="address-level1" maxlength="50" value="${esc(customer.state)}"></div>
              <div class="field"><label for="p-zip">Zip code</label><input id="p-zip" name="zip" autocomplete="postal-code" inputmode="numeric" maxlength="20" value="${esc(customer.zip)}"></div>
            </div>
          </fieldset>
          <div class="field field--check">
            <input id="p-optin" name="email_opt_in" type="checkbox"${customer.email_opt_in ? ' checked' : ''}>
            <label for="p-optin">Email me my pull list every week</label>
          </div>
          <div class="field field--check">
            <input id="p-arrivals" name="notify_arrivals" type="checkbox"${customer.notify_arrivals ? ' checked' : ''}>
            <label for="p-arrivals">Email me when my books are ready for pickup</label>
          </div>
          <div class="field field--check">
            <input id="p-mature" name="mature_ok" type="checkbox"${customer.mature_ok ? ' checked' : ''}>
            <label for="p-mature">Include mature-readers titles when I follow a series or artist</label>
          </div>
          <p class="form-error" role="alert"></p>
          <p class="account-saved" role="status"></p>
          <button class="btn btn--primary" type="submit">Save profile</button>
        </form>
      </section>
      </div>
    </div>`;

  $('[data-out]', root).addEventListener('click', () => sb.auth.signOut());

  const form = $('#profile-form', root);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.form-error', form);
    const saved = $('.account-saved', form);
    err.textContent = saved.textContent = '';
    const v = (k) => form.elements[k].value.trim() || null;
    // Orders need all four of first name, last name, email and phone; the email is the login, so the other three are checked here.
    for (const [key, label] of [['first_name', 'first name'], ['last_name', 'last name'], ['phone', 'phone number']]) {
      if (!v(key)) {
        err.textContent = `Please enter your ${label}. We need your first name, last name, email and phone to place orders.`;
        return form.elements[key].focus();
      }
    }
    const { error: saveError } = await sb
      .from('customers')
      .update({ first_name: v('first_name'), last_name: v('last_name'), phone: v('phone'), address1: v('address1'), city: v('city'), state: v('state'), zip: v('zip'), email_opt_in: form.elements.email_opt_in.checked, mature_ok: form.elements.mature_ok.checked, notify_arrivals: form.elements.notify_arrivals.checked })
      .eq('id', customer.id);
    if (saveError) err.textContent = pull.customerMessage(saveError);
    else saved.textContent = 'Saved.';
  });

  // When they last looked, so titles their follows added since then are badged "New" (and the nav count resets).
  const seenBefore = await pull.markSeen().catch(() => null);
  loadOrders(sb, customer.id, seenBefore);
  setupFollowing(sb, customer.id, seenBefore);
}

/** First sign-in: collect the details orders need (first name, last name, phone) before showing the account. */
function setupProfile(sb, user, customer) {
  root.innerHTML = `
    <p class="account-who">Signed in as <strong>${esc(user.email)}</strong> · <button class="link-button" type="button" data-out>Sign out</button></p>
    <section class="panel account-setup" aria-labelledby="setup-h">
      <h2 id="setup-h">Welcome! Let’s finish your account</h2>
      <p class="field__hint">We need your name and phone number so the shop can set aside your books and reach you when they arrive.</p>
      <form id="setup-form" novalidate>
        <div class="account-row">
          <div class="field"><label for="s-first">First name</label><input id="s-first" name="first_name" autocomplete="given-name" required maxlength="80" value="${esc(customer.first_name)}"></div>
          <div class="field"><label for="s-last">Last name</label><input id="s-last" name="last_name" autocomplete="family-name" required maxlength="80" value="${esc(customer.last_name)}"></div>
        </div>
        <div class="field"><label for="s-phone">Phone</label><input id="s-phone" name="phone" type="tel" autocomplete="tel" required maxlength="40" value="${esc(customer.phone)}"></div>
        <p class="form-error" role="alert"></p>
        <button class="btn btn--primary" type="submit">Continue</button>
      </form>
    </section>`;
  $('[data-out]', root).addEventListener('click', () => sb.auth.signOut());
  const form = $('#setup-form', root);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.form-error', form);
    err.textContent = '';
    const v = (k) => form.elements[k].value.trim();
    for (const [key, label] of [['first_name', 'first name'], ['last_name', 'last name'], ['phone', 'phone number']]) {
      if (!v(key)) {
        err.textContent = `Please enter your ${label}.`;
        return form.elements[key].focus();
      }
    }
    // Creates the customer record (or completes an existing one); nothing is saved for a login until this.
    const { error } = await sb.rpc('create_my_customer', { p_first_name: v('first_name'), p_last_name: v('last_name'), p_phone: v('phone') });
    if (error) err.textContent = pull.customerMessage(error);
    else signedIn(sb, user).catch((ex) => (err.textContent = errText(ex)));
  });
  form.elements.first_name.focus();
}

// Customers see "you" and "the shop" (not staff names); automatic follow/status updates are just "automatically".
const BY = { customer: 'by you', guest: 'by you', staff: 'by the shop', system: 'automatically' };

const SOURCE_NOTE = { variant: 'Added with all covers', series: 'You follow this series', artist: 'You follow this artist', staff: 'Added by the shop' };

const LIVE = ['open', 'ordered', 'reordered', 'arrived'];
const PAST_SHOWN = 100; // picked up, released and so on: the most recent

// Open lines can be changed until the order cutoff (the Saturday before FOC); after that, call the shop.
const canEdit = (r) => r.status === 'open' && !cutoffPassed(r.item);

/** Say what just happened on the list (a polite live region that isn't redrawn with it). */
const announce = (text) => {
  const live = $('[data-orders-status]', root);
  if (!live) return;
  live.textContent = '';
  setTimeout(() => (live.textContent = text), 50); // a change, even to the same words, is read out
};

/** `focus`: selectors to try, in order, for where keyboard focus goes once the list is redrawn. */
async function loadOrders(sb, customerId, seenBefore = null, { focus } = {}) {
  const el = $('[data-orders]', root);
  const settings = await getSettings();
  // `!inner` + the customer filter keeps this to the customer's own lines even for staff, whose
  // row-level security would otherwise let them read everyone's.
  // Every line still in play (no limit, so a long history can't push current titles off the page), then the most
  // recent history.
  const lineQuery = () =>
    sb
      .from('reservations')
      .select('id,quantity,status,source,arrived_on,created_at,updated_at,updated_via,item:items(id,title,issue_number,variant,publisher,price,series_key,release_date,foc_date,cover_url,cover_thumb_url),order:reservation_orders!inner(customer_id)')
      .eq('order.customer_id', customerId)
      .order('created_at', { ascending: false });
  const [current, history] = await Promise.all([
    lineQuery().in('status', [...LIVE, 'not_ordered']),
    lineQuery().not('status', 'in', `(${[...LIVE, 'not_ordered', 'cancelled'].join(',')})`).limit(PAST_SHOWN),
  ]);
  const error = current.error ?? history.error;
  if (error) return void (el.innerHTML = `<p class="form-error" role="alert">${pull.errorHtml(pull.customerError(error))}</p>`);
  // A title the shop has since taken down still shows by name if it can; otherwise as a placeholder.
  const data = [...current.data, ...history.data].map((r) => ({ ...r, item: r.item ?? { title: 'Title no longer listed' } }));
  // The newest change anywhere on the list, including titles since removed.
  const { data: newest } = await sb
    .from('reservations')
    .select('updated_at,updated_via,order:reservation_orders!inner(customer_id)')
    .eq('order.customer_id', customerId)
    .order('updated_at', { ascending: false })
    .limit(1);
  const last = newest?.[0];

  const active = data.filter((r) => LIVE.includes(r.status));
  const notOrdered = data.filter((r) => r.status === 'not_ordered');
  const past = data.filter((r) => !active.includes(r) && r.status !== 'not_ordered');
  const waiting = guest.getLines();

  // Group by release date so the list reads like a shop week; "Ready for pickup" first.
  const ready = active.filter((r) => r.status === 'arrived');
  const upcoming = active.filter((r) => r.status !== 'arrived');
  const groups = new Map();
  for (const r of upcoming.sort((a, b) => (a.item.release_date ?? '9999').localeCompare(b.item.release_date ?? '9999') || itemFullTitle(a.item).localeCompare(itemFullTitle(b.item)))) {
    const key = r.item.release_date ?? '';
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  // Discount tier from the distinct series on the active list, and the estimated total at cover price.
  const seriesN = seriesCount(active);
  const tiers = tiersFrom(settings);
  const { pct, next } = discountFor(seriesN, tiers);
  const { subtotal, discount, total } = totals(active, pct);
  const summary = active.length
    ? `<div class="account-summary">
        ${tiers.length ? `<p class="account-summary__tier"><strong>${seriesN} series</strong> on your pull list · <strong>${pct}% off</strong>${next ? `<br>Add <strong>${next.more} more series</strong> to get ${next.pct}% off.` : '<br>You’ve reached our top discount!'}</p>` : ''}
        <dl class="account-summary__totals">
          <div><dt>Subtotal</dt><dd>${esc(price(subtotal))}</dd></div>
          ${pct ? `<div><dt>Discount (${pct}%)</dt><dd>−${esc(price(discount))}</dd></div>` : ''}
          <div class="account-summary__total"><dt>Estimated total</dt><dd>${esc(price(total))}</dd></div>
        </dl>
        <p class="card__meta">At cover price, before tax. Titles without a price aren’t counted.</p>
      </div>`
    : '';

  // Titles a follow added since the last visit (the hourly sweep, or just now on follow).
  const isNew = (r) => pull.isNewAuto(r, seenBefore);
  const fresh = active.filter(isNew);
  const freshNote = fresh.length
    ? `<p class="notice account-new"><span class="new-badge">New</span> ${fresh.length} ${fresh.length === 1 ? 'title was' : 'titles were'} added from what you follow${seenBefore ? ' since your last visit' : ''}. Remove any you don’t want.</p>`
    : '';

  const row = (r) => {
    const editable = canEdit(r);
    const note = SOURCE_NOTE[r.source];
    const added = isNew(r);
    return `
      <li class="account-line${added ? ' account-line--new' : ''}">
        ${cover(r.item)}
        <div class="account-line__info">
          ${added ? '<span class="new-badge" title="Added automatically from something you follow">New · added for you</span>' : ''}
          <strong>${esc(itemTitle(r.item))}</strong>
          ${r.item.variant ? `<span class="card__variant">${esc(r.item.variant)}</span>` : ''}
          <span class="card__meta">${esc([r.item.publisher, price(r.item.price), note].filter(Boolean).join(' · '))}</span>
          ${r.updated_via === 'staff' ? `<span class="card__meta">Updated by the shop · ${esc(whenLabel(r.updated_at, settings.timezone))}</span>` : ''}
          <span class="account-line__status account-line__status--${esc(r.status)}">${esc(LINE_STATUS[r.status] ?? r.status)}${r.status === 'open' && !editable ? ' — order is in, call the shop to change' : ''}${r.status === 'not_ordered' ? ' — call the shop if you have questions' : ''}</span>
        </div>
        ${editable
          ? `<div class="list-line__controls">
              <label class="visually-hidden" for="pq-${r.id}">Copies of ${esc(itemFullTitle(r.item))}</label>
              <input class="list-line__qty" id="pq-${r.id}" type="number" inputmode="numeric" min="1" max="${settings.max_copies_per_title}" value="${r.quantity}" data-qty="${r.id}">
              <button class="list-line__remove" type="button" data-remove="${r.id}">Remove<span class="visually-hidden"> ${esc(itemFullTitle(r.item))}</span></button>
            </div>`
          : `<span class="account-line__qty">${r.quantity > 1 ? `${r.quantity} copies` : '1 copy'}</span>`}
      </li>`;
  };
  const section = (title, rows) => (rows.length ? `<h3 class="account-group">${esc(title)}</h3><ul class="account-lines">${rows.map(row).join('')}</ul>` : '');

  el.innerHTML = `
    ${last ? `<p class="card__meta account-lastupdate">Last updated ${esc(whenLabel(last.updated_at, settings.timezone))} ${esc(BY[last.updated_via] ?? '')}</p>` : ''}
    ${waiting.length ? `<p class="notice account-move">You have ${waiting.length} ${waiting.length === 1 ? 'title' : 'titles'} on a guest pull list on this device. <button class="btn btn--primary" type="button" data-move>Add ${waiting.length === 1 ? 'it' : 'them'} to my pull list</button></p>` : ''}
    <p class="form-error" role="alert" data-error></p>
    ${freshNote}
    ${summary}
    ${section('Ready for pickup', ready)}
    ${[...groups].map(([date, rows]) => section(date ? `Out ${fmtDate(date, { weekday: 'short', month: 'short', day: 'numeric' })}` : 'Release date to be announced', rows)).join('')}
    ${section('Not ordered by the shop', notOrdered)}
    ${!active.length ? '<p class="empty">Your pull list is empty. Tap <strong>Add to pull list</strong> on any title on the <a href="pre-orders.html">Pre-Orders</a> page, or <strong>Add all covers</strong> to pull every cover of an issue.</p>' : ''}
    ${past.length ? `<details class="account-past"><summary>Past (${past.length})</summary>${section('', past)}</details>` : ''}`;

  // Keyboard focus goes back where it was (or the next sensible place) after a redraw.
  for (const sel of focus ?? []) {
    const target = sel && $(sel, root);
    if (target) {
      target.focus();
      break;
    }
  }

  const showError = (err) => {
    $('[data-error]', el).innerHTML = pull.errorHtml(err);
    announce(err.message);
  };
  const reload = (focusTo) => loadOrders(sb, customerId, seenBefore, { focus: [...focusTo, '#orders-h'] });
  const titleOf = (lineId) => itemFullTitle(data.find((r) => r.id === lineId)?.item ?? { title: 'That title' });
  el.onchange = async (e) => {
    const input = e.target.closest('[data-qty]');
    if (!input) return;
    const id = Number(input.dataset.qty);
    const q = Math.min(Math.max(Math.round(Number(input.value)) || 1, 1), settings.max_copies_per_title);
    try {
      await pull.setQuantity(id, q);
      await reload([`[data-qty="${id}"]`]);
      announce(`${titleOf(id)}: ${q} ${q === 1 ? 'copy' : 'copies'}.`);
    } catch (err) {
      showError(err);
      input.value = data.find((r) => r.id === id)?.quantity ?? 1;
    }
  };
  el.onclick = async (e) => {
    const rm = e.target.closest('[data-remove]');
    const move = e.target.closest('[data-move]');
    if (!rm && !move) return;
    try {
      if (rm) {
        const id = Number(rm.dataset.remove);
        // The line goes away: focus the next line's Remove (or the one before) instead.
        const li = rm.closest('li');
        const near = [li.nextElementSibling, li.previousElementSibling].map((n) => n?.querySelector('[data-remove]')?.dataset.remove).filter(Boolean);
        await pull.remove(id);
        await reload([...near.map((n) => `[data-remove="${n}"]`), '[data-remove]']);
        announce(`Removed ${titleOf(id)} from your pull list.`);
      } else {
        const moved = await moveGuestList(el);
        await reload(['[data-remove]']);
        announce(`Added ${moved} ${moved === 1 ? 'title' : 'titles'} to your pull list.`);
      }
    } catch (err) {
      if (move) await reload(['[data-move]', '[data-remove]']);
      showError(err);
    }
  };
}

/** Add each title from the guest pull list; the ones that fail are kept and reported. Resolves how many moved. */
async function moveGuestList() {
  const failed = [];
  let moved = 0;
  for (const { item, quantity } of guest.getLines()) {
    try {
      await pull.add(item.id, quantity);
      guest.remove(item.id);
      moved++;
    } catch (err) {
      // Only a title that really is on the list (an active line) counts as done; otherwise keep it and say why.
      if (/already on your list/.test(err.message) && (await pull.refresh().then(() => pull.has(item.id), () => false))) {
        guest.remove(item.id);
        moved++;
      } else failed.push(err);
    }
  }
  if (failed.length) {
    const e = new Error(failed.map((f) => f.message).join(' '));
    e.signIn = failed.some((f) => f.signIn);
    throw e;
  }
  return moved;
}

// ---------------------------------------------------------------------------
// Following
// ---------------------------------------------------------------------------

const ROLE_LABEL = { cover: 'Cover artist', creator: 'Writer / artist' };

async function setupFollowing(sb, customerId, seenBefore) {
  const list = $('[data-follows]', root);
  const results = $('[data-follow-results]', root);
  const form = $('[data-follow-search]', root);
  let lastQuery = '';
  // set_follow_quantity refuses more than the copy limit (every new issue would be over it).
  const maxCopies = (await getSettings().catch(() => null))?.max_copies_per_title ?? 100;

  const renderFollows = () => {
    const subs = pull.getSubscriptions();
    // Keep keyboard focus on the same follow's control after the redraw (or the next one, if it was unfollowed).
    const focused = document.activeElement?.closest?.('[data-fqty], [data-fall], [data-unfollow]');
    const li = focused && list.contains(focused) ? focused.closest('li') : null;
    const near = li ? [li, li.nextElementSibling, li.previousElementSibling].map((n) => n?.querySelector('[data-unfollow]')?.dataset.unfollow).filter(Boolean) : [];
    const keep = focused && li ? (focused.dataset.fqty ? `[data-fqty="${focused.dataset.fqty}"]` : focused.dataset.fall ? `[data-fall="${focused.dataset.fall}"]` : `[data-unfollow="${focused.dataset.unfollow}"]`) : null;
    list.innerHTML = subs.length
      ? `<ul class="follow-subs">${subs
          .map(
            (f) => `<li>
              <span class="follow-item">${f.cover ? `<img class="follow-thumb" src="${esc(f.cover)}" alt="Cover of ${esc(f.label)}" loading="lazy">` : ''}<span><strong>${esc(f.label)}</strong><br><span class="card__meta">${f.kind === 'series' ? (f.all_covers ? 'Series · every cover' : 'Series · main cover') : ROLE_LABEL[f.role]}</span></span></span>
              <span class="list-line__controls">
                ${f.kind === 'series' ? `<label class="follow-allcovers"><input type="checkbox" data-fall="${f.id}"${f.all_covers ? ' checked' : ''}> All covers<span class="visually-hidden"> of ${esc(f.label)}</span></label>` : ''}
                <label class="visually-hidden" for="fq-${f.id}">Copies of each new issue of ${esc(f.label)}</label>
                <input class="list-line__qty" id="fq-${f.id}" type="number" inputmode="numeric" min="1" max="${maxCopies}" value="${f.quantity}" data-fqty="${f.id}">
                <button class="list-line__remove" type="button" data-unfollow="${f.id}">Unfollow<span class="visually-hidden"> ${esc(f.label)}</span></button>
              </span></li>`,
          )
          .join('')}</ul>`
      : '<p class="empty">You aren’t following anything yet.</p>';
    if (li) (($(keep, list) ?? near.map((id) => $(`[data-unfollow="${id}"]`, list)).find(Boolean)) ?? $('#f-q', root))?.focus();
  };
  renderFollows();
  pull.onChange(renderFollows);
  pull.onChange(() => lastResults && renderResults()); // an unfollow shows "Follow" again in the search results

  // Messages go above the results so the list of matches stays open while following several things.
  const status = Object.assign(document.createElement('div'), { className: 'follow-status' });
  results.before(status);
  const note = (text, bad) => (status.innerHTML = `<p class="${bad ? 'form-error' : 'account-saved'}" role="${bad ? 'alert' : 'status'}">${esc(text)}</p>`);
  const noteError = (err) => (status.innerHTML = `<p class="form-error" role="alert">${pull.errorHtml({ message: errText(err), signIn: err?.signIn })}</p>`);

  list.addEventListener('change', async (e) => {
    const box = e.target.closest('[data-fall]');
    if (box) {
      const sub = pull.getSubscriptions().find((s) => s.id === Number(box.dataset.fall));
      try {
        const { added, removed } = await pull.setFollowAllCovers(sub.id, box.checked);
        const n = box.checked ? added : removed;
        note(
          box.checked
            ? `${sub.label}: every cover of each new issue will be added (not incentive covers).${n ? ` ${n} ${n === 1 ? 'cover was' : 'covers were'} added now.` : ''}`
            : `${sub.label}: just the main cover of each new issue.${n ? ` ${n} extra ${n === 1 ? 'cover' : 'covers'} not ordered yet ${n === 1 ? 'was' : 'were'} removed.` : ''}`,
        );
        loadOrders(sb, customerId, seenBefore);
      } catch (err) {
        noteError(err);
        box.checked = !box.checked;
      }
      return;
    }
    const input = e.target.closest('[data-fqty]');
    if (!input) return;
    const id = Number(input.dataset.fqty);
    const q = Math.min(Math.max(Math.round(Number(input.value)) || 1, 1), maxCopies);
    input.value = q;
    try {
      const { updated, skipped } = await pull.setFollowQuantity(id, q);
      const each = `${q} ${q === 1 ? 'copy' : 'copies'} of each issue`;
      note(
        `${each}. ${updated ? `${updated} ${updated === 1 ? 'title' : 'titles'} not ordered yet ${updated === 1 ? 'was' : 'were'} updated.` : 'Nothing else on your list needed changing.'}` +
          (skipped ? ` ${skipped} ${skipped === 1 ? 'title is' : 'titles are'} over the copy limit and kept ${skipped === 1 ? 'its' : 'their'} old quantity.` : ''),
      );
      loadOrders(sb, customerId, seenBefore);
    } catch (err) {
      noteError(err);
      input.value = pull.getSubscriptions().find((s) => s.id === id)?.quantity ?? 1;
    }
  });
  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-unfollow]');
    if (!btn) return;
    const sub = pull.getSubscriptions().find((s) => s.id === Number(btn.dataset.unfollow));
    if (!sub) return;
    try {
      const removed = await pull.unfollowWithWarning(sub);
      if (removed == null) return;
      note(`Unfollowed ${sub.label}.${removed ? ` ${removed} ${removed === 1 ? 'title was' : 'titles were'} removed from your pull list.` : ''}`);
      loadOrders(sb, customerId, seenBefore);
    } catch (err) {
      noteError(err);
    }
  });

  // One box for both: series and artists are searched together and listed under their own headings.
  const following = (label) => `<span class="btn btn--ghost btn--small is-on" aria-disabled="true">✓ ${esc(label)}</span>`;
  const seriesRow = (r) => `<li><span class="follow-item">${r.cover_url ? `<img class="follow-thumb" src="${esc(thumbOf(r.cover_url))}" ${thumbFallback(r.cover_url)} alt="Cover of ${esc(r.label)}" loading="lazy">` : ''}<span><strong>${esc(r.label)}</strong><br><span class="card__meta">${r.issues ? `${r.issues} ${r.issues === 1 ? 'issue' : 'issues'}` : 'Ongoing series · new issues are added as they’re announced'}</span></span></span>
      <span class="follow-results__act">${pull.findSubscription('series', r.key)
        ? following(pull.findSubscription('series', r.key).all_covers ? 'Following all covers' : 'Following')
        : `<button class="btn btn--primary btn--small" type="button" data-fs="${esc(r.key)}">Follow<span class="visually-hidden"> ${esc(r.label)}</span></button>
           <button class="btn btn--primary btn--small" type="button" data-fs="${esc(r.key)}" data-covers="all">Follow all covers<span class="visually-hidden"> of ${esc(r.label)}</span></button>`}</span></li>`;
  // issues = 0: named only in cover text (a variant cover artist), so there are no books to follow.
  const artistBtn = (r, role) =>
    pull.findSubscription('artist', pull.personKey(r.name), role)
      ? following(`Following their ${role === 'cover' ? 'covers' : 'books'}`)
      : `<button class="btn ${role === 'cover' ? 'btn--primary' : 'btn--ghost'} btn--small" type="button" data-fa="${esc(r.name)}" data-role="${role}">Follow their ${role === 'cover' ? 'covers' : 'books'}<span class="visually-hidden"> by ${esc(r.name)}</span></button>`;
  const artistRow = (r) => `<li><span><strong>${esc(r.name)}</strong><br><span class="card__meta">${artistMeta(r)}</span></span>
      <span class="follow-results__act">
        ${artistBtn(r, 'cover')}
        ${r.issues ? artistBtn(r, 'creator') : ''}</span></li>`;

  let lastResults = null; // { series, artists } of the search on screen
  const renderResults = () => {
    const { series, artists } = lastResults;
    // Keep focus on the same button if it is still there (another follow changed), else on the search box.
    const focused = document.activeElement?.closest?.('[data-fs], [data-fa]');
    const keep = focused && results.contains(focused) ? (focused.dataset.fs ? `[data-fs="${CSS.escape(focused.dataset.fs)}"]${focused.dataset.covers ? '[data-covers="all"]' : ':not([data-covers])'}` : `[data-fa="${CSS.escape(focused.dataset.fa)}"][data-role="${focused.dataset.role}"]`) : null;
    results.innerHTML = series.length || artists.length
      ? `${series.length ? `<h3 class="follow-results__head">Series</h3><ul class="follow-results">${series.map(seriesRow).join('')}</ul>` : ''}
         ${artists.length ? `<h3 class="follow-results__head">Artists &amp; writers</h3><ul class="follow-results">${artists.map(artistRow).join('')}</ul>
           <p class="field__hint"><strong>Their covers</strong> = every cover they draw, on any series (variants included, not incentives). <strong>Their books</strong> = the main cover of each issue they write or draw.</p>` : ''}
         ${series.length ? '<p class="field__hint">Follow = the main cover of each new issue. All covers = every variant too (not incentives).</p>' : ''}`
      : '<p class="empty">No series or artists match.</p>';
    if (keep) ($(keep, results) ?? $('#f-q', root)).focus();
  };

  const search = async () => {
    const q = $('#f-q', form).value.trim();
    lastQuery = q;
    status.innerHTML = '';
    if (q.length < 2) return void ((lastResults = null), (results.innerHTML = ''));
    try {
      const [series, artists] = await Promise.all([searchSeries(q), searchArtists(q)]);
      if (lastQuery !== q) return; // a newer search is already running
      lastResults = { series, artists };
      renderResults();
    } catch (err) {
      noteError(err);
    }
  };
  let timer;
  form.addEventListener('input', () => (clearTimeout(timer), (timer = setTimeout(search, 300))));
  form.addEventListener('submit', (e) => (e.preventDefault(), search()));

  results.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-fs], [data-fa]');
    if (!btn) return;
    btn.disabled = true;
    try {
      const { added } = btn.dataset.fs ? await pull.followSeries(btn.dataset.fs, 1, btn.dataset.covers === 'all') : await pull.followArtist(btn.dataset.fa, btn.dataset.role);
      // The results redraw with "✓ Following" (pull.onChange); focus stays in the search.
      if (btn.isConnected) btn.textContent = 'Following ✓';
      if (!results.contains(document.activeElement)) $('#f-q', root).focus();
      note(`Following. ${added ? `${added} open ${added === 1 ? 'title was' : 'titles were'} added to your pull list.` : 'New issues will be added automatically.'}`);
      loadOrders(sb, customerId, seenBefore);
    } catch (err) {
      btn.disabled = false;
      noteError(err);
    }
  });
}
