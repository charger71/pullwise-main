// Customer account: sign in with an emailed link or 6-digit code, edit the
// profile, and manage the pull list under this email. Everything the page
// reads or writes is limited to the signed-in customer by row-level security;
// claim_customer() (see the customers migration) creates or links the record.

import { initPage, $, esc, fmtDate, itemFullTitle, itemTitle, cover, price, cutoffPassed } from '../site.js';
import { DEMO, supabase, getSettings, searchSeries, searchArtists } from '../data.js';
import { SITE_URL } from '../config.js';
import { LINE_STATUS_CUSTOMER as LINE_STATUS } from '../labels.js';
import { whenIn as whenLabel } from '../dates.js';
import { thumbOf, thumbFallback } from '../util.js';
import * as pull from '../customer.js';
import * as guest from '../reservation-list.js';
import { seriesCount, discountFor, totals, tiersFrom } from '../discount.js';

const root = $('#account');

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
      root.innerHTML = `<p class="form-error" role="alert">${esc(err.message)}</p><p><button class="btn" type="button" data-out>Sign out</button></p>`;
      $('[data-out]', root).addEventListener('click', () => sb.auth.signOut());
    }
  } else {
    signedOut(sb);
  }
}

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
  root.innerHTML = `
    <div class="panel account-panel">
      <h2>Sign in</h2>
      <p>Enter your email and we’ll send you a link and a 6-digit code. No password needed — if you’re new, this creates your account.</p>
      <form id="email-form" novalidate>
        <div class="field">
          <label for="a-email">Email</label>
          <input id="a-email" name="email" type="email" autocomplete="email" required maxlength="254">
        </div>
        <p class="form-error" role="alert"></p>
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
    if (error) return void (err.textContent = error.status === 429 ? 'Too many tries — please wait a minute and try again.' : error.message);
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
  if (error) throw new Error(error.message);
  // A first sign-in only knows the email. Ask for a name and phone before anything else.
  if (!customer.first_name?.trim() || !customer.last_name?.trim() || !customer.phone?.trim()) return setupProfile(sb, user, customer);

  root.innerHTML = `
    <p class="account-who">Signed in as <strong>${esc(user.email)}</strong> · <button class="link-button" type="button" data-out>Sign out</button></p>
    <div class="account-grid">
      <div class="account-col">
        <section class="panel" aria-labelledby="orders-h">
          <h2 id="orders-h">Coming Up</h2>
          <div data-orders><p class="empty loading">Loading…</p></div>
        </section>
        <section class="panel" aria-labelledby="follow-h">
          <h2 id="follow-h">Following</h2>
          <p class="field__hint">New issues from anything you follow are added to your pull list automatically, until the order cutoff. Remove any you don’t want from Coming Up.</p>
          <form class="follow-form" data-follow-search role="search">
            <div class="follow-form__row">
              <label class="visually-hidden" for="f-q">Search for a series or artist to follow</label>
              <input id="f-q" type="search" placeholder="Search for a series or artist to follow" autocomplete="off">
              <label class="visually-hidden" for="f-kind">Search for</label>
              <select id="f-kind"><option value="series">Series</option><option value="artist">Artist</option></select>
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
    if (saveError) err.textContent = saveError.message;
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
    const { error } = await sb.from('customers').update({ first_name: v('first_name'), last_name: v('last_name'), phone: v('phone') }).eq('id', customer.id);
    if (error) err.textContent = error.message;
    else signedIn(sb, user);
  });
  form.elements.first_name.focus();
}

// Customers see "you" and "the shop" (not staff names); automatic follow/status updates are just "automatically".
const BY = { customer: 'by you', guest: 'by you', staff: 'by the shop', system: 'automatically' };

const SOURCE_NOTE = { variant: 'Added with all covers', series: 'You follow this series', artist: 'You follow this artist', staff: 'Added by the shop' };

// Open lines can be changed until the order cutoff (the Saturday before FOC); after that, call the shop.
const canEdit = (r) => r.status === 'open' && !cutoffPassed(r.item);

async function loadOrders(sb, customerId, seenBefore = null) {
  const el = $('[data-orders]', root);
  const settings = await getSettings();
  // `!inner` + the customer filter keeps this to the customer's own lines even for staff, whose
  // row-level security would otherwise let them read everyone's.
  const { data, error } = await sb
    .from('reservations')
    .select('id,quantity,status,source,arrived_on,created_at,updated_at,updated_via,item:items(id,title,issue_number,variant,publisher,price,series_key,release_date,foc_date,cover_url,cover_thumb_url),order:reservation_orders!inner(customer_id)')
    .eq('order.customer_id', customerId)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) return void (el.innerHTML = `<p class="form-error" role="alert">${esc(error.message)}</p>`);
  // The newest change anywhere on the list, including titles since removed.
  const { data: newest } = await sb
    .from('reservations')
    .select('updated_at,updated_via,order:reservation_orders!inner(customer_id)')
    .eq('order.customer_id', customerId)
    .order('updated_at', { ascending: false })
    .limit(1);
  const last = newest?.[0];

  const active = data.filter((r) => ['open', 'ordered', 'reordered', 'arrived'].includes(r.status));
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

  const showError = (err) => ($('[data-error]', el).textContent = err.message);
  const reload = () => loadOrders(sb, customerId, seenBefore);
  el.onchange = async (e) => {
    const input = e.target.closest('[data-qty]');
    if (!input) return;
    const q = Math.min(Math.max(Math.round(Number(input.value)) || 1, 1), settings.max_copies_per_title);
    try {
      await pull.setQuantity(Number(input.dataset.qty), q);
      reload();
    } catch (err) {
      showError(err);
      input.value = data.find((r) => r.id === Number(input.dataset.qty))?.quantity ?? 1;
    }
  };
  el.onclick = async (e) => {
    const rm = e.target.closest('[data-remove]');
    const move = e.target.closest('[data-move]');
    if (!rm && !move) return;
    try {
      if (rm) await pull.remove(Number(rm.dataset.remove));
      else await moveGuestList(el);
      reload();
    } catch (err) {
      showError(err);
    }
  };
}

/** Add each title from the guest pull list; the ones that fail are kept and reported. */
async function moveGuestList(el) {
  const failed = [];
  for (const { item, quantity } of guest.getLines()) {
    try {
      await pull.add(item.id, quantity);
      guest.remove(item.id);
    } catch (err) {
      if (/already on your list/.test(err.message)) guest.remove(item.id);
      else failed.push(err.message);
    }
  }
  if (failed.length) throw new Error(failed.join(' '));
}

// ---------------------------------------------------------------------------
// Following
// ---------------------------------------------------------------------------

const ROLE_LABEL = { cover: 'Cover artist', creator: 'Writer / artist' };

function setupFollowing(sb, customerId, seenBefore) {
  const list = $('[data-follows]', root);
  const results = $('[data-follow-results]', root);
  const form = $('[data-follow-search]', root);
  let lastQuery = '';

  const renderFollows = () => {
    const subs = pull.getSubscriptions();
    list.innerHTML = subs.length
      ? `<ul class="follow-subs">${subs
          .map(
            (f) => `<li>
              <span class="follow-item">${f.cover ? `<img class="follow-thumb" src="${esc(f.cover)}" alt="Cover of ${esc(f.label)}" loading="lazy">` : ''}<span><strong>${esc(f.label)}</strong><br><span class="card__meta">${f.kind === 'series' ? 'Series' : ROLE_LABEL[f.role]}</span></span></span>
              <span class="list-line__controls">
                <label class="visually-hidden" for="fq-${f.id}">Copies of each new issue of ${esc(f.label)}</label>
                <input class="list-line__qty" id="fq-${f.id}" type="number" inputmode="numeric" min="1" max="100" value="${f.quantity}" data-fqty="${f.id}">
                <button class="list-line__remove" type="button" data-unfollow="${f.id}">Unfollow<span class="visually-hidden"> ${esc(f.label)}</span></button>
              </span></li>`,
          )
          .join('')}</ul>`
      : '<p class="empty">You aren’t following anything yet.</p>';
  };
  renderFollows();
  pull.onChange(renderFollows);

  // Messages go above the results so the list of matches stays open while following several things.
  const status = Object.assign(document.createElement('div'), { className: 'follow-status' });
  results.before(status);
  const note = (text, bad) => (status.innerHTML = `<p class="${bad ? 'form-error' : 'account-saved'}" role="${bad ? 'alert' : 'status'}">${esc(text)}</p>`);

  list.addEventListener('change', async (e) => {
    const input = e.target.closest('[data-fqty]');
    if (!input) return;
    const q = Math.min(Math.max(Math.round(Number(input.value)) || 1, 1), 100);
    try {
      await pull.setFollowQuantity(Number(input.dataset.fqty), q);
    } catch (err) {
      note(err.message, true);
    }
  });
  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-unfollow]');
    if (!btn) return;
    try {
      await pull.unfollow(Number(btn.dataset.unfollow));
    } catch (err) {
      note(err.message, true);
    }
  });

  const search = async () => {
    const q = $('#f-q', form).value.trim();
    const kind = $('#f-kind', form).value;
    lastQuery = `${kind}:${q}`;
    status.innerHTML = '';
    if (q.length < 2) return void (results.innerHTML = '');
    try {
      const rows = kind === 'series' ? await searchSeries(q) : await searchArtists(q);
      if (lastQuery !== `${kind}:${q}`) return; // a newer search is already running
      results.innerHTML = rows.length
        ? `<ul class="follow-results">${rows
            .map((r) =>
              kind === 'series'
                ? `<li><span class="follow-item">${r.cover_url ? `<img class="follow-thumb" src="${esc(thumbOf(r.cover_url))}" ${thumbFallback(r.cover_url)} alt="Cover of ${esc(r.label)}" loading="lazy">` : ''}<span><strong>${esc(r.label)}</strong><br><span class="card__meta">${r.issues ? `${r.issues} ${r.issues === 1 ? 'issue' : 'issues'}` : 'Ongoing series · new issues are added as they’re announced'}</span></span></span>
                    <span class="follow-results__act"><button class="btn btn--primary btn--small" type="button" data-fs="${esc(r.key)}">Follow</button></span></li>`
                : `<li><span><strong>${esc(r.name)}</strong><br><span class="card__meta">${r.covers} ${r.covers === 1 ? 'cover' : 'covers'} · ${r.issues} ${r.issues === 1 ? 'book' : 'books'}</span></span>
                    <span class="follow-results__act">
                      <button class="btn btn--primary btn--small" type="button" data-fa="${esc(r.name)}" data-role="cover">Follow covers</button>
                      <button class="btn btn--ghost btn--small" type="button" data-fa="${esc(r.name)}" data-role="creator">Follow books</button></span></li>`,
            )
            .join('')}</ul>${kind === 'artist' ? '<p class="field__hint">Covers = every cover they draw. Books = one cover of each issue they write or draw.</p>' : ''}`
        : '<p class="empty">No matches.</p>';
    } catch (err) {
      note(err.message, true);
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
      const { added } = btn.dataset.fs ? await pull.followSeries(btn.dataset.fs) : await pull.followArtist(btn.dataset.fa, btn.dataset.role);
      btn.textContent = 'Following ✓';
      note(`Following. ${added ? `${added} open ${added === 1 ? 'title was' : 'titles were'} added to your pull list.` : 'New issues will be added automatically.'}`);
      loadOrders(sb, customerId, seenBefore);
    } catch (err) {
      btn.disabled = false;
      note(err.message, true);
    }
  });
}
