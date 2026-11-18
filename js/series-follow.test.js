import assert from 'node:assert/strict';
import { seriesFollowQuestion } from './series-follow.js';

// Next open issue, with its cutoff: FOC Monday 2026-11-23 → order by Saturday 2026-11-21.
const q = seriesFollowQuestion({ label: 'ABSOLUTE BATMAN', issues: 3, next: { title: 'ABSOLUTE BATMAN', issue_number: '25', foc_date: '2026-11-23' } });
assert.match(q, /^Follow ABSOLUTE BATMAN\?/);
assert.match(q, /Next issue open for ordering: ABSOLUTE BATMAN #25 — order by Sat, Nov 21 \(FOC Mon, Nov 23\)\./);
assert.match(q, /It goes on your pull list now, along with 2 more open issues\./);
assert.match(q, /Facsimiles and later printings are never added\./);

// One open issue, all covers, for staff.
const one = seriesFollowQuestion({ label: 'SAGA', issues: 1, next: { title: 'SAGA', issue_number: '71', foc_date: null } }, { allCovers: true, list: 'Dana’s pull list' });
assert.match(one, /^Follow SAGA \(all covers\)\?/);
assert.match(one, /Next issue open for ordering: SAGA #71\./);
assert.match(one, /It goes on Dana’s pull list now, every cover\./);
assert.doesNotMatch(one, /more open/);

// Two open: "1 more open issue".
assert.match(seriesFollowQuestion({ label: 'X', issues: 2, next: { title: 'X', issue_number: '2', foc_date: null } }), /along with 1 more open issue\./);

// Nothing open yet.
assert.match(seriesFollowQuestion({ label: 'BONE', issues: 0, next: null }), /No issue is open for ordering right now\. The next one is added to your pull list when the shop lists it\./);

// Preview couldn't load: still asks, with the name the button carries.
assert.match(seriesFollowQuestion(null, { label: 'SPAWN' }), /^Follow SPAWN\?\n\nNew issues will be added to your pull list automatically\./);

console.log('series-follow: ok');
