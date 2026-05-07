const CACHE_NAME = 'heigou-tiandi-v1';
const urlsToCache = [
  '/heigou-tiandi/',
  '/heigou-tiandi/index.html',
  '/heigou-tiandi/bg-deer-compressed.jpg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        if (response) {
          return response;
        }
        return fetch(event.request);
      })
  );
});
