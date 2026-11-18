// Run the master catalog's daily imports now, from Admin → Import (catalog shop only; worker/index.js routes it).
//
// GET  /__catalog-import                     — the latest run of each: { prh: { status, conclusion, started, url }, lunar: … }
//                                               (status is GitHub's: queued, in_progress or completed; null before any run)
// POST /__catalog-import { source: 'prh' | 'lunar' } — starts that GitHub Action ("Automatic PRH import",
//                                               "Automatic Lunar import") on main, as Actions → Run workflow does.
//
// Both only answer the catalog's staff: the caller's Supabase token must pass is_staff(). GitHub is called with the
// GITHUB_TOKEN Worker secret (a fine-grained token on this repository with Actions: read and write; SETUP.md), on the
// repository named by the GITHUB_REPO var (wrangler.jsonc). The run's result lands in Import → Recent Runs as usual.

export const CATALOG_IMPORT_PATH = '/__catalog-import';
export const WORKFLOWS = { prh: 'prh-import.yml', lunar: 'lunar-import.yml' };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/** GitHub's latest run of a workflow → what the admin shows, or nulls before any run. */
export function runState(run) {
  if (!run) return { status: null, conclusion: null, started: null, url: null };
  return { status: run.status ?? null, conclusion: run.conclusion ?? null, started: run.run_started_at ?? run.created_at ?? null, url: run.html_url ?? null };
}

export async function catalogImport(request, shop, env, fetchFn = fetch) {
  if (request.method !== 'GET' && request.method !== 'POST') return json(405, { error: 'GET or POST only' });
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) return json(404, { error: 'Running the imports from here isn’t set up yet (the Worker’s GITHUB_TOKEN secret).' });

  const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Sign in again.' });
  const check = await fetchFn(`${shop.supabaseUrl}/rest/v1/rpc/is_staff`, {
    method: 'POST',
    headers: { apikey: shop.anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
  }).catch(() => null);
  if (!check?.ok || (await check.json().catch(() => false)) !== true) return json(403, { error: 'Only staff can run the imports.' });

  const gh = (path, init = {}) => fetchFn(`https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'pullwise-worker', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
  }).catch(() => null);
  const latest = async (file) => {
    const res = await gh(`${file}/runs?per_page=1`);
    if (!res?.ok) throw new Error(`GitHub answered ${res?.status ?? 'nothing'}`);
    return runState((await res.json()).workflow_runs?.[0]);
  };

  if (request.method === 'GET') {
    try {
      const entries = await Promise.all(Object.entries(WORKFLOWS).map(async ([source, file]) => [source, await latest(file)]));
      return json(200, Object.fromEntries(entries));
    } catch (err) {
      return json(502, { error: `Couldn’t read the import runs from GitHub (${err.message}).` });
    }
  }

  const { source } = await request.json().catch(() => ({}));
  const file = Object.hasOwn(WORKFLOWS, source) ? WORKFLOWS[source] : null;
  if (!file) return json(400, { error: 'Say which import: prh or lunar.' });
  let now;
  try {
    now = await latest(file);
  } catch (err) {
    return json(502, { error: `Couldn’t reach GitHub (${err.message}).` });
  }
  if (now.status && now.status !== 'completed') return json(409, { error: 'That import is already running.', ...now });
  const res = await gh(`${file}/dispatches`, { method: 'POST', body: JSON.stringify({ ref: 'main', inputs: { dry_run: false } }) });
  if (res?.status !== 204) return json(502, { error: `GitHub didn’t start the import (${res?.status ?? 'no answer'}).` });
  return json(202, { started: true });
}
