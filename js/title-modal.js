// Title details dialog: click a cover on any card to see the full title, its other covers and the
// same buttons the card has. The address gets ?title=<id> while it is open, so a title can be linked
// to, and the browser's back button closes it.

import { getItem, getVariants, getTopReserved } from './data.js';
import { $, esc, badge, price, fmtDate, itemTitle, cover, cutoffPassed, shownStatus, shopToday } from './site.js';
import { enableReservations, seenItems, focLabel, reserveButton, variantsButton, followButton, creatorNames, collectorBadges, topBadge } from './components.js';

let dialog;
let topIds = new Set(); // ids of the ten most-reserved titles (for the badge)
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
    <div>${badge(shownStatus(item))}</div>
    ${collectorBadges(item)}
    <h2 id="tm-title" class="title-modal__title">${esc(itemTitle(item))}</h2>
    ${item.variant ? `<p class="card__variant">${esc(item.variant)}</p>` : ''}
    <p class="card__meta">${meta.map(esc).join(' · ')}</p>
    ${when ? `<p class="title-modal__when"><strong>${item.release_date > shopToday() ? 'Out' : 'Released'}</strong> ${esc(when)}</p>` : ''}
    ${item.status === 'pre_order' ? focLabel(item) : ''}
    ${open ? `<div class="card__foot">${reserveButton(item)}${variantsButton(item)}</div>${followButton(item)}` : ''}
    ${item.status !== 'pre_order' ? '<p class="notice">In-store titles can’t be held or reserved: first to pay gets it. Want a guaranteed copy of something upcoming? <a href="pre-orders.html">Pre-order it</a>.</p>' : ''}
    ${item.description ? `<div class="title-modal__desc">${paragraphs(item.description)}</div>` : ''}
    ${people.length ? `<ul class="chips" aria-label="Creators">${people.map((p) => `<li>${esc(p.name)}</li>`).join('')}</ul>` : ''}
    ${item.isbn ? `<p class="card__meta">ISBN ${esc(item.isbn)}</p>` : ''}`;
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
  d.addEventListener('click', async (e) => {
    if (e.target === d || e.target.closest('.dialog__close')) return d.close();
    const thumb = e.target.closest('[data-title-switch]');
    if (thumb) {
      const next = covers.find((v) => v.id === Number(thumb.dataset.titleSwitch));
      if (!next) return;
      current = next;
      history.replaceState(history.state, '', urlWith(next.id));
      render();
      $(`[data-title-switch="${next.id}"]`, d)?.focus();
    }
  });
  d.addEventListener('close', () => {
    d.returnFocusTo?.isConnected && d.returnFocusTo.focus();
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

async function open(id, { push = true, opener = null } = {}) {
  const item = seenItems.get(id) ?? (await getItem(id).catch((err) => (console.error(err), null)));
  if (!item) {
    if (new URLSearchParams(location.search).has('title')) history.replaceState(history.state, '', urlWith(null));
    return;
  }
  topIds = await getTopReserved();
  dialog ??= create();
  current = item;
  covers = [item];
  dialog.returnFocusTo = opener;
  render();
  if (!dialog.open) dialog.showModal();
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
      dialog.close();
    }
  });
  const linked = Number(new URLSearchParams(location.search).get('title'));
  if (linked > 0) open(linked, { push: false });
}
