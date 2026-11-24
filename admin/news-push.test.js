// Run: node admin/news-push.test.js
import assert from 'node:assert/strict';
import { APP_TARGETS, toNewsPath, lastReal, daysAgo, lastSentText, recentWarning, reachText, testResultText, rowSummary, stillSending, NEWS_EMOJI, insertText } from './news-push.js';

// Where a tap opens: a page on the shop's own site, or a tab in the app
const host = 'derbycomics.pullwise.shop';
assert.deepEqual(APP_TARGETS.map((t) => t.value), ['/app', '/app#list', '/app#hot', '/app#shop']);
assert.deepEqual(toNewsPath('', host), { path: '/app' });
assert.deepEqual(toNewsPath('  /news/sale ', host), { path: '/news/sale' });
assert.deepEqual(toNewsPath('news/sale', host), { path: '/news/sale' });
assert.deepEqual(toNewsPath('https://derbycomics.pullwise.shop/series/saga?x=1#a', host), { path: '/series/saga?x=1#a' });
assert.match(toNewsPath('https://evil.test/x', host).error, /your own site/i);
assert.match(toNewsPath('//evil.test/x', host).error, /your own site/i);
assert.match(toNewsPath('/' + 'a'.repeat(300), host).error, /too long/i);
assert.match(toNewsPath('\\\\evil.test', host).error, /your own site/i, 'a backslash path is another site to the browser');
assert.match(toNewsPath('/\\evil.test/x', host).error, /your own site/i);

// How often the shop has sent: tests and failed sends don't count
const now = new Date(2026, 10, 23, 15);
const at = (d, h = 10) => new Date(2026, 10, d, h).toISOString();
const rows = [
  { test: true, status: 'sent', created_at: at(23, 14), sent_by_name: 'Pat' },
  { test: false, status: 'failed', created_at: at(22), sent_by_name: 'Lee' },
  { test: false, status: 'sent', created_at: at(21), sent_by_name: 'Sam' },
];
assert.equal(lastReal(rows), rows[2]);
assert.equal(lastReal([rows[0]]), null);
assert.equal(daysAgo(at(23, 1), now), 0);
assert.equal(daysAgo(at(20, 23), now), 3);
assert.equal(lastSentText([], now), 'Never sent');
assert.equal(lastSentText(rows, now), 'Last sent 2 days ago by Sam');
assert.equal(lastSentText([{ ...rows[2], created_at: at(22) }], now), 'Last sent yesterday by Sam');
assert.equal(lastSentText([{ ...rows[2], created_at: at(23, 9) }], now), 'Last sent earlier today by Sam');
assert.equal(lastSentText([{ ...rows[2], sent_by_name: null }], now), 'Last sent 2 days ago');
assert.equal(recentWarning(rows, now), 'You sent one 2 days ago.');
assert.equal(recentWarning([{ ...rows[2], created_at: at(23, 9) }], now), 'You sent one earlier today.');
assert.equal(recentWarning([{ ...rows[2], created_at: at(22) }], now), 'You sent one yesterday.');
assert.equal(recentWarning([{ ...rows[2], created_at: at(20) }], now), null, 'three days or more: no warning');
assert.equal(recentWarning([rows[0]], now), null);

// What the screen says
assert.equal(reachText(0), 'No customers have shop news turned on yet.');
assert.equal(reachText(1), 'Reaches 1 device');
assert.equal(reachText(143), 'Reaches 143 devices');
assert.match(testResultText(0), /Sign in to the app with this account/);
assert.equal(testResultText(1), 'Test sent to your 1 device.');
assert.equal(testResultText(2), 'Test sent to your 2 devices.');
assert.equal(rowSummary({ status: 'sending', created_at: new Date(now - 60000).toISOString() }, now), 'Sending…');

// A send the server never finished (stopped past its time limit) doesn't say "Sending…" for ever
const stuck = { status: 'sending', test: false, created_at: new Date(now - 11 * 60000).toISOString(), devices: 900 };
const going = { status: 'sending', test: false, created_at: new Date(now - 60000).toISOString(), devices: 900 };
assert.equal(rowSummary(stuck, now), 'Didn’t finish: may have reached only some of 900 devices');
assert.equal(stillSending([stuck], now), false, 'no more polling for a send that stopped');
assert.equal(stillSending([going, stuck], now), true);
assert.equal(stillSending([{ ...going, status: 'sent' }], now), false);
assert.equal(lastReal([stuck]), stuck, 'it probably reached phones, so it still counts as the last send');
assert.equal(rowSummary({ status: 'failed', error: 'boom' }), 'Failed: boom');
assert.equal(rowSummary({ status: 'sent', devices: 143, failed: 2 }), '143 devices · 2 failed');
assert.equal(rowSummary({ status: 'sent', devices: 1, failed: 0 }), '1 device');

// The emoji picker on Title and Message: each emoji counts as one character, as the 60 / 180 counts show it
assert.ok(NEWS_EMOJI.length >= 24);
for (const { emoji, name } of NEWS_EMOJI) {
  assert.equal(Array.from(emoji).length, 1, `${name} (${emoji}) is one character`);
  assert.ok(name && /^[a-z]/.test(name), `${emoji} has a name for screen readers`);
}
assert.equal(new Set(NEWS_EMOJI.map((e) => e.emoji)).size, NEWS_EMOJI.length, 'no emoji twice');
// Holidays through the year, for sale and closure notices
for (const e of ['💘', '🌹', '💚', '🐰', '🐣', '🎓', '🌞', '🦇', '👻', '🍂', '🦃', '🥧', '🕎', '🎅', '🔔', '🍾', '🥂', '🎊']) {
  assert.ok(NEWS_EMOJI.some((x) => x.emoji === e), `${e} is in the picker`);
}
assert.deepEqual(insertText('Big sale', 3, 3, '🎉'), { value: 'Big🎉 sale', caret: 5 }, 'at the cursor; caret after it (🎉 is 2 code units)');
assert.deepEqual(insertText('Big sale', 0, 3, '🔥'), { value: '🔥 sale', caret: 2 }, 'replaces the selection');
assert.deepEqual(insertText('', 0, 0, '⭐'), { value: '⭐', caret: 1 });
assert.deepEqual(insertText('Sale', null, null, '🎉'), { value: 'Sale🎉', caret: 6 }, 'no cursor yet: at the end');

console.log('news push tests passed');
