// Shared helpers for the admin sections. The rich text editor is in editor.js; pictures and uploads are in images.js.

import { supabase } from '../js/data.js';
import { LOCATIONS_ENABLED } from '../js/config.js';
import { esc, must, formatPhone } from '../js/util.js';
import { friendlyError, fromError } from '../js/errors.js';
import { searchTerm, customerFilter, titleFilter, emailMatch, digitsMatch, anyOf } from './filters.js';
import { ITEM_STATUS } from '../js/labels.js';
import { fmtDateIn, fmtTimeIn } from '../js/dates.js';

export { esc, must, formatPhone };
export { friendlyError, fromError };

export const $ = (sel, root = document) => root.querySelector(sel);
/** A page-unique id for tying a label to its field (`uid('faq-q')` → 'faq-q-7'). A counter, so ids are readable and never collide. */
let lastUid = 0;
export const uid = (prefix = 'id') => `${prefix}-${++lastUid}`;
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const db = () => supabase();

export { searchTerm, customerFilter, titleFilter, emailMatch, digitsMatch, anyOf };

/** Text input for a column of the settings row `s`: `<input name=…>` with label and optional hint. */
export const settingsField = (s) => (name, label, attrs = '', hint = '', cls = '') =>
  `<div class="field${cls ? ` ${cls}` : ''}"><label for="s-${name}">${label}</label><input id="s-${name}" name="${name}" value="${esc(s[name])}" ${attrs}>${hint ? `<p class="field__hint">${hint}</p>` : ''}</div>`;

/** Readers over a submitted FormData: trimmed text (null when empty) and rounded whole numbers (with a fallback). */
export const formReaders = (f) => ({
  text: (k) => f.get(k)?.toString().trim() || null,
  int: (k, fallback) => (f.get(k) ? Math.round(Number(f.get(k))) : fallback),
});

/** Trailing-edge debounce: calls `fn` once, `ms` after the last call. */
/** After a pager's Previous/Next: bring the list's top (`target`) back into view when it has scrolled up out of
 *  sight or under the sticky header, so the new page starts at its first row. Its CSS scroll-margin clears the header. */
export const toListTop = (target) => {
  if (!target) return;
  const margin = parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
  if (target.getBoundingClientRect().top < margin) target.scrollIntoView({ block: 'start' });
};

export const debounce = (fn, ms) => {
  let t;
  return (...a) => (clearTimeout(t), (t = setTimeout(() => fn(...a), ms)));
};

/** Load a <script> from a CDN, rejecting with `failMessage` if it can't be fetched. */
export const loadScript = (src, failMessage) =>
  new Promise((resolve, reject) => {
    const el = Object.assign(document.createElement('script'), { src, async: true, onload: resolve });
    el.onerror = () => reject(new Error(failMessage));
    document.head.append(el);
  });

export function setStatus(el, text, kind = '') {
  el.textContent = text;
  el.classList.toggle('admin-status--error', kind === 'error');
  el.classList.toggle('admin-status--ok', kind === 'ok');
}

/**
 * Small toast in the corner for save/delete confirmations. Pass `link` ({ href, text }) to add a link that goes
 * straight to the thing the toast is about ("Open chat"); a toast with a link stays up longer.
 */
export function toast(text, kind = 'ok', link = null) {
  let box = $('#toasts');
  if (!box) {
    box = Object.assign(document.createElement('div'), { id: 'toasts', className: 'toasts' });
    box.setAttribute('role', 'status');
    document.body.append(box);
  }
  const t = Object.assign(document.createElement('div'), { className: `toast toast--${kind}`, textContent: text });
  if (link) {
    const a = Object.assign(document.createElement('a'), { className: 'toast__link', href: link.href, textContent: link.text });
    a.addEventListener('click', () => t.remove());
    t.append(' ', a);
  }
  box.append(t);
  setTimeout(() => t.remove(), link ? 10000 : kind === 'error' ? 8000 : 3500);
}

/**
 * Dates across the admin: "Oct 23", and "Oct 23, 2025" when it isn't this year. Pass the parts you want to show
 * (weekday: 'short' for a cutoff); the year is added for other years whenever a month is shown. Times are "5:04 PM".
 */
export const fmtDate = (iso, opts = { month: 'short', day: 'numeric' }) =>
  fmtDateIn(iso, opts.month && opts.year === undefined && iso && iso.slice(0, 4) !== String(new Date().getFullYear()) ? { ...opts, year: 'numeric' } : opts);
export const fmtDateTime = (iso) => (iso ? fmtDate(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
export const fmtTime = (when = new Date()) => fmtTimeIn(when);

/** <input type="datetime-local"> value ↔ ISO timestamp (local time). */
export const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
export const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);

/** An all-day event runs from midnight to 11:59 PM (local time); the public site shows its dates, not times. */
export const isAllDay = (e) => {
  if (!e?.ends_at) return false;
  const hm = (iso) => toLocalInput(iso).slice(11);
  return hm(e.starts_at) === '00:00' && hm(e.ends_at) === '23:59';
};
/** A date-and-time for staff lists; an all-day event shows just its date. */
export const fmtEventWhen = (e) => (isAllDay(e) ? fmtDate(e.starts_at, { month: 'short', day: 'numeric' }) + ' · All day' : fmtDateTime(e.starts_at));

export const slugify = (s) =>
  String(s).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').slice(0, 80);

export const STATUS_LABELS = Object.fromEntries(Object.entries(ITEM_STATUS).map(([k, v]) => [k, v.label]));

/**
 * Every row of a query, a page at a time: one request returns at most 1,000 rows, so a plain select stops there.
 * `make()` builds a fresh query each time; give it an .order() that is unique (end with the id) so pages don't overlap.
 */
export async function fetchAll(make, size = 1000) {
  const rows = [];
  for (let from = 0; ; from += size) {
    const page = await must(make().range(from, from + size - 1));
    rows.push(...page);
    if (page.length < size) return rows;
  }
}

/** Every file in a storage folder, a page at a time (a listing returns only `limit` entries). */
export async function listAllFiles(sb, bucket, folder, opts = {}, size = 1000) {
  const files = [];
  for (let offset = 0; ; offset += size) {
    const page = await must(sb.storage.from(bucket).list(folder, { ...opts, limit: size, offset }));
    files.push(...page);
    if (page.length < size) return files;
  }
}

/**
 * An order keeps the name it was placed under. Show the customer's current details instead: the linked
 * customer (`customer:customers(id,name,phone,email)` in the select), or, for orders with no link, the
 * customer record with the same email. Sets name, phone, email and customer_id on each order.
 */
export async function withCustomers(sb, orders) {
  const unlinked = orders.filter((o) => !o.customer && o.email);
  const byEmail = new Map();
  const emails = [...new Set(unlinked.map((o) => o.email.trim().toLowerCase()))].filter((e) => emailMatch('email', e));
  for (let i = 0; i < emails.length; i += 40) {
    const { data } = await sb.from('customers').select('id,name,phone,email').or(anyOf(emails.slice(i, i + 40).map((e) => emailMatch('email', e))));
    for (const c of data ?? []) byEmail.set(c.email.toLowerCase(), c);
  }
  for (const o of orders) {
    const c = o.customer ?? byEmail.get((o.email ?? '').toLowerCase());
    // `unlinked_match`: a guest order (no customer link) whose email belongs to a customer, so staff can link it.
    if (c) Object.assign(o, { unlinked_match: !o.customer && !o.customer_id, customer_id: c.id ?? o.customer_id, name: c.name || o.name, phone: c.phone ?? o.phone, email: c.email ?? o.email });
  }
  return orders;
}

/**
 * Guest orders (not linked to anyone) that match a customer by email or phone: [{ order_id, customer_id }].
 * The same rule the customer page uses to offer "link these orders".
 */
export async function findGuestMatches(sb) {
  const [orders, customers] = await Promise.all([
    fetchAll(() => sb.from('reservation_orders').select('id,email,phone_digits').is('customer_id', null).order('id')),
    fetchAll(() => sb.from('customers').select('id,email,phone_digits').order('id')),
  ]);
  const byEmail = new Map();
  const byPhone = new Map();
  for (const c of customers) {
    if (c.email) byEmail.set(c.email.toLowerCase(), c.id);
    if (c.phone_digits) byPhone.set(c.phone_digits, c.id);
  }
  return orders.flatMap((o) => {
    const id = (o.email && byEmail.get(o.email.toLowerCase())) || (o.phone_digits && byPhone.get(o.phone_digits));
    return id ? [{ order_id: o.id, customer_id: id }] : [];
  });
}

/**
 * Solid action icons (holes are cut out with even-odd fill, see .solid-icon). Use inside an .icon-btn:
 * `<button class="icon-btn icon-btn--add" aria-label="Add Batman #1" title="Add to pull list">${solidIcon('add')}</button>`
 */
const SOLID_ICONS = {
  add: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM11 6.5h2V11h4.5v2H13v4.5h-2V13H6.5v-2H11z',
  help: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6.5c2.2 0 3.8 1.3 3.8 3.3 0 1.4-.7 2.2-1.7 3-.9.7-1.3 1.1-1.3 2v.3h-2v-.4c0-1.4.6-2.1 1.6-2.9.9-.7 1.3-1.1 1.3-1.9 0-.9-.7-1.5-1.7-1.5-1 0-1.7.7-1.8 1.7h-2C8.2 7.9 9.8 6.5 12 6.5zM13.2 17.4a1.2 1.2 0 1 1-2.4 0 1.2 1.2 0 0 1 2.4 0z',
  info: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM11 10.5h2V17h-2zM12 6.3a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5z',
  addAll: 'M7 7.1a4.9 4.9 0 1 0 0 9.8 4.9 4.9 0 0 0 0-9.8zM6.2 8.8h1.6v2.4h2.4v1.6H7.8v2.4H6.2v-2.4H3.8v-1.6h2.4zM17 7.1a4.9 4.9 0 1 0 0 9.8 4.9 4.9 0 0 0 0-9.8zM16.2 8.8h1.6v2.4h2.4v1.6h-2.4v2.4h-1.6v-2.4h-2.4v-1.6h2.4z',
  view: 'M12 4.5C7 4.5 2.7 7.6 1 12c1.7 4.4 6 7.5 11 7.5s9.3-3.1 11-7.5c-1.7-4.4-6-7.5-11-7.5zM12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  fix: 'M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z',
  skip: 'M4 4h16v16H4zM8.3 7l3.7 3.7L15.7 7 17 8.3 13.3 12l3.7 3.7-1.3 1.3L12 13.3 8.3 17 7 15.7 10.7 12 7 8.3z',
  edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
  download: 'M11 3h2v9.2l2.8-2.8 1.4 1.4L12 16.2l-5.2-5.2 1.4-1.4 2.8 2.8zM6.8 18h10.4v3H6.8z',
  trash: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  follow: 'M11 7h11v15H11zM15.7 11.5h1.6v2.2h2.2v1.6h-2.2v2.2h-1.6v-2.2h-2.2v-1.6h2.2zM8 4h11v1.8H9.8V19H8zM5 1h11v1.8H6.8V16H5z',
  unfollow: 'M11 7h11v15H11zM13.5 13.7h6v1.6h-6zM8 4h11v1.8H9.8V19H8zM5 1h11v1.8H6.8V16H5z',
  link: 'M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z',
  swap: 'M6.99 11L3 15l3.99 4v-3H14v-2H6.99v-3zM21 9l-3.99-4v3H10v2h7.01v3L21 9z',
  key: 'M7 5a5 5 0 1 0 4.6 7L14 14.4V17h2.6v2.6H19V15l-7.3-7.3A5 5 0 0 0 7 5zM7 8a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
  crown: 'M3 7l4.5 4L12 4l4.5 7L21 7l-2 11H5zM5.5 19.5h13V21h-13z',
  person: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 21c0-4.4 3.6-7 8-7s8 2.6 8 7z',
  shield: 'M12 2 20 5v7c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10V5zM12 6.5l1.2 2.7 2.9.3-2.2 1.9.7 2.9L12 12.9l-2.6 1.4.7-2.9-2.2-1.9 2.9-.3z',
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM11 6h2v5.1l3.3 1.9-1 1.7L11 12.2z',
  grid: 'M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z',
  list: 'M3 4h4v4H3zM9 5h12v2H9zM3 10h4v4H3zM9 11h12v2H9zM3 16h4v4H3zM9 17h12v2H9z',
  remove: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM6.5 11h11v2h-11z',
};
export const solidIcon = (name, size = 22) => `<svg class="solid-icon" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false"><path d="${SOLID_ICONS[name]}"/></svg>`;

/** True on phones and tablets (up to 899px): where lists become cards and long instructions fold away. */
export const isPhone = (max = 899) => window.matchMedia(`(max-width: ${max}px)`).matches;

/**
 * An on/off switch: a checkbox that reads as a switch (role="switch"), with its label beside it. Pass `name` for a form
 * field, or `attrs` (e.g. a data attribute) to find it from script; change the words in `.switch__text` as it flips.
 */
export const switchHtml = (label, { name, checked = false, attrs = '' } = {}) =>
  `<label class="switch"><input type="checkbox" role="switch"${name ? ` name="${esc(name)}"` : ''}${checked ? ' checked' : ''}${attrs ? ` ${attrs}` : ''}><span class="switch__track" aria-hidden="true"></span><span class="switch__text">${esc(label)}</span></label>`;

/**
 * "How this works": a round accent "?" at the end of the screen's title (or a dialog's title) that opens the text in a dialog.
 * hintFold writes an inert <template>; hintsInto (run when the screen draws) moves it into the title as the button.
 * `html` is the text of the hint.
 */
export const hintFold = (html) => `<template data-hint>${html}</template>`;
/** Where a screen's How this works is filled in (setHint / setupTabs' hints); the button itself sits in the title. */
export const hintSlot = () => '<div data-hint-slot hidden></div>';
const HINT_ICON = '<svg class="solid-icon hint-icon" viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10"/><path d="M12 6.5c2.2 0 3.8 1.3 3.8 3.3 0 1.4-.7 2.2-1.7 3-.9.7-1.3 1.1-1.3 2v.3h-2v-.4c0-1.4.6-2.1 1.6-2.9.9-.7 1.3-1.1 1.3-1.9 0-.9-.7-1.5-1.7-1.5-1 0-1.7.7-1.8 1.7h-2C8.2 7.9 9.8 6.5 12 6.5zM13.2 17.4a1.2 1.2 0 1 1-2.4 0 1.2 1.2 0 0 1 2.4 0z"/></svg>';
const HINT_TEXT = new WeakMap();
const hintTitle = (from) => from.closest?.('dialog')?.querySelector('.dialog__head h2') ?? (from.closest?.('#section') ?? document).querySelector('h1');
function hintButton(title, html) {
  let btn = title.querySelector(':scope > .icon-btn--hint');
  if (!btn) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'icon-btn icon-btn--hint';
    btn.setAttribute('aria-label', 'How this works');
    btn.title = 'How this works';
    btn.innerHTML = HINT_ICON;
    btn.addEventListener('click', () => openDialog('How this works', `<p class="admin-hint">${HINT_TEXT.get(btn).join('</p><p class="admin-hint">')}</p>`));
    title.append(' ', btn);
    HINT_TEXT.set(btn, []);
  }
  HINT_TEXT.get(btn).push(html);
  return btn;
}
/** Turn every hint template under `root` into the "?" in its title. Safe to call again. */
export function hintsInto(root) {
  [...(root.matches?.('template[data-hint]') ? [root] : []), ...(root.querySelectorAll?.('template[data-hint]') ?? [])].forEach((t) => {
    if (t.closest('.fold') && !t.closest('dialog')) {
      // A hint for one form inside a fold: its own ? where it was written, not in the screen's title.
      const span = document.createElement('p');
      span.className = 'hint-inline';
      t.before(span);
      hintButton(span, t.innerHTML);
    } else {
      const title = hintTitle(t);
      if (title) hintButton(title, t.innerHTML);
    }
    t.remove();
  });
}
/** Put How this works in the screen's title (empty clears it). The text changes with the tab. */
export function setHint(from, html) {
  const title = hintTitle(from);
  if (!title) return;
  title.querySelector(':scope > .icon-btn--hint')?.remove();
  if (html) hintButton(title, html);
}
new MutationObserver((list) => list.forEach((m) => m.addedNodes.forEach((n) => n.nodeType === 1 && hintsInto(n)))).observe(document.body, { childList: true, subtree: true });

export const itemName = (i) => [i.title, i.issue_number && `#${i.issue_number}`].filter(Boolean).join(' ') + (i.variant ? ` · ${i.variant}` : '');

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

/** Open a modal <dialog> with the given inner HTML. Returns the dialog element. */
export function openDialog(title, bodyHtml, { wide = false } = {}) {
  const d = document.createElement('dialog');
  d.className = `admin-dialog${wide ? ' admin-dialog--wide' : ''}`;
  const titleId = uid('dlg-title'); // its own id: one dialog can open over another (How this works, Columns)
  d.setAttribute('aria-labelledby', titleId);
  d.innerHTML = `
    <div class="dialog__head"><h2 id="${titleId}">${esc(title)}</h2><button class="dialog__close" type="button" aria-label="Close">✕</button></div>
    <div class="dialog__body">${bodyHtml}</div>`;
  document.body.append(d);
  const opener = document.activeElement;
  d.addEventListener('close', () => {
    d.remove();
    opener?.focus?.();
  });
  $('.dialog__close', d).addEventListener('click', () => d.close());
  d.showModal();
  return d;
}

/** Send a message to a customer through the weekly-pull-list function (it adds the shop logo and logs the email). */
async function sendCustomerEmail({ to, subject, message, customerId }) {
  const sb = await db();
  const { error } = await sb.functions.invoke('weekly-pull-list', { body: { mode: 'message', to, subject, message, customer_id: customerId ? Number(customerId) : undefined } });
  if (error) {
    const detail = await error.context?.json?.().catch(() => null);
    throw new Error(detail?.error ?? friendlyError(error));
  }
}

/** The same compose form as the popup, shown right on the page (e.g. Customers → Messages). Clears itself after sending. */
export function mountEmailForm(box, { to, name = '', customerId = null }) {
  const first = String(name).trim().split(/\s+/)[0];
  const u = uid('em');
  const greeting = first ? `Hi ${first},\n\n` : '';
  box.innerHTML = `
    <form class="admin-form" novalidate>
      <div class="field"><label for="em-to-${u}">To</label><input id="em-to-${u}" value="${esc(to)}" readonly></div>
      <div class="field"><label for="em-subject-${u}">Subject</label><input id="em-subject-${u}" maxlength="200" autocomplete="off"></div>
      <div class="field"><label for="em-body-${u}">Message</label><textarea id="em-body-${u}" rows="6" maxlength="10000"></textarea>
        <p class="field__hint">Sent from the shop address with the shop logo on top. Replies come to the shop email, which also gets a copy.</p></div>
      <p class="admin-status" role="status"></p>
      <div class="admin-actions">
        <button class="btn btn--primary" type="submit">Send email</button>
        <a class="field__hint" href="mailto:${esc(to)}">Use my own mail app instead</a>
      </div>
    </form>`;
  const form = $('form', box);
  const subject = $(`#em-subject-${u}`, box);
  const body = $(`#em-body-${u}`, box);
  const status = $('.admin-status', box);
  body.value = greeting;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!subject.value.trim()) return setStatus(status, 'Please add a subject.', 'error'), subject.focus();
    if (!body.value.trim() || body.value.trim() === greeting.trim()) return setStatus(status, 'Please write a message.', 'error'), body.focus();
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    setStatus(status, 'Sending…');
    try {
      await sendCustomerEmail({ to, subject: subject.value.trim(), message: body.value.trim(), customerId });
      toast(`Email sent to ${to}`);
      subject.value = '';
      body.value = greeting;
      setStatus(status, '');
      window.dispatchEvent(new CustomEvent('customer-email-sent', { detail: { customerId } }));
    } catch (err) {
      setStatus(status, friendlyError(err), 'error');
    }
    btn.disabled = false;
  });
}

/**
 * Compose and send one email to one customer, from the shop address (through the weekly-pull-list
 * Edge Function, so it carries the shop logo and colors). Opened by any link with data-email-to.
 */
export function openEmailDialog({ to, name = '', customerId = null }) {
  const first = String(name).trim().split(/\s+/)[0];
  const u = uid('em');
  const d = openDialog('Email Customer', `
    <form class="admin-form" novalidate>
      <div class="field"><label for="${u}-to">To</label><input id="${u}-to" value="${esc(to)}" readonly></div>
      <div class="field"><label for="${u}-subject">Subject</label><input id="${u}-subject" maxlength="200" autocomplete="off"></div>
      <div class="field"><label for="${u}-body">Message</label><textarea id="${u}-body" rows="9" maxlength="10000">${first ? `Hi ${esc(first)},\n\n` : ''}</textarea>
        <p class="field__hint">Sent from the shop address with the shop logo on top. Replies come to the shop email, which also gets a copy.</p></div>
      <p class="admin-status" role="status" data-em-status></p>
      <div class="admin-actions">
        <button class="btn btn--primary" type="submit">Send email</button>
        <button class="btn btn--ghost" type="button" data-em-cancel>Cancel</button>
        <a class="field__hint" href="mailto:${esc(to)}">Use my own mail app instead</a>
      </div>
    </form>`);
  const form = $('form', d);
  const status = $('[data-em-status]', d);
  $('[data-em-cancel]', d).addEventListener('click', () => d.close());
  const body = $(`#${u}-body`, d);
  const subjectEl = $(`#${u}-subject`, d);
  body.focus();
  body.setSelectionRange(body.value.length, body.value.length);
  if (!first) subjectEl.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const subject = subjectEl.value.trim();
    const message = body.value.trim();
    if (!subject) return setStatus(status, 'Please add a subject.', 'error'), subjectEl.focus();
    if (!message || message === `Hi ${first},`) return setStatus(status, 'Please write a message.', 'error'), body.focus();
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    setStatus(status, 'Sending…');
    try {
      await sendCustomerEmail({ to, subject, message, customerId });
      d.close();
      toast(`Email sent to ${to}`);
      window.dispatchEvent(new CustomEvent('customer-email-sent', { detail: { customerId } }));
    } catch (err) {
      setStatus(status, friendlyError(err), 'error');
      btn.disabled = false;
    }
  });
  return d;
}

/**
 * CSV download from rows (arrays). Columns named in textColumns are written as ="…" so a spreadsheet keeps them exactly
 * as text: a 17-digit UPC isn't rounded, a leading zero stays and issue -1 needs no apostrophe.
 */
export function downloadCsv(filename, header, rows, { textColumns = [] } = {}) {
  const cell = (v) => {
    let s = v == null ? '' : String(v);
    // Spreadsheet formula injection: text a customer typed (a name like =HYPERLINK(...)) must never be run as a
    // formula when staff open the file in Excel or Sheets, so text starting with = + - @ gets a leading apostrophe.
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const asText = textColumns.map((name) => header.indexOf(name));
  const dataCell = (v, i) => (asText.includes(i) && v != null && v !== '' ? `"=""${String(v).replace(/"/g, '""""')}"""` : cell(v));
  const csv = [header.map((h) => cell(h)).join(','), ...rows.map((r) => r.map(dataCell).join(','))].join('\r\n');
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })), download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/**
 * Clickable, sortable column headers. Mark each sortable <th> with data-sort:
 *  - in the browser (no onSort): "text" or "num"; rows re-order using each cell's data-sort value, or its text.
 *    Use for lists that show every row.
 *  - for lists loaded a page at a time, pass { sort, dir, onSort(key, dir) }; data-sort is the sort key and the
 *    caller re-queries. Returns { set(key, dir) } to keep the headers in step when the sort changes elsewhere.
 * Add data-first="desc" to a header whose first click should sort high-to-low (dates, counts, yes/no).
 */
export function sortableTable(table, { sort = null, dir = 'asc', onSort = null } = {}) {
  const ths = $$('thead th[data-sort]', table);
  const mark = (key, d) =>
    ths.forEach((th) => {
      const on = key != null && th.dataset.key === key;
      th.setAttribute('aria-sort', on ? (d === 'asc' ? 'ascending' : 'descending') : 'none');
    });
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const sortRows = (th, d) => {
    const i = th.cellIndex;
    const num = th.dataset.sort === 'num';
    const val = (tr) => tr.children[i]?.dataset.sort ?? tr.children[i]?.textContent.trim() ?? '';
    for (const tbody of table.tBodies) {
      const rows = [...tbody.rows];
      const sign = d === 'asc' ? 1 : -1;
      rows.sort((a, b) => {
        const x = val(a), y = val(b);
        if (!x !== !y) return !x ? 1 : -1; // blanks last either way
        return sign * (num ? Number(x) - Number(y) : collator.compare(x, y));
      });
      tbody.append(...rows);
    }
  };
  let current = { key: sort, dir };
  let syncSelect = () => {};
  const choose = (th, d) => {
    current = { key: th.dataset.key, dir: d };
    mark(current.key, d);
    syncSelect();
    if (onSort) onSort(th.dataset.key, d);
    else sortRows(th, d);
  };
  for (const th of ths) {
    th.dataset.key = onSort ? th.dataset.sort : String(th.cellIndex);
    const btn = Object.assign(document.createElement('button'), { type: 'button', className: 'sort-btn', innerHTML: th.innerHTML });
    th.replaceChildren(btn);
    btn.addEventListener('click', () => {
      const first = th.dataset.first === 'desc' ? 'desc' : 'asc';
      choose(th, current.key === th.dataset.key ? (current.dir === 'asc' ? 'desc' : 'asc') : first);
    });
  }
  mark(sort, dir);
  syncSelect = listToolbar(table, ths, choose, () => current);
  syncSelect();
  return {
    set: (key, d) => {
      current = { key, dir: d };
      mark(key, d);
      syncSelect();
    },
  };
}

/** Where a screen's list view (List or Grid) is remembered: per screen, on this device. */
const listViewKey = () => `admin-list-view:${location.hash.slice(1).split(/[?/]/)[0]}`;
/** Show a `cards` table as the usual table (List) or as a grid of cards (Grid, 900px and wider; phones always show cards). */
function setListView(table, view) {
  table.classList.toggle('is-grid', view === 'grid');
  if (view === 'grid') {
    const heads = [...table.querySelectorAll('thead tr:last-child th')].map((th) => th.textContent.trim());
    table.querySelectorAll('tbody tr').forEach((tr) => [...tr.children].forEach((td, i) => td.dataset.label ??= heads[i] ?? ''));
  }
}
/**
 * Above a list screen's table: a sort select (every sortable column, both ways) and the List / Grid switch, like the
 * Media Library's. Only for `cards` tables that sit on the screen itself (not in a fold, panel, card or dialog).
 * Returns a function that makes the select show the table's current sort.
 */
function listToolbar(table, ths, choose, current) {
  const wrap = table.closest('.admin-table-wrap') ?? table;
  const old = wrap.previousElementSibling;
  if (old?.matches('.list-toolbar')) {
    const kept = old.querySelector('.results-count'); // a re-draw gives the count back before the bar goes
    if (kept) old.before(kept);
    old.remove();
  }
  if (!table.matches('.cards, .titles-table') || table.closest('.fold, .panel, .dash-card, dialog, .qr-item') || !ths.length) return () => {};
  const id = uid('list-sort');
  const cols = ths.map((th) => ({ th, label: th.textContent.trim(), num: th.dataset.sort === 'num' })).filter((c) => c.label);
  const bar = document.createElement('div');
  bar.className = 'list-toolbar';
  bar.innerHTML = `${table.dataset.sortElsewhere !== undefined ? '' : `<label class="visually-hidden" for="${id}">Sort list</label>
    <select id="${id}" class="select--small media-toolbar__sort"><option value="" disabled>Sort by…</option>${cols
      .map((c, i) => ['asc', 'desc'].map((d) => `<option value="${i}|${d}">${esc(c.label)} ${d === 'asc' ? '↑' : '↓'}</option>`).join(''))
      .join('')}</select>`}
    <div class="view-switch" role="group" aria-label="Show list as">
      <button class="icon-btn" type="button" data-view="grid" aria-pressed="false" aria-label="Grid" title="Grid">${solidIcon('grid', 20)}</button>
      <button class="icon-btn" type="button" data-view="list" aria-pressed="false" aria-label="List" title="List">${solidIcon('list', 20)}</button>
    </div>`;
  // The results count sits in the toolbar's row (count left, sort + view switch right) instead of on a line of its own.
  let count = null;
  for (let n = wrap.previousElementSibling ?? (wrap === wrap.parentElement?.firstElementChild ? wrap.parentElement.previousElementSibling : null); n && !count; n = n.previousElementSibling) {
    if (n.matches('.results-count')) count = n;
    else if (n.matches('form, .admin-tabs, [role="tablist"]')) break;
  }
  wrap.before(bar);
  if (count) bar.prepend(count);
  const select = $('select', bar) ?? document.createElement('select'); // Titles sorts in its own filters
  select.addEventListener('change', () => {
    const [i, d] = select.value.split('|');
    choose(cols[Number(i)].th, d);
  });
  const view = (v) => {
    setListView(table, v);
    bar.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
  };
  let saved = 'list';
  try {
    saved = localStorage.getItem(listViewKey()) === 'grid' ? 'grid' : 'list';
  } catch {
    /* start on the list */
  }
  view(saved);
  bar.querySelectorAll('[data-view]').forEach((b) =>
    b.addEventListener('click', () => {
      view(b.dataset.view);
      try {
        localStorage.setItem(listViewKey(), b.dataset.view);
      } catch {
        /* remembering the view is optional */
      }
    }),
  );
  return () => {
    const c = current();
    const i = cols.findIndex((x) => x.th.dataset.key === c.key);
    select.value = i < 0 ? '' : `${i}|${c.dir}`;
  };
}

/** A job_log message written as "who@example.com: what happened" → { who, text }; other messages have no who. */
export const splitWho = (message = '') => {
  const m = /^([^\s:@]+@[^\s:]+): ([\s\S]*)$/.exec(message ?? '');
  return m ? { who: m[1], text: m[2] } : { who: '', text: message ?? '' };
};

/**
 * Fill `box` with the latest job_log runs, newest first, as a sortable table: When, Run, (By), Result, Details.
 * `jobs` limits it to those job names; `name(job, text)` labels each run and `detail(text)` trims what the Details
 * column shows; `by` splits "who: …" off the message into its own column (Backup write the staff email
 * first). Import → Recent Runs, Backup → Log.
 */
export async function loadRunLog(sb, box, { jobs = null, name = (job) => job, detail = (text) => text, by = false, limit = 15, empty = 'No runs yet.' } = {}) {
  let q = sb.from('job_log').select('id,job,ok,message,created_at').order('id', { ascending: false }).limit(limit);
  if (jobs) q = q.in('job', jobs);
  const { data, error } = await q;
  if (error) {
    box.innerHTML = `<p class="form-error">${esc(friendlyError(error))}</p>`;
    return [];
  }
  box.innerHTML = data.length
    ? `<div class="admin-table-wrap"><table class="admin-table run-log cards">
        <thead><tr><th scope="col" data-sort="text" data-first="desc">When</th><th scope="col" data-sort="text">Run</th>${by ? '<th scope="col" data-sort="text">By</th>' : ''}<th scope="col" data-sort="text">Result</th><th scope="col">Details</th></tr></thead>
        <tbody>${data
          .map((j) => {
            const { who, text } = by ? splitWho(j.message) : { who: '', text: j.message ?? '' };
            return `<tr class="${j.ok ? '' : 'is-overdue'}">
            <td class="nowrap card__meta card-key" data-sort="${esc(j.created_at)}">${fmtDateTime(j.created_at)}</td>
            <td class="card-title"><strong>${esc(name(j.job, text))}</strong></td>
            ${by ? `<td class="card-line">${esc(who)}</td>` : ''}
            <td class="card-key"><span class="pill ${j.ok ? 'pill--done' : 'pill--failed'}">${j.ok ? 'OK' : 'Failed'}</span></td>
            <td class="card__meta card-wide">${esc(detail(text))}</td>
          </tr>`;
          })
          .join('')}</tbody>
      </table></div>${data.length === limit ? `<p class="admin-hint">Showing the latest ${limit}.</p>` : ''}`
    : `<p class="empty">${esc(empty)}</p>`;
  if (data.length) sortableTable($('.run-log', box));
  return data;
}

/**
 * Fill `box` with the emails staff sent to a customer from the compose box (newest first; click one to read it).
 * Matches by customer id, or by email address for people who only ever placed guest orders. `sum` gets a short summary.
 */
export async function loadSentMessages(sb, box, sum, { customerId = null, email = null } = {}) {
  const SHOW = 20;
  try {
    const filter = anyOf(customerId ? `customer_id.eq.${Number(customerId)}` : '', emailMatch('to_email', email));
    const rows = filter ? await must(sb.from('customer_messages').select('id,to_email,subject,body,sent_by,created_at').or(filter).order('created_at', { ascending: false }).limit(SHOW)) : [];
    if (!rows.length) {
      sum.textContent = 'None yet';
      box.innerHTML = '<p class="empty">No emails sent to this customer from here yet.</p>';
      return;
    }
    sum.textContent = `${rows.length === SHOW ? `${SHOW}+` : rows.length} · latest ${fmtDateTime(rows[0].created_at)}`;
    box.innerHTML = `<ul class="cust-messages">${rows
      .map((r) => `<li><details><summary><span class="job-log__when">${fmtDateTime(r.created_at)}</span> <strong>${esc(r.subject)}</strong> <span class="card__meta">by ${esc(r.sent_by ?? 'staff')}</span></summary>
        <p class="card__meta">To ${esc(r.to_email)}</p><div class="cust-messages__body">${esc(r.body)}</div></details></li>`)
      .join('')}</ul>${rows.length === SHOW ? `<p class="cust-log__more">Showing the latest ${SHOW}.</p>` : ''}`;
  } catch (err) {
    box.innerHTML = `<p class="form-error">${esc(friendlyError(err))}</p>`;
  }
}

/**
 * Tabs for a page: buttons `[data-tab="id"]` switch blocks `[data-tabpane="id"]` inside `el`. The chosen tab is
 * kept (per `key`) across a refresh.
 * Returns show(id), which also takes effect when called from outside (e.g. a hand-off from the Dashboard).
 */
export function setupTabs(el, key, fallback, onShow, hints) {
  const buttons = $$('[data-tab]', el);
  const ids = buttons.map((b) => b.dataset.tab);
  const show = (tab, remember = true) => {
    if (!ids.includes(tab)) tab = fallback;
    buttons.forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === tab));
    $$('[data-tabpane]', el).forEach((p) => (p.hidden = p.dataset.tabpane !== tab));
    if (hints) setHint(el, hints[tab] ?? ''); // each tab's How this works, in the slot above the tabs
    if (remember) {
      try {
        sessionStorage.setItem(key, tab);
      } catch {
        /* remembering the tab is optional */
      }
    }
    onShow?.(tab);
  };
  // Tie each tab to its panel for screen readers (role="tab" buttons, role="tabpanel" blocks).
  buttons.forEach((b) => {
    const pane = $(`[data-tabpane="${b.dataset.tab}"]`, el);
    if (!pane) return;
    b.id ||= `tab-${key}-${b.dataset.tab}`.replace(/[^\w-]/g, '-');
    pane.id ||= `${b.id}-panel`;
    b.setAttribute('aria-controls', pane.id);
    pane.setAttribute('role', 'tabpanel');
    pane.setAttribute('aria-labelledby', b.id);
  });
  buttons.forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
  let start = fallback;
  try {
    start = sessionStorage.getItem(key) || fallback;
  } catch {
    /* start on the first tab */
  }
  show(start, false);
  return show;
}

/** The shop's locations when it has two or more (else []): the location filters only show for a multi-location shop. */
export async function listLocations(sb) {
  if (!LOCATIONS_ENABLED) return [];
  const { data } = await sb.from('locations').select('id,name,is_default').order('id');
  return data?.length > 1 ? data : [];
}

/** "Location" filter menu: All locations, then each one. */
export const locationFilterField = (locations, selected, id) =>
  `<div class="field" data-location-field><label for="${id}">Location</label><select id="${id}" name="location"><option value="">All locations</option>${locations.map((l) => `<option value="${l.id}"${String(l.id) === String(selected) ? ' selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div>`;

/** Add the Location filter to a list's filter form once the locations are known. `onReset` runs if the remembered choice no longer exists. */
export async function addLocationFilter(sb, form, state, id, onReset) {
  const locations = await listLocations(sb);
  if (!locations.length || $('[data-location-field]', form)) return;
  if (state.location && !locations.some((l) => String(l.id) === String(state.location))) {
    state.location = '';
    onReset();
  }
  form.insertAdjacentHTML('beforeend', locationFilterField(locations, state.location, id));
}
