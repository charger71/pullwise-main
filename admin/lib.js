// Shared helpers for the admin sections.

import { supabase } from '../js/data.js';
import { esc, must, formatPhone } from '../js/util.js';
import { putMedia } from '../js/media-store.js';
import { friendlyError, fromError } from '../js/errors.js';
import { searchTerm, customerFilter, titleFilter, emailMatch, digitsMatch, anyOf } from './filters.js';
import { ITEM_STATUS } from '../js/labels.js';
import { fmtDate as siteFmtDate, fmtTime as siteFmtTime } from '../js/site.js';

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
  siteFmtDate(iso, opts.month && opts.year === undefined && iso && iso.slice(0, 4) !== String(new Date().getFullYear()) ? { ...opts, year: 'numeric' } : opts);
export const fmtDateTime = (iso) => (iso ? fmtDate(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
export const fmtTime = (when = new Date()) => siteFmtTime(when);

/** <input type="datetime-local"> value ↔ ISO timestamp (local time). */
export const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
export const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);

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
// Rich text (Quill, loaded globally by index.html)
// ---------------------------------------------------------------------------

// Text and highlight colors staff can pick (kept small so pages stay on-brand).
const TEXT_COLORS = ['#161616', '#5b5b5b', '#c8102e', '#a4001d', '#16723a', '#1a5fff', '#7a3fb0', '#b35900'];
const HIGHLIGHTS = ['#ffd100', '#fff3b0', '#d9f5df', '#e3ecff', '#f1e3ff', '#ffe6cc', '#ffd6de', '#eeeeee'];

const TOOLBARS = {
  lede: [['bold', 'italic', 'underline', 'link'], [{ color: TEXT_COLORS }, { background: HIGHLIGHTS }], ['blockquote'], ['clean']],
  // One column of a Columns row: the body's tools without the blocks that make their own layout.
  cell: [[{ header: [2, 3, 4, false] }], ['bold', 'italic', 'underline'], ['link', 'image', 'video', 'divider'], [{ list: 'ordered' }, { list: 'bullet' }], [{ align: [] }], ['clean']],
  body: [
    [{ header: [2, 3, 4, false] }],
    ['bold', 'italic', 'underline', 'strike'],
    [{ color: TEXT_COLORS }, { background: HIGHLIGHTS }],
    ['link', 'image', 'video', 'table', 'divider', 'gallery', 'columns'],
    [{ list: 'ordered' }, { list: 'bullet' }, { indent: '-1' }, { indent: '+1' }],
    [{ align: [] }],
    ['blockquote'],
    ['clean'],
  ],
};

const IMG_ALIGNS = ['left', 'center', 'right'];

/** Horizontal rule (<hr>) as an editor block, with its own toolbar button. */
let registered = false;
function registerFormats() {
  if (registered) return;
  registered = true;
  const BlockEmbed = Quill.import('blots/block/embed');
  class Divider extends BlockEmbed {
    static blotName = 'divider';
    static tagName = 'hr';
  }
  Quill.register(Divider);
  // A picture gallery: <div class="gallery"><figure><a href data-lightbox><img><figcaption>…</figure>…</div>. Shown as a
  // grid on the site (js/site.js opens it in the lightbox with next/previous); edited as a whole in a dialog.
  class Gallery extends BlockEmbed {
    static blotName = 'gallery';
    static tagName = 'div';
    static className = 'gallery';
    static create(value) {
      const node = super.create();
      node.setAttribute('contenteditable', 'false');
      for (const it of value?.items ?? []) {
        const fig = document.createElement('figure');
        const a = Object.assign(document.createElement('a'), { href: it.src });
        a.setAttribute('data-lightbox', '');
        a.append(Object.assign(document.createElement('img'), { src: it.src, alt: it.caption ?? '', loading: 'lazy' }));
        fig.append(a);
        if (it.caption) fig.append(Object.assign(document.createElement('figcaption'), { textContent: it.caption }));
        node.append(fig);
      }
      return node;
    }
    static value(node) {
      return { items: [...node.querySelectorAll('figure')].map((f) => ({ src: f.querySelector('img')?.getAttribute('src') ?? '', caption: f.querySelector('figcaption')?.textContent ?? '' })).filter((i) => i.src) };
    }
    html() {
      const copy = this.domNode.cloneNode(true);
      copy.removeAttribute('contenteditable');
      return copy.outerHTML;
    }
  }
  Quill.register(Gallery);
  // A row of columns: <div class="cols cols--2"><div class="col">…text…</div>…</div>. Stacks on phones (css/site.css);
  // each column is its own small editor in a dialog, and the whole row is edited from there.
  class Columns extends BlockEmbed {
    static blotName = 'columns';
    static tagName = 'div';
    static className = 'cols';
    static create(value) {
      const node = super.create();
      node.setAttribute('contenteditable', 'false');
      const layout = COLS_LAYOUTS[value?.layout] ? value.layout : '2';
      node.classList.add(`cols--${layout}`);
      for (const html of value?.cols ?? []) {
        const col = document.createElement('div');
        col.className = 'col';
        col.innerHTML = cleanCellHtml(html);
        node.append(col);
      }
      return node;
    }
    static value(node) {
      const layout = Object.keys(COLS_LAYOUTS).find((k) => node.classList.contains(`cols--${k}`)) ?? '2';
      return { layout, cols: [...node.children].filter((c) => c.classList.contains('col')).map((c) => c.innerHTML) };
    }
    html() {
      const copy = this.domNode.cloneNode(true);
      copy.removeAttribute('contenteditable');
      return copy.outerHTML;
    }
  }
  Quill.register(Columns);
  // Quill saves videos as plain links by default; keep the player instead.
  const Video = Quill.import('formats/video');
  class VideoPlayer extends Video {
    html() {
      const src = esc(this.value().video);
      return `<iframe class="ql-video" src="${src}" frameborder="0" allowfullscreen="true"></iframe>`;
    }
  }
  Quill.register(VideoPlayer, true);

  // Images keep a width (percent of the text column) and an alignment class.
  const Image = Quill.import('formats/image');
  class SizedImage extends Image {
    static formats(node) {
      const f = super.formats(node);
      if (node.style.width) f.width = node.style.width;
      const align = IMG_ALIGNS.find((a) => node.classList.contains(`img-align-${a}`));
      if (align) f.imgalign = align;
      return f;
    }
    format(name, value) {
      if (name === 'width') {
        if (value) this.domNode.style.width = value;
        else this.domNode.style.removeProperty('width');
        if (!this.domNode.getAttribute('style')) this.domNode.removeAttribute('style');
      } else if (name === 'imgalign') {
        IMG_ALIGNS.forEach((a) => this.domNode.classList.remove(`img-align-${a}`));
        if (IMG_ALIGNS.includes(value)) this.domNode.classList.add(`img-align-${value}`);
        if (!this.domNode.className) this.domNode.removeAttribute('class');
      } else super.format(name, value);
    }
  }
  Quill.register(SizedImage, true);

  const icons = Quill.import('ui/icons');
  icons.table ??=
    '<svg viewBox="0 0 18 18"><rect class="ql-stroke" height="12" width="12" x="3" y="3" rx="1"></rect><line class="ql-stroke" x1="3" x2="15" y1="7" y2="7"></line><line class="ql-stroke" x1="3" x2="15" y1="11" y2="11"></line><line class="ql-stroke" x1="7" x2="7" y1="7" y2="15"></line><line class="ql-stroke" x1="11" x2="11" y1="7" y2="15"></line></svg>';
  icons.columns =
    '<svg viewBox="0 0 18 18"><rect class="ql-stroke" height="12" width="4.5" x="2.5" y="3" rx="1"></rect><rect class="ql-stroke" height="12" width="4.5" x="9" y="3" rx="1"></rect><line class="ql-stroke" x1="16" x2="16" y1="3" y2="15"></line></svg>';
  icons.gallery =
    '<svg viewBox="0 0 18 18"><rect class="ql-stroke" height="5" width="5" x="2.5" y="2.5" rx="1"></rect><rect class="ql-stroke" height="5" width="5" x="10.5" y="2.5" rx="1"></rect><rect class="ql-stroke" height="5" width="5" x="2.5" y="10.5" rx="1"></rect><rect class="ql-stroke" height="5" width="5" x="10.5" y="10.5" rx="1"></rect></svg>';
  Quill.import('ui/icons').divider =
    '<svg viewBox="0 0 18 18"><line class="ql-stroke" x1="2" x2="16" y1="9" y2="9"></line><line class="ql-stroke ql-thin" x1="5" x2="13" y1="4" y2="4" opacity=".4"></line><line class="ql-stroke ql-thin" x1="5" x2="13" y1="14" y2="14" opacity=".4"></line></svg>';
}

/** YouTube / Vimeo page link → embeddable player URL, or null. */
function videoEmbedUrl(input) {
  let u;
  try {
    u = new URL(String(input).trim());
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\./, '');
  let id;
  if (host === 'youtu.be') id = u.pathname.slice(1);
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') id = u.searchParams.get('v') ?? u.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]+)/)?.[1];
  if (id && /^[\w-]{6,}$/.test(id)) return `https://www.youtube-nocookie.com/embed/${id}`;
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const v = u.pathname.match(/(\d{6,})/)?.[1];
    if (v) return `https://player.vimeo.com/video/${v}`;
  }
  return null;
}

/** Upload image files into the editor at `index` (toolbar button, paste or drop). */
async function insertImages(quill, files, index) {
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    toast(`Uploading ${file.name}…`);
    try {
      const { url } = await uploadImage(file, 'content', { maxSize: 1600 });
      const alt = prompt('Describe this image for people who can’t see it (optional):', '') ?? '';
      quill.insertEmbed(index, 'image', url, 'user');
      if (alt.trim()) quill.formatText(index, 1, 'alt', alt.trim(), 'user');
      quill.setSelection(++index, 0, 'user');
    } catch (err) {
      toast(`Image not added: ${friendlyError(err)}`, 'error');
    }
  }
}

const COLS_LAYOUTS = { 2: '2 equal columns', 3: '3 equal columns', 4: '4 equal columns', '1-2': 'Narrow column, then wide', '2-1': 'Wide column, then narrow' };
const COLS_COUNT = { 2: 2, 3: 3, 4: 4, '1-2': 2, '2-1': 2 };
const CELL_TAGS = new Set(['P', 'BR', 'STRONG', 'EM', 'U', 'S', 'A', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'IMG', 'HR', 'SPAN', 'IFRAME', 'B', 'I']);
const SAFE_URL = /^(https?:|mailto:|tel:|\/|#|[\w./?=&%-]+$)/i;

/** A column's saved HTML with only what the editor itself writes: no scripts, handlers or odd addresses. */
function cleanCellHtml(html) {
  const doc = new DOMParser().parseFromString(`<body>${html ?? ''}`, 'text/html');
  for (const el of [...doc.body.querySelectorAll('*')]) {
    if (!CELL_TAGS.has(el.tagName) || (el.tagName === 'IFRAME' && !videoEmbedUrl(el.getAttribute('src') ?? '') && !/^https:\/\/(www\.youtube(-nocookie)?\.com\/embed\/|player\.vimeo\.com\/video\/)/.test(el.getAttribute('src') ?? ''))) {
      el.remove();
      continue;
    }
    for (const a of [...el.attributes]) {
      const keep = ['class', 'href', 'src', 'alt', 'target', 'rel', 'allowfullscreen', 'frameborder', 'style'].includes(a.name);
      if (!keep || (['href', 'src'].includes(a.name) && !SAFE_URL.test(a.value.trim())) || (a.name === 'style' && /url\(|expression|javascript:/i.test(a.value))) el.removeAttribute(a.name);
    }
  }
  return doc.body.innerHTML;
}

/**
 * The columns editor: pick a layout and write each column in its own small editor.
 * Resolves with { layout, cols: [html, …] }, or null if the dialog was dismissed.
 */
function editColumns(initial) {
  return new Promise((resolve) => {
    const u = uid('cols');
    let layout = COLS_LAYOUTS[initial?.layout] ? initial.layout : '2';
    const start = initial?.cols?.length ? initial.cols : ['', ''];
    const editors = []; // made when a column is first shown
    const d = openDialog('Columns', `
      <div class="field"><label for="${u}-layout">Layout</label><select id="${u}-layout">${Object.entries(COLS_LAYOUTS).map(([k, l]) => `<option value="${k}"${k === layout ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <p class="field__hint">On phones the columns stack, the first on top. For more rows, add another Columns block under this one.</p></div>
      <div data-cols>${[0, 1, 2, 3].map((i) => `<div class="cols-edit__col" data-col-box="${i}"><span class="label" id="${u}-l${i}">Column ${i + 1}</span><div class="editor--cell"><div data-col="${i}"></div></div></div>`).join('')}</div>
      <p class="admin-status" role="status" data-status></p>
      <div class="admin-actions"><button class="btn btn--primary" type="button" data-done>Done</button> <button class="btn btn--ghost" type="button" data-cancel>Cancel</button></div>`, { wide: true });
    const status = $('[data-status]', d);
    let finished = false;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      resolve(value);
      d.close();
    };
    const draw = () => {
      const n = COLS_COUNT[layout];
      for (let i = 0; i < 4; i++) {
        $(`[data-col-box="${i}"]`, d).hidden = i >= n;
        if (i < n && !editors[i]) {
          editors[i] = makeEditor($(`[data-col="${i}"]`, d), 'cell', $(`#${u}-l${i}`, d));
          setHtml(editors[i], start[i] ?? '');
        }
      }
      const lost = editors.map((q, i) => (i >= n && q && getHtml(q) ? i + 1 : 0)).filter(Boolean);
      setStatus(status, lost.length ? `Column ${lost.join(', ')} has text and is removed when you press Done.` : '', lost.length ? 'error' : undefined);
    };
    draw();
    $(`#${u}-layout`, d).addEventListener('change', (e) => {
      layout = e.target.value;
      draw();
    });
    d.addEventListener('close', () => finish(null));
    d.addEventListener('click', (e) => {
      if (e.target.closest('[data-done]')) finish({ layout, cols: editors.slice(0, COLS_COUNT[layout]).map((q) => (q ? getHtml(q) ?? '' : '')) });
      else if (e.target.closest('[data-cancel]')) finish(null);
    });
  });
}

const GALLERY_MAX = 24;
/** The pictures of a gallery block's markup, as [{ src, caption }]. */
const Gallery_items = (node) => [...node.querySelectorAll('figure')].map((f) => ({ src: f.querySelector('img')?.getAttribute('src') ?? '', caption: f.querySelector('figcaption')?.textContent ?? '' })).filter((i) => i.src);

/** Pick pictures from the Media Library (several at once); resolves with their addresses, or [] if none. */
async function pickLibraryImages() {
  const sb = await db();
  const files = (await listAllFiles(sb, 'media', 'library', { sortBy: { column: 'created_at', order: 'desc' } })).filter((f) => f.id && !/-sm\.jpg$/.test(f.name));
  const urls = files.map((f) => sb.storage.from('media').getPublicUrl(`library/${f.name}`).data.publicUrl);
  return new Promise((resolve) => {
    const d = openDialog('Choose from Media', files.length
      ? `<p class="field__hint">Tap the pictures to add, then press Add. They are linked, not copied.</p>
        <ul class="media-grid media-pick">${urls.map((u, i) => `<li class="media-item"><button type="button" class="media-pick__btn" data-url="${esc(u)}" aria-pressed="false" aria-label="${esc(files[i].name)}"><img src="${esc(u)}" alt="" loading="lazy"></button></li>`).join('')}</ul>
        <div class="admin-actions"><button class="btn btn--primary" type="button" data-add>Add selected</button></div>`
      : '<p class="empty">The Media Library is empty. Upload images under Media first.</p>', { wide: true });
    let picked = [];
    d.addEventListener('click', (e) => {
      const b = e.target.closest('[data-url]');
      if (b) return b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
      if (e.target.closest('[data-add]')) {
        picked = $$('[data-url][aria-pressed="true"]', d).map((x) => x.dataset.url);
        d.close();
      }
    });
    d.addEventListener('close', () => resolve(picked));
  });
}

/**
 * The gallery editor: add pictures (upload, or from Media), caption them, put them in order, remove some.
 * Resolves with the new list of { src, caption }, or null if the dialog was dismissed.
 */
function editGallery(initial) {
  return new Promise((resolve) => {
    let items = initial.map((i) => ({ ...i }));
    const u = uid('gal');
    const d = openDialog('Picture Gallery', `
      <p class="field__hint">A grid of pictures that opens larger when tapped. Captions are optional; they show under the picture and describe it for people who can’t see it.</p>
      <ul class="gallery-edit" data-items></ul>
      <div class="admin-actions">
        <input id="${u}" type="file" accept="image/*" multiple class="visually-hidden">
        <label class="btn btn--ghost" for="${u}">Upload pictures…</label>
        <button class="btn btn--ghost" type="button" data-library>Choose from Media…</button>
      </div>
      <p class="admin-status" role="status" data-status></p>
      <div class="admin-actions"><button class="btn btn--primary" type="button" data-done>Done</button> <button class="btn btn--ghost" type="button" data-cancel>Cancel</button></div>`, { wide: true });
    const list = $('[data-items]', d);
    const status = $('[data-status]', d);
    let finished = false;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      resolve(value);
      d.close();
    };
    const draw = () => {
      list.innerHTML = items.length
        ? items.map((it, i) => `<li class="gallery-edit__item">
            <img src="${esc(it.src)}" alt="">
            <div class="field"><label class="visually-hidden" for="${u}-c${i}">Caption for picture ${i + 1}</label><input id="${u}-c${i}" data-caption="${i}" maxlength="200" autocomplete="off" placeholder="Caption (optional)" value="${esc(it.caption)}"></div>
            <span class="gallery-edit__move">
              <button class="btn btn--ghost btn--small" type="button" data-move="-1" data-i="${i}" aria-label="Move picture ${i + 1} earlier"${i === 0 ? ' disabled' : ''}>↑</button>
              <button class="btn btn--ghost btn--small" type="button" data-move="1" data-i="${i}" aria-label="Move picture ${i + 1} later"${i === items.length - 1 ? ' disabled' : ''}>↓</button>
              <button class="icon-btn icon-btn--remove" type="button" data-remove="${i}" aria-label="Remove picture ${i + 1}" title="Remove">${solidIcon('remove', 18)}</button>
            </span></li>`).join('')
        : '<li class="empty">No pictures yet.</li>';
    };
    const add = (urls) => {
      const room = GALLERY_MAX - items.length;
      items.push(...urls.slice(0, room).map((src) => ({ src, caption: '' })));
      if (urls.length > room) setStatus(status, `A gallery holds up to ${GALLERY_MAX} pictures.`, 'error');
      draw();
    };
    draw();
    d.addEventListener('close', () => finish(null));
    d.addEventListener('input', (e) => {
      const c = e.target.closest('[data-caption]');
      if (c) items[Number(c.dataset.caption)].caption = c.value;
    });
    d.addEventListener('click', async (e) => {
      const mv = e.target.closest('[data-move]');
      const rm = e.target.closest('[data-remove]');
      if (mv) {
        const i = Number(mv.dataset.i);
        const j = i + Number(mv.dataset.move);
        [items[i], items[j]] = [items[j], items[i]];
        draw();
        const mine = $$(`[data-move][data-i="${j}"]`, d).filter((b) => !b.disabled); // the arrow just used, or the other once at an end
        (mine.find((b) => b.dataset.move === mv.dataset.move) ?? mine[0])?.focus();
      } else if (rm) {
        items.splice(Number(rm.dataset.remove), 1);
        draw();
      } else if (e.target.closest('[data-library]')) {
        try {
          add(await pickLibraryImages());
        } catch (err) {
          setStatus(status, friendlyError(err), 'error');
        }
      } else if (e.target.closest('[data-done]')) {
        finish(items.map((i) => ({ src: i.src, caption: i.caption.trim() })));
      } else if (e.target.closest('[data-cancel]')) {
        finish(null);
      }
    });
    $(`#${u}`, d).addEventListener('change', async (e) => {
      const files = [...e.target.files].filter((f) => f.type.startsWith('image/'));
      e.target.value = '';
      const urls = [];
      for (const [n, file] of files.entries()) {
        setStatus(status, `Uploading ${n + 1} of ${files.length}…`);
        try {
          urls.push((await uploadImage(file, 'content', { maxSize: 1600 })).url);
        } catch (err) {
          setStatus(status, `${file.name} not added: ${friendlyError(err)}`, 'error');
        }
      }
      if (urls.length) setStatus(status, '');
      add(urls);
    });
  });
}

/** Editor inside `el`. `labelEl` gives the editable area its accessible name. */
export function makeEditor(el, kind = 'body', labelEl = null) {
  registerFormats();
  const handlers = {
    image() {
      const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', multiple: true });
      input.addEventListener('change', () => insertImages(this.quill, [...input.files], this.quill.getSelection(true).index));
      input.click();
    },
    video() {
      const url = prompt('Paste a YouTube or Vimeo link:', '');
      if (!url) return;
      const src = videoEmbedUrl(url);
      if (!src) return toast('That isn’t a YouTube or Vimeo link.', 'error');
      const { index } = this.quill.getSelection(true);
      this.quill.insertEmbed(index, 'video', src, 'user');
      this.quill.setSelection(index + 1, 0, 'user');
    },
    table() {
      const q = this.quill;
      if (q.getModule('table').getTable()[0]) return toast('Put the cursor outside the table to add another.', 'error');
      // Start the table on a new line; Quill puts it above that (empty) line, which
      // stays below the table for typing after it.
      const [line] = q.getLine(q.getSelection(true).index);
      let at = q.getIndex(line) + line.length() - 1;
      if (line.length() > 1) q.insertText(at++, '\n', 'user');
      q.setSelection(at, 0, 'silent');
      q.getModule('table').insertTable(3, 3);
    },
    async columns() {
      const q = this.quill;
      const { index } = q.getSelection(true);
      const out = await editColumns(null);
      if (!out) return;
      q.insertEmbed(index, 'columns', out, 'user');
      q.setSelection(index + 1, 0, 'user');
    },
    async gallery() {
      const q = this.quill;
      const { index } = q.getSelection(true);
      const items = await editGallery([]);
      if (!items?.length) return;
      q.insertEmbed(index, 'gallery', { items }, 'user');
      q.setSelection(index + 1, 0, 'user');
    },
    divider() {
      const { index } = this.quill.getSelection(true);
      this.quill.insertEmbed(index, 'divider', true, 'user');
      this.quill.setSelection(index + 1, 0, 'user');
    },
  };
  const quill = new Quill(el, {
    theme: 'snow',
    modules: {
      toolbar: { container: TOOLBARS[kind], handlers },
      table: kind === 'body',
      // Pasted or dropped pictures are uploaded instead of stored inside the text.
      // (`this` is the uploader module here.)
      uploader: {
        mimetypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
        handler(range, files) { insertImages(this.quill, files, range.index); },
      },
    },
  });
  if (labelEl) {
    quill.root.setAttribute('role', 'textbox');
    quill.root.setAttribute('aria-multiline', 'true');
    quill.root.setAttribute('aria-labelledby', (labelEl.id ||= uid('lbl')));
  }
  // Name the icon-only toolbar buttons for screen readers and tooltips.
  const names = { bold: 'Bold', italic: 'Italic', underline: 'Underline', strike: 'Strikethrough', link: 'Link', image: 'Insert image', video: 'Insert video', table: 'Insert table', divider: 'Divider line', gallery: 'Insert picture gallery', columns: 'Insert columns', blockquote: 'Quote', clean: 'Clear formatting' };
  quill.getModule('toolbar').container.querySelectorAll('button').forEach((b) => {
    const f = [...b.classList].find((c) => c.startsWith('ql-'))?.slice(3);
    const label = f === 'list' ? (b.value === 'ordered' ? 'Numbered list' : 'Bulleted list') : f === 'indent' ? (b.value === '+1' ? 'Indent' : 'Outdent') : names[f];
    if (label) b.setAttribute('aria-label', label), (b.title = label);
  });
  const pickers = { header: 'Text style', color: 'Text color', background: 'Highlight color', align: 'Alignment' };
  quill.getModule('toolbar').container.querySelectorAll('.ql-picker').forEach((p) => {
    const f = [...p.classList].find((c) => c.startsWith('ql-') && c !== 'ql-picker' && c !== 'ql-color-picker' && c !== 'ql-icon-picker')?.slice(3);
    const label = p.querySelector('.ql-picker-label');
    if (pickers[f] && label) label.setAttribute('aria-label', pickers[f]), (label.title = pickers[f]);
  });
  if (kind === 'body') {
    // A gallery in the text is edited as a whole: click it to change its pictures and captions.
    quill.root.addEventListener('click', async (e) => {
      const node = e.target.closest?.('.gallery');
      if (!node) return;
      e.preventDefault();
      const blot = Quill.find(node);
      if (!blot) return;
      const index = quill.getIndex(blot);
      const items = await editGallery(Gallery_items(node));
      if (items === null) return;
      quill.deleteText(index, 1, 'user');
      if (items.length) quill.insertEmbed(index, 'gallery', { items }, 'user');
    });
    // A row of columns is edited the same way.
    quill.root.addEventListener('click', async (e) => {
      const node = e.target.closest?.('.cols');
      if (!node) return;
      e.preventDefault();
      const blot = Quill.find(node);
      if (!blot) return;
      const index = quill.getIndex(blot);
      const out = await editColumns(blot.constructor.value(node));
      if (out === null) return;
      quill.deleteText(index, 1, 'user');
      quill.insertEmbed(index, 'columns', out, 'user');
    });
    imageTools(quill);
    tableTools(quill);
  } else if (kind === 'cell') {
    imageTools(quill); // a column's pictures get the same bar: alignment, size, alt text, link
  }
  return quill;
}

/** A web address typed for a picture's link, made complete (example.com becomes https://example.com); '' for none, null if it isn't an address. */
export function imageLinkUrl(raw) {
  const v = String(raw ?? '').trim();
  if (!v) return '';
  if (/^(https?:\/\/\S+|mailto:\S+|tel:[\d+()\s-]+)$/i.test(v) || /^[/#]\S*$/.test(v)) return v;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v)) return `https://${v}`;
  return null;
}

/**
 * Click (or select) an image in the editor to get alignment, size presets, alt
 * text, a link and a corner handle for free resizing. Width is stored as a percentage
 * of the text column so pictures scale on phones.
 */
function imageTools(quill) {
  const box = document.createElement('div');
  box.className = 'img-tools';
  box.hidden = true;
  box.innerHTML = `
    <div class="img-tools__bar" role="toolbar" aria-label="Image">
      <button type="button" data-align="left" title="Left, text wraps">⇤ Left</button>
      <button type="button" data-align="center" title="Centered">↔ Center</button>
      <button type="button" data-align="right" title="Right, text wraps">Right ⇥</button>
      <button type="button" data-align="" title="In line with text">Inline</button>
      <span class="img-tools__sep"></span>
      ${[25, 50, 75, 100].map((w) => `<button type="button" data-width="${w}">${w}%</button>`).join('')}
      <button type="button" data-width="" title="Original size">Auto</button>
      <span class="img-tools__sep"></span>
      <button type="button" data-alt>Alt text</button>
      <button type="button" data-link title="Make the picture a link">Link</button>
    </div>
    <span class="img-tools__size"></span>
    <span class="img-tools__handle" title="Drag to resize"></span>`;
  quill.container.append(box);
  let img = null;

  const blotIndex = () => quill.getIndex(Quill.find(img));
  const place = () => {
    if (!img || !img.isConnected) return hide();
    const c = quill.container.getBoundingClientRect(), r = img.getBoundingClientRect();
    Object.assign(box.style, { left: `${r.left - c.left}px`, top: `${r.top - c.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    // Not enough room above the picture (it's at the top of the editor): show the bar inside it.
    box.classList.toggle('img-tools--inside', r.top - c.top < $('.img-tools__bar', box).offsetHeight + 8);
    $('.img-tools__size', box).textContent = img.style.width || 'Auto';
    $('[data-link]', box).setAttribute('aria-pressed', String(!!img.closest('a')));
    $$('[data-align]', box).forEach((b) => b.setAttribute('aria-pressed', IMG_ALIGNS.find((a) => img.classList.contains(`img-align-${a}`)) === (b.dataset.align || undefined) || (!b.dataset.align && !IMG_ALIGNS.some((a) => img.classList.contains(`img-align-${a}`)))));
  };
  const show = (el) => { img = el; box.hidden = false; place(); };
  function hide() { img = null; box.hidden = true; }
  const apply = (formats) => {
    quill.formatText(blotIndex(), 1, formats, 'user');
    requestAnimationFrame(place);
  };

  quill.root.addEventListener('click', (e) => (e.target.tagName === 'IMG' && !e.target.closest('.gallery, .cols') ? show(e.target) : hide()));
  quill.on('selection-change', (range) => {
    if (!range) return;
    const [leaf] = quill.getLeaf(range.index + 1);
    if (range.length === 1 && leaf?.domNode?.tagName === 'IMG') show(leaf.domNode);
    else if (img && !(range.length === 1 && Quill.find(img) === leaf)) hide();
  });
  quill.on('text-change', () => requestAnimationFrame(place));
  quill.root.addEventListener('scroll', place);
  window.addEventListener('resize', place);

  box.addEventListener('mousedown', (e) => e.preventDefault()); // keep the editor's selection
  box.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !img) return;
    if ('align' in b.dataset) apply({ imgalign: b.dataset.align || false });
    else if ('width' in b.dataset) apply({ width: b.dataset.width ? `${b.dataset.width}%` : false });
    else if ('alt' in b.dataset) {
      const alt = prompt('Describe this image for people who can’t see it:', img.getAttribute('alt') ?? '');
      if (alt != null) apply({ alt: alt.trim() || false });
    } else if ('link' in b.dataset) {
      const raw = prompt('Where should this picture link to? Paste a web address, or leave empty to remove the link.', img.closest('a')?.getAttribute('href') ?? '');
      if (raw == null) return;
      const url = imageLinkUrl(raw);
      if (raw.trim() && !url) return toast('That doesn’t look like a web address.', 'error');
      apply({ link: url || false });
    }
  });

  // Drag the corner to resize; saved as a whole-number percentage on release.
  const handle = $('.img-tools__handle', box);
  handle.addEventListener('pointerdown', (e) => {
    if (!img) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX, startW = img.getBoundingClientRect().width;
    const column = quill.root.clientWidth - parseFloat(getComputedStyle(quill.root).paddingLeft) - parseFloat(getComputedStyle(quill.root).paddingRight);
    const pct = (x) => Math.max(10, Math.min(100, Math.round(((startW + x - startX) / column) * 100)));
    const move = (ev) => { img.style.width = `${pct(ev.clientX)}%`; place(); };
    const up = (ev) => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      apply({ width: `${pct(ev.clientX)}%` });
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
}

/** Row/column controls shown while the cursor is in a table. */
function tableTools(quill) {
  const table = quill.getModule('table');
  const bar = document.createElement('div');
  bar.className = 'table-tools';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Table');
  bar.hidden = true;
  const actions = [
    ['insertRowAbove', '+ Row above'], ['insertRowBelow', '+ Row below'], ['insertColumnLeft', '+ Column left'], ['insertColumnRight', '+ Column right'],
    ['deleteRow', '− Row'], ['deleteColumn', '− Column'], ['deleteTable', 'Delete table'],
  ];
  bar.innerHTML = `<span class="table-tools__label">Table:</span>${actions.map(([a, l]) => `<button type="button" data-act="${a}"${a.startsWith('delete') ? ' class="is-danger"' : ''}>${l}</button>`).join('')}`;
  quill.getModule('toolbar').container.after(bar);
  bar.addEventListener('mousedown', (e) => e.preventDefault());
  bar.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'deleteTable' && !confirm('Delete this whole table?')) return;
    table[act]();
    update(quill.getSelection());
  });
  const update = (range) => {
    if (!range) return;
    const [inTable] = table.getTable(range);
    bar.hidden = !inTable;
  };
  quill.on('selection-change', update);
  quill.on('text-change', () => update(quill.getSelection()));
}

export function setHtml(quill, html) {
  quill.setContents([], 'silent');
  if (html) quill.clipboard.dangerouslyPasteHTML(html, 'silent');
}

/** Clean HTML for storage, or null when the editor is empty. */
export function getHtml(quill) {
  if (!quill.getText().trim() && !quill.getContents().ops.some((op) => typeof op.insert !== 'string')) return null;
  const doc = document.createElement('div');
  doc.innerHTML = quill.getSemanticHTML().replace(/&nbsp;/g, ' ');
  // Quill opens every link in a new tab; keep that only for other websites.
  doc.querySelectorAll('a[href]').forEach((a) => {
    if (!/^https?:\/\//i.test(a.getAttribute('href')) || new URL(a.href, location.href).host === location.host) {
      a.removeAttribute('target');
      a.removeAttribute('rel');
    }
  });
  // Quill writes a hard black border onto tables; the site's stylesheet styles them.
  doc.querySelectorAll('table[style]').forEach((t) => t.removeAttribute('style'));
  return doc.innerHTML;
}

// ---------------------------------------------------------------------------
// Images: resize / crop in the browser, then upload to Storage (bucket "media")
// ---------------------------------------------------------------------------

export const CROPS = {
  original: { label: 'Original shape', ratio: null },
  cover: { label: 'Cover (2:3)', ratio: 2 / 3 },
  square: { label: 'Square (1:1)', ratio: 1 },
  wide: { label: 'Wide (16:9)', ratio: 16 / 9 },
};

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(Object.assign(img, { _url: url }));
    img.onerror = () => reject(new Error(`${file.name} isn't an image this browser can read`));
    img.src = url;
  });
}

/**
 * Resize (and optionally center-crop) an image file, or with `exact` crop it to that shape at exactly that size. Keeps PNG for images with
 * transparency (logos, Funko renders); everything else becomes JPEG.
 * @returns {Promise<{ blob: Blob, type: string, ext: string, width: number, height: number }>}
 */
export async function processImage(file, { maxSize = 1600, crop = 'original', quality = 0.86, flatten = false, exact = null } = {}) {
  if (file.type === 'image/svg+xml') {
    if (exact) throw new Error('Upload a PNG or JPEG picture here, not an SVG.');
    return { blob: file, type: file.type, ext: 'svg' };
  }
  const img = await loadImage(file);
  let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
  const ratio = exact ? exact[0] / exact[1] : CROPS[crop]?.ratio;
  if (ratio) {
    if (sw / sh > ratio) { const w = sh * ratio; sx = (sw - w) / 2; sw = w; }
    else { const h = sw / ratio; sy = (sh - h) / 2; sh = h; }
  }
  const scale = Math.min(1, maxSize / Math.max(sw, sh));
  // `exact` [width, height]: cropped to that shape and saved at exactly that size, so the size can be stated where
  // it's used (the app's manifest)
  const [width, height] = exact ?? [Math.round(sw * scale), Math.round(sh * scale)];
  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d');
  if (flatten) {
    ctx.fillStyle = '#161616'; // transparent areas become the site's dark background (the small copy is always a JPEG)
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height);
  URL.revokeObjectURL(img._url);
  const keepPng = !flatten && file.type === 'image/png' && hasTransparency(ctx, width, height);
  const type = keepPng ? 'image/png' : 'image/jpeg';
  const blob = await new Promise((r) => canvas.toBlob(r, type, quality));
  return { blob, type, ext: keepPng ? 'png' : 'jpg', width, height };
}

function hasTransparency(ctx, w, h) {
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < data.length; i += 4 * 7) if (data[i] < 250) return true;
  return false;
}

/** Long side of the small copy used on cards and lists (about 2x a phone card). */
const THUMB_SIZE = 560;

/** Where the small copy of the picture at `path` lives: the same name with "-sm.jpg" (see thumbOf in js/util.js). */
export const thumbPath = (path) => path.replace(/\.\w+$/, '-sm.jpg');

/** Save the small copy of `file` (same crop) next to the picture at `path`. Returns its public URL, or null for SVGs. */
async function saveThumb(sb, file, path, { crop, cacheControl }) {
  if (file.type === 'image/svg+xml') return null;
  const small = await processImage(file, { maxSize: THUMB_SIZE, crop, quality: 0.65, flatten: true });
  return putMedia(sb, thumbPath(path), small.blob, { contentType: small.type, cacheControl, upsert: true });
}

/**
 * Upload a processed image to Storage under `folder`; returns its public URL.
 * With `opts.thumb` it also saves the small copy next to it and returns that as `thumbUrl`.
 */
export async function uploadImage(file, folder, opts = {}) {
  const sb = await db();
  const out = await processImage(file, opts);
  let base = slugify(file.name.replace(/\.[^.]+$/, '')) || 'image';
  if (base.endsWith('-sm')) base += '-img'; // "-sm" at the end of a name is how small copies are recognised
  const path = `${folder}/${Date.now().toString(36)}-${base}.${out.ext}`;
  const cacheControl = opts.cacheControl ?? '604800';
  const url = await putMedia(sb, path, out.blob, { contentType: out.type, cacheControl });
  const thumbUrl = opts.thumb ? await saveThumb(sb, file, path, { crop: opts.crop, cacheControl }) : null;
  return { url, thumbUrl, path, ...out };
}

/**
 * Put a new image at an existing Storage path, so its link (and everything using it) stays the same.
 * Kept to a short browser cache so visitors see the new picture within the hour.
 */
export async function replaceImage(file, path, opts = {}) {
  const sb = await db();
  const out = await processImage(file, opts);
  const url = await putMedia(sb, path, out.blob, { contentType: out.type, cacheControl: '3600', upsert: true });
  if (opts.thumb) await saveThumb(sb, file, path, { crop: opts.crop, cacheControl: '3600' }); // same picture, so the small copy follows it
  return { url, path, ...out };
}

/**
 * An image field: preview + Upload/Remove buttons, writing the URL into a hidden input.
 * Returns { get(), getThumb(), set(url, thumbUrl) }. With `thumb`, an upload also makes a small copy;
 * getThumb() is its address (null when the picture was chosen from Media or removed).
 */
export function imageField(root, { folder, crop = 'original', maxSize = 1600, label = 'Image', library = false, thumb = false, exact = null }) {
  const id = uid('img');
  // Several image fields can share a screen (Shop Settings has eight), so each button says which picture it's for to a
  // screen reader: "Upload… App icon", not one of eight bare "Upload…".
  const forWhat = `<span class="visually-hidden"> ${esc(label)}</span>`;
  root.innerHTML = `
    <span class="label">${esc(label)}</span>
    <div class="image-field">
      <div class="image-field__preview"></div>
      <div class="image-field__controls">
        <input id="${id}" type="file" accept="image/*" class="visually-hidden">
        <label class="btn btn--ghost btn--small" for="${id}">Upload…${forWhat}</label>
        ${library ? `<button type="button" class="btn btn--ghost btn--small" data-library>Choose from Media…${forWhat}</button>` : ''}
        <button type="button" class="btn btn--danger btn--small" data-remove>${solidIcon('remove', 16)} Remove${forWhat}</button>
        <span class="admin-status" role="status"></span>
      </div>
    </div>`;
  let url = null;
  let thumbUrl = null;
  const preview = $('.image-field__preview', root);
  const status = $('.admin-status', root);
  const render = () => {
    preview.innerHTML = url ? `<img src="${esc(url)}" alt="">` : '<span class="image-field__none">No image</span>';
    $('[data-remove]', root).hidden = !url;
  };
  $('input[type=file]', root).addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setStatus(status, 'Uploading…');
    try {
      const saved = await uploadImage(file, folder, { crop, maxSize, thumb, exact });
      url = saved.url;
      thumbUrl = saved.thumbUrl;
      setStatus(status, '');
      render();
      root.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (err) {
      setStatus(status, friendlyError(err), 'error');
    }
    e.target.value = '';
  });
  $('[data-library]', root)?.addEventListener('click', async () => {
    try {
      const sb = await db();
      const files = (await listAllFiles(sb, 'media', 'library', { sortBy: { column: 'created_at', order: 'desc' } }))
        .filter((f) => f.id && !/-sm\.jpg$/.test(f.name)); // small copies aren't listed as pictures of their own
      const urls = files.map((f) => sb.storage.from('media').getPublicUrl(`library/${f.name}`).data.publicUrl);
      const d = openDialog('Choose from Media', files.length
        ? `<p class="field__hint">Pick an image from the Media Library. It is linked, not copied, so the same image can be used again and again.</p>
          <ul class="media-grid media-pick">${urls.map((u, i) => `<li class="media-item"><button type="button" class="media-pick__btn" data-url="${esc(u)}" aria-label="Use ${esc(files[i].name)}"><img src="${esc(u)}" alt="" loading="lazy"></button>
          </li>`).join('')}</ul>`
        : '<p class="empty">The Media Library is empty. Upload images under Media first.</p>', { wide: true });
      d.addEventListener('click', (e) => {
        const b = e.target.closest('[data-url]');
        if (!b) return;
        url = b.dataset.url;
        thumbUrl = null; // a Media Library picture has its own small copy, found by name
        render();
        root.dispatchEvent(new Event('change', { bubbles: true }));
        d.close();
      });
    } catch (err) {
      setStatus(status, friendlyError(err), 'error');
    }
  });
  $('[data-remove]', root).addEventListener('click', () => {
    if (!confirm('Remove this image? It stops showing once you save.')) return;
    url = null;
    thumbUrl = null;
    render();
    root.dispatchEvent(new Event('change', { bubbles: true }));
  });
  render();
  return { get: () => url, getThumb: () => (url ? thumbUrl : null), set: (u, t) => ((url = u || null), (thumbUrl = url ? t || null : null), render()) };
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

/** Open a modal <dialog> with the given inner HTML. Returns the dialog element. */
export function openDialog(title, bodyHtml, { wide = false } = {}) {
  const d = document.createElement('dialog');
  d.className = `admin-dialog${wide ? ' admin-dialog--wide' : ''}`;
  d.setAttribute('aria-labelledby', 'dlg-title');
  d.innerHTML = `
    <div class="dialog__head"><h2 id="dlg-title">${esc(title)}</h2><button class="dialog__close" type="button" aria-label="Close">✕</button></div>
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
  const d = openDialog('Email Customer', `
    <form class="admin-form" novalidate>
      <div class="field"><label for="em-to">To</label><input id="em-to" value="${esc(to)}" readonly></div>
      <div class="field"><label for="em-subject">Subject</label><input id="em-subject" maxlength="200" autocomplete="off"></div>
      <div class="field"><label for="em-body">Message</label><textarea id="em-body" rows="9" maxlength="10000">${first ? `Hi ${esc(first)},\n\n` : ''}</textarea>
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
  const body = $('#em-body', d);
  body.focus();
  body.setSelectionRange(body.value.length, body.value.length);
  if (!first) $('#em-subject', d).focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const subject = $('#em-subject', d).value.trim();
    const message = body.value.trim();
    if (!subject) return setStatus(status, 'Please add a subject.', 'error'), $('#em-subject', d).focus();
    if (!message || message === `Hi ${first},`) return setStatus(status, 'Please write a message.', 'error'), body.focus();
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    setStatus(status, 'Sending…');
    try {
      const sb = await db();
      const { error } = await sb.functions.invoke('weekly-pull-list', { body: { mode: 'message', to, subject, message, customer_id: customerId ? Number(customerId) : undefined } });
      if (error) {
        const detail = await error.context?.json?.().catch(() => null);
        throw new Error(detail?.error ?? friendlyError(error));
      }
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
  if (wrap.previousElementSibling?.matches('.list-toolbar')) wrap.previousElementSibling.remove();
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
  wrap.before(bar);
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
