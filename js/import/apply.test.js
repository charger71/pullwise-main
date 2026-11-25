// A title already stored whose sheet row gives a UPC another title holds must not fail the import
// (items_upc_idx allows each UPC once): it keeps its stored UPC and everything else still refreshes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { planImport, applyImport, upcClashLine, duplicateTitle, unchanged, withoutUnchanged, isPlaceholderCover, refreshPlaceholderCovers, fillMissingCovers, takesOver } from './apply.js';

/** Just enough of the Supabase client for planImport and applyImport, over rows in memory. */
function fakeClient(rows) {
  const upserts = [];
  const inserts = [];
  const updates = [];
  const from = (table) => ({
    select() {
      const filters = [];
      const query = {
        eq: (k, v) => (filters.push((r) => r[k] === v), query),
        in: (k, vs) => (filters.push((r) => vs.includes(r[k])), query),
        then: (ok) => ok({ data: table === 'items' ? rows.filter((r) => filters.every((f) => f(r))) : [], error: null }),
      };
      return query;
    },
    insert: async (batch) => (inserts.push(...batch), { data: null, error: null }),
    upsert: async (batch) => (upserts.push(...batch), { data: null, error: null }),
    update: (patch) => ({ eq: async (_k, id) => (updates.push({ id, ...patch }), { data: null, error: null }) }),
  });
  return { from, upserts, inserts, updates };
}

const stored = () => [
  { id: 1, distributor: 'lunar', sku: 'XMAS', upc: '100', title: 'Christmas Special', issue_number: '1', variant: 'CVR A', cover_url: 'c' },
  { id: 2, distributor: 'lunar', sku: 'OWLS', upc: '200', title: 'Owls New House', issue_number: '1', variant: 'CVR A', cover_url: 'c' },
  { id: 3, distributor: 'lunar', sku: 'SAME', upc: '300', title: 'Same', cover_url: 'c' },
];
const sheet = (sku, upc, extra) => ({ sku, upc, title: sku, ...extra });

// The sheet gives XMAS the UPC that OWLS holds.
let plan = await planImport(fakeClient(stored()), { distributor: 'lunar', items: [sheet('XMAS', '200', { release_date: '2026-11-18' }), sheet('SAME', '300')] });
assert.equal(plan.upcClashes.length, 1);
assert.equal(plan.upcClashes[0].existingTitle.title, 'Owls New House');
assert.equal('upc' in plan.known.find((i) => i.sku === 'XMAS'), false, 'the clashing UPC is left out of the refresh');
assert.equal(plan.known.find((i) => i.sku === 'SAME').upc, '300', 'an unchanged UPC still goes through');
assert.equal(upcClashLine(plan.upcClashes[0]), "XMAS XMAS: the sheet's UPC 200 is already on Owls New House #1 CVR A");

// A move to a free UPC goes through, but only for the first of two rows wanting it.
plan = await planImport(fakeClient(stored()), { distributor: 'lunar', items: [sheet('XMAS', '999'), sheet('OWLS', '999')] });
assert.equal(plan.known.find((i) => i.sku === 'XMAS').upc, '999');
assert.equal('upc' in plan.known.find((i) => i.sku === 'OWLS'), false);
assert.equal(plan.upcClashes.length, 1);

// applyImport keeps the stored UPC, refreshes the rest and reports the clash.
const sb = fakeClient(stored());
const result = await applyImport(sb, { distributor: 'lunar', skipped: [], items: [sheet('XMAS', '200', { release_date: '2026-11-25' })] }, { today: '2026-11-06' });
assert.equal(result.updated, 1);
assert.equal(result.upcClashes.length, 1);
assert.equal(sb.upserts.length, 1);
assert.equal('upc' in sb.upserts[0], false, 'the upsert leaves the stored UPC alone');
assert.equal(sb.upserts[0].release_date, '2026-11-25');

// PRH serves "Cover Coming Soon" at a cover's address until the real one is up. It's never saved as a cover, and a
// title already showing it is fetched again (see PLACEHOLDER_COVERS).
const comingSoon = new Uint8Array(fs.readFileSync(new URL('./testdata/prh-cover-coming-soon.jpg', import.meta.url)));
const realCover = new Uint8Array(2048).fill(7);
const PH_URL = 'https://images.pullwise.shop/catalog/covers/prh/75960621146301921-88f89a9e1a.jpg';
assert.equal(isPlaceholderCover(PH_URL), true);
assert.equal(isPlaceholderCover('https://images.pullwise.shop/catalog/covers/prh/75960621146301911-3393d92f33.jpg'), false);
assert.equal(isPlaceholderCover(null), false);
assert.equal(unchanged({ title: 'CAP' }, { title: 'CAP', cover_url: PH_URL }), false, 'a placeholder cover counts as none, so the daily run picks the title up');

const prhStored = () => [{ id: 9, distributor: 'prh', sku: 'CAP19B', title: 'CAP', cover_url: PH_URL, cover_thumb_url: PH_URL.replace('.jpg', '-sm.jpg') }];
const prhSheet = (sku) => ({ distributor: 'prh', skipped: [], items: [{ sku, title: 'CAP', cover: { url: `https://images.penguinrandomhouse.com/cover/${sku}` } }] });
const stores = [];
const putMediaFake = async (_sb, path) => (stores.push(path), `https://images.pullwise.shop/catalog/${path}`);

// The real cover is up now: it replaces the stored placeholder.
let prhSb = fakeClient(prhStored());
let prhResult = await applyImport(prhSb, prhSheet('CAP19B'), { today: '2026-11-21', fetchRemote: async () => ({ bytes: realCover, type: 'image/jpeg' }), putMedia: putMediaFake });
assert.equal(prhResult.covers, 1);
assert.match(prhSb.upserts[0].cover_url, /covers\/prh\/CAP19B-[0-9a-f]{10}\.jpg$/);
assert.equal(isPlaceholderCover(prhSb.upserts[0].cover_url), false);

// Still the placeholder: it isn't uploaded, the stored one is cleared (the title shows the usual "no cover"), and
// it's counted as without a cover yet.
stores.length = 0;
prhSb = fakeClient(prhStored());
prhResult = await applyImport(prhSb, prhSheet('CAP19B'), { today: '2026-11-21', fetchRemote: async () => ({ bytes: comingSoon, type: 'image/jpeg' }), putMedia: putMediaFake });
assert.equal(prhResult.covers, 0);
assert.equal(prhResult.coversMissing, 1);
assert.equal(stores.length, 0, 'the placeholder isn\'t uploaded');
assert.equal(prhSb.upserts[0].cover_url, null);
assert.equal(prhSb.upserts[0].cover_thumb_url, null);

// The same when the title's details haven't changed (the daily run's coverOnly titles): only the cover is cleared.
prhSb = fakeClient(prhStored());
prhResult = await applyImport(prhSb, { ...prhSheet('CAP19B'), items: prhSheet('CAP19B').items.map((i) => ({ ...i, coverOnly: true })) },
  { today: '2026-11-21', fetchRemote: async () => ({ bytes: comingSoon, type: 'image/jpeg' }), putMedia: putMediaFake });
assert.equal(prhSb.upserts.length, 0);
assert.deepEqual(prhSb.updates, [{ id: 9, cover_url: null, cover_thumb_url: null }]);

// A new title whose only picture is the placeholder is added without a cover.
prhSb = fakeClient([]);
await applyImport(prhSb, prhSheet('NEW1'), { today: '2026-11-21', fetchRemote: async () => ({ bytes: comingSoon, type: 'image/jpeg' }), putMedia: putMediaFake });
assert.equal(prhSb.inserts[0].cover_url, null);

// The daily run: a title stored exactly as the sheet lists it but still without a cover counts as unchanged and
// isn't saved again (shops would copy it each day). Its cover is still looked for, and saved alone when it turns up.
{
  const coverless = () => [{ id: 9, distributor: 'prh', sku: 'CAP19B', title: 'CAP', cover_url: null }];
  const todo = await withoutUnchanged(fakeClient(coverless()), prhSheet('CAP19B'));
  assert.equal(todo.unchanged, 1);
  assert.equal(todo.items[0].coverOnly, true);
  const changed = await withoutUnchanged(fakeClient(coverless()), { ...prhSheet('CAP19B'), items: [{ ...prhSheet('CAP19B').items[0], title: 'CAP NEW' }] });
  assert.equal(changed.unchanged, 0, 'a changed title is refreshed as before');
  assert.equal(changed.items[0].coverOnly, undefined);

  let sb = fakeClient(coverless());
  let result = await applyImport(sb, todo, { today: '2026-11-21', fetchRemote: async () => ({ bytes: comingSoon, type: 'image/jpeg' }), putMedia: putMediaFake });
  assert.equal(result.updated, 0, 'not counted as refreshed');
  assert.equal(result.coversMissing, 1);
  assert.equal(sb.upserts.length + sb.updates.length, 0, 'nothing saved');

  sb = fakeClient(coverless());
  result = await applyImport(sb, todo, { today: '2026-11-21', fetchRemote: async () => ({ bytes: realCover, type: 'image/jpeg' }), putMedia: putMediaFake });
  assert.equal(result.updated, 0);
  assert.equal(result.covers, 1);
  assert.equal(sb.upserts.length, 0);
  assert.deepEqual(Object.keys(sb.updates[0]).sort(), ['cover_thumb_url', 'cover_url', 'id'], 'only the picture is saved');
  assert.equal(sb.updates[0].id, 9);
}

// refreshPlaceholderCovers: every placeholder, whatever the date, including covers saved before names had a hash.
{
  const rows = [
    { id: 1, distributor: 'prh', sku: 'UP', title: 'Up now', cover_url: PH_URL },
    { id: 2, distributor: 'prh', sku: 'OLD', title: 'Old name', cover_url: 'https://images.pullwise.shop/catalog/covers/prh/OLD.jpg' },
    { id: 3, distributor: 'prh', sku: 'LATER', title: 'Not yet', cover_url: 'https://images.pullwise.shop/catalog/covers/prh/LATER-48fb1ed2e3.jpg' },
    { id: 4, distributor: 'prh', sku: 'FINE', title: 'Fine', cover_url: 'https://images.pullwise.shop/catalog/covers/prh/FINE-3393d92f33.jpg' },
    { id: 5, distributor: 'prh', sku: 'FINEOLD', title: 'Fine old', cover_url: 'https://images.pullwise.shop/catalog/covers/prh/FINEOLD.jpg' },
    { id: 6, distributor: 'lunar', sku: 'L', title: 'Lunar', cover_url: PH_URL },
  ];
  const updates = [];
  const sb = {
    from: () => ({
      select() {
        const filters = [];
        const q = {
          eq: (k, v) => (filters.push((r) => r[k] === v), q),
          not: (k) => (filters.push((r) => r[k] != null), q),
          order: () => q,
          range: (a, b) => Promise.resolve({ data: rows.filter((r) => filters.every((f) => f(r))).slice(a, b + 1), error: null }),
        };
        return q;
      },
      update: (patch) => ({
        eq: async (_k, id) => (updates.push({ id, ...patch }), { data: null, error: null }),
        in: async (_k, ids) => (ids.forEach((id) => updates.push({ id, ...patch })), { data: null, error: null }),
      }),
    }),
  };
  const fetched = [];
  const fetchRemote = async ({ url }) => {
    fetched.push(url);
    // Stored copies: OLD is the placeholder, FINEOLD a real cover. At PRH: LATER is still coming, the rest are up.
    if (url.endsWith('/OLD.jpg') || url.endsWith('/LATER')) return { bytes: comingSoon, type: 'image/jpeg' };
    return { bytes: realCover, type: 'image/jpeg' };
  };
  const r = await refreshPlaceholderCovers(sb, { distributor: 'prh', coverUrl: (sku) => `https://prh.test/cover/${sku}`, fetchRemote, putMedia: putMediaFake });
  assert.deepEqual({ ...r, errors: r.errors.length }, { checked: 5, placeholders: 3, replaced: 2, stillComing: 1, cleared: 1, errors: 0 });
  assert.deepEqual(updates.map((u) => u.id).sort(), [1, 2, 3]);
  assert.ok(updates.filter((u) => u.id !== 3).every((u) => /covers\/prh\/\w+-[0-9a-f]{10}\.jpg$/.test(u.cover_url)));
  assert.deepEqual(updates.find((u) => u.id === 3), { id: 3, cover_url: null, cover_thumb_url: null }, 'still coming: the placeholder is cleared');
  assert.ok(!fetched.includes('https://prh.test/cover/FINE'), 'titles with a real cover are left alone');
}

// fillMissingCovers: every title with no cover, whatever its dates; ones Lunar has no picture for stay as they are.
{
  const rows = [
    { id: 1, distributor: 'lunar', sku: 'HYDE', title: 'Hyde Street', cover_url: null },
    { id: 2, distributor: 'lunar', sku: 'NONE', title: 'No art yet', cover_url: null },
    { id: 3, distributor: 'lunar', sku: 'HAS', title: 'Has one', cover_url: 'https://images.pullwise.shop/catalog/covers/lunar/HAS-3393d92f33.jpg' },
    { id: 4, distributor: 'prh', sku: 'P', title: 'PRH', cover_url: null },
  ];
  const updates = [];
  const sb = {
    from: () => ({
      select() {
        const filters = [];
        const q = {
          eq: (k, v) => (filters.push((r) => r[k] === v), q),
          is: (k, v) => (filters.push((r) => r[k] === v), q),
          order: () => q,
          range: (a, b) => Promise.resolve({ data: rows.filter((r) => filters.every((f) => f(r))).slice(a, b + 1), error: null }),
        };
        return q;
      },
      update: (patch) => ({ eq: async (_k, id) => (updates.push({ id, ...patch }), { data: null, error: null }) }),
    }),
  };
  const fetched = [];
  const fetchRemote = async ({ url }) => (fetched.push(url), url.includes('NONE') ? null : { bytes: realCover, type: 'image/jpeg' });
  const r = await fillMissingCovers(sb, { distributor: 'lunar', cover: (sku) => ({ url: `https://lunar.test/hires/${sku}.jpg`, preferUrl: true }), fetchRemote, putMedia: putMediaFake });
  assert.deepEqual({ ...r, errors: r.errors.length }, { missing: 2, filled: 1, stillMissing: 1, errors: 0 });
  assert.deepEqual(updates.map((u) => u.id), [1]);
  assert.match(updates[0].cover_url, /covers\/lunar\/HYDE-hires-[0-9a-f]{10}\.jpg$/);
  assert.deepEqual(fetched.sort(), ['https://lunar.test/hires/HYDE.jpg', 'https://lunar.test/hires/NONE.jpg']);
}

// Lunar takes over DC titles PRH listed first: the same row becomes Lunar's. Anything else stays with the first listing.
{
  const rows = [
    { id: 10, distributor: 'prh', sku: '9781799509967', isbn: '9781799509967', upc: null, title: 'Absolute Green Lantern Vol. 3 (Paperback)', publisher: 'DC', cover_url: 'c' },
    { id: 11, distributor: 'prh', sku: '9781534300001', isbn: '9781534300001', upc: null, title: 'Saga Vol. 1', publisher: 'Image', cover_url: 'c' },
    { id: 12, distributor: 'lunar', sku: 'OTHER', upc: '761941', title: 'Holds the UPC', publisher: 'DC', cover_url: 'c' },
    { id: 13, distributor: 'prh', sku: '9781799500001', isbn: '9781799500001', upc: null, title: 'Sandman (Paperback)', publisher: 'DC Vertigo', cover_url: 'c' },
  ];
  const lunarSheet = [
    { sku: '0726DC0265', isbn: '9781799509967', title: 'ABSOLUTE GREEN LANTERN TP VOL 03 ANOMALIES', publisher: 'DC', price: 17.99 },
    { sku: '0726IM0001', isbn: '9781534300001', title: 'SAGA TP VOL 01', publisher: 'IMAGE' },
    { sku: '0726DC0300', isbn: '9781799500001', upc: '761941', title: 'SANDMAN TP', publisher: 'DC' },
  ];
  const plan = await planImport(fakeClient(rows), { distributor: 'lunar', items: lunarSheet });
  assert.deepEqual(plan.takeovers.map((i) => i.sku), ['0726DC0265', '0726DC0300']);
  assert.deepEqual(plan.duplicates.map((i) => i.sku), ['0726IM0001'], 'a non-DC title stays with PRH');
  assert.equal('upc' in plan.takeovers[1], false, "a UPC another title holds isn't taken over");

  const sb = fakeClient(rows);
  const r = await applyImport(sb, { distributor: 'lunar', items: lunarSheet, skipped: [] }, { today: '2026-11-22', fetchRemote: async () => null });
  assert.equal(r.switched, 2);
  assert.equal(r.added, 0);
  assert.equal(sb.inserts.length, 0);
  assert.deepEqual(sb.updates.map((u) => [u.id, u.distributor, u.sku]), [[10, 'lunar', '0726DC0265'], [13, 'lunar', '0726DC0300']]);
  assert.equal(sb.updates[0].title, 'ABSOLUTE GREEN LANTERN TP VOL 03 ANOMALIES');
  assert.equal(sb.updates[0].retail_price, 17.99);
  assert.equal('cover_url' in sb.updates[0], false, 'no Lunar picture: the PRH cover stays');
  assert.match(r.switchedTitles[0], /^0726DC0265 ABSOLUTE GREEN LANTERN .* \(was PRH\)$/);

  assert.equal(takesOver('prh', { publisher: 'DC' }, { distributor: 'lunar', publisher: 'DC' }), false, 'PRH never takes over from Lunar');
  assert.equal(takesOver('lunar', { publisher: 'MARVEL' }, { distributor: 'prh', publisher: 'Marvel' }), false);
  assert.equal(takesOver('lunar', { publisher: 'DC' }, { distributor: 'prh', publisher: 'DC Black Label' }), true);
  assert.equal(takesOver('lunar', { publisher: 'DCW' }, { distributor: 'prh', publisher: 'DCW' }), false);
}

// A new title whose UPC another title holds is left out, and named for Import → Left Out.
plan = await planImport(fakeClient(stored()), { distributor: 'prh', items: [sheet('NEW', '100', { issue_number: '1' }), { sku: 'BOOK', isbn: '978', title: 'Book' }] });
assert.equal(plan.duplicates.length, 1);
assert.deepEqual(duplicateTitle(plan.duplicates[0]), { sku: 'NEW', title: 'NEW #1', on: 'Christmas Special #1 CVR A', code: 'UPC 100' });
assert.equal(duplicateTitle({ sku: 'B', title: 'Book', isbn: '978', existingTitle: { title: 'Book (Hardcover)', isbn: '978' } }).code, 'ISBN 978');

console.log('import apply tests passed');
