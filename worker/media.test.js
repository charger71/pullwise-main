// node worker/media.test.js
import assert from 'node:assert/strict';
import { mediaUpload } from './media.js';
import { mediaPath, mediaUrl, configJs } from './shop-page.js';
import { putMedia, storesInR2 } from '../js/media-store.js';

// Paths
assert.equal(mediaPath('covers/lunar/ABC-1f2e.jpg', 'image/jpeg'), 'covers/lunar/ABC-1f2e.jpg');
assert.equal(mediaPath('covers/lunar/_123-ab.webp', 'image/webp'), 'covers/lunar/_123-ab.webp');
assert.equal(mediaPath('series/k1-saga.png', 'image/png'), 'series/k1-saga.png');
for (const [p, t] of [['covers/../x.jpg', 'image/jpeg'], ['brand/logo.png', 'image/png'], ['covers/x.png', 'image/jpeg'], ['covers/.x.jpg', 'image/jpeg'],
  ['covers//x.jpg', 'image/jpeg'], ['covers', 'image/jpeg'], ['covers/x.svg', 'image/svg+xml'], [null, 'image/jpeg'], ['covers/a b.jpg', 'image/jpeg']]) {
  assert.equal(mediaPath(p, t), null, `${p} ${t}`);
}
assert.equal(mediaUrl('https://images.x.com/', { id: 'catalog' }, 'covers/a.jpg'), 'https://images.x.com/catalog/covers/a.jpg');

// config.js says where to upload only for R2 shops
const base = { id: 'catalog', domains: ['catalog.x.com'], supabaseUrl: 'https://abc.supabase.co', anonKey: 'anon' };
assert.match(configJs({ ...base, media: 'r2' }), /^export const MEDIA_UPLOAD_URL = "\/__media";$/m);
assert.match(configJs(base), /^export const MEDIA_UPLOAD_URL = "";$/m);

// The endpoint
const stored = new Map();
const env = { MEDIA: { put: async (key, body, opts) => stored.set(key, { size: body.byteLength, ...opts.httpMetadata }) }, MEDIA_PUBLIC_URL: 'https://images.x.com' };
const shop = { ...base, media: 'r2' };
const staffCheck = (isStaff) => async (url, init) => {
  assert.equal(url, 'https://abc.supabase.co/rest/v1/rpc/is_staff');
  assert.equal(init.headers.apikey, 'anon');
  return new Response(JSON.stringify(init.headers.Authorization === 'Bearer good' ? isStaff : false));
};
const req = (path, { method = 'PUT', token = 'good', type = 'image/jpeg', body = new Uint8Array(500), cache } = {}) => new Request(
  `https://catalog.x.com/__media?path=${encodeURIComponent(path)}`,
  { method, body: method === 'PUT' ? body : undefined, headers: { 'Content-Type': type, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cache ? { 'X-Cache-Control': cache } : {}) } });
const call = async (r, s = shop, e = env, staff = true) => { const res = await mediaUpload(r, s, e, staffCheck(staff)); return [res.status, await res.json()]; };

let [status, out] = await call(req('covers/lunar/A-1.jpg', { cache: '3600' }));
assert.equal(status, 200);
assert.equal(out.url, 'https://images.x.com/catalog/covers/lunar/A-1.jpg');
assert.deepEqual(stored.get('catalog/covers/lunar/A-1.jpg'), { size: 500, contentType: 'image/jpeg', cacheControl: 'public, max-age=3600' });
assert.equal((await call(req('covers/lunar/B.jpg', { cache: '1; drop' })))[0], 200);
assert.equal(stored.get('catalog/covers/lunar/B.jpg').cacheControl, 'public, max-age=604800', 'odd cache values fall back');
assert.equal((await call(req('covers/a.jpg', { method: 'POST' })))[0], 405);
assert.equal((await call(req('covers/a.jpg'), base))[0], 404, 'shops not on R2 are refused');
assert.equal((await call(req('covers/a.jpg'), shop, {}))[0], 404, 'no bucket bound');
assert.equal((await call(req('brand/logo.jpg')))[0], 400);
assert.equal((await call(req('covers/a.jpg', { type: 'text/html' })))[0], 400);
assert.equal((await call(req('covers/a.jpg', { token: '' })))[0], 401);
assert.equal((await call(req('covers/a.jpg', { token: 'stolen' })))[0], 403);
assert.equal((await call(req('covers/a.jpg'), shop, env, false))[0], 403, 'signed in but not staff');
assert.equal((await call(req('covers/a.jpg', { body: new Uint8Array(0) })))[0], 400);
assert.equal((await call(req('covers/a.jpg', { body: new Uint8Array(10 * 1024 * 1024 + 1) })))[0], 413);
assert.ok(!stored.has('catalog/covers/a.jpg'), 'nothing stored by refused uploads');

// The browser side
const sb = {
  auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
  storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: (p) => ({ data: { publicUrl: `https://abc.supabase.co/storage/v1/object/public/media/${p}` } }) }) },
};
assert.equal(storesInR2('covers/a.jpg', '/__media'), true);
assert.equal(storesInR2('brand/a.jpg', '/__media'), false);
assert.equal(storesInR2('covers/a.jpg', ''), false);
let sent;
const fakeWorker = async (url, init) => { sent = { url, init }; return new Response(JSON.stringify({ url: 'https://images.x.com/catalog/covers/a.jpg' })); };
assert.equal(await putMedia(sb, 'covers/a.jpg', new Uint8Array(3), { contentType: 'image/jpeg' }, '/__media', fakeWorker), 'https://images.x.com/catalog/covers/a.jpg');
assert.equal(sent.url, '/__media?path=covers%2Fa.jpg');
assert.equal(sent.init.headers.Authorization, 'Bearer tok');
assert.equal(await putMedia(sb, 'brand/logo.png', new Uint8Array(3), { contentType: 'image/png' }, '/__media', fakeWorker), 'https://abc.supabase.co/storage/v1/object/public/media/brand/logo.png', 'logos stay in Supabase');
await assert.rejects(putMedia(sb, 'covers/a.jpg', new Uint8Array(3), { contentType: 'image/jpeg' }, '/__media', async () => new Response(JSON.stringify({ error: 'Only staff can upload images.' }), { status: 403 })), /Only staff/);

console.log('media upload tests passed');
