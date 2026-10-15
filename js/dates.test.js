import assert from 'node:assert/strict';
import { addDays, weekStart, localDate, holdUntil, todayIn, dayIn, lastReserveDay, whenIn } from './dates.js';
import * as email from '../supabase/functions/weekly-pull-list/email.js';

assert.equal(addDays('2026-12-30', 3), '2027-01-02');
assert.equal(addDays('2026-03-08', 1), '2026-03-09'); // across a US DST change
assert.equal(addDays('2026-10-05', -7), '2026-09-28');
assert.equal(localDate('2026-10-05').getDay(), 1);
assert.equal(weekStart('2026-10-07'), '2026-10-04'); // Wednesday -> Sunday
assert.equal(weekStart('2026-10-04'), '2026-10-04');
assert.equal(weekStart('2026-03-10'), '2026-03-08'); // across a DST change
assert.equal(holdUntil('2026-10-01', 30), '2026-10-31');
assert.equal(holdUntil(null), '');
assert.equal(dayIn('2026-10-02T02:30:00Z', 'America/New_York'), '2026-10-01');
assert.match(todayIn('Not/AZone'), /^\d{4}-\d{2}-\d{2}$/);
assert.equal(lastReserveDay('2026-10-12'), '2026-10-10'); // Monday FOC -> Saturday before
assert.equal(lastReserveDay('2026-10-10'), '2026-10-03'); // Saturday FOC -> the Saturday before
assert.equal(whenIn('2026-10-01T22:43:00Z', 'America/New_York'), 'Thu, Oct 1, 6:43 PM');
assert.equal(whenIn(null), '');

// The weekly email keeps its own copy of the date rules (the Edge Function deploys alone);
// make sure it never drifts from the site's.
for (let i = 0; i < 400; i++) {
  const day = addDays('2026-01-01', i);
  assert.equal(email.lastChangeDay(day), lastReserveDay(day), `lastChangeDay ${day}`);
  assert.equal(email.addDays(day, 30), addDays(day, 30), `addDays ${day}`);
  assert.equal(email.addDays(day, -7), addDays(day, -7), `addDays ${day}`);
}
console.log('dates ok');
