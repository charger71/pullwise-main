import { initPage } from '../site.js';
import { initCatalog, categoryOptions, statusOptions, publisherFilter, badgeFilter } from '../catalog.js';

await initPage();

const IN_STORE = ['new_this_wednesday', 'just_arrived', 'available', 'low_stock', 'sale', 'clearance', 'backorder', 'sold_out'];

const [publisher, categories] = await Promise.all([publisherFilter(IN_STORE), categoryOptions()]);

await initCatalog({
  statuses: IN_STORE,
  reservable: false,
  followSeries: true,
  order: 'arrivals',
  filters: [
    publisher,
    { name: 'category', label: 'Category', options: categories, multiple: true },
    badgeFilter(),
    { name: 'status', label: 'Status', options: statusOptions(IN_STORE), multiple: true },
  ],
  toQuery: (v) => ({
    publishers: v.publisher,
    categoryIds: v.category.map(Number),
    badges: v.badge,
    // Only in-store statuses, even if the URL asks for others.
    statuses: v.status.length ? v.status.filter((st) => IN_STORE.includes(st)) : IN_STORE,
  }),
});
