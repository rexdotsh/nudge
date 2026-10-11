declare const self: ServiceWorkerGlobalScope;

const CACHE_PREFIX = 'nudge-';
export const CACHE = `${CACHE_PREFIX}${NUDGE_BUILD}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(NUDGE_PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  const key = request.mode === 'navigate' ? '/' : request;
  event.respondWith(caches.match(key, { cacheName: CACHE }).then((hit) => hit ?? fetch(request)));
});
