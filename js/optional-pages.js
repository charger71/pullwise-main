// Built-in pages a shop can switch off (Admin → Pages; settings.disabled_pages). A page that is off leaves the menu,
// footer and search, links to it in page text are hidden (css/site.css, [data-off]), and its address shows the
// not-found page. Calendar and News take their event and post pages with them (event.html and post.html share their
// data-page), and the home page's events and news blocks. The others (home, Pre-Orders, New Arrivals, Privacy, Terms)
// are always on: the shop runs on them. Staff-made pages can always be switched off.

/** pages.slug → the page's file and its <body data-page>. */
export const OPTIONAL_PAGES = {
  about: { href: 'about.html', page: 'about' },
  visit: { href: 'contact.html', page: 'contact' },
  'we-buy-comics': { href: 'we-buy-comics.html', page: 'we-buy' },
  'gift-cards': { href: 'gift-cards.html', page: 'giftcards' },
  'how-to': { href: 'how-to.html', page: 'how-to' },
  faq: { href: 'faq.html', page: 'faq' },
  calendar: { href: 'calendar.html', page: 'calendar' },
  news: { href: 'blog.html', page: 'blog' },
};

/**
 * Addresses a staff-made page can't take: every file and folder at the top of the site, the built-in pages' names, and
 * the Worker's own addresses. A staff-made page lives at /<slug>, and the files are served first, so one of these would
 * hide the page (js/slugs.test.js checks the files and folders are all here).
 */
export const RESERVED_SLUGS = [
  '404', 'about', 'account', 'app', 'blog', 'calendar', 'contact', 'event', 'faq', 'gift-cards', 'go', 'how-to', 'index', 'new-arrivals', 'page', 'post',
  'pre-orders', 'privacy', 'search', 'survey', 'terms', 'we-buy-comics', // the HTML files
  'admin', 'css', 'fonts', 'icons', 'js', 'supabase', 'tools', 'worker', // the folders
  'manifest', 'robots', 'sitemap', 'sw', 'readme', // other files and the Worker's addresses
  'home', 'news', 'visit', 'pull-list', // built-in pages' names
];

/** The address of a staff-made page: its slug at the top of the site. */
export const customHref = (slug) => `/${slug}`;

/** The address of a news post: /news/<slug> (the Worker serves post.html there). */
export const postHref = (slug) => `/news/${slug}`;

/** The slug of the post being viewed: /news/grand-opening, or, from links made before posts had their own address, post.html?slug=grand-opening. */
export function postSlugHere(pathname = '', search = '') {
  const q = new URLSearchParams(search).get('slug');
  if (q) return q;
  return /^\/news\/([^/]+)\/?$/.exec(decodeURIComponent(pathname))?.[1] ?? null;
}

/** The address of a page by slug: a built-in one's file, or a staff-made page's own address. */
export const pageHref = (slug) => OPTIONAL_PAGES[slug]?.href ?? customHref(slug);

/**
 * The slug of the staff-made page being viewed: /ambassador-program (the Worker serves page.html there), or, for
 * links made before pages had their own address, page.html?slug=ambassador-program. Null on page.html itself.
 */
export function customSlugHere(pathname = '', search = '') {
  const q = new URLSearchParams(search).get('slug');
  if (q) return q;
  const seg = decodeURIComponent(pathname).replace(/^\/+|\/+$/g, '');
  return seg && !seg.includes('/') && seg !== 'page' && seg !== 'page.html' ? seg : null;
}

/** The links that go nowhere now: every switched-off page's address. */
export const offHrefs = (off = []) => new Set(off.map(pageHref));

/** The slug of the page this document is (`page` is <body data-page>), or null for a page that can't be switched off. */
export function slugOfPage(page, search = '', pathname = '') {
  if (page === 'custom') return customSlugHere(pathname, search);
  return Object.keys(OPTIONAL_PAGES).find((k) => OPTIONAL_PAGES[k].page === page) ?? null;
}

/** Links (each with a `page` key, or just an `href`) in the order a shop saved (settings.menu_order, footer_order).
 * Links it doesn't list keep their usual order after the listed ones. */
export function orderMenu(items, saved = []) {
  const rank = (n) => { const i = saved.indexOf(n.page ?? n.href); return i < 0 ? saved.length : i; };
  return items.map((n, i) => [n, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([n]) => n);
}
