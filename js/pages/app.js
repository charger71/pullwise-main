// The shop's pull list app (app.html, served at /app; the Worker gives it the shop's install manifest). It's the
// account page (js/pages/account.js) shown one view at a time under a tab bar — My List, Hot, Following, Shop and
// Account — with the shop's brand on top, so the installed app is the shop's own. Tabs are #hash links, so the back
// button and links from outside (a notification) can open one. sw.js keeps the app opening without a connection.

import { $, esc, announceIn, motionMs, sizedImage, addressLines, hoursList, mapsHref, telHref, socialIcons, linkify, locationAs, openFocFrom, addDays } from '../site.js';
import { getSettings, getItems, rankByPulls } from '../data.js';
import { todayIn } from '../dates.js';
import { itemCard, enableReservations } from '../components.js';
import { loadFilters, filterControl, setupMulti, publisherFilter, categoryOptions, focFilter } from '../catalog.js';
import { formatPhone, LOGO_WIDTH, prefersReducedMotion as reducedMotion } from '../util.js';
import { setShopColors, setupAppearance } from '../app-theme.js';
import { kept, keep, isInstalled as installed, isIPhone as iPhone, buzzOnCross } from '../app-device.js';

const VIEWS = ['list', 'hot', 'shop', 'me'];

// Where the app was left: the tab and each tab's scroll position, kept on this phone when the app goes to the
// background. A phone closes background apps to save memory; opening it again puts you back on that tab (unless a
// link, a notification or a shortcut names one) and, within the hour, where you were scrolled.
const PLACE = 'pc-app-place';
const PLACE_FRESH = 60 * 60 * 1000; // ms a scroll position is worth going back to
const leftAt = VIEWS.includes(kept(PLACE)?.tab) ? kept(PLACE) : null;
if (leftAt && !location.hash) history.replaceState(history.state, '', `#${leftAt.tab}`);

// The loading screen (app.html) goes once the view on screen has something in it, or after 3 seconds at most.
const splash = $('[data-splash]');
function hideSplash() {
  if (!splash || splash.classList.contains('is-gone')) return;
  backToPlace(); // the views are drawn: scroll to where they were left, before the splash fades off them
  splash.classList.add('is-gone');
  setTimeout(() => splash.remove(), motionMs('--dur') + 100); // once it has faded
}
const stillLoading = () => [...document.querySelectorAll('main .loading')].some((el) => el.offsetParent !== null);
if (splash) {
  const watch = new MutationObserver(() => {
    if (stillLoading()) return;
    watch.disconnect();
    hideSplash();
  });
  watch.observe($('main'), { childList: true, subtree: true });
  setTimeout(() => {
    watch.disconnect();
    hideSplash();
  }, 3000);
}

// Covers fade in as they arrive instead of popping in, over a placeholder of their own shape (css/site.css
// .fade-covers). Only with this script running: without it the class is never set and covers show as they load.
document.documentElement.classList.add('fade-covers');
const coverIn = (e) => e.target.matches?.('img.cover') && e.target.classList.add('is-loaded');
document.addEventListener('load', coverIn, true); // load and error don't bubble: catch them on the way down
document.addEventListener('error', coverIn, true);
// Covers already loaded (from the cache) by the time they're drawn fire no load event of their own.
new MutationObserver(() => {
  for (const img of document.querySelectorAll('img.cover:not(.is-loaded)')) if (img.complete) img.classList.add('is-loaded');
}).observe(document.body, { childList: true, subtree: true });

// What screen readers hear about the app itself (refreshing, offline, a new version): one live region that is always
// on the page, so the words are read even when the strip showing them appears at the same moment.
const say = (text) => announceIn($('[data-app-status]'), text);
const OWN_VIEWS = ['hot', 'shop']; // drawn here; the rest are the account page's
const account = $('#account');

/** Show the view the address names (My List by default) and mark its tab. */
function showView({ focus = false } = {}) {
  const want = location.hash.slice(1);
  const view = VIEWS.includes(want) ? want : 'list';
  // Until the customer is signed in (and has finished a first sign-in) the app is only the account page's sign-in or
  // setup form, with "Powered by Pullwise" under it: no tab bar, search, Hot, Shop or Appearance (css/site.css
  // .app-locked). The account page draws its views once they're signed in, and the tab the address names shows then.
  const locked = !account.querySelector('[data-view]');
  document.body.classList.toggle('app-locked', locked);
  if (locked && !$('[data-search]').hidden) return closeSearch();
  // Search results, while there are any, stand in for every view.
  const searching = !locked && !$('[data-search-results]').hidden;
  for (const el of document.querySelectorAll('[data-view]')) el.hidden = locked ? !el.matches('.app-powered') : searching || el.dataset.view !== view;
  account.hidden = !locked && (searching || OWN_VIEWS.includes(view));
  if (locked) return;
  if (view === 'hot' && !hotShown) renderHot();
  for (const a of document.querySelectorAll('.tab-bar [data-tab]')) {
    if (a.dataset.tab === view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  current = view;
  if (!splash?.isConnected || splash.classList.contains('is-gone')) backToPlace(); // the splash went before sign-in did
  if (focus) {
    scrollTo({ top: scrolls.get(view) ?? 0, behavior: 'instant' }); // where this tab was left, as a native tab bar does
    const heading = $(`[data-view="${view}"] h2`);
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }
}

let hotShown = false; // the Hot view loads the first time it's opened

// Each tab keeps its own scroll position, so going to Hot and back to My List finds your place again.
let current = null; // the tab showing (showView)
const scrolls = new Map(); // tab → scrollY when it was left

// Kept scroll positions come back once, when the first view is drawn (hideSplash), if they're recent.
const placeIsRecent = leftAt && Date.now() - (leftAt.at ?? 0) < PLACE_FRESH;
if (placeIsRecent) for (const [tab, y] of Object.entries(leftAt.scrolls ?? {})) if (VIEWS.includes(tab) && y > 0) scrolls.set(tab, y);
let placed = !placeIsRecent;
function backToPlace() {
  if (placed || !current) return; // not yet: still signing in (showView calls again once a tab shows)
  placed = true;
  const want = current && scrolls.get(current);
  if (!want) return;
  // The list may still be filling in: wait (up to 5 seconds) until the page is tall enough to scroll that far, and
  // give up at once if the customer touches the screen first.
  const tryIt = () => document.documentElement.scrollHeight - innerHeight >= want && (scrollTo({ top: want, behavior: 'instant' }), true);
  if (tryIt()) return;
  let watch = null;
  const stop = () => watch.disconnect();
  watch = new MutationObserver(() => tryIt() && stop());
  watch.observe($('main'), { childList: true, subtree: true });
  addEventListener('touchstart', stop, { once: true, passive: true });
  setTimeout(stop, 5000);
}
function keepPlace() {
  if (!current || document.body.classList.contains('app-locked')) return;
  leaveTab(); // this tab's position, as when switching away from it
  keep(PLACE, { tab: current, scrolls: Object.fromEntries(scrolls), at: Date.now() }); // without storage: My List next time
}
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && keepPlace());
addEventListener('pagehide', keepPlace);
function leaveTab() {
  if (!current) return;
  // Search results stand in for the tab and start at the top: the tab's own place is where the search opened.
  scrolls.set(current, $('[data-search-results]').hidden ? scrollY : scrolledTo);
}

/** Switch tabs: the views cross-fade (View Transitions, where the browser has them and motion is welcome). */
function switchTab() {
  leaveTab();
  const swap = () => {
    closeSearch();
    showView({ focus: true });
  };
  if (document.startViewTransition && !reducedMotion()) document.startViewTransition(swap);
  else swap();
}

// A link from outside (a notification, a Home Screen shortcut) or the browser's own back and forward.
addEventListener('hashchange', switchTab);

// The tab bar (and the shop's name in the header, which goes to My List). Tabs replace the address rather than add to
// the history, so Android's back button leaves the app instead of stepping back through every tab tapped. Tapping the
// tab that's already showing puts away the search and scrolls it back to the top.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#"]');
  const tab = a?.getAttribute('href').slice(1);
  if (!VIEWS.includes(tab) || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  if (tab !== current) {
    history.replaceState(history.state, '', `#${tab}`); // no hashchange: switchTab runs here
    return switchTab();
  }
  if (!searchBox.hidden) closeSearch();
  scrolls.delete(tab);
  scrollTo({ top: 0, behavior: reducedMotion() ? 'instant' : 'smooth' });
});
// The account page draws its views after sign-in (and again after signing out and in): show the right one.
new MutationObserver(() => showView()).observe(account, { childList: true });
showView();
setupAppearance($('[data-look]'));

// ---------------------------------------------------------------------------
// Hot: the ten most pulled titles with an order cutoff coming up, and the ten most pulled of the newest books, as rows
// of the website's cards to swipe through. The cards' buttons add to the pull list as on the website;
// js/pages/account.js redraws My List.
// ---------------------------------------------------------------------------

const POOL = 60; // titles ranked for each row (rank_by_pulls reads at most 60)
const IN_STORE = ['new_this_wednesday', 'just_arrived', 'available', 'low_stock', 'sale', 'clearance', 'backorder'];
const hotItems = new Map(); // id → item, for the cards' buttons

/** The ten of `items` customers pulled most, most first. */
async function topTen(items) {
  const order = await rankByPulls(items.map((i) => i.id));
  const byId = new Map(items.map((i) => [i.id, i]));
  return order.map((id) => byId.get(id)).filter(Boolean);
}

async function loadHot() {
  const tz = (await getSettings()).timezone;
  const [foc, fresh, recent] = await Promise.all([
    getItems({ statuses: ['pre_order'], focFrom: openFocFrom(tz), focBefore: addDays(todayIn(tz), 14), order: 'foc', limit: POOL }),
    getItems({ statuses: ['new_this_wednesday', 'just_arrived'], order: 'released', limit: POOL }),
    // The latest releases top up the row when this week's books are few or not in yet (as on the home page).
    getItems({ statuses: IN_STORE, order: 'released', limit: 20 }),
  ]);
  const seen = new Set(fresh.map((i) => i.id));
  const arrivals = fresh.length >= 10 ? fresh : [...fresh, ...recent.filter((i) => !seen.has(i.id))];
  const [focTop, freshTop] = await Promise.all([topTen(foc), topTen(arrivals)]);
  return { foc: focTop, fresh: freshTop };
}

const SHELVES = [
  { key: 'foc', title: 'Top 10 Order Cutoff Soon', lede: 'The most pulled titles the shop orders in the next two weeks. Get them on your list in time.', empty: 'No order cutoffs in the next two weeks.', more: 'All pre-orders' },
  { key: 'fresh', title: 'Top 10 New Arrivals', lede: 'The most pulled of the newest books at the shop.', empty: 'New books land every Wednesday — check back soon.', more: 'All new arrivals' },
];

/**
 * What each row's See all lists in the search results (showList): its filters (as on the website's Pre-Orders and
 * New Arrivals, js/catalog.js), and getItems arguments for the shop's time zone and the filters' values.
 */
const category = () => ({ name: 'category', label: 'Category', options: categoryOptions(), multiple: true });
const LISTS = {
  foc: {
    label: 'Filter pre-orders',
    filters: (tz) => [focFilter(openFocFrom(tz)), publisherFilter(['pre_order']), category()],
    query: (tz, v) => ({ statuses: ['pre_order'], order: 'foc', focFrom: v.foc || openFocFrom(tz), focBefore: v.foc || undefined, publishers: v.publisher, categoryIds: v.category.map(Number) }),
    describe: (n, filtered) => (n ? `${n} ${n === 1 ? 'pre-order' : 'pre-orders'}, soonest order cutoff first` : filtered ? 'No pre-orders match those filters.' : 'No pre-orders open right now.'),
  },
  fresh: {
    label: 'Filter titles in the shop',
    filters: () => [publisherFilter(IN_STORE), category()],
    query: (tz, v) => ({ statuses: IN_STORE, order: 'arrivals', publishers: v.publisher, categoryIds: v.category.map(Number) }),
    describe: (n, filtered) => (n ? `${n} ${n === 1 ? 'title' : 'titles'} in the shop, new arrivals first` : filtered ? 'No titles match those filters.' : 'No titles in the shop right now.'),
  },
};

async function renderHot() {
  hotShown = true;
  const host = $('[data-hot]');
  if (!host) return; // a page from before the Hot tab (an old copy kept offline): the other tabs still work
  if (!host.children.length) host.innerHTML = '<p class="empty loading">Loading…</p>'; // a pull to refresh keeps the rows up
  let data;
  try {
    data = await loadHot();
  } catch (err) {
    console.error(err);
    hotShown = false; // try again next time
    host.innerHTML = '<p class="empty">The titles couldn’t be loaded. Pull down to try again.</p>';
    return;
  }
  hotItems.clear();
  for (const i of [...data.foc, ...data.fresh]) hotItems.set(i.id, i);
  host.innerHTML = SHELVES.map(({ key, title, lede, empty, more }) => `
    <section class="app-shelf" aria-labelledby="hot-${key}-h">
      <div class="app-shelf__head">
        <h3 id="hot-${key}-h">${esc(title)}</h3>
        ${more ? `<button class="link-button" type="button" data-see-all="${key}">See all<span class="visually-hidden"> — ${esc(more)}</span></button>` : ''}
      </div>
      <p class="app-shelf__lede">${esc(lede)}</p>
      ${data[key].length
        ? `<div class="app-shelf__row" role="list">${data[key].map((i) => `<div role="listitem">${itemCard(i, { reservable: true, level: 4 })}</div>`).join('')}</div>`
        : `<p class="empty">${esc(empty)}</p>`}
    </section>`).join('');
}

if ($('[data-hot]')) {
  enableReservations($('[data-hot]'), (id) => hotItems.get(id));
  $('[data-hot]').addEventListener('click', (e) => {
    const see = e.target.closest('[data-see-all]');
    if (see) showList(see.dataset.seeAll);
  });
}

// ---------------------------------------------------------------------------
// Search, from the button in the header: a box drops down under it, over whichever tab is showing. The shop's titles,
// as on the website's search (titles that can still be ordered first), stand in for the tab while the box has words
// in it; closing the search or picking a tab brings the tab back. Hot's See all opens the same results with every
// open pre-order or every title in the shop, until a search is typed. Signed in, series and artists to follow are listed
// above the titles (js/pages/account.js setupFollowing).
// ---------------------------------------------------------------------------

const FOUND_PAGE = 24;
// q: the words searched ('' for a See all list); query(tz): its getItems arguments; describe(count): the count line.
const found = { q: '', query: null, describe: null, items: [], total: 0, req: 0 };

/** The titles the search box's words find, in place of everything in the results (a See all list's filters too). */
function search(q) {
  $('[data-search-results]').innerHTML = '';
  return showFound(q, (tz) => ({ q, openFirst: openFocFrom(tz) }), (n) => (n ? `${n} ${n === 1 ? 'title' : 'titles'} for “${esc(q)}”` : `No titles match “${esc(q)}”.`));
}

/**
 * Fill the results with `query`'s titles, or the next page of them (`more`). They go in [data-found-area] when the
 * results have one (under a See all list's filters), else replace everything in the results.
 */
async function showFound(q, query, describe, { more = false } = {}) {
  const results = $('[data-search-results]');
  const box = $('[data-found-area]', results) ?? results;
  const mine = ++found.req;
  if (!more) Object.assign(found, { q, query, describe, items: [], total: 0 });
  if (!more) box.innerHTML = `<p class="empty loading">${q ? 'Searching…' : 'Loading…'}</p>`;
  let rows;
  let count;
  try {
    const tz = (await getSettings()).timezone;
    ({ rows, count } = await getItems({ ...found.query(tz), limit: FOUND_PAGE, offset: found.items.length, withCount: true }));
  } catch (err) {
    console.error(err);
    if (mine === found.req) box.innerHTML = '<p class="empty">Couldn’t search right now. Please try again shortly.</p>';
    return;
  }
  if (mine !== found.req) return; // a newer search has started
  const first = found.items.length;
  found.items.push(...rows);
  found.total = count;
  for (const i of rows) hotItems.set(i.id, i);
  const left = found.total - found.items.length;
  const cards = rows.map((i) => itemCard(i, { reservable: true })).join('');
  if (!more) {
    // Search results stand in for the tab (and its heading): they get their own, for the page's outline. See all's
    // list has one above its filters (showList).
    box.innerHTML = `${box === results ? '<h2 class="visually-hidden">Search results</h2>' : ''}
      <p class="results-count" role="status" tabindex="-1">${found.describe(found.total)}</p>
      <div class="grid" data-found>${cards}</div>
      <button class="btn btn--ghost show-more" type="button" data-found-more hidden></button>`;
  } else {
    $('[data-found]', box).insertAdjacentHTML('beforeend', cards);
    $('[data-found]', box).children[first]?.querySelector('button, a')?.focus();
  }
  const moreBtn = $('[data-found-more]', box);
  moreBtn.hidden = left <= 0;
  moreBtn.textContent = `Show more (${left} left)`;
}

const searchBox = $('[data-search]');

/** Put the search away and show the tab again (the header's button, Escape, or picking a tab). */
function closeSearch({ focus = false } = {}) {
  if (searchBox.hidden) return;
  searchBox.hidden = true;
  $('[data-search-form]').reset();
  found.req++; // drop any answer still on its way
  Object.assign(found, { q: '', items: [], total: 0 });
  const box = $('[data-search-results]');
  const had = !box.hidden; // results stood in for the tab: go back to where it was
  box.hidden = true;
  box.innerHTML = '';
  const toggle = $('[data-search-toggle]');
  toggle?.setAttribute('aria-expanded', 'false');
  showView();
  if (had) scrollTo({ top: scrolledTo, behavior: 'instant' });
  if (focus) toggle?.focus();
}

let scrolledTo = 0; // where the tab was scrolled when the search opened, to go back to when it closes

/** The box slides down over the page where it is; the page only moves once results stand in for the tab. */
function openSearch({ focus = true } = {}) {
  scrolledTo = scrollY;
  searchBox.hidden = false;
  $('[data-search-toggle]')?.setAttribute('aria-expanded', 'true');
  if (focus) $('[data-search-form]').elements.q.focus({ preventScroll: true });
}

/**
 * Hot's See all: every title of that row's kind (LISTS) in the search results, with the search box above them and
 * the list's filters over the titles. A filter's change lists them again; typing a search replaces the lot.
 */
async function showList(key) {
  const list = LISTS[key];
  if (!list) return;
  if (searchBox.hidden) openSearch({ focus: false });
  $('[data-search-form]').elements.q.value = '';
  const box = $('[data-search-results]');
  box.hidden = false;
  const title = SHELVES.find((s) => s.key === key)?.more ?? 'Titles';
  box.innerHTML = `<h2 class="visually-hidden">${esc(title)}</h2><form class="filters" aria-label="${esc(list.label)}" data-list-filters></form><div data-found-area></div>`;
  showView();
  scrollTo({ top: 0, behavior: 'instant' });
  const tz = (await getSettings().catch(() => ({}))).timezone;
  const form = $('[data-list-filters]', box);
  const values = () => {
    const fd = new FormData(form);
    return { foc: fd.get('foc') ?? '', publisher: fd.getAll('publisher'), category: fd.getAll('category') };
  };
  const filtered = () => [...new FormData(form).values()].some(Boolean);
  const listed = () => showFound('', (zone) => list.query(zone, values()), (n) => list.describe(n, filtered()));
  // The titles load while the filters' options do; a filter with nothing to pick from is left out.
  const first = listed();
  loadFilters(list.filters(tz)).then((filters) => {
    if (!form.isConnected) return; // the list was put away meanwhile
    if (!filters.length) return void form.remove();
    form.innerHTML = filters.map(filterControl).join('');
    form.querySelectorAll('.multi').forEach(setupMulti);
  });
  form.addEventListener('input', (e) => !e.target.closest('.multi__search') && listed()); // that box only narrows the options
  form.addEventListener('submit', (e) => e.preventDefault());
  await first;
  if (!found.q) $('.results-count', box)?.focus({ preventScroll: true }); // the See all button is gone: start reading here
}

function setupSearch() {
  const form = $('[data-search-form]');
  const box = $('[data-search-results]');
  const input = form.elements.q;
  let timer;
  const run = () => {
    clearTimeout(timer);
    const q = input.value.trim();
    const searching = q.length > 0;
    if (box.hidden === searching) {
      box.hidden = !searching;
      showView();
      scrollTo({ top: searching ? 0 : scrolledTo, behavior: 'instant' }); // results start at the top; clearing goes back to the tab's place
    }
    if (!searching) {
      found.req++; // drop any answer still on its way
      found.q = '';
      box.innerHTML = '';
      return;
    }
    if (q !== found.q) search(q);
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(run, 350);
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    input.blur(); // put the phone's keyboard away to show the results
    run();
  });
  // The header is drawn once the shop's settings arrive, so its button is found when it's pressed.
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-search-open]')) return void openSearch(); // the welcome card's "Follow a series"
    if (!e.target.closest('[data-search-toggle]')) return;
    if (searchBox.hidden) openSearch();
    else closeSearch();
  });
  searchBox.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !e.defaultPrevented) closeSearch({ focus: true }); // an open filter closes first
  });
  box.addEventListener('click', (e) => {
    if (!e.target.closest('[data-found-more]')) return;
    e.target.disabled = true;
    showFound(found.q, found.query, found.describe, { more: true }).finally(() => (e.target.disabled = false));
  });
  enableReservations(box, (id) => hotItems.get(id));
}

setupSearch();

// ---------------------------------------------------------------------------
// Shop: who the app belongs to, how to reach it, and its website
// ---------------------------------------------------------------------------

/** One place's address, phone and hours. */
const placeHtml = (s, title) => {
  const addr = addressLines(s);
  return `<section class="app-shop__place">
    ${title ? `<h3 class="app-shop__place-name">${esc(title)}</h3>` : ''}
    <div class="app-shop__actions">
      ${s.phone ? `<a class="btn btn--primary" href="${esc(telHref(s.phone))}">Call ${esc(formatPhone(s.phone))}</a>` : ''}
      ${addr.length ? `<a class="btn btn--ghost" href="${esc(mapsHref(s))}" target="_blank" rel="noopener">Directions</a>` : ''}
    </div>
    ${addr.length ? `<address class="app-shop__address">${addr.map(esc).join('<br>')}</address>` : ''}
    ${s.hours?.length ? `<h4 class="app-shop__sub">Hours</h4>${hoursList(s.hours)}` : ''}
  </section>`;
};

// Pages of the shop's website, opened in the browser: an installed app has no back button to return from them.
const SITE_LINKS = [
  { href: 'pre-orders.html', label: 'Pre-Orders' },
  { href: 'new-arrivals.html', label: 'New Arrivals' },
  { href: 'calendar.html', label: 'Events' },
  { href: 'index.html', label: 'Website' },
];

async function renderShop() {
  const host = $('[data-shop]');
  let s;
  try {
    s = await getSettings();
  } catch {
    host.innerHTML = '<p class="empty">The shop’s details couldn’t be loaded. Please try again shortly.</p>';
    return;
  }
  const many = s.locations?.length > 1;
  const social = socialIcons(s);
  host.innerHTML = `
    ${s.announcement ? `<p class="notice"><strong>Announcement:</strong> ${linkify(s.announcement)}</p>` : ''}
    <div class="panel app-shop">
      ${s.logo_url ? `<img class="app-shop__logo" src="${esc(sizedImage(s.logo_url, LOGO_WIDTH))}" alt="" loading="lazy">` : ''}
      <p class="app-shop__name">${esc(s.shop_name)}</p>
      ${s.tagline ? `<p class="app-shop__tagline">${esc(s.tagline)}</p>` : ''}
      ${many ? s.locations.map((l) => placeHtml(locationAs(s, l), l.name)).join('') : placeHtml(s)}
      ${s.email ? `<p class="app-shop__email"><a href="mailto:${esc(s.email)}">${esc(s.email)}</a></p>` : ''}
      ${social}
    </div>
    <ul class="app-shop__links">${SITE_LINKS.map((l) => `<li><a href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)}<span class="visually-hidden"> (opens in your browser)</span></a></li>`).join('')}</ul>`;
}

// ---------------------------------------------------------------------------
// Pull down to refresh: an installed app has no reload button, and an iPhone gives it no pull of its own
// ---------------------------------------------------------------------------

const PULL_SLACK = 30; // px of finger travel ignored first, so a small drag at the top never starts one
const PULL_RESIST = 0.35; // the badge moves this much per px of finger travel after that
const PULL_GO = 80; // px of badge travel that refreshes on release (about 260px of finger travel in all)
const PULL_MAX = 100; // px the badge travels at most

function setupPull() {
  const buzz = buzzOnCross();
  const spot = $('[data-pull]');
  let startY = null;
  let pull = 0;
  let busy = false;
  const place = (px) => {
    pull = px;
    spot.style.setProperty('--pull', `${px}px`);
    spot.style.setProperty('--pull-turn', String(px / PULL_GO));
    const ready = px >= PULL_GO;
    buzz(ready); // letting go now refreshes
    spot.classList.toggle('is-ready', ready);
  };
  const settle = () => {
    spot.classList.add('is-settling');
    spot.classList.remove('is-pulling', 'is-ready', 'is-refreshing');
    place(0);
    setTimeout(() => spot.classList.remove('is-settling'), motionMs('--dur') + 50);
  };

  addEventListener('touchstart', (e) => {
    // Only from the very top, with one finger, and not inside an open dialog.
    startY = !busy && scrollY <= 0 && e.touches.length === 1 && !document.querySelector('dialog[open]') ? e.touches[0].clientY : null;
  }, { passive: true });
  addEventListener('touchmove', (e) => {
    if (startY === null) return;
    const dy = e.touches[0].clientY - startY - PULL_SLACK;
    if (dy <= 0 || scrollY > 0) {
      if (pull) settle();
      return;
    }
    // Under the header, wherever it ends (it grows with the iPhone's status bar).
    spot.style.setProperty('--pull-top', `${$('#site-header')?.getBoundingClientRect().bottom ?? 0}px`);
    spot.classList.remove('is-settling'); // follow the finger at once, even right after the last one let go
    spot.classList.add('is-pulling');
    place(Math.min(PULL_MAX, dy * PULL_RESIST)); // resists, like a native pull
  }, { passive: true });
  addEventListener('touchend', async () => {
    if (startY === null) return;
    startY = null;
    if (pull < PULL_GO) return settle();
    busy = true;
    spot.classList.add('is-refreshing');
    place(PULL_GO);
    say('Refreshing…');
    await refresh();
    say('Updated.');
    busy = false;
    settle();
  });
  addEventListener('touchcancel', () => {
    startY = null;
    if (!busy) settle();
  });
}

/**
 * Fetch the current view again. Hot draws its rows again; the account page redraws its views in place when signed
 * in (it answers the app:refresh event with a promise); the Shop view, or a signed-out app, simply loads again.
 */
async function refresh() {
  if (location.hash === '#hot') return renderHot();
  const waits = [];
  if (location.hash !== '#shop') document.dispatchEvent(new CustomEvent('app:refresh', { detail: { wait: (p) => waits.push(p) } }));
  if (!waits.length) return location.reload();
  await Promise.all([...waits, new Promise((resolve) => setTimeout(resolve, 400))]).catch((err) => console.error(err)); // long enough to see it spin
}

setupPull();

// ---------------------------------------------------------------------------
// Back to the front: an installed app stays open in the background for days, so after a few minutes away it fetches
// the list (and Hot, if it was opened) again by itself, keeping the "ready for pickup" counts current.
// ---------------------------------------------------------------------------

const STALE_AFTER = 5 * 60 * 1000; // ms away before the app fetches again on its return
let hiddenAt = 0;
document.addEventListener('visibilitychange', async () => {
  if (document.hidden) return void (hiddenAt = Date.now());
  const away = hiddenAt ? Date.now() - hiddenAt : 0;
  hiddenAt = 0;
  // Not while something is in hand: a search, an open title, a half-typed field, the sign-in form, or offline.
  if (away < STALE_AFTER || !navigator.onLine || document.body.classList.contains('app-locked')) return;
  if (!searchBox.hidden || document.querySelector('dialog[open]') || document.activeElement?.matches('input, textarea, select')) return;
  const y = scrollY;
  const waits = [];
  document.dispatchEvent(new CustomEvent('app:refresh', { detail: { wait: (p) => waits.push(p) } }));
  if (hotShown) waits.push(renderHot());
  await Promise.all(waits).catch((err) => console.error(err));
  scrollTo({ top: y, behavior: 'instant' }); // the views were drawn again: stay where you were
});

// ---------------------------------------------------------------------------
// Offline: say so, and when the list on screen is from (js/pages/account.js shows its last copy)
// ---------------------------------------------------------------------------

const offlineNote = $('[data-offline]');
let savedAt = null;

function showOffline() {
  const when = savedAt && new Date(savedAt);
  const stamp = when && !Number.isNaN(when.getTime())
    ? when.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })
    : null;
  const text = stamp ? `Showing your list from ${stamp}.` : 'Your list will update when you’re back online.';
  offlineNote.innerHTML = `<p class="app-note__text"><strong>You’re offline.</strong> ${esc(text)}</p>`;
  if (offlineNote.hidden) say(`You’re offline. ${text}`);
  offlineNote.hidden = false;
}

addEventListener('offline', showOffline);
addEventListener('online', () => {
  offlineNote.hidden = true;
  // Fetch everything again now the shop can be reached.
  document.dispatchEvent(new CustomEvent('app:refresh', { detail: { wait: () => {} } }));
});
document.addEventListener('app:offline', (e) => {
  savedAt = e.detail?.at ?? null;
  showOffline();
});
document.addEventListener('app:online', () => {
  savedAt = null;
  if (navigator.onLine) offlineNote.hidden = true;
});
if (!navigator.onLine) showOffline();

// ---------------------------------------------------------------------------
// Updates: an installed app can stay open for days, running the code it opened with. admin/update-check.js
// compares the published fingerprint of the site's files with the one loaded, on a timer and whenever the app
// comes back to the front, and a strip offers the new version.
// ---------------------------------------------------------------------------

function offerUpdate() {
  const box = $('[data-update]');
  box.innerHTML = `
    <p class="app-note__text"><strong>A new version of the app is ready.</strong></p>
    <button class="btn btn--primary" type="button" data-update-go>Update</button>`;
  box.hidden = false;
  say('A new version of the app is ready. The Update button is at the top of the screen.');
  $('[data-update-go]', box).addEventListener('click', () => location.reload());
}

// Not kept for offline use (it lives with the admin): without a connection there's nothing to check anyway.
import('../../admin/update-check.js')
  .then(({ watchForUpdates }) => watchForUpdates({ onUpdate: offerUpdate }))
  .catch(() => {});

// ---------------------------------------------------------------------------
// Install: "Add to Home Screen", offered until it's installed or dismissed
// ---------------------------------------------------------------------------

const DISMISSED = 'pc-app-install-dismissed';
const dismissed = () => kept(DISMISSED) === 1; // kept as "1" (the JSON for 1) since before kept() existed

function offerInstall(shopName, prompt = null) {
  const box = $('[data-install]');
  if (installed() || dismissed() || (!prompt && !iPhone())) return void (box.hidden = true);
  const name = esc(shopName || 'this app');
  box.innerHTML = `
    <p class="app-install__text"><strong>Add ${name} to your Home Screen</strong> for one-tap access to your pull list.
      ${prompt ? '' : 'Tap the <strong>Share</strong> button, then <strong>Add to Home Screen</strong>.'}</p>
    ${prompt ? '<button class="btn btn--primary" type="button" data-install-go>Install</button>' : ''}
    <button class="app-install__close" type="button" data-install-close aria-label="Not now">✕</button>`;
  box.hidden = false;
  $('[data-install-go]', box)?.addEventListener('click', async () => {
    prompt.prompt();
    await prompt.userChoice.catch(() => null);
    box.hidden = true;
  });
  $('[data-install-close]', box).addEventListener('click', () => {
    box.hidden = true;
    keep(DISMISSED, 1); // without storage it's offered again next time
  });
}

// Chrome and Edge hand over their install prompt for a button of our own; Safari has none, so it gets directions.
let installPrompt = null;
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  getSettings().then((s) => offerInstall(s.shop_name, installPrompt), () => offerInstall('', installPrompt));
});
addEventListener('appinstalled', () => ($('[data-install]').hidden = true));

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { scope: './app' }).catch((err) => console.error('Service worker', err));

// The account page signs in and draws the views; it runs initPage, which paints the shop's brand.
await import('./account.js').catch((err) => console.error(err)); // an outage message is already on the page
renderShop();
getSettings().then((s) => (setShopColors(s.colors), offerInstall(s.shop_name, installPrompt)), () => {});
