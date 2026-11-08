// Run: node admin/money.test.js
import assert from 'node:assert/strict';
import { moneySummary } from './money.js';

const since = '2026-10-01';
const dayOf = (iso) => iso.slice(0, 10);
let id = 0;
const line = (status, price, quantity = 1, more = {}) => ({
  id: ++id, order_id: id, status, quantity, arrived_on: null,
  created_at: '2026-10-02T12:00:00Z', updated_at: '2026-10-02T12:00:00Z',
  item: { price }, placed: { customer_id: 1 }, ...more,
});
const sum = (recent, active = []) => moneySummary({ recent, active, since, weeks: 2, dayOf });

// Nothing yet: zeros, and no rate or wait to show.
{
  const m = sum([]);
  assert.equal(m.reserved, 0);
  assert.equal(m.perCustomer, 0);
  assert.equal(m.pickupRate, null);
  assert.equal(m.typicalWait, null);
  assert.deepEqual(m.byWeek.map((w) => w.start), ['2026-10-01', '2026-10-08']);
}

// Copies count at cover price; cancelled and never-ordered lines weren't really reserved. Released ones were.
{
  const m = sum([line('open', 5, 2), line('released', 4), line('cancelled', 100), line('not_ordered', 100)]);
  assert.equal(m.reserved, 14);
  assert.equal(m.byWeek[0].value, 14);
  assert.equal(m.byWeek[0].copies, 3);
}

// Each line lands in the week it was placed; one placed before the window isn't reserved but can still finish in it.
{
  const m = sum([
    line('open', 5, 1, { created_at: '2026-10-08T12:00:00Z' }),
    line('picked_up', 6, 1, { created_at: '2026-09-01T12:00:00Z', updated_at: '2026-10-03T12:00:00Z', arrived_on: '2026-10-01' }),
  ]);
  assert.deepEqual(m.byWeek.map((w) => w.value), [0, 5]);
  assert.equal(m.reserved, 5);
  assert.equal(m.pickedUp, 6);
  assert.equal(m.typicalWait, 2);
}

// A customer counts once across orders; guest orders each count as their own person.
{
  const guest = { placed: { customer_id: null } };
  const m = sum([line('open', 10), line('open', 10), line('open', 10, 1, guest), line('open', 10, 1, guest)]);
  assert.equal(m.customers, 3);
  assert.equal(Math.round(m.perCustomer * 100), 1333);
}

// Follow-through is by copies, and only settled ones: picked up or released.
{
  const m = sum([line('picked_up', 5, 3), line('released', 5, 1), line('arrived', 5, 10), line('cancelled', 5, 10)]);
  assert.equal(m.pickedCopies, 3);
  assert.equal(m.releasedCopies, 1);
  assert.equal(m.pickupRate, 75);
}

// The typical wait is the middle one, so one forgotten book doesn't skew it; a pickup dated before arrival is ignored.
{
  const done = (arrived_on) => line('picked_up', 5, 1, { arrived_on, updated_at: '2026-10-11T12:00:00Z' });
  assert.equal(sum([done('2026-10-10'), done('2026-10-09'), done('2026-10-02')]).typicalWait, 2);
  assert.equal(sum([done('2026-10-10'), done('2026-10-08')]).typicalWait, 2);
  assert.equal(sum([done('2026-10-20')]).typicalWait, null);
}

// What's in progress now comes from the active lines, whenever they were placed.
{
  const m = sum([], [line('arrived', 5, 2), line('open', 3), line('ordered', 4), line('reordered', 1)]);
  assert.equal(m.ready, 10);
  assert.equal(m.coming, 8);
  assert.equal(m.reserved, 0);
}

// A title with no price adds nothing, and a line seen in both lists is reported once.
{
  const free = line('arrived', null);
  const zero = line('open', 0);
  const m = sum([free, zero, line('open', 5)], [free]);
  assert.equal(m.reserved, 5);
  assert.equal(m.ready, 0);
  assert.equal(m.unpriced, 2);
}

// Prices arrive from the database as numbers or numeric strings.
assert.equal(sum([line('open', '4.99', 2)]).reserved, 9.98);

console.log('money tests passed');
