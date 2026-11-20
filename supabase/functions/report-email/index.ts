// Staff reports by email, sent from the master catalog's server: the daily left-out lists and the daily status report
// (tools/catalog-job.mjs sendEmail, called by the GitHub Actions that build them). Sent through Resend from
// REPORT_FROM (default "Pullwise Reports <reports@pullwise.shop>"), and recorded in this project's Admin → Emails.
//
// POST JSON { to: string[], subject, html, text, attachments?: [{ filename, content (base64) }], kind, sent_by }
// Only callers holding this project's service key may send (the Actions read it with SUPABASE_ACCESS_TOKEN, as the
// nightly backup does): it is checked here, so the function is deployed without Supabase's JWT check
// (supabase/config.toml). Secrets: RESEND_API_KEY (Resend, with the sending domain verified), REPORT_FROM (optional).
// Every shop's project gets the function with the deploy; only the catalog's is called.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin = createClient(Deno.env.get('SUPABASE_URL')!, SERVICE_KEY, { auth: { persistSession: false } });
const FROM = Deno.env.get('REPORT_FROM')?.trim() || 'Pullwise Reports <reports@pullwise.shop>';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const KINDS = new Set(['left_out', 'status_report']);
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Constant-time comparison, so the key can't be guessed a character at a time from response times. */
function same(a: string, b: string) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token || !same(token, SERVICE_KEY)) return json(401, { error: 'Not allowed' });

  let body: { to?: unknown; subject?: unknown; html?: unknown; text?: unknown; attachments?: unknown; kind?: unknown; sent_by?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'Send JSON' });
  }
  const to = Array.isArray(body.to) ? body.to.map(String).map((s) => s.trim()).filter(Boolean) : [];
  const subject = typeof body.subject === 'string' ? body.subject.slice(0, 300) : '';
  const text = typeof body.text === 'string' ? body.text : '';
  const html = typeof body.html === 'string' ? body.html : '';
  const kind = typeof body.kind === 'string' && KINDS.has(body.kind) ? body.kind : null;
  const attachments = Array.isArray(body.attachments)
    ? body.attachments.filter((a): a is { filename: string; content: string } => typeof a?.filename === 'string' && typeof a?.content === 'string').slice(0, 5)
    : [];
  if (!to.length || to.length > 10 || !to.every((a) => EMAIL.test(a))) return json(400, { error: 'to: 1 to 10 email addresses' });
  if (!subject || !text || !kind) return json(400, { error: 'subject, text and kind (left_out or status_report) are needed' });

  const key = Deno.env.get('RESEND_API_KEY');
  let error: string | null = null;
  if (!key) error = 'RESEND_API_KEY isn’t set on the catalog (Supabase → Edge Functions → Secrets)';
  else {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to, subject, html: html || undefined, text, attachments: attachments.length ? attachments : undefined }),
    }).catch((err) => ({ ok: false, status: 0, json: async () => ({ message: String(err) }) }) as unknown as Response);
    if (!res.ok) error = `Resend: ${(await res.json().catch(() => ({}))).message ?? res.status}`;
  }
  const logged = await admin.from('email_log').insert({
    kind, to_email: to.join(', '), subject, body: text.slice(0, 20000), status: error ? 'failed' : 'sent', error,
    sent_by: typeof body.sent_by === 'string' ? body.sent_by.slice(0, 100) : 'Report',
  });
  if (logged.error) console.error('email_log insert failed:', logged.error.message);
  return error ? json(502, { error }) : json(200, { ok: true, from: FROM });
});
