const CACHE_NAME = "dict-lookup-v1";
const SHELL_FILES = [
  "./index.html", "./css/style.css", "./js/db.js", "./js/github.js", "./js/app.js",
  "./manifest.json", "./icons/icon-192.png", "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Chỉ cache "app shell" tĩnh. Mọi request tới api.github.com (dữ liệu) luôn đi mạng trực tiếp,
// không cache — để "Đồng bộ" luôn lấy dữ liệu mới nhất.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
  }
});
