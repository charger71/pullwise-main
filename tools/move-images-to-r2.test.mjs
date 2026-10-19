// node tools/move-images-to-r2.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { target, rewriteSql, moveImages, r2Settings, SUPABASE_MEDIA } from './move-images-to-r2.mjs';

const shop = { id: 'catalog' };
const POPS = 'https://gjlpuqxfnanfwbioozju.supabase.co/storage/v1/object/public/media';

// Addresses
assert.deepEqual(target(`${POPS}/covers/lunar/ABC-1f2e.jpg`, shop, 'https://images.example.com/'), {
  from: `${POPS}/covers/lunar/ABC-1f2e.jpg`, key: 'catalog/covers/lunar/ABC-1f2e.jpg', to: 'https://images.example.com/catalog/covers/lunar/ABC-1f2e.jpg' });
assert.equal(target(`${POPS}/series/a%20b.jpg`, shop, 'https://i.x').key, 'catalog/series/a b.jpg', 'stored under the decoded name');
assert.equal(target(`${POPS}/series/a%20b.jpg`, shop, 'https://i.x').to, 'https://i.x/catalog/series/a%20b.jpg');
assert.equal(target('https://images.example.com/catalog/covers/x.jpg', shop, 'https://i.x'), null, 'already moved');
assert.equal(target(`${POPS}/covers/x.jpg?width=64`, shop, 'https://i.x'), null, 'resized links are left alone');
assert.equal(SUPABASE_MEDIA.test('https://evil.com/storage/v1/object/public/media/x.jpg'), false);

// SQL
assert.equal(rewriteSql([]), null);
const sql = rewriteSql([{ from: "https://x/o'k.jpg", to: 'https://i/o.jpg' }]);
assert.match(sql, /\('https:\/\/x\/o''k\.jpg', 'https:\/\/i\/o\.jpg'\)/, 'quotes escaped');
assert.match(sql, /update public\.items i set\s+cover_url = .*\s+cover_thumb_url = /s, 'cover and small copy in one update');
assert.match(sql, /update public\.series_catalog s set cover_url/);

// wrangler.jsonc in this repo has what the tool needs
const cfg = r2Settings(fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
assert.ok(cfg.bucket && /^https:\/\//.test(cfg.publicBase));
assert.throws(() => r2Settings('{}'), /MEDIA R2 bucket/);

// The run, against fakes: 250 addresses (one gone), in batches, rewritten as it goes
const urls = Array.from({ length: 250 }, (_, i) => `${POPS}/covers/lunar/T${i}.jpg`);
const stored = new Map();
const statements = [];
const deps = {
  log: () => {},
  sql: async (q) => {
    if (q.startsWith('select distinct u')) return urls.map((u) => ({ u }));
    statements.push(q);
    return [{ rewritten: (q.match(/\('https/g) ?? []).length }];
  },
  download: async (u) => (u.endsWith('/T13.jpg') ? null : { bytes: new Uint8Array([1, 2, 3]), type: 'image/jpeg' }),
  put: async (key, bytes, type) => stored.set(key, type),
};
const dry = await moveImages({ shop, publicBase: 'https://i.x', dryRun: true }, deps);
assert.deepEqual([dry.found, dry.copied, stored.size, statements.length], [250, 0, 0, 0], 'a dry run changes nothing');
const r = await moveImages({ shop, publicBase: 'https://i.x', dryRun: false }, deps);
assert.deepEqual([r.found, r.copied, r.rewritten, r.missing.length], [250, 249, 249, 1]);
assert.equal(statements.length, 3, 'one rewrite per batch of 100');
assert.ok(stored.has('catalog/covers/lunar/T0.jpg') && !stored.has('catalog/covers/lunar/T13.jpg'));
assert.ok(!statements.join().includes('/T13.jpg'), "a missing image keeps its old address");

console.log('move images tests passed');
