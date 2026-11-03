// PRH title updates: looks the master catalog's PRH titles up in the Penguin Random House API, fills in
// descriptions and creators the sheets don't carry, and keeps dates and retail prices current between imports.
// Shops get the changes through catalog-sync.
//
//   POST  x-cron-secret: <CRON_SECRET>      the hourly tick (public.prh_sync_tick)
//
// Secrets: CRON_SECRET; PRH_API_KEY (set on the catalog only; without it this does nothing, so every other shop
// skips it). What changes on a title is in rules.js; which titles are looked up, and how often, in
// public.prh_sync_batch() (20270220000000_prh_sync.sql).
// Deploy with:  supabase functions deploy prh-sync --no-verify-jwt   (supabase/config.toml has it)

import { createClient } from 'npm:@supabase/supabase-js@2';
import { lookup, changes, summary } from './rules.js';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const BATCH = 200;
const PARALLEL = 4; // gentle on PRH's API
const BUDGET_MS = 100_000;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return json(401, { error: 'Not allowed' });
  const key = Deno.env.get('PRH_API_KEY');
  if (!key) return json(200, { skipped: 'no PRH_API_KEY' });

  const { data: items, error } = await db.rpc('prh_sync_batch', { p_limit: BATCH });
  if (error) return json(500, { error: error.message });

  const started = Date.now();
  const totals = { checked: 0, updated: 0, notFound: 0, failed: 0, descriptions: 0 };
  const errors: string[] = [];
  // PRH's replies echo the key in their links, so error text never includes a URL or a reply body.
  const fetchJson = async (url: string) => {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    return { status: res.status, body: res.status === 200 ? await res.json() : (await res.body?.cancel(), null) };
  };

  let next = 0;
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    while (next < items.length && Date.now() - started < BUDGET_MS) {
      const item = items[next++];
      try {
        const found = await lookup(item, key, fetchJson);
        totals.checked++;
        if (!found.found) totals.notFound++;
        else {
          const patch = changes(item, found.record, found.content);
          if (Object.keys(patch).length) {
            const { error: e } = await db.from('items').update(patch).eq('id', item.id);
            if (e) throw new Error(e.message);
            totals.updated++;
            if (patch.description) totals.descriptions++;
          }
        }
        const { error: e } = await db.from('prh_titles').upsert({
          item_id: item.id, checked_at: new Date().toISOString(), found: found.found, domain: found.domain,
          sale_status: found.record?.saleStatus ?? null,
        });
        if (e) throw new Error(e.message);
      } catch (err) {
        totals.failed++;
        // A network error's message can include the request URL, and with it the key.
        if (errors.length < 5) errors.push(`#${item.id}: ${(err as Error).message.replace(/api_key=[^&\s)"']*/g, 'api_key=…')}`);
      }
    }
  }));

  const message = summary(totals);
  if (message) {
    await db.from('job_log').insert({
      job: 'prh_sync', ok: !totals.failed, message: errors.length ? `${message} (${errors.join('; ')})` : message, detail: totals,
    });
  }
  return json(200, { ...totals, left: items.length - next });
});
