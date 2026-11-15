// PUT /__media?path=covers/lunar/ABC-1f2e.jpg  — stores a cover or series image in the shared R2 bucket (binding
// MEDIA) for shops marked "media": "r2" in shops.json, and answers { url } on the public images domain
// (MEDIA_PUBLIC_URL). Only the shop's signed-in staff can upload: the caller's Supabase token must pass that
// shop's is_staff(). Objects are stored under the shop's id, so shops never overwrite each other's files.

import { mediaPath, mediaUrl, mediaKey } from './shop-page.js';

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
  const key = env.MEDIA ? mediaKey(decodeURIComponent(new URL(request.url).pathname)) : null;
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
export async function emailLogo(request, settings, fetchFn = fetch) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('GET only', { status: 405, headers: { Allow: 'GET, HEAD' } });
  const url = emailLogoSource(settings);
  const res = url ? await fetchFn(url, { redirect: 'manual', signal: AbortSignal.timeout(5000) }).catch(() => null) : null;
  const type = (res?.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  const size = Number(res?.headers.get('Content-Length') ?? 0);
  if (!res?.ok || !/^image\/(png|jpeg|gif|webp)$/.test(type) || size > MAX_LOGO_BYTES) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'public, max-age=60' } });
  return new Response(request.method === 'HEAD' ? null : res.body, { headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
}
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

/** The https address of the shop's email logo, as a small copy when Supabase Storage can resize it; null when it has none. */
export function emailLogoSource(settings = {}) {
  const url = settings.email_logo_url || settings.logo_url;
  if (!/^https:\/\//.test(url ?? '')) return null;
  return url.includes('/storage/v1/object/public/') ? `${url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/')}?width=96&height=96&resize=contain` : url;
}
