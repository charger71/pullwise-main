// Notifications in the pull list app (app.html): Web Push to the phones and browsers customers turned them on for.
//
//   GET                                          { publicKey }: the VAPID public key the app subscribes with ('' = not set up)
//   POST  x-cron-secret: <CRON_SECRET>  { "mode": "send" }   the hourly tick (public.push_notify_tick): one notice per
//           customer for books newly ready for pickup, and one for titles their follows added since the last
//   POST  Authorization: Bearer <customer>  { "mode": "test" }   a test notice to the signed-in customer's own devices
//
// Secrets (supabase secrets set …): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (`node tools/vapid-keys.mjs` makes a pair; the
// same pair can serve every shop), VAPID_SUBJECT (mailto: or https: address push services can reach the sender at);
// CRON_SECRET, shared with weekly-pull-list. The tick finds this function next to weekly-pull-list, so it needs no
// Vault secret of its own.
// Deploy with:  supabase functions deploy push-notify --no-verify-jwt

import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import { arrivalMessage, newTitlesMessage, testMessage, notificationIcon, subscriptionGone } from './messages.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const same = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

const NEW_SOURCES = ['series', 'artist']; // lines a follow added (public.apply_subscriptions)
const CHUNK = 200; // customer ids per query, so an address never gets too long

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method === 'GET') return json(200, { publicKey: PUBLIC_KEY && PRIVATE_KEY ? PUBLIC_KEY : '' });
  if (req.method !== 'POST') return json(405, { error: 'GET or POST only' });
  if (!PUBLIC_KEY || !PRIVATE_KEY) return json(503, { error: 'Notifications aren’t set up for this shop yet.' });
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') || 'mailto:support@pullwise.shop', PUBLIC_KEY, PRIVATE_KEY);

  const body = await req.json().catch(() => ({}));
  const cron = req.headers.get('x-cron-secret');
  const secret = Deno.env.get('CRON_SECRET');
  try {
    if (cron && secret && same(cron, secret)) return json(200, await sendAll());
    if (body.mode !== 'test') return json(400, { error: 'Unknown mode.' });
    // A customer testing their own devices.
    const auth = req.headers.get('authorization');
    if (!auth) return json(401, { error: 'Please sign in.' });
    const caller = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const user = (await caller.auth.getUser()).data.user;
    // By user id: staff can read every customer, and must only reach their own devices here.
    const { data: me } = user ? await caller.from('customers').select('id').eq('user_id', user.id).maybeSingle() : { data: null };
    if (!me) return json(401, { error: 'Please sign in.' });
    const shop = await loadShop();
    const devices = await subscriptionsOf([me.id]);
    const result = await sendTo(devices, { ...testMessage(shop.shop_name), icon: notificationIcon(shop) });
    return json(200, { devices: devices.length, ...result });
  } catch (err) {
    console.error(err);
    return json(500, { error: err instanceof Error ? err.message : String(err) });
  }
});

async function loadShop() {
  const { data, error } = await admin.from('settings').select('shop_name,favicon_url,logo_url').eq('id', 1).single();
  if (error) throw error;
  return data;
}

type Device = { id: number; customer_id: number; endpoint: string; p256dh: string; auth: string };

/** Every device of these customers (all of them when `ids` is null). Paged: one request returns at most 1000 rows. */
async function subscriptionsOf(ids: number[] | null): Promise<Device[]> {
  const rows: Device[] = [];
  for (let offset = 0; ; offset += 1000) {
    let q = admin.from('push_subscriptions').select('id,customer_id,endpoint,p256dh,auth').order('id').range(offset, offset + 999);
    if (ids) q = q.in('customer_id', ids);
    const { data, error } = await q;
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

/**
 * One notification to each device. A device the push service says is gone is forgotten. Resolves how many got it,
 * how many failed, and whether any device is still worth trying again (so the caller knows whether to mark it sent).
 */
async function sendTo(devices: Device[], message: Record<string, unknown>) {
  let sent = 0;
  let failed = 0;
  let retry = false;
  const payload = JSON.stringify(message);
  for (const d of devices) {
    try {
      await webpush.sendNotification({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, payload, { TTL: 60 * 60 * 12, urgency: 'normal' });
      sent++;
      await admin.from('push_subscriptions').update({ last_sent_at: new Date().toISOString() }).eq('id', d.id);
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (subscriptionGone(status)) {
        await admin.from('push_subscriptions').delete().eq('id', d.id);
      } else {
        failed++;
        retry = true;
        console.error(`push to device ${d.id} failed:`, status ?? '', err instanceof Error ? err.message : err);
      }
    }
  }
  return { sent, failed, retry };
}

/** Everything due: for each customer with a device, their books newly ready, then the titles their follows added. */
async function sendAll() {
  const shop = await loadShop();
  const icon = notificationIcon(shop);
  const devices = await subscriptionsOf(null);
  const byCustomer = new Map<number, Device[]>();
  for (const d of devices) byCustomer.set(d.customer_id, [...(byCustomer.get(d.customer_id) ?? []), d]);
  const ids = [...byCustomer.keys()];
  const out = { customers: ids.length, arrivals: 0, newTitles: 0, sent: 0, failed: 0, errors: [] as string[] };

  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { data: customers, error: cErr } = await admin.from('customers').select('id,push_arrivals,push_new_titles,new_titles_pushed_at').in('id', chunk);
    if (cErr) throw cErr;
    const lineQuery = () =>
      admin
        .from('reservations')
        .select('id,status,source,created_at,item:items(title,issue_number),order:reservation_orders!inner(customer_id)')
        .in('order.customer_id', chunk)
        .order('created_at');
    const since = new Date(Date.now() - 7 * 864e5).toISOString(); // a week back is plenty for an hourly job
    const [arrived, added] = await Promise.all([
      lineQuery().eq('status', 'arrived').is('arrival_pushed_at', null),
      lineQuery().eq('status', 'open').in('source', NEW_SOURCES).gt('created_at', since),
    ]);
    if (arrived.error) throw arrived.error;
    if (added.error) throw added.error;
    const linesOf = (rows: any[], id: number) => rows.filter((r) => r.order.customer_id === id);

    for (const c of customers) {
      const mine = byCustomer.get(c.id) ?? [];
      // Ready for pickup
      const ready = c.push_arrivals ? linesOf(arrived.data, c.id) : [];
      if (ready.length) {
        const r = await sendTo(mine, { ...arrivalMessage(ready, shop.shop_name), icon });
        out.arrivals++;
        out.sent += r.sent;
        out.failed += r.failed;
        // Marked sent unless every device failed in a way worth retrying next hour.
        if (r.sent || !r.retry) {
          const { error } = await admin.from('reservations').update({ arrival_pushed_at: new Date().toISOString() }).in('id', ready.map((l) => l.id));
          if (error) out.errors.push(`customer ${c.id} arrivals: ${error.message}`);
        }
      }
      // New from what they follow, since the last notice (or a day back, for a customer who has never had one)
      const after = c.new_titles_pushed_at ? Date.parse(c.new_titles_pushed_at) : Date.now() - 864e5;
      const fresh = c.push_new_titles ? linesOf(added.data, c.id).filter((l) => Date.parse(l.created_at) > after) : [];
      if (fresh.length) {
        const r = await sendTo(mine, { ...newTitlesMessage(fresh), icon });
        out.newTitles++;
        out.sent += r.sent;
        out.failed += r.failed;
        if (r.sent || !r.retry) {
          const { error } = await admin.from('customers').update({ new_titles_pushed_at: fresh.at(-1).created_at }).eq('id', c.id);
          if (error) out.errors.push(`customer ${c.id} new titles: ${error.message}`);
        }
      }
    }
  }
  if (out.errors.length) console.error(out.errors.join('\n'));
  return out;
}
