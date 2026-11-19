import assert from 'node:assert/strict';
import { followLink, followHref, followKeyIn, seriesHref, seriesLink, seriesKeyIn, nameFromKey, keepPending, peekPending, takePending } from './follow-link.js';

// The link, with or without a trailing slash on the site address.
assert.equal(followLink('https://popscomics502.com', 'absolute justice'), 'https://popscomics502.com/account.html?follow=absolute%20justice');
assert.equal(followLink('https://popscomics502.com/', 'gargoyles 2026'), 'https://popscomics502.com/account.html?follow=gargoyles%202026');

// Reading it back: tidied to a series key, whatever the case or spacing.
assert.equal(followKeyIn('?follow=absolute%20justice'), 'absolute justice');
assert.equal(followKeyIn('?follow=Absolute+Justice'), 'absolute justice');
assert.equal(followKeyIn('?follow=ABSOLUTE-JUSTICE%20(2027)'), 'absolute justice 2027');
assert.equal(followKeyIn('?title=12'), null);
assert.equal(followKeyIn('?follow=%20%20'), null);
assert.equal(followKeyIn(''), null);

assert.equal(followHref('absolute justice'), 'account.html?follow=absolute%20justice');

// The series page: dashes in the address, read back to the key.
assert.equal(seriesHref('absolute justice'), 'series.html?s=absolute-justice');
assert.equal(seriesLink('https://popscomics502.com/', 'gargoyles 2026'), 'https://popscomics502.com/series.html?s=gargoyles-2026');
assert.equal(seriesKeyIn('?s=absolute-justice'), 'absolute justice');
assert.equal(seriesKeyIn('?s=Absolute%20Justice'), 'absolute justice');
assert.equal(seriesKeyIn('?q=batman'), null);
assert.equal(seriesKeyIn(new URL(seriesLink('https://x.test', 'x-men 97')).search), 'x men 97');

assert.equal(nameFromKey('absolute justice'), 'Absolute Justice');
assert.equal(nameFromKey('gargoyles 2026'), 'Gargoyles 2026');

// Kept on the device for a day, asked once.
const store = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const s = store();
keepPending('absolute justice', s, 1_000);
assert.equal(peekPending(s, 2_000), 'absolute justice');
assert.equal(takePending(s, 2_000), 'absolute justice');
assert.equal(takePending(s, 3_000), null);

const old = store();
keepPending('absolute justice', old, 0);
assert.equal(peekPending(old, 25 * 60 * 60 * 1000), null);

// No storage (private window, blocked site data): nothing kept, nothing thrown.
const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
keepPending('absolute justice', broken);
assert.equal(peekPending(broken), null);
assert.equal(takePending(broken), null);

console.log('follow-link ok');
