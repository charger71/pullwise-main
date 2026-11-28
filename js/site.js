// Shared layout and helpers for every customer-facing page.
// Pages include <body data-page="…">, an empty <header id="site-header">,
// <main id="main">, and <footer id="site-footer">; this fills in the rest
// from the shop settings so nothing shop-specific is hardcoded in HTML.

import { getSettings, getCustomPages, DEMO } from './data.js';
import { GA_MEASUREMENT_ID, SITE_URL, SUPABASE_URL, FALLBACK_SETTINGS, APP_ENABLED } from './config.js';
import { themeCss } from './theme-vars.js';
import { SOCIAL_ICONS, LINK_ICON } from './social-icons.js';
import { fillContent } from './content.js';
import { initCustomer } from './customer.js';
import { readCache, writeCache, sameData } from './cache.js';
import { esc, itemTitle, heroHeadlineHtml, sizedImage, LOGO_WIDTH, HERO_WIDTH, formatPhone, prefersReducedMotion, chatOn, price } from './util.js';
import { ITEM_STATUS, ITEM_BADGES } from './labels.js';
import { offHrefs, slugOfPage, orderMenu, customHref, customSlugHere } from './optional-pages.js';
import { upcomingHolidays, todayHours } from './holiday-hours.js';
import { layoutOf } from './layouts.js';
import { localDate, addDays, todayIn, lastReserveDay, setShopTimeZone, shopTimeZone, shopToday, daysUntil, cutoffPassed, fmtDateIn, fmtTimeIn } from './dates.js';

export { esc, itemTitle, heroHeadlineHtml, sizedImage, HERO_WIDTH, localDate, addDays, lastReserveDay, price, ITEM_BADGES, shopToday, daysUntil, cutoffPassed };

// My Pull List is always the last link; the rest follow settings.menu_order (Admin → Pages), see renderHeader.
const NAV = [
  { page: 'preorders', href: 'pre-orders.html', label: 'Pre-Orders' },
  { page: 'arrivals', href: 'new-arrivals.html', label: 'New Arrivals' },
  { page: 'we-buy', href: 'we-buy-comics.html', label: 'We Buy' },
  { page: 'calendar', href: 'calendar.html', label: 'Calendar' },
  { page: 'blog', href: 'blog.html', label: 'News' },
  { page: 'contact', href: 'contact.html', label: 'Visit' },
  { page: 'account', href: 'account.html', label: 'My Pull List' },
];

/** The one mention of Pullwise a shop's customers see: the footer's last line, and the foot of the app's Account tab
 * (app.html). Everything else carries the shop's own name. */
const POWERED_BY = 'Powered by Pullwise';

const FOOTER_LINKS = [
  ...(APP_ENABLED ? [{ href: 'app.html', label: 'Get the App' }] : []), // only shops with the app (shops.json)
  { href: 'about.html', label: 'About' },
  { href: 'gift-cards.html', label: 'Gift Cards' },
  { href: 'how-to.html', label: 'How To' },
  { href: 'faq.html', label: 'FAQ' },
  { href: 'privacy.html', label: 'Privacy' },
  { href: 'terms.html', label: 'Terms' },
];

export const STATUS = ITEM_STATUS;

export const EVENT_TYPES = { release_party: 'Release party', signing: 'Signing', tournament: 'Tournament', livestream: 'Livestream', comic_con: 'Comic Con', sale: 'Sale', other: 'Event' };

const DAY_NAMES = { Mo: 'Mon', Tu: 'Tue', We: 'Wed', Th: 'Thu', Fr: 'Fri', Sa: 'Sat', Su: 'Sun' };
const DAY_ORDER = Object.keys(DAY_NAMES);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Escaped text with **bold**, *italic*, [label](link) and bare https:// links turned into anchors. Links may be full URLs or site pages like events.html. */
export function linkify(text) {
  const a = (href, label) => `<a href="${href}"${/^https?:/i.test(href) ? ' target="_blank" rel="noopener"' : ''}>${label}</a>`;
  return esc(text)
    .replace(/\*\*(?=\S)([^*]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w/])\*(?=[^\s*])([^*]*?[^\s*])\*(?![*\w])/g, '$1<em>$2</em>')
    .replace(/(^|[^\w/])_(?=[^\s_])([^_]*?[^\s_])_(?![\w])/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(((?:https?:\/\/|[\w./#?=&;%-]+)[^\s)"'<>]*)\)/gi, (m, label, href) => (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^https?:/i.test(href) ? m : a(href, label)))
    .replace(/(^|[\s(])(https?:\/\/[^\s<>"')]+)/gi, (m, pre, url) => {
      const tail = url.match(/[.,;:!?]+$/)?.[0] ?? '';
      const u = url.slice(0, url.length - tail.length);
      return `${pre}${a(u, u)}${tail}`;
    });
}

export const $ = (sel, root = document) => root.querySelector(sel);

/** A phone: the one width scripts ask about, the same as css/site.css's (max-width: 599px). */
export const isPhone = () => matchMedia('(max-width: 599px)').matches;

/**
 * Say `text` in the polite live region `el` (role="status"). It's emptied first and filled a moment later, so the same
 * words twice in a row (two titles added, say) are read out twice.
 */
export function announceIn(el, text) {
  if (!el) return;
  el.textContent = '';
  setTimeout(() => (el.textContent = text), 50);
}

/** When dialog `d` closes, focus goes back to `d.returnFocusTo` (what opened it), if that's still on the page. */
export const focusBackOnClose = (d) => d.addEventListener('close', () => d.returnFocusTo?.isConnected && d.returnFocusTo.focus());

/**
 * How long a motion token from css/site.css (`--dur`, `--dur-sheet`…) lasts, in ms, for a script waiting for that
 * motion to end. 0 under reduced motion, where it doesn't run.
 */
export function motionMs(token) {
  if (prefersReducedMotion()) return 0;
  const v = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return (/ms$/.test(v) ? parseFloat(v) : parseFloat(v) * 1000) || 0;
}

// Dates like "today" and event times follow the shop's timezone (from settings, set in initPage and kept in
// js/dates.js) so the site's cutoffs match what the database enforces and a visitor elsewhere sees the shop's local times.

/** A date for display. Plain YYYY-MM-DD dates are calendar days and shown as-is; timestamps in shop time. */
export const fmtDate = (iso, opts) => fmtDateIn(iso, opts, shopTimeZone());

/** A timestamp's time of day, in shop time. */
export const fmtTime = (iso) => fmtTimeIn(iso, shopTimeZone());

/** An all-day event is entered as midnight to 11:59 PM (shop time): lists show its date, not a time. */
export const isAllDay = (e) => {
  if (!e?.ends_at) return false;
  const clock = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: shopTimeZone() });
  return clock(e.starts_at) === '00:00' && clock(e.ends_at) === '23:59';
};

/** An event's time for a list: "6:00 PM–8:00 PM", or "All day". */
export const eventTimes = (e) => (isAllDay(e) ? 'All day' : `${fmtTime(e.starts_at)}${e.ends_at ? `–${fmtTime(e.ends_at)}` : ''}`);

/** Earliest FOC date still open for reservations today (shop time): the day after this Saturday. Pass the
 *  shop's timezone when calling before initPage has set it. */
export const openFocFrom = (timeZone = shopTimeZone()) => {
  const today = todayIn(timeZone);
  return addDays(today, 7 - localDate(today).getDay());
};

export const badge = (status) => {
  const s = STATUS[status] ?? { label: status, icon: '' };
  return `<span class="badge badge--${esc(status)}"><span aria-hidden="true">${s.icon}</span> ${esc(s.label)}</span>`;
};

/** Title plus cover variant — what identifies the exact product to order. */
export const itemFullTitle = (i) => (i.variant ? `${itemTitle(i)} · ${i.variant}` : itemTitle(i));

/**
 * Cover image, or a plain "Image coming soon" panel when there isn't one yet. Cards and lists get the small copy
 * (cover_thumb_url) when a title has one; `full` asks for the full-size picture, for the title details window.
 */
export const cover = (i, { full = false } = {}) =>
  i.cover_url
    ? `<img class="cover" src="${esc((!full && i.cover_thumb_url) || i.cover_url)}" alt="Cover of ${esc(itemFullTitle(i))}" loading="lazy" decoding="async" width="300" height="450">`
    : `<span class="cover cover--placeholder" aria-hidden="true">Image coming soon</span>`; // a span: covers sit inside buttons

const time12 = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: m ? '2-digit' : undefined });
};

/** ['Mo','Tu','We'] → 'Mon–Wed'; ['Mo','We'] → 'Mon, Wed' */
export const dayLabel = (days) => {
  const idx = days.map((d) => DAY_ORDER.indexOf(d)).sort((a, b) => a - b);
  const contiguous = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
  if (idx.length > 2 && contiguous) return `${DAY_NAMES[DAY_ORDER[idx[0]]]}–${DAY_NAMES[DAY_ORDER[idx.at(-1)]]}`;
  return idx.map((i) => DAY_NAMES[DAY_ORDER[i]]).join(', ');
};

/** The weekly opening hours, then any holiday dates coming up soon (closed, or their own times) from `holidays`. */
export const hoursList = (hours, holidays = []) => {
  const soon = upcomingHolidays(holidays, shopToday());
  return `<dl class="hours">${hours
    .map((h) => `<div><dt>${esc(dayLabel(h.days))}</dt><dd>${esc(time12(h.open))} – ${esc(time12(h.close))}</dd></div>`)
    .join('')}</dl>${soon.length ? `<p class="hours__title">Holiday hours</p><dl class="hours hours--holiday">${soon
    .map((h) => `<div><dt>${esc(fmtDateIn(h.date, { weekday: 'short', month: 'short', day: 'numeric' }))}${h.label ? `<span class="hours__note">${esc(h.label)}</span>` : ''}</dt><dd>${h.closed ? 'Closed' : `${esc(time12(h.open))} – ${esc(time12(h.close))}`}</dd></div>`)
    .join('')}</dl>` : ''}`;
};

export const addressLines = (s) =>
  [s.street, [s.city, s.region].filter(Boolean).join(', ') + (s.postal_code ? ` ${s.postal_code}` : '')].filter((l) => l?.trim());

export const telHref = (phone) => `tel:${String(phone).replace(/[^\d+]/g, '')}`;

/** The shop's social profiles from settings.socials, web links only. */
// Shown in SOCIAL_ICONS order (the database doesn't keep the order they were entered), others last.
const SOCIAL_ORDER = Object.keys(SOCIAL_ICONS);
const socialRank = (k) => (SOCIAL_ORDER.includes(k) ? SOCIAL_ORDER.indexOf(k) : SOCIAL_ORDER.length);
const socialEntries = (s, { except = [] } = {}) =>
  Object.entries(s.socials ?? {})
    .filter(([k, url]) => /^https?:\/\//i.test(url ?? '') && !except.includes(k))
    .sort(([a], [b]) => socialRank(a.toLowerCase()) - socialRank(b.toLowerCase()) || a.localeCompare(b));

/** Row of social icon links (settings.socials). Each has an accessible name. */
export function socialIcons(s, opts) {
  const entries = socialEntries(s, opts);
  if (!entries.length) return '';
  return `<ul class="socials">${entries
    .map(([k, url]) => {
      const icon = SOCIAL_ICONS[k.toLowerCase()];
      const label = icon?.label ?? k[0].toUpperCase() + k.slice(1);
      return `<li><a href="${esc(url)}" rel="noopener" target="_blank" aria-label="${esc(label)}" title="${esc(label)}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${icon?.path ?? LINK_ICON}"/></svg></a></li>`;
    })
    .join('')}</ul>`;
}

/** One location as a settings-like object (its address, phone, hours and map), named "Shop : Location", for the helpers here. */
export const locationAs = (s, loc) => ({ ...s, ...loc, shop_name: `${s.shop_name} : ${loc.name}`, locations: [] });

/**
 * Where an event is. A shop with several locations puts each event at one of them ("Shop : Location" with its address)
 * or at all of them, plus any note staff typed. Returns { label (for the event's line), where (calendar links), ics (the LOCATION text) }.
 */
export function eventPlace(s, e) {
  // An event for every location (Batman Day, a Black Friday sale) has no location_id.
  if (s.locations?.length && e.location_id === null) {
    const all = `${s.shop_name} — all locations`;
    return { label: ['All locations', e.location].filter(Boolean).join(' — '), where: s.shop_name, ics: e.location ? `${all} — ${e.location}` : all };
  }
  const loc = s.locations?.length ? s.locations.find((l) => l.id === e.location_id) ?? s.locations.find((l) => l.is_default) ?? s.locations[0] : null;
  if (!loc) return { label: e.location ?? '', where: [s.shop_name, ...addressLines(s)].join(', '), ics: e.location ? `${s.shop_name} — ${e.location}` : s.shop_name };
  const where = [`${s.shop_name} : ${loc.name}`, ...addressLines(loc)].join(', ');
  return { label: [loc.name, e.location].filter(Boolean).join(' — '), where, ics: e.location ? `${where} — ${e.location}` : where };
}

export const mapsHref = (s) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([s.shop_name, ...addressLines(s)].join(', '))}`;

/**
 * Google Map embed for the shop, or '' when switched off (settings.show_map) or
 * there's nothing to point at. Uses settings.map_embed_url when staff have pasted
 * one from Google Maps (Share → Embed a map), otherwise the address.
 */
export function mapEmbed(s, className = 'map') {
  if (s.show_map === false) return '';
  const custom = /^https:\/\/(www\.)?google\.com\/maps\/embed\?/.test(s.map_embed_url ?? '') ? s.map_embed_url : null;
  const addr = addressLines(s);
  if (!custom && !addr.length) return '';
  const src = custom ?? `https://maps.google.com/maps?q=${encodeURIComponent([s.shop_name, ...addr].join(', '))}&z=15&output=embed`;
  return `<iframe class="${className}" src="${esc(src)}" title="Map to ${esc(s.shop_name)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>`;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/**
 * The shop's colors and fonts, as the <style id="shop-theme"> the site Worker writes into the page (js/theme-vars.js).
 * The text is rebuilt from the settings and only replaced when it differs, so a page the Worker already themed
 * doesn't repaint; without the Worker (local, demo, or the database was down), this is what themes the page.
 */
function applyTheme(s) {
  const css = themeCss(s, { storageOrigin: SUPABASE_URL });
  let el = document.getElementById('shop-theme');
  if (!el) {
    el = Object.assign(document.createElement('style'), { id: 'shop-theme' });
    document.head.append(el); // after css/site.css, so it wins
  }
  if (el.textContent !== css) el.textContent = css;
}

/**
 * The shop's logo, name, or both (settings.show_name_with_logo). With both, the logo is decorative (empty alt) so
 * screen readers don't hear the name twice.
 */
function brandHtml(s) {
  const name = `<span class="brand__name">${esc(s.shop_name).replace('&amp;', '<span>&amp;</span>')}</span>`;
  return !s.logo_url
    ? name
    : s.show_name_with_logo
      ? `<img src="${esc(sizedImage(s.logo_url, LOGO_WIDTH))}" alt="" class="brand__logo" fetchpriority="high">${name}`
      : `<img src="${esc(sizedImage(s.logo_url, LOGO_WIDTH))}" alt="${esc(s.shop_name)}" class="brand__logo" fetchpriority="high">`;
}

/** The pull list app's header (app.html): the shop's brand and a search button that opens the search under it
 * (js/pages/app.js setupSearch). The website is a link on the Shop tab. */
function renderAppHeader(s) {
  $('#site-header').innerHTML = `
    <a class="skip-link" href="${esc(location.pathname + location.search)}#main">Skip to content</a>
    <div class="app-bar container">
      <a class="brand" href="#list">${brandHtml(s)}</a>
      <button class="app-bar__search" type="button" aria-label="Search titles" title="Search titles" aria-expanded="false" aria-controls="app-search" data-search-toggle><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg></button>
    </div>`;
}

const SEARCH_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>';

/**
 * The site header in the shop's chosen layout (js/layouts.js; css/site.css draws each from body[data-header]):
 * Classic (announcement and search strip, logo left, menu right), Centered (the same strip, logo centered, menu on its
 * own row) or Bold bar (one accent-colored bar with logo, menu and a search button; the announcement under it).
 * Every layout uses the same phone menu.
 */
function renderHeader(s, page, extraNav = [], off = new Set()) {
  const { header } = layoutOf(s, document.body.dataset);
  const brand = `<a class="brand" href="index.html">${brandHtml(s)}</a>`;
  const notice = s.announcement ? `<p class="topbar__notice"><strong>Announcement:</strong> ${linkify(s.announcement)}</p>` : '<p class="topbar__notice" hidden></p>';
  const search = `
        <form class="topbar__search" role="search" action="search.html">
          <label class="visually-hidden" for="site-q">Search the site</label>
          <input id="site-q" type="search" name="q" placeholder="Search" maxlength="100" autocomplete="off" required>
          <button class="topbar__btn" type="submit" aria-label="Search">${SEARCH_ICON}</button>
        </form>`;
  const menuBtn = `<button class="nav-toggle" aria-expanded="false" aria-controls="site-nav">
        <span class="nav-toggle__icon" aria-hidden="true"></span><span class="visually-hidden">Menu</span>
      </button>`;
  const nav = `<nav id="site-nav" class="nav" aria-label="Main">
        <ul>${[...orderMenu([...NAV.slice(0, -1), ...extraNav], s.menu_order ?? []), NAV.at(-1)].filter((n) => !off.has(n.href)).map(
          // Custom pages' titles are staff text: escaped like everything else.
          (n) => `<li><a href="${esc(n.href)}"${n.page === page ? ' aria-current="page"' : ''}>${esc(n.label)}</a></li>`,
        ).join('')}</ul>
      </nav>`;
  const skip = `<a class="skip-link" href="${esc(location.pathname + location.search)}#main">Skip to content</a>`;
  const demo = DEMO ? '<p class="demo-banner">Demo mode — showing sample data. Connect Supabase in <code>js/config.js</code>.</p>' : '';
  const strip = `<div class="topbar"><div class="topbar__inner container">${notice}${search}</div></div>`;
  $('#site-header').innerHTML =
    header === 'bold'
      ? `${skip}
    <div class="header__bold">
      <div class="header__bar container">
        ${brand}
        <button class="header__search-toggle" type="button" aria-expanded="false" aria-controls="header-search" aria-label="Search the site">${SEARCH_ICON}</button>
        ${menuBtn}
        ${nav}
      </div>
    </div>
    <div class="topbar header__search" id="header-search" hidden><div class="topbar__inner container">${search}</div></div>
    ${s.announcement ? `<div class="topbar"><div class="topbar__inner container">${notice}</div></div>` : ''}
    ${demo}`
      : header === 'centered'
        ? `${skip}${strip}${demo}
    <div class="header__bar container">${brand}${menuBtn}</div>
    <div class="header__row container">${nav}</div>`
        : `${skip}${strip}${demo}
    <div class="header__bar container">
      ${brand}
      ${menuBtn}
      ${nav}
    </div>`;
  const searchToggle = $('.header__search-toggle');
  searchToggle?.addEventListener('click', () => {
    const open = searchToggle.getAttribute('aria-expanded') !== 'true';
    searchToggle.setAttribute('aria-expanded', open);
    $('#header-search').hidden = !open;
    if (open) $('#site-q').focus();
  });
  const toggle = $('.nav-toggle');
  // The header can be repainted (saved snapshot → fresh settings) while the menu is open.
  if (document.body.classList.contains('nav-open')) toggle.setAttribute('aria-expanded', 'true');
  toggle.addEventListener('click', () => setNavOpen(toggle.getAttribute('aria-expanded') !== 'true'));
}

// Phone menu. It opens below the sticky header, so it's capped at the rest of the screen and scrolls inside
// (a phone held sideways, or zoomed in, has room for only a few links). Escape closes it.
function setNavOpen(open, { focusToggle = false } = {}) {
  const toggle = $('.nav-toggle');
  if (!toggle) return;
  toggle.setAttribute('aria-expanded', open);
  document.body.classList.toggle('nav-open', open);
  if (open) fitNav();
  if (focusToggle) toggle.focus();
}

function fitNav() {
  const header = $('#site-header');
  if (header) header.style.setProperty('--nav-top', `${Math.max(0, Math.round(header.getBoundingClientRect().bottom))}px`);
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.classList.contains('nav-open')) setNavOpen(false, { focusToggle: true });
});
addEventListener('resize', () => document.body.classList.contains('nav-open') && fitNav());

// The email-list signup is whatever form code the shop pasted into Emails → Weekly Email Signup (settings.newsletter_embed);
// with nothing there the whole section is left out. innerHTML doesn't run scripts, so the snippet is parsed and its
// <script> tags are re-created as real elements. Embeds are heavy (many pull in reCAPTCHA), so it loads only when the
// visitor scrolls near it.
function loadNewsletterForm(embed) {
  const host = $('#newsletter-form');
  if (!embed || !host || host.dataset.loading === embed) return;
  host.dataset.loading = embed;
  host.replaceChildren();
  const load = () => {
    if (host.dataset.loading !== embed) return; // replaced while waiting
    const tpl = document.createElement('template');
    tpl.innerHTML = embed;
    tpl.content.querySelectorAll('script').forEach((old) => {
      const el = document.createElement('script');
      for (const { name, value } of old.attributes) el.setAttribute(name, value);
      el.text = old.text;
      old.replaceWith(el);
    });
    host.appendChild(tpl.content);
  };
  if (!('IntersectionObserver' in window)) return load();
  const watcher = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    watcher.disconnect();
    load();
  }, { rootMargin: '600px' });
  watcher.observe(host);
}

/**
 * One line of where and when: address, phone and today's hours, or each location's name for a shop with several,
 * linked to the Visit page unless it's off (`off`: the off pages' hrefs).
 */
export function visitLine(s, off = new Set()) {
  if (s.locations?.length) return s.locations.map((l) => (off.has('contact.html') ? esc(l.name) : `<a href="contact.html">${esc(l.name)}</a>`)).join(' · ');
  const addr = addressLines(s);
  const today = todayHours(s.hours, s.holiday_hours, shopToday());
  return [
    addr.length ? `<a href="${esc(mapsHref(s))}">${addr.map(esc).join(', ')}</a>` : '',
    s.phone ? `<a href="${telHref(s.phone)}">${esc(formatPhone(s.phone))}</a>` : '',
    today ? (today.closed ? 'Closed today' : `Open today ${esc(time12(today.open))} – ${esc(time12(today.close))}`) : '',
  ].filter(Boolean).join(' · ');
}

/**
 * The site footer in the shop's chosen layout (js/layouts.js; css/site.css styles each from body[data-footer]):
 * Full (address, hours, social and links in three columns), Simple (logo, one line of links, one line of where and
 * when) or Sign-up first (the newsletter band leads, then a two-column Visit / More block; without a newsletter
 * sign-up it is Simple). The newsletter band sits above every footer when the shop has one.
 */
function renderFooter(s, extraLinks = [], off = new Set()) {
  const addr = addressLines(s);
  // A shop with several locations lists each one's address, phone and hours.
  const multi = !!s.locations?.length;
  const locs = multi ? s.locations.map((l) => ({ ...l, as: locationAs(s, l), addr: addressLines(l) })) : [];
  const footer = $('#site-footer');
  const social = socialIcons(s);
  const embed = s.newsletter_embed?.trim() ?? '';
  const picked = layoutOf(s, document.body.dataset).footer;
  const kind = picked === 'signup' && !embed ? 'simple' : picked;
  if (!embed) $('.newsletter')?.remove();
  else if (!$('.newsletter')) footer.insertAdjacentHTML('beforebegin', `
    <section class="newsletter" aria-labelledby="newsletter-title">
      <div class="container">
        <h2 id="newsletter-title">Get the Weekly New&#8209;Release Email</h2>
        <div class="lede" data-content="home-newsletter:lede"></div>
        <div id="newsletter-form"></div>
      </div>
    </section>`), fillContent(getSettings()).catch(() => {}); // the page's content was filled before this section existed
  $('.newsletter')?.classList.toggle('newsletter--lead', kind === 'signup');
  const links = orderMenu([...FOOTER_LINKS, ...(chatOn(s) ? [{ href: '#chat', label: 'Chat with us' }] : []), ...extraLinks], s.footer_order ?? []).filter((l) => !off.has(l.href)).map((l) => `<li><a href="${esc(l.href)}">${esc(l.label)}</a></li>`).join('');
  const legal = `<p class="container footer__legal">${esc(s.copyright_text ? s.copyright_text.replaceAll('{year}', new Date().getFullYear()) : `© ${new Date().getFullYear()} ${s.shop_name}`)} · ${POWERED_BY}</p>`;
  const visit = visitLine(s, off);
  if (kind === 'simple') {
    footer.innerHTML = `
    <div class="container footer__simple">
      <a class="brand footer__brand" href="index.html">${brandHtml(s).replace(' fetchpriority="high"', ' loading="lazy"')}</a>
      <ul class="footer__links footer__links--inline">${links}</ul>
      ${visit ? `<p class="footer__line">${visit}</p>` : ''}
      ${social}
    </div>
    ${legal}`;
    return;
  }
  if (kind === 'signup') {
    footer.innerHTML = `
    <div class="container footer__grid">
      <section>
        <h2 class="footer__heading">Visit</h2>
        ${visit ? `<p class="footer__line">${visit}</p>` : ''}
        ${social}
      </section>
      <section>
        <h2 class="footer__heading">More</h2>
        <ul class="footer__links">${links}</ul>
      </section>
    </div>
    ${legal}`;
    return;
  }
  footer.innerHTML = `
    <div class="container footer__grid">
      <section>
        <h2 class="footer__heading">${esc(s.shop_name)}</h2>
        ${multi
          ? locs.map((l) => `<p class="footer__location"><strong>${esc(l.name)}</strong>${l.addr.length ? `<br><a href="${esc(mapsHref(l.as))}">${l.addr.map(esc).join('<br>')}</a>` : ''}${l.phone ? `<br><a href="${telHref(l.phone)}">${esc(formatPhone(l.phone))}</a>` : ''}</p>`).join('')
          : `${addr.length ? `<address><a href="${esc(mapsHref(s))}">${addr.map(esc).join('<br>')}</a></address>` : ''}
        ${s.phone ? `<p><a href="${telHref(s.phone)}">${esc(formatPhone(s.phone))}</a></p>` : ''}`}
        ${s.email ? `<p><a href="mailto:${esc(s.email)}">${esc(s.email)}</a></p>` : ''}
      </section>
      <section>
        ${multi
          ? `<h2 class="footer__heading">Hours</h2>${locs.filter((l) => l.hours?.length).map((l) => `<h3 class="footer__sub">${esc(l.name)}</h3>${hoursList(l.hours, l.holiday_hours)}`).join('')}`
          : s.hours?.length ? `<h2 class="footer__heading">Hours</h2>${hoursList(s.hours, s.holiday_hours)}` : ''}
        ${social ? `<h2 class="footer__heading${s.hours?.length ? ' footer__heading--next' : ''}">Social</h2>${social}` : ''}
      </section>
      <section>
        <h2 class="footer__heading">More</h2>
        <ul class="footer__links">${links}</ul>
      </section>
    </div>
    ${legal}`;
}

let pageTitle;

/** Fill any <… data-setting="field"> placeholders in the page body. */
function fillSettings(s) {
  document.querySelectorAll('[data-setting]').forEach((el) => {
    const v = s[el.dataset.setting];
    if (v != null) el.textContent = v;
  });
  // Pages carry just their own name in <title>; the shop name is added in front here. On the live sites the
  // Worker has already written the full title (including any staff-set one) into the HTML, so it's kept as is.
  pageTitle ??= document.title; // fillSettings can run again when fresh settings replace the saved ones
  if (s.shop_name && pageTitle.includes(s.shop_name)) return;
  document.title = pageTitle.trim() ? `${s.shop_name} — ${pageTitle}` : `${s.shop_name} — ${s.tagline ?? ''}`;
}

const SCHEMA_DAYS = { Mo: 'Monday', Tu: 'Tuesday', We: 'Wednesday', Th: 'Thursday', Fr: 'Friday', Sa: 'Saturday', Su: 'Sunday' };
/** Opening hours (settings.hours, or a location's) as schema.org OpeningHoursSpecification entries. */
// Holiday dates follow as one-day entries (validFrom = validThrough); a closed day opens and closes at 00:00, as Google reads it.
const schemaHours = (hours, holidays) => [
  ...(hours ?? []).map((h) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: h.days.map((d) => `https://schema.org/${SCHEMA_DAYS[d]}`), opens: h.open, closes: h.close })),
  ...upcomingHolidays(holidays, shopToday()).map((h) => ({ '@type': 'OpeningHoursSpecification', validFrom: h.date, validThrough: h.date, opens: h.closed ? '00:00' : h.open, closes: h.closed ? '00:00' : h.close })),
];
/** A schema.org PostalAddress for a shop or location, or undefined without a street. */
const schemaAddress = (a) =>
  a.street ? { '@type': 'PostalAddress', streetAddress: a.street, addressLocality: a.city, addressRegion: a.region, postalCode: a.postal_code, addressCountry: a.country } : undefined;

function injectSchema(s) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Store',
    name: s.shop_name,
    url: SITE_URL,
    telephone: s.phone || undefined,
    email: s.email || undefined,
    image: s.logo_url || undefined,
    foundingDate: s.founded_year ? String(s.founded_year) : undefined,
    address: schemaAddress(s),
    openingHoursSpecification: schemaHours(s.hours, s.holiday_hours),
    sameAs: socialEntries(s).map(([, url]) => url),
  };
  // Several locations: one Store per location, so search engines see each address and its hours.
  const stores = s.locations?.length
    ? s.locations.map((l) => ({
        ...data,
        '@id': `${SITE_URL}#location-${l.id}`,
        name: `${s.shop_name} : ${l.name}`,
        telephone: l.phone || undefined,
        address: schemaAddress(l),
        openingHoursSpecification: schemaHours(l.hours, l.holiday_hours),
      }))
    : null;
  const tag = document.createElement('script');
  tag.type = 'application/ld+json';
  tag.textContent = JSON.stringify(stores ? { '@context': 'https://schema.org', '@graph': stores.map(({ '@context': _, ...store }) => store) } : data);
  document.head.append(tag);
}

/**
 * Canonical address for search engines, on pages whose HTML doesn't carry one: SITE_URL plus the path and the
 * query parameters that pick the content (post, event, staff page, survey). Pages marked noindex get none.
 */
function addCanonical() {
  if (!SITE_URL || document.querySelector('link[rel="canonical"], meta[name="robots"][content*="noindex"]')) return;
  const params = new URLSearchParams(location.search);
  const keep = new URLSearchParams([...params].filter(([k]) => k === 'slug' || k === 'id'));
  const path = location.pathname.replace(/\/index\.html$/, '/');
  const link = document.createElement('link');
  link.rel = 'canonical';
  link.href = `${SITE_URL.replace(/\/$/, '')}${path}${keep.size ? `?${keep}` : ''}`;
  document.head.append(link);
}

function loadAnalytics(settings) {
  const id = (settings.ga_measurement_id || GA_MEASUREMENT_ID || '').trim();
  if (!/^G-[A-Z0-9]+$/i.test(id)) return;
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
  document.head.append(s);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () {
    window.dataLayer.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', id);
}

// Staff-supplied code from Shop settings (a help chat, etc.). Scripts inserted via innerHTML don't run, so each
// one is rebuilt as a real element; a snippet without any <script> tag is treated as plain JavaScript.
function runFooterScripts(settings) {
  const code = (settings.footer_scripts ?? '').trim();
  if (!code) return;
  const box = document.createElement('template');
  box.innerHTML = /<[a-z!][^>]*>/i.test(code) ? code : `<script>${code}</script>`;
  for (const node of [...box.content.childNodes]) {
    try {
      if (node.nodeName !== 'SCRIPT') {
        document.body.append(node);
        continue;
      }
      const s = document.createElement('script');
      for (const a of node.attributes) s.setAttribute(a.name, a.value);
      s.textContent = node.textContent;
      document.body.append(s);
    } catch (err) {
      console.error('Footer code failed', err);
    }
  }
}

// Analytics waits until the page has finished loading and the browser is idle, so it never competes with what
// the visitor is waiting to see. (Someone who leaves within a few seconds of the load isn't counted.)
function loadAnalyticsWhenIdle(settings) {
  const start = () => ('requestIdleCallback' in window ? requestIdleCallback(() => loadAnalytics(settings), { timeout: 4000 }) : setTimeout(() => loadAnalytics(settings), 2000));
  if (document.readyState === 'complete') start();
  else addEventListener('load', start, { once: true });
}

// ---------------------------------------------------------------------------
// Lightbox: any <a data-lightbox href="big.jpg"><img …></a> opens in a modal. Inside a picture gallery (.gallery, from the
// editor's Gallery button) it also steps through that gallery's pictures (buttons or ← →) and shows the captions.
// ---------------------------------------------------------------------------

function setupLightbox() {
  const dialog = document.createElement('dialog');
  dialog.className = 'lightbox';
  dialog.setAttribute('aria-label', 'Picture');
  dialog.innerHTML = `<button class="lightbox__close" type="button" aria-label="Close">✕</button>
    <img alt="">
    <button class="lightbox__nav lightbox__nav--prev" type="button" aria-label="Previous picture" hidden>‹</button>
    <button class="lightbox__nav lightbox__nav--next" type="button" aria-label="Next picture" hidden>›</button>
    <div class="lightbox__bar"><p class="lightbox__caption" aria-live="polite"></p></div>`;
  document.body.append(dialog);
  const img = $('img', dialog);
  const caption = $('.lightbox__caption', dialog);
  const nav = [...dialog.querySelectorAll('.lightbox__nav')];
  const bar = $('.lightbox__bar', dialog);
  let group = [];
  let at = 0;
  const show = (i) => {
    at = (i + group.length) % group.length;
    const link = group[at];
    const text = link.closest('figure')?.querySelector('figcaption')?.textContent.trim() ?? '';
    img.src = link.href;
    img.alt = $('img', link)?.alt ?? '';
    caption.textContent = text;
    bar.hidden = !text;
  };
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog || e.target.closest('.lightbox__close')) dialog.close();
    else if (e.target.closest('.lightbox__nav--prev')) show(at - 1);
    else if (e.target.closest('.lightbox__nav--next')) show(at + 1);
  });
  dialog.addEventListener('keydown', (e) => {
    if (group.length < 2 || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    show(at + (e.key === 'ArrowLeft' ? -1 : 1));
  });
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[data-lightbox]');
    if (!link) return;
    e.preventDefault();
    const gallery = link.closest('.gallery');
    group = gallery ? [...gallery.querySelectorAll('a[data-lightbox]')] : [link];
    nav.forEach((b) => (b.hidden = group.length < 2));
    show(group.indexOf(link));
    dialog.showModal();
  });
}

// ---------------------------------------------------------------------------

/** Call once per page. Resolves with the shop settings. */
/** Remember the logo and banner photo so the next page view can preload them from the <head>, before any script runs. */
function rememberPreloads(s) {
  try {
    localStorage.setItem('pc-preload', JSON.stringify({ logo: sizedImage(s.logo_url, LOGO_WIDTH) || '', hero: sizedImage(s.hero_image_url, HERO_WIDTH) || '' }));
  } catch {
    /* private mode: the images just load a little later */
  }
}

/**
 * Images are lazy by default so below-the-fold pictures wait until they're needed. Any lazy image that
 * lands inside the first screen while the page is being built is switched to eager (and the first few
 * get high priority), so what people see first isn't held back by lazy loading.
 */
function loadAboveTheFoldImages() {
  let pending = false;
  let boosted = 0;
  const check = () => {
    pending = false;
    for (const img of document.querySelectorAll('main img[loading="lazy"]')) {
      const top = img.getBoundingClientRect().top;
      if (top < innerHeight && top > -innerHeight) {
        img.loading = 'eager';
        if (boosted++ < 4) img.fetchPriority = 'high';
      }
    }
  };
  const observer = new MutationObserver(() => {
    if (!pending) {
      pending = true;
      requestAnimationFrame(check);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  // Content settles within a few seconds; after that new images (filters, paging) stay lazy.
  setTimeout(() => observer.disconnect(), 5000);
}

// How long the first visit waits for the shop settings before telling the visitor the site is slow.
const SETTINGS_TIMEOUT = 5000;

/** Resolves with `p`, or with `fallback` (calling it if it's a function) if `p` takes longer than `ms`. */
const within = (p, ms, fallback) => {
  let timer;
  const late = new Promise((resolve) => (timer = setTimeout(() => resolve(typeof fallback === 'function' ? fallback() : fallback), ms)));
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
};

/** The last saved settings however old (readCache drops week-old ones), for the shop's phone and address in an outage. */
function lastKnownSettings() {
  try {
    return JSON.parse(localStorage.getItem('pc-cache:settings'))?.v ?? null; // cache.js's key
  } catch {
    return null;
  }
}

/**
 * Maintenance mode (settings.maintenance_mode, switched on by an owner on the Dashboard): a full-screen "be right
 * back" notice over the page, also on the pull list app. Idempotent, so it is safe to call on the saved snapshot and
 * again on the fresh settings; the page underneath is left alone (but made inert, so Tab can't reach it) and the
 * staff admin never loads this file. It is cosmetic: the database and the app's data calls keep answering.
 */
export function applyMaintenance(s) {
  const old = document.getElementById('maintenance');
  if (!s.maintenance_mode) {
    old?.remove();
    document.documentElement.classList.remove('is-maintenance');
    document.querySelectorAll('[data-maint-inert]').forEach((el) => (el.inert = false, el.removeAttribute('data-maint-inert')));
    return;
  }
  const reach = [
    s.phone && `call <a href="${esc(telHref(s.phone))}">${esc(formatPhone(s.phone))}</a>`,
    s.email && `email <a href="mailto:${esc(s.email)}">${esc(s.email)}</a>`,
  ].filter(Boolean);
  const html = `
    <div class="maintenance__box">
      <h1>${esc(s.shop_name ? s.shop_name + ' Will Be' : 'We Will Be')} Right Back</h1>
      <p>${s.maintenance_message ? esc(s.maintenance_message) : 'The site is down for a little maintenance. Please check back shortly.'}</p>
      ${reach.length ? `<p>In the meantime, ${reach.join(' or ')}.</p>` : ''}
    </div>`;
  const el = old ?? Object.assign(document.createElement('div'), { id: 'maintenance', className: 'maintenance' });
  el.setAttribute('role', 'alert');
  el.innerHTML = html;
  if (!old) {
    document.body.append(el);
    [...document.body.children].forEach((c) => {
      if (c === el || c.inert || /^(SCRIPT|STYLE|TEMPLATE)$/.test(c.tagName)) return;
      c.inert = true;
      c.setAttribute('data-maint-inert', '');
    });
  }
  document.documentElement.classList.add('is-maintenance');
}

/** A message in place of the page when the settings can't be loaded, with how to reach the shop if we know it. */
function outageMessage({ slow }) {
  const s = lastKnownSettings() ?? {};
  const addr = addressLines(s);
  const reach = [
    s.phone && `call <a href="${esc(telHref(s.phone))}">${esc(formatPhone(s.phone))}</a>`,
    s.email && `email <a href="mailto:${esc(s.email)}">${esc(s.email)}</a>`,
  ].filter(Boolean);
  return `
    <div class="container section" role="status">
      <h1>${slow ? 'Still Loading…' : 'We’ll Be Right Back'}</h1>
      <p>${slow ? 'The site is taking longer than usual to load. It will appear here as soon as it’s ready — or try again in a moment.' : 'The site couldn’t load its settings. Please try again shortly.'}</p>
      ${reach.length ? `<p>In the meantime, ${reach.join(' or ')}.</p>` : ''}
      ${addr.length ? `<p>Visit us at <a href="${esc(mapsHref({ shop_name: s.shop_name ?? '', ...s }))}">${addr.map(esc).join(', ')}</a>.</p>` : ''}
    </div>`;
}

export async function initPage() {
  // Staff-made pages are all data-page="custom"; tell them apart by slug so the menu can mark the current one.
  const page = document.body.dataset.page === 'custom' ? `page:${customSlugHere(location.pathname, location.search)}` : document.body.dataset.page;
  // The pull list app (app.html) has just the shop's brand on top and its own tab bar: no menu, footer or list bar.
  const app = page === 'app';
  loadAboveTheFoldImages();
  addCanonical();

  // Everything the layout needs is requested at once. A snapshot from the last visit paints the header, footer
  // and theme right now; fresh data then replaces it only if something changed.
  const settingsP = getSettings();
  // A hung request leaves the extra menu pages out rather than holding up the page.
  const customP = within(getCustomPages(), SETTINGS_TIMEOUT, null).catch((err) => (console.error(err), null));
  const customerP = initCustomer();
  const contentP = fillContent(settingsP);
  contentP.catch(() => {}); // reported below; this keeps an early exit from logging it twice

  const paint = (s, custom) => {
    // Pages the shop switched off (Admin → Pages): this one shows the not-found page; links to them disappear.
    const offList = s.disabled_pages ?? [];
    const self = slugOfPage(document.body.dataset.page, location.search, location.pathname);
    if (self && offList.includes(self)) return location.replace('404.html');
    const off = offHrefs(offList);
    document.documentElement.dataset.off = offList.join(' '); // css/site.css hides links to them in page text
    setShopTimeZone(s.timezone);
    // The built-in fallback has no colors or fonts: leave the Worker's theme alone until the real settings arrive.
    if (s !== FALLBACK_SETTINGS) applyTheme(s);
    // The layout picks on <body> (the Worker stamps them; the saved settings win once loaded): css/site.css and the
    // header, hero and footer code read them from there.
    if (!app) Object.assign(document.body.dataset, layoutOf(s, document.body.dataset));
    if (app) renderAppHeader(s);
    else {
      const pageHref = (p) => customHref(p.slug);
      renderHeader(s, page, custom.filter((p) => p.placement === 'menu').map((p) => ({ page: `page:${p.slug}`, href: pageHref(p), label: p.title })), off);
      renderFooter(s, custom.filter((p) => p.placement === 'footer').map((p) => ({ href: pageHref(p), label: p.title })), off);
      loadNewsletterForm(s.newsletter_embed?.trim() ?? '');
    }
    fillSettings(s);
    applyMaintenance(s); // after the header and footer, so it also covers the app
  };
  let shown = { s: readCache('settings'), custom: readCache('custom-pages') };
  if (shown.s && shown.custom) paint(shown.s, shown.custom);
  else {
    // First visit (or a cleared browser): draw the header, menu and footer from the built-in defaults now, so
    // the visitor can get around even if the database is slow or down; the real settings repaint them.
    shown = null;
    paint(FALLBACK_SETTINGS, []);
  }

  let s;
  // Without a snapshot, a slow answer gets a message after a few seconds instead of a page that never finishes.
  // The page keeps waiting and fills in normally if the settings do arrive.
  // (Added above the page's own content, which page scripts may already be filling in, and removed once loaded.)
  let notice;
  const slowTimer = shown ? null : setTimeout(() => {
    notice = document.createElement('div');
    notice.innerHTML = outageMessage({ slow: true });
    $('#main').prepend(notice);
  }, SETTINGS_TIMEOUT);
  try {
    // With a snapshot on screen, a hung request just means this page view runs on the snapshot.
    s = await (shown ? within(settingsP, SETTINGS_TIMEOUT, () => shown.s) : settingsP);
    clearTimeout(slowTimer);
    notice?.remove();
  } catch (err) {
    clearTimeout(slowTimer);
    console.error(err);
    if (!shown) {
      $('#main').innerHTML = outageMessage({ slow: false });
      throw err;
    }
    s = shown.s; // keep the page as the last visit left it
  }
  // Pages staff added in the admin (Page Text → New page); a failure just leaves them out.
  const custom = (await customP) ?? shown?.custom ?? [];
  writeCache('settings', s);
  writeCache('custom-pages', custom);
  if (!shown || !sameData(shown.s, s) || !sameData(shown.custom, custom)) paint(s, custom); // (always on a first visit: the defaults are showing)
  rememberPreloads(s);
  // Neither may hold the page up for good if the database stops answering.
  await within(customerP, SETTINGS_TIMEOUT, null); // before any cards render, so they show the right button
  await within(contentP, SETTINGS_TIMEOUT, null).catch((err) => console.error('Page content failed to load', err));
  setupLightbox();
  loadAnalyticsWhenIdle(s);
  // The live chat button (Shop Settings → Online), on the website and in the app. Loaded lazily, and only on shops
  // that switched it on. The app has no footer: its Shop tab has the "Chat with us" link.
  if (chatOn(s)) import('./chat.js').then((m) => m.initChat(s, app ? { findAgain: 'Find it again on the Shop tab.' } : undefined)).catch((err) => console.error('Live chat failed to load', err));
  if (app) return s; // staff footer code (a help chat) would sit on the tab bar
  injectSchema(s);
  runFooterScripts(s);
  // Reservation list bar follows the customer across pages. Loaded lazily:
  // components.js imports this module, so a static import would be circular.
  import('./components.js').then((m) => m.initReservationBar());
  return s;
}
