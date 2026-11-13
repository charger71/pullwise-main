// node tools/add-shop.test.mjs   (the flow against fakes; tools/add-shop.mjs has the real calls)
import assert from 'node:assert/strict';
import { parseArgs, authConfig, parseFrom, lit, vaultSql, settingsSql, staffSql, shopEntry, addShop } from './add-shop.mjs';

const REF = 'abcdefghijklmnopqrst';

// Arguments
const o = parseArgs(['--id', 'main-street', '--name', 'Main Street Comics', '--domain', 'MainStreet.com', '--domain=www.mainstreet.com', '--owner-email', 'pat@example.com']);
assert.deepEqual(o.domains, ['mainstreet.com', 'www.mainstreet.com']);
assert.equal(o.ownerName, 'pat');
assert.equal(o.shopEmail, 'pat@example.com');
assert.equal(o.timezone, 'America/New_York');
assert.equal(o.canary, false);
assert.throws(() => parseArgs(['--id', 'x']), /Missing: --name, --owner-email, --domain/);
assert.throws(() => parseArgs(['--id', 'x', '--name', 'X', '--domain', 'x.com', '--owner-email', 'nope']), /email address/);
assert.throws(() => parseArgs(['--bogus']), /Unknown option/);
assert.equal(parseArgs(['--id', 'x', '--name', 'X', '--domain', 'x.com', '--owner-email', 'a@b.co', '--canary', '--super']).super, true);

// SQL pieces
assert.equal(lit("O'Brien"), "'O''Brien'");
assert.equal(lit(''), 'null');
assert.equal(lit(undefined), 'null');
assert.match(vaultSql(REF, 's3cret'), /vault\.create_secret\('https:\/\/abcdefghijklmnopqrst\.supabase\.co\/functions\/v1\/weekly-pull-list', 'weekly_email_url'\)/);
assert.match(vaultSql(REF, 's3cret'), /vault\.update_secret\(v, 's3cret'\)/);
assert.match(settingsSql({ ...o, name: "Pat's" }), /shop_name = 'Pat''s'.*where id = 1 and shop_name = 'Your Comic Shop'/s);
assert.doesNotMatch(staffSql('u1', o), /is_super/);
assert.match(staffSql('u1', { ...o, super: true }), /allow_super_change.*is_super = true/s);
assert.match(staffSql('u1', o), /on conflict \(user_id\) do nothing/);

// Auth settings
const auth = authConfig(o.domains);
assert.equal(auth.site_url, 'https://mainstreet.com');
assert.equal(auth.uri_allow_list, 'https://mainstreet.com/account.html,https://mainstreet.com/app,https://mainstreet.com/admin/,https://www.mainstreet.com/account.html,https://www.mainstreet.com/app,https://www.mainstreet.com/admin/,http://localhost:8080/account.html,http://localhost:8080/app.html,http://localhost:8080/admin/');
assert.equal('smtp_host' in auth, false, 'no Resend details: Supabase sends the emails');
const viaResend = authConfig(o.domains, { apiKey: 're_x', from: 'Main Street Comics <hello@mainstreet.com>' });
assert.deepEqual([viaResend.smtp_host, viaResend.smtp_port, viaResend.smtp_user, viaResend.smtp_pass, viaResend.smtp_admin_email, viaResend.smtp_sender_name],
  ['smtp.resend.com', '465', 'resend', 're_x', 'hello@mainstreet.com', 'Main Street Comics']);
assert.equal(authConfig(o.domains, { apiKey: 're_x', from: 'hello@mainstreet.com' }).smtp_sender_name, 'mainstreet.com');
assert.equal('smtp_host' in authConfig(o.domains, { apiKey: 're_x', from: 'not an address' }), false);
assert.deepEqual(parseFrom('"Pat\'s" <p@x.co>'), { name: "Pat's", email: 'p@x.co' });
assert.equal(parseArgs(['--id', 'x', '--name', 'X', '--domain', 'x.com', '--owner-email', 'a@b.co', '--hide-passwords']).hidePasswords, true);
assert.match(auth.mailer_templates_magic_link_content, /\{\{ \.Token \}\}/);
assert.match(auth.mailer_templates_magic_link_content, /\{\{ \.ConfirmationURL \}\}/);

// shops.json entry
assert.deepEqual(shopEntry({ ...o, canary: true }, REF, 'anon'), { id: 'main-street', domains: o.domains, supabaseUrl: `https://${REF}.supabase.co`, anonKey: 'anon', projectRef: REF, gaMeasurementId: '', canary: true, app: false, locations: false });
assert.equal('canary' in shopEntry(o, REF, 'anon'), false);
assert.equal(parseArgs(['--id', 'x', '--name', 'X', '--domain', 'x.com', '--owner-email', 'a@b.co', '--app']).app, true);
assert.equal(shopEntry({ ...o, app: true }, REF, 'anon').app, true);
assert.equal(shopEntry(o, REF, 'anon').app, false, 'no app unless asked for, but the line is there to flip');
assert.equal(parseArgs(['--id', 'x', '--name', 'X', '--domain', 'x.com', '--owner-email', 'a@b.co', '--locations']).locations, true);
assert.equal(shopEntry({ ...o, locations: true }, REF, 'anon').locations, true);
assert.equal(shopEntry(o, REF, 'anon').locations, false, 'one location unless asked for, but the line is there to flip');

// The flow, against fakes
function fakes({ shops = { shops: [] }, orgs = [{ id: 'org' }], projects = [], userExists = false } = {}) {
  const log = [];
  let written = null;
  const deps = {
    env: {},
    api: async (method, p, body) => {
      log.push(`${method} ${p}`);
      if (method === 'GET' && p === '/projects') return projects;
      if (p === '/organizations') return orgs;
      if (method === 'POST' && p === '/projects') { assert.equal(body.organization_id, orgs[0].id); assert.ok(body.db_pass.length >= 24); return { id: REF }; }
      if (p === `/projects/${REF}`) return { status: 'ACTIVE_HEALTHY' };
      if (p.startsWith(`/projects/${REF}/api-keys`)) return [{ name: 'anon', api_key: 'anon' }, { name: 'service_role', api_key: 'svc' }];
      return {};
    },
    sql: async (ref, q) => { log.push(`sql ${q.trim().split(/\s+/).slice(0, 2).join(' ')}`); return /^select/.test(q) ? [{ id: 'user-1' }] : []; },
    authAdmin: async () => { log.push('auth create user'); return userExists ? { status: 422, json: {} } : { status: 200, json: {} }; },
    cli: (args) => log.push(`cli ${args.slice(0, 2).join(' ')}`),
    readShops: () => structuredClone(shops),
    writeShops: (d) => { written = d; },
    log: () => {},
    sleep: async () => {},
  };
  return { deps, log, written: () => written };
}

{
  const f = fakes();
  const r = await addShop(o, f.deps);
  assert.equal(r.created, true);
  assert.ok(r.ownerPassword);
  assert.deepEqual(f.log, [
    'GET /projects', 'GET /organizations', 'POST /projects', `GET /projects/${REF}`, `GET /projects/${REF}/api-keys?reveal=true`,
    'cli link --project-ref', 'cli db push',
    `PATCH /projects/${REF}/config/auth`, `POST /projects/${REF}/secrets`, 'sql do $$', 'sql update public.settings',
    'auth create user', 'sql select id', 'sql insert into',
    'cli functions deploy',
  ]);
  assert.equal(f.written().shops[0].projectRef, REF);
}
{
  // Re-run for a shop already in shops.json: no new project, owner kept, entry replaced not duplicated
  const shops = { shops: [shopEntry(o, REF, 'old-anon')] };
  const f = fakes({ shops, userExists: true });
  const r = await addShop(o, f.deps);
  assert.equal(r.created, false);
  assert.equal(r.ownerPassword, null);
  assert.ok(!f.log.includes('POST /projects'));
  assert.deepEqual(f.written().shops.map((s) => [s.id, s.anonKey]), [['main-street', 'anon']]);
}
{
  // An existing project with the expected name is reused
  const f = fakes({ projects: [{ id: REF, name: 'pullwise-main-street' }] });
  assert.equal((await addShop(o, f.deps)).created, false);
}
await assert.rejects(addShop(o, fakes({ orgs: [{ id: 'a' }, { id: 'b' }] }).deps), /--org \(a, b\)/);
await assert.rejects(addShop(o, fakes({ shops: { shops: [shopEntry({ ...o, id: 'other' }, REF, 'x')] } }).deps), /Already used by another shop: mainstreet\.com \(other\)/);

{
  // With a master catalog in shops.json, a new shop gets its address and key; the catalog itself doesn't
  const cat = shopEntry({ ...o, id: 'catalog', domains: ['catalog.example.com'], catalog: true }, 'cccccccccccccccccccc', 'cat-anon');
  assert.equal(cat.catalog, true);
  const sent = [];
  const f = fakes({ shops: { shops: [cat] } });
  const api = f.deps.api;
  f.deps.api = async (m, p, body) => { if (p.endsWith('/secrets')) sent.push(...body); return api(m, p, body); };
  await addShop(o, f.deps);
  assert.deepEqual(sent.filter((s) => s.name.startsWith('CATALOG')), [
    { name: 'CATALOG_URL', value: 'https://cccccccccccccccccccc.supabase.co' }, { name: 'CATALOG_ANON_KEY', value: 'cat-anon' }]);
  const g = fakes();
  const sent2 = [];
  const api2 = g.deps.api;
  g.deps.api = async (m, p, body) => { if (p.endsWith('/secrets')) sent2.push(...body); return api2(m, p, body); };
  await addShop({ ...o, catalog: true }, g.deps);
  assert.equal(sent2.some((s) => s.name.startsWith('CATALOG')), false);
  assert.equal(g.written().shops[0].catalog, true);
}

console.log('add-shop tests passed');
