import { initPage, $, esc, heroHeadlineHtml, sizedImage, HERO_WIDTH, hoursList, addressLines, mapsHref, telHref, mapEmbed, fmtDate, fmtTime, shopToday, addDays, openFocFrom, EVENT_TYPES } from '../site.js';
import { formatPhone } from '../util.js';
import { getItems, getEvents, getCategories, getPosts } from '../data.js';
import { renderGrid, enableReservations } from '../components.js';
import * as pull from '../customer.js';
import { readCache, writeCache, sameData } from '../cache.js';

// Banner headline and photo from settings (tools/apply-seo.js bakes the same into index.html so the banner
// paints before any script runs; this keeps it right if staff have changed it since).
function paintHero(s) {
  $('#hero-title').innerHTML = heroHeadlineHtml(s);
  // Optional banner photo (Shop settings); without one the banner keeps its accent color.
  const hero = $('.hero');
  const photo = /^https:\/\//.test(s.hero_image_url ?? '');
  hero.classList.toggle('hero--photo', photo);
  if (photo) hero.style.setProperty('--hero-image', `url(${JSON.stringify(sizedImage(s.hero_image_url, HERO_WIDTH))})`);
  else hero.style.removeProperty('--hero-image');
}

// Each shelf shows up to 12 titles: two rows of six on desktop.
const SHELF = 12;
const IN_STORE = ['new_this_wednesday', 'just_arrived', 'available', 'low_stock', 'sale', 'clearance', 'backorder'];
// One failing query (say, a column that isn't in the database yet) shouldn't
// blank the whole homepage: log it and show that shelf empty instead.
let queryFailed = false;
const soft = (promise) =>
  Promise.resolve(promise).catch((err) => {
    console.error(err);
    queryFailed = true;
    return [];
  });
// Category shelves under the main ones: what's in the shop plus what can still
// be pre-ordered, in one shelf. A shelf stays hidden if its category doesn't exist
// yet or has nothing to show.
const SHELVES = [
  { id: 'funko', slug: 'funko-pops' },
  { id: 'figures', slug: 'action-figures' },
  { id: 'records', slug: 'records' },
];

/** Everything the page shows, as plain data (this is also what's saved for the next visit). Every query starts at once. */
async function loadHome() {
  const [categories, focFeatured, focAuto, freshFeatured, freshComics, freshAuto, freshRecent, picks, events, news, ...shelfResults] = await Promise.all([
    soft(getCategories()),
    // Titles staff ticked "Show on homepage" lead a shelf; the automatic pull
    // (soonest cutoffs / this week's new comics, then the rest of this week's arrivals, then the latest releases)
    // fills whatever room is left.
    soft(getItems({ statuses: ['pre_order'], focFrom: openFocFrom(), featured: true, order: 'foc', limit: SHELF })),
    soft(getItems({ statuses: ['pre_order'], focFrom: openFocFrom(), focBefore: addDays(shopToday(), 14), order: 'foc', limit: SHELF })),
    soft(getItems({ statuses: IN_STORE, featured: true, order: 'newest', limit: SHELF })),
    // This week's books: new comics first (they're what Wednesday is about), then everything else that's new, by release date.
    soft(getItems({ categorySlug: 'comics', statuses: ['new_this_wednesday', 'just_arrived'], order: 'released', limit: SHELF })),
    soft(getItems({ statuses: ['new_this_wednesday', 'just_arrived'], order: 'released', limit: SHELF })),
    // Whatever came out most recently tops up the shelf when this week's books are few or not imported yet.
    soft(getItems({ statuses: IN_STORE, order: 'released', limit: SHELF })),
    soft(getItems({ staffPick: true, excludeStatuses: ['sold_out'], limit: SHELF })),
    soft(getEvents({ from: new Date().toISOString() })),
    soft(getPosts(3)),
    ...SHELVES.flatMap(({ slug }) => [
      soft(getItems({ categorySlug: slug, statuses: IN_STORE, order: 'newest', limit: SHELF })),
      soft(getItems({ categorySlug: slug, statuses: ['pre_order'], focFrom: openFocFrom(), order: 'foc', limit: SHELF })),
    ]),
  ]);
  const fill = (featured, auto) => {
    const ids = new Set(featured.map((i) => i.id));
    return [...featured, ...auto.filter((i) => !ids.has(i.id))].slice(0, SHELF);
  };
  return {
    focSoon: fill(focFeatured, focAuto),
    fresh: fill(freshFeatured, [...freshComics, ...freshAuto, ...freshRecent]),
    picks,
    events,
    news,
    shelves: SHELVES.map(({ id, slug }, i) => {
      const [inStore, preorders] = [shelfResults[i * 2], shelfResults[i * 2 + 1]];
      return {
        id,
        categoryId: categories.find((c) => c.slug === slug)?.id,
        hasInStore: inStore.length > 0,
        hasPreorders: preorders.length > 0,
        items: [...inStore, ...preorders].slice(0, SHELF),
      };
    }),
  };
}

// Shelves are drawn only when they are within a screen or so of view: the page has dozens of cards, and building
// them all up front is most of its load work on a phone. A shelf already drawn is updated in place.
const drawn = new WeakSet();
const waiting = new Map(); // grid element → function that draws it
const watcher =
  'IntersectionObserver' in window
    ? new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            watcher.unobserve(entry.target);
            const draw = waiting.get(entry.target);
            waiting.delete(entry.target);
            draw?.();
          }
        },
        { rootMargin: '800px 0px' },
      )
    : null;
function drawGrid(el, items, opts, emptyText) {
  const draw = () => {
    drawn.add(el);
    renderGrid(el, items, opts, emptyText);
  };
  if (!watcher || drawn.has(el)) return draw();
  waiting.set(el, draw); // a newer snapshot replaces an older one that hasn't been drawn yet
  watcher.observe(el);
}

// Items on the page by id, kept across repaints so the add-to-list buttons always find their title.
const byId = new Map();

function renderHome({ focSoon, fresh, picks, events, news, shelves }) {
  byId.clear();
  for (const i of [...focSoon, ...fresh, ...picks, ...shelves.flatMap((x) => x.items)]) byId.set(i.id, i);
  drawGrid($('#foc-soon'), focSoon, { reservable: true }, 'No cutoffs in the next two weeks.');
  drawGrid($('#new-releases'), fresh, {}, 'New books land every Wednesday — check back soon.');
  $('#staff-picks-section').hidden = !picks.length;
  if (picks.length) drawGrid($('#staff-picks'), picks, { reservable: true });
  for (const { id, categoryId, hasInStore, hasPreorders, items } of shelves) {
    $(`#${id}-section`).hidden = !items.length;
    if (!items.length) continue;
    drawGrid($(`#${id}`), items, { reservable: true });
    $(`#${id}-arrivals-link`).href = `new-arrivals.html?category=${categoryId}`;
    $(`#${id}-preorders-link`).href = `pre-orders.html?category=${categoryId}`;
    $(`#${id}-arrivals-link`).hidden = !hasInStore;
    $(`#${id}-preorders-link`).hidden = !hasPreorders;
  }
  renderEvents(events);
  renderNews(news);
}

// Same look as the calendar page (date tile, type, title, time), without the
// description and add-to-calendar links.
function renderEvents(events) {
  $('#upcoming-events').innerHTML = events.length
    ? events
        .slice(0, 3)
        .map(
          (e) => `<article class="event event--compact">
          <div class="event__date" aria-hidden="true">
            <span class="event__month">${fmtDate(e.starts_at, { month: 'short' })}</span>
            <span class="event__day">${fmtDate(e.starts_at, { day: 'numeric' })}</span>
          </div>
          <div>
            <span class="event__type">${esc(EVENT_TYPES[e.event_type] ?? 'Event')}</span>
            <h3><a href="event.html?id=${e.id}">${esc(e.title)}</a></h3>
            <p class="event__when">${fmtDate(e.starts_at, { weekday: 'short', month: 'short', day: 'numeric' })} · ${fmtTime(e.starts_at)}${e.ends_at ? `–${fmtTime(e.ends_at)}` : ''}${e.location ? ` · ${esc(e.location)}` : ''}</p>
          </div>
        </article>`,
        )
        .join('')
    : '<p>No events scheduled — follow us for announcements.</p>';
}

// Latest news posts under the calendar, as on the News page but shorter.
function renderNews(news) {
  $('#news-block').hidden = !news.length;
  $('#latest-news').innerHTML = news
    .map(
      (p) => `<li>
        <time datetime="${esc(p.published_at)}">${fmtDate(p.published_at, { month: 'short', day: 'numeric', year: 'numeric' })}</time>
        <h3><a href="post.html?slug=${encodeURIComponent(p.slug)}">${esc(p.title)}</a></h3>
        ${p.excerpt ? `<p>${esc(p.excerpt)}</p>` : ''}
      </li>`,
    )
    .join('');
}

function renderVisit(s) {
  const addr = addressLines(s);
  $('#visit').innerHTML = `
    ${addr.length ? `<p><a href="${mapsHref(s)}">${addr.map(esc).join('<br>')}</a></p>` : ''}
    ${hoursList(s.hours ?? [])}
    ${s.phone ? `<p style="margin-top:1em"><a href="${telHref(s.phone)}">${esc(formatPhone(s.phone))}</a></p>` : ''}
    ${mapEmbed(s, 'map map--small')}`;
}

// Start the data requests before waiting on settings: the home page's own queries don't depend on them.
// With a snapshot from the last visit, the banner and shelves paint immediately.
const cachedSettings = readCache('settings');
const cachedHome = readCache('home');
const settingsReady = initPage();
const homeReady = loadHome();
if (cachedSettings) {
  paintHero(cachedSettings);
  renderVisit(cachedSettings);
}
if (cachedHome) renderHome(cachedHome);
enableReservations($('main'), (id) => byId.get(id));

const s = await settingsReady;
if (!cachedSettings || !sameData(cachedSettings, s)) {
  paintHero(s);
  renderVisit(s);
}
const home = await homeReady;
// A failed query leaves its shelf empty: show that only when there's nothing better, and never save it.
if (!queryFailed) writeCache('home', home);
// Signed-in customers get extra buttons on each card, and the snapshot was drawn before their list loaded.
if (!cachedHome || (!queryFailed && !sameData(cachedHome, home)) || pull.isSignedIn()) {
  if (!(queryFailed && cachedHome)) renderHome(home);
}
