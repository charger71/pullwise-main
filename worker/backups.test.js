// node worker/backups.test.js
import assert from 'node:assert/strict';
import { backupFiles, backupKey } from './backups.js';

// Keys: only this shop's daily/monthly backup files.
assert.deepEqual(backupKey('daily/demo/shop-backup-2026-11-04.json.gz', 'demo'), { key: 'daily/demo/shop-backup-2026-11-04.json.gz', kind: 'daily', date: '2026-11-04' });
assert.equal(backupKey('monthly/demo/shop-backup-2026-11-01.json.gz', 'demo').kind, 'monthly');
for (const k of ['daily/demo2/shop-backup-2026-11-04.json.gz', 'daily/demo/../demo2/shop-backup-2026-11-04.json.gz', 'daily/demo/x.json.gz',
  'weekly/demo/shop-backup-2026-11-04.json.gz', 'demo/covers/a.jpg', '', null]) {
  assert.equal(backupKey(k, 'demo'), null, String(k));
}

// A fake bucket holding two shops' files, listed in pages.
const objects = {
  'daily/demo/shop-backup-2026-11-03.json.gz': 1000, 'daily/demo/shop-backup-2026-11-04.json.gz': 1100,
  'monthly/demo/shop-backup-2026-11-01.json.gz': 900, 'daily/demo/shop-backup-2026-11-01.json.gz': 900,
  'daily/demo2/shop-backup-2026-11-04.json.gz': 5000, 'daily/demo/stray.txt': 1,
};
const listed = [];
const BACKUPS = {
  list: async ({ prefix, cursor }) => {
    listed.push(prefix);
    const keys = Object.keys(objects).filter((k) => k.startsWith(prefix)).sort();
    const start = Number(cursor ?? 0);
    const page = keys.slice(start, start + 2);
    return { objects: page.map((key) => ({ key, size: objects[key] })), truncated: start + 2 < keys.length, cursor: String(start + 2) };
  },
  get: async (key) => (key in objects ? { body: new Uint8Array(objects[key]), size: objects[key] } : null),
};
const env = { BACKUPS };
const shop = { id: 'demo', supabaseUrl: 'https://abc.supabase.co', anonKey: 'anon' };
const ownerCheck = (isOwner) => async (url, init) => {
  assert.equal(url, 'https://abc.supabase.co/rest/v1/rpc/is_owner');
  assert.equal(init.headers.apikey, 'anon');
  return new Response(JSON.stringify(init.headers.Authorization === 'Bearer good' ? isOwner : false));
};
const req = (query = '', { token = 'good', method = 'GET' } = {}) => new Request(`https://demo.x.com/__backups${query}`, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });
const call = (r, { e = env, owner = true } = {}) => backupFiles(r, shop, e, ownerCheck(owner));

// The list: this shop only, newest first, the 1st's daily and monthly copies both shown, across pages.
let res = await call(req());
assert.equal(res.status, 200);
assert.equal(res.headers.get('Cache-Control'), 'no-store');
assert.deepEqual((await res.json()).files.map((f) => [f.kind, f.date, f.size]), [
  ['daily', '2026-11-04', 1100], ['daily', '2026-11-03', 1000], ['daily', '2026-11-01', 900], ['monthly', '2026-11-01', 900]]);
assert.deepEqual([...new Set(listed)], ['daily/demo/', 'monthly/demo/']);

// A download.
res = await call(req('?file=' + encodeURIComponent('daily/demo/shop-backup-2026-11-04.json.gz')));
assert.equal(res.status, 200);
assert.equal(res.headers.get('Content-Disposition'), 'attachment; filename="shop-backup-2026-11-04.json.gz"');
assert.equal((await res.arrayBuffer()).byteLength, 1100);

// Refusals.
assert.equal((await call(req('?file=' + encodeURIComponent('daily/demo2/shop-backup-2026-11-04.json.gz')))).status, 400, 'another shop’s file');
assert.equal((await call(req('?file=' + encodeURIComponent('daily/demo/shop-backup-2026-10-01.json.gz')))).status, 404, 'expired');
assert.equal((await call(req('', { token: '' }))).status, 401);
assert.equal((await call(req('', { token: 'stolen' }))).status, 403);
assert.equal((await call(req(), { owner: false })).status, 403, 'staff but not an owner');
assert.equal((await call(req('', { method: 'POST' }))).status, 405);
assert.equal((await call(req(), { e: {} })).status, 404, 'no bucket bound (preview builds, local)');

console.log('backups endpoint tests passed');
