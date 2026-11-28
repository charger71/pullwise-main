import assert from 'node:assert/strict';
import { validHoliday, futureHolidays, upcomingHolidays, tidyHoliday, todayHours, HOLIDAY_LOOKAHEAD_DAYS } from './holiday-hours.js';

const xmas = { date: '2026-12-25', label: 'Christmas Day', closed: true };
const eve = { date: '2026-12-24', label: 'Christmas Eve', open: '10:00', close: '15:00' };
const past = { date: '2026-11-01', closed: true };
const far = { date: '2027-03-01', closed: true };

assert.ok(validHoliday(xmas));
assert.ok(validHoliday(eve));
assert.ok(!validHoliday({ date: '2026-12-25' }), 'neither closed nor times');
assert.ok(!validHoliday({ date: '2026-12-25', open: '10:00' }), 'no close time');
assert.ok(!validHoliday({ date: 'Dec 25', closed: true }), 'not a YYYY-MM-DD date');
assert.ok(!validHoliday(null));

// Staff keep today and later, sorted; past and broken entries go.
assert.deepEqual(futureHolidays([xmas, past, { date: 'x' }, eve], '2026-11-16'), [eve, xmas]);
assert.deepEqual(futureHolidays([past], '2026-11-01'), [past], 'today still counts');
assert.deepEqual(futureHolidays(undefined, '2026-11-16'), []);
assert.deepEqual(futureHolidays('nope', '2026-11-16'), []);

// Customers see the next HOLIDAY_LOOKAHEAD_DAYS days only.
assert.equal(HOLIDAY_LOOKAHEAD_DAYS, 60);
assert.deepEqual(upcomingHolidays([far, xmas, eve, past], '2026-11-16'), [eve, xmas]);
assert.deepEqual(upcomingHolidays([far], '2027-01-01'), [far], 'comes into range later');
assert.deepEqual(upcomingHolidays([xmas], '2026-11-16', 7), []);

// Saved shape: closed entries carry no times, blank labels are dropped.
assert.deepEqual(tidyHoliday({ date: '2026-12-25', label: '  ', closed: true, open: '10:00', close: '15:00' }), { date: '2026-12-25', closed: true });
assert.deepEqual(tidyHoliday({ date: '2026-12-24', label: ' Christmas Eve ', closed: false, open: '10:00', close: '15:00' }), eve);


// Today's hours (the Simple footer): a holiday that day wins, else the weekly hours for that weekday.
const wk = [{ days: ['We', 'Th'], open: '10:00', close: '20:00' }, { days: ['Su'], open: '12:00', close: '17:00' }];
assert.deepEqual(todayHours(wk, [], '2026-12-02'), { open: '10:00', close: '20:00' }, 'a Wednesday');
assert.deepEqual(todayHours(wk, [], '2026-12-06'), { open: '12:00', close: '17:00' }, 'a Sunday');
assert.deepEqual(todayHours(wk, [], '2026-12-07'), { closed: true }, 'a Monday: not in the weekly hours');
assert.deepEqual(todayHours(wk, [{ date: '2026-12-02', closed: true }], '2026-12-02'), { closed: true });
assert.deepEqual(todayHours(wk, [{ date: '2026-12-02', open: '12:00', close: '16:00' }], '2026-12-02'), { open: '12:00', close: '16:00' });
assert.deepEqual(todayHours(wk, [{ date: '2026-12-02', open: '12:00' }], '2026-12-02'), { open: '10:00', close: '20:00' }, 'a malformed holiday is ignored');
assert.equal(todayHours([], [], '2026-12-02'), null, 'no hours at all');
assert.equal(todayHours(undefined, undefined, '2026-12-02'), null);
console.log('holiday-hours ok');
