/*
 * EventEase service worker (blueprint §4.9 "works offline", §9.6 PWA + push).
 *
 * - App shell: pages are network-first, falling back to the cached app so it
 *   opens without a connection.
 * - Offline pass: the student's own registration API responses are cached as
 *   they're fetched (network-first), so a pass viewed once stays viewable
 *   offline. Nothing else from the API is cached.
 * - Push: shows notifications queued by the server, and opens their link.
 * On sign-out the page posts 'clear-private' and the cached passes are deleted.
 */

const SHELL = 'eventease-shell-v1';
const PRIVATE = 'eventease-private-v1';

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(['/', '/index.html', '/favicon.svg'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== PRIVATE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const networkFirst = async (request, cacheName, fallbackUrl) => {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) ?? (fallbackUrl ? cache.match(fallbackUrl) : Response.error());
  }
};

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL, '/index.html'));
    return;
  }
  // The student's passes: /api/me/registrations and /api/me/registrations/:id
  if (/^\/api\/me\/registrations(\/[^/]+)?$/.test(url.pathname) || url.pathname === '/api/auth/me') {
    event.respondWith(networkFirst(request, PRIVATE));
    return;
  }
  // Built assets (hashed file names) and images: cache as they're used.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/images/')) {
    event.respondWith(
      caches.open(SHELL).then(async cache => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      })
    );
  }
});

self.addEventListener('message', event => {
  if (event.data === 'clear-private') event.waitUntil(caches.delete(PRIVATE));
});

self.addEventListener('push', event => {
  let data = { title: 'EventEase', body: '', url: '/' };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    if (event.data) data.body = event.data.text();
  }
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: '/favicon.svg', badge: '/favicon.svg', data: { url: data.url } }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
      const open = windows.find(w => new URL(w.url).origin === self.location.origin);
      if (open) {
        open.navigate(url);
        return open.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
