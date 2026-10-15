// Status labels shared by the site and the admin. Key order is display order.

/** Title (item) statuses: label and the icon shown on badges. */
export const ITEM_STATUS = {
  pre_order: { label: 'Pre-Order', icon: '◷' },
  new_this_wednesday: { label: 'New This Wednesday', icon: '★' },
  just_arrived: { label: 'Just Arrived', icon: '★' },
  available: { label: 'Available', icon: '✓' },
  low_stock: { label: 'Low Stock', icon: '!' },
  sale: { label: 'Sale', icon: '%' },
  clearance: { label: 'Clearance', icon: '↓' },
  backorder: { label: 'Backorder', icon: '↻' },
  sold_out: { label: 'Sold Out', icon: '✕' },
};

/** Pull-list line statuses as staff see them. */
export const LINE_STATUS = {
  open: 'Open', ordered: 'Ordered', reordered: 'Reordered', arrived: 'Ready', picked_up: 'Picked up', released: 'Released to shelf', not_ordered: 'Not ordered', cancelled: 'Cancelled',
};

/** Customers see their own list, so an open line is "On your list". */
export const LINE_STATUS_CUSTOMER = { ...LINE_STATUS, open: 'On your list', not_ordered: 'Not ordered by the shop' };

/** Compact wording for tables, pills and CSV exports. */
export const LINE_STATUS_SHORT = { ...LINE_STATUS, released: 'Released' };
