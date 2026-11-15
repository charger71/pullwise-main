// Service worker for the pull list app (app.html at /app; registered by js/pages/app.js with scope /app).
// The app's page and files come from the network as usual, and each answer is kept, so the app still opens (with
// the shop's brand and the last copy of its files) without a connection. The pull list itself is live data from
// Supabase and isn't kept here. Nothing outside the app is touched: the website and admin don't use this worker.

const CACHE = 'pullwise-app-v1';
// Same-site files the app loads. Anything else (Supabase, images, analytics) goes straight to the network.
const KEEP = /^\/(app(\.html)?|manifest\.webmanifest|css\/.+|js\/.+|fonts\/.+)$/;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('pullwise-app-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin || !KEEP.test(url.pathname)) return;
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          event.waitUntil(caches.open(CACHE).then((c) => c.put(request, copy)));
        }
        return res;
      })
      // Offline: the kept copy (an /app address with a #tab or ?query is the same page).
      .catch(() => caches.match(request, { ignoreSearch: request.mode === 'navigate' }).then((hit) => hit ?? Response.error())),
  );
});

// Notifications from the shop (a push carries { title, body, url, tag, icon, badge? }: supabase/functions/push-notify);
// tapping one opens the app at its url.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { body: event.data?.text() ?? '' };
  }
  const icon = /^https:\/\//.test(data.icon ?? '') ? data.icon : undefined; // the shop's icon (push-notify messages.js)
  const shown = self.registration.showNotification(data.title || 'Your pull list', { body: data.body || '', tag: data.tag, icon, data: { url: data.url || '/app' } });
  // `badge`: how many books are ready, for the number on the app's icon (the app sets it too, each time it opens).
  const badge = Number.isInteger(data.badge) && 'setAppBadge' in navigator
    ? (data.badge > 0 ? navigator.setAppBadge(data.badge) : navigator.clearAppBadge()).catch(() => {})
    : null;
  event.waitUntil(Promise.all([shown, badge]));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/app', location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((open) => {
      const app = open.find((c) => new URL(c.url).pathname.startsWith('/app'));
      if (!app) return self.clients.openWindow(target);
      // navigate() refuses a window this worker doesn't control (opened before it took over): open a new one then.
      return app.navigate(target).then((c) => (c ?? app).focus()).catch(() => self.clients.openWindow(target));
    }),
  );
});
