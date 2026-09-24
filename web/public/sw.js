/* Linkup service worker: push notifications + offline app shell */
const CACHE = 'linkup-__BUILD__'; // the build stamps its version here
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/badge-96.png'];

self.addEventListener('install', (e) => {
  // First install takes over straight away. An update waits until the person taps "Update",
  // so a screen that's already open never loses the files it's running on.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => { if (!self.registration.active) return self.skipWaiting(); }));
});

self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api') || url.pathname === '/version.json') return;

  if (req.mode === 'navigate') {
    // Network first for the page, fall back to cached shell when offline.
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put('/', copy));
        return res;
      }).catch(() => caches.match('/'))
    );
    return;
  }
  // Static assets: cache first, then network (hashed filenames make this safe).
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }))
  );
});

// ---------- Push: show the real content of the notification ----------
self.addEventListener('push', (event) => {
  let p = {};
  try { p = event.data ? event.data.json() : {}; } catch { p = { title: 'Linkup', body: event.data?.text() || '' }; }
  const actions = (p.actions || []).map((a) => ({ action: a.action, title: a.title }));
  const options = {
    body: p.body || '',
    icon: p.icon || '/icons/icon-192.png',
    ...(p.image ? { image: p.image } : {}),
    badge: '/icons/badge-96.png',
    tag: p.tag || p.id,
    renotify: true,
    requireInteraction: !!p.requireInteraction,
    timestamp: p.timestamp || Date.now(),
    vibrate: p.kind === 'invite_call' ? [600, 300, 600, 300, 600, 300, 600] : [120, 60, 120],
    silent: false,
    data: { url: p.url || '/', actions: p.actions || [], id: p.id, kind: p.kind },
    actions,
  };
  event.waitUntil(
    (async () => {
      let title = p.title || 'Linkup';
      // Several messages from one chat stack into one notification with the latest lines.
      if (p.kind === 'message' && options.tag) {
        const prev = (await self.registration.getNotifications({ tag: options.tag }))[0];
        if (prev) {
          const lines = [...(prev.data?.lines || [prev.body]), p.body].slice(-4);
          const count = (prev.data?.count || 1) + 1;
          options.body = lines.join('\n');
          options.data = { ...options.data, lines, count };
          title = `${title} · ${count} messages`;
        }
      }
      await self.registration.showNotification(title, options);
      // Keep the app badge in sync where supported.
      if (self.navigator.setAppBadge) {
        try {
          const list = await self.registration.getNotifications();
          await self.navigator.setAppBadge(list.length);
        } catch { /* ignore */ }
      }
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      clients.forEach((c) => c.postMessage({ type: 'push', payload: p }));
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  const hit = (d.actions || []).find((a) => a.action === event.action);
  const target = new URL(hit?.url || d.url || '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of clients) {
        if (new URL(c.url).origin === self.location.origin) {
          await c.focus();
          c.postMessage({ type: 'navigate', url: target.replace(self.location.origin, '') });
          return;
        }
      }
      await self.clients.openWindow(target);
    })()
  );
  if (self.navigator.clearAppBadge) self.navigator.clearAppBadge().catch(() => {});
});

// Browser rotated the push subscription: re-subscribe and tell the server.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      clients.forEach((c) => c.postMessage({ type: 'resubscribe' }));
    })()
  );
});
