import { initPage, openFocFrom, isPhone } from '../site.js';
import { initCatalog, categoryOptions, publisherFilter, badgeFilter, focFilter } from '../catalog.js';

await initPage();

// "How it works" is open on wide screens and tucked away on phones, so the titles come first there.
// If staff clear the text, the whole box goes.
const how = document.querySelector('.how-it-works');
if (how) {
  how.hidden = !how.querySelector('[data-content]')?.textContent.trim();
  if (isPhone()) how.open = false;
}

const firstOpenFoc = openFocFrom();

await initCatalog({
  statuses: ['pre_order'],
  reservable: true,
  order: 'foc',
  filters: [
    publisherFilter(['pre_order']),
    { name: 'category', label: 'Category', options: categoryOptions(), multiple: true },
    badgeFilter(),
    focFilter(firstOpenFoc), // the options load alongside the first page of titles (initCatalog waits for them)
  ],
  toQuery: (v) => ({
    focFrom: v.foc || firstOpenFoc, // reservations close the Saturday before FOC, so the title drops off on Sunday
    publishers: v.publisher,
    categoryIds: v.category.map(Number),
    badges: v.badge,
    focBefore: v.foc || undefined, // a chosen date shows only that cutoff
  }),
});
