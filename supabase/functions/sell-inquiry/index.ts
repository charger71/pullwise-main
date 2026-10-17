// "Sell Your Stuff" form: emails the shop a customer's contact details, a description of their
// collection and up to 8 photos (attached). Reply-To is the customer, so staff just hit Reply.
//
// POST multipart/form-data: name, email, phone?, location?, details, photos[] (images), website (honeypot, must be empty)
//
// Goes to settings.email, plus any addresses in the optional STAFF_CC secret (comma-separated). Secrets: RESEND_API_KEY; From is settings.pull_list_email_from or RESEND_FROM.
// Deploy with:  supabase functions deploy sell-inquiry --no-verify-jwt

import { createClient } from 'npm:@supabase/supabase-js@2';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const MAX_PHOTOS = 8;
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;
const ALSO_TO = (Deno.env.get('STAFF_CC') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function b64(bytes: Uint8Array) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  try {
    const form = await req.formData();
    // Bots fill in the hidden field; pretend it worked.
    if (String(form.get('website') ?? '').trim()) return json(200, { ok: true });

    const field = (k: string, max: number) => String(form.get(k) ?? '').trim().slice(0, max);
    const name = field('name', 100), email = field('email', 200), phone = field('phone', 40), location = field('location', 200), details = field('details', 4000);
    if (!name) return json(400, { error: 'Please tell us your name.' });
    if (!EMAIL.test(email)) return json(400, { error: 'Please enter a valid email address so we can reply.' });
    if (!details && !form.getAll('photos').length) return json(400, { error: 'Please describe your collection or add a few photos.' });

    const files = form.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length > MAX_PHOTOS) return json(400, { error: `Please send no more than ${MAX_PHOTOS} photos.` });
    if (files.reduce((n, f) => n + f.size, 0) > MAX_TOTAL_BYTES) return json(400, { error: 'Those photos add up to more than 25 MB — please send fewer or smaller ones.' });
    const attachments = [];
    for (const f of files) {
      if (f.size > MAX_PHOTO_BYTES) return json(400, { error: `${f.name} is too large (6 MB max per photo).` });
      const bytes = new Uint8Array(await f.arrayBuffer());
      const type = imageType(bytes);
      if (!type) return json(400, { error: 'Only photos (JPEG, PNG, GIF, WebP or HEIC) can be attached.' });
      // The name always ends in the detected type, whatever the upload called itself.
      const base = f.name.replace(/\.[^.]*$/, '').replace(/[^\w.\- ]/g, '_').slice(0, 70) || 'photo';
      attachments.push({ filename: `${base}.${type.ext}`, content: b64(bytes) });
    }

    // Rate limit last, so a typo the customer fixes doesn't use up a try.
    const { data: allowed, error: rateErr } = await admin.rpc('sell_inquiry_rate_ok', { p_ip: clientIp(req) || null });
    if (rateErr) throw rateErr;
    if (!allowed) return json(429, { error: 'We’ve had a lot of messages just now — please try again in an hour, or call the shop.' });

    const { data: shop, error } = await admin.from('settings').select('email,pull_list_email_from').eq('id', 1).single();
    if (error) throw error;
    const to = [...new Set([shop.email, ...ALSO_TO].filter(Boolean))];
    const from = shop.pull_list_email_from || Deno.env.get('RESEND_FROM');
    const key = Deno.env.get('RESEND_API_KEY');
    if (!to.length || !from || !key) throw new Error('Email isn’t set up on the server yet.');

    const rows = [['Name', name], ['Email', email], ['Phone', phone], ['Where they are', location]].filter(([, v]) => v);
    const html = `<table cellpadding="4" style="font:15px Arial,sans-serif">${rows.map(([k, v]) => `<tr><td><b>${k}</b></td><td>${esc(v)}</td></tr>`).join('')}</table>
      <p style="font:15px/1.5 Arial,sans-serif;white-space:pre-wrap">${esc(details) || '<i>No description.</i>'}</p>
      <p style="font:13px Arial,sans-serif;color:#666">${attachments.length} photo${attachments.length === 1 ? '' : 's'} attached. Hit Reply to answer ${esc(name)} directly.</p>`;
    const text = `${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${details}\n\n${attachments.length} photo(s) attached.`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, reply_to: email, subject: `Collection for sale: ${name}`, html, text, attachments }),
    });
    const failure = res.ok ? null : `Resend: ${(await res.json().catch(() => ({}))).message ?? res.status}`;
    // The email log (Admin -> Emails); a logging problem must not change the customer's result.
    const logged = await admin.from('email_log').insert({ kind: 'inquiry', to_email: to.join(', '), subject: `Collection for sale: ${name}`, body: text.slice(0, 20000), status: failure ? 'failed' : 'sent', error: failure, sent_by: 'Sell form' });
    if (logged.error) console.error('email_log insert failed:', logged.error.message);
    if (failure) throw new Error(failure);
    return json(200, { ok: true });
  } catch (err) {
    console.error(err);
    return json(500, { error: 'Sorry, that didn’t go through. Please try again, or call or visit the shop.' });
  }
});
