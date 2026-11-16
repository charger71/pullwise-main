import assert from 'node:assert/strict';
import { addDays, weekStart, localDate, holdUntil, todayIn, dayIn, lastReserveDay, whenIn, setShopTimeZone, shopTimeZone, shopToday, daysUntil, cutoffPassed, fmtDateIn, fmtTimeIn } from './dates.js';
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

// The shop's timezone, shared by the site and the admin: "today" and the cutoffs follow it, not the browser's zone.
assert.equal(shopTimeZone(), undefined, 'the browser zone until set');
setShopTimeZone('Not/AZone');
assert.equal(shopTimeZone(), undefined, 'a typo in settings falls back to the browser zone');
for (const zone of ['Pacific/Kiritimati', 'Pacific/Pago_Pago']) { // a day apart: one of them is never the test machine's date
  setShopTimeZone(zone);
  assert.equal(shopTimeZone(), zone);
  assert.equal(shopToday(), todayIn(zone));
  assert.equal(daysUntil(shopToday()), 0);
  assert.equal(daysUntil(addDays(shopToday(), 3)), 3);
  // A title is open through its last reserve day (shop time) and closed from the day after.
  for (let n = -10; n <= 14; n++) {
    const foc = addDays(shopToday(), n);
    assert.equal(cutoffPassed({ foc_date: foc }), lastReserveDay(foc) < shopToday(), `${zone}: FOC ${foc}`);
  }
}
assert.notEqual(todayIn('Pacific/Kiritimati'), todayIn('Pacific/Pago_Pago'), 'the two zones are a day apart');
assert.equal(cutoffPassed({}), false);
setShopTimeZone(undefined);
assert.equal(fmtDateIn('', undefined, 'UTC'), '');
assert.equal(fmtDateIn('2026-10-01', { month: 'short', day: 'numeric' }, 'Pacific/Kiritimati'), new Date('2026-10-01T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }), 'a plain date is a calendar day in any zone');
assert.notEqual(fmtDateIn('2026-10-01T22:43:00Z', { day: 'numeric' }, 'Pacific/Kiritimati'), fmtDateIn('2026-10-01T22:43:00Z', { day: 'numeric' }, 'America/New_York'));
assert.notEqual(fmtTimeIn('2026-10-01T22:43:00Z', 'America/New_York'), fmtTimeIn('2026-10-01T22:43:00Z', 'America/Chicago'));
console.log('dates ok');
