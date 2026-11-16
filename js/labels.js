// Status labels shared by the site and the admin. Key order is display order.

/** Title (item) statuses: label and the icon shown on badges. */
export const ITEM_STATUS = {
  pre_order: { label: 'Pre-Order', icon: '◷' },
  coming_soon: { label: 'Coming Soon', icon: '◷' }, // a pre-order past its order cutoff, not out yet
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

// Collector badges staff tick on a title (an import ticks some itself: js/import/distributors.js autoBadges).
// Order here is display order. The database allows only these (items_badges_chk).
export const ITEM_BADGES = {
  first_appearance: '1st Appearance',
  key_issue: 'Key Issue',
  first_issue: 'First Issue',
  final_issue: 'Final Issue',
  milestone: 'Milestone Issue',
  one_shot: 'One-Shot',
  limited_series: 'Limited Series',
  facsimile: 'Facsimile',
  blind_bag: 'Blind Bag',
};
