// node worker/media.test.js
import assert from 'node:assert/strict';
import { mediaUpload, mediaServe, mediaFromStorage, emailLogo, emailLogoSource } from './media.js';
import { mediaPath, mediaUrl, mediaKey, storagePath, ownDomainImage, configJs } from './shop-page.js';
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

// Shop-domain copies: same R2 objects, served from /__img/ on any shop domain
assert.equal(ownDomainImage('https://images.x.com/catalog/covers/a.jpg', 'https://images.x.com/', 'https://shop.com/'), 'https://shop.com/__img/catalog/covers/a.jpg');
assert.equal(ownDomainImage('https://abc.supabase.co/logo.png', 'https://images.x.com', 'https://shop.com'), 'https://abc.supabase.co/logo.png');
assert.equal(ownDomainImage('https://images.x.com.evil.io/a.jpg', 'https://images.x.com', 'https://shop.com'), 'https://images.x.com.evil.io/a.jpg');
assert.equal(ownDomainImage('https://images.x.com/a.jpg', '', 'https://shop.com'), 'https://images.x.com/a.jpg');
assert.equal(mediaKey('/__img/catalog/covers/lunar/A-1.jpg'), 'catalog/covers/lunar/A-1.jpg');
for (const p of ['/__img/catalog/brand/a.jpg', '/__img/catalog/covers/../a.jpg', '/__img/covers/a.jpg', '/__img/catalog/covers/a.svg', '/__img/CAT/covers/a.jpg', '/other/catalog/covers/a.jpg']) assert.equal(mediaKey(p), null, p);

const bucket = { get: async (key) => (stored.has(key) ? { body: 'bytes', httpEtag: '"e1"', httpMetadata: { contentType: 'image/jpeg', cacheControl: 'public, max-age=3600' } } : null) };
let served = await mediaServe(new Request('https://shop.com/__img/catalog/covers/lunar/A-1.jpg'), { MEDIA: bucket });
assert.equal(served.status, 200);
assert.equal(served.headers.get('Content-Type'), 'image/jpeg');
assert.equal(served.headers.get('Cache-Control'), 'public, max-age=3600');
assert.equal(await served.text(), 'bytes');
assert.equal((await mediaServe(new Request('https://shop.com/__img/catalog/covers/lunar/A-1.jpg', { method: 'HEAD' }), { MEDIA: bucket })).status, 200);
assert.equal((await mediaServe(new Request('https://shop.com/__img/catalog/covers/none.jpg'), { MEDIA: bucket })).status, 404);
assert.equal((await mediaServe(new Request('https://shop.com/__img/catalog/brand/x.jpg'), { MEDIA: bucket })).status, 404);
assert.equal((await mediaServe(new Request('https://shop.com/__img/catalog/covers/lunar/A-1.jpg'), {})).status, 404);
assert.equal((await mediaServe(new Request('https://shop.com/__img/catalog/covers/lunar/A-1.jpg', { method: 'PUT', body: 'x' }), { MEDIA: bucket })).status, 405);

// Email logo on the shop's domain
const SUPA = 'https://x.supabase.co/storage/v1/object/public/media/brand/logo.png';
assert.equal(emailLogoSource({ logo_url: SUPA }), 'https://x.supabase.co/storage/v1/render/image/public/media/brand/logo.png?width=96&height=96&resize=contain');
assert.equal(emailLogoSource({ logo_url: SUPA, email_logo_url: 'https://e.com/l.png' }), 'https://e.com/l.png');
assert.equal(emailLogoSource({ logo_url: 'http://insecure/l.png' }), null);
assert.equal(emailLogoSource({}), null);
const img = (type = 'image/png', status = 200, extra = {}) => async (url, init) => { assert.equal(init.redirect, 'manual'); return new Response('png', { status, headers: { 'Content-Type': type, ...extra } }); };
const logoReq = (method = 'GET') => new Request('https://shop.com/__email-logo', { method });
let logo = await emailLogo(logoReq(), { logo_url: SUPA }, { fetchFn: img() });
assert.equal(logo.status, 200);
assert.equal(logo.headers.get('Content-Type'), 'image/png');
assert.equal(await logo.text(), 'png');
assert.equal((await emailLogo(logoReq(), {}, { fetchFn: img() })).status, 404);                                  // no logo set
assert.equal((await emailLogo(logoReq(), { logo_url: SUPA }, { fetchFn: img('text/html') })).status, 404);       // not an image
assert.equal((await emailLogo(logoReq(), { logo_url: SUPA }, { fetchFn: img('image/svg+xml') })).status, 404);   // no SVG (can carry script)
assert.equal((await emailLogo(logoReq(), { logo_url: SUPA }, { fetchFn: img('image/png', 302) })).status, 404);  // redirects aren't followed
assert.equal((await emailLogo(logoReq(), { logo_url: SUPA }, { fetchFn: img('image/png', 200, { 'Content-Length': '99999999' }) })).status, 404);
assert.equal((await emailLogo(logoReq(), { logo_url: SUPA }, { fetchFn: async () => { throw new Error('down'); } })).status, 404);
assert.equal((await emailLogo(logoReq('POST'), { logo_url: SUPA }, { fetchFn: img() })).status, 405);

// Malformed %-escapes are a 404, not a crash
assert.equal(mediaKey('/__img/catalog/covers/%E0%A4%A.jpg'), null);
assert.equal(storagePath('/__sb/covers/%E0%A4%A.jpg'), null);
assert.equal((await mediaServe(new Request('https://shop.com/__img/catalog/covers/%E0%A4%A.jpg'), { MEDIA: bucket })).status, 404);

// Covers in the shop's own Supabase Storage on its domain (/__sb/)
assert.equal(storagePath('/__sb/covers/lunar/ABC-1f2e.jpg'), 'covers/lunar/ABC-1f2e.jpg');
assert.equal(storagePath('/__sb/covers/lunar/ABC-1f2e-sm.webp'), 'covers/lunar/ABC-1f2e-sm.webp');
assert.equal(storagePath('/__sb/series/k1-saga.png'), 'series/k1-saga.png');
for (const p of ['/__sb/library/a.jpg', '/__sb/brand/logo.png', '/__sb/covers/../library/a.jpg', '/__sb/covers/%2e%2e/a.jpg', '/__sb/covers/a.svg', '/__sb/covers/.hidden.jpg', '/__sb/covers//a.jpg', '/__sb/covers', '/__sb/', '/__img/covers/a.jpg', '/__sb/covers/a b.jpg']) assert.equal(storagePath(p), null, p);

const sbShop = { id: 'a', supabaseUrl: 'https://abc.supabase.co' };
const sbFetched = [];
const sbUpstream = (type = 'image/jpeg', status = 200, extra = {}) => async (url, init) => { sbFetched.push({ url: String(url), init }); return new Response('jpgbytes', { status, headers: { 'Content-Type': type, ...extra } }); };
const memoryCache = () => { const m = new Map(); return { m, match: async (r) => m.get(r.url)?.clone(), put: async (r, res) => { m.set(r.url, res); } }; };
const sbReq = (path, method = 'GET') => new Request(`https://shop.com/__sb/${path}`, { method });
const waited = [];
let cache = memoryCache();
let cover = await mediaFromStorage(sbReq('covers/lunar/A-1.jpg'), sbShop, { fetchFn: sbUpstream(), cache, waitUntil: (p) => waited.push(p) });
assert.equal(cover.status, 200);
assert.equal(sbFetched.at(-1).url, 'https://abc.supabase.co/storage/v1/object/public/media/covers/lunar/A-1.jpg');
assert.equal(sbFetched.at(-1).init.redirect, 'manual');
assert.equal(cover.headers.get('Content-Type'), 'image/jpeg');
assert.equal(cover.headers.get('Cache-Control'), 'public, max-age=604800');
assert.equal(cover.headers.get('X-Content-Type-Options'), 'nosniff');
assert.equal(await cover.text(), 'jpgbytes');
await Promise.all(waited);
assert.equal(cache.m.size, 1, 'kept in the cache');
// The second request is answered from the cache, not Supabase
const fetchesBefore = sbFetched.length;
cover = await mediaFromStorage(sbReq('covers/lunar/A-1.jpg'), sbShop, { fetchFn: sbUpstream(), cache, waitUntil: (p) => waited.push(p) });
assert.equal(await cover.text(), 'jpgbytes');
assert.equal(sbFetched.length, fetchesBefore);
// HEAD: headers only
cover = await mediaFromStorage(sbReq('covers/lunar/B-2.jpg', 'HEAD'), sbShop, { fetchFn: sbUpstream('image/png'), cache: memoryCache() });
assert.equal(cover.status, 200);
assert.equal(cover.headers.get('Content-Type'), 'image/png');
assert.equal(await cover.text(), '');
// Refused: other folders and hosts never reach Supabase; wrong types, big files, redirects, errors and outages are a 404
const sbBefore = sbFetched.length;
for (const p of ['library/a.jpg', 'covers/../library/a.jpg', 'covers/a.svg', 'brand/logo.png']) assert.equal((await mediaFromStorage(sbReq(p), sbShop, { fetchFn: sbUpstream(), cache: memoryCache() })).status, 404, p);
assert.equal(sbFetched.length, sbBefore, 'none of those reached Supabase');
const fresh = () => ({ cache: memoryCache() });
assert.equal((await mediaFromStorage(sbReq('covers/a.jpg'), sbShop, { fetchFn: sbUpstream('text/html'), ...fresh() })).status, 404);
assert.equal((await mediaFromStorage(sbReq('covers/a.jpg'), sbShop, { fetchFn: sbUpstream('image/svg+xml'), ...fresh() })).status, 404);
assert.equal((await mediaFromStorage(sbReq('covers/a.jpg'), sbShop, { fetchFn: sbUpstream('image/jpeg', 200, { 'Content-Length': '99999999' }), ...fresh() })).status, 404);
assert.equal((await mediaFromStorage(sbReq('covers/a.jpg'), sbShop, { fetchFn: sbUpstream('image/jpeg', 302), ...fresh() })).status, 404);
assert.equal((await mediaFromStorage(sbReq('covers/a.jpg'), sbShop, { fetchFn: sbUpstream('image/jpeg', 404), ...fresh() })).status, 404);
assert.equal((await mediaFromStorage(sbReq('covers/a.jpg'), sbShop, { fetchFn: async () => { throw new Error('down'); }, ...fresh() })).status, 404);
assert.equal((await mediaFromStorage(sbReq('covers/a.jpg', 'PUT'), sbShop, { fetchFn: sbUpstream(), ...fresh() })).status, 405);
// Works without a cache too
assert.equal((await mediaFromStorage(sbReq('covers/a.jpg'), sbShop, { fetchFn: sbUpstream(), cache: null })).status, 200);

// The email logo is kept in the cache, keyed on its source address
{
  const cache = memoryCache();
  const pending = [];
  const calls = [];
  const logoFetch = (type = 'image/png') => async (url) => { calls.push(String(url)); return new Response('png', { status: 200, headers: { 'Content-Type': type } }); };
  const run = (settings, opts = {}) => emailLogo(new Request('https://shop.com/__email-logo', { method: opts.method ?? 'GET' }), settings, { fetchFn: logoFetch(), cache, waitUntil: (p) => pending.push(p), ...opts });

  let res = await run({ logo_url: SUPA });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'png');
  await Promise.all(pending);
  assert.equal(cache.m.size, 1, 'stored');
  assert.equal(res.headers.get('Cache-Control'), 'public, max-age=3600');
  // The next ones come from the cache: Supabase isn't asked again
  for (let i = 0; i < 3; i++) { res = await run({ logo_url: SUPA }); assert.equal(await res.text(), 'png'); assert.equal(res.headers.get('Content-Type'), 'image/png'); }
  assert.equal(calls.length, 1, 'one fetch for four requests');
  res = await run({ logo_url: SUPA }, { method: 'HEAD' });
  assert.equal(res.status, 200); assert.equal(await res.text(), '');
  assert.equal(calls.length, 1);
  // Staff change the logo: the source changes, so the new one is fetched at once
  res = await run({ logo_url: SUPA, email_logo_url: 'https://e.com/new.png' });
  assert.equal(res.status, 200);
  assert.deepEqual(calls.slice(1), ['https://e.com/new.png']);
  await Promise.all(pending);
  assert.equal(cache.m.size, 2);
  // The old logo's entry doesn't answer for the new one, and the new one now comes from the cache
  await run({ logo_url: SUPA, email_logo_url: 'https://e.com/new.png' });
  assert.equal(calls.length, 2);
  // Another shop's domain has its own entries
  await emailLogo(new Request('https://other.com/__email-logo'), { logo_url: SUPA }, { fetchFn: logoFetch(), cache, waitUntil: (p) => pending.push(p) });
  assert.equal(calls.length, 3);

  // A failure isn't kept: the next request tries again
  const failCache = memoryCache();
  const failing = (fetchFn) => emailLogo(logoReq(), { logo_url: SUPA }, { fetchFn, cache: failCache, waitUntil: (p) => pending.push(p) });
  assert.equal((await failing(async () => { throw new Error('down'); })).status, 404);
  assert.equal((await failing(img('text/html'))).status, 404);
  await Promise.all(pending);
  assert.equal(failCache.m.size, 0, 'nothing stored for failures');
  assert.equal((await failing(img())).status, 200);
  // No logo set: nothing fetched, nothing stored
  const before = calls.length;
  assert.equal((await run({})).status, 404);
  assert.equal(calls.length, before);
  // A cache that errors never breaks the logo
  const broken = { match: async () => { throw new Error('cache down'); }, put: async () => { throw new Error('cache down'); } };
  assert.equal((await emailLogo(logoReq(), { logo_url: SUPA }, { fetchFn: img(), cache: broken, waitUntil: (p) => pending.push(p) })).status, 200);
  await Promise.all(pending);
}
