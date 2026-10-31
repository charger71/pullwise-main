// node supabase/functions/push-notify/messages.test.js
import assert from 'node:assert/strict';
import { itemTitle, nameList, arrivalMessage, newTitlesMessage, testMessage, notificationIcon, subscriptionGone, addDays, shopToday, dayLabel, lastChangeDay, focsChangingOn, pickupDue, pickupReminderMessage, cutoffMessage } from './messages.js';

const line = (title, issue, id) => ({ item: { id, title, issue_number: issue } });

assert.equal(itemTitle({ title: 'Saga', issue_number: '71' }), 'Saga #71');
assert.equal(itemTitle({ title: 'Bone Omnibus' }), 'Bone Omnibus');
assert.equal(nameList(['A']), 'A');
assert.equal(nameList(['A', 'B']), 'A and B');
assert.equal(nameList(['A', 'B', 'C', 'D']), 'A, B and 2 more');

// Ready for pickup: one or many, covers of one issue counted once, the shop named
const one = arrivalMessage([line('Saga', '71', 5)], ' Area71 Comics ', 3);
assert.equal(one.title, 'Your book is ready for pickup');
assert.equal(one.body, 'Saga #71 is waiting for you at Area71 Comics.');
assert.equal(one.url, '/app?title=5#list', 'one title opens its details');
assert.equal(one.badge, 3, 'the icon counts everything waiting, not just the new ones');
assert.equal(arrivalMessage([line('Saga', '71')]).url, '/app#list', 'no id: My List');
assert.equal(one.tag, 'arrivals');
const many = arrivalMessage([line('Saga', '71'), line('Saga', '71'), line('Spawn', '400'), line('Batman', '1')]);
assert.equal(many.title, '3 books are ready for pickup');
assert.equal(many.body, 'Saga #71, Spawn #400 and 1 more are waiting for you.');
assert.equal(many.url, '/app#list');
assert.equal(many.badge, 4);

// New from follows
const added = newTitlesMessage([line('Spawn', '401'), line('Saga', '72')]);
assert.equal(added.title, '2 new titles on your pull list');
assert.match(added.body, /^Spawn #401 and Saga #72, from what you follow\./);
assert.equal(newTitlesMessage([line('Spawn', '401', 9)]).title, 'New on your pull list');
assert.equal(newTitlesMessage([line('Spawn', '401', 9)]).url, '/app?title=9#list');
assert.equal(added.url, '/app#list');
assert.equal('badge' in added, false, 'new titles leave the icon alone');

// Dates
assert.equal(addDays('2026-10-31', 1), '2026-11-01');
assert.equal(shopToday('America/New_York', new Date('2026-11-01T03:30:00Z')), '2026-10-31', 'still Saturday evening in New York');
assert.equal(dayLabel('2026-11-07'), 'Sat, Nov 7');
assert.equal(lastChangeDay('2026-11-09'), '2026-11-07', 'a Monday FOC: the Saturday before');
assert.equal(lastChangeDay('2026-11-07'), '2026-10-31', 'a Saturday FOC: the Saturday a week before');
assert.deepEqual(focsChangingOn('2026-11-07'), ['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14']);
for (const foc of focsChangingOn('2026-11-07')) assert.equal(lastChangeDay(foc), '2026-11-07');

// Pickup reminders: a week waiting, then two days of a 30-day hold left; each once; none after the hold
const waiting = (arrived_on, pickup_reminders = 0) => ({ arrived_on, pickup_reminders });
assert.equal(pickupDue(waiting('2026-10-26'), '2026-11-01', 30), 0, 'six days: not yet');
assert.equal(pickupDue(waiting('2026-10-25'), '2026-11-01', 30), 1, 'a week');
assert.equal(pickupDue(waiting('2026-10-25', 1), '2026-11-01', 30), 0, 'already had it');
assert.equal(pickupDue(waiting('2026-10-05', 1), '2026-11-01', 30), 0, 'three days left: not yet');
assert.equal(pickupDue(waiting('2026-10-04', 1), '2026-11-01', 30), 2, 'two days left');
assert.equal(pickupDue(waiting('2026-10-04', 2), '2026-11-01', 30), 0, 'already had the last call');
assert.equal(pickupDue(waiting('2026-10-02', 1), '2026-11-01', 30), 2, 'the hold’s last day');
assert.equal(pickupDue(waiting('2026-10-01'), '2026-11-01', 30), 0, 'hold over: the shop decides');
assert.equal(pickupDue(waiting('2026-10-25'), '2026-11-01', 8), 2, 'a short hold goes straight to the last call');
assert.equal(pickupDue({ arrived_on: null }, '2026-11-01', 30), 0);

const week = pickupReminderMessage([line('Saga', '71', 5)], { stage: 1, holdUntil: '2026-11-24', shopName: 'Area71', readyCount: 2 });
assert.equal(week.title, 'Your book is still waiting');
assert.equal(week.body, 'Saga #71 is waiting for you at Area71. We’ll hold it until Tue, Nov 24.');
assert.equal(week.url, '/app?title=5#list');
assert.equal(week.badge, 2);
assert.equal(week.tag, 'pickup');
const last = pickupReminderMessage([line('Saga', '71'), line('Spawn', '400')], { stage: 2, holdUntil: '2026-11-03' });
assert.equal(last.title, 'Last days to pick up your books');
assert.equal(last.body, 'Pick up Saga #71 and Spawn #400 by Tue, Nov 3, or they may go back on the shelf.');

const cut = cutoffMessage([line('Saga', '72'), line('Spawn', '401'), line('Batman', '2')], '2026-11-07');
assert.equal(cut.title, 'Last chance to change your pull list');
assert.equal(cut.body, 'Saga #72, Spawn #401 and 1 more: change or remove them by tomorrow (Sat, Nov 7), before the shop places its order.');
assert.equal(cut.url, '/app#list');
assert.equal('badge' in cut, false);

assert.equal(testMessage('Area71').title, 'Area71');
assert.equal(testMessage().title, 'Notifications are on');

// Icon: the shop's picture squared at 192px; other https pictures as they are; nothing else
const MEDIA = 'https://abc.supabase.co/storage/v1/object/public/media';
assert.equal(notificationIcon({ favicon_url: `${MEDIA}/icon.png`, logo_url: `${MEDIA}/logo.png` }), 'https://abc.supabase.co/storage/v1/render/image/public/media/icon.png?width=192&height=192&resize=contain&quality=75&format=origin');
assert.equal(notificationIcon({ logo_url: 'https://cdn.example.com/l.png' }), 'https://cdn.example.com/l.png');
assert.equal(notificationIcon({ logo_url: 'javascript:alert(1)' }), undefined);
assert.equal(notificationIcon(), undefined);

assert.equal(subscriptionGone(410), true);
assert.equal(subscriptionGone(404), true);
assert.equal(subscriptionGone(429), false);
assert.equal(subscriptionGone(undefined), false);

console.log('push message tests passed');
