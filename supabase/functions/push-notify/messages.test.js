// node supabase/functions/push-notify/messages.test.js
import assert from 'node:assert/strict';
import { itemTitle, nameList, arrivalMessage, newTitlesMessage, testMessage, notificationIcon, subscriptionGone } from './messages.js';

const line = (title, issue) => ({ item: { title, issue_number: issue } });

assert.equal(itemTitle({ title: 'Saga', issue_number: '71' }), 'Saga #71');
assert.equal(itemTitle({ title: 'Bone Omnibus' }), 'Bone Omnibus');
assert.equal(nameList(['A']), 'A');
assert.equal(nameList(['A', 'B']), 'A and B');
assert.equal(nameList(['A', 'B', 'C', 'D']), 'A, B and 2 more');

// Ready for pickup: one or many, covers of one issue counted once, the shop named
const one = arrivalMessage([line('Saga', '71')], ' Area71 Comics ');
assert.equal(one.title, 'Your book is ready for pickup');
assert.equal(one.body, 'Saga #71 is waiting for you at Area71 Comics.');
assert.equal(one.url, '/app#list');
assert.equal(one.tag, 'arrivals');
const many = arrivalMessage([line('Saga', '71'), line('Saga', '71'), line('Spawn', '400'), line('Batman', '1')]);
assert.equal(many.title, '3 books are ready for pickup');
assert.equal(many.body, 'Saga #71, Spawn #400 and 1 more are waiting for you.');

// New from follows
const added = newTitlesMessage([line('Spawn', '401'), line('Saga', '72')]);
assert.equal(added.title, '2 new titles on your pull list');
assert.match(added.body, /^Spawn #401 and Saga #72, from what you follow\./);
assert.equal(newTitlesMessage([line('Spawn', '401')]).title, 'New on your pull list');

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
