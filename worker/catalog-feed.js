// GET /catalog.json: the public, read-only catalog feed (catalog shop only; worker/index.js routes it).
//
// The feed asks Supabase's REST API with the shop's public anon key, so row-level security still applies (hidden
// titles never come back), and every request names the columns it wants: COLUMNS below is the allowlist, and
// nothing outside it can reach the response. No service-role key is involved anywhere.
//
// Everything that isn't I/O is a pure function so Node can test it (worker/catalog-feed.test.js).

import { searchWords } from '../js/util.js';
import { siteUrl } from './shop-page.js';

export const CATALOG_FEED_PATH = '/catalog.json';

export const DEFAULT_LIMIT = 500;
export const MAX_LIMIT = 1000;
const MAX_OFFSET = 1_000_000;
const MAX_Q_LENGTH = 100;
const CACHE_SECONDS = 300;
const FETCH_TIMEOUT_MS = 5000;
const SERIES_CHUNK = 100;

/** The only `items` columns the feed ever reads. Customer data, costs, notes and distributor SKUs aren't in here. */
export const COLUMNS = ['id', 'title', 'issue_number', 'series_key', 'publisher', 'distributor', 'foc_date', 'release_date', 'price', 'variant', 'cover_url'];
/** Embedded rows of `item_creators` (name and role only). */
export const CREATOR_COLUMNS = ['name', 'role'];
/** What the feed asks of `series_catalog`. */
export const SERIES_COLUMNS = ['key', 'title'];

const SELECT = `${COLUMNS.join(',')},item_creators(${CREATOR_COLUMNS.join(',')})`;
// foc_date, publisher, title, then issue and cover (the variant text starts with "CVR A", "CVR B", …, no variant = main cover first).
const ORDER = 'foc_date.asc.nullslast,publisher.asc.nullslast,title.asc,issue_number.asc.nullsfirst,variant.asc.nullsfirst,id.asc';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Max-Age': '86400' };
const JSON_TYPE = 'application/json; charset=utf-8';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/** A real calendar date written YYYY-MM-DD (2026-02-30 is not one). */
export function isIsoDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const intParam = (raw) => (/^\d{1,9}$/.test(raw) ? Number(raw) : NaN);

/** Validated filters from a query string: { foc, release, q, limit, offset } or { error: message }. */
export function parseParams(params) {
  const out = { foc: null, release: null, q: null, limit: DEFAULT_LIMIT, offset: 0 };
  for (const name of ['foc', 'release']) {
    const v = params.get(name);
    if (v === null) continue;
    if (!isIsoDate(v)) return { error: `"${name}" must be a real date written YYYY-MM-DD.` };
    out[name] = v;
  }
  const q = params.get('q');
  if (q !== null && q.trim()) {
    if (q.length > MAX_Q_LENGTH) return { error: `"q" can be at most ${MAX_Q_LENGTH} characters.` };
    out.q = q.trim();
  }
  const limit = params.get('limit');
  if (limit !== null) {
    out.limit = intParam(limit);
    if (!(out.limit >= 1 && out.limit <= MAX_LIMIT)) return { error: `"limit" must be a whole number from 1 to ${MAX_LIMIT}.` };
  }
  const offset = params.get('offset');
  if (offset !== null) {
    out.offset = intParam(offset);
    if (!(out.offset >= 0 && out.offset <= MAX_OFFSET)) return { error: `"offset" must be a whole number from 0 to ${MAX_OFFSET}.` };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Supabase query
// ---------------------------------------------------------------------------

/**
 * The PostgREST query for the items: pre-orders staff haven't hidden whose cutoff hasn't passed (a title with no FOC
 * date yet stays in, as on the Pre-Orders page), plus the filters. Asks for one row more than `limit` to know
 * whether there is a next page.
 */
export function itemsQuery(f, today) {
  const p = new URLSearchParams();
  p.set('select', SELECT);
  p.set('hidden', 'eq.false');
  p.set('status', 'eq.pre_order');
  p.set('or', `(foc_date.is.null,foc_date.gte.${today})`);
  if (f.foc) p.set('foc_date', `eq.${f.foc}`);
  if (f.release) p.set('release_date', `eq.${f.release}`);
  // Same forgiving match as the site: every word, punctuation and case ignored, against the title or the series.
  // Words are letters and digits only, so there is nothing to escape.
  const words = f.q ? searchWords(f.q) : [];
  if (f.q && !words.length) return null; // "!!!" matches nothing, as on the site
  if (words.length) p.set('and', `(${words.map((w) => `or(title_squash.like.*${w}*,series_key.like.*${w}*)`).join(',')})`);
  p.set('order', ORDER);
  p.set('limit', String(f.limit + 1));
  p.set('offset', String(f.offset));
  return p.toString();
}

/** `in.("a","b")` for PostgREST, with the quotes and backslashes of each value escaped. */
const inList = (values) => `in.(${values.map((v) => `"${v.replace(/[\\"]/g, '\\$&')}"`).join(',')})`;

export function seriesQuery(keys) {
  const p = new URLSearchParams();
  p.set('select', SERIES_COLUMNS.join(','));
  p.set('key', inList(keys));
  return p.toString();
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const DISTRIBUTORS = { lunar: 'Lunar', prh: 'PRH', other: 'Other' };
// Same ratio / incentive patterns as the importer (js/import/distributors.js).
const INCENTIVE = /\b1:\d+\b|\bINCV?\b|\bRI\b|\bRATIO\b|\bINCENTIVE\b|\b\d+\s*COPY\b/i;

const blank = (v) => (v === null || v === undefined || String(v).trim() === '' ? null : v);

/** The cover letter in "CVR B J SCOTT CAMPBELL" / "COVER B", upper case; null when the variant doesn't say. */
export const coverLetter = (variant) => /\b(?:CVR|COVER)\s+([A-Z])\b/i.exec(variant ?? '')?.[1].toUpperCase() ?? null;
/** The ratio in "CVR D 1:25 INCV", as "1:25"; null when the variant doesn't give one. */
export const ratioOf = (variant) => /\b(1:\d+)\b/.exec(variant ?? '')?.[1] ?? null;

/** One feed item from an `items` row (with its embedded item_creators) and the series title, when there is one. */
export function shapeItem(row, shop, seriesTitle = null) {
  const variant = blank(row.variant);
  const coverArtists = (row.item_creators ?? []).filter((c) => c.role === 'cover' && blank(c.name)).map((c) => c.name);
  return {
    id: String(row.id),
    title: row.title,
    issue: blank(row.issue_number),
    series: blank(seriesTitle),
    publisher: blank(row.publisher),
    distributor: DISTRIBUTORS[row.distributor] ?? null,
    foc_date: row.foc_date ?? null,
    release_date: row.release_date ?? null,
    price: row.price === null || row.price === undefined ? null : Number(row.price),
    cover: coverLetter(variant),
    variant_description: variant,
    is_ratio_variant: INCENTIVE.test(variant ?? ''),
    ratio: ratioOf(variant),
    creators: { cover_artist: coverArtists.length ? coverArtists : null },
    cover_image_url: blank(row.cover_url),
    url: `${siteUrl(shop)}/pre-orders.html?title=${encodeURIComponent(row.id)}`,
  };
}

/** The first foc_date, publisher, title, … order is the database's; this only fills in the page and `next`. */
export function buildFeed({ rows, filters, shop, seriesTitles = new Map(), now = new Date() }) {
  const page = rows.slice(0, filters.limit);
  const body = {
    generated_at: now.toISOString(),
    count: page.length,
    filters: { foc: filters.foc, release: filters.release, q: filters.q },
    items: page.map((r) => shapeItem(r, shop, seriesTitles.get(r.series_key))),
  };
  if (rows.length > filters.limit) body.next = nextUrl(shop, filters);
  return body;
}

function nextUrl(shop, f) {
  const p = new URLSearchParams();
  if (f.foc) p.set('foc', f.foc);
  if (f.release) p.set('release', f.release);
  if (f.q) p.set('q', f.q);
  p.set('limit', String(f.limit));
  p.set('offset', String(f.offset + f.limit));
  return `${siteUrl(shop)}${CATALOG_FEED_PATH}?${p}`;
}

// ---------------------------------------------------------------------------
// Request handling
// ---------------------------------------------------------------------------

function reply(status, body, { request, headers = {} } = {}) {
  const text = JSON.stringify(body, null, 2);
  return new Response(request?.method === 'HEAD' ? null : text, { status, headers: { 'Content-Type': JSON_TYPE, ...CORS, ...headers } });
}

const failure = (status, code, message, request, headers = {}) =>
  reply(status, { error: { code, message } }, { request, headers: { 'Cache-Control': 'no-store', ...headers } });

/**
 * @param {Request} request
 * @param {object} shop   the catalog shop from shops.json
 * @param {object} env    Worker bindings; CATALOG_RATE_LIMIT (a Workers rate limiting binding), when present, is applied per client
 * @param {object} [deps] fetch, cache (the Cache API) and now: for tests
 */
export async function catalogFeed(request, shop, env = {}, { fetch: doFetch = fetch, cache = globalThis.caches?.default, now = new Date(), waitUntil = () => {} } = {}) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'GET' && request.method !== 'HEAD') return failure(405, 'method_not_allowed', 'This feed is read-only: use GET.', request, { Allow: 'GET, HEAD, OPTIONS' });

  const url = new URL(request.url);
  const filters = parseParams(url.searchParams);
  if (filters.error) return failure(400, 'bad_request', filters.error, request);

  if (env.CATALOG_RATE_LIMIT) {
    const client = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    const { success } = await env.CATALOG_RATE_LIMIT.limit({ key: client });
    if (!success) return failure(429, 'rate_limited', 'Too many requests. Try again in a minute.', request, { 'Retry-After': '60' });
  }

  // A repeat of the same question within five minutes is answered from the edge cache, without asking Supabase.
  const cacheKey = new Request(`https://catalog-feed.internal${url.pathname}${[...url.searchParams].length ? `?${new URLSearchParams([...url.searchParams].sort())}` : ''}`);
  const hit = await cache?.match(cacheKey);
  if (hit) return reply(200, await hit.json(), { request, headers: { 'Cache-Control': `public, max-age=${CACHE_SECONDS}` } });

  let body;
  try {
    const get = async (path, query) => {
      const r = await doFetch(`${shop.supabaseUrl}/rest/v1/${path}?${query}`, {
        headers: { apikey: shop.anonKey, Authorization: `Bearer ${shop.anonKey}` },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      return r.json();
    };
    const today = now.toISOString().slice(0, 10);
    const query = itemsQuery(filters, today);
    const rows = query ? await get('items', query) : [];
    const keys = [...new Set(rows.slice(0, filters.limit).map((r) => r.series_key).filter(Boolean))];
    const seriesTitles = new Map();
    const chunks = [];
    for (let i = 0; i < keys.length; i += SERIES_CHUNK) chunks.push(keys.slice(i, i + SERIES_CHUNK));
    for (const found of await Promise.all(chunks.map((c) => get('series_catalog', seriesQuery(c))))) {
      for (const s of found) seriesTitles.set(s.key, s.title);
    }
    body = buildFeed({ rows, filters, shop, seriesTitles, now });
  } catch (err) {
    console.error(`catalog feed: ${err.message}`);
    return failure(502, 'upstream_unavailable', 'The catalog is temporarily unavailable. Try again shortly.', request);
  }

  waitUntil(cache?.put(cacheKey, new Response(JSON.stringify(body), { headers: { 'Cache-Control': `max-age=${CACHE_SECONDS}` } })));
  return reply(200, body, { request, headers: { 'Cache-Control': `public, max-age=${CACHE_SECONDS}` } });
}
