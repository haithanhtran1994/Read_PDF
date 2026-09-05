/* service-worker.js — cache app shell để mở lại nhanh + tạm offline trên Safari iOS.
   Lưu ý: thư viện pdf.js tải từ CDN (cdnjs) — lần đầu mở app CẦN có mạng để tải.
   Trình duyệt sẽ tự cache các file CDN đó theo cơ chế HTTP cache thông thường.
*/
const CACHE_NAME = "pdf-dual-reader-v10";
const APP_SHELL = [
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/app.js",
  "./js/db.js",
  "./js/github.js",
  "./js/kanji.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Navigation requests (mở app bằng "./" hay "./index.html" đều rơi vào đây) luôn
// dùng CHUNG một cache key "./index.html" và ưu tiên mạng trước, để hai URL không
// bao giờ lệch bản với nhau và luôn lấy code mới nhất khi có mạng.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    const shellKey = "./index.html";
    event.respondWith(
      fetch(event.request)
        .then((networkResp) => {
          if (networkResp && networkResp.status === 200) {
            const clone = networkResp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(shellKey, clone));
          }
          return networkResp;
        })
        .catch(() => caches.match(shellKey))
    );
    return;
  }

  // Asset tĩnh (js/css/manifest...): stale-while-revalidate như cũ.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((networkResp) => {
          if (networkResp && networkResp.status === 200) {
            const clone = networkResp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResp;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
