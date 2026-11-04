// node tools/backup-shops.test.mjs
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import fs from 'node:fs';
import { backupKeys, backupShops, backupBucket, LIFECYCLE } from './backup-shops.mjs';

// The script writes to the bucket the Worker reads (wrangler.jsonc's BACKUPS binding).
assert.equal(backupBucket(fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')), 'pullwise-backups');
assert.throws(() => backupBucket('{}'), /BACKUPS R2 bucket/);

// Where files go: daily always, monthly on the 1st as well.
assert.deepEqual(backupKeys('demo', new Date('2026-11-04T08:00:00Z')), ['daily/demo/shop-backup-2026-11-04.json.gz']);
assert.deepEqual(backupKeys('demo', new Date('2026-12-01T08:00:00Z')), ['daily/demo/shop-backup-2026-12-01.json.gz', 'monthly/demo/shop-backup-2026-12-01.json.gz']);
// R2 cleans up each prefix on its own; daily outlasts a month so the 1st is never the only copy.
assert.deepEqual(LIFECYCLE.rules.map((r) => [r.conditions.prefix, r.deleteObjectsTransition.condition.maxAge / 86400]), [['daily/', 35], ['monthly/', 400]]);

// A fake shop database: backup_meta / backup_page, and the job log.
function fakeShop(id, { broken = false } = {}) {
  const logged = [];
  return {
    logged,
    sb: {
      rpc: async (fn, args) => {
        if (broken) return { data: null, error: { message: 'Only an owner can back up the data.' } };
        if (fn === 'backup_meta') return { data: { migration: '9', tables: [{ name: 'customers', pk: 'id' }] }, error: null };
        return { data: { count: 2, rows: [{ id: 1, shop: id }, { id: 2, shop: id }] }, error: null };
      },
      from: () => ({ insert: async (row) => (logged.push(row), { error: null }) }),
    },
  };
}

const shops = { a: fakeShop('a'), b: fakeShop('b', { broken: true }), c: fakeShop('c') };
const stored = {};
const results = await backupShops([{ id: 'a' }, { id: 'b' }, { id: 'c' }], {
  clientFor: async (s) => shops[s.id].sb,
  store: async (key, bytes) => { stored[key] = bytes; },
  now: () => new Date('2026-11-04T08:00:00Z'),
  log: () => {},
});

// One failing shop doesn't stop the others.
assert.deepEqual(results.map((r) => [r.shop, r.ok]), [['a', true], ['b', false], ['c', true]]);
assert.deepEqual(Object.keys(stored), ['daily/a/shop-backup-2026-11-04.json.gz', 'daily/c/shop-backup-2026-11-04.json.gz']);

// The stored file is the same gzipped backup Download backup makes, with that shop's rows (customers + sign-in list).
const file = JSON.parse(gunzipSync(stored['daily/c/shop-backup-2026-11-04.json.gz']));
assert.equal(file.format, 'shop-backup-1');
assert.equal(file.migration, '9');
assert.deepEqual(file.tables.customers.rows.map((r) => r.shop), ['c', 'c']);
assert.ok(file.tables.auth_users);

// Each shop's job log: a success counts as a backup (clears the Dashboard reminder); a failure is logged as not ok.
assert.equal(shops.a.logged[0].job, 'backup');
assert.equal(shops.a.logged[0].ok, true);
assert.match(shops.a.logged[0].message, /^Automatic nightly backup: 4 rows in 2 tables/);
assert.deepEqual([shops.b.logged[0].job, shops.b.logged[0].ok], ['backup', false]);
assert.match(shops.b.logged[0].message, /Automatic nightly backup failed/);

console.log('backup-shops tests passed');
