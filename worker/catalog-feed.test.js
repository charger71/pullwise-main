// node worker/catalog-feed.test.js
import assert from 'node:assert/strict';
import { catalogFeed, parseParams, isIsoDate, itemsQuery, coverLetter, ratioOf, COLUMNS, CREATOR_COLUMNS, SERIES_COLUMNS, DEFAULT_LIMIT, MAX_LIMIT } from './catalog-feed.js';

const shop = { id: 'catalog', domains: ['catalog.x.com'], supabaseUrl: 'https://abc.supabase.co', anonKey: 'anon-key', catalog: true };
const NOW = new Date('2026-11-13T15:00:00Z');

// ---------------------------------------------------------------------------
// A fake Supabase that applies the query parameters the feed sends (and only those) to some rows. The rows carry
// columns the feed must never expose, and the fake returns them whenever the request doesn't select them away.
// ---------------------------------------------------------------------------
const FORBIDDEN = { sku: 'SKU-SECRET', upc: '999000111', isbn: '978-SECRET', description: 'INTERNAL DESC', retail_price: 1.11, shop_price: 2.22,
  cost: 0.5, margin: 0.4, notes: 'INTERNAL NOTE', staff_pick: true, catalog_id: 77, status: 'pre_order', hidden: false, badges: ['key_issue'], search_norm: 'xx' };
const row = (o) => ({ distributor: 'lunar', publisher: 'DC', price: 4.99, issue_number: '1', variant: null, cover_url: null, series_key: null, item_creators: [], foc_date: '2026-11-16', release_date: '2026-12-09', ...FORBIDDEN, ...o });
const ROWS = [
  row({ id: 1, title: 'Absolute Batman: Beyond Ark-M', title_squash: 'absolutebatmanbeyondarkm', series_key: 'absolute batman', cover_url: 'https://img/1.jpg' }),
  row({ id: 2, title: 'Absolute Batman: Beyond Ark-M', title_squash: 'absolutebatmanbeyondarkm', series_key: 'absolute batman', variant: 'CVR B JOCK CARD STOCK VAR',
    item_creators: [{ name: 'Jock', role: 'cover' }, { name: 'Somebody Else', role: 'creator' }] }),
  row({ id: 3, title: 'Absolute Batman: Beyond Ark-M', title_squash: 'absolutebatmanbeyondarkm', series_key: 'absolute batman', variant: 'CVR D 1:25 INCV', release_date: '2026-12-16' }),
  row({ id: 4, title: 'X-Men', title_squash: 'xmen', series_key: 'x men', publisher: 'Marvel', distributor: 'prh', price: null, foc_date: '2026-11-23', release_date: '2026-12-09', issue_number: null }),
  row({ id: 5, title: 'Saga', title_squash: 'saga', series_key: null, publisher: null, distributor: 'other', foc_date: null, release_date: null }),
  row({ id: 6, title: 'Old Pre-order', title_squash: 'oldpreorder', foc_date: '2026-11-09', release_date: '2026-12-02' }),
  row({ id: 7, title: 'Hidden One', title_squash: 'hiddenone', hidden: true }),
  row({ id: 8, title: 'Already Out', title_squash: 'alreadyout', status: 'available' }),
];
const SERIES = [{ key: 'absolute batman', title: 'Absolute Batman', secret: 'x' }];

function fakeSupabase(log = []) {
  return async (input, init) => {
    const u = new URL(input);
    log.push({ url: u, init });
    assert.equal(init.headers.apikey, 'anon-key');
    assert.equal(init.headers.Authorization, 'Bearer anon-key', 'only the public anon key is sent');
    assert.equal(u.origin, shop.supabaseUrl);
    const p = u.searchParams;
    if (u.pathname === '/rest/v1/series_catalog') {
      const keys = [...p.get('key').matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
      return Response.json(SERIES.filter((s) => keys.includes(s.key)));
    }
    assert.equal(u.pathname, '/rest/v1/items');
    let rows = ROWS.filter((r) => !r.hidden && r.status === 'pre_order');
    const or = /^\(foc_date\.is\.null,foc_date\.gte\.(\d{4}-\d{2}-\d{2})\)$/.exec(p.get('or'));
    if (or) rows = rows.filter((r) => !r.foc_date || r.foc_date >= or[1]);
    if (p.get('foc_date')) rows = rows.filter((r) => r.foc_date === p.get('foc_date').replace('eq.', ''));
    if (p.get('release_date')) rows = rows.filter((r) => r.release_date === p.get('release_date').replace('eq.', ''));
    if (p.get('and')) {
      for (const m of p.get('and').matchAll(/or\(title_squash\.like\.\*([a-z0-9]+)\*,series_key\.like\.\*\1\*\)/g)) {
        rows = rows.filter((r) => r.title_squash.includes(m[1]) || (r.series_key ?? '').replace(/ /g, '').includes(m[1]));
      }
    }
    rows = rows.slice(Number(p.get('offset')), Number(p.get('offset')) + Number(p.get('limit')));
    // select: the listed columns, plus embedded item_creators; with no select the row comes back whole
    const cols = p.get('select').replace(/item_creators\([^)]*\)/, 'item_creators').split(',');
    return Response.json(rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => cols.includes(k)))));
  };
}

const call = async (qs = '', { env = {}, method = 'GET', fetch: f, cache } = {}) => {
  const log = [];
  const res = await catalogFeed(new Request(`https://catalog.x.com/catalog.json${qs}`, { method }), shop, env, { fetch: f ?? fakeSupabase(log), cache: cache ?? null, now: NOW });
  const text = await res.text();
  return { res, log, text, body: text ? JSON.parse(text) : null };
};
const ids = (b) => b.items.map((i) => i.id);

// ---------------------------------------------------------------------------
// Dates and parameters
// ---------------------------------------------------------------------------
for (const ok of ['2026-11-16', '2028-02-29', '2026-12-09']) assert.equal(isIsoDate(ok), true, ok);
for (const bad of ['2026-02-30', '2026-13-01', '2026-11-1', '11/16/2026', '2026-11-16T00:00:00Z', '', 'tomorrow', '2026-00-10', '2027-02-29']) assert.equal(isIsoDate(bad), false, bad);
assert.deepEqual(parseParams(new URLSearchParams('')), { foc: null, release: null, q: null, limit: DEFAULT_LIMIT, offset: 0 });
assert.equal(DEFAULT_LIMIT, 500);
assert.equal(MAX_LIMIT, 1000);
assert.equal(coverLetter('CVR B JOCK CARD STOCK VAR'), 'B');
assert.equal(coverLetter('cover c'), 'C');
assert.equal(coverLetter('DIRECT MARKET EXCL'), null);
assert.equal(coverLetter(null), null);
assert.equal(ratioOf('CVR D 1:25 INCV'), '1:25');
assert.equal(ratioOf('CVR B'), null);

// ---------------------------------------------------------------------------
// No filters: everything open, in order; fields filled in or null, never invented
// ---------------------------------------------------------------------------
let { res, body, text, log } = await call();
assert.equal(res.status, 200);
assert.equal(res.headers.get('Content-Type'), 'application/json; charset=utf-8');
assert.equal(res.headers.get('Cache-Control'), 'public, max-age=300');
assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
assert.match(res.headers.get('Access-Control-Allow-Methods'), /GET/);
assert.equal(body.generated_at, '2026-11-13T15:00:00.000Z');
assert.deepEqual(body.filters, { foc: null, release: null, q: null });
assert.equal(body.count, body.items.length);
assert.deepEqual(ids(body), ['1', '2', '3', '4', '5'], 'hidden, closed (FOC passed) and non-pre-order titles are left out; no FOC yet stays in');
assert.equal('next' in body, false);

const [a, b, c, x, s] = body.items;
assert.deepEqual(a, {
  id: '1', title: 'Absolute Batman: Beyond Ark-M', issue: '1', series: 'Absolute Batman', publisher: 'DC', distributor: 'Lunar',
  foc_date: '2026-11-16', release_date: '2026-12-09', price: 4.99, cover: null, variant_description: null, is_ratio_variant: false, ratio: null,
  creators: { cover_artist: null }, cover_image_url: 'https://img/1.jpg', url: 'https://catalog.x.com/pre-orders.html?title=1',
});
assert.equal(b.cover, 'B');
assert.equal(b.variant_description, 'CVR B JOCK CARD STOCK VAR');
assert.deepEqual(b.creators, { cover_artist: ['Jock'] }, 'only cover artists; the data has no writer / artist split');
assert.equal(c.is_ratio_variant, true);
assert.equal(c.ratio, '1:25');
assert.equal(c.cover, 'D');
assert.equal(x.distributor, 'PRH');
assert.equal(x.price, null);
assert.equal(x.issue, null);
assert.equal(x.series, null, 'a series with no catalog title stays null (series_key is not prettified)');
assert.equal(s.publisher, null);
assert.equal(s.distributor, 'Other');
assert.equal(s.foc_date, null);
assert.equal(s.release_date, null);

// ---------------------------------------------------------------------------
// Each filter, and combinations
// ---------------------------------------------------------------------------
({ body } = await call('?foc=2026-11-16'));
assert.deepEqual(ids(body), ['1', '2', '3']);
assert.deepEqual(body.filters, { foc: '2026-11-16', release: null, q: null });

({ body } = await call('?release=2026-12-09'));
assert.deepEqual(ids(body), ['1', '2', '4']);

({ body } = await call('?q=ARK-M'));
assert.deepEqual(ids(body), ['1', '2', '3'], 'case and punctuation ignored');
({ body } = await call('?q=x%20men'));
assert.deepEqual(ids(body), ['4'], 'matches the title however it is spaced');
({ body } = await call('?q=absolute%20batman'));
assert.deepEqual(ids(body), ['1', '2', '3'], 'matches the series too');
({ body } = await call('?q=batman%20saga'));
assert.deepEqual(ids(body), [], 'every word must match');

({ body } = await call('?foc=2026-11-16&release=2026-12-09'));
assert.deepEqual(ids(body), ['1', '2']);
({ body } = await call('?foc=2026-11-16&release=2026-12-09&q=cvr'));
assert.deepEqual(ids(body), [], 'q searches title and series, not the cover text');
({ body } = await call('?foc=2026-11-16&q=batman'));
assert.deepEqual(ids(body), ['1', '2', '3']);
assert.deepEqual(body.filters, { foc: '2026-11-16', release: null, q: 'batman' });
({ body } = await call('?foc=2026-11-23&release=2026-12-09&q=x-men'));
assert.deepEqual(ids(body), ['4']);

// ---------------------------------------------------------------------------
// Empty results are a normal answer
// ---------------------------------------------------------------------------
({ res, body } = await call('?foc=2027-01-04'));
assert.equal(res.status, 200);
assert.deepEqual(body.items, []);
assert.equal(body.count, 0);
({ res, body } = await call('?foc=2026-11-09'));
assert.deepEqual(body.items, [], 'a cutoff that has passed is no longer open');
({ log, body } = await call('?q=!!!'));
assert.deepEqual(body.items, [], 'a search with no letters or digits matches nothing');
assert.equal(log.length, 0, 'and does not ask the database');
({ body } = await call('?q=%20%20'));
assert.equal(body.filters.q, null, 'a blank search is no search');

// ---------------------------------------------------------------------------
// Bad input: 400 with a JSON error, before anything is asked of the database
// ---------------------------------------------------------------------------
for (const qs of ['?foc=2026-02-30', '?foc=nope', '?release=2026-13-01', '?release=', '?foc=2026-11-1', '?limit=0', '?limit=1001', '?limit=abc', '?limit=-5', '?limit=1.5',
  '?offset=-1', '?offset=x', `?q=${'a'.repeat(101)}`]) {
  ({ res, body, log } = await call(qs));
  assert.equal(res.status, 400, qs);
  assert.equal(res.headers.get('Content-Type'), 'application/json; charset=utf-8', qs);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*', qs);
  assert.equal(res.headers.get('Cache-Control'), 'no-store', qs);
  assert.equal(body.error.code, 'bad_request', qs);
  assert.equal(typeof body.error.message, 'string', qs);
  assert.equal(log.length, 0, qs);
}

// ---------------------------------------------------------------------------
// Paging
// ---------------------------------------------------------------------------
({ body } = await call('?limit=2'));
assert.deepEqual(ids(body), ['1', '2']);
assert.equal(body.count, 2);
assert.equal(body.next, 'https://catalog.x.com/catalog.json?limit=2&offset=2');
({ body } = await call('?limit=2&offset=2'));
assert.deepEqual(ids(body), ['3', '4']);
assert.equal(body.next, 'https://catalog.x.com/catalog.json?limit=2&offset=4');
({ body } = await call('?limit=2&offset=4'));
assert.deepEqual(ids(body), ['5']);
assert.equal('next' in body, false, 'no next on the last page');
({ body } = await call('?limit=5'));
assert.equal('next' in body, false, 'a page that ends exactly at the last item has no next');
({ body } = await call('?foc=2026-11-16&q=batman&limit=1'));
assert.equal(body.next, 'https://catalog.x.com/catalog.json?foc=2026-11-16&q=batman&limit=1&offset=1', 'next keeps the filters');
({ body } = await call('?offset=100'));
assert.deepEqual(body.items, []);

// ---------------------------------------------------------------------------
// Allowlist: nothing outside it is asked for, and nothing outside it can come out
// ---------------------------------------------------------------------------
({ log, text, body } = await call());
const sel = log[0].url.searchParams.get('select');
const askedFor = sel.replace(/item_creators\([^)]*\)/, '').split(',').filter(Boolean);
assert.deepEqual(askedFor.sort(), [...COLUMNS].sort());
assert.equal(sel.match(/item_creators\(([^)]*)\)/)[1], CREATOR_COLUMNS.join(','));
assert.notEqual(sel, '*');
assert.ok(!sel.includes('*'));
const series = log.find((l) => l.url.pathname.endsWith('series_catalog'));
assert.equal(series.url.searchParams.get('select'), SERIES_COLUMNS.join(','));
for (const col of Object.keys(FORBIDDEN)) assert.ok(!COLUMNS.includes(col) && !CREATOR_COLUMNS.includes(col), `${col} must not be in the allowlist`);
for (const v of Object.values(FORBIDDEN).filter((v) => typeof v === 'string' && v !== 'pre_order')) assert.ok(!text.includes(v), `${v} leaked into the response`);
for (const k of Object.keys(FORBIDDEN)) assert.ok(!text.includes(`"${k}"`), `${k} leaked into the response`);
for (const item of body.items) {
  assert.deepEqual(Object.keys(item), ['id', 'title', 'issue', 'series', 'publisher', 'distributor', 'foc_date', 'release_date', 'price', 'cover', 'variant_description',
    'is_ratio_variant', 'ratio', 'creators', 'cover_image_url', 'url']);
  assert.deepEqual(Object.keys(item.creators), ['cover_artist']);
}
assert.ok(!text.includes('"secret"') && !text.includes('anon-key'));
// A database that ignores `select` and returns whole rows still can't leak: the feed picks fields itself.
({ text } = await call('', { fetch: async (input) => Response.json(new URL(input).pathname.endsWith('series_catalog') ? SERIES : ROWS.filter((r) => r.id < 3)) }));
for (const k of Object.keys(FORBIDDEN)) assert.ok(!text.includes(`"${k}"`), `${k} leaked from an over-sharing database`);
// Read-only: the only things sent are GETs
assert.ok(log.every((l) => !l.init.method || l.init.method === 'GET'));

// The query itself
const q = new URLSearchParams(itemsQuery({ foc: '2026-11-16', release: '2026-12-09', q: "Batman's ark", limit: 10, offset: 20 }, '2026-11-13'));
assert.equal(q.get('status'), 'eq.pre_order');
assert.equal(q.get('hidden'), 'eq.false');
assert.equal(q.get('or'), '(foc_date.is.null,foc_date.gte.2026-11-13)');
assert.equal(q.get('foc_date'), 'eq.2026-11-16');
assert.equal(q.get('release_date'), 'eq.2026-12-09');
const word = (w) => `or(title_squash.like.*${w}*,series_key.like.*${w}*)`;
assert.equal(q.get('and'), `(${['batman', 's', 'ark'].map(word).join(',')})`);
assert.equal(q.get('order'), 'foc_date.asc.nullslast,publisher.asc.nullslast,title.asc,issue_number.asc.nullsfirst,variant.asc.nullsfirst,id.asc');
assert.equal(q.get('limit'), '11');
assert.equal(q.get('offset'), '20');
// Words are letters and digits only: nothing in a search can add a PostgREST operator
const evil = new URLSearchParams(itemsQuery({ q: 'a,or(id.gt.0) *)(', limit: 5, offset: 0 }, '2026-11-13')).get('and');
assert.match(evil, /^\((or\(title_squash\.like\.\*[a-z0-9]+\*,series_key\.like\.\*[a-z0-9]+\*\),?)+\)$/);

// ---------------------------------------------------------------------------
// Methods, CORS, rate limit, errors, cache
// ---------------------------------------------------------------------------
({ res, text } = await call('', { method: 'OPTIONS' }));
assert.equal(res.status, 204);
assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
  ({ res, body } = await catalogFeed(new Request('https://catalog.x.com/catalog.json', { method, body: '{}' }), shop, {}, { fetch: fakeSupabase(), cache: null })
    .then(async (r) => ({ res: r, body: await r.json() })));
  assert.equal(res.status, 405, method);
  assert.equal(res.headers.get('Allow'), 'GET, HEAD, OPTIONS');
  assert.equal(body.error.code, 'method_not_allowed');
}
({ res, text } = await call('', { method: 'HEAD' }));
assert.equal(res.status, 200);
assert.equal(text, '');

const limited = (success) => ({ CATALOG_RATE_LIMIT: { limit: async ({ key }) => { assert.ok(key); return { success }; } } });
({ res, body } = await call('', { env: limited(true) }));
assert.equal(res.status, 200);
({ res, body, log } = await call('', { env: limited(false) }));
assert.equal(res.status, 429);
assert.equal(res.headers.get('Retry-After'), '60');
assert.equal(body.error.code, 'rate_limited');
assert.equal(log.length, 0, 'a limited client never reaches the database');

({ res, body } = await call('', { fetch: async () => new Response('boom', { status: 500 }) }));
assert.equal(res.status, 502);
assert.equal(body.error.code, 'upstream_unavailable');
assert.ok(!JSON.stringify(body).includes('500'), 'no upstream details in the error');
assert.equal(res.headers.get('Cache-Control'), 'no-store');
({ res } = await call('', { fetch: async () => { throw new Error('network down'); } }));
assert.equal(res.status, 502);

// The edge cache: same question (parameters in any order) is answered without the database
const store = new Map();
const cache = { match: async (k) => (store.has(k.url) ? new Response(store.get(k.url)) : undefined), put: async (k, r) => store.set(k.url, await r.text()) };
const first = await catalogFeed(new Request('https://catalog.x.com/catalog.json?release=2026-12-09&foc=2026-11-16'), shop, {}, { fetch: fakeSupabase(), cache, now: NOW, waitUntil: (p) => p });
await new Promise((r) => setTimeout(r, 0));
assert.equal(first.status, 200);
const dead = async () => { throw new Error('database should not be asked'); };
const second = await catalogFeed(new Request('https://catalog.x.com/catalog.json?foc=2026-11-16&release=2026-12-09'), shop, {}, { fetch: dead, cache, now: NOW });
assert.equal(second.status, 200);
assert.equal(second.headers.get('Cache-Control'), 'public, max-age=300');
assert.deepEqual((await second.json()).items.map((i) => i.id), ['1', '2']);

console.log('catalog-feed tests passed');
