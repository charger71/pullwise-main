// node worker/catalog-import.test.js
import assert from 'node:assert/strict';
import { catalogImport, runState } from './catalog-import.js';

const shop = { id: 'catalog', supabaseUrl: 'https://abc.supabase.co', anonKey: 'anon', catalog: true };
const env = { GITHUB_TOKEN: 'ghtok', GITHUB_REPO: 'me/repo' };
const req = (method = 'GET', body = null, token = 'good') =>
  new Request('https://catalog.x.com/__catalog-import', { method, headers: token ? { Authorization: `Bearer ${token}` } : {}, body: body && JSON.stringify(body) });

/** A fake fetch: is_staff, then GitHub's runs list and dispatch. `runs` is the latest run per workflow file. */
function fake({ staff = true, runs = {}, dispatch = 204 } = {}) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init });
    if (url === 'https://abc.supabase.co/rest/v1/rpc/is_staff') return new Response(JSON.stringify(init.headers.Authorization === 'Bearer good' && staff));
    const m = /^https:\/\/api\.github\.com\/repos\/me\/repo\/actions\/workflows\/([a-z-]+\.yml)\/(runs\?per_page=1|dispatches)$/.exec(url);
    assert.ok(m, url);
    assert.equal(init.headers.Authorization, 'Bearer ghtok');
    assert.ok(init.headers['User-Agent']);
    if (m[2] === 'dispatches') return new Response(null, { status: dispatch });
    return new Response(JSON.stringify({ workflow_runs: runs[m[1]] ? [runs[m[1]]] : [] }));
  };
  fn.calls = calls;
  return fn;
}

// runState
assert.deepEqual(runState(undefined), { status: null, conclusion: null, started: null, url: null });
assert.deepEqual(runState({ status: 'completed', conclusion: 'success', run_started_at: '2026-11-18T10:30:00Z', html_url: 'https://gh/run/1' }),
  { status: 'completed', conclusion: 'success', started: '2026-11-18T10:30:00Z', url: 'https://gh/run/1' });

// GET: the latest run of each.
let f = fake({ runs: { 'prh-import.yml': { status: 'in_progress', created_at: '2026-11-18T11:00:00Z' } } });
let res = await catalogImport(req(), shop, env, f);
assert.equal(res.status, 200);
assert.equal(res.headers.get('Cache-Control'), 'no-store');
const body = await res.json();
assert.equal(body.prh.status, 'in_progress');
assert.equal(body.prh.started, '2026-11-18T11:00:00Z');
assert.equal(body.lunar.status, null);

// POST: starts the workflow on main, not a dry run.
f = fake({ runs: { 'lunar-import.yml': { status: 'completed', conclusion: 'success' } } });
res = await catalogImport(req('POST', { source: 'lunar' }), shop, env, f);
assert.equal(res.status, 202);
const dispatch = f.calls.find((c) => c.url.endsWith('/dispatches'));
assert.ok(dispatch.url.includes('/lunar-import.yml/'));
assert.equal(dispatch.init.method, 'POST');
assert.deepEqual(JSON.parse(dispatch.init.body), { ref: 'main', inputs: { dry_run: false } });

// Already running: not started twice.
f = fake({ runs: { 'prh-import.yml': { status: 'queued' } } });
res = await catalogImport(req('POST', { source: 'prh' }), shop, env, f);
assert.equal(res.status, 409);
assert.ok(!f.calls.some((c) => c.url.endsWith('/dispatches')));

// GitHub refusing the dispatch.
res = await catalogImport(req('POST', { source: 'prh' }), shop, env, fake({ dispatch: 403 }));
assert.equal(res.status, 502);

// Refusals: unknown source, not staff, no token, not set up, wrong method.
f = fake();
assert.equal((await catalogImport(req('POST', { source: 'funko' }), shop, env, f)).status, 400);
assert.equal((await catalogImport(req('POST', { source: 'toString' }), shop, env, f)).status, 400);
assert.ok(!f.calls.some((c) => c.url.includes('api.github.com')));
assert.equal((await catalogImport(req('POST', { source: 'prh' }), shop, env, fake({ staff: false }))).status, 403);
assert.equal((await catalogImport(req('GET', null, 'bad'), shop, env, fake())).status, 403);
assert.equal((await catalogImport(req('GET', null, null), shop, env, fake())).status, 401);
assert.equal((await catalogImport(req(), shop, { GITHUB_REPO: 'me/repo' }, fake())).status, 404);
assert.equal((await catalogImport(req('DELETE'), shop, env, fake())).status, 405);

console.log('catalog-import ok');
