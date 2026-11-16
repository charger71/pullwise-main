// GET /__backups               — this shop's backup files (tools/backup-shops.mjs), newest first:
//                                 { files: [{ key, kind: 'daily' | 'monthly' | 'weekly', date, size }] }
//                                 weekly files are the picture archives (.zip, with part/parts when split).
// GET /__backups?file=<key>    — one of those files, as a download.
// Both read the private R2 bucket bound as BACKUPS and only answer the shop's owners: the caller's Supabase token must
// pass that shop's is_owner(). A shop only ever sees keys under its own id.

export const BACKUPS_PATH = '/__backups';
const KEY = /^(?:(daily|monthly)\/([a-z0-9-]+)\/shop-backup-(\d{4}-\d{2}-\d{2})\.json\.gz|(weekly)\/([a-z0-9-]+)\/shop-media-(\d{4}-\d{2}-\d{2})(?:-part(\d{1,3})of(\d{1,3}))?\.zip)$/;
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/** A file key that belongs to this shop, parsed; null for anything else. */
export function backupKey(key, shopId) {
  const m = typeof key === 'string' ? KEY.exec(key) : null;
  if (!m) return null;
  if (m[1]) return m[2] === shopId ? { key, kind: m[1], date: m[3] } : null;
  return m[5] === shopId ? { key, kind: 'weekly', date: m[6], ...(m[7] ? { part: Number(m[7]), parts: Number(m[8]) } : {}) } : null;
}

async function listAll(bucket, prefix) {
  const out = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000 });
    out.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

export async function backupFiles(request, shop, env, fetchFn = fetch) {
  if (request.method !== 'GET') return json(405, { error: 'GET only' });
  if (!env.BACKUPS) return json(404, { error: 'Nightly backups aren’t set up for this site.' });

  const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Sign in again.' });
  const check = await fetchFn(`${shop.supabaseUrl}/rest/v1/rpc/is_owner`, {
    method: 'POST',
    headers: { apikey: shop.anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
  }).catch(() => null);
  if (!check?.ok || (await check.json().catch(() => false)) !== true) return json(403, { error: 'Only an owner can see the backups.' });

  const wanted = new URL(request.url).searchParams.get('file');
  if (wanted != null) {
    const file = backupKey(wanted, shop.id);
    if (!file) return json(400, { error: 'Not one of this shop’s backups.' });
    const obj = await env.BACKUPS.get(file.key);
    if (!obj) return json(404, { error: 'That backup is no longer kept.' });
    return new Response(obj.body, {
      headers: {
        'Content-Type': file.key.endsWith('.zip') ? 'application/zip' : 'application/gzip',
        'Content-Disposition': `attachment; filename="${file.key.split('/').pop()}"`,
        'Content-Length': String(obj.size),
        'Cache-Control': 'no-store',
      },
    });
  }

  const objects = (await Promise.all(['daily', 'monthly', 'weekly'].map((kind) => listAll(env.BACKUPS, `${kind}/${shop.id}/`)))).flat();
  const files = objects
    .map((o) => { const f = backupKey(o.key, shop.id); return f && { ...f, size: o.size }; })
    .filter(Boolean)
    .sort((a, b) => b.date.localeCompare(a.date) || a.kind.localeCompare(b.kind) || (a.part ?? 0) - (b.part ?? 0));
  return json(200, { files });
}
