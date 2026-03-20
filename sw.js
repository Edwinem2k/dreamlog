// sw.js
const CACHE_NAME = 'dreamlog-v1';

// App shell files to cache on install
const APP_SHELL = [
  '/dreamlog/',
  '/dreamlog/index.html',
  '/dreamlog/manifest.json',
  '/dreamlog/css/app.css',
  '/dreamlog/js/app.js',
  '/dreamlog/js/record.js',
  '/dreamlog/js/review.js',
  '/dreamlog/js/journal.js',
  '/dreamlog/js/patterns.js',
  '/dreamlog/js/settings.js',
  '/dreamlog/js/api.js',
  '/dreamlog/js/db.js',
  '/dreamlog/icons/icon-192.png',
  '/dreamlog/icons/icon-512.png',
  '/dreamlog/icons/apple-touch-icon.png',
];

// Install: cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// Activate: remove old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Fetch: cache-first for app shell, network-only for API calls
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache Worker API calls or external CDN requests
  if (url.hostname !== self.location.hostname) return;

  event.respondWith(
    caches.match(event.request)
      .then(cached => cached || fetch(event.request))
  );
});
