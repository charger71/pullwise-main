import assert from 'node:assert/strict';
import { jobCadence } from './cron.js';

const H = 3600000;

// The shops' jobs: hourly ones, and the nightly pull list import cleanup.
assert.deepEqual(jobCadence('30 * * * *'), { every: 'every hour', staleMs: 2.5 * H });
assert.deepEqual(jobCadence('0 * * * *'), { every: 'every hour', staleMs: 2.5 * H });
assert.deepEqual(jobCadence('40 3 * * *'), { every: 'every night', staleMs: 26 * H });

// A weekly job; anything else isn't flagged before a day has passed.
assert.deepEqual(jobCadence('0 9 * * 1'), { every: 'every week', staleMs: 8 * 24 * H });
assert.equal(jobCadence('*/5 * * * *').staleMs, 26 * H);
assert.equal(jobCadence('').staleMs, 26 * H);
assert.equal(jobCadence(undefined).staleMs, 26 * H);

console.log('cron tests passed');
