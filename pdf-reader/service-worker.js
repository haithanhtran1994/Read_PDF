/* service-worker.js — cache app shell để mở lại nhanh + tạm offline trên Safari iOS.
   Lưu ý: thư viện pdf.js tải từ CDN (cdnjs) — lần đầu mở app CẦN có mạng để tải.
   Trình duyệt sẽ tự cache các file CDN đó theo cơ chế HTTP cache thông thường.

   CHIẾN LƯỢC: network-first cho MỌI request cùng gốc (HTML/CSS/JS/manifest) — luôn ưu
   tiên lấy bản MỚI NHẤT từ mạng và cập nhật lại cache, chỉ dùng bản cache khi mất mạng
   (offline) hoặc network lỗi. Trước đây JS/CSS dùng "stale-while-revalidate" (luôn trả
   ngay bản cache cũ, tải bản mới cho LẦN SAU) khiến mỗi lần đẩy code mới lên phải mở app
   2 lần mới thấy đúng — nay chỉ cần 1 lần.
*/
const CACHE_NAME = "pdf-dual-reader-v17";
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

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

  // Navigation requests (mở app bằng "./" hay "./index.html" đều rơi vào đây) luôn dùng
  // CHUNG một cache key "./index.html" để hai URL không bao giờ lệch bản với nhau.
  const cacheKey = event.request.mode === "navigate" ? "./index.html" : event.request;

  event.respondWith(
    fetch(event.request)
      .then((networkResp) => {
        if (networkResp && networkResp.status === 200) {
          const clone = networkResp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, clone));
        }
        return networkResp;
      })
      .catch(() => caches.match(cacheKey))
  );
});
