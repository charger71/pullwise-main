// Where an uploaded picture is stored. Covers and series images of shops using the shared R2 bucket
// ("media": "r2" in shops.json, so config.js has MEDIA_UPLOAD_URL) go through the site Worker (worker/media.js);
// everything else goes to the shop's own Supabase storage, as before. Returns the picture's public address.

import { MEDIA_UPLOAD_URL } from './config.js';
import { must } from './util.js';

const R2_FOLDERS = /^(covers|series)\//;

/** Does a picture at this path go to R2 on this site? */
export const storesInR2 = (path, uploadUrl = MEDIA_UPLOAD_URL) => Boolean(uploadUrl) && R2_FOLDERS.test(path);

/**
 * @param sb  Supabase client (for the staff member's sign-in, or Supabase storage)
 * @param path  e.g. "covers/lunar/ABC-1f2e.jpg"
 * @param body  Blob or bytes
 * @param opts  { contentType, cacheControl (seconds, as a string), upsert }
 */
export async function putMedia(sb, path, body, { contentType, cacheControl = '604800', upsert = false } = {}, uploadUrl = MEDIA_UPLOAD_URL, fetchFn = fetch) {
  if (storesInR2(path, uploadUrl)) {
    const { data } = await sb.auth.getSession();
    const res = await fetchFn(`${uploadUrl}?path=${encodeURIComponent(path)}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${data?.session?.access_token ?? ''}`, 'Content-Type': contentType, 'X-Cache-Control': String(cacheControl) },
      body,
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !out.url) throw new Error(out.error ?? `The image didn’t upload (${res.status}).`);
    return out.url;
  }
  await must(sb.storage.from('media').upload(path, body, { contentType, cacheControl: String(cacheControl), upsert }));
  return sb.storage.from('media').getPublicUrl(path).data.publicUrl;
}
