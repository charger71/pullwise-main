// Service worker for the staff admin (scope /admin/; registered by admin/staff-push.js). It only shows chat
// notifications: a visitor wrote while the admin was closed or in the background (supabase/functions/push-notify
// sends them to the devices staff turned on from the Chat screen). Tapping one opens that chat. It handles no
// fetches, so the admin loads from the network exactly as it does without it.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// A push carries { title, body, url, tag, icon } (push-notify messages.js: staffChatMessage).
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { body: event.data?.text() ?? '' };
  }
  const icon = /^https:\/\//.test(data.icon ?? '') ? data.icon : undefined;
  const url = typeof data.url === 'string' && data.url.startsWith('/admin/') ? data.url : '/admin/#chat';
  event.waitUntil(self.registration.showNotification(data.title || 'New chat message', { body: data.body || '', tag: data.tag, renotify: !!data.tag, icon, data: { url } }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/admin/#chat', location.origin);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((open) => {
      // An admin tab already open: show the chat there (a hash change, so nothing unsaved is lost) and bring it forward.
      const admin = open.find((c) => new URL(c.url).pathname.startsWith('/admin/'));
      if (!admin) return self.clients.openWindow(target.href);
      admin.postMessage({ type: 'open', hash: target.hash });
      return admin.focus();
    }),
  );
});
