// Reusable UI pieces: item cards, the pull list bar, and the review-and-submit
// dialog. Customers add any number of pre-order titles to their pull list; guests
// submit them together as one order, signed-in customers keep a standing list.

import { reserve, getSettings } from './data.js';
import { $, esc, badge, ITEM_BADGES, cover, price, fmtDate, daysUntil, lastReserveDay, cutoffPassed, itemTitle, itemFullTitle } from './site.js';
import { thumbOf, thumbFallback, formatPhone } from './util.js';
import * as list from './reservation-list.js';
import * as pull from './customer.js';

export function focLabel(item) {
  if (!item.foc_date) return '';
  const last = lastReserveDay(item.foc_date);
  const d = daysUntil(last);
  const day = fmtDate(last, { weekday: 'short', month: 'short', day: 'numeric' });
  const text = d < 0 ? 'Order cutoff passed' : d === 0 ? `Add by tonight <span class="card__meta">(${day})</span>` : d === 1 ? `Add by tomorrow night <span class="card__meta">(${day})</span>` : `Add by ${day}`;
  return `<p class="foc${d <= 2 ? ' foc--soon' : ''}"><span aria-hidden="true">⏱</span> ${text}</p>`;
}

export function reserveButton(item) {
  const signedIn = pull.isSignedIn();
  const on = signedIn ? pull.has(item.id) : list.has(item.id);
  const [add, added] = ['Add to pull list', 'On your pull list'];
  return `<button class="btn ${on ? 'btn--ghost' : 'btn--primary'}" data-reserve="${item.id}" aria-pressed="${on}">${
    on ? `<span aria-hidden="true">✓</span> ${added}` : add
  }<span class="visually-hidden"> ${esc(itemFullTitle(item))}</span></button>`;
}

/** Signed-in customers can pull every open cover of an issue in one tap. */
export function variantsButton(item) {
  if (!pull.isSignedIn() || !item.variant) return '';
  return `<button class="btn btn--ghost" type="button" data-variants="${item.id}">Add all covers<span class="visually-hidden"> of ${esc(itemTitle(item))}</span></button>`;
}

const SKIP_NAMES = new Set(['various', 'various artists', 'tbd', 'tba', 'unknown', 'n a', 'none']);

/** The people credited on a title, one entry per person. */
export function creatorNames(item) {
  const seen = new Map();
  for (const raw of String(item.creators ?? '').split(/\s*[,;/]\s*|\s+&\s+|\s+and\s+/i)) {
    const name = raw.trim().replace(/\s+/g, ' ');
    const key = pull.personKey(name);
    if (name.length >= 3 && key && !SKIP_NAMES.has(key) && !seen.has(key)) seen.set(key, name);
  }
  return [...seen].map(([key, name]) => ({ key, name, onCover: !!item.variant && item.variant.toLowerCase().includes(name.toLowerCase()) }));
}

/** Is there anything on this title to follow (a series, or credited people)? */
const canFollow = (item) => !!(item.series_key && item.issue_number) || creatorNames(item).length > 0;

/** A quiet link under the card's buttons; the choices open in a dialog where there is room to read them. */
export function followButton(item) {
  if (!pull.isSignedIn() || !canFollow(item)) return '';
  return `<button class="follow-open" type="button" data-follow-open="${item.id}">+ Follow<span class="follow-open__more"> series / artist</span><span class="visually-hidden"> for ${esc(itemTitle(item))}</span></button>`;
}

/** "+ Follow Series" under a title that belongs to a series (New Arrivals cards). Opens the same follow dialog; signed-out visitors are sent to sign in. */
function seriesFollowLink(item) {
  if (!item.series_key || !item.issue_number) return '';
  if (!pull.isSignedIn()) return '<a class="follow-open" href="account.html">+ Sign in to follow<span class="visually-hidden"> series</span></a>';
  const on = !!pull.findSubscription('series', item.series_key);
  return `<button class="follow-open${on ? ' follow-open--on' : ''}" type="button" data-follow-open="${item.id}" data-series-follow="${esc(item.series_key)}">${on ? '✓ Following' : '+ Follow'}<span class="follow-open__more"> Series</span><span class="visually-hidden"> ${esc(item.title)}</span></button>`;
}

const toggleBtn = (on, attrs, label, hint) =>
  `<button class="follow-choice${on ? ' is-on' : ''}" type="button" ${attrs} aria-pressed="${on}"><span class="follow-choice__label">${on ? '✓ ' : ''}${esc(label)}</span>${hint ? `<span class="follow-choice__hint">${esc(hint)}</span>` : ''}</button>`;

function followBody(item) {
  const parts = [];
  if (item.series_key && item.issue_number) {
    const on = !!pull.findSubscription('series', item.series_key);
    parts.push(`<section class="follow-group"><h3>Series</h3>
      <div class="follow-person"><strong>${esc(item.title)}</strong>
        <div class="follow-choices">${toggleBtn(on, `data-follow-series="${esc(item.series_key)}" data-label="${esc(item.title)}"`, on ? 'Following this series' : 'Follow this series', 'One cover of every new issue')}</div></div></section>`);
  }
  const people = creatorNames(item).slice(0, 8);
  if (people.length) {
    parts.push(`<section class="follow-group"><h3>People on this book</h3>${people
      .map((p) => {
        const cover = !!pull.findSubscription('artist', p.key, 'cover');
        const creator = !!pull.findSubscription('artist', p.key, 'creator');
        return `<div class="follow-person"><strong>${esc(p.name)}</strong>${p.onCover ? ' <span class="follow-person__tag">drew this cover</span>' : ''}
          <div class="follow-choices">
            ${toggleBtn(cover, `data-follow-artist="${esc(p.name)}" data-role="cover" data-label="${esc(p.name)}"`, 'Cover artist', 'Every cover they draw')}
            ${toggleBtn(creator, `data-follow-artist="${esc(p.name)}" data-role="creator" data-label="${esc(p.name)}"`, 'Writer / artist', 'One cover of each issue they work on')}
          </div></div>`;
      })
      .join('')}</section>`);
  }
  return parts.join('');
}

let followDialog;
let followItem = null;
let followHooked = false;

function createFollowDialog() {
  const d = document.createElement('dialog');
  d.className = 'follow-dialog';
  d.setAttribute('aria-labelledby', 'fd-title');
  d.innerHTML = `
    <div class="dialog__head">
      <h2 id="fd-title">Follow</h2>
      <button class="dialog__close" type="button" aria-label="Close">✕</button>
    </div>
    <div class="dialog__body">
      <p class="card__meta follow-dialog__for"></p>
      <p class="follow-dialog__intro">New issues from anything you follow are added to your pull list automatically, until the order cutoff. Remove any you don’t want from your list.</p>
      <div data-follow-body></div>
      <p class="follow-dialog__status" role="status" data-follow-status></p>
      <div class="follow-dialog__foot">
        <button class="btn btn--primary" type="button" data-close>Done</button>
        <a href="account.html">Everything I follow</a>
      </div>
    </div>`;
  document.body.append(d);
  d.addEventListener('close', () => d.returnFocusTo?.isConnected && d.returnFocusTo.focus());
  d.addEventListener('click', (e) => {
    if (e.target === d || e.target.closest('.dialog__close, [data-close]')) return d.close();
    const btn = e.target.closest('[data-follow-series], [data-follow-artist]');
    if (btn) toggleFollow(btn, (msg) => ($('[data-follow-status]', d).textContent = msg));
  });
  return d;
}

function renderFollowBody() {
  const body = $('[data-follow-body]', followDialog);
  const focused = document.activeElement?.closest?.('[data-follow-series], [data-follow-artist]');
  body.innerHTML = followBody(followItem);
  // Keep keyboard focus on the same choice after the list redraws.
  if (focused) {
    const sel = focused.dataset.followSeries ? `[data-follow-series="${CSS.escape(focused.dataset.followSeries)}"]` : `[data-follow-artist="${CSS.escape(focused.dataset.followArtist)}"][data-role="${focused.dataset.role}"]`;
    $(sel, body)?.focus();
  }
}

function openFollowDialog(item, opener) {
  if (!item) return;
  followDialog ??= createFollowDialog();
  followItem = item;
  followDialog.returnFocusTo = opener;
  $('.follow-dialog__for', followDialog).textContent = itemFullTitle(item);
  $('[data-follow-status]', followDialog).textContent = '';
  renderFollowBody();
  followDialog.showModal();
}

export function collectorBadges(item) {
  const on = Object.entries(ITEM_BADGES).filter(([k]) => item.badges?.includes(k));
  return on.length ? `<ul class="chips" aria-label="Collector notes">${on.map(([, l]) => `<li>${esc(l)}</li>`).join('')}</ul>` : '';
}

/** Titles shown on this page, so the details dialog can open them without another trip to the database. */
export const seenItems = new Map();

/** `level` is the heading level of the title: 3 under a section heading, 2 on pages that only have the page title above the grid. */
/** The white "Top 10" circle shown on the cover of the ten most-reserved titles (cards and the details dialog). */
export const topBadge = () =>
  '<span class="top-badge" title="One of our 10 most reserved titles"><span class="top-badge__top">Top</span><span class="top-badge__num" aria-hidden="true">10</span><span class="visually-hidden"> 10 most reserved</span></span>';

export function itemCard(item, { reservable = false, level = 3, followSeries = false } = {}) {
  seenItems.set(item.id, item);
  const meta = [item.publisher, item.release_date && `Out ${fmtDate(item.release_date)}`, price(item.price), item.mature && 'Mature readers'].filter(Boolean);
  const open = reservable && item.status === 'pre_order' && !cutoffPassed(item);
  return `
    <article class="card">
      <div class="card__media${item.top10 ? ' has-top-badge' : ''}">
        <button class="card__open" type="button" data-title-open="${item.id}" tabindex="-1" aria-hidden="true">${cover(item)}</button>
        ${item.top10 ? topBadge() : ''}
        ${item.staff_pick ? '<span class="pick-badge"><span aria-hidden="true">★</span> Staff Pick</span>' : ''}
      </div>
      <div class="card__body">
        <div>${badge(item.status)}</div>
        ${collectorBadges(item)}
        <h${level} class="card__title"><button class="card__title-open" type="button" data-title-open="${item.id}">${esc(itemTitle(item))}<span class="visually-hidden"> (details)</span></button></h${level}>
        ${item.variant ? `<p class="card__variant">${esc(item.variant)}</p>` : ''}
        <p class="card__meta">${meta.map(esc).join(' · ')}</p>
        ${reservable ? focLabel(item) : ''}
        ${open ? `<div class="card__foot">${reserveButton(item)}${variantsButton(item)}</div>${followButton(item)}` : followSeries ? seriesFollowLink(item) : ''}
      </div>
    </article>`;
}

/** Series search results as cards, with a Follow link under each. `rows` come from searchSeries(). */
export function seriesCards(rows) {
  return rows
    .map(
      (r, n) => `<article class="card">
        <div class="card__media">${r.cover_url ? `<img class="cover" src="${esc(thumbOf(r.cover_url))}" ${thumbFallback(r.cover_url)} alt="Cover of ${esc(r.label)}" ${n < 4 ? 'fetchpriority="high"' : 'loading="lazy"'}>` : '<div class="cover cover--placeholder" aria-hidden="true">Image coming soon</div>'}</div>
        <div class="card__body">
          <h3 class="card__title">${esc(r.label)}</h3>
          <p class="card__meta">${r.issues ? `Series · ${r.issues} ${r.issues === 1 ? 'issue' : 'issues'} listed` : 'Ongoing series · new issues are added as they’re announced'}</p>
          ${pull.isSignedIn()
            ? (pull.findSubscription('series', r.key)
              ? '<span class="follow-open follow-open--on">✓ Following this series</span>'
              : `<button class="follow-open" type="button" data-follow="${esc(r.key)}">+ Follow<span class="follow-open__more"> this series</span><span class="visually-hidden"> ${esc(r.label)}</span></button>`)
            : '<a class="follow-open" href="account.html">+ Sign in to follow<span class="visually-hidden"> this series</span></a>'}
          <p class="card__meta" role="status" data-msg></p>
        </div></article>`,
    )
    .join('');
}

/**
 * Artists and writers from searchArtists(), as a short list with follow buttons (site search).
 * issues = 0 means the name only appears in cover text (a variant cover artist): covers only, no books to follow.
 */
export function artistRows(rows) {
  const btn = (r, role, label) => {
    const on = pull.findSubscription('artist', pull.personKey(r.name), role);
    return on
      ? `<span class="btn btn--ghost btn--small is-on" aria-disabled="true">✓ Following ${role === 'cover' ? 'covers' : 'books'}</span>`
      : `<button class="btn ${role === 'cover' ? 'btn--primary' : 'btn--ghost'} btn--small" type="button" data-follow-artist="${esc(r.name)}" data-role="${role}">${label}<span class="visually-hidden"> by ${esc(r.name)}</span></button>`;
  };
  return `<ul class="follow-results">${rows
    .map(
      (r) => `<li><span><strong>${esc(r.name)}</strong><br><span class="card__meta">${r.covers} ${r.covers === 1 ? 'cover' : 'covers'}${r.issues ? ` · ${r.issues} ${r.issues === 1 ? 'book' : 'books'}` : ''}</span></span>
        <span class="follow-results__act">${pull.isSignedIn()
          ? `${btn(r, 'cover', 'Follow covers')}${r.issues ? btn(r, 'creator', 'Follow books') : ''}`
          : `<a class="btn btn--ghost btn--small" href="account.html">Sign in to follow<span class="visually-hidden"> ${esc(r.name)}</span></a>`}</span></li>`,
    )
    .join('')}</ul>
    ${pull.isSignedIn() ? '<p class="field__hint">Covers = every cover they draw. Books = one cover of each issue they write or draw. New ones are added to your pull list automatically.</p>' : ''}
    <p class="card__meta" role="status" data-msg></p>`;
}

/** Make the Follow buttons from artistRows() work (call once per container; `render` redraws it after a follow). */
export function enableArtistFollow(root, render) {
  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-follow-artist]');
    if (!btn) return;
    btn.disabled = true;
    const say = (text) => ($('[data-msg]', root) ?? {}).textContent = text;
    try {
      const { added } = await pull.followArtist(btn.dataset.followArtist, btn.dataset.role);
      render();
      say(`Following ${btn.dataset.followArtist}. ${added ? `${added} open ${added === 1 ? 'title was' : 'titles were'} added to your pull list.` : 'New ones will be added to your pull list automatically.'}`);
    } catch (err) {
      btn.disabled = false;
      say(err.message);
    }
  });
}

/** Make the Follow buttons inside series cards work (call once per container). */
export function enableSeriesFollow(root) {
  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-follow]');
    if (!btn) return;
    const msg = $('[data-msg]', btn.closest('.card'));
    btn.disabled = true;
    try {
      const { added } = await pull.followSeries(btn.dataset.follow);
      btn.outerHTML = '<span class="follow-open follow-open--on">✓ Following this series</span>';
      msg.textContent = added ? `${added} open ${added === 1 ? 'title was' : 'titles were'} added to your pull list.` : 'New issues will be added to your pull list automatically.';
    } catch (err) {
      btn.disabled = false;
      msg.textContent = err.message;
    }
  });
}

export function renderGrid(el, items, opts, emptyText = 'Nothing here right now — check back soon.') {
  el.innerHTML = items.length ? items.map((i) => itemCard(i, opts)).join('') : `<p class="empty">${esc(emptyText)}</p>`;
}

// ---------------------------------------------------------------------------
// Add-to-list buttons
// ---------------------------------------------------------------------------

/**
 * Wire up add-to-list buttons inside `root`. `lookup(id)` returns the item.
 * Buttons toggle: pressing "On your list" takes the title back off.
 */
let detailsRequested = false;
export function enableReservations(root, lookup) {
  // The title details dialog (click a cover) loads on first use; it wires its own buttons the same way.
  if (!detailsRequested) {
    detailsRequested = true;
    import('./title-modal.js').then((m) => m.init()).catch((err) => console.error('Title details failed to load', err));
  }
  root.addEventListener('click', async (e) => {
    const variants = e.target.closest('[data-variants]');
    if (variants) return addAllCovers(variants, lookup(Number(variants.dataset.variants)));
    const followOpen = e.target.closest('[data-follow-open]');
    if (followOpen) return openFollowDialog(lookup(Number(followOpen.dataset.followOpen)), followOpen);
    const btn = e.target.closest('[data-reserve]');
    if (!btn) return;
    const item = lookup(Number(btn.dataset.reserve));
    if (!item) return;
    if (pull.isSignedIn()) return togglePullList(btn, item);
    if (list.has(item.id)) {
      list.remove(item.id);
      announce(`Removed ${itemFullTitle(item)} from your pull list.`);
    } else {
      list.add(item);
      announce(`Added ${itemFullTitle(item)}. ${list.count()} ${list.count() === 1 ? 'title' : 'titles'} on your pull list.`);
    }
    btn.focus();
  });
  // Update buttons in place (not re-rendered) so keyboard focus stays put.
  const refresh = () => {
    root.querySelectorAll('[data-reserve]').forEach((btn) => {
      const item = lookup(Number(btn.dataset.reserve));
      if (!item) return;
      const tmp = document.createElement('div');
      tmp.innerHTML = reserveButton(item);
      const fresh = tmp.firstElementChild;
      btn.className = fresh.className;
      btn.setAttribute('aria-pressed', fresh.getAttribute('aria-pressed'));
      btn.innerHTML = fresh.innerHTML;
    });
  };
  const refreshSeriesLinks = () => {
    root.querySelectorAll('[data-series-follow]').forEach((btn) => {
      const on = !!pull.findSubscription('series', btn.dataset.seriesFollow);
      btn.classList.toggle('follow-open--on', on);
      btn.firstChild.textContent = on ? '✓ Following' : '+ Follow';
    });
  };
  list.onChange(refresh);
  pull.onChange(refresh);
  pull.onChange(refreshSeriesLinks);
  // The follow dialog redraws when a follow is added or removed.
  if (!followHooked) {
    followHooked = true;
    pull.onChange(() => followDialog?.open && renderFollowBody());
  }
}

/** Follow or unfollow; `say` shows the outcome (in the dialog's status line). */
async function toggleFollow(btn, say) {
  btn.disabled = true;
  try {
    const series = btn.dataset.followSeries;
    const name = btn.dataset.followArtist;
    const label = btn.dataset.label ?? name ?? 'this series';
    const sub = series ? pull.findSubscription('series', series) : pull.findSubscription('artist', pull.personKey(name), btn.dataset.role);
    if (sub) {
      await pull.unfollow(sub.id);
      say(`Stopped following ${sub.label}.`);
    } else {
      const { added } = series ? await pull.followSeries(series) : await pull.followArtist(name, btn.dataset.role);
      say(`Following ${label}. ${added ? `${added} open ${added === 1 ? 'title was' : 'titles were'} added to your pull list.` : 'New issues will be added to your pull list automatically.'}`);
    }
  } catch (err) {
    say(err.message);
  } finally {
    btn.disabled = false;
  }
}

async function togglePullList(btn, item) {
  btn.disabled = true;
  try {
    const line = pull.lineFor(item.id);
    if (line) {
      await pull.remove(line.id);
      announce(`Removed ${itemFullTitle(item)} from your pull list.`);
    } else {
      await pull.add(item.id);
      announce(`Added ${itemFullTitle(item)}. ${pull.count()} ${pull.count() === 1 ? 'title' : 'titles'} on your pull list.`);
    }
  } catch (err) {
    announce(err.message);
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.focus();
  }
}

async function addAllCovers(btn, item) {
  if (!item || !confirm(`Add every open cover of ${itemTitle(item)} to your pull list, one copy of each?\n\nYou can remove any you don't want from My Pull List.`)) return;
  btn.disabled = true;
  try {
    const { added, skipped } = await pull.addVariants(item.id);
    const msg = `Added ${added} ${added === 1 ? 'cover' : 'covers'} to your pull list${skipped ? ` (${skipped} already on your list or not available)` : ''}.`;
    announce(msg);
    alert(msg);
  } catch (err) {
    announce(err.message);
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.focus();
  }
}

let liveRegion;
function announce(msg) {
  liveRegion ??= Object.assign(document.body.appendChild(document.createElement('p')), { className: 'visually-hidden' });
  liveRegion.setAttribute('role', 'status');
  liveRegion.textContent = msg;
}

// ---------------------------------------------------------------------------
// Floating list bar (shown on every page while the list has titles)
// ---------------------------------------------------------------------------

/** Count badge on the "My Pull List" nav link (signed in only; 0 removes it). */
/** Pull-list count on the "My Pull List" nav link, plus a gold "N new" when follows have added titles since the last visit. */
function renderNavBadge(n, fresh = 0) {
  const link = $('.nav a[href="account.html"]');
  if (!link) return;
  let badgeEl = $('.nav-badge:not(.nav-badge--new)', link);
  let newEl = $('.nav-badge--new', link);
  if (!n) return badgeEl?.remove(), newEl?.remove(), link.removeAttribute('aria-label');
  if (!badgeEl) {
    badgeEl = Object.assign(document.createElement('span'), { className: 'nav-badge' });
    link.append(' ', badgeEl);
  }
  badgeEl.textContent = n;
  if (fresh) {
    newEl ??= Object.assign(document.createElement('span'), { className: 'nav-badge nav-badge--new' });
    if (!newEl.isConnected) badgeEl.after(' ', newEl);
    newEl.textContent = `${fresh} new`;
  } else newEl?.remove();
  link.setAttribute('aria-label', `My Pull List, ${n} ${n === 1 ? 'title' : 'titles'}${fresh ? `, ${fresh} new from what you follow` : ''}`);
}

export function initReservationBar() {
  const bar = document.createElement('div');
  bar.className = 'list-bar';
  bar.innerHTML = `<div class="container list-bar__inner">
      <p class="list-bar__text"></p>
      <button class="btn btn--primary" type="button"></button>
    </div>`;
  document.body.append(bar);
  const button = $('button', bar);
  button.addEventListener('click', (e) => (pull.isSignedIn() ? (location.href = 'account.html') : openListDialog(e.currentTarget)));

  const render = () => {
    const signedIn = pull.isSignedIn();
    const n = signedIn ? pull.count() : list.count();
    const copies = signedIn ? n : list.getLines().reduce((sum, l) => sum + l.quantity, 0);
    // Signed in, the pull list lives on the account page and the nav link carries the count, so the bar is guests only.
    bar.hidden = n === 0 || signedIn;
    renderNavBadge(signedIn ? n : 0, signedIn ? pull.newCount() : 0);
    document.body.classList.toggle('has-list-bar', !bar.hidden);
    button.textContent = 'Review my pull list';
    $('.list-bar__text', bar).innerHTML = `<strong>Your Pull List</strong> · ${n} ${n === 1 ? 'title' : 'titles'}${copies > n ? `, ${copies} copies` : ''}`;
  };
  list.onChange(render);
  pull.onChange(render);
  render();
}

// ---------------------------------------------------------------------------
// Review-and-submit dialog (guests)
// ---------------------------------------------------------------------------

let dialog;

async function openListDialog(opener) {
  const s = await getSettings();
  dialog ??= createDialog();
  dialog.returnFocusTo = opener;
  const form = $('form', dialog);
  form.hidden = false;
  $('.confirm', dialog).hidden = true;
  $('.form-error', dialog).textContent = '';
  $('#r-qty-hint', dialog).textContent = `Up to ${s.max_copies_per_title} copies per customer per title.`;
  renderLines(s);
  dialog.showModal();
  $('#r-first', dialog).focus();
}

function renderLines(s) {
  const lines = list.getLines();
  const el = $('.list-lines', dialog);
  const submit = $('button[type=submit]', dialog);
  submit.disabled = lines.length === 0;
  submit.textContent = lines.length > 1 ? `Submit ${lines.length} titles` : 'Submit pull list';
  if (!lines.length) {
    el.innerHTML = '<p class="empty">Your list is empty. Tap <strong>Add to pull list</strong> on any pre-order title.</p>';
    return;
  }
  el.innerHTML = lines
    .map(
      ({ item, quantity }) => `
      <li class="list-line">
        ${cover(item)}
        <div class="list-line__info">
          <strong>${esc(itemFullTitle(item))}</strong>
          <span class="card__meta">${esc([item.publisher, item.release_date && `Out ${fmtDate(item.release_date)}`, price(item.price)].filter(Boolean).join(' · '))}</span>
          ${focLabel(item)}
        </div>
        <div class="list-line__controls">
          <label class="visually-hidden" for="q-${item.id}">Quantity for ${esc(itemFullTitle(item))}</label>
          <input class="list-line__qty" id="q-${item.id}" type="number" inputmode="numeric" min="1" max="${s.max_copies_per_title}" value="${quantity}" data-qty="${item.id}">
          <button class="list-line__remove" type="button" data-remove="${item.id}">Remove<span class="visually-hidden"> ${esc(itemFullTitle(item))}</span></button>
        </div>
      </li>`,
    )
    .join('');
}

function createDialog() {
  const d = document.createElement('dialog');
  d.className = 'list-dialog';
  d.setAttribute('aria-labelledby', 'r-title');
  d.innerHTML = `
    <div class="dialog__head">
      <h2 id="r-title">Your Pull List</h2>
      <button class="dialog__close" type="button" aria-label="Close">✕</button>
    </div>
    <div class="dialog__body">
      <form novalidate>
        <ul class="list-lines" aria-label="Titles on your pull list"></ul>
        <p class="field__hint" id="r-qty-hint"></p>
        <h3 class="list-dialog__sub">Your Details</h3>
        <div class="list-dialog__names">
          <div class="field">
            <label for="r-first">First name</label>
            <input id="r-first" name="first_name" autocomplete="given-name" required maxlength="60">
          </div>
          <div class="field">
            <label for="r-last">Last name</label>
            <input id="r-last" name="last_name" autocomplete="family-name" required maxlength="60">
          </div>
        </div>
        <div class="field">
          <label for="r-phone">Phone</label>
          <input id="r-phone" name="phone" type="tel" autocomplete="tel" required maxlength="40">
        </div>
        <div class="field">
          <label for="r-email">Email</label>
          <input id="r-email" name="email" type="email" autocomplete="email" required maxlength="254">
          <p class="field__hint">We’ll email you a confirmation copy.</p>
        </div>
        <div class="honeypot" aria-hidden="true">
          <label for="r-website">Website</label>
          <input id="r-website" name="website" tabindex="-1" autocomplete="off">
        </div>
        <p class="notice">No payment now — pay in-store at pickup.</p>
        <p class="field__hint"><a href="account.html">Sign in or create an account</a> to keep your pull list, change it online and follow series and artists.</p>
        <p class="form-error" role="alert"></p>
        <button class="btn btn--primary" type="submit" style="width:100%">Submit pull list</button>
      </form>
      <div class="confirm" hidden role="status">
        <p class="confirm__big">You're on the list!</p>
        <p class="confirm__text"></p>
        <ul class="confirm__lines"></ul>
        <p><strong>Pay in-store at pickup.</strong></p>
        <p class="card__meta confirm__policy"></p>
        <button class="btn" type="button" data-close>Done</button>
      </div>
    </div>`;
  document.body.append(d);

  d.addEventListener('close', () => d.returnFocusTo?.isConnected && d.returnFocusTo.focus());
  d.addEventListener('click', async (e) => {
    if (e.target === d || e.target.closest('.dialog__close, [data-close]')) return d.close();
    const rm = e.target.closest('[data-remove]');
    if (rm) {
      const li = rm.closest('li');
      const neighbour = (li.nextElementSibling ?? li.previousElementSibling)?.querySelector('[data-remove]')?.dataset.remove;
      list.remove(Number(rm.dataset.remove));
      renderLines(await getSettings());
      // Keep keyboard focus in the list rather than dropping it on <body>.
      (neighbour ? $(`[data-remove="${neighbour}"]`, d) : $('#r-first', d)).focus();
    }
  });
  d.addEventListener('change', async (e) => {
    const input = e.target.closest('[data-qty]');
    if (!input) return;
    const s = await getSettings();
    const q = Math.min(Math.max(Math.round(Number(input.value)) || 1, 1), s.max_copies_per_title);
    input.value = q;
    list.setQuantity(Number(input.dataset.qty), q);
  });

  const form = $('form', d);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.form-error', d);
    const fd = new FormData(form);
    const s = await getSettings();
    const lines = list.getLines();
    const data = {
      first: fd.get('first_name').trim(),
      last: fd.get('last_name').trim(),
      phone: fd.get('phone').trim(),
      email: fd.get('email').trim(),
      website: fd.get('website'),
      lines: lines.map((l) => ({ itemId: l.item.id, quantity: l.quantity })),
    };

    err.textContent = '';
    if (!lines.length) return fail('Your list is empty.');
    const expired = lines.find((l) => cutoffPassed(l.item));
    if (expired) return fail(`The order cutoff for ${itemFullTitle(expired.item)} has passed — please remove it from your list.`, `[data-remove="${expired.item.id}"]`);
    const badQty = lines.find((l) => !Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > s.max_copies_per_title);
    if (badQty) return fail(`Quantity for ${itemFullTitle(badQty.item)} must be between 1 and ${s.max_copies_per_title}.`, `[data-qty="${badQty.item.id}"]`);
    if (!data.first) return fail('Please enter your first name.', '#r-first');
    if (!data.last) return fail('Please enter your last name.', '#r-last');
    data.name = `${data.first} ${data.last}`; // the order stores one name
    if (!data.phone) return fail('Please enter your phone number so we can reach you.', '#r-phone');
    if (!data.email) return fail('Please enter your email address.', '#r-email');
    if (!$('#r-email', d).checkValidity()) return fail('That email address doesn’t look right.', '#r-email');

    const submit = $('button[type=submit]', form);
    const label = submit.textContent;
    submit.disabled = true;
    submit.textContent = 'Saving…';
    try {
      await reserve(data);
      form.hidden = true;
      $('.confirm__text', d).textContent = `Pull list saved for ${data.name}.${data.email ? ` A confirmation is on its way to ${data.email}.` : ''}`;
      $('.confirm__lines', d).innerHTML = lines.map((l) => `<li>${l.quantity} × ${esc(itemFullTitle(l.item))}</li>`).join('');
      $('.confirm__policy', d).textContent = `We'll hold each title for ${Math.round(s.hold_days / 30) === 1 ? '1 month' : `${s.hold_days} days`} after it arrives. To change or cancel, call the shop${s.phone ? ` at ${formatPhone(s.phone)}` : ''}.`;
      $('.confirm', d).hidden = false;
      $('[data-close]', d).focus();
      window.gtag?.('event', 'reserve', { titles: lines.length, copies: lines.reduce((n, l) => n + l.quantity, 0) });
      form.reset();
      list.clear();
    } catch (ex) {
      fail(ex.message);
    } finally {
      submit.disabled = list.count() === 0;
      submit.textContent = label;
    }

    function fail(msg, focusSel) {
      err.textContent = msg;
      if (focusSel) $(focusSel, d)?.focus();
    }
  });
  return d;
}
