import { initPage, $, esc, fmtDate } from '../site.js';
import { getItems, getPosts, getSearchablePages, getFaqs, searchSeries, getEvents } from '../data.js';
import { PAGE_BLOCKS } from '../page-defaults.js';
import { renderGrid, itemCard, enableReservations, seriesCards, enableSeriesFollow } from '../components.js';

// The searches don't need the page chrome, so they start now, alongside it.
const q = (new URLSearchParams(location.search).get('q') ?? '').trim();
const PAGE = 48;
const firstItems = q ? getItems({ q, order: 'title', limit: PAGE, offset: 0, withCount: true }) : null;
const firstSeries = q ? searchSeries(q) : null;
firstItems?.catch(() => {}); // reported where it's used; this keeps an early failure from logging twice
firstSeries?.catch(() => {});

await initPage();

// Page blocks → the page a visitor would open for them.
const PAGE_LINKS = {
  'pre-orders': ['Pre-Orders', 'pre-orders.html'], 'new-arrivals': ['New Arrivals', 'new-arrivals.html'], calendar: ['Calendar', 'calendar.html'],
  news: ['News', 'blog.html'], about: ['About', 'about.html'], visit: ['Visit Us', 'contact.html'], 'we-buy-comics': ['We Buy Comics', 'we-buy-comics.html'], 'gift-cards': ['Gift Cards', 'gift-cards.html'],
  faq: ['FAQ', 'faq.html'], privacy: ['Privacy', 'privacy.html'], terms: ['Terms', 'terms.html'],
};
const plain = (html) => new DOMParser().parseFromString(html ?? '', 'text/html').body.textContent.replace(/\s+/g, ' ').trim();
/** A short piece of `text` around the first match, with the match highlighted. */
const snippet = (text, needle) => {
  const at = text.toLowerCase().indexOf(needle);
  if (at < 0) return esc(text.slice(0, 140));
  const from = Math.max(0, at - 60);
  const to = Math.min(text.length, at + needle.length + 100);
  return `${from ? '…' : ''}${esc(text.slice(from, at))}<mark>${esc(text.slice(at, at + needle.length))}</mark>${esc(text.slice(at + needle.length, to))}${to < text.length ? '…' : ''}`;
};
const hitList = (id, rows) => {
  if (!rows.length) return;
  $(`#${id}`).hidden = false;
  $(`#${id}-list`).innerHTML = rows.map((r) => `<li><a href="${esc(r.href)}"><strong>${esc(r.title)}</strong></a>${r.text ? `<p class="card__meta">${snippet(r.text, needle)}</p>` : ''}</li>`).join('');
};
let needle = '';

const grid = $('#results');
const count = $('#results-count');
const more = $('#more');
let items = [];
let total = 0;

$('#site-q').value = q;
if (q) document.title = `Search: ${q} — ${document.title.split('—').pop().trim()}`;

if (!q) {
  count.textContent = '';
  grid.innerHTML = '<p class="empty">Type a title, creator or topic in the search box at the top of the page.</p>';
} else {
  enableReservations(grid, (id) => items.find((i) => i.id === id));
  const load = async (append) => {
    more.disabled = true;
    try {
      const { rows, count: n } = await (append ? getItems({ q, order: 'title', limit: PAGE, offset: items.length, withCount: true }) : firstItems);
      total = n;
      if (append) {
        const first = items.length;
        items = items.concat(rows);
        grid.insertAdjacentHTML('beforeend', rows.map((i) => itemCard(i, { reservable: true })).join(''));
        grid.children[first]?.querySelector('button, a')?.focus();
      } else {
        items = rows;
        renderGrid(grid, items, { reservable: true }, `No titles match “${q}”.`);
      }
      count.textContent = `${total} ${total === 1 ? 'title' : 'titles'} for “${q}”`;
      const left = total - items.length;
      more.hidden = left <= 0;
      more.textContent = `Show more (${left} left)`;
    } catch (err) {
      console.error(err);
      if (!append) grid.innerHTML = '<p class="empty">Couldn’t search right now. Please try again shortly.</p>';
    } finally {
      more.disabled = false;
    }
  };
  more.addEventListener('click', () => load(true));
  needle = q.toLowerCase();
  const quiet = (p) => p.catch((err) => (console.error(err), []));
  // Each part fills in as its own answer arrives. The series row starts as a skeleton (see site.css) so the
  // titles below it don't jump when it fills.
  $('#series').hidden = false;
  const seriesDone = quiet(firstSeries).then((series) => {
    // Shown when they have a cover, or when no issue is listed yet (so the title can't be found any other way).
    const seriesHits = series.filter((r) => r.cover_url || !r.issues);
    if (seriesHits.length) $('#series-list').innerHTML = seriesCards(seriesHits);
    else $('#series').hidden = true;
    enableSeriesFollow($('#series-list'));
  });
  const [posts, pages, faqs, events] = await Promise.all([
    quiet(getPosts()),
    quiet(getSearchablePages()),
    quiet(getFaqs()),
    quiet(getEvents({ from: new Date().toISOString() })),
    seriesDone,
    load(false),
  ]);

  // Pages: one hit per page, even when several blocks of it match.
  const labels = Object.fromEntries(PAGE_BLOCKS.map((b) => [b.slug, b.label]));
  const found = new Map();
  for (const p of pages) {
    const text = plain(`${p.lede_html ?? ''} ${p.body_html ?? ''}`);
    const named = p.custom ? p.title : (PAGE_LINKS[p.slug]?.[0] ?? (p.slug.startsWith('home') ? 'Home' : labels[p.slug]));
    if (!`${named} ${text}`.toLowerCase().includes(needle)) continue;
    const href = p.custom ? `page.html?slug=${encodeURIComponent(p.slug)}` : (PAGE_LINKS[p.slug]?.[1] ?? 'index.html');
    if (!found.has(href)) found.set(href, { title: named, href, text });
  }
  hitList('pages', [...found.values()]);
  hitList('faq', faqs.filter((f) => `${f.question} ${plain(f.answer_html)}`.toLowerCase().includes(needle)).map((f) => ({ title: f.question, href: 'faq.html', text: plain(f.answer_html) })));
  hitList('events', events.filter((e) => `${e.title} ${e.location ?? ''} ${plain(e.description_html ?? e.description)}`.toLowerCase().includes(needle)).map((e) => ({ title: `${e.title} · ${fmtDate(e.starts_at, { month: 'short', day: 'numeric' })}`, href: `event.html?id=${e.id}`, text: plain(e.description_html ?? e.description) })));

  const hits = posts.filter((p) => `${p.title} ${p.excerpt ?? ''}`.toLowerCase().includes(needle));
  if (hits.length) {
    $('#news').hidden = false;
    $('#news-list').innerHTML = hits
      .map(
        (p) => `<li class="panel">
          <time datetime="${esc(p.published_at)}">${fmtDate(p.published_at, { month: 'long', day: 'numeric', year: 'numeric' })}</time>
          <h3 class="post-list__title"><a href="post.html?slug=${encodeURIComponent(p.slug)}">${esc(p.title)}</a></h3>
          ${p.excerpt ? `<p>${esc(p.excerpt)}</p>` : ''}
        </li>`,
      )
      .join('');
  }
}
