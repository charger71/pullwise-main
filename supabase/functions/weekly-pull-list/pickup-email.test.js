// node supabase/functions/weekly-pull-list/pickup-email.test.js
import assert from 'node:assert/strict';
import { fillCopy, pickupVars, buildPickupNotice } from './email.js';

const shop = { shop_name: 'Pop’s Comics', phone: '555-0100', street: '1 Main St', city: 'Town', region: 'KY', hours: [{ days: ['Mo', 'Tu'], open: '11:00', close: '19:00' }], colors: {} };
const today = '2026-11-16';

assert.equal(fillCopy('Hi {first_name} at {shop_name}', { first_name: 'Jo', shop_name: 'Pop’s' }), 'Hi Jo at Pop’s');
assert.equal(fillCopy('{unknown} stays', {}), '{unknown} stays', 'an unknown placeholder is left so staff spot it');
assert.equal(fillCopy('{count} {count}', { count: '2 books' }), '2 books 2 books');

const v = pickupVars({ customer: { first_name: '' }, shop, count: 3, cents: 1248, oldest: '2026-11-07', pauseOn: '2026-11-21', today });
assert.deepEqual(v, { first_name: 'there', shop_name: 'Pop’s Comics', count: '3 books', total: '$12.48', days: 9, pause_date: 'Saturday, November 21' });
assert.equal(pickupVars({ customer: { first_name: 'Jo' }, shop, count: 1, cents: 399, oldest: today, today }).count, '1 book');
assert.equal(pickupVars({ customer: {}, shop, count: 1, cents: 0, oldest: null, today }).pause_date, 'soon');

const lines = [
  { quantity: 2, arrived_on: '2026-11-07', item: { title: 'SAGA', issue_number: '71', variant: null, price: 3.99 } },
  { quantity: 1, arrived_on: '2026-11-10', item: { title: 'X <script>', issue_number: '1', variant: 'CVR B', price: 4.50 } },
];
const copy = { subject: 'Your books are waiting at {shop_name}', intro: 'You have {count} waiting, {total} in all. Please come by before {pause_date}. Waiting {days} days.' };
const mail = buildPickupNotice({ customer: { first_name: 'Jo' }, lines, shop, copy, pauseOn: '2026-11-21', today, manageUrl: 'https://shop.example/account.html' });
assert.equal(mail.subject, 'Your books are waiting at Pop’s Comics');
assert.match(mail.text, /You have 3 books waiting, \$12\.48 in all\. Please come by before Saturday, November 21\. Waiting 9 days\./);
assert.match(mail.text, /WAITING FOR YOU \(2\)\n- SAGA #71\n  2 copies · waiting since Nov 7 · \$7\.98/);
assert.match(mail.text, /Total \$12\.48 before tax/);
assert.match(mail.html, /X &lt;SCRIPT&gt; #1/, 'titles are escaped');
assert.doesNotMatch(mail.html, /<script>/);
assert.doesNotMatch(mail.html, /unsubscribe/i, 'transactional: no unsubscribe link');
assert.match(mail.text, /even if other emails are turned off/);
assert.match(mail.html, /View my pull list/);

const pause = buildPickupNotice({ customer: {}, lines, shop, copy: { subject: 'On hold at {shop_name}', intro: 'Your list is on hold ({count}, {total}).' }, today, manageUrl: 'x', sample: true });
assert.equal(pause.subject, '[Sample] On hold at Pop’s Comics');
assert.match(pause.text, /^Hi,\n\nYour list is on hold \(3 books, \$12\.48\)\./);

console.log('pickup email tests passed');
