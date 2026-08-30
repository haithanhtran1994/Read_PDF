const CACHE_NAME = "dict-lookup-v2";
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
  if (url.origin !== location.origin) return;

  // Navigation ("./" hay "./index.html" đều rơi vào đây): dùng CHUNG 1 cache key
  // và ưu tiên mạng trước, để 2 URL không bao giờ lệch bản với nhau.
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

  // Asset tĩnh: stale-while-revalidate (trả cache ngay cho nhanh, âm thầm cập nhật cho lần sau).
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
