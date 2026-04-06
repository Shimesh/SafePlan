// SafeRoute Israel — Service Worker
// Enables PWA installability and basic offline shell caching.

const CACHE = 'saferoute-v1';
const SHELL = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Never cache API / socket calls
  if (url.pathname.startsWith('/api/') || url.pathname === '/health') return;

  // Network-first for navigation, cache fallback for the shell
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
