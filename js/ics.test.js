import assert from 'node:assert/strict';
import * as feed from '../supabase/functions/calendar-feed/ical.js';

// js/config.js takes SITE_URL from the page's origin (the Worker sets it per shop); Node has no page, so give it one.
globalThis.location ??= { origin: 'https://shop.example.com' };
const { allDayRange, googleLink, outlookLink, icsFor, htmlToText, icsText, icsFold, releaseIcs, releaseGoogleLink, titleUrl } = await import('./ics.js');

const octets = (s) => Buffer.byteLength(s, 'utf8');

// Descriptions: block tags and <br> become line breaks, entities are decoded, other tags go.
const html = '<p>Fish &amp; Chips&nbsp;night</p><p>It&#39;s <b>free</b>&#x21;<br>Bring&nbsp;a friend</p><ul><li>One</li><li>Two</li></ul>&bogus; &constructor;';
const plain = "Fish & Chips night\n\nIt's free!\nBring a friend\n\n• One\n• Two\n\n&bogus; &constructor;";
assert.equal(htmlToText(html), plain);
assert.equal(htmlToText(null), '');
assert.equal(htmlToText('&lt;script&gt;'), '<script>');

// TEXT escaping
assert.equal(icsText('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');

// Folding: every physical line is at most 75 octets, unfolding gives the original back,
// and multi-byte characters are never split.
for (const line of ['DESCRIPTION:' + 'x'.repeat(200), 'SUMMARY:' + 'é'.repeat(100), 'SUMMARY:' + '🦸‍♀️ Comic Con — ✨'.repeat(12), 'X:short']) {
  const folded = icsFold(line);
  const parts = folded.split('\r\n');
  for (const p of parts) assert.ok(octets(p) <= 75, `${octets(p)} octets: ${p}`);
  parts.slice(1).forEach((p) => assert.equal(p[0], ' '));
  assert.equal(folded.replace(/\r\n /g, ''), line);
  assert.ok(!folded.includes('�'));
  assert.equal(feed.icsFold(line), folded, 'the feed folds the same way');
}
assert.equal(icsFold('x'.repeat(75)), 'x'.repeat(75));
assert.equal(icsFold('x'.repeat(76)), `${'x'.repeat(75)}\r\n x`);

// The Edge Function's copy agrees with the site's.
assert.equal(feed.htmlToText(html), plain);
assert.equal(feed.icsText('a,b;c\\d\ne'), icsText('a,b;c\\d\ne'));

// A whole file: CRLF line ends, folded description with decoded entities.
const ics = icsFor({ id: 7, title: 'Signing; with “quotes”', starts_at: '2026-11-01T18:00:00Z', ends_at: null, location: null, description: `<p>${'Lots &amp; lots of words. '.repeat(10)}</p><p>Second</p>` }, 'Main Street Comics', 'shop.example.com');
assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
for (const p of ics.split('\r\n')) assert.ok(octets(p) <= 75);
const unfolded = ics.replace(/\r\n /g, '');
assert.match(unfolded, /SUMMARY:Signing\\; with “quotes”\r\n/);
assert.match(unfolded, /DESCRIPTION:Lots & lots of words\. .*words\.\\n\\nSecond\\n\\nDetails: https:\/\/shop\.example\.com\/event\.html\?id=7\r\n/);
assert.match(unfolded, /DTEND:20261101T200000Z/);

console.log('ics tests passed');

// A shop with several locations passes each event's place; without one the old "Shop — note" text is used.
{
  const e = { id: 8, title: 'Signing', starts_at: '2026-11-01T18:00:00Z', ends_at: null, location: 'back room', description: '' };
  assert.match(icsFor(e, 'Main Street Comics', 'shop.example.com').replace(/\r\n /g, ''), /LOCATION:Main Street Comics — back room/);
  assert.match(icsFor(e, 'Main Street Comics', 'shop.example.com', 'Main Street Comics : Downtown, 1 Oak St').replace(/\r\n /g, ''), /LOCATION:Main Street Comics : Downtown\\, 1 Oak St/);
}

// A title's release day: all day, linking to the title where it can be found
{
  const item = { id: 5, title: 'Saga', issue_number: '72', variant: 'Cover B', status: 'pre_order', release_date: '2026-11-25' };
  const r = releaseIcs(item, 'Main Street Comics', 'shop.example.com').replace(/\r\n /g, '');
  assert.match(r, /DTSTART;VALUE=DATE:20261125\r\n/);
  assert.match(r, /DTEND;VALUE=DATE:20261126\r\n/);
  assert.match(r, /SUMMARY:Saga #72 \(Cover B\) is out\r\n/);
  assert.match(r, /URL:https:\/\/shop\.example\.com\/pre-orders\.html\?title=5\r\n/);
  assert.match(r, /UID:release-5@shop\.example\.com\r\n/);
  assert.equal(titleUrl({ ...item, status: 'new_this_wednesday' }), 'https://shop.example.com/new-arrivals.html?title=5');
  assert.equal(titleUrl({ ...item, status: 'coming_soon' }), 'https://shop.example.com/new-arrivals.html?title=5'); // listed on New Arrivals
  assert.equal(new URL(releaseGoogleLink(item, 'Main Street Comics')).searchParams.get('dates'), '20261125/20261126');
  assert.equal(releaseIcs({ ...item, release_date: '2026-12-31' }, 'S', 'h').match(/DTEND;VALUE=DATE:(\d+)/)[1], '20270101', 'across the new year');
}

// All-day events (midnight to 11:59 PM in the shop's zone) export as dates, not times; the end is the day after.
{
  const tz = 'America/Chicago';
  const one = { id: 9, title: 'Free Comic Book Day', starts_at: '2027-05-01T05:00:00Z', ends_at: '2027-05-02T04:59:00Z', description: '' };
  const two = { ...one, ends_at: '2027-05-03T04:59:00Z' };
  assert.deepEqual(allDayRange(one, tz), { start: '2027-05-01', end: '2027-05-02' });
  assert.deepEqual(allDayRange(two, tz), { start: '2027-05-01', end: '2027-05-03' });
  assert.equal(allDayRange({ ...one, ends_at: null }, tz), null, 'no end: timed');
  assert.equal(allDayRange({ ...one, starts_at: '2027-05-01T14:00:00Z' }, tz), null, 'a daytime start is timed');
  const f = icsFor(one, 'S', 'h', null, tz);
  assert.match(f, /DTSTART;VALUE=DATE:20270501\r\n/);
  assert.match(f, /DTEND;VALUE=DATE:20270502\r\n/);
  assert.match(googleLink(one, 'S', tz), /dates=20270501%2F20270502/);
  assert.match(outlookLink(one, 'S', tz), /allday=true&startdt=2027-05-01&enddt=2027-05-02/);
  assert.match(googleLink({ ...one, starts_at: '2027-05-01T14:00:00Z' }, 'S', tz), /dates=20270501T140000Z/);
}
