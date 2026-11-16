// node tools/deploy-plan.test.mjs
import assert from 'node:assert/strict';
import { validate, plan, secretName } from './deploy-plan.mjs';
import { checkShop } from './smoke-site.mjs';

const REF_A = 'abcdefghijklmnopqrst';
const REF_B = 'bbbbbbbbbbbbbbbbbbbb';
const shop = (over = {}) => ({
  id: 'main-street', domains: ['mainstreet.com', 'www.mainstreet.com'], projectRef: REF_A,
  supabaseUrl: `https://${REF_A}.supabase.co`, anonKey: 'anon', gaMeasurementId: '', ...over,
});

// Valid
assert.deepEqual(validate({ shops: [] }), []);
assert.deepEqual(validate({ shops: [shop()] }), []);
assert.deepEqual(validate({ shops: [shop({ canary: true }), shop({ id: 'b', domains: ['b.com'], projectRef: REF_B, supabaseUrl: `https://${REF_B}.supabase.co` })] }), []);

// Problems
const one = (over, re) => assert.match(validate({ shops: [shop(over)] }).join('\n'), re);
assert.match(validate({}).join(), /must be \{ "shops"/);
one({ id: 'Main Street' }, /id must be/);
one({ domains: [] }, /at least one domain/);
one({ domains: ['MainStreet.com'] }, /lower-case domain/);
one({ domains: ['https://mainstreet.com'] }, /lower-case domain/);
one({ projectRef: 'short' }, /20-character/);
one({ supabaseUrl: `https://${REF_B}.supabase.co` }, /supabaseUrl must be/);
one({ anonKey: ' ' }, /anonKey is missing/);
one({ gaMeasurementId: 'UA-1' }, /gaMeasurementId/);
one({ canary: 'yes' }, /canary must be/);
one({ app: 'true' }, /app must be/);
one({ locations: 'true' }, /locations must be/);
one({ media: 's3' }, /media can only be "r2"/);
assert.deepEqual(validate({ shops: [shop({ media: 'r2' })] }), []);
assert.match(validate({ shops: [shop(), shop()] }).join(), /duplicate id/);
assert.match(validate({ shops: [shop(), shop({ id: 'other' })] }).join(), /also listed for main-street/);
assert.match(validate({ shops: [shop({ id: 'a-b', domains: ['x.com'] }), shop({ id: 'a-b-', domains: ['y.com'] })] }).join(), /id must be/);

// Secret names
assert.equal(secretName('main-street'), 'SUPABASE_DB_PASSWORD_MAIN_STREET');
assert.equal(secretName('demo'), 'SUPABASE_DB_PASSWORD_DEMO');

// Plan
const data = { shops: [shop({ id: 'demo', canary: true, domains: ['demo.example.com'] }), shop()] };
const p = plan(data, { hasSupabase: true, hasCloudflare: true });
assert.equal(p.ready, true);
assert.deepEqual(p.canary.map((s) => s.id), ['demo']);
assert.deepEqual(p.shops.map((s) => s.id), ['main-street']);
assert.deepEqual(p.shops[0], { id: 'main-street', projectRef: REF_A, secret: 'SUPABASE_DB_PASSWORD_MAIN_STREET', url: 'https://mainstreet.com', supabaseUrl: `https://${REF_A}.supabase.co`, domains: ['mainstreet.com', 'www.mainstreet.com'] });
assert.match(plan(data, { hasSupabase: false, hasCloudflare: true }).reason, /SUPABASE_ACCESS_TOKEN/);
assert.equal(plan(data, { hasSupabase: true, hasCloudflare: false }).ready, false);
assert.match(plan({ shops: [] }, { hasSupabase: true, hasCloudflare: true }).reason, /no shops/);

// Master catalog: everyone else gets its address and key; the catalog itself doesn't sync from itself
one({ catalog: 'yes' }, /catalog must be/);
const two = { shops: [shop({ catalog: true }), shop({ id: 'b', domains: ['b.com'], projectRef: REF_B, supabaseUrl: `https://${REF_B}.supabase.co`, catalog: true })] };
assert.match(validate(two).join(), /only one shop can be the master catalog \(main-street, b\)/);
const withCatalog = { shops: [shop({ id: 'catalog', domains: ['catalog.example.com'], catalog: true, anonKey: 'cat-anon' }), shop({ id: 'b', domains: ['b.com'], projectRef: REF_B, supabaseUrl: `https://${REF_B}.supabase.co`, canary: true })] };
assert.deepEqual(validate(withCatalog), []);
const pc = plan(withCatalog, { hasSupabase: true, hasCloudflare: true });
assert.ok(!('catalogKey' in pc.shops[0]) && !JSON.stringify(pc).includes('cat-anon'), 'keys stay out of the plan output');

// Smoke check against a fake site
const site = (cfg, home) => async (u) => ({
  status: 200,
  text: async () => (u.endsWith('/js/config.js') ? cfg : home),
});
const target = { url: 'https://mainstreet.com', supabaseUrl: `https://${REF_A}.supabase.co` };
const goodCfg = `export const SUPABASE_URL = "https://${REF_A}.supabase.co";`;
const goodHome = `<head><link rel="preconnect" href="https://${REF_A}.supabase.co" crossorigin></head>`;
assert.equal(await checkShop(target, site(goodCfg, goodHome)), null);
assert.match(await checkShop(target, site("export const SUPABASE_URL = '';", goodHome)), /isn't this shop's/);
assert.match(await checkShop(target, site(goodCfg, '<head></head>')), /wasn't rewritten/);
assert.match(await checkShop(target, async () => ({ status: 404, text: async () => '' })), /answered 404/);

console.log('deploy plan tests passed');
