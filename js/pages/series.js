// One series: series.html?s=<key> (js/follow-link.js). Its cover, name and publisher, the buttons to follow it, and
// every issue the shop lists: the ones still open for the pull list first, then the rest. A series on the shop's
// Series list with nothing listed yet (just announced) still gets a page, so it can be followed and shared.
import { initPage, $, esc, openFocFrom, cutoffPassed } from '../site.js';
import { getItems, getSeriesEntry } from '../data.js';
import { renderGrid, enableReservations, seriesFollowActions, enableSeriesFollow } from '../components.js';
import { thumbOf, thumbFallback } from '../util.js';
import { setPageMeta } from '../page-meta.js';
import { seriesKeyIn, nameFromKey } from '../follow-link.js';
import * as pull from '../customer.js';

const key = seriesKeyIn(location.search);
// Started alongside the page chrome. undefined = couldn't load.
const entryLoad = key ? getSeriesEntry(key).catch((err) => (console.error(err), undefined)) : null;
const s = await initPage();
const el = $('#series');
const shop = s.shop_name ?? '';

const notFound = (heading, text) => {
  setPageMeta({ title: `${shop} — ${heading}`, noindex: true });
  el.innerHTML = `<h1>${esc(heading)}</h1><p>${text}</p><p><a href="search.html">Search the shop</a></p>`;
};

if (!key) {
  notFound('Series Not Found', 'This link doesn’t name a series.');
} else {
  const [entry, items] = await Promise.all([
    entryLoad,
    getItems({ seriesKey: key, openFirst: openFocFrom(s.timezone), limit: 400 }).catch((err) => (console.error(err), undefined)),
  ]);
  if (entry === undefined || items === undefined) {
    notFound('We Couldn’t Load This Series', 'Please check your connection and try again in a moment.');
  } else if (!entry && !items.length) {
    notFound('Series Not Found', 'We don’t have this series listed. It may have a different name here.');
  } else {
    show(entry, items);
  }
}

function show(entry, items) {
  // Named as the Series list names it, else by its issues (the shortest title, as the admin does).
  const name = entry?.label || [...items].sort((a, b) => a.title.length - b.title.length)[0]?.title || nameFromKey(key);
  const publisher = entry?.publisher || items.find((i) => i.publisher)?.publisher || '';
  const coverUrl = entry?.cover_url || items.find((i) => i.cover_url)?.cover_url || '';
  const issues = new Set(items.map((i) => i.issue_number).filter(Boolean)).size;
  const open = items.filter((i) => i.status === 'pre_order' && !cutoffPassed(i));
  const rest = items.filter((i) => !open.includes(i));

  const about = issues
    ? `${issues} ${issues === 1 ? 'issue' : 'issues'} listed${open.length ? `, ${open.length} ${open.length === 1 ? 'cover' : 'covers'} open for pre-order now` : ''}.`
    : 'Just announced: no issues are listed yet. Follow it now and each issue goes on your pull list as soon as we list it.';
  setPageMeta({ title: `${shop} — ${name}`, description: `${name}${publisher ? ` from ${publisher}` : ''} at ${shop}. ${about} Follow the series and every new issue is added to your pull list automatically.` });

  const pic = coverUrl
    ? `<img class="cover" src="${esc(thumbOf(coverUrl))}" ${thumbFallback(coverUrl)} alt="Cover of ${esc(name)}" fetchpriority="high">`
    : '<div class="cover cover--placeholder" aria-hidden="true">Image coming soon</div>';
  const follow = () => `${seriesFollowActions(key, name)}<p class="card__meta" role="status" data-msg></p>`;

  el.innerHTML = `
    <div class="series-page__head">
      <div class="series-page__media">${pic}</div>
      <div>
        <p class="series-page__kicker">Series</p>
        <h1 class="series-page__name">${esc(name)}</h1>
        ${publisher ? `<p class="card__meta">${esc(publisher)}</p>` : ''}
        <p class="series-page__about">${esc(about)} Follow the series and every new issue is added to your pull list automatically, until each order cutoff. You can remove any you don’t want.</p>
        <div class="series-page__follow" data-follow-box>${follow()}</div>
      </div>
    </div>
    ${open.length ? `<section class="series-page__issues" aria-labelledby="series-open-h"><h2 id="series-open-h">Open for Pre-Order</h2><div class="grid" data-grid="open"></div></section>` : ''}
    ${rest.length ? `<section class="series-page__issues" aria-labelledby="series-rest-h"><h2 id="series-rest-h">${open.length ? 'Earlier Issues' : 'Issues'}</h2><div class="grid" data-grid="rest"></div></section>` : ''}`;

  const byId = new Map(items.map((i) => [i.id, i]));
  for (const [part, rows] of [['open', open], ['rest', rest]]) {
    const grid = $(`[data-grid="${part}"]`, el);
    if (!grid) continue;
    renderGrid(grid, rows, { reservable: true });
    enableReservations(grid, (id) => byId.get(id));
  }
  const box = $('[data-follow-box]', el);
  enableSeriesFollow(box);
  // Signing in or out elsewhere on the page (the header) changes which follow buttons apply.
  pull.onChange(() => {
    if (!box.contains(document.activeElement) && !box.querySelector('[data-msg]')?.textContent) box.innerHTML = follow();
  });
}
