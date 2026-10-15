// node supabase/functions/catalog-sync/sync.test.js
import assert from 'node:assert/strict';
import { pageUrl, toRow, runSync, summary, PAGE_SIZE } from './sync.js';

// Query
const first = new URL(pageUrl('https://cat.supabase.co/', null));
assert.equal(first.origin + first.pathname, 'https://cat.supabase.co/rest/v1/items');
assert.equal(first.searchParams.get('order'), 'updated_at.asc,id.asc');
assert.equal(first.searchParams.get('limit'), String(PAGE_SIZE));
assert.match(first.searchParams.get('select'), /^id,title,.*,updated_at,category:categories\(slug\)$/);
assert.equal(first.searchParams.get('or'), null);
const next = new URL(pageUrl('https://cat.supabase.co', { at: '2026-10-15T14:00:00.123456+00:00', id: 42 }));
assert.equal(next.searchParams.get('or'), '(updated_at.gt."2026-10-15T14:00:00.123456+00:00",and(updated_at.eq."2026-10-15T14:00:00.123456+00:00",id.gt.42))');
assert.match(pageUrl('https://c.co', { at: 'x+y', id: 1 }), /x%2By/, 'a + in the timestamp is encoded');

// Row shape
assert.deepEqual(toRow({ id: 1, title: 'T', updated_at: 'x', category: { slug: 'comics' } }), { id: 1, title: 'T', category_slug: 'comics' });
assert.deepEqual(toRow({ id: 1, category: null }), { id: 1, category_slug: null });

// The loop, against a fake catalog of n titles
function catalog(n) {
  const rows = Array.from({ length: n }, (_, i) => ({ id: i + 1, title: `T${i + 1}`, updated_at: `2026-10-15T00:00:00.${String(Math.floor(i / 3)).padStart(6, '0')}+00:00`, category: null }));
  const calls = { pages: 0, applied: [], cursors: [] };
  let clock = 0;
  const deps = {
    now: () => clock,
    fetchPage: async (url) => {
      calls.pages++;
      clock += 10;
      const or = new URL(url).searchParams.get('or');
      let after = rows;
      if (or) {
        const [, at, id] = /updated_at\.gt\."([^"]+)".*id\.gt\.(\d+)/.exec(or);
        after = rows.filter((r) => r.updated_at > at || (r.updated_at === at && r.id > Number(id)));
      }
      return after.slice(0, PAGE_SIZE);
    },
    apply: async (batch) => { calls.applied.push(...batch.map((r) => r.id)); return { inserted: batch.length, updated: 0, unchanged: 0, failed: 0, error: null }; },
    saveCursor: async (c) => calls.cursors.push(c),
  };
  return { rows, calls, deps };
}

{
  const c = catalog(1203);
  const t = await runSync({ catalogUrl: 'https://cat', cursor: null }, c.deps);
  assert.equal(t.inserted, 1203);
  assert.equal(t.pages, 3);
  assert.equal(t.done, true);
  assert.deepEqual(c.calls.applied, c.rows.map((r) => r.id), 'every title once, in order, across pages');
  assert.deepEqual(c.calls.cursors.at(-1), { at: c.rows.at(-1).updated_at, id: 1203 });
}
{
  // Resuming from a cursor in the middle of a timestamp skips nothing and repeats nothing
  const c = catalog(10);
  const t = await runSync({ catalogUrl: 'https://cat', cursor: { at: c.rows[4].updated_at, id: 5 } }, c.deps);
  assert.deepEqual(c.calls.applied, [6, 7, 8, 9, 10]);
  assert.equal(t.done, true);
}
{
  // Exactly a page's worth: one more (empty) fetch to be sure it's the end
  const c = catalog(PAGE_SIZE);
  const t = await runSync({ catalogUrl: 'https://cat', cursor: null }, c.deps);
  assert.equal(c.calls.pages, 2);
  assert.equal(t.done, true);
}
{
  // Out of time: stops with the cursor saved after the last full page
  const c = catalog(1500);
  const t = await runSync({ catalogUrl: 'https://cat', cursor: null, budgetMs: 15 }, c.deps);
  assert.equal(t.pages, 2);
  assert.equal(t.done, false);
  assert.equal(c.calls.cursors.at(-1).id, 1000);
}
{
  // Nothing new
  const c = catalog(0);
  const t = await runSync({ catalogUrl: 'https://cat', cursor: null }, c.deps);
  assert.deepEqual([t.pages, t.done], [0, true]);
}
{
  // Failures are added up; the first error is kept
  const c = catalog(3);
  c.deps.apply = async () => ({ inserted: 2, updated: 0, unchanged: 0, failed: 1, error: 'catalog title 2: bad' });
  const t = await runSync({ catalogUrl: 'https://cat', cursor: null }, c.deps);
  assert.equal(t.failed, 1);
  assert.equal(t.error, 'catalog title 2: bad');
}
{
  // A catalog or database error stops the run without moving the cursor past it
  const c = catalog(3);
  c.deps.apply = async () => { throw new Error('boom'); };
  await assert.rejects(runSync({ catalogUrl: 'https://cat', cursor: null }, c.deps), /boom/);
  assert.equal(c.calls.cursors.length, 0);
}

// Log line
assert.equal(summary({ inserted: 0, updated: 0, failed: 0, done: true }), null);
assert.equal(summary({ inserted: 3, updated: 1, failed: 0, done: true }), '3 new, 1 updated');
assert.equal(summary({ inserted: 0, updated: 0, failed: 1, error: 'x', done: false }), '0 new, 0 updated, 1 failed (x), more next hour');

console.log('catalog sync tests passed');
