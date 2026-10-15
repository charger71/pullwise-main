#!/usr/bin/env node
// After a deploy: checks each shop's live site is served by the new Worker with the right shop's config.
//
//   node tools/smoke-site.mjs '<JSON list of {id, url, supabaseUrl}>'   # as printed by tools/deploy-plan.mjs
//
// For each shop: /js/config.js points at its own Supabase project, and the home page loads with the Worker's
// additions (the preconnect to that project). Retries for a couple of minutes, since a newly attached domain can
// take a moment to start answering.

const TRIES = Number(process.env.SMOKE_TRIES ?? 12);
const WAIT_MS = Number(process.env.SMOKE_WAIT_MS ?? 10_000);

export async function checkShop({ url, supabaseUrl }, fetchFn = fetch) {
  const get = async (p) => {
    const res = await fetchFn(`${url}${p}`, { headers: { 'Cache-Control': 'no-cache' }, redirect: 'follow' });
    return { status: res.status, text: await res.text() };
  };
  const cfg = await get('/js/config.js');
  if (cfg.status !== 200) return `config.js answered ${cfg.status}`;
  if (!cfg.text.includes(`SUPABASE_URL = ${JSON.stringify(supabaseUrl)}`)) return `config.js isn't this shop's (expected ${supabaseUrl})`;
  const home = await get('/');
  if (home.status !== 200) return `home page answered ${home.status}`;
  if (!home.text.includes(`<link rel="preconnect" href="${supabaseUrl}"`)) return "home page wasn't rewritten by the Worker (no preconnect to the shop's project)";
  return null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const shops = JSON.parse(process.argv[2] ?? '[]');
  let failed = 0;
  for (const shop of shops) {
    let problem = 'not checked';
    for (let i = 1; i <= TRIES; i++) {
      problem = await checkShop(shop).catch((err) => err.message);
      if (!problem) break;
      if (i < TRIES) await new Promise((r) => setTimeout(r, WAIT_MS));
    }
    if (problem) failed++;
    console.log(`${problem ? '✗' : '✓'} ${shop.id} ${shop.url}${problem ? `: ${problem}` : ''}`);
  }
  if (failed) process.exit(1);
}
