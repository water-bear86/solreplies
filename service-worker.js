const CACHE_NAME = 'solreplies-v0.5.0';
const APP_SHELL = [
  '/',
  '/index.html',
  '/privacy.html',
  '/manifest.webmanifest',
  '/service-worker.js',
  '/solreplies.png',
  '/srgmark.png',
  '/srgwordmark.png',
  '/preview.png',
  '/pwa-icon-192.png',
  '/pwa-icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/index.html')));
    return;
  }

  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});
