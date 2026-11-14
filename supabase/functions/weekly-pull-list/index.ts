// Weekly pull-list email.
//
//   POST  x-cron-secret: <CRON_SECRET>   { "mode": "send" }      the hourly tick (public.weekly_pull_list_tick)
//   POST  Authorization: Bearer <staff>  { "mode": "preview" | "test" | "send", "customer_id"?: n }
//           preview  returns { subject, html } for a sample customer, sends nothing
//           test     emails that sample to the signed-in staff member
//           send     emails every opted-in customer who has something to report (skips anyone
//                    already emailed today), the same as the scheduled run ("Send now")
//   POST  staff { "mode": "message", "to", "subject", "message", "customer_id"? }   one email to one customer, written in the admin
//   POST  { "mode": "arrivals" }  (cron secret, or staff for "send now")   "Your books are in" emails: one per customer
//           whose titles became ready for pickup since the last one (public.arrival_email_tick calls this hourly)
//   POST  staff { "mode": "arrivals_preview" | "arrivals_test" }  preview / send-to-me for the arrival email
//   POST  { "mode": "event_signup", "signup_id": n }  (cron secret only; public.event_signup_email_trigger calls this for each
//           new event signup)   emails the customer a confirmation and the shop a notification
//   POST  { "mode": "event_reminder" | "event_cancelled", "event_id": n }  (cron secret only; public.event_reminder_tick sends the
//           reminder the day before, public.event_cancel_email_trigger the cancellation notice)   emails everyone signed up
//   GET/POST ?u=<unsubscribe token>[&k=arrivals]   the unsubscribe page and its one-click POST
//           (k=arrivals stops only the arrival emails; otherwise the weekly email)
//
// Secrets (supabase secrets set …): RESEND_API_KEY, CRON_SECRET; optional SITE_URL, RESEND_FROM.
// Deploy with:  supabase functions deploy weekly-pull-list --no-verify-jwt

import { createClient } from 'npm:@supabase/supabase-js@2';
import { build, sections, buildArrival, arrivalSections, buildMessage, asTest, splitClaims, withLocation } from './email.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

/**
 * Whether the shop's site offers the pull list app, for the weekly email's "Get the app" line. Only shops marked
 * "app": true in shops.json serve an install manifest (worker/index.js), so that answers it without a setting of
 * its own here. No site address, or no answer: leave the line out.
 */
async function siteHasApp(siteUrl: string) {
  if (!siteUrl) return false;
  try {
    const res = await fetch(`${siteUrl}/manifest.webmanifest`, { method: 'HEAD', signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** The shop's settings row with its default location's address, phone and hours laid over it (same { data, error } shape as a query). */
async function loadShop() {
  const { data: shop, error } = await admin.from('settings').select('*').eq('id', 1).single();
  if (error) return { data: shop, error };
  const { data: locations } = await admin.from('locations').select('*');
  const location = (locations ?? []).find((l) => l.is_default) ?? null;
  return { data: withLocation(shop, location, { multi: (locations ?? []).length > 1 }), error: null };
}

/** Every location by id, and the default one: a customer's emails use the location they pick up at. */
async function loadLocations() {
  const { data, error } = await admin.from('locations').select('*');
  if (error) throw error;
  const byId = new Map<number, any>((data ?? []).map((l) => [l.id, l]));
  return { byId, fallback: (data ?? []).find((l) => l.is_default) ?? null, multi: byId.size > 1 };
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const page = (title: string, body: string) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
     <body style="font:16px/1.5 Arial,sans-serif;max-width:480px;margin:10vh auto;padding:0 16px;color:#161616"><h1 style="font-size:22px">${title}</h1>${body}`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );

const same = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

const ACTIVE = ['open', 'ordered', 'reordered', 'arrived'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every customer with an email, `columns` each. Paged: one request returns at most 1000 rows. */
async function allCustomers(db: typeof admin, columns: string) {
  const rows: any[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.from('customers').select(columns).not('email', 'is', null).order('id').range(offset, offset + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

/** Every customer's series follows ({ kind, key }), by customer id: they set the pull-list discount. Paged like allCustomers. */
async function seriesFollows(db: typeof admin) {
  const byCustomer = new Map<number, { kind: string; key: string }[]>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.from('subscriptions').select('customer_id,kind,key').eq('kind', 'series').order('id').range(offset, offset + 999);
    if (error) throw error;
    for (const f of data) byCustomer.set(f.customer_id, [...(byCustomer.get(f.customer_id) ?? []), f]);
    if (data.length < 1000) return byCustomer;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const url = new URL(req.url);
  if (url.searchParams.has('u') && url.searchParams.has('skip')) return skipTitle(req, url.searchParams.get('u')!, url.searchParams.get('skip')!);
  if (url.searchParams.has('u')) return unsubscribe(req, url.searchParams.get('u')!, url.searchParams.get('k') === 'arrivals' ? 'arrivals' : 'weekly');
  if (req.method !== 'POST') return json(405, { error: 'POST only' });

  // Who is calling: the database's hourly tick (shared secret) or a staff member.
  let staffEmail: string | null = null;
  const cron = req.headers.get('x-cron-secret');
  const secret = Deno.env.get('CRON_SECRET');
  const isCron = !!cron && !!secret && same(cron, secret);
  if (!isCron) {
    const auth = req.headers.get('authorization');
    if (!auth) return json(401, { error: 'Not signed in.' });
    const caller = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: isStaff } = await caller.rpc('is_staff');
    if (!isStaff) return json(403, { error: 'Staff only.' });
    staffEmail = (await caller.auth.getUser()).data.user?.email ?? null;
  }

  const body = await req.json().catch(() => ({}));
  const mode = isCron ? (['arrivals', 'event_signup', 'event_reminder', 'event_cancelled'].includes(body.mode) ? body.mode : 'send') : body.mode;
  if (!['preview', 'test', 'send', 'arrivals', 'arrivals_preview', 'arrivals_test', 'message', 'event_signup', 'event_reminder', 'event_cancelled'].includes(mode)) return json(400, { error: 'Unknown mode.' });
  if (['event_signup', 'event_reminder', 'event_cancelled'].includes(mode) && !isCron) return json(403, { error: 'Not allowed.' });

  try {
    if (mode === 'event_signup') return await sendEventSignup(Number(body.signup_id));
    if (mode === 'event_reminder' || mode === 'event_cancelled') return await sendEventNotice(Number(body.event_id), mode === 'event_cancelled' ? 'cancelled' : 'reminder');
    if (mode === 'message') return await sendMessage(body, staffEmail);
    if (mode.startsWith('arrivals')) return await runArrivals(mode, body.customer_id, staffEmail);
    return await run(mode, body.customer_id, staffEmail, isCron);
  } catch (err) {
    console.error(err);
    return json(500, { error: err instanceof Error ? err.message : String(err) });
  }
});

/** One email from a staff member to one customer. Replies go to the shop email, which also gets a blind copy. */
async function sendMessage(body: { to?: string; subject?: string; message?: string; customer_id?: number }, staffEmail: string | null) {
  const to = String(body.to ?? '').trim();
  const subject = String(body.subject ?? '').trim();
  const message = String(body.message ?? '').trim();
  if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(to) || to.length > 254) return json(400, { error: 'That email address doesn’t look right.' });
  if (!subject || subject.length > 200) return json(400, { error: 'Please add a subject (200 characters at most).' });
  if (!message || message.length > 10000) return json(400, { error: 'Please write a message (10,000 characters at most).' });
  const { data: shop, error } = await loadShop();
  if (error) throw error;
  const from = shop.pull_list_email_from || Deno.env.get('RESEND_FROM');
  if (!from) return json(500, { error: 'Set the From address in Admin → Emails first.' });
  const m = buildMessage({ shop, subject, message });
  const customerId = Number.isInteger(body.customer_id) ? body.customer_id! : null;
  const res = await resend('/emails', { from, to: [to], ...(shop.email ? { reply_to: shop.email, bcc: [shop.email] } : {}), subject: m.subject, html: m.html, text: m.text });
  if (!res.ok) {
    const why = `Resend: ${(await res.json().catch(() => ({}))).message ?? res.status}`;
    await logEmails([{ kind: 'message', to_email: to, subject, body: message, customer_id: customerId, sent_by: staffEmail, status: 'failed', error: why }]);
    throw new Error(why);
  }
  await logEmails([{ kind: 'message', to_email: to, subject, body: message, customer_id: customerId, sent_by: staffEmail, status: 'sent' }]);
  await admin.from('customer_messages').insert({ customer_id: Number.isInteger(body.customer_id) ? body.customer_id : null, to_email: to, subject, body: message, sent_by: staffEmail });
  return json(200, { ok: true, to });
}

/** When and where an event is, for an email: the shop's time zone, and (with several locations) the event's location with its address. */
async function eventWhenWhere(ev: Record<string, any>, shop: Record<string, any>) {
  const tz = shop.timezone || undefined;
  const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const allDay = ev.ends_at && clock(ev.starts_at) === '00:00' && clock(ev.ends_at) === '23:59'; // entered as an all-day event
  const day = new Date(ev.starts_at).toLocaleDateString('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const when = allDay ? `${day} (all day)` : `${day} at ${new Date(ev.starts_at).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })}`;
  // A shop with several locations holds each event at one of them: its name and address, then any note staff typed.
  const locs = await loadLocations();
  const allLocations = locs.multi && ev.location_id === null; // an event for every location has no one address
  const evShop = allLocations
    ? { ...shop, shop_name: shop.brand_name ?? shop.shop_name, street: null, city: null, region: null, postal_code: null }
    : locs.multi ? withLocation(shop, locs.byId.get(ev.location_id) ?? locs.fallback, { multi: true }) : shop;
  const addr = [evShop.street, [evShop.city, evShop.region].filter(Boolean).join(', ')].filter(Boolean).join(', ');
  const where = allLocations ? `${evShop.shop_name} — all locations${ev.location ? ` (${ev.location})` : ''}`
    : locs.multi ? [evShop.shop_name, addr].filter(Boolean).join(', ') + (ev.location ? ` (${ev.location})` : '') : ev.location || shop.shop_name;
  return { evShop, when, where };
}

/**
 * An email to everyone signed up for an event: the day-before reminder, or the notice that it was cancelled. Each
 * signup gets its own email (Reply goes to the shop). A reminder is skipped for an event that has since been cancelled.
 */
async function sendEventNotice(eventId: number, kind: 'reminder' | 'cancelled') {
  if (!Number.isInteger(eventId)) return json(400, { error: 'Missing event.' });
  const { data: ev, error } = await admin.from('events').select('*').eq('id', eventId).single();
  if (error) throw error;
  if (kind === 'reminder' && ev.cancelled_at) return json(200, { ok: true, sent: 0, skipped: 'cancelled' });
  const { data: signups, error: gErr } = await admin.from('event_signups').select('*').eq('event_id', eventId).order('id');
  if (gErr) throw gErr;
  const { data: shop, error: sErr } = await loadShop();
  if (sErr) throw sErr;
  const from = shop.pull_list_email_from || Deno.env.get('RESEND_FROM');
  if (!from) return json(500, { error: 'Set the From address in Admin → Emails first.' });
  const { evShop, when, where } = await eventWhenWhere(ev, shop);
  const siteUrl = (Deno.env.get('SITE_URL') ?? '').replace(/\/$/, '');
  const subject = kind === 'cancelled' ? `Cancelled: ${ev.title}` : `Reminder: ${ev.title} is coming up`;
  const rows: LogRow[] = [];
  for (const su of signups) {
    const people = su.party_size === 1 ? '1 person' : `${su.party_size} people`;
    const message = kind === 'cancelled'
      ? `Hi ${su.name},\n\nWe're sorry: ${ev.title} on ${when} has been cancelled.\n\nYour signup has been released, and nothing more is needed from you. Questions? Just reply to this email or call the shop${evShop.phone ? ` at ${evShop.phone}` : ''}.`
      : `Hi ${su.name},\n\nA reminder that you're signed up for ${ev.title}.\n\nWhen: ${when}\nWhere: ${where}\nSpots held: ${people}\n\nEvent details: ${siteUrl}/event.html?id=${ev.id}\n\nCan't make it? Just reply to this email or call the shop${evShop.phone ? ` at ${evShop.phone}` : ''} so we can free up your spot.`;
    const mail = buildMessage({ shop: evShop, subject, message });
    let failure: string | null = null;
    try {
      const res = await resend('/emails', { from, to: [su.email], subject, html: mail.html, text: mail.text, ...(shop.email ? { reply_to: shop.email } : {}) });
      if (!res.ok) failure = `Resend: ${(await res.json().catch(() => ({}))).message ?? res.status}`;
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
    }
    rows.push({ kind: kind === 'cancelled' ? 'event_cancelled' : 'event_reminder', to_email: su.email, subject, body: mail.text, sent_by: kind === 'cancelled' ? 'Event cancelled' : 'Event reminder', status: failure ? 'failed' : 'sent', error: failure });
    await new Promise((r) => setTimeout(r, 600)); // Resend allows ~2 requests a second
  }
  await logEmails(rows);
  return json(200, { ok: true, sent: rows.filter((r) => r.status === 'sent').length, failed: rows.filter((r) => r.status === 'failed').length });
}

/** A new event signup: a confirmation to the customer, and a notification (Reply goes to the customer) to the shop. */
async function sendEventSignup(signupId: number) {
  if (!Number.isInteger(signupId)) return json(400, { error: 'Missing signup.' });
  const { data: su, error } = await admin.from('event_signups').select('*, event:events(*)').eq('id', signupId).single();
  if (error) throw error;
  const { data: shop, error: sErr } = await loadShop();
  if (sErr) throw sErr;
  const from = shop.pull_list_email_from || Deno.env.get('RESEND_FROM');
  if (!from) return json(500, { error: 'Set the From address in Admin → Emails first.' });
  const ev = su.event;
  const { evShop, when, where } = await eventWhenWhere(ev, shop);
  const people = su.party_size === 1 ? '1 person' : `${su.party_size} people`;
  const siteUrl = (Deno.env.get('SITE_URL') ?? '').replace(/\/$/, '');

  const confirmSubject = `You're signed up: ${ev.title}`;
  const confirm = buildMessage({
    shop: evShop, subject: confirmSubject,
    message: `Hi ${su.name},\n\nYou're signed up for ${ev.title}.\n\nWhen: ${when}\nWhere: ${where}\nSpots held: ${people}\n\nEvent details: ${siteUrl}/event.html?id=${ev.id}\n\nNeed to change or cancel? Just reply to this email or call the shop${evShop.phone ? ` at ${evShop.phone}` : ''}.`,
  });
  const noteSubject = `Event signup: ${su.name} for ${ev.title}`;
  const noteText = `${su.name} signed up for ${ev.title} (${when}).\n\nPeople: ${su.party_size}\nEmail: ${su.email}\nPhone: ${su.phone}${su.notes ? `\nNotes: ${su.notes}` : ''}\n\nReply to this email to answer ${su.name} directly. See everyone signed up in Admin → Events.`;
  const note = buildMessage({ shop, subject: noteSubject, message: noteText });
  const staffTo = [...new Set([shop.email, ...(Deno.env.get('STAFF_CC') ?? '').split(',').map((s) => s.trim()).filter(Boolean)].filter(Boolean))];

  const rows: LogRow[] = [];
  for (const m of [
    { kind: 'event_confirm', to: [su.email], subject: confirmSubject, mail: confirm, extra: shop.email ? { reply_to: shop.email } : {}, text: confirm.text },
    { kind: 'event_notify', to: staffTo, subject: noteSubject, mail: note, extra: { reply_to: su.email }, text: noteText },
  ]) {
    let failure: string | null = null;
    try {
      const res = await resend('/emails', { from, to: m.to, subject: m.subject, html: m.mail.html, text: m.mail.text, ...m.extra });
      if (!res.ok) failure = `Resend: ${(await res.json().catch(() => ({}))).message ?? res.status}`;
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
    }
    rows.push({ kind: m.kind, to_email: m.to.join(', '), subject: m.subject, body: m.text, sent_by: 'Event signup', status: failure ? 'failed' : 'sent', error: failure });
    await new Promise((r) => setTimeout(r, 600)); // Resend allows ~2 requests a second
  }
  await logEmails(rows);
  return json(200, { ok: true, failed: rows.filter((r) => r.status === 'failed').length });
}

async function run(mode: string, customerId: number | undefined, staffEmail: string | null, scheduled: boolean) {
  const { data: shop, error } = await loadShop();
  if (error) throw error;
  const shopBase = shop; // each customer's email overlays their own location on this
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: shop.timezone || undefined }).format(new Date());
  const siteUrl = (Deno.env.get('SITE_URL') ?? '').replace(/\/$/, '');
  const app = await siteHasApp(siteUrl);
  const from = shop.pull_list_email_from || Deno.env.get('RESEND_FROM');
  const replyTo = shop.email || undefined;

  // Everyone with an email, and all their live pull-list lines.
  const customers = await allCustomers(admin, 'id,first_name,name,email,ship_arrivals,email_opt_in,unsubscribe_token,last_emailed_on,home_location_id');
  const lines = new Map<number, unknown[]>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error: lErr } = await admin
      .from('reservations')
      .select('id,quantity,status,arrived_on,source,created_at,item:items(title,issue_number,variant,release_date,foc_date,price,series_key),order:reservation_orders!inner(customer_id)')
      .in('status', ACTIVE)
      .not('order.customer_id', 'is', null)
      .order('id')
      .range(offset, offset + 999);
    if (lErr) throw lErr;
    for (const l of data) {
      const id = (l.order as { customer_id: number }).customer_id;
      lines.set(id, [...(lines.get(id) ?? []), l]);
    }
    if (data.length < 1000) break;
  }

  const follows = await seriesFollows(admin);

  // A test or preview (`forStaff`) gets a dummy unsubscribe link: the sample customer's real one would unsubscribe them.
  const locs = await loadLocations();
  const compose = (c: (typeof customers)[number], forStaff = false) => {
    const shop = withLocation(shopBase, locs.byId.get(c.home_location_id) ?? locs.fallback, { multi: locs.multi });
    const sec = sections((lines.get(c.id) ?? []) as never[], { today, holdDays: shop.hold_days ?? 30, follows: follows.get(c.id) });
    if (!sec) return null;
    const unsubscribeUrl = forStaff ? `${siteUrl}/account.html` : `${SUPABASE_URL}/functions/v1/weekly-pull-list?u=${c.unsubscribe_token}`;
    // Skip links carry the customer's private token, so a staff test or preview gets none.
    const skipUrl = forStaff ? null : (lineId: number) => `${SUPABASE_URL}/functions/v1/weekly-pull-list?u=${c.unsubscribe_token}&skip=${lineId}`;
    return { unsubscribeUrl, ...build({ customer: c, sections: sec, shop, today, manageUrl: `${siteUrl}/account.html`, unsubscribeUrl, app, skipUrl }) };
  };

  if (mode === 'preview' || mode === 'test') {
    // A sample customer: the one asked for, else whoever has the fullest pull list.
    const pool = customers.filter((c) => (customerId ? c.id === customerId : true) && compose(c));
    const sample = customerId ? pool[0] : pool.sort((a, b) => (lines.get(b.id)?.length ?? 0) - (lines.get(a.id)?.length ?? 0))[0];
    if (!sample) return json(404, { error: 'No customer has anything on their pull list to show yet.' });
    const mail = asTest(compose(sample, true)!, sample.name ?? sample.email);
    if (mode === 'preview') return json(200, { subject: mail.subject, html: mail.html, customer: sample.name ?? sample.email });
    if (!staffEmail) return json(400, { error: 'Your account has no email address to send the test to.' });
    // No unsubscribeUrl: a test carries no List-Unsubscribe headers.
    await sendOne({ from, replyTo, to: staffEmail, subject: `[Test] ${mail.subject}`, html: mail.html, text: mail.text, kind: 'test', sentBy: staffEmail });
    return json(200, { sent: 1, to: staffEmail, customer: sample.name ?? sample.email });
  }

  // send: everyone opted in who hasn't had today's email and has something to report.
  // Each batch is claimed before it is sent: last_emailed_on is set to today only where it isn't already, in one
  // update, and only the customers that update returned are emailed. So two runs at once (Send now during the
  // scheduled hour, two tabs) never email anyone twice; whoever the other run claimed first is skipped here.
  // A failed send hands the claim back (the old date returns), so a later run retries that customer.
  const due = customers.filter((c) => c.email_opt_in && c.last_emailed_on !== today);
  const mails = due.map((c) => ({ c, mail: compose(c) })).filter((m) => m.mail) as { c: (typeof customers)[number]; mail: NonNullable<ReturnType<typeof compose>> }[];
  let sent = 0;
  let failed = 0;
  let elsewhere = 0; // claimed by another run going at the same time
  const errors: string[] = []; // bookkeeping writes that failed, reported in the result and the function log
  const runId = crypto.randomUUID(); // groups this run's emails in the email log
  const release = async (rows: typeof mails) => {
    const byPrev = new Map<string | null, number[]>();
    for (const { c } of rows) byPrev.set(c.last_emailed_on ?? null, [...(byPrev.get(c.last_emailed_on ?? null) ?? []), c.id]);
    for (const [prev, ids] of byPrev) {
      const { error: rErr } = await admin.from('customers').update({ last_emailed_on: prev }).in('id', ids).eq('last_emailed_on', today);
      if (rErr) errors.push(`Couldn’t reset ${ids.length} failed ${ids.length === 1 ? 'customer' : 'customers'} for a retry today: ${rErr.message}`);
    }
  };
  for (let i = 0; i < mails.length; i += 50) {
    const chunk = mails.slice(i, i + 50);
    const { data: claimed, error: cErr } = await admin.from('customers').update({ last_emailed_on: today })
      .in('id', chunk.map(({ c }) => c.id)).or(`last_emailed_on.is.null,last_emailed_on.neq.${today}`).select('id');
    if (cErr) {
      errors.push(`Couldn’t mark ${chunk.length} customers as emailed, so they weren’t sent: ${cErr.message}`);
      failed += chunk.length;
      continue;
    }
    const mine = new Set((claimed ?? []).map((r: { id: number }) => r.id));
    const batch = chunk.filter(({ c }) => mine.has(c.id));
    elsewhere += chunk.length - batch.length;
    if (!batch.length) continue;
    let ok: boolean[];
    try {
      ok = await sendBatch(batch.map(({ c, mail }) => ({ from, replyTo, to: c.email!, subject: mail.subject, html: mail.html, text: mail.text, unsubscribeUrl: mail.unsubscribeUrl, kind: 'weekly', customerId: c.id, sentBy: staffEmail ?? 'Automatic', runId })));
    } catch (err) {
      await release(batch); // e.g. no From address or API key: nothing in this batch went out
      throw err;
    }
    sent += ok.filter(Boolean).length;
    const undelivered = batch.filter((_, k) => !ok[k]);
    failed += undelivered.length;
    if (undelivered.length) await release(undelivered);
  }
  // Only the scheduled run closes the day, and only when nothing due failed: until then the hourly tick tries again
  // (for a few hours after the scheduled one), and last_emailed_on keeps those retries from emailing anyone twice.
  // A manual "Send now" never closes the day, so it never blocks the scheduled run.
  if (scheduled && !failed) {
    const { error: dErr } = await admin.from('settings').update({ pull_list_email_last_sent: today }).eq('id', 1);
    if (dErr) errors.push(`Couldn’t record today’s send as done: ${dErr.message}`);
  }
  if (errors.length) console.error('weekly email:', errors.join(' | '));
  return json(200, { sent, failed, sendingElsewhere: elsewhere, nothingToSend: due.length - mails.length, optedOut: customers.filter((c) => !c.email_opt_in).length, errors });
}

/** "Your books are in": one email per customer whose titles became ready for pickup since the last one. */
async function runArrivals(mode: string, customerId: number | undefined, staffEmail: string | null) {
  const { data: shop, error } = await loadShop();
  if (error) throw error;
  const shopBase = shop; // each customer's email overlays their own location on this
  const siteUrl = (Deno.env.get('SITE_URL') ?? '').replace(/\/$/, '');
  const app = await siteHasApp(siteUrl);
  const from = shop.pull_list_email_from || Deno.env.get('RESEND_FROM');
  const replyTo = shop.email || undefined;
  const holdDays = shop.hold_days ?? 30;

  const customers = await allCustomers(admin, 'id,first_name,name,email,ship_arrivals,notify_arrivals,unsubscribe_token,home_location_id');

  const select = 'id,quantity,status,arrived_on,arrival_notified_at,location_id,item:items(title,issue_number,variant,price,series_key),order:reservation_orders!inner(customer_id)';
  const lines = new Map<number, any[]>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error: lErr } = await admin.from('reservations').select(select).in('status', ACTIVE).not('order.customer_id', 'is', null).order('id').range(offset, offset + 999);
    if (lErr) throw lErr;
    for (const l of data) {
      const id = (l.order as { customer_id: number }).customer_id;
      lines.set(id, [...(lines.get(id) ?? []), l]);
    }
    if (data.length < 1000) break;
  }

  const follows = await seriesFollows(admin);
  const unsubUrl = (c: (typeof customers)[number]) => `${SUPABASE_URL}/functions/v1/weekly-pull-list?u=${c.unsubscribe_token}&k=arrivals`;
  const locs = await loadLocations();
  const compose = (c: (typeof customers)[number], customerLines: any[], sample = false, forStaff = false) => {
    const arrival = arrivalSections(customerLines, { holdDays, follows: follows.get(c.id) });
    if (!arrival) return null;
    // The store the waiting books are at (they stay put if the customer later changes home store), else their home store.
    const waiting = customerLines.find((l) => l.status === 'arrived' && !l.arrival_notified_at);
    const shop = withLocation(shopBase, locs.byId.get(waiting?.location_id ?? c.home_location_id) ?? locs.fallback, { multi: locs.multi });
    const unsubscribeUrl = forStaff ? `${siteUrl}/account.html` : unsubUrl(c); // a test must not carry the customer's real link
    return { unsubscribeUrl, ids: customerLines.filter((l) => l.status === 'arrived' && !l.arrival_notified_at).map((l) => l.id), ...buildArrival({ customer: c, arrival, shop, manageUrl: `${siteUrl}/account.html`, unsubscribeUrl, sample }) };
  };

  if (mode === 'arrivals_preview' || mode === 'arrivals_test') {
    // A customer with titles waiting to be announced, else a sample built from someone's open titles.
    let sample = customers.filter((c) => (customerId ? c.id === customerId : true) && compose(c, lines.get(c.id) ?? [])).sort((a, b) => (lines.get(b.id)?.length ?? 0) - (lines.get(a.id)?.length ?? 0))[0];
    let mail = sample ? compose(sample, lines.get(sample.id)!, false, true) : null;
    let isSample = false;
    if (!mail) {
      const { data: open } = await admin.from('reservations').select(select).in('status', ACTIVE).not('order.customer_id', 'is', null).order('id').limit(400);
      const byCustomer = new Map<number, any[]>();
      for (const l of open ?? []) byCustomer.set((l.order as { customer_id: number }).customer_id, [...(byCustomer.get((l.order as { customer_id: number }).customer_id) ?? []), l]);
      const pickId = (customerId && byCustomer.has(customerId)) ? customerId : [...byCustomer].sort((a, b) => b[1].length - a[1].length)[0]?.[0];
      sample = customers.find((c) => c.id === pickId)!;
      if (!sample) return json(404, { error: 'No customer has anything on their pull list to show yet.' });
      // Pretend the first few titles just arrived, for the preview only.
      const pretend = byCustomer.get(sample.id)!.slice(0, 4).map((l) => ({ ...l, status: 'arrived', arrival_notified_at: null, arrived_on: today(shop) }));
      mail = compose(sample, pretend, true, true);
      isSample = true;
    }
    if (!mail) return json(404, { error: 'Nothing to show yet.' });
    mail = { ...mail, ...asTest(mail, sample.name ?? sample.email) };
    if (mode === 'arrivals_preview') return json(200, { subject: mail.subject, html: mail.html, customer: sample.name ?? sample.email, sample: isSample });
    if (!staffEmail) return json(400, { error: 'Your account has no email address to send the test to.' });
    // No unsubscribeUrl: a test carries no List-Unsubscribe headers.
    await sendOne({ from, replyTo, to: staffEmail, subject: `[Test] ${mail.subject}`, html: mail.html, text: mail.text, kind: 'test', sentBy: staffEmail });
    return json(200, { sent: 1, to: staffEmail, customer: sample.name ?? sample.email, sample: isSample });
  }

  // arrivals: everyone who wants these emails and has something new
  const mails = customers
    .filter((c) => c.notify_arrivals)
    .map((c) => ({ c, mail: compose(c, lines.get(c.id) ?? []) }))
    .filter((m) => m.mail) as { c: (typeof customers)[number]; mail: NonNullable<ReturnType<typeof compose>> }[];
  // Claimed before sending, like the weekly email: each batch's titles are marked announced (only those not
  // marked yet, in one update), and an email goes out only if this run got all of its titles. So "Send now"
  // during the hourly tick, or two tabs, never announce the same titles twice. A failed send unmarks its titles
  // (only if they still carry this run's mark), so the next hour retries them.
  let sent = 0;
  let failed = 0;
  let elsewhere = 0; // claimed by another run going at the same time
  const errors: string[] = []; // bookkeeping writes that failed, reported in the result and the function log
  const runId = crypto.randomUUID(); // groups this run's emails in the email log
  const unmark = async (ids: number[], stamp: string) => {
    if (!ids.length) return;
    const { error: uErr } = await admin.from('reservations').update({ arrival_notified_at: null }).in('id', ids).eq('arrival_notified_at', stamp);
    if (uErr) errors.push(`Couldn’t reset ${ids.length} unsent ${ids.length === 1 ? 'title' : 'titles'} for a retry: ${uErr.message}`);
  };
  for (let i = 0; i < mails.length; i += 50) {
    const chunk = mails.slice(i, i + 50);
    const stamp = new Date().toISOString();
    const { data: claimed, error: cErr } = await admin.from('reservations').update({ arrival_notified_at: stamp })
      .in('id', chunk.flatMap(({ mail }) => mail.ids)).eq('status', 'arrived').is('arrival_notified_at', null).select('id');
    if (cErr) {
      errors.push(`Couldn’t mark titles as announced, so ${chunk.length} customers weren’t sent: ${cErr.message}`);
      failed += chunk.length;
      continue;
    }
    const { send: batch, release } = splitClaims(chunk.map((m) => ({ ...m, ids: m.mail.ids })), (claimed ?? []).map((r: { id: number }) => r.id));
    elsewhere += chunk.length - batch.length;
    await unmark(release, stamp);
    if (!batch.length) continue;
    let ok: boolean[];
    try {
      ok = await sendBatch(batch.map(({ c, mail }) => ({ from, replyTo, to: c.email!, subject: mail.subject, html: mail.html, text: mail.text, unsubscribeUrl: mail.unsubscribeUrl, kind: 'arrival', customerId: c.id, sentBy: staffEmail ?? 'Automatic', runId })));
    } catch (err) {
      await unmark(batch.flatMap((m) => m.ids), stamp); // e.g. no From address or API key: nothing in this batch went out
      throw err;
    }
    sent += ok.filter(Boolean).length;
    const undelivered = batch.filter((_, k) => !ok[k]);
    failed += undelivered.length;
    await unmark(undelivered.flatMap((m) => m.ids), stamp);
  }
  if (errors.length) console.error('arrival email:', errors.join(' | '));
  return json(200, { sent, failed, sendingElsewhere: elsewhere, customersWaiting: customers.filter((c) => c.notify_arrivals && compose(c, lines.get(c.id) ?? [])).length, errors });
}

const today = (shop: { timezone?: string }) => new Intl.DateTimeFormat('en-CA', { timeZone: shop.timezone || undefined }).format(new Date());

type Outgoing = {
  from?: string; replyTo?: string; to: string; subject: string; html: string; text: string;
  unsubscribeUrl?: string; // the customer's one-click unsubscribe (List-Unsubscribe headers); none on a test
  // for the email log (Admin -> Emails)
  kind: string; customerId?: number | null; sentBy?: string | null; runId?: string | null;
};

type LogRow = { kind: string; to_email: string; subject: string; body?: string | null; customer_id?: number | null; sent_by?: string | null; run_id?: string | null; status: 'sent' | 'failed'; error?: string | null };

/** Record emails in email_log. A logging problem must never stop or fail a send, so errors are only reported to the console. */
async function logEmails(rows: LogRow[]) {
  if (!rows.length) return;
  const { error } = await admin.from('email_log').insert(rows.map((r) => ({ ...r, body: r.body ? r.body.slice(0, 20000) : null, error: r.error ? r.error.slice(0, 500) : null })));
  if (error) console.error('email_log insert failed:', error.message);
}
const logRow = (m: Outgoing, error?: string): LogRow => ({ kind: m.kind, to_email: m.to, subject: m.subject, body: m.text, customer_id: m.customerId ?? null, sent_by: m.sentBy ?? null, run_id: m.runId ?? null, status: error ? 'failed' : 'sent', error });

const payload = (m: Outgoing) => {
  if (!m.from) throw new Error('Set the From address for the weekly email in Shop Settings first.');
  return {
    from: m.from,
    to: [m.to],
    subject: m.subject,
    html: m.html,
    text: m.text,
    ...(m.replyTo ? { reply_to: m.replyTo } : {}),
    ...(m.unsubscribeUrl ? { headers: { 'List-Unsubscribe': `<${m.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } } : {}),
  };
};

const resend = (path: string, body: unknown) => {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) throw new Error('RESEND_API_KEY isn’t set on the function yet.');
  return fetch(`https://api.resend.com${path}`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
};

async function sendOne(m: Outgoing) {
  try {
    const res = await resend('/emails', payload(m));
    if (!res.ok) throw new Error(`Resend: ${(await res.json().catch(() => ({}))).message ?? res.status}`);
  } catch (err) {
    await logEmails([logRow(m, err instanceof Error ? err.message : String(err))]);
    throw err;
  }
  await logEmails([logRow(m)]);
}

/** One request for up to 50 emails; if Resend rejects the batch, fall back to one at a time. Returns success per email. */
async function sendBatch(items: Outgoing[]): Promise<boolean[]> {
  const res = await resend('/emails/batch', items.map(payload));
  if (res.ok) {
    await logEmails(items.map((m) => logRow(m)));
    return items.map(() => true);
  }
  console.warn('Batch rejected, sending individually:', res.status, await res.text().catch(() => ''));
  const ok: boolean[] = [];
  for (const m of items) {
    try {
      await sendOne(m);
      ok.push(true);
    } catch (err) {
      console.error('Send failed for one customer:', err);
      ok.push(false);
    }
    await new Promise((r) => setTimeout(r, 600)); // Resend allows ~2 requests a second
  }
  return ok;
}

// A GET only shows a button: mail scanners often open links, and that must not unsubscribe anyone.
// kind 'weekly' (default) stops the weekly pull list email; 'arrivals' stops the "your books are in" emails.
async function unsubscribe(req: Request, token: string, kind: 'weekly' | 'arrivals') {
  const what = kind === 'arrivals' ? '“your books are in” email' : 'weekly pull list email';
  if (!UUID.test(token)) return page('Link not recognised', '<p>This unsubscribe link isn’t valid. Log in to your account to change your email settings.</p>');
  if (req.method === 'POST') {
    const { error } = await admin.from('customers').update(kind === 'arrivals' ? { notify_arrivals: false } : { email_opt_in: false }).eq('unsubscribe_token', token);
    if (error) return page('Something went wrong', '<p>We couldn’t update your settings. Please try again, or log in to your account to turn the email off.</p>');
    return page('You’re unsubscribed', `<p>You won’t get the ${what} any more. Your pull list itself hasn’t changed. You can turn it back on any time in your profile.</p>`);
  }
  return page(`Unsubscribe from the ${what}?`, `<form method="post"><button style="font:bold 16px Arial;padding:12px 20px;cursor:pointer">Yes, unsubscribe me</button></form>`);
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * "Skip this one" from the weekly email or a notification: takes a title a follow added off the customer's pull list
 * and remembers it so the follow doesn't add it back (public.skip_followed_line). A GET only shows what it would skip
 * and a button: mail scanners open links, and that must not skip anything. A POST does it; the page answers in HTML,
 * or in JSON for the app's notification button (which asks with Accept: application/json or a text/plain body).
 */
async function skipTitle(req: Request, token: string, lineParam: string) {
  const line = /^\d{1,15}$/.test(lineParam) ? Number(lineParam) : 0;
  const wantsJson = req.method === 'POST' && !(req.headers.get('content-type') ?? '').includes('form');
  const answer = (result: string, title: string, heading: string, body: string) =>
    wantsJson ? json(200, { result, title }) : page(heading, `<p>${body}</p>`);
  const bad = () => answer('invalid', '', 'Link not recognised', 'This link isn’t valid any more. Log in to your account to change your pull list.');
  if (!UUID.test(token) || !line) return bad();
  if (req.method === 'POST') {
    const { data, error } = await admin.rpc('skip_followed_line', { p_token: token, p_line: line });
    if (error) {
      console.error('skip_followed_line', error);
      return wantsJson ? json(500, { error: 'Try again.' }) : page('Something went wrong', '<p>We couldn’t skip that title. Please try again, or log in to your account to remove it.</p>');
    }
    const { result, title } = data as { result: string; title?: string };
    const t = esc(title ?? 'That title');
    if (result === 'skipped') return answer(result, title ?? '', 'Skipped', `${t} is off your pull list, and it won’t be added again. You still follow the series or artist, so their other issues will keep coming.`);
    if (result === 'already') return answer(result, title ?? '', 'Already skipped', `${t} isn’t on your pull list any more.`);
    if (result === 'closed') return answer(result, title ?? '', 'Too late to skip', `The order for ${t} is already in. Please call the shop to change it.`);
    return bad();
  }
  // A GET names the title first (the token proves who is asking; nothing is changed).
  const { data: who } = await admin.from('customers').select('id').eq('unsubscribe_token', token).maybeSingle();
  const { data: row } = who
    ? await admin
        .from('reservations')
        .select('status,source,item:items(title,issue_number),order:reservation_orders!inner(customer_id)')
        .eq('id', line)
        .eq('order.customer_id', who.id)
        .in('source', ['series', 'artist'])
        .maybeSingle()
    : { data: null };
  const item = row?.item as { title: string; issue_number: string | null } | null | undefined;
  if (!row || !item) return bad();
  const name = esc(item.title + (item.issue_number ? ` #${item.issue_number}` : ''));
  if (row.status === 'cancelled') return page('Already skipped', `<p>${name} isn’t on your pull list any more.</p>`);
  return page(`Skip ${name}?`, `<p>It will come off your pull list and won’t be added again. You’ll still follow the series or artist.</p><form method="post"><button style="font:bold 16px Arial;padding:12px 20px;cursor:pointer">Yes, skip it</button></form>`);
}
