// node supabase/functions/prh-sync/rules.test.js
import assert from 'node:assert/strict';
import { lookupPlan, titleUrl, htmlToText, changes, lookup, summary } from './rules.js';

// Where to look: books by ISBN (PRH.US, then SALESPLATFORM), comics by UPC in SALESPLATFORM only
assert.deepEqual(lookupPlan({ isbn: '9780593135204', upc: null }).map((p) => p.domain), ['PRH.US', 'SALESPLATFORM']);
assert.deepEqual(lookupPlan({ isbn: null, upc: '75960621436500421' }), [{ domain: 'SALESPLATFORM', code: '75960621436500421' }]);
assert.deepEqual(lookupPlan({ isbn: null, upc: null }), []);
assert.equal(titleUrl({ domain: 'PRH.US', code: '9780593135204' }, 'k&y'),
  'https://api.penguinrandomhouse.com/resources/v2/title/domains/PRH.US/titles/9780593135204?api_key=k%26y');

// PRH copy as plain text
assert.equal(htmlToText('<b>#1 BESTSELLER</b><br><br>&ldquo;Two plus two?&rdquo;<p>One</p><p>Two</p>'), '#1 BESTSELLER\n\n“Two plus two?”One\n\nTwo');
assert.equal(htmlToText(' Copyright &#169; 2021'), 'Copyright © 2021');
assert.equal(htmlToText('<p></p>'), null);

// What changes
const item = { id: 1, description: null, creators: null, retail_price: '4.99', foc_date: '2026-10-19', release_date: '2026-11-18' };
const record = {
  author: 'Kevin Smith', onsale: '2026-11-25', focDate: '2026-10-19',
  price: [{ amount: 6.25, currencyCode: 'CAD' }, { amount: 4.99, currencyCode: 'USD' }],
};
assert.deepEqual(changes(item, record, { flapcopy: '<p>Spidey &amp; Hulk.</p>' }),
  { release_date: '2026-11-25', description: 'Spidey & Hulk.', creators: 'Kevin Smith' });
// Staff's description and creators stay; the price follows PRH
assert.deepEqual(changes({ ...item, description: 'Ours', creators: 'Ours' }, { ...record, price: [{ amount: 5.99, currencyCode: 'USD' }] }, { flapcopy: 'Theirs' }),
  { release_date: '2026-11-25', retail_price: 5.99 });
// Nothing PRH leaves out is cleared, and a title PRH agrees with isn't touched
assert.deepEqual(changes({ ...item, description: 'x', creators: 'y', release_date: '2026-11-25' }, { onsale: null, focDate: null, price: [] }, null), {});
assert.deepEqual(changes({ ...item, description: 'x', creators: 'y', release_date: '2026-11-25' }, record, null), {});
// The keynote stands in when there's no flap copy
assert.equal(changes(item, record, { flapcopy: null, keynote: 'Short pitch' }).description, 'Short pitch');

// The look-up: the first domain that knows it, copy only when needed, errors other than 404 stop it
const replies = (map) => {
  const calls = [];
  const fetchJson = async (url) => {
    calls.push(url.replace(/\?.*/, '').replace('https://api.penguinrandomhouse.com/resources/v2/title/domains/', ''));
    const hit = Object.entries(map).find(([k]) => calls.at(-1) === k);
    return hit ? hit[1] : { status: 404, body: null };
  };
  return { calls, fetchJson };
};
const ok = (body) => ({ status: 200, body });
{
  const r = replies({ 'SALESPLATFORM/titles/9781302900001': ok({ data: { titles: [record] } }), 'SALESPLATFORM/titles/9781302900001/content': ok({ data: { content: { flapcopy: 'F' } } }) });
  const got = await lookup({ isbn: '9781302900001', upc: null, description: null }, 'k', r.fetchJson);
  assert.equal(got.domain, 'SALESPLATFORM');
  assert.equal(got.content.flapcopy, 'F');
  assert.deepEqual(r.calls, ['PRH.US/titles/9781302900001', 'SALESPLATFORM/titles/9781302900001', 'SALESPLATFORM/titles/9781302900001/content']);
}
{
  const r = replies({ 'SALESPLATFORM/titles/75960621436500421': ok({ data: { titles: [record] } }) });
  const got = await lookup({ isbn: null, upc: '75960621436500421', description: 'Has one' }, 'k', r.fetchJson);
  assert.equal(got.found, true);
  assert.equal(r.calls.length, 1, 'no copy fetched for a title that has a description');
}
{
  const r = replies({});
  assert.deepEqual(await lookup({ isbn: null, upc: '1', description: null }, 'k', r.fetchJson), { found: false, domain: null, record: null, content: null });
  const down = replies({ 'SALESPLATFORM/titles/1': { status: 403, body: null } });
  await assert.rejects(lookup({ isbn: null, upc: '1' }, 'k', down.fetchJson), /PRH answered 403/);
}

// Recent Runs line
assert.equal(summary({ checked: 200, updated: 0, notFound: 3, failed: 0, descriptions: 0 }), null);
assert.equal(summary({ checked: 200, updated: 12, notFound: 3, failed: 1, descriptions: 9 }), '200 checked, 12 updated, 9 descriptions added, 3 not found at PRH, 1 failed');

console.log('prh sync tests passed');
