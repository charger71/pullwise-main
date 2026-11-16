// /__unsubscribe on a shop's own domain: the unsubscribe and "Skip this one" links in its emails. They are handed on to the
// shop's own weekly-pull-list function (which checks the token and does the work), so the link a customer sees and the
// List-Unsubscribe header are on the shop's domain instead of supabase.co. Mail with links to a domain other than the
// sender's is more likely to be filed as spam.
//
// Only the three query values the function reads (u, k, skip) and the request's body are handed on, and only to this
// shop's Supabase project: nothing in the request chooses where it goes. The pages carry a customer's token in their
// address, so they are never cached and never leak it in a Referer.

const FUNCTION_PATH = '/functions/v1/weekly-pull-list';
const PARAMS = ['u', 'k', 'skip'];
const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'";

export async function unsubscribeProxy(request, shop, fetchFn = fetch) {
  const method = request.method === 'HEAD' ? 'GET' : request.method;
  if (method !== 'GET' && method !== 'POST') return new Response('Not found', { status: 404, headers: { Allow: 'GET, POST' } });
  const here = new URL(request.url);
  const target = new URL(`${shop.supabaseUrl}${FUNCTION_PATH}`);
  for (const name of PARAMS) if (here.searchParams.has(name)) target.searchParams.set(name, here.searchParams.get(name));
  if (!target.searchParams.has('u')) return new Response('Not found', { status: 404 });

  const headers = new Headers({ apikey: shop.anonKey });
  for (const name of ['content-type', 'accept']) if (request.headers.has(name)) headers.set(name, request.headers.get(name));
  const res = await fetchFn(target, {
    method,
    headers,
    body: method === 'POST' ? await request.arrayBuffer() : undefined,
    redirect: 'manual',
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!res) return new Response('Please try again in a moment.', { status: 502, headers: { 'Cache-Control': 'no-store' } });

  const out = new Headers({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
  const type = res.headers.get('Content-Type') ?? 'text/plain';
  let body = request.method === 'HEAD' ? null : res.body;
  // Supabase serves a function's HTML as plain text on its own domain; it is this shop's own page, so say what it is.
  if (/^text\/plain/i.test(type) && request.method !== 'HEAD') {
    const text = await res.text();
    const html = /^\s*<!doctype html/i.test(text);
    body = text;
    out.set('Content-Type', html ? 'text/html; charset=utf-8' : type);
    if (html) out.set('Content-Security-Policy', PAGE_CSP);
  } else {
    out.set('Content-Type', type);
    if (/^text\/html/i.test(type)) out.set('Content-Security-Policy', PAGE_CSP);
  }
  return new Response(body, { status: res.status, headers: out });
}
