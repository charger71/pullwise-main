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

/** The address of a page by slug: a built-in one's file, or a staff-made page's page.html link. */
export const pageHref = (slug) => OPTIONAL_PAGES[slug]?.href ?? `page.html?slug=${encodeURIComponent(slug)}`;

/** The links that go nowhere now: every switched-off page's address. */
export const offHrefs = (off = []) => new Set(off.map(pageHref));

/** The slug of the page this document is (`page` is <body data-page>), or null for a page that can't be switched off. */
export function slugOfPage(page, search = '') {
  if (page === 'custom') return new URLSearchParams(search).get('slug');
  return Object.keys(OPTIONAL_PAGES).find((k) => OPTIONAL_PAGES[k].page === page) ?? null;
}

/** Links (each with a `page` key, or just an `href`) in the order a shop saved (settings.menu_order, footer_order).
 * Links it doesn't list keep their usual order after the listed ones. */
export function orderMenu(items, saved = []) {
  const rank = (n) => { const i = saved.indexOf(n.page ?? n.href); return i < 0 ? saved.length : i; };
  return items.map((n, i) => [n, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([n]) => n);
}
