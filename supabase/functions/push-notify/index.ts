// Notifications in the pull list app (app.html): Web Push to the phones and browsers customers turned them on for.
//
//   GET                                          { publicKey }: the VAPID public key the app subscribes with ('' = not set up)
//   POST  x-cron-secret: <CRON_SECRET>  { "mode": "send" }   the hourly tick (public.push_notify_tick): one notice per
//           customer for books newly ready for pickup, one for titles their follows added since the last, a reminder
//           for books still waiting (after a week, and near the end of the hold), one the day before the last
//           day to change the list, and one when titles they asked about ("tell me when it's in") are in the shop
//   POST  Authorization: Bearer <customer>  { "mode": "test" }   a test notice to the signed-in customer's own devices
//   POST  x-cron-secret  { "mode": "chat", "conversation_id" }   a visitor wrote in live chat: tell every staff device
//           that turned chat notifications on (public.chat_message_push asks, at most every 5 minutes for a chat)
//   POST  x-cron-secret  { "mode": "chat-reply", "conversation_id" }   staff answered a chat a signed-in customer
//           started: tell that customer's devices (public.chat_reply_push asks, at most once a minute for a chat)
//   POST  Authorization: Bearer <staff>  { "mode": "staff-test" }   a test notice to the signed-in staff member's devices
//
// Secrets (supabase secrets set …): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (`node tools/vapid-keys.mjs` makes a pair; the
// same pair can serve every shop), VAPID_SUBJECT (mailto: or https: address push services can reach the sender at);
// CRON_SECRET, shared with weekly-pull-list. The tick finds this function next to weekly-pull-list, so it needs no
// Vault secret of its own.
// Deploy with:  supabase functions deploy push-notify --no-verify-jwt

import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import { arrivalMessage, newTitlesMessage, pickupReminderMessage, cutoffMessage, inStockMessage, IN_STOCK, testMessage, staffChatMessage, staffTestMessage, chatReplyMessage, notificationIcon, subscriptionGone, shopToday, addDays, focsChangingOn, pickupDue } from './messages.js';

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
    if (cron && secret && same(cron, secret)) return json(200, body.mode === 'chat' ? await sendChat(Number(body.conversation_id)) : body.mode === 'chat-reply' ? await sendChatReply(Number(body.conversation_id)) : await sendAll());
    if (body.mode !== 'test' && body.mode !== 'staff-test') return json(400, { error: 'Unknown mode.' });
    const auth = req.headers.get('authorization');
    if (!auth) return json(401, { error: 'Please sign in.' });
    const caller = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const user = (await caller.auth.getUser()).data.user;
    if (body.mode === 'staff-test') {
      // A staff member testing their own devices (the staff table is readable only by staff).
      const { data: staff } = user ? await caller.from('staff').select('user_id').eq('user_id', user.id).maybeSingle() : { data: null };
      if (!staff) return json(401, { error: 'Please sign in with your staff account.' });
      const shop = await loadShop();
      const devices = await staffDevices(user!.id);
      const result = await sendTo(devices, { ...staffTestMessage(shop.shop_name), icon: notificationIcon(shop) }, STAFF_TABLE);
      return json(200, { devices: devices.length, ...result });
    }
    // A customer testing their own devices.
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
  const { data, error } = await admin.from('settings').select('shop_name,favicon_url,logo_url,hold_days,timezone').eq('id', 1).single();
  if (error) throw error;
  return data;
}

type Device = { id: number; customer_id?: number; endpoint: string; p256dh: string; auth: string };
const CUSTOMER_TABLE = 'push_subscriptions';
const STAFF_TABLE = 'staff_push_subscriptions';

/** Staff devices with chat notifications on: one staff member's, or everyone's. */
async function staffDevices(userId?: string): Promise<Device[]> {
  let q = admin.from(STAFF_TABLE).select('id,endpoint,p256dh,auth').order('id').limit(1000);
  if (userId) q = q.eq('user_id', userId);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

/** Staff answered this chat: one notice to the customer it belongs to, quoting the newest reply. */
async function sendChatReply(id: number) {
  if (!Number.isInteger(id) || id <= 0) return { error: 'No chat named.' };
  const { data: chat, error } = await admin.from('chat_conversations').select('id,customer_id').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!chat?.customer_id) return { chat: id, sent: 0, skipped: true };
  const [{ data: who }, { data: last }] = await Promise.all([
    admin.from('customers').select('push_chat').eq('id', chat.customer_id).maybeSingle(),
    admin.from('chat_messages').select('body').eq('conversation_id', id).eq('from_staff', true).order('id', { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!who?.push_chat || !last) return { chat: id, sent: 0, skipped: true };
  const devices = await subscriptionsOf([chat.customer_id]);
  if (!devices.length) return { chat: id, devices: 0, sent: 0 };
  const shop = await loadShop();
  const result = await sendTo(devices, { ...chatReplyMessage({ shopName: shop.shop_name, body: last.body }), icon: notificationIcon(shop) }, CUSTOMER_TABLE, 60 * 60 * 12, 'high');
  return { chat: id, devices: devices.length, ...result };
}

/** A visitor wrote in this chat: one notice to every staff device, naming the visitor and quoting their newest line. */
async function sendChat(id: number) {
  if (!Number.isInteger(id) || id <= 0) return { error: 'No chat named.' };
  const [{ data: chat, error }, { data: last }] = await Promise.all([
    admin.from('chat_conversations').select('id,name,unread_staff').eq('id', id).maybeSingle(),
    admin.from('chat_messages').select('body').eq('conversation_id', id).eq('from_staff', false).order('id', { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (error) throw error;
  // Deleted already, or a teammate opened it in the moment since: nothing to say.
  if (!chat || !chat.unread_staff) return { chat: id, sent: 0, skipped: true };
  const devices = await staffDevices();
  if (!devices.length) return { chat: id, devices: 0, sent: 0 };
  const shop = await loadShop();
  const result = await sendTo(devices, { ...staffChatMessage({ id, name: chat.name, body: last?.body, unread: chat.unread_staff }), icon: notificationIcon(shop) }, STAFF_TABLE, 60 * 30, 'high');
  return { chat: id, devices: devices.length, ...result };
}

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
async function sendTo(devices: Device[], message: Record<string, unknown>, table = CUSTOMER_TABLE, ttl = 60 * 60 * 12, urgency = 'normal') {
  let sent = 0;
  let failed = 0;
  let retry = false;
  const payload = JSON.stringify(message);
  for (const d of devices) {
    try {
      await webpush.sendNotification({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, payload, { TTL: ttl, urgency });
      sent++;
      await admin.from(table).update({ last_sent_at: new Date().toISOString() }).eq('id', d.id);
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (subscriptionGone(status)) {
        await admin.from(table).delete().eq('id', d.id);
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
  for (const d of devices) byCustomer.set(d.customer_id!, [...(byCustomer.get(d.customer_id!) ?? []), d]);
  const ids = [...byCustomer.keys()];
  const out = { customers: ids.length, arrivals: 0, newTitles: 0, pickupReminders: 0, cutoffReminders: 0, inStock: 0, sent: 0, failed: 0, errors: [] as string[] };
  const today = shopToday(shop.timezone || 'America/New_York');
  const holdDays = shop.hold_days ?? 30;
  const changeDay = addDays(today, 1); // remind the day before the last day to change
  const cutoffFocs = focsChangingOn(changeDay);

  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { data: customers, error: cErr } = await admin.from('customers').select('id,unsubscribe_token,push_arrivals,push_new_titles,push_reminders,new_titles_pushed_at,cutoff_pushed_on').in('id', chunk);
    if (cErr) throw cErr;
    const lineQuery = () =>
      admin
        .from('reservations')
        .select('id,status,source,created_at,arrived_on,arrival_pushed_at,pickup_reminders,item:items!inner(id,title,issue_number,foc_date),order:reservation_orders!inner(customer_id)')
        .in('order.customer_id', chunk)
        .order('created_at');
    const since = new Date(Date.now() - 7 * 864e5).toISOString(); // a week back is plenty for an hourly job
    const alerts = admin
      .from('stock_alerts')
      .select('id,customer_id,item:items!inner(id,title,issue_number,status)')
      .in('customer_id', chunk)
      .in('item.status', IN_STOCK)
      .order('id');
    const [arrived, added, closing, inNow] = await Promise.all([
      lineQuery().eq('status', 'arrived'), // all of them: the new ones are announced, and the count goes on the icon
      lineQuery().eq('status', 'open').in('source', NEW_SOURCES).gt('created_at', since),
      lineQuery().eq('status', 'open').in('item.foc_date', cutoffFocs), // changes close tomorrow
      alerts,
    ]);
    if (inNow.error) throw inNow.error;
    if (arrived.error) throw arrived.error;
    if (added.error) throw added.error;
    if (closing.error) throw closing.error;
    const linesOf = (rows: any[], id: number) => rows.filter((r) => r.order.customer_id === id);

    for (const c of customers) {
      const mine = byCustomer.get(c.id) ?? [];
      // Ready for pickup
      const waiting = linesOf(arrived.data, c.id);
      const ready = c.push_arrivals ? waiting.filter((l) => !l.arrival_pushed_at) : [];
      if (ready.length) {
        const r = await sendTo(mine, { ...arrivalMessage(ready, shop.shop_name, waiting.length), icon });
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
        // One title: a Skip button that takes it off (the same private link as the email's Skip).
        const skipUrl = (l: { id: number }) => `${SUPABASE_URL}/functions/v1/weekly-pull-list?u=${c.unsubscribe_token}&skip=${l.id}`;
        const r = await sendTo(mine, { ...newTitlesMessage(fresh, { skipUrl }), icon });
        out.newTitles++;
        out.sent += r.sent;
        out.failed += r.failed;
        if (r.sent || !r.retry) {
          const { error } = await admin.from('customers').update({ new_titles_pushed_at: fresh.at(-1).created_at }).eq('id', c.id);
          if (error) out.errors.push(`customer ${c.id} new titles: ${error.message}`);
        }
      }
      // In the shop now: titles they asked about. Asked for, so sent whatever their other switches say; then forgotten.
      const asked = inNow.data.filter((a: any) => a.customer_id === c.id);
      if (asked.length) {
        const r = await sendTo(mine, { ...inStockMessage(asked.map((a: any) => a.item), shop.shop_name), icon });
        out.inStock++;
        out.sent += r.sent;
        out.failed += r.failed;
        if (r.sent || !r.retry) {
          const { error } = await admin.from('stock_alerts').delete().in('id', asked.map((a: any) => a.id));
          if (error) out.errors.push(`customer ${c.id} in stock: ${error.message}`);
        }
      }
      if (!c.push_reminders) continue;
      // Still waiting at the counter: one notice for every book due a reminder, worded for the most urgent
      const due = waiting.map((l) => ({ l, stage: pickupDue(l, today, holdDays) })).filter((d) => d.stage);
      if (due.length) {
        const stage = Math.max(...due.map((d) => d.stage));
        const holdUntil = due.map((d) => addDays(d.l.arrived_on, holdDays)).sort()[0];
        const r = await sendTo(mine, { ...pickupReminderMessage(due.map((d) => d.l), { stage, holdUntil, shopName: shop.shop_name, readyCount: waiting.length }), icon });
        out.pickupReminders++;
        out.sent += r.sent;
        out.failed += r.failed;
        if (r.sent || !r.retry) {
          for (const s of [1, 2]) {
            const lineIds = due.filter((d) => d.stage === s).map((d) => d.l.id);
            if (!lineIds.length) continue;
            const { error } = await admin.from('reservations').update({ pickup_reminders: s }).in('id', lineIds);
            if (error) out.errors.push(`customer ${c.id} pickup reminder: ${error.message}`);
          }
        }
      }
      // Tomorrow is the last day to change these
      const changing = c.cutoff_pushed_on === changeDay ? [] : linesOf(closing.data, c.id);
      if (changing.length) {
        const r = await sendTo(mine, { ...cutoffMessage(changing, changeDay), icon });
        out.cutoffReminders++;
        out.sent += r.sent;
        out.failed += r.failed;
        if (r.sent || !r.retry) {
          const { error } = await admin.from('customers').update({ cutoff_pushed_on: changeDay }).eq('id', c.id);
          if (error) out.errors.push(`customer ${c.id} cutoff reminder: ${error.message}`);
        }
      }
    }
  }
  if (out.errors.length) console.error(out.errors.join('\n'));
  return out;
}
