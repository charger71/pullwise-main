// Master catalog sync: copies new and changed titles from the catalog project into this shop.
//
//   POST  x-cron-secret: <CRON_SECRET>      the hourly tick (public.catalog_sync_tick)
//
// Secrets: CRON_SECRET; CATALOG_URL and CATALOG_ANON_KEY (set by the deploy for every shop except the catalog
// itself; without them this does nothing). Reads the catalog's public titles with its anon key, so it can never
// change the catalog. The rules for what changes in the shop are in public.catalog_apply().
// Deploy with:  supabase functions deploy catalog-sync --no-verify-jwt   (supabase/config.toml has it)

import { createClient } from 'npm:@supabase/supabase-js@2';
import { runSync, summary } from './sync.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const db = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return json(401, { error: 'Not allowed' });

  const catalogUrl = Deno.env.get('CATALOG_URL')?.replace(/\/+$/, '');
  const catalogKey = Deno.env.get('CATALOG_ANON_KEY');
  if (!catalogUrl || !catalogKey) return json(200, { skipped: 'no catalog configured' });
  if (catalogUrl === SUPABASE_URL.replace(/\/+$/, '')) return json(200, { skipped: 'this is the catalog' });

  const { data: state, error: stateError } = await db.from('catalog_sync_state').select('cursor_at,cursor_id').eq('id', 1).single();
  if (stateError) return json(500, { error: stateError.message });
  const now = new Date().toISOString();

  try {
    const totals = await runSync({ catalogUrl, cursor: { at: state.cursor_at, id: state.cursor_id } }, {
      now: () => Date.now(),
      fetchPage: async (url: string) => {
        const res = await fetch(url, { headers: { apikey: catalogKey, Authorization: `Bearer ${catalogKey}` } });
        if (!res.ok) throw new Error(`catalog answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return res.json();
      },
      apply: async (rows: unknown[]) => {
        const { data, error } = await db.rpc('catalog_apply', { p_rows: rows });
        if (error) throw new Error(error.message);
        return data;
      },
      saveCursor: async ({ at, id }: { at: string; id: number }) => {
        const { error } = await db.from('catalog_sync_state').update({ cursor_at: at, cursor_id: id }).eq('id', 1);
        if (error) throw new Error(error.message);
      },
    });
    await db.from('catalog_sync_state').update({
      last_run_at: now, last_ok_at: now, last_error: totals.error, last_inserted: totals.inserted, last_updated: totals.updated,
    }).eq('id', 1);
    const message = summary(totals);
    if (message) await db.from('job_log').insert({ job: 'catalog_sync', ok: !totals.failed, message, detail: totals });
    return json(200, totals);
  } catch (err) {
    const message = (err as Error).message;
    await db.from('catalog_sync_state').update({ last_run_at: now, last_error: message }).eq('id', 1);
    await db.from('job_log').insert({ job: 'catalog_sync', ok: false, message });
    return json(500, { error: message });
  }
});
