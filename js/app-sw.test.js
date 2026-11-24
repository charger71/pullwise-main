// node js/app-sw.test.js: the pull list app's service worker (sw.js) shows a Skip button on a one-title "new from your
// follows" push, and a tap on it asks the server to take the title off, then says how that went.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

function load({ fetchImpl } = {}) {
  const handlers = {};
  const shown = [];
  const opened = [];
  const calls = [];
  const self = {
    addEventListener: (type, fn) => (handlers[type] = fn),
    skipWaiting: () => {},
    registration: { showNotification: async (title, options) => shown.push({ title, ...options }) },
    clients: { claim: async () => {}, matchAll: async () => [], openWindow: async (url) => opened.push(url) },
  };
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return fetchImpl(url, init);
  };
  vm.runInNewContext(code, { self, location: { origin: 'https://shop.example' }, URL, fetch, navigator: {}, caches: {} });
  const fire = async (type, event) => {
    let wait;
    handlers[type]({ ...event, waitUntil: (p) => (wait = p) });
    await wait;
  };
  return { fire, shown, opened, calls };
}

const push = (data) => ({ data: { json: () => data, text: () => JSON.stringify(data) } });
const SKIP = 'https://db.example/functions/v1/weekly-pull-list?u=11111111-1111-1111-1111-111111111111&skip=77';

// A push with a skip link shows a Skip button; one without, or with a link that isn't https, shows none.
{
  const sw = load();
  await sw.fire('push', push({ title: 'New on your pull list', body: 'Spawn #401', url: '/app?title=9#list', tag: 'new-titles', skip: { url: SKIP, title: 'Spawn #401' } }));
  assert.deepEqual(JSON.parse(JSON.stringify(sw.shown[0].actions)), [{ action: 'skip', title: 'Skip' }]);
  assert.equal(sw.shown[0].data.skip.url, SKIP);
  await sw.fire('push', push({ title: 'x' }));
  assert.equal(sw.shown[1].actions, undefined, 'no link, no button');
  await sw.fire('push', push({ title: 'x', skip: { url: 'http://insecure.example/?skip=1' } }));
  assert.equal(sw.shown[2].actions, undefined, 'only an https link');
}

// Tapping Skip: a POST to the link, then a notice in the same slot saying it worked.
{
  const sw = load({ fetchImpl: async () => ({ json: async () => ({ result: 'skipped', title: 'Spawn #401' }) }) });
  const notification = { tag: 'new-titles', data: { url: '/app?title=9#list', skip: { url: SKIP, title: 'Spawn #401' } }, close: () => {} };
  await sw.fire('notificationclick', { notification, action: 'skip' });
  assert.equal(sw.calls.length, 1);
  assert.equal(sw.calls[0].url, SKIP);
  assert.equal(sw.calls[0].init.method, 'POST');
  assert.equal(sw.calls[0].init.headers['Content-Type'], 'text/plain', 'a simple request: no preflight');
  assert.equal(sw.shown[0].title, 'Skipped');
  assert.match(sw.shown[0].body, /^Spawn #401 is off your pull list/);
  assert.equal(sw.shown[0].tag, 'new-titles', 'replaces the notification it answers');
  assert.equal(sw.opened.length, 0, 'the app is not opened');
}

// Already removed counts as done; past the cutoff, or no answer at all, says so and points to the app.
for (const [name, fetchImpl, ok] of [
  ['already', async () => ({ json: async () => ({ result: 'already' }) }), true],
  ['closed', async () => ({ json: async () => ({ result: 'closed' }) }), false],
  ['offline', async () => { throw new Error('offline'); }, false],
  ['not json', async () => ({ json: async () => { throw new Error('html'); } }), false],
]) {
  const sw = load({ fetchImpl });
  const notification = { tag: 'new-titles', data: { url: '/app#list', skip: { url: SKIP, title: 'Spawn #401' } }, close: () => {} };
  await sw.fire('notificationclick', { notification, action: 'skip' });
  assert.equal(sw.shown[0].title, ok ? 'Skipped' : 'Couldn’t skip it', name);
  if (!ok) assert.match(sw.shown[0].body, /still on your list/, name);
}

// A plain tap (or a device with no buttons) still opens the app, and never skips anything.
{
  const sw = load({ fetchImpl: async () => assert.fail('a plain tap must not skip') });
  const notification = { data: { url: '/app?title=9#list', skip: { url: SKIP, title: 'Spawn #401' } }, close: () => {} };
  await sw.fire('notificationclick', { notification });
  assert.deepEqual(sw.opened, ['https://shop.example/app?title=9#list']);
  assert.equal(sw.calls.length, 0);
}

// A notice only ever opens the shop's own site: a link to anywhere else (a backslash path the URL parser reads as
// another host) opens the app instead.
for (const url of ['/\\evil.test/x', 'https://evil.test/', '//evil.test/x']) {
  const sw = load({});
  await sw.fire('notificationclick', { notification: { data: { url }, close: () => {} } });
  assert.deepEqual(sw.opened, ['https://shop.example/app'], url);
}
{
  const sw = load({});
  await sw.fire('notificationclick', { notification: { data: { url: '/news/big-sale' }, close: () => {} } });
  assert.deepEqual(sw.opened, ['https://shop.example/news/big-sale'], 'a page on the shop’s own site opens');
}

console.log('app service worker tests passed');
