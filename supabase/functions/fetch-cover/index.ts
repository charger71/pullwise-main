// Fetches a cover image from another site for the admin Import page. Browsers
// can't read images from images.penguinrandomhouse.com or funko.com directly
// (no CORS), so the page asks this function, which returns the image bytes; the
// page then uploads them to Storage itself.
//
// POST { "url": "https://images.penguinrandomhouse.com/cover/…" }
//   or { "funkoItem": "95146", "keywords": ["david", "vampire"] }
//
// Staff only (checked with public.is_staff() as the caller), and only these two
// sources — it is not a general-purpose proxy.
//
// Deploy with:  supabase functions deploy fetch-cover

import { createClient } from 'npm:@supabase/supabase-js@2';

const ALLOWED_HOSTS = new Set(['images.penguinrandomhouse.com', 'funko.com', 'media.lunardistribution.com']);
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 15000;
// funko.com rejects requests without a browser user agent.
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

/** Same rule as the command-line importer: item number AND a word from the figure's name. */
async function funkoImageUrl(itemNumber: string, keywords: string[]): Promise<string | null> {
  const res = await fetch(`https://funko.com/search?q=${encodeURIComponent(itemNumber)}`, { headers: { 'user-agent': BROWSER_UA }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }).catch(() => null);
  if (!res?.ok) return null;
  const html = await res.text();
  const urls = [...new Set([...html.matchAll(/https:\/\/funko\.com\/dw\/image\/v2\/[^"'\s?]+/g)].map((m) => m[0]))];
  const match = urls.find((u) => {
    const file = u.split('/').pop()!.toLowerCase();
    return file.startsWith(itemNumber.toLowerCase()) && keywords.some((k) => file.includes(k.toLowerCase()));
  });
  return match ? `${match}?sw=800&sh=800` : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'POST only' });

  // Only staff may use this.
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: isStaff } = await supabase.rpc('is_staff');
  if (isStaff !== true) return json(403, { error: 'Staff only' });

  let body: { url?: string; funkoItem?: string; keywords?: string[] };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'Expected JSON' });
  }

  let target = body.url ?? null;
  if (!target && body.funkoItem) target = await funkoImageUrl(String(body.funkoItem), (body.keywords ?? []).map(String));
  if (!target) return json(404, { error: 'No image found' });

  // Redirects are followed by hand, so every hop (not just the first address) is https on an allowed source.
  let res: Response | null = null;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let at: URL;
    try {
      at = new URL(target);
    } catch {
      return json(400, { error: 'Bad URL' });
    }
    if (at.protocol !== 'https:' || !ALLOWED_HOSTS.has(at.host)) return json(400, { error: `Not an allowed image source: ${at.host}` });
    res = await fetch(at, { headers: { 'user-agent': BROWSER_UA }, redirect: 'manual', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }).catch(() => null);
    if (!res) return json(502, { error: 'The source didn’t answer' });
    const next = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!next) break;
    await res.body?.cancel();
    target = new URL(next, at).href;
    res = null;
  }
  if (!res) return json(502, { error: 'Too many redirects' });
  if (!res.ok) return json(502, { error: `Source returned HTTP ${res.status}` });
  const type = res.headers.get('content-type')?.split(';')[0] ?? '';
  if (!type.startsWith('image/')) return json(502, { error: `Not an image (${type})` });
  // The stated size first, so an oversized file isn't downloaded at all; then the real size, in case it wasn't stated.
  if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) {
    await res.body?.cancel();
    return json(413, { error: 'Image too large' });
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_BYTES) return json(413, { error: 'Image too large' });

  return new Response(bytes, { headers: { ...cors, 'Content-Type': type, 'Cache-Control': 'no-store' } });
});
