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
//   GET/POST ?u=<unsubscribe token>[&k=arrivals]   the unsubscribe page and its one-click POST
//           (k=arrivals stops only the arrival emails; otherwise the weekly email)
//
// Secrets (supabase secrets set …): RESEND_API_KEY, CRON_SECRET; optional SITE_URL, RESEND_FROM.
// Deploy with:  supabase functions deploy weekly-pull-list --no-verify-jwt

import { createClient } from 'npm:@supabase/supabase-js@2';
import { build, sections, buildArrival, arrivalSections, buildMessage } from './email.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const url = new URL(req.url);
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
  const mode = isCron ? (['arrivals', 'event_signup'].includes(body.mode) ? body.mode : 'send') : body.mode;
  if (!['preview', 'test', 'send', 'arrivals', 'arrivals_preview', 'arrivals_test', 'message', 'event_signup'].includes(mode)) return json(400, { error: 'Unknown mode.' });
  if (mode === 'event_signup' && !isCron) return json(403, { error: 'Not allowed.' });

  try {
    if (mode === 'event_signup') return await sendEventSignup(Number(body.signup_id));
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
  const { data: shop, error } = await admin.from('settings').select('*').eq('id', 1).single();
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

/** A new event signup: a confirmation to the customer, and a notification (Reply goes to the customer) to the shop. */
async function sendEventSignup(signupId: number) {
  if (!Number.isInteger(signupId)) return json(400, { error: 'Missing signup.' });
  const { data: su, error } = await admin.from('event_signups').select('*, event:events(*)').eq('id', signupId).single();
  if (error) throw error;
  const { data: shop, error: sErr } = await admin.from('settings').select('*').eq('id', 1).single();
  if (sErr) throw sErr;
  const from = shop.pull_list_email_from || Deno.env.get('RESEND_FROM');
  if (!from) return json(500, { error: 'Set the From address in Admin → Emails first.' });
  const ev = su.event;
  const tz = shop.timezone || undefined;
  const when = `${new Date(ev.starts_at).toLocaleDateString('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} at ${new Date(ev.starts_at).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })}`;
  const where = ev.location || shop.shop_name;
  const people = su.party_size === 1 ? '1 person' : `${su.party_size} people`;
  const siteUrl = (Deno.env.get('SITE_URL') ?? '').replace(/\/$/, '');

  const confirmSubject = `You're signed up: ${ev.title}`;
  const confirm = buildMessage({
    shop, subject: confirmSubject,
    message: `Hi ${su.name},\n\nYou're signed up for ${ev.title}.\n\nWhen: ${when}\nWhere: ${where}\nSpots held: ${people}\n\nEvent details: ${siteUrl}/event.html?id=${ev.id}\n\nNeed to change or cancel? Just reply to this email or call the shop${shop.phone ? ` at ${shop.phone}` : ''}.`,
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
  const { data: shop, error } = await admin.from('settings').select('*').eq('id', 1).single();
  if (error) throw error;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: shop.timezone || undefined }).format(new Date());
  const siteUrl = (Deno.env.get('SITE_URL') ?? '').replace(/\/$/, '');
  const from = shop.pull_list_email_from || Deno.env.get('RESEND_FROM');
  const replyTo = shop.email || undefined;

  // Everyone with an email, and all their live pull-list lines.
  const { data: customers, error: cErr } = await admin.from('customers').select('id,first_name,name,email,ship_arrivals,email_opt_in,unsubscribe_token,last_emailed_on').not('email', 'is', null);
  if (cErr) throw cErr;
  const lines = new Map<number, unknown[]>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error: lErr } = await admin
      .from('reservations')
      .select('quantity,status,arrived_on,source,created_at,item:items(title,issue_number,variant,release_date,foc_date,price,series_key),order:reservation_orders!inner(customer_id)')
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

  const compose = (c: (typeof customers)[number]) => {
    const sec = sections((lines.get(c.id) ?? []) as never[], { today, holdDays: shop.hold_days ?? 30 });
    if (!sec) return null;
    const unsubscribeUrl = `${SUPABASE_URL}/functions/v1/weekly-pull-list?u=${c.unsubscribe_token}`;
    return { unsubscribeUrl, ...build({ customer: c, sections: sec, shop, today, manageUrl: `${siteUrl}/account.html`, unsubscribeUrl }) };
  };

  if (mode === 'preview' || mode === 'test') {
    // A sample customer: the one asked for, else whoever has the fullest pull list.
    const pool = customers.filter((c) => (customerId ? c.id === customerId : true) && compose(c));
    const sample = customerId ? pool[0] : pool.sort((a, b) => (lines.get(b.id)?.length ?? 0) - (lines.get(a.id)?.length ?? 0))[0];
    if (!sample) return json(404, { error: 'No customer has anything on their pull list to show yet.' });
    const mail = compose(sample)!;
    if (mode === 'preview') return json(200, { subject: mail.subject, html: mail.html, customer: sample.name ?? sample.email });
    if (!staffEmail) return json(400, { error: 'Your account has no email address to send the test to.' });
    await sendOne({ from, replyTo, to: staffEmail, subject: `[Test] ${mail.subject}`, html: mail.html, text: mail.text, unsubscribeUrl: mail.unsubscribeUrl, kind: 'test', sentBy: staffEmail });
    return json(200, { sent: 1, to: staffEmail, customer: sample.name ?? sample.email });
  }

  // send: everyone opted in who hasn't had today's email and has something to report
  const due = customers.filter((c) => c.email_opt_in && c.last_emailed_on !== today);
  const mails = due.map((c) => ({ c, mail: compose(c) })).filter((m) => m.mail) as { c: (typeof customers)[number]; mail: NonNullable<ReturnType<typeof compose>> }[];
  let sent = 0;
  let failed = 0;
  const runId = crypto.randomUUID(); // groups this run's emails in the email log
  for (let i = 0; i < mails.length; i += 50) {
    const chunk = mails.slice(i, i + 50);
    const ok = await sendBatch(chunk.map(({ c, mail }) => ({ from, replyTo, to: c.email!, subject: mail.subject, html: mail.html, text: mail.text, unsubscribeUrl: mail.unsubscribeUrl, kind: 'weekly', customerId: c.id, sentBy: staffEmail ?? 'Automatic', runId })));
    const delivered = chunk.filter((_, k) => ok[k]);
    sent += delivered.length;
    failed += chunk.length - delivered.length;
    if (delivered.length) await admin.from('customers').update({ last_emailed_on: today }).in('id', delivered.map(({ c }) => c.id));
  }
  // Only a clean run closes the day for the scheduler; a manual run never blocks the scheduled one.
  if (scheduled || !failed) await admin.from('settings').update({ pull_list_email_last_sent: today }).eq('id', 1);
  return json(200, { sent, failed, nothingToSend: due.length - mails.length, optedOut: customers.filter((c) => !c.email_opt_in).length });
}

/** "Your books are in": one email per customer whose titles became ready for pickup since the last one. */
async function runArrivals(mode: string, customerId: number | undefined, staffEmail: string | null) {
  const { data: shop, error } = await admin.from('settings').select('*').eq('id', 1).single();
  if (error) throw error;
  const siteUrl = (Deno.env.get('SITE_URL') ?? '').replace(/\/$/, '');
  const from = shop.pull_list_email_from || Deno.env.get('RESEND_FROM');
  const replyTo = shop.email || undefined;
  const holdDays = shop.hold_days ?? 30;

  const { data: customers, error: cErr } = await admin.from('customers').select('id,first_name,name,email,ship_arrivals,notify_arrivals,unsubscribe_token').not('email', 'is', null);
  if (cErr) throw cErr;

  const select = 'id,quantity,status,arrived_on,arrival_notified_at,item:items(title,issue_number,variant,price,series_key),order:reservation_orders!inner(customer_id)';
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

  const unsubUrl = (c: (typeof customers)[number]) => `${SUPABASE_URL}/functions/v1/weekly-pull-list?u=${c.unsubscribe_token}&k=arrivals`;
  const compose = (c: (typeof customers)[number], customerLines: any[], sample = false) => {
    const arrival = arrivalSections(customerLines, { holdDays });
    if (!arrival) return null;
    const unsubscribeUrl = unsubUrl(c);
    return { unsubscribeUrl, ids: customerLines.filter((l) => l.status === 'arrived' && !l.arrival_notified_at).map((l) => l.id), ...buildArrival({ customer: c, arrival, shop, manageUrl: `${siteUrl}/account.html`, unsubscribeUrl, sample }) };
  };

  if (mode === 'arrivals_preview' || mode === 'arrivals_test') {
    // A customer with titles waiting to be announced, else a sample built from someone's open titles.
    let sample = customers.filter((c) => (customerId ? c.id === customerId : true) && compose(c, lines.get(c.id) ?? [])).sort((a, b) => (lines.get(b.id)?.length ?? 0) - (lines.get(a.id)?.length ?? 0))[0];
    let mail = sample ? compose(sample, lines.get(sample.id)!) : null;
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
      mail = compose(sample, pretend, true);
      isSample = true;
    }
    if (!mail) return json(404, { error: 'Nothing to show yet.' });
    if (mode === 'arrivals_preview') return json(200, { subject: mail.subject, html: mail.html, customer: sample.name ?? sample.email, sample: isSample });
    if (!staffEmail) return json(400, { error: 'Your account has no email address to send the test to.' });
    await sendOne({ from, replyTo, to: staffEmail, subject: `[Test] ${mail.subject}`, html: mail.html, text: mail.text, unsubscribeUrl: mail.unsubscribeUrl, kind: 'test', sentBy: staffEmail });
    return json(200, { sent: 1, to: staffEmail, customer: sample.name ?? sample.email, sample: isSample });
  }

  // arrivals: everyone who wants these emails and has something new
  const mails = customers
    .filter((c) => c.notify_arrivals)
    .map((c) => ({ c, mail: compose(c, lines.get(c.id) ?? []) }))
    .filter((m) => m.mail) as { c: (typeof customers)[number]; mail: NonNullable<ReturnType<typeof compose>> }[];
  let sent = 0;
  let failed = 0;
  const runId = crypto.randomUUID(); // groups this run's emails in the email log
  for (let i = 0; i < mails.length; i += 50) {
    const chunk = mails.slice(i, i + 50);
    const ok = await sendBatch(chunk.map(({ c, mail }) => ({ from, replyTo, to: c.email!, subject: mail.subject, html: mail.html, text: mail.text, unsubscribeUrl: mail.unsubscribeUrl, kind: 'arrival', customerId: c.id, sentBy: staffEmail ?? 'Automatic', runId })));
    const delivered = chunk.filter((_, k) => ok[k]);
    sent += delivered.length;
    failed += chunk.length - delivered.length;
    // Only titles that were actually announced are marked, so a failed send is retried next hour.
    const ids = delivered.flatMap(({ mail }) => mail.ids);
    if (ids.length) await admin.from('reservations').update({ arrival_notified_at: new Date().toISOString() }).in('id', ids);
  }
  return json(200, { sent, failed, customersWaiting: customers.filter((c) => c.notify_arrivals && compose(c, lines.get(c.id) ?? [])).length });
}

const today = (shop: { timezone?: string }) => new Intl.DateTimeFormat('en-CA', { timeZone: shop.timezone || undefined }).format(new Date());

type Outgoing = {
  from?: string; replyTo?: string; to: string; subject: string; html: string; text: string; unsubscribeUrl: string;
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
    headers: { 'List-Unsubscribe': `<${m.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
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
