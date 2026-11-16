// node worker/unsubscribe.test.js
import assert from 'node:assert/strict';
import { unsubscribeProxy } from './unsubscribe.js';
import { UNSUBSCRIBE_PATH } from './shop-page.js';

assert.equal(UNSUBSCRIBE_PATH, '/__unsubscribe');
const shop = { id: 'a', supabaseUrl: 'https://abc.supabase.co', anonKey: 'anon' };
const TOKEN = '11111111-1111-1111-1111-111111111111';
const seen = [];
const upstream = (type = 'text/html; charset=utf-8', body = '<!doctype html><html><body>hi</body></html>', status = 200) => async (url, init) => {
  seen.push({ url: String(url), init });
  return new Response(body, { status, headers: { 'Content-Type': type } });
};
const req = (qs, { method = 'GET', body, type } = {}) => new Request(`https://shop.com/__unsubscribe${qs}`, { method, body, headers: type ? { 'Content-Type': type } : {} });

// A GET goes to this shop's own function with only u / k / skip
let res = await unsubscribeProxy(req(`?u=${TOKEN}&k=arrivals&skip=7&evil=https://x.com&to=https://x.com`), shop, upstream());
assert.equal(res.status, 200);
assert.equal(seen[0].url, `https://abc.supabase.co/functions/v1/weekly-pull-list?u=${TOKEN}&k=arrivals&skip=7`);
assert.equal(seen[0].init.method, 'GET');
assert.equal(seen[0].init.headers.get('apikey'), 'anon');
assert.equal(seen[0].init.redirect, 'manual');
assert.equal(res.headers.get('Content-Type'), 'text/html; charset=utf-8');
assert.equal(res.headers.get('Cache-Control'), 'no-store');
assert.equal(res.headers.get('Referrer-Policy'), 'no-referrer');
assert.match(res.headers.get('Content-Security-Policy'), /default-src 'none'/);
assert.match(await res.text(), /hi/);

// One-click POST (what a mail app's Unsubscribe button sends) passes its body and type along
res = await unsubscribeProxy(req(`?u=${TOKEN}`, { method: 'POST', body: 'List-Unsubscribe=One-Click', type: 'application/x-www-form-urlencoded' }), shop, upstream());
assert.equal(res.status, 200);
const post = seen.at(-1);
assert.equal(post.init.method, 'POST');
assert.equal(post.init.headers.get('content-type'), 'application/x-www-form-urlencoded');
assert.equal(new TextDecoder().decode(post.init.body), 'List-Unsubscribe=One-Click');

// The app-style JSON answer is passed through untouched
res = await unsubscribeProxy(req(`?u=${TOKEN}&skip=7`, { method: 'POST', body: '{}', type: 'application/json' }), shop, upstream('application/json', '{"result":"skipped"}'));
assert.equal(res.headers.get('Content-Type'), 'application/json');
assert.equal(await res.text(), '{"result":"skipped"}');

// Supabase's plain-text version of our own page is shown as the page it is; other plain text stays plain
res = await unsubscribeProxy(req(`?u=${TOKEN}`), shop, upstream('text/plain', '<!DOCTYPE html><html>page</html>'));
assert.equal(res.headers.get('Content-Type'), 'text/html; charset=utf-8');
assert.match(res.headers.get('Content-Security-Policy'), /form-action 'self'/);
res = await unsubscribeProxy(req(`?u=${TOKEN}`), shop, upstream('text/plain', 'Not HTML <b>'));
assert.equal(res.headers.get('Content-Type'), 'text/plain');
assert.equal(res.headers.get('Content-Security-Policy'), null);

// Status codes pass through; a function that is down is a 502
assert.equal((await unsubscribeProxy(req(`?u=${TOKEN}`), shop, upstream('application/json', '{}', 405))).status, 405);
assert.equal((await unsubscribeProxy(req(`?u=${TOKEN}`), shop, async () => { throw new Error('down'); })).status, 502);

// Nothing else is handed on: no token, other methods
const before = seen.length;
assert.equal((await unsubscribeProxy(req(''), shop, upstream())).status, 404);
assert.equal((await unsubscribeProxy(req(`?skip=7`), shop, upstream())).status, 404);
assert.equal((await unsubscribeProxy(req(`?u=${TOKEN}`, { method: 'PUT', body: 'x' }), shop, upstream())).status, 404);
assert.equal((await unsubscribeProxy(req(`?u=${TOKEN}`, { method: 'DELETE' }), shop, upstream())).status, 404);
assert.equal(seen.length, before, 'none of those reached the function');
// HEAD asks for the page but returns no body
res = await unsubscribeProxy(new Request(`https://shop.com/__unsubscribe?u=${TOKEN}`, { method: 'HEAD' }), shop, upstream());
assert.equal(res.status, 200);
assert.equal(await res.text(), '');
console.log('unsubscribe proxy tests passed');
