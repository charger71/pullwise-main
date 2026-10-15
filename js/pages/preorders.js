import { initPage, openFocFrom, lastReserveDay, fmtDate } from '../site.js';
import { getFocDates } from '../data.js';
import { initCatalog, categoryOptions, publisherFilter, badgeFilter } from '../catalog.js';

await initPage();

// "How it works" is open on wide screens and tucked away on phones, so the titles come first there.
// If staff clear the text, the whole box goes.
const how = document.querySelector('.how-it-works');
if (how) {
  how.hidden = !how.querySelector('[data-content]')?.textContent.trim();
  if (matchMedia('(max-width: 600px)').matches) how.open = false;
}

const firstOpenFoc = openFocFrom();
const [publisher, categories, focDates] = await Promise.all([publisherFilter(['pre_order']), categoryOptions(), getFocDates(['pre_order'], firstOpenFoc)]);

// One option per upcoming order cutoff, with the last day to add titles for it.
const focOptions = focDates.map((d) => [
  d,
  `${fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' })} — add by ${fmtDate(lastReserveDay(d), { weekday: 'short', month: 'short', day: 'numeric' })}`,
]);

await initCatalog({
  statuses: ['pre_order'],
  reservable: true,
  order: 'foc',
  filters: [
    publisher,
    { name: 'category', label: 'Category', options: categories, multiple: true },
    badgeFilter(),
    { name: 'foc', label: 'Order cutoff', options: focOptions },
  ],
  toQuery: (v) => ({
    focFrom: v.foc || firstOpenFoc, // reservations close the Saturday before FOC, so the title drops off on Sunday
    publishers: v.publisher,
    categoryIds: v.category.map(Number),
    badges: v.badge,
    focBefore: v.foc || undefined, // a chosen date shows only that cutoff
  }),
});
