// PUT /__media?path=covers/lunar/ABC-1f2e.jpg  — stores a cover or series image in the shared R2 bucket (binding
// MEDIA) for shops marked "media": "r2" in shops.json, and answers { url } on the public images domain
// (MEDIA_PUBLIC_URL). Only the shop's signed-in staff can upload: the caller's Supabase token must pass that
// shop's is_staff(). Objects are stored under the shop's id, so shops never overwrite each other's files.

import { mediaPath, mediaUrl, mediaKey, storagePath, STORAGE_BUCKET } from './shop-page.js';

const MAX_BYTES = 10 * 1024 * 1024;
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function mediaUpload(request, shop, env, fetchFn = fetch) {
  if (request.method !== 'PUT') return json(405, { error: 'PUT only' });
  if (shop.media !== 'r2' || !env.MEDIA || !env.MEDIA_PUBLIC_URL) return json(404, { error: 'This shop keeps its images in its own storage.' });
  const type = (request.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  const path = mediaPath(new URL(request.url).searchParams.get('path'), type);
  if (!path) return json(400, { error: 'Not an image path this can store.' });

  const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Sign in again.' });
  const check = await fetchFn(`${shop.supabaseUrl}/rest/v1/rpc/is_staff`, {
    method: 'POST',
    headers: { apikey: shop.anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
  }).catch(() => null);
  if (!check?.ok || (await check.json().catch(() => false)) !== true) return json(403, { error: 'Only staff can upload images.' });

  const body = await request.arrayBuffer();
  if (!body.byteLength) return json(400, { error: 'The image is empty.' });
  if (body.byteLength > MAX_BYTES) return json(413, { error: 'That image is too large (10 MB at most).' });
  const seconds = Number((request.headers.get('X-Cache-Control') ?? '').match(/^\d{1,8}$/)?.[0] ?? 604800);
  await env.MEDIA.put(`${shop.id}/${path}`, body, { httpMetadata: { contentType: type, cacheControl: `public, max-age=${seconds}` } });
  return json(200, { url: mediaUrl(env.MEDIA_PUBLIC_URL, shop, path) });
}

// GET /__img/<shop id>/covers/… on any shop's own domain: the same R2 objects as MEDIA_PUBLIC_URL, so mail sent from a
// shop's domain can load its pictures from that domain. No Cloudflare setup per shop: the domain already points here.
export async function mediaServe(request, env) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('GET only', { status: 405, headers: { Allow: 'GET, HEAD' } });
  const key = env.MEDIA ? mediaKey(new URL(request.url).pathname) : null;
  const object = key ? await env.MEDIA.get(key) : null;
  if (!object) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'public, max-age=60' } });
  const headers = new Headers({
    'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
    'Cache-Control': object.httpMetadata?.cacheControl ?? 'public, max-age=604800',
    'X-Content-Type-Options': 'nosniff',
  });
  if (object.httpEtag) headers.set('ETag', object.httpEtag);
  return new Response(request.method === 'HEAD' ? null : object.body, { headers });
}

// GET /__email-logo on a shop's own domain: the logo for its emails (Admin → Emails' logo, else the site logo), so mail
// loads it from the shop's domain instead of supabase.co. Only the image the shop's staff set is fetched, never an address
// from the request. A small copy (96px) when it sits in Supabase Storage, like the email always asked for.
//
// Kept in Cloudflare's cache, so a weekly send (one request per recipient, plus mail apps' image proxies) doesn't fetch it from
// Supabase each time. The cache entry is keyed on the logo's source address, not just this URL: when staff change the logo the
// source changes, so the new one is served at once (the browser's own copy lasts the hour in Cache-Control).
export async function emailLogo(request, settings, { fetchFn = fetch, cache = globalThis.caches?.default, waitUntil = () => {} } = {}) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('GET only', { status: 405, headers: { Allow: 'GET, HEAD' } });
  const url = emailLogoSource(settings);
  if (!url) return logoNotFound();

  const key = new Request(`${new URL(request.url).origin}${EMAIL_LOGO_CACHE_PATH}?src=${encodeURIComponent(url)}`);
  const hit = await cache?.match(key).catch(() => null);
  if (hit) return request.method === 'HEAD' ? new Response(null, { status: hit.status, headers: hit.headers }) : hit;

  const res = await fetchFn(url, { redirect: 'manual', signal: AbortSignal.timeout(5000) }).catch(() => null);
  const type = (res?.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  const size = Number(res?.headers.get('Content-Length') ?? 0);
  if (!res?.ok || !/^image\/(png|jpeg|gif|webp)$/.test(type) || size > MAX_LOGO_BYTES) return logoNotFound();

  const headers = { 'Content-Type': type, 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' };
  const out = new Response(res.body, { headers });
  if (cache) waitUntil(cache.put(key, out.clone()).catch(() => {}));
  return request.method === 'HEAD' ? new Response(null, { headers }) : out;
}
// Only a missing logo is remembered by the browser (a minute); a failure to fetch one isn't kept anywhere.
const logoNotFound = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'public, max-age=60' } });
// The cache's own address for the logo: it never gets a request, it is only a key (the entry's source is in its query).
const EMAIL_LOGO_CACHE_PATH = '/__email-logo-cache';
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

/** The https address of the shop's email logo, as a small copy when Supabase Storage can resize it; null when it has none. */
export function emailLogoSource(settings = {}) {
  const url = settings.email_logo_url || settings.logo_url;
  if (!/^https:\/\//.test(url ?? '')) return null;
  return url.includes('/storage/v1/object/public/') ? `${url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/')}?width=96&height=96&resize=contain` : url;
}

// GET /__sb/covers/… on a shop's own domain: a cover kept in that shop's own Supabase Storage (titles the shop imported itself),
// so mail sent from the shop's domain can show it without linking to supabase.co. The same stored file, not a resized copy
// (importing already makes a small "-sm" copy beside every cover). Only covers/ and series/ pictures of this shop's own project:
// the address is built from the shop's Supabase URL and a path that passed mediaPath, so nothing in the request picks the host
// or reaches another folder. Files have a content fingerprint in their name, so they're kept in Cloudflare's cache for a week.
const MAX_COVER_BYTES = 5 * 1024 * 1024;
const COVER_TYPES = /^image\/(jpeg|png|webp|gif)$/;
const notFound = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'public, max-age=60' } });

export async function mediaFromStorage(request, shop, { fetchFn = fetch, cache = globalThis.caches?.default, waitUntil = () => {} } = {}) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('GET only', { status: 405, headers: { Allow: 'GET, HEAD' } });
  const path = storagePath(new URL(request.url).pathname);
  if (!path) return notFound();

  const key = new Request(request.url, { method: 'GET' });
  const hit = await cache?.match(key).catch(() => null);
  if (hit) return request.method === 'HEAD' ? new Response(null, { status: hit.status, headers: hit.headers }) : hit;

  const res = await fetchFn(`${shop.supabaseUrl}/storage/v1/object/public/${STORAGE_BUCKET}/${path}`, { redirect: 'manual', signal: AbortSignal.timeout(5000) }).catch(() => null);
  const type = (res?.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  if (!res?.ok || !COVER_TYPES.test(type) || Number(res.headers.get('Content-Length') ?? 0) > MAX_COVER_BYTES) return notFound();

  const headers = { 'Content-Type': type, 'Cache-Control': 'public, max-age=604800', 'X-Content-Type-Options': 'nosniff' };
  const out = new Response(res.body, { headers });
  if (cache) waitUntil(cache.put(key, out.clone()).catch(() => {}));
  return request.method === 'HEAD' ? new Response(null, { headers }) : out;
}
