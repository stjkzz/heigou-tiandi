const CACHE_NAME = 'heigou-tiandi-v2';
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
    // 不缓存任何请求，直接走网络
    event.respondWith(fetch(event.request));
});
