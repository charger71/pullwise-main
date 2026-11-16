#!/usr/bin/env node
// Sets up a new shop end to end and adds it to shops.json. Run it on your computer, from the repo:
//
//   SUPABASE_ACCESS_TOKEN=… npm run add-shop -- --id main-street --name "Main Street Comics" \
//     --domain mainstreetcomics.com --domain www.mainstreetcomics.com --owner-email owner@example.com
//
// Options: --owner-name "Pat Smith"  --shop-email hello@…  --phone "(555) 555-0100"  --timezone America/Chicago
//          --region us-east-1  --org <organization slug>  --project-ref <use an existing project>  --canary
//          --super (make the owner Super Admin)  --catalog (this is the master catalog the other shops sync from)
//          --locations (the shop can have several pickup locations; without it the entry says "locations": false, to flip later)
//          --app (the shop gets the pull list app at /app; without it the entry says "app": false, to flip later)
//          --hide-passwords (print no passwords: the owner uses "Forgot your password?" on the admin sign-in;
//          the "Add a shop" GitHub Action uses this so nothing secret lands in its log)
// Optional env: RESEND_API_KEY, RESEND_FROM, STAFF_CC, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (set as the
// shop's function secrets; with RESEND_API_KEY and RESEND_FROM, sign-in and password emails are sent through Resend too;
// the VAPID ones turn on app notifications).
//
// What it does, each step skipped when already done, so it's safe to run again after a failure:
//   1. Creates the Supabase project "pullwise-<id>" (or uses --project-ref) and waits for it to come up.
//   2. Applies every migration and the seed (supabase db push --include-seed).
//   3. Auth: site URL, sign-in redirect URLs, and the Magic Link email with its 6-digit code.
//   4. Function secrets (SITE_URL, CRON_SECRET, Resend, the master catalog's address) and the matching vault secrets
//      for the hourly jobs.
//   5. Shop Settings: name, email, phone, timezone (only while they're still the starting values).
//   6. The owner's login and staff row (Super Admin with --super).
//   7. Deploys the Edge Functions.
//   8. Adds the shop to shops.json.
// Then you commit shops.json in a pull request; merging it deploys the site (SETUP.md → "Deploys").

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validate } from './deploy-plan.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.supabase.com/v1';
const SEED_SHOP_NAME = 'Your Comic Shop'; // supabase/seed.sql
const CLI_VERSION = '2.121.0';

/** SQL string literal. */
export const lit = (v) => (v == null || v === '' ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const randomSecret = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export function parseArgs(argv) {
  const o = { domains: [], canary: false, super: false, catalog: false, app: false, locations: false, hidePasswords: false, timezone: 'America/New_York', region: 'us-east-1' };
  const names = { '--id': 'id', '--name': 'name', '--owner-email': 'ownerEmail', '--owner-name': 'ownerName', '--shop-email': 'shopEmail',
    '--phone': 'phone', '--timezone': 'timezone', '--region': 'region', '--org': 'org', '--project-ref': 'projectRef' };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s);
    const value = () => (inline !== undefined ? inline : argv[++i]);
    if (flag === '--domain') o.domains.push(String(value()).toLowerCase());
    else if (flag === '--canary') o.canary = true;
    else if (flag === '--super') o.super = true;
    else if (flag === '--catalog') o.catalog = true;
    else if (flag === '--app') o.app = true;
    else if (flag === '--locations') o.locations = true;
    else if (flag === '--hide-passwords') o.hidePasswords = true;
    else if (names[flag]) o[names[flag]] = value();
    else throw new Error(`Unknown option ${argv[i]}`);
  }
  const missing = ['id', 'name', 'ownerEmail'].filter((k) => !o[k]);
  if (!o.domains.length) missing.push('domain');
  if (missing.length) throw new Error(`Missing: ${missing.map((k) => `--${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`).join(', ')}`);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(o.ownerEmail)) throw new Error('--owner-email doesn’t look like an email address');
  o.ownerName ||= o.ownerEmail.split('@')[0];
  o.shopEmail ||= o.ownerEmail;
  return o;
}

/** "Shop <hello@shop.com>" → { name, email }; a bare address has no name. */
export function parseFrom(from) {
  const m = /^\s*(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(from ?? '');
  if (m) return { name: m[1].replace(/^"|"$/g, ''), email: m[2] };
  return /^[^\s@]+@[^\s@]+$/.test((from ?? '').trim()) ? { name: '', email: from.trim() } : null;
}

/**
 * Auth settings for a shop (Management API: PATCH /projects/{ref}/config/auth). With Resend details, sign-in and
 * password emails go out through Resend; without, Supabase's built-in sender only mails your own team's addresses.
 */
export function authConfig(domains, resend = {}) {
  const site = `https://${domains[0]}`;
  const from = parseFrom(resend.from);
  const smtp = resend.apiKey && from
    ? { smtp_host: 'smtp.resend.com', smtp_port: '465', smtp_user: 'resend', smtp_pass: resend.apiKey, smtp_admin_email: from.email, smtp_sender_name: from.name || domains[0] }
    : {};
  return {
    ...smtp,
    site_url: site,
    // account.html and app (the pull list app): customers' sign-in links; admin/: staff password-reset links.
    uri_allow_list: [...domains.flatMap((d) => [`https://${d}/account.html`, `https://${d}/app`, `https://${d}/admin/`]), 'http://localhost:8080/account.html', 'http://localhost:8080/app.html', 'http://localhost:8080/admin/'].join(','),
    disable_signup: false,
    external_email_enabled: true,
    mailer_subjects_magic_link: 'Your sign-in link',
    mailer_templates_magic_link_content:
      '<h2>Sign in</h2><p><a href="{{ .ConfirmationURL }}">Tap here to sign in</a></p>' +
      '<p>Or type this code on the sign-in page: <strong>{{ .Token }}</strong></p>' +
      '<p>If you didn’t ask to sign in, you can ignore this email.</p>',
  };
}

/** Vault secrets the database's hourly email jobs read (created, or updated if they exist). */
export function vaultSql(ref, cronSecret) {
  const set = (name, value) => `
  select id into v from vault.secrets where name = ${lit(name)};
  if v is null then perform vault.create_secret(${lit(value)}, ${lit(name)});
  else perform vault.update_secret(v, ${lit(value)}); end if;`;
  return `do $$ declare v uuid; begin${set('weekly_email_url', `https://${ref}.supabase.co/functions/v1/weekly-pull-list`)}${set('weekly_email_secret', cronSecret)}
end $$;`;
}

/** First Shop Settings, only while they're still the seed's (so a re-run never overwrites the shop's own edits). */
export function settingsSql(o) {
  return `update public.settings set shop_name = ${lit(o.name)}, email = ${lit(o.shopEmail)}, phone = ${lit(o.phone)}, timezone = ${lit(o.timezone)}
where id = 1 and shop_name = ${lit(SEED_SHOP_NAME)};`;
}

export function staffSql(userId, o) {
  let sql = `insert into public.staff (user_id, name, is_owner) values (${lit(userId)}, ${lit(o.ownerName)}, true) on conflict (user_id) do nothing;`;
  if (o.super) {
    sql += `\ndo $$ begin perform set_config('app.allow_super_change', 'on', true);
update public.staff set is_super = true, is_owner = true where user_id = ${lit(userId)}; end $$;`;
  }
  return sql;
}

export function shopEntry(o, ref, anonKey) {
  return { id: o.id, domains: o.domains, supabaseUrl: `https://${ref}.supabase.co`, anonKey, projectRef: ref, gaMeasurementId: '', ...(o.canary ? { canary: true } : {}), ...(o.catalog ? { catalog: true } : {}), app: o.app, locations: o.locations === true }; // always written, so turning either on is one word
}

/**
 * The whole setup. `deps` does the outside work, so tests can fake it:
 *   api(method, path, body) → JSON from the Management API      cli(args) → runs the Supabase CLI
 *   sql(ref, query) → rows                                       authAdmin(supabaseUrl, serviceKey, method, path, body) → { status, json }
 *   readShops() / writeShops(data)                               log(message)   sleep(ms)
 */
export async function addShop(o, deps) {
  const { api, cli, sql, authAdmin, readShops, writeShops, log, sleep } = deps;
  const shops = readShops();
  const existing = shops.shops.find((s) => s.id === o.id);
  const taken = shops.shops.filter((s) => s.id !== o.id).flatMap((s) => s.domains.filter((d) => o.domains.includes(d)).map((d) => `${d} (${s.id})`));
  if (taken.length) throw new Error(`Already used by another shop: ${taken.join(', ')}`);
  const result = { created: false, dbPassword: null, ownerPassword: null };

  // 1. Project
  let ref = o.projectRef || existing?.projectRef;
  if (!ref) {
    const projects = await api('GET', '/projects');
    ref = projects.find((p) => p.name === `pullwise-${o.id}`)?.id;
  }
  if (!ref) {
    let org = o.org;
    if (!org) {
      const orgs = await api('GET', '/organizations');
      if (orgs.length !== 1) throw new Error(`You belong to ${orgs.length} Supabase organizations; pick one with --org (${orgs.map((x) => x.id).join(', ')})`);
      org = orgs[0].id;
    }
    result.dbPassword = randomSecret(24);
    log(`Creating Supabase project pullwise-${o.id} in ${o.region}…`);
    ref = (await api('POST', '/projects', { name: `pullwise-${o.id}`, organization_id: org, db_pass: result.dbPassword, region: o.region })).id;
    result.created = true;
  }
  log(`Project ${ref}: waiting for it to be ready…`);
  for (let i = 0; ; i++) {
    const { status } = await api('GET', `/projects/${ref}`);
    if (status === 'ACTIVE_HEALTHY') break;
    if (i >= 90) throw new Error(`Project ${ref} is still ${status} after 15 minutes; run this again later`);
    await sleep(10_000);
  }
  const keys = await api('GET', `/projects/${ref}/api-keys?reveal=true`);
  const anonKey = keys.find((k) => k.name === 'anon')?.api_key;
  const serviceKey = keys.find((k) => k.name === 'service_role')?.api_key;
  if (!anonKey || !serviceKey) throw new Error('Couldn’t read the project’s anon and service_role keys');

  // 2. Database
  log('Applying migrations and seed…');
  cli(['link', '--project-ref', ref]);
  cli(['db', 'push', '--linked', '--include-seed', '--yes']);

  // 3. Auth
  log('Setting up sign-in…');
  await api('PATCH', `/projects/${ref}/config/auth`, authConfig(o.domains, { apiKey: deps.env.RESEND_API_KEY, from: deps.env.RESEND_FROM }));

  // 4. Secrets: the functions' and the database's copy of CRON_SECRET must match, so both are set together.
  log('Setting secrets…');
  const cronSecret = randomSecret();
  const secrets = [
    { name: 'SITE_URL', value: `https://${o.domains[0]}` },
    { name: 'CRON_SECRET', value: cronSecret },
    // App notifications: one VAPID pair (tools/vapid-keys.mjs) serves every shop.
    ...['RESEND_API_KEY', 'RESEND_FROM', 'STAFF_CC', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'].filter((k) => deps.env[k]).map((k) => ({ name: k, value: deps.env[k] })),
  ];
  // Every shop except the catalog itself copies titles in from the master catalog (catalog-sync).
  const catalog = shops.shops.find((s) => s.catalog && s.id !== o.id);
  if (catalog && !o.catalog) secrets.push({ name: 'CATALOG_URL', value: catalog.supabaseUrl }, { name: 'CATALOG_ANON_KEY', value: catalog.anonKey });
  await api('POST', `/projects/${ref}/secrets`, secrets);
  await sql(ref, vaultSql(ref, cronSecret));

  // 5. Shop Settings
  await sql(ref, settingsSql(o));

  // 6. Owner
  log(`Adding the owner, ${o.ownerEmail}…`);
  const supabaseUrl = `https://${ref}.supabase.co`;
  const password = randomSecret(12);
  const made = await authAdmin(supabaseUrl, serviceKey, 'POST', '/auth/v1/admin/users', { email: o.ownerEmail, password, email_confirm: true });
  if (made.status >= 200 && made.status < 300) result.ownerPassword = password;
  else if (made.status !== 422) throw new Error(`Couldn’t create the owner’s login: ${made.status} ${JSON.stringify(made.json)}`);
  const [user] = await sql(ref, `select id from auth.users where lower(email) = lower(${lit(o.ownerEmail)});`);
  if (!user) throw new Error('The owner’s login wasn’t found after creating it');
  await sql(ref, staffSql(user.id, o));

  // 7. Functions
  log('Deploying Edge Functions…');
  cli(['functions', 'deploy', '--project-ref', ref, '--use-api']);

  // 8. shops.json
  const entry = shopEntry(o, ref, anonKey);
  const next = { shops: existing ? shops.shops.map((s) => (s.id === o.id ? { ...s, ...entry } : s)) : [...shops.shops, entry] };
  const problems = validate(next);
  if (problems.length) throw new Error(`shops.json would be invalid:\n  ${problems.join('\n  ')}`);
  writeShops(next);
  return { ...result, ref, entry };
}

// --- Real dependencies -------------------------------------------------------------------------------------------

function realDeps(token) {
  const api = async (method, p, body) => {
    const res = await fetch(`${API}${p}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Supabase API ${method} ${p}: ${res.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  };
  const shopsFile = path.join(ROOT, 'shops.json');
  return {
    env: process.env,
    api,
    sql: (ref, query) => api('POST', `/projects/${ref}/database/query`, { query }),
    authAdmin: async (url, key, method, p, body) => {
      const res = await fetch(`${url}${p}`, { method, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return { status: res.status, json: await res.json().catch(() => null) };
    },
    cli: (args) => {
      const cmd = spawnSync('npx', ['--yes', `supabase@${CLI_VERSION}`, ...args], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, SUPABASE_ACCESS_TOKEN: token } });
      if (cmd.status !== 0) throw new Error(`supabase ${args.join(' ')} failed`);
    },
    readShops: () => JSON.parse(fs.readFileSync(shopsFile, 'utf8')),
    writeShops: (data) => fs.writeFileSync(shopsFile, `${JSON.stringify(data, null, 2)}\n`),
    log: (m) => console.log(m),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const token = process.env.SUPABASE_ACCESS_TOKEN;
    if (!token) throw new Error('Set SUPABASE_ACCESS_TOKEN (Supabase → Account → Access Tokens)');
    const o = parseArgs(process.argv.slice(2));
    const r = await addShop(o, realDeps(token));
    console.log(`\n✓ ${o.name} is set up (project ${r.ref}) and added to shops.json.\n`);
    if (o.hidePasswords) {
      console.log(`Owner ${o.ownerEmail}: once the site is live, open https://${o.domains[0]}/admin/, type the email and click "Forgot your password?".`);
    } else {
      if (r.dbPassword) console.log(`Database password (save it in your password manager; deploys don't need it): ${r.dbPassword}`);
      if (r.ownerPassword) console.log(`Owner sign-in: ${o.ownerEmail} / ${r.ownerPassword}  (send it privately; they change it in Staff → My Account)`);
      else console.log(`Owner ${o.ownerEmail} already had a login; they keep their password.`);
    }
    console.log(`
Next:
  1. Commit shops.json on a branch and open a pull request; merging it deploys the site to ${o.domains.join(', ')}.
     (Each domain must be a zone in your Cloudflare account.)
  2. Email: verify the shop's sending domain in Resend${process.env.RESEND_API_KEY ? '' : ', then: supabase secrets set RESEND_API_KEY=… --project-ref ' + r.ref}.
  3. The owner signs in at https://${o.domains[0]}/admin/ and fills in Shop Settings (SETUP.md → step 8).`);
  } catch (err) {
    console.error(`\n✗ ${err.message}`);
    process.exit(1);
  }
}
