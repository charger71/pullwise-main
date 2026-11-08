// The figures on Analytics → Sales → Money, worked out from reservation lines.
//
// Dollars are estimates: a line doesn't save the price it was reserved at or its pull list discount, so each copy
// counts at the title's cover price today. Customers pay in the store, so none of this is sales.
// A finished line's updated_at stands in for its pickup date (a trigger stamps every change to a line).

import { addDays } from '../js/dates.js';

const NEVER_HELD = new Set(['cancelled', 'not_ordered']); // the customer backed out, or the shop never ordered it
const DAY_MS = 86400000;

const median = (nums) => {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

/**
 * @param {object} o
 * @param {object[]} o.recent lines changed since `since`: { id, order_id, quantity, status, arrived_on, created_at, updated_at, item: { price }, placed: { customer_id } }
 * @param {object[]} o.active lines still in progress, whenever they were placed: { id, quantity, status, item: { price } }
 * @param {string}   o.since  first day counted, YYYY-MM-DD
 * @param {number}   o.weeks  whole weeks from `since`
 * @param {(iso:string)=>string} o.dayOf the shop's calendar day for a timestamp
 */
export function moneySummary({ recent, active, since, weeks, dayOf }) {
  const byWeek = Array.from({ length: weeks }, (_, i) => ({ start: addDays(since, i * 7), value: 0, copies: 0 }));
  const weekOfDay = new Map();
  for (const week of byWeek) for (let d = 0; d < 7; d++) weekOfDay.set(addDays(week.start, d), week);

  const unpriced = new Set();
  const worth = (l) => {
    const price = Number(l.item?.price);
    if (price > 0) return price * l.quantity;
    unpriced.add(l.id);
    return 0;
  };

  let ready = 0;
  let coming = 0;
  for (const l of active) {
    if (l.status === 'arrived') ready += worth(l);
    else coming += worth(l);
  }

  let reserved = 0;
  let pickedUp = 0;
  let pickedCopies = 0;
  let releasedCopies = 0;
  const customers = new Set();
  const waits = [];
  for (const l of recent) {
    const week = weekOfDay.get(dayOf(l.created_at));
    if (week && !NEVER_HELD.has(l.status)) {
      const value = worth(l);
      reserved += value;
      week.value += value;
      week.copies += l.quantity;
      customers.add(l.placed?.customer_id ? `customer ${l.placed.customer_id}` : `guest order ${l.order_id}`);
    }
    if (!weekOfDay.has(dayOf(l.updated_at))) continue;
    if (l.status === 'released') releasedCopies += l.quantity;
    if (l.status !== 'picked_up') continue;
    pickedUp += worth(l);
    pickedCopies += l.quantity;
    if (l.arrived_on) {
      const wait = Math.round((Date.parse(dayOf(l.updated_at)) - Date.parse(l.arrived_on)) / DAY_MS);
      if (wait >= 0) waits.push(wait);
    }
  }

  const finished = pickedCopies + releasedCopies;
  return {
    reserved,
    ready,
    coming,
    pickedUp,
    customers: customers.size,
    perCustomer: customers.size ? reserved / customers.size : 0,
    pickedCopies,
    releasedCopies,
    pickupRate: finished ? Math.round((pickedCopies / finished) * 100) : null, // of the copies held for someone that are now settled
    typicalWait: median(waits),
    unpriced: unpriced.size,
    byWeek,
  };
}
