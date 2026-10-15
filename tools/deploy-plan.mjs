#!/usr/bin/env node
// Checks shops.json and works out what a deploy does (.github/workflows/deploy.yml).
//
//   node tools/deploy-plan.mjs --check   # validate shops.json (part of npm test)
//   node tools/deploy-plan.mjs           # in the workflow: print GitHub step outputs (canary=…, shops=…, ready=…)
//
// Shops marked "canary": true are deployed first, to their own Worker (pullwise-canary), and checked before the
// rest. A shop's database password, if you set one, is the GitHub secret SUPABASE_DB_PASSWORD_<ID> (id upper-cased,
// - → _); without it the Supabase CLI logs in with a temporary role through SUPABASE_ACCESS_TOKEN.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const REF = /^[a-z0-9]{20}$/;

export const secretName = (id) => `SUPABASE_DB_PASSWORD_${id.toUpperCase().replace(/-/g, '_')}`;

/** Problems with shops.json's contents (empty when it's fine). */
export function validate(data) {
  if (!data || !Array.isArray(data.shops)) return ['shops.json must be { "shops": [ … ] }'];
  const problems = [];
  const ids = new Set();
  const secrets = new Map();
  const domains = new Map();
  data.shops.forEach((s, i) => {
    const at = `shops[${i}]${s?.id ? ` (${s.id})` : ''}`;
    if (!s || typeof s !== 'object') return problems.push(`${at}: not an object`);
    if (!ID.test(s.id ?? '')) problems.push(`${at}: id must be lower-case letters, digits and single dashes`);
    else if (ids.has(s.id)) problems.push(`${at}: duplicate id`);
    else {
      ids.add(s.id);
      const secret = secretName(s.id);
      if (secrets.has(secret)) problems.push(`${at}: its secret name ${secret} clashes with ${secrets.get(secret)}`);
      secrets.set(secret, s.id);
    }
    if (!Array.isArray(s.domains) || !s.domains.length) problems.push(`${at}: needs at least one domain`);
    for (const d of s.domains ?? []) {
      if (typeof d !== 'string' || d !== d.toLowerCase() || !DOMAIN.test(d)) problems.push(`${at}: "${d}" isn't a lower-case domain name`);
      else if (domains.has(d)) problems.push(`${at}: ${d} is also listed for ${domains.get(d)}`);
      else domains.set(d, s.id);
    }
    if (!REF.test(s.projectRef ?? '')) problems.push(`${at}: projectRef must be the 20-character Supabase project ref`);
    else if (s.supabaseUrl !== `https://${s.projectRef}.supabase.co`) problems.push(`${at}: supabaseUrl must be https://${s.projectRef}.supabase.co`);
    if (typeof s.anonKey !== 'string' || !s.anonKey.trim()) problems.push(`${at}: anonKey is missing`);
    if (s.gaMeasurementId != null && !/^(G-[A-Z0-9]+)?$/.test(s.gaMeasurementId)) problems.push(`${at}: gaMeasurementId looks wrong (G-XXXXXXXXXX)`);
    if (s.canary != null && typeof s.canary !== 'boolean') problems.push(`${at}: canary must be true or false`);
    if (s.catalog != null && typeof s.catalog !== 'boolean') problems.push(`${at}: catalog must be true or false`);
  });
  const catalogs = data.shops.filter((s) => s?.catalog === true).map((s) => s.id);
  if (catalogs.length > 1) problems.push(`only one shop can be the master catalog (${catalogs.join(', ')})`);
  return problems;
}

/** What each deploy job needs to know about a shop. */
// catalogUrl / catalogKey: the master catalog every other shop syncs titles from (empty for the catalog itself,
// or when there's no catalog yet); the deploy sets them as the shop's CATALOG_URL / CATALOG_ANON_KEY secrets.
const target = (catalog) => (s) => ({
  id: s.id, projectRef: s.projectRef, secret: secretName(s.id), url: `https://${s.domains[0]}`, supabaseUrl: s.supabaseUrl, domains: s.domains,
  catalogUrl: catalog && catalog.id !== s.id ? catalog.supabaseUrl : '', catalogKey: catalog && catalog.id !== s.id ? catalog.anonKey : '',
});

export function plan(data, { hasSupabase, hasCloudflare }) {
  const t = target(data.shops.find((s) => s.catalog));
  const canary = data.shops.filter((s) => s.canary).map(t);
  const shops = data.shops.filter((s) => !s.canary).map(t);
  const missing = [!hasSupabase && 'SUPABASE_ACCESS_TOKEN', !hasCloudflare && 'CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID'].filter(Boolean);
  let reason = '';
  if (!data.shops.length) reason = 'shops.json has no shops yet';
  else if (missing.length) reason = `GitHub secrets not set: ${missing.join(', ')}`;
  return { canary, shops, ready: !reason, reason };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'shops.json');
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`shops.json: ${err.message}`);
    process.exit(1);
  }
  const problems = validate(data);
  if (problems.length) {
    console.error(`shops.json has problems:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  if (process.argv.includes('--check')) {
    console.log(`shops.json ok (${data.shops.length} shop${data.shops.length === 1 ? '' : 's'})`);
  } else {
    const p = plan(data, { hasSupabase: process.env.HAS_SUPABASE === 'true', hasCloudflare: process.env.HAS_CLOUDFLARE === 'true' });
    console.log(`canary=${JSON.stringify(p.canary)}`);
    console.log(`shops=${JSON.stringify(p.shops)}`);
    console.log(`ready=${p.ready}`);
    const summary = p.ready
      ? `Deploying to ${p.canary.length} canary and ${p.shops.length} other shop(s).`
      : `**Nothing deployed:** ${p.reason}. See SETUP.md → "Deploys".`;
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
    console.error(summary);
  }
}
