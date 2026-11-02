// Title details dialog: click a cover on any card to see the full title, its other covers and the
// same buttons the card has. The address gets ?title=<id> while it is open, so a title can be linked
// to, and the browser's back button closes it.

import { getItem, getVariants, getTopReserved, getSettings, getCategories } from './data.js';
import { SITE_URL } from './config.js';
import { titleUrl, releaseIcs, releaseGoogleLink } from './ics.js';
import { $, esc, badge, price, fmtDate, itemTitle, cover, cutoffPassed, shopToday, isPhone, focusBackOnClose, motionMs } from './site.js';
import { prefersReducedMotion } from './util.js';
import * as pull from './customer.js';
import { buzzOnCross, haptic } from './app-device.js';
import { enableReservations, seenItems, focLabel, reserveButton, variantsButton, followButton, creatorNames, collectorBadges, topBadge } from './components.js';

let dialog;
let topIds = new Set(); // ids of the ten most-reserved titles (for the badge)
let shopName = ''; // for the calendar links
let alertOn = null; // the shown title: true/false once known whether the customer asked to hear when it's in

// "Tell me when it's in": in the app, signed in, for a title that can't be reserved and isn't on the shelf now (and
// that the customer can't simply order a copy of instead).
const APP = document.body.dataset.page === 'app';
const canAlert = (item) => APP && pull.isSignedIn() && ['sold_out', 'backorder', 'coming_soon'].includes(item.status) && !canReorder(item);
const pushOff = () => !('Notification' in window) || Notification.permission !== 'granted';
const alertHtml = (item) => {
  if (!canAlert(item) || alertOn == null) return '';
  return `<div class="title-modal__alert">
      <button class="btn ${alertOn ? 'btn--ghost' : 'btn--primary'}" type="button" data-stock-alert aria-pressed="${alertOn}">${alertOn ? '✓ We’ll tell you when it’s in' : 'Notify me when it’s in'}</button>
      <p class="card__meta" role="status" data-stock-alert-msg>${alertOn && pushOff() ? 'Turn on notifications on the Account tab to get it.' : ''}</p>
    </div>`;
};
// A signed-in customer can ask the shop to order a copy (a re-order): of a trade or omnibus once it's out (they stay in
// print), or of a comic, trade or omnibus that's Coming Soon (past the pre-order cutoff, when most re-orders happen).
const REORDER_SLUGS = ['comics', 'trades', 'omnibuses'];
let reorderCats = null; // category id → slug for those, once loaded
const UPCOMING = ['pre_order', 'coming_soon']; // not out yet
const canReorder = (item) => {
  const slug = reorderCats?.get(item.category_id);
  if (!slug || item.status === 'pre_order') return false;
  return item.status === 'coming_soon' || (slug !== 'comics' && !(item.release_date > shopToday()));
};
const reorderHtml = (item) => {
  const action = !pull.isSignedIn()
    ? `<a class="btn btn--primary" href="account.html">Sign in to order a copy</a>`
    : pull.has(item.id)
      ? `<span class="btn btn--ghost" aria-disabled="true"><span aria-hidden="true">✓</span> On your pull list</span>`
      : `<button class="btn btn--primary" type="button" data-reorder>Order a copy<span class="visually-hidden"> of ${esc(itemTitle(item))}</span></button>`;
  return `<div class="title-modal__alert">
      <p class="notice">${item.status === 'coming_soon' ? 'Missed the pre-order? We can still order a copy' : 'Not on the shelf, or want one kept for you? We can order a copy'}: it goes on your pull list and we’ll let you know when it’s in.</p>
      <div class="card__foot">${action}</div>
      <p class="card__meta" role="status" data-reorder-msg></p>
    </div>`;
};
let current = null; // the title being shown
let covers = []; // every cover of that issue
let pushed = false; // did opening the dialog add a history entry (so closing should go back)?
const known = new Map(); // id → item, for the buttons inside the dialog

const urlWith = (id) => {
  const url = new URL(location.href);
  if (id) url.searchParams.set('title', id);
  else url.searchParams.delete('title');
  return url;
};

// Phones open their share sheet; elsewhere the link is copied.
const canShare = () => typeof navigator.share === 'function' || !!navigator.clipboard?.writeText;

const paragraphs = (text) =>
  String(text ?? '')
    .split(/\n{2,}|\r\n\r\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p)}</p>`)
    .join('');

function details(item) {
  const open = item.status === 'pre_order' && !cutoffPassed(item);
  const people = creatorNames(item).slice(0, 10);
  const meta = [item.publisher, price(item.price), item.mature && 'Mature readers'].filter(Boolean);
  const when = item.release_date ? fmtDate(item.release_date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '';
  return `
    <div>${badge(item.status)}</div>
    ${collectorBadges(item)}
    <h2 id="tm-title" class="title-modal__title">${esc(itemTitle(item))}</h2>
    ${item.variant ? `<p class="card__variant">${esc(item.variant)}</p>` : ''}
    <p class="card__meta">${meta.map(esc).join(' · ')}</p>
    ${when ? `<p class="title-modal__when"><strong>${item.release_date > shopToday() ? 'Out' : 'Released'}</strong> ${esc(when)}</p>` : ''}
    ${item.release_date > shopToday() ? `<p class="title-modal__cal"><span>Add to calendar:</span> <a href="#" data-title-ics>Apple / .ics</a> <a href="${esc(releaseGoogleLink(item, shopName))}" target="_blank" rel="noopener">Google</a></p>` : ''}
    ${UPCOMING.includes(item.status) ? focLabel(item) : ''}
    ${open ? `<div class="card__foot">${reserveButton(item)}${variantsButton(item)}</div>${followButton(item)}` : ''}
    ${alertHtml(item)}
    ${canReorder(item) ? reorderHtml(item) : !UPCOMING.includes(item.status) ? '<p class="notice">In-store titles can’t be held or reserved: first to pay gets it. Want a guaranteed copy of something upcoming? <a href="pre-orders.html">Pre-order it</a>.</p>' : ''}
    ${item.description ? `<div class="title-modal__desc">${paragraphs(item.description)}</div>` : ''}
    ${people.length ? `<ul class="chips" aria-label="Creators">${people.map((p) => `<li>${esc(p.name)}</li>`).join('')}</ul>` : ''}
    ${item.isbn ? `<p class="card__meta">ISBN ${esc(item.isbn)}</p>` : ''}
    ${canShare() ? `<p class="title-modal__share"><button class="btn btn--ghost" type="button" data-title-share>Share</button><span class="title-modal__shared" role="status"></span></p>` : ''}`;
}

async function orderCopy(btn) {
  const item = current;
  btn.disabled = true;
  try {
    await pull.reorder(item.id);
    haptic('done');
    if (current !== item) return;
    render();
    $('[data-reorder-msg]', dialog).textContent = `We’ll order ${itemTitle(item)} for you. It’s on your pull list, and we’ll let you know when it’s in.`;
  } catch (err) {
    btn.disabled = false;
    $('[data-reorder-msg]', dialog).textContent = err.message;
  }
}

async function toggleAlert(btn) {
  const item = current;
  const want = !alertOn;
  btn.disabled = true;
  try {
    await pull.setStockAlert(item.id, want);
    if (current !== item) return;
    alertOn = want;
    render();
    const msg = $('[data-stock-alert-msg]', dialog);
    msg.textContent = want
      ? `We’ll send a notification when ${itemTitle(item)} is in.${pushOff() ? ' Turn on notifications on the Account tab to get it.' : ''}`
      : 'You won’t get a notification about this one.';
    $('[data-stock-alert]', dialog)?.focus();
  } catch (err) {
    btn.disabled = false;
    $('[data-stock-alert-msg]', dialog).textContent = err.message;
  }
}

/** Whether the customer asked about this title; shows the button once known. */
async function loadAlert(item) {
  if (!canAlert(item)) return;
  const on = await pull.hasStockAlert(item.id).catch(() => null);
  if (current !== item || on == null) return;
  alertOn = on;
  if (dialog.open) render();
}

/** The release day as a calendar file (the phone offers to add it to its calendar). */
function addToCalendar(item) {
  const blob = new Blob([releaseIcs(item, shopName, new URL(SITE_URL).host)], { type: 'text/calendar' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${itemTitle(item).replace(/[^\w]+/g, '-')}.ics` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function share(btn) {
  const item = current;
  const url = titleUrl(item);
  const said = $('.title-modal__shared', dialog);
  said.textContent = '';
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: itemTitle(item), text: `${itemTitle(item)}${item.variant ? ` (${item.variant})` : ''}`, url });
    } catch {
      /* closed the share sheet */
    }
    return btn.focus();
  }
  try {
    await navigator.clipboard.writeText(url);
    said.textContent = 'Link copied.';
  } catch {
    said.textContent = 'Couldn’t copy the link.';
  }
}

function render() {
  const item = current;
  known.set(item.id, item);
  const thumbs =
    covers.length > 1
      ? `<ul class="title-modal__covers" aria-label="Covers of ${esc(itemTitle(item))}">${covers
          .map(
            (v) => `<li><button type="button" class="title-modal__thumb${v.id === item.id ? ' is-on' : ''}" data-title-switch="${v.id}" aria-pressed="${v.id === item.id}" aria-label="${esc(v.variant || 'Main cover')}">${
              v.cover_url ? `<img src="${esc(v.cover_thumb_url || v.cover_url)}" alt="" loading="lazy" decoding="async">` : '<span class="title-modal__nocover" aria-hidden="true">?</span>'
            }</button></li>`,
          )
          .join('')}</ul><p class="card__meta">${covers.length} covers</p>`
      : '';
  $('[data-tm-body]', dialog).innerHTML = `
    <div class="title-modal__layout">
      <div class="title-modal__media"><div class="title-modal__cover">${cover(item, { full: true })}${topIds.has(item.id) ? topBadge() : ''}</div>${thumbs}</div>
      <div class="title-modal__info">${details(item)}</div>
    </div>`;
}

function create() {
  const d = document.createElement('dialog');
  d.className = 'title-modal';
  d.setAttribute('aria-labelledby', 'tm-title');
  d.innerHTML = `
    <div class="dialog__head title-modal__head"><button class="dialog__close" type="button" aria-label="Close">✕</button></div>
    <div class="dialog__body" data-tm-body></div>`;
  document.body.append(d);
  // Escape slides the sheet away too (on a phone), rather than snapping shut.
  d.addEventListener('cancel', (e) => {
    e.preventDefault();
    dismiss();
  });
  setupSwipe(d);
  d.addEventListener('click', async (e) => {
    if (e.target === d || e.target.closest('.dialog__close')) return dismiss();
    const shareBtn = e.target.closest('[data-title-share]');
    if (shareBtn) return share(shareBtn);
    const alertBtn = e.target.closest('[data-stock-alert]');
    if (alertBtn) return toggleAlert(alertBtn);
    const reorderBtn = e.target.closest('[data-reorder]');
    if (reorderBtn) return orderCopy(reorderBtn);
    if (e.target.closest('[data-title-ics]')) {
      e.preventDefault();
      return addToCalendar(current);
    }
    const thumb = e.target.closest('[data-title-switch]');
    if (thumb) {
      const next = covers.find((v) => v.id === Number(thumb.dataset.titleSwitch));
      if (!next) return;
      current = next;
      alertOn = null; // another cover: ask again
      history.replaceState(history.state, '', urlWith(next.id));
      render();
      loadAlert(next);
      $(`[data-title-switch="${next.id}"]`, d)?.focus();
    }
  });
  focusBackOnClose(d);
  d.addEventListener('close', () => {
    if (pushed) {
      pushed = false;
      history.back();
    } else if (new URLSearchParams(location.search).has('title')) {
      history.replaceState(history.state, '', urlWith(null));
    }
  });
  // Add-to-list and follow buttons inside the dialog behave exactly like the ones on the cards.
  enableReservations(d, (id) => known.get(id));
  return d;
}

// ---------------------------------------------------------------------------
// Phones: the dialog is a sheet over the whole screen (css/site.css). It slides up when it opens, slides down when it
// closes, and a swipe down from the top of its content (or its close bar) puts it away, as a native sheet does.
// ---------------------------------------------------------------------------

const SWIPE_CLOSE = 120; // px dragged down that closes it on release
const SWIPE_FLICK = 0.6; // px per ms: a quick flick closes it even when shorter
const asSheet = () => isPhone() && !prefersReducedMotion();

/** Close the dialog: on a phone it slides down first; elsewhere (or with reduced motion) it closes at once. */
function dismiss() {
  if (!dialog?.open || dialog.classList.contains('is-closing')) return;
  if (!asSheet()) return dialog.close();
  dialog.classList.remove('is-dragging');
  dialog.classList.add('is-closing');
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    dialog.close();
    dialog.classList.remove('is-closing');
    dialog.style.removeProperty('--sheet-drag');
  };
  dialog.addEventListener('transitionend', finish, { once: true });
  setTimeout(finish, motionMs('--dur-sheet') + 120); // in case no transition runs (the sheet was already off screen)
}

function setupSwipe(d) {
  const buzz = buzzOnCross();
  const body = () => $('[data-tm-body]', d);
  let startY = null;
  let startAt = 0;
  let dy = 0;
  d.addEventListener('touchstart', (e) => {
    // Only with one finger, from the close bar or with the content scrolled to its top: otherwise it's a scroll.
    const atTop = body().scrollTop <= 0 || e.target.closest('.title-modal__head');
    startY = asSheet() && atTop && e.touches.length === 1 && !e.target.closest('.title-modal__covers') ? e.touches[0].clientY : null;
    startAt = Date.now();
    dy = 0;
    buzz(false);
  }, { passive: true });
  d.addEventListener('touchmove', (e) => {
    if (startY === null) return;
    dy = Math.max(0, e.touches[0].clientY - startY);
    if (dy > 0 && body().scrollTop > 0) {
      // The content scrolled after all: put the sheet back as it was and let the scroll be.
      startY = null;
      d.classList.remove('is-dragging');
      d.style.removeProperty('--sheet-drag');
      return;
    }
    if (!dy) return; // not moving down (yet): nothing to follow
    d.classList.add('is-dragging');
    d.style.setProperty('--sheet-drag', `${dy}px`);
    buzz(dy > SWIPE_CLOSE); // letting go now closes it
  }, { passive: true });
  const release = () => {
    if (startY === null) return;
    startY = null;
    d.classList.remove('is-dragging');
    buzz(false);
    if (dy > SWIPE_CLOSE || (dy > 40 && dy / Math.max(1, Date.now() - startAt) > SWIPE_FLICK)) return dismiss();
    d.style.removeProperty('--sheet-drag'); // springs back (the sheet's transition)
  };
  d.addEventListener('touchend', release);
  d.addEventListener('touchcancel', release);
}

async function open(id, { push = true, opener = null } = {}) {
  const item = seenItems.get(id) ?? (await getItem(id).catch((err) => (console.error(err), null)));
  if (!item) {
    if (new URLSearchParams(location.search).has('title')) history.replaceState(history.state, '', urlWith(null));
    return;
  }
  topIds = await getTopReserved();
  shopName = (await getSettings().catch(() => ({}))).shop_name ?? '';
  reorderCats ??= await getCategories().then((cats) => new Map(cats.filter((c) => REORDER_SLUGS.includes(c.slug)).map((c) => [c.id, c.slug])), () => null);
  dialog ??= create();
  current = item;
  alertOn = null;
  covers = [item];
  dialog.returnFocusTo = opener;
  render();
  if (!dialog.open) dialog.showModal();
  loadAlert(item);
  if (push) {
    history.pushState({ titleModal: id }, '', urlWith(id));
    pushed = true;
  } else {
    pushed = false;
  }
  // The other covers arrive a moment later.
  const all = await getVariants(item).catch(() => [item]);
  if (current === item && dialog.open) {
    covers = all;
    all.forEach((v) => known.set(v.id, v));
    render();
  }
}

let started = false;
export function init() {
  if (started) return;
  started = true;
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-title-open]');
    if (!btn) return;
    e.preventDefault();
    open(Number(btn.dataset.titleOpen), { opener: btn });
  });
  // Back closes the dialog; forward (or back onto an open title) shows it again.
  window.addEventListener('popstate', (e) => {
    const id = e.state?.titleModal;
    if (id) open(id, { push: false }).then(() => (pushed = true));
    else if (dialog?.open) {
      pushed = false;
      dismiss();
    }
  });
  const linked = Number(new URLSearchParams(location.search).get('title'));
  if (linked > 0) open(linked, { push: false });
}
