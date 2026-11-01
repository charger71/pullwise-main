import { initPage } from '../site.js';
import { initCatalog, categoryOptions, statusOptions, publisherFilter, badgeFilter } from '../catalog.js';

await initPage();

const IN_STORE = ['new_this_wednesday', 'just_arrived', 'available', 'low_stock', 'sale', 'clearance', 'backorder', 'sold_out'];
// Coming Soon: pre-orders past their order cutoff, not out yet. They've left Pre-Orders, so they're listed here, last.
const SHOWN = [...IN_STORE, 'coming_soon'];

// The filter options load alongside the first page of titles (initCatalog waits for them).
await initCatalog({
  statuses: SHOWN,
  reservable: false,
  followSeries: true,
  order: 'arrivals',
  filters: [
    publisherFilter(SHOWN),
    { name: 'category', label: 'Category', options: categoryOptions(), multiple: true },
    badgeFilter(),
    { name: 'status', label: 'Status', options: statusOptions(SHOWN), multiple: true },
  ],
  toQuery: (v) => ({
    publishers: v.publisher,
    categoryIds: v.category.map(Number),
    badges: v.badge,
    // Only these statuses, even if the URL asks for others.
    statuses: v.status.length ? v.status.filter((st) => SHOWN.includes(st)) : SHOWN,
  }),
});
