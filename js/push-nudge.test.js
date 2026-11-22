import assert from 'node:assert/strict';
import { MOMENT_KEY, BANNER_KEY, MOMENT_DAYS, BANNER_DAYS, pausedUntil, isPaused, pause, momentText } from './push-nudge.js';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 10, 21, 12);
const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};
const broken = { getItem() { throw new Error('no storage'); }, setItem() { throw new Error('no storage'); } };

assert.equal(MOMENT_DAYS, 14);
assert.equal(BANNER_DAYS, 30);

// Nothing kept yet: not paused.
const store = memory();
assert.equal(pausedUntil(store, MOMENT_KEY), null);
assert.equal(isPaused(store, MOMENT_KEY, now), false);

// "Not now" on the moment prompt: 14 days.
pause(store, MOMENT_KEY, MOMENT_DAYS, now);
assert.equal(isPaused(store, MOMENT_KEY, now + 13 * DAY), true);
assert.equal(isPaused(store, MOMENT_KEY, now + 14 * DAY + 1), false);
assert.equal(isPaused(store, BANNER_KEY, now), false, 'pauses are kept apart');

// Closing the standing card: 30 days.
pause(store, BANNER_KEY, BANNER_DAYS, now);
assert.equal(isPaused(store, BANNER_KEY, now + 29 * DAY), true);
assert.equal(isPaused(store, BANNER_KEY, now + 30 * DAY + 1), false);

// A kept value that isn't a number counts as not paused.
store.setItem(MOMENT_KEY, 'junk');
assert.equal(isPaused(store, MOMENT_KEY, now), false);

// No storage (private mode): nothing throws, and it reads as paused so a card never nags on every open.
assert.doesNotThrow(() => pause(broken, MOMENT_KEY, MOMENT_DAYS, now));
assert.equal(pausedUntil(broken, MOMENT_KEY), Infinity);
assert.equal(isPaused(broken, BANNER_KEY, now), true);

// The prompt's words.
assert.equal(momentText({ kind: 'add', label: 'Saga #70' }), 'Want a heads-up when <strong>Saga #70</strong> is ready for pickup?');
assert.equal(momentText({ kind: 'follow', label: 'Saga' }), 'Want a heads-up when new <strong>Saga</strong> issues arrive?');
assert.match(momentText({ kind: 'add', label: '<b>' }), /&lt;b&gt;/);
