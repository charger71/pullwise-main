// Shared layout and helpers for every customer-facing page.
// Pages include <body data-page="…">, an empty <header id="site-header">,
// <main id="main">, and <footer id="site-footer">; this fills in the rest
// from the shop settings so nothing shop-specific is hardcoded in HTML.

import { getSettings, getCustomPages, DEMO } from './data.js';
import { GA_MEASUREMENT_ID, SITE_URL } from './config.js';
import { SOCIAL_ICONS, LINK_ICON } from './social-icons.js';
import { fillContent } from './content.js';
import { initCustomer } from './customer.js';
import { readCache, writeCache, sameData } from './cache.js';
import { esc, itemTitle, heroHeadlineHtml, sizedImage, LOGO_WIDTH, HERO_WIDTH, formatPhone } from './util.js';
import { ITEM_STATUS } from './labels.js';
import { localDate, addDays, todayIn, lastReserveDay } from './dates.js';

export { esc, itemTitle, heroHeadlineHtml, sizedImage, HERO_WIDTH, localDate, addDays, lastReserveDay };

const NAV = [
  { page: 'preorders', href: 'pre-orders.html', label: 'Pre-Orders' },
  { page: 'arrivals', href: 'new-arrivals.html', label: 'New Arrivals' },
  { page: 'we-buy', href: 'we-buy-comics.html', label: 'We Buy' },
  { page: 'calendar', href: 'calendar.html', label: 'Calendar' },
  { page: 'blog', href: 'blog.html', label: 'News' },
  { page: 'contact', href: 'contact.html', label: 'Visit' },
  { page: 'account', href: 'account.html', label: 'My Pull List' },
];

const FOOTER_LINKS = [
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

export const price = (n) => (n == null ? '' : `$${Number(n).toFixed(2)}`);

export const fmtDate = (iso, opts = { month: 'short', day: 'numeric' }) =>
  iso ? (iso.length === 10 ? localDate(iso) : new Date(iso)).toLocaleDateString(undefined, opts) : '';

export const fmtTime = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

// Dates like "today" follow the shop's timezone (from settings, set in
// initPage) so the site's cutoffs match what the database enforces.
let shopTimeZone;

/** Today's date in the shop's timezone, as YYYY-MM-DD. */
export const shopToday = () => todayIn(shopTimeZone);

/** Earliest FOC date still open for reservations today (shop time): the day after this Saturday. */
export const openFocFrom = () => {
  const today = shopToday();
  return addDays(today, 7 - localDate(today).getDay());
};

/** Whole days from today (shop time) until an ISO date (negative if past). */
export const daysUntil = (iso) => Math.round((localDate(iso) - localDate(shopToday())) / 86400000);

// Reservations close at midnight (shop time) on the Saturday before a title's FOC
// (usually a Monday), so the shop has time to collect and place the order. The
// database enforces the same rule in create_reservation_order().
export const cutoffPassed = (item) => !!item?.foc_date && daysUntil(lastReserveDay(item.foc_date)) < 0;

// Collector badges staff tick on a title. Order here is display order.
export const ITEM_BADGES = {
  first_appearance: '1st Appearance',
  key_issue: 'Key Issue',
  first_issue: 'First Issue',
  final_issue: 'Final Issue',
  milestone: 'Milestone Issue',
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
    : `<div class="cover cover--placeholder" aria-hidden="true">Image coming soon</div>`;

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

export const hoursList = (hours) =>
  `<dl class="hours">${hours
    .map((h) => `<div><dt>${esc(dayLabel(h.days))}</dt><dd>${esc(time12(h.open))} – ${esc(time12(h.close))}</dd></div>`)
    .join('')}</dl>`;

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

function applyTheme(colors = {}) {
  const root = document.documentElement.style;
  for (const [key, value] of Object.entries(colors)) {
    if (/^#[0-9a-f]{3,8}$/i.test(value)) root.setProperty(`--brand-${key}`, value);
  }
  // Text on the main color (buttons) and the footer's text follow their backgrounds so any color stays readable.
  if (/^#[0-9a-f]{6}$/i.test(colors.primary ?? '')) root.setProperty('--on-primary', isLight(colors.primary) ? '#161616' : '#ffffff');
  if (/^#[0-9a-f]{6}$/i.test(colors.footer ?? '') && isLight(colors.footer)) {
    root.setProperty('--footer-text', '#161616');
    root.setProperty('--footer-heading', '#161616');
    root.setProperty('--footer-link', '#0b3d91');
  }
}

/** Relative luminance check (WCAG formula): true for light colors. */
function isLight(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4;
}

function renderHeader(s, page, extraNav = []) {
  // Logo, name, or both (settings.show_name_with_logo). With both, the logo is
  // decorative (empty alt) so screen readers don't hear the name twice.
  const name = `<span class="brand__name">${esc(s.shop_name).replace('&amp;', '<span>&amp;</span>')}</span>`;
  const brand = !s.logo_url
    ? name
    : s.show_name_with_logo
      ? `<img src="${esc(sizedImage(s.logo_url, LOGO_WIDTH))}" alt="" class="brand__logo" fetchpriority="high">${name}`
      : `<img src="${esc(sizedImage(s.logo_url, LOGO_WIDTH))}" alt="${esc(s.shop_name)}" class="brand__logo" fetchpriority="high">`;
  $('#site-header').innerHTML = `
    <a class="skip-link" href="#main">Skip to content</a>
    <div class="topbar">
      <div class="topbar__inner container">
        ${s.announcement ? `<p class="topbar__notice"><strong>Announcement:</strong> ${linkify(s.announcement)}</p>` : '<p class="topbar__notice" hidden></p>'}
        <form class="topbar__search" role="search" action="search.html">
          <label class="visually-hidden" for="site-q">Search the site</label>
          <input id="site-q" type="search" name="q" placeholder="Search" maxlength="100" autocomplete="off" required>
          <button class="topbar__btn" type="submit" aria-label="Search"><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg></button>
        </form>
      </div>
    </div>
    ${DEMO ? '<p class="demo-banner">Demo mode — showing sample data. Connect Supabase in <code>js/config.js</code>.</p>' : ''}
    <div class="header__bar container">
      <a class="brand" href="index.html">${brand}</a>
      <button class="nav-toggle" aria-expanded="false" aria-controls="site-nav">
        <span class="nav-toggle__icon" aria-hidden="true"></span><span class="visually-hidden">Menu</span>
      </button>
      <nav id="site-nav" class="nav" aria-label="Main">
        <ul>${[...NAV, ...extraNav].map(
          (n) => `<li><a href="${n.href}"${n.page === page ? ' aria-current="page"' : ''}>${n.label}</a></li>`,
        ).join('')}</ul>
      </nav>
    </div>`;
  const toggle = $('.nav-toggle');
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', open);
    document.body.classList.toggle('nav-open', open);
  });
}

const NEWSLETTER_FORM_ID = '8d70c80d-4f25-11ed-afd1-0607cdff6e39';

// innerHTML doesn't run scripts, so the email-list embed is added as a real element. It's large (it pulls in
// reCAPTCHA), so it loads only when the visitor scrolls near it.
function loadNewsletterForm() {
  const host = $('#newsletter-form');
  if (!host || host.dataset.loading) return;
  host.dataset.loading = '1';
  const load = () => {
    const el = document.createElement('script');
    el.async = true;
    el.src = `https://eomail8.com/form/${NEWSLETTER_FORM_ID}.js`;
    el.dataset.form = NEWSLETTER_FORM_ID;
    host.appendChild(el);
  };
  if (!('IntersectionObserver' in window)) return load();
  const watcher = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    watcher.disconnect();
    load();
  }, { rootMargin: '600px' });
  watcher.observe(host);
}

function renderFooter(s, extraLinks = []) {
  const addr = addressLines(s);
  const footer = $('#site-footer');
  const social = socialIcons(s);
  if (!$('.newsletter')) footer.insertAdjacentHTML('beforebegin', `
    <section class="newsletter" aria-labelledby="newsletter-title">
      <div class="container">
        <h2 id="newsletter-title">Get the Weekly New&#8209;Release Email</h2>
        <div class="lede" data-content="home-newsletter:lede"></div>
        <div id="newsletter-form"></div>
      </div>
    </section>`);
  footer.innerHTML = `
    <div class="container footer__grid">
      <section>
        <h2 class="footer__heading">${esc(s.shop_name)}</h2>
        ${addr.length ? `<address><a href="${mapsHref(s)}">${addr.map(esc).join('<br>')}</a></address>` : ''}
        ${s.phone ? `<p><a href="${telHref(s.phone)}">${esc(formatPhone(s.phone))}</a></p>` : ''}
        ${s.email ? `<p><a href="mailto:${esc(s.email)}">${esc(s.email)}</a></p>` : ''}
      </section>
      <section>
        <h2 class="footer__heading">Hours</h2>
        ${hoursList(s.hours ?? [])}
        ${social ? `<h2 class="footer__heading footer__heading--next">Social</h2>${social}` : ''}
      </section>
      <section>
        <h2 class="footer__heading">More</h2>
        <ul class="footer__links">${[...FOOTER_LINKS, ...extraLinks].map((l) => `<li><a href="${l.href}">${l.label}</a></li>`).join('')}</ul>
      </section>
    </div>
    <p class="container footer__legal">${esc(s.copyright_text ? s.copyright_text.replaceAll('{year}', new Date().getFullYear()) : `© ${new Date().getFullYear()} ${s.shop_name}`)}</p>`;
}

let pageTitle;

/** Fill any <… data-setting="field"> placeholders in the page body. */
function fillSettings(s) {
  document.querySelectorAll('[data-setting]').forEach((el) => {
    const v = s[el.dataset.setting];
    if (v != null) el.textContent = v;
  });
  // Pages carry just their own name in <title>; the shop name is appended here.
  // A title staff set on the Pages screen is baked into the HTML (tools/apply-seo.js) and used as-is.
  if (document.querySelector('title[data-seo]')) return;
  pageTitle ??= document.title; // fillSettings can run again when fresh settings replace the saved ones
  document.title = pageTitle.trim() ? `${s.shop_name} — ${pageTitle}` : `${s.shop_name} — ${s.tagline ?? ''}`;
}

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
    address: s.street
      ? { '@type': 'PostalAddress', streetAddress: s.street, addressLocality: s.city, addressRegion: s.region, postalCode: s.postal_code, addressCountry: s.country }
      : undefined,
    openingHoursSpecification: (s.hours ?? []).map((h) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: h.days.map((d) => `https://schema.org/${{ Mo: 'Monday', Tu: 'Tuesday', We: 'Wednesday', Th: 'Thursday', Fr: 'Friday', Sa: 'Saturday', Su: 'Sunday' }[d]}`),
      opens: h.open,
      closes: h.close,
    })),
    sameAs: socialEntries(s).map(([, url]) => url),
  };
  const tag = document.createElement('script');
  tag.type = 'application/ld+json';
  tag.textContent = JSON.stringify(data);
  document.head.append(tag);
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
// Lightbox: any <a data-lightbox href="big.jpg"><img …></a> opens in a modal.
// ---------------------------------------------------------------------------

function setupLightbox() {
  const dialog = document.createElement('dialog');
  dialog.className = 'lightbox';
  dialog.innerHTML = `<button class="lightbox__close" aria-label="Close">✕</button><img alt="">`;
  document.body.append(dialog);
  const img = $('img', dialog);
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog || e.target.closest('.lightbox__close')) dialog.close();
  });
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[data-lightbox]');
    if (!link) return;
    e.preventDefault();
    img.src = link.href;
    img.alt = $('img', link)?.alt ?? '';
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

export async function initPage() {
  // Staff-made pages are all data-page="custom"; tell them apart by slug so the menu can mark the current one.
  const page = document.body.dataset.page === 'custom' ? `page:${new URLSearchParams(location.search).get('slug')}` : document.body.dataset.page;
  loadAboveTheFoldImages();

  // Everything the layout needs is requested at once. A snapshot from the last visit paints the header, footer
  // and theme right now; fresh data then replaces it only if something changed.
  const settingsP = getSettings();
  const customP = getCustomPages().catch((err) => (console.error(err), null));
  const customerP = initCustomer();
  const contentP = fillContent(settingsP);
  contentP.catch(() => {}); // reported below; this keeps an early exit from logging it twice

  const paint = (s, custom) => {
    shopTimeZone = s.timezone;
    applyTheme(s.colors);
    const pageHref = (p) => `page.html?slug=${encodeURIComponent(p.slug)}`;
    renderHeader(s, page, custom.filter((p) => p.placement === 'menu').map((p) => ({ page: `page:${p.slug}`, href: pageHref(p), label: p.title })));
    renderFooter(s, custom.filter((p) => p.placement === 'footer').map((p) => ({ href: pageHref(p), label: p.title })));
    loadNewsletterForm();
    fillSettings(s);
  };
  let shown = { s: readCache('settings'), custom: readCache('custom-pages') };
  if (shown.s && shown.custom) paint(shown.s, shown.custom);
  else shown = null;

  let s;
  try {
    s = await settingsP;
  } catch (err) {
    console.error(err);
    if (!shown) {
      $('#main').innerHTML = `<div class="container section"><h1>We'll Be Right Back</h1><p>The site couldn't load its settings. Please try again shortly.</p></div>`;
      throw err;
    }
    s = shown.s; // keep the page as the last visit left it
  }
  // Pages staff added in the admin (Page Text → New page); a failure just leaves them out.
  const custom = (await customP) ?? shown?.custom ?? [];
  writeCache('settings', s);
  writeCache('custom-pages', custom);
  if (!shown || !sameData(shown.s, s) || !sameData(shown.custom, custom)) paint(s, custom);
  rememberPreloads(s);
  await customerP; // before any cards render, so they show the right button
  await contentP.catch((err) => console.error('Page content failed to load', err));
  injectSchema(s);
  setupLightbox();
  loadAnalyticsWhenIdle(s);
  runFooterScripts(s);
  // Reservation list bar follows the customer across pages. Loaded lazily:
  // components.js imports this module, so a static import would be circular.
  import('./components.js').then((m) => m.initReservationBar());
  return s;
}
