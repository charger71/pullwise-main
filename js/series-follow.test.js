import assert from 'node:assert/strict';
import { seriesFollowFacts, alsoText } from './series-follow.js';

// Next open issue with its cover and cutoff: FOC Monday 2026-11-23 → order by Saturday 2026-11-21.
const preview = {
  label: 'ABSOLUTE BATMAN',
  issues: 9,
  next: { title: 'ABSOLUTE BATMAN', issue_number: '25', foc_date: '2026-11-23', cover_url: 'https://x/c.jpg', cover_thumb_url: 'https://x/c-sm.jpg', covers: 4 },
  more: ['26', '27', '28', '29', '30', '31'].map((n) => ({ issue_number: n, foc_date: null })),
};
const f = seriesFollowFacts(preview);
assert.equal(f.name, 'ABSOLUTE BATMAN');
assert.ok(f.loaded);
assert.deepEqual(f.next, { title: 'ABSOLUTE BATMAN #25', covers: 'Main cover', orderBy: 'Sat, Nov 21', foc: 'Mon, Nov 23', coverUrl: 'https://x/c.jpg', thumbUrl: 'https://x/c-sm.jpg' });
assert.equal(f.also.length, 6);
assert.equal(f.alsoMore, 2);
assert.equal(alsoText(f), '#26, #27, #28, #29, #30, #31 and 2 more');

// All covers names the count; one cover says just "All covers".
assert.equal(seriesFollowFacts(preview, { allCovers: true }).next.covers, 'All 4 covers');
assert.equal(seriesFollowFacts({ ...preview, next: { ...preview.next, covers: 1 } }, { allCovers: true }).next.covers, 'All covers');

// No cutoff date yet, no cover, nothing else open.
const one = seriesFollowFacts({ label: 'SAGA', issues: 1, next: { title: 'SAGA', issue_number: '71', foc_date: null }, more: [] });
assert.equal(one.next.orderBy, '');
assert.equal(one.next.thumbUrl, '');
assert.equal(alsoText(one), '');

// Nothing open yet.
const none = seriesFollowFacts({ label: 'BONE', issues: 0, next: null, more: [] });
assert.equal(none.next, null);
assert.ok(none.loaded);

// Preview couldn't load: the button's name, nothing claimed about issues.
const failed = seriesFollowFacts(null, { label: 'SPAWN' });
assert.equal(failed.name, 'SPAWN');
assert.equal(failed.loaded, false);
assert.equal(failed.next, null);

console.log('series-follow: ok');
