// Pull list discount: the more distinct series on a customer's active pull list, the bigger the
// percent off. The tiers and the on/off switch live in Shop Settings (settings.discount_tiers and
// settings.discount_enabled); DEFAULT_TIERS only applies if the settings row doesn't have them.
// A tier's `min` is the fewest series that earns it. A copy of this file sits in
// supabase/functions/weekly-pull-list/discount.js for the emails: copy it across after any change.

export const DEFAULT_TIERS = [
  { min: 1, pct: 10 },
  { min: 16, pct: 15 },
  { min: 31, pct: 20 },
  { min: 51, pct: 25 },
];

export const ACTIVE = ['open', 'ordered', 'reordered', 'arrived'];

/** The tiers in force for a settings row, lowest first: none when the program is switched off. */
export function tiersFrom(settings) {
  if (settings?.discount_enabled === false) return [];
  const t = settings?.discount_tiers;
  return (Array.isArray(t) ? t : DEFAULT_TIERS).map(({ min, pct }) => ({ min: Number(min), pct: Number(pct) })).sort((a, b) => a.min - b.min);
}

/** Distinct series among the active lines ({ status, item: { series_key } }). Items with no series (toys, etc.) don't count. */
export function seriesCount(lines) {
  return new Set(lines.filter((l) => ACTIVE.includes(l.status)).map((l) => l.item?.series_key).filter(Boolean)).size;
}

/** The current tier's percent, and what the next tier needs: { pct, next: { pct, more } | null }. */
export function discountFor(count, tiers = DEFAULT_TIERS) {
  const now = [...tiers].reverse().find((t) => count >= t.min) ?? { pct: 0 };
  const next = tiers.find((t) => t.min > count);
  return { pct: now.pct, next: next ? { pct: next.pct, more: next.min - count } : null };
}

/** Subtotal at cover price (lines without a price are skipped), the discount taken off, and the total, in cents-rounded dollars. */
export function totals(lines, pct) {
  const subtotal = lines.filter((l) => ACTIVE.includes(l.status) && l.item?.price != null).reduce((n, l) => n + l.item.price * l.quantity, 0);
  const discount = Math.round(subtotal * pct) / 100;
  return { subtotal, discount, total: Math.round((subtotal - discount) * 100) / 100 };
}
