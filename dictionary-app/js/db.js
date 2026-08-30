/* db.js — lưu cấu hình GitHub + cache dữ liệu từ điển đã tổng hợp trên máy (IndexedDB),
   để mở app lần sau không phải quét lại GitHub ngay (có nút "Đồng bộ lại" để làm mới).
   "hidden" giờ CHỈ còn là bản cache cục bộ (mở nhanh / dùng tạm khi mất mạng) — nguồn thật
   của danh sách "đã ẩn" là 1 file JSON dùng chung trên GitHub (xem hiddenPath trong cấu hình),
   để mở từ nhiều thiết bị đều thấy đồng bộ. */
const DB_NAME = "dict_lookup_db";
const DB_VERSION = 2;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("config")) db.createObjectStore("config");
      if (!db.objectStoreNames.contains("cache")) db.createObjectStore("cache");
      if (!db.objectStoreNames.contains("hidden")) db.createObjectStore("hidden");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(store, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(store, key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const Store = {
  getConfig: () => idbGet("config", "gh"),
  saveConfig: (cfg) => idbSet("config", "gh", cfg),

  getCache: () => idbGet("cache", "dict"),
  saveCache: (data) => idbSet("cache", "dict", data),

  // list: mảng { key, type, phrase, explain } của những mục đã bị xóa trên app này
  getHidden: () => idbGet("hidden", "list"),
  saveHidden: (list) => idbSet("hidden", "list", list),
};
