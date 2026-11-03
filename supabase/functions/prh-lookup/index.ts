// Looks one title up in the Penguin Random House API for Admin → Titles ("Fill in from PRH"), in the master
// catalog only: books by ISBN, comics by their 17-digit UPC (the same places prh-sync looks, prh-sync/rules.js).
// The admin page turns the reply into title fields (prhApiItem in js/import/distributors.js).
//
// POST { "code": "9780593135204" }   → { domain, record, content } or 404 { error }
//
// Staff only (checked with public.is_staff() as the caller). Secret: PRH_API_KEY (the catalog has it; without it
// this answers 503). PRH's links carry the key, so they are left out of the reply.
//
// Deploy with:  supabase functions deploy prh-lookup

import { createClient } from 'npm:@supabase/supabase-js@2';
import { lookup } from '../prh-sync/rules.js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'POST only' });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: isStaff } = await supabase.rpc('is_staff');
  if (isStaff !== true) return json(403, { error: 'Staff only' });

  const key = Deno.env.get('PRH_API_KEY');
  if (!key) return json(503, { error: 'PRH look-ups aren’t set up on this site.' });

  let code = '';
  try {
    code = String((await req.json()).code ?? '').replace(/[\s-]/g, '');
  } catch {
    return json(400, { error: 'Expected JSON' });
  }
  if (!/^\d{10,17}$/.test(code)) return json(400, { error: 'Enter an ISBN or UPC (digits only).' });
  const item = /^97[89]\d{10}$/.test(code) ? { isbn: code, upc: null } : { isbn: null, upc: code };

  try {
    const found = await lookup({ ...item, description: null }, key, async (url: string) => {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      return { status: res.status, body: res.status === 200 ? await res.json() : (await res.body?.cancel(), null) };
    });
    if (!found.found) return json(404, { error: 'PRH doesn’t list that code.' });
    const { _links, _embeds, ...record } = found.record;
    const content = found.content ? { flapcopy: found.content.flapcopy ?? null, keynote: found.content.keynote ?? null } : null;
    return json(200, { domain: found.domain, record, content });
  } catch (err) {
    // A network error's message can include the request URL, and with it the key.
    return json(502, { error: (err as Error).message.replace(/api_key=[^&\s)"']*/g, 'api_key=…') });
  }
});
