import assert from 'node:assert/strict';
import { discountFor, seriesCount, totals, tiersFrom, DEFAULT_TIERS } from './discount.js';

assert.deepEqual(discountFor(0), { pct: 0, next: { pct: 10, more: 1 } });
assert.deepEqual(discountFor(1), { pct: 10, next: { pct: 15, more: 15 } });
assert.deepEqual(discountFor(15), { pct: 10, next: { pct: 15, more: 1 } });
assert.deepEqual(discountFor(16), { pct: 15, next: { pct: 20, more: 15 } });
assert.deepEqual(discountFor(30), { pct: 15, next: { pct: 20, more: 1 } });
assert.deepEqual(discountFor(31), { pct: 20, next: { pct: 25, more: 20 } });
assert.deepEqual(discountFor(51), { pct: 25, next: null });

const l = (series_key, status = 'open', price = 4.99, quantity = 1) => ({ status, quantity, item: { series_key, price } });
assert.equal(seriesCount([l('a'), l('a'), l('b', 'arrived'), l('c', 'cancelled'), l(null)]), 2);
assert.deepEqual(totals([l('a', 'open', 4.99, 2), l('b', 'open', null), l('c', 'cancelled')], 10), { subtotal: 9.98, discount: 1, total: 8.98 });

// tiers come from settings; off or custom
assert.deepEqual(tiersFrom({}), DEFAULT_TIERS, 'no column → defaults');
assert.deepEqual(tiersFrom({ discount_enabled: false, discount_tiers: DEFAULT_TIERS }), []);
assert.deepEqual(tiersFrom({ discount_enabled: true, discount_tiers: [{ min: 20, pct: 20 }, { min: 5, pct: 5 }] }), [{ min: 5, pct: 5 }, { min: 20, pct: 20 }]);
assert.deepEqual(tiersFrom({ discount_tiers: [] }), []);
const custom = [{ min: 5, pct: 5 }, { min: 20, pct: 20 }];
assert.deepEqual(discountFor(4, custom), { pct: 0, next: { pct: 5, more: 1 } });
assert.deepEqual(discountFor(20, custom), { pct: 20, next: null });
assert.deepEqual(discountFor(9, []), { pct: 0, next: null });
console.log('discount tests passed');
