// Master catalog sync: copies new and changed titles, and the Series and Artists lists, from the catalog project
// into this shop.
//
//   POST  x-cron-secret: <CRON_SECRET>      the hourly tick (public.catalog_sync_tick)
//
// Secrets: CRON_SECRET; CATALOG_URL and CATALOG_ANON_KEY (set by the deploy for every shop except the catalog
// itself; without them this does nothing). Reads the catalog's public titles and lists with its anon key, so it can
// never change the catalog. The rules for what changes in the shop are in public.catalog_apply() (titles) and
// catalog_apply_series / _series_merges / _artists / _artist_renames (20270204000000_catalog_sync_lists.sql).
// Deploy with:  supabase functions deploy catalog-sync --no-verify-jwt   (supabase/config.toml has it)

import { createClient } from 'npm:@supabase/supabase-js@2';
import { runSync, summaryAll, STREAMS, LISTS } from './sync.js';

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

  const { data: state, error: stateError } = await db.from('catalog_sync_state').select('cursor_at,cursor_id,list_cursors').eq('id', 1).single();
  if (stateError) return json(500, { error: stateError.message });
  const now = new Date().toISOString();
  const started = Date.now();
  const BUDGET_MS = 100_000;

  const fetchPage = async (url: string) => {
    const res = await fetch(url, { headers: { apikey: catalogKey, Authorization: `Bearer ${catalogKey}` } });
    if (!res.ok) throw new Error(`catalog answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  };
  const applyWith = (rpc: string) => async (rows: unknown[]) => {
    const { data, error } = await db.rpc(rpc, { p_rows: rows });
    if (error) throw new Error(error.message);
    return data;
  };
  const saveState = async (patch: Record<string, unknown>) => {
    const { error } = await db.from('catalog_sync_state').update(patch).eq('id', 1);
    if (error) throw new Error(error.message);
  };

  try {
    // Titles first (they are what customers see), then the lists with whatever time is left.
    const totals = await runSync({ catalogUrl, cursor: { at: state.cursor_at, id: state.cursor_id }, budgetMs: BUDGET_MS }, {
      now: () => Date.now(),
      fetchPage,
      apply: applyWith(STREAMS.items.rpc),
      saveCursor: ({ at, id }: { at: string; id: number }) => saveState({ cursor_at: at, cursor_id: id }),
    });
    const cursors = { ...(state.list_cursors ?? {}) };
    const lists: Record<string, Awaited<ReturnType<typeof runSync>> | null> = {};
    for (const name of LISTS) {
      const left = BUDGET_MS - (Date.now() - started);
      if (left <= 0) {
        lists[name] = null;
        continue;
      }
      const stream = STREAMS[name as keyof typeof STREAMS];
      lists[name] = await runSync({ catalogUrl, cursor: cursors[name] ?? null, budgetMs: left, stream }, {
        now: () => Date.now(),
        fetchPage,
        apply: applyWith(stream.rpc),
        saveCursor: async (c: { at: string; id: string }) => {
          cursors[name] = c;
          await saveState({ list_cursors: cursors });
        },
      });
    }
    const failed = totals.failed + Object.values(lists).reduce((n, t) => n + (t?.failed ?? 0), 0);
    await db.from('catalog_sync_state').update({
      last_run_at: now, last_ok_at: now, last_error: totals.error ?? Object.values(lists).find((t) => t?.error)?.error ?? null,
      last_inserted: totals.inserted, last_updated: totals.updated,
    }).eq('id', 1);
    const message = summaryAll({ items: totals, ...lists });
    if (message) await db.from('job_log').insert({ job: 'catalog_sync', ok: !failed, message, detail: { ...totals, lists } });
    return json(200, { ...totals, lists });
  } catch (err) {
    const message = (err as Error).message;
    await db.from('catalog_sync_state').update({ last_run_at: now, last_error: message }).eq('id', 1);
    await db.from('job_log').insert({ job: 'catalog_sync', ok: false, message });
    return json(500, { error: message });
  }
});
