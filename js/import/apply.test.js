// A title already stored whose sheet row gives a UPC another title holds must not fail the import
// (items_upc_idx allows each UPC once): it keeps its stored UPC and everything else still refreshes.
import assert from 'node:assert/strict';
import { planImport, applyImport, upcClashLine } from './apply.js';

/** Just enough of the Supabase client for planImport and applyImport, over rows in memory. */
function fakeClient(rows) {
  const upserts = [];
  const inserts = [];
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
  });
  return { from, upserts, inserts };
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

console.log('import apply tests passed');
