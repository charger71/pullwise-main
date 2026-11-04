// node admin/sw.test.js: the admin service worker (sw.js) shows a chat push and opens the chat when it's tapped.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('./sw.js', import.meta.url), 'utf8');

function load({ windows = [] } = {}) {
  const handlers = {};
  const shown = [];
  const opened = [];
  const self = {
    addEventListener: (type, fn) => (handlers[type] = fn),
    skipWaiting: () => {},
    registration: { showNotification: async (title, options) => shown.push({ title, ...options }) },
    clients: { claim: async () => {}, matchAll: async () => windows, openWindow: async (url) => opened.push(url) },
  };
  vm.runInNewContext(code, { self, location: { origin: 'https://shop.example' }, URL });
  const fire = async (type, event) => {
    let wait;
    handlers[type]({ ...event, waitUntil: (p) => (wait = p) });
    await wait;
  };
  return { fire, shown, opened };
}

const push = (data) => ({ data: { json: () => data, text: () => JSON.stringify(data) } });

// A chat push: title, body, tag and the chat's address; another site's address is never followed.
{
  const sw = load();
  await sw.fire('push', push({ title: 'Chat from Sam', body: 'Issue 3?', url: '/admin/#chat/12', tag: 'chat-12', icon: 'https://cdn.example/i.png' }));
  assert.equal(sw.shown[0].title, 'Chat from Sam');
  assert.equal(sw.shown[0].body, 'Issue 3?');
  assert.equal(sw.shown[0].tag, 'chat-12');
  assert.equal(sw.shown[0].renotify, true, 'a new message in the same chat buzzes again');
  assert.equal(sw.shown[0].data.url, '/admin/#chat/12');
  await sw.fire('push', push({ title: 'x', url: 'https://evil.example/' , icon: 'http://insecure/i.png' }));
  assert.equal(sw.shown[1].data.url, '/admin/#chat');
  assert.equal(sw.shown[1].icon, undefined);
  await sw.fire('push', { data: { json: () => { throw new Error('not json'); }, text: () => 'plain' } });
  assert.equal(sw.shown[2].title, 'New chat message');
  assert.equal(sw.shown[2].body, 'plain');
}

// Tapping it: an open admin tab is asked to show the chat and brought forward; otherwise a new window opens.
{
  const posted = [];
  let focused = false;
  const tab = { url: 'https://shop.example/admin/#dashboard', postMessage: (m) => posted.push(m), focus: async () => (focused = true) };
  const site = { url: 'https://shop.example/app', postMessage: () => assert.fail('only admin tabs') };
  const sw = load({ windows: [site, tab] });
  const notification = { data: { url: '/admin/#chat/12' }, close: () => {} };
  await sw.fire('notificationclick', { notification });
  assert.equal(JSON.stringify(posted), JSON.stringify([{ type: 'open', hash: '#chat/12' }]));
  assert.ok(focused);
  const none = load();
  await none.fire('notificationclick', { notification });
  assert.equal(JSON.stringify(none.opened), JSON.stringify(['https://shop.example/admin/#chat/12']));
}

console.log('admin service worker tests passed');
