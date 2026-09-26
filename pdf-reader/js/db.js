/* db.js — lớp lưu trữ local bằng IndexedDB.
   Object store:
   - "config"     : key "github" -> { owner, repo, branch, dataPrefix, notesPath, token, pdfPrefix, highlightsPrefix }
   - "notes"      : key = note id -> { id, text, vocab, grammar, note, translation, source, page, createdAt, synced }
   - "pdfs"       : key "A" | "B" -> { name, blob, source }  (để nhớ lại PDF đã mở khi mở lại app;
                     source = { type: "device" } | { type: "github", path } )
   - "state"      : key "ui" -> { layout }  (nhớ layout ngang/dọc)
   - "highlights" : key = pdfId -> [ { id, page, mode, color, quads, createdAt } ]  (cache local,
                     nguồn "thật" là file JSON trên GitHub khi có cấu hình GitHub)
   - "jsonMarks"  : key = tên sách -> [ {id, chapter, page, field, start, end, type, color, createdAt} ]
                     (highlight/gạch chân trong Tóm tắt & Bản dịch ở cột JSON, cache local — nguồn
                     "thật" là data/<book>/mark.json trên GitHub khi có cấu hình GitHub)
   - "progress"   : key "all" -> { [pdfId]: {name, page, numPages, source, updatedAt} }  (tiến độ
                     đọc — trang đang đọc dở của TỪNG file PDF đã từng mở, cache local — nguồn
                     "thật" là 1 file JSON dùng chung trên GitHub khi có cấu hình GitHub, để mở
                     từ nhiều thiết bị vẫn thấy đúng trang đang đọc dở)
   - "dictIndex"  : key "all" -> { entries: [...], syncedAt }  (cache mục từ vựng/ngữ pháp gom từ
                     TOÀN BỘ data/<book>/<chapter>.json trên GitHub, dùng cho nút "Tra cứu" trong
                     popup nhận diện Kanji — xem js/kanji.js. Quét lại khi bấm "↻ Làm mới".)
*/
const DB_NAME = "pdf_dual_reader_db";
const DB_VERSION = 7;
const MAX_PDF_CACHE_ENTRIES = 6; // giữ tối đa 6 PDF gần nhất trong cache offline
const IDB_TIMEOUT_MS = 4000; // quá thời gian này coi như IndexedDB bị treo (bug WebKit iOS sau
                              // khi app đứng nền lâu) — thà báo "chưa đọc được" còn hơn treo mãi

// Chạy đua 1 promise với đồng hồ đếm ngược — quá hạn thì coi như lỗi (dù promise gốc
// vẫn có thể tự "sống lại" sau đó, ta không chờ nữa, để tránh treo cả app vô thời hạn).
function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label || "Thao tác"} quá lâu không phản hồi (nghi do IndexedDB bị treo sau khi app đứng nền lâu trên iOS — thử tải lại trang, hoặc tắt hẳn app trong App Switcher rồi mở lại)`));
    }, ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

function openDB() {
  return withTimeout(new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("config")) db.createObjectStore("config");
      if (!db.objectStoreNames.contains("notes")) db.createObjectStore("notes");
      if (!db.objectStoreNames.contains("pdfs")) db.createObjectStore("pdfs");
      if (!db.objectStoreNames.contains("state")) db.createObjectStore("state");
      // cache chương JSON đã tải (đọc lại nhanh + hoạt động tạm offline)
      if (!db.objectStoreNames.contains("chapters")) db.createObjectStore("chapters");
      // cache highlight/underline theo từng file PDF (đọc lại nhanh + hoạt động tạm offline)
      if (!db.objectStoreNames.contains("highlights")) db.createObjectStore("highlights");
      // cache highlight/underline trong Tóm tắt & Bản dịch, theo từng sách
      if (!db.objectStoreNames.contains("jsonMarks")) db.createObjectStore("jsonMarks");
      // cache tiến độ đọc (trang đang đọc dở) của từng file PDF
      if (!db.objectStoreNames.contains("progress")) db.createObjectStore("progress");
      // cache dữ liệu tra cứu (gom từ toàn bộ sách) cho popup nhận diện Kanji
      if (!db.objectStoreNames.contains("dictIndex")) db.createObjectStore("dictIndex");
      // cache blob PDF theo đường dẫn GitHub (mở lại PDF đã từng xem là thấy ngay, khỏi
      // chờ tải lại từ mạng) — khác với "pdfs" ở trên (chỉ nhớ ĐÚNG 1 file/pane để phục
      // hồi khi mở lại app). Giới hạn số lượng, xem MAX_PDF_CACHE_ENTRIES bên dưới.
      if (!db.objectStoreNames.contains("pdfCache")) db.createObjectStore("pdfCache");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }), IDB_TIMEOUT_MS, "Mở IndexedDB");
}

async function idbGet(store, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result === undefined ? null : req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(store, key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(store, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGetAll(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const objStore = tx.objectStore(store);
    const items = [];
    const req = objStore.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        items.push(cursor.value);
        cursor.continue();
      } else {
        resolve(items);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

const Store = {
  // .catch(() => null): nếu IndexedDB bị treo (xem withTimeout ở trên) thì coi như
  // "chưa đọc được cấu hình" thay vì làm hàm gọi nó bị treo/chết lặng theo — mọi nơi gọi
  // Store.getConfig() đều đã có sẵn xử lý cho trường hợp cfg rỗng (báo "Chưa cấu hình
  // GitHub"), nên chỉ cần sửa đúng 1 chỗ này là toàn bộ nút bấm được hưởng lợi.
  getConfig: () => idbGet("config", "github").catch(() => null),
  saveConfig: (cfg) => idbSet("config", "github", cfg),

  getUiState: () => idbGet("state", "ui"),
  saveUiState: (s) => idbSet("state", "ui", s),
  // Vị trí/kích thước popup Kanji lần gần nhất (px màn hình) — để lần sau mở lại
  // giữ nguyên, không phải kéo lại từ đầu. Lưu riêng khỏi "ui" để không đụng tới
  // logic persistJsonUiState() đang có.
  getKanjiPanelRect: () => idbGet("state", "kanjiPanelRect"),
  saveKanjiPanelRect: (r) => idbSet("state", "kanjiPanelRect", r),

  savePdf: (slot, name, blob, source) => idbSet("pdfs", slot, { name, blob, source: source || null }),
  getPdf: (slot) => idbGet("pdfs", slot),
  clearPdf: (slot) => idbDelete("pdfs", slot),

  saveNote: (note) => idbSet("notes", note.id, note),
  getAllNotes: () => idbGetAll("notes"),

  saveChapter: (book, chapter, data) => idbSet("chapters", `${book}/${chapter}`, data),
  getChapter: (book, chapter) => idbGet("chapters", `${book}/${chapter}`),

  saveHighlights: (pdfId, records) => idbSet("highlights", pdfId, records || []),
  getHighlights: (pdfId) => idbGet("highlights", pdfId),

  saveMarkList: (book, records) => idbSet("jsonMarks", book, records || []),
  getMarkList: (book) => idbGet("jsonMarks", book),

  saveReadingProgress: (map) => idbSet("progress", "all", map || {}),
  getReadingProgress: () => idbGet("progress", "all"),

  saveDictIndex: (data) => idbSet("dictIndex", "all", data || null),
  getDictIndex: () => idbGet("dictIndex", "all"),

  // Cache blob PDF theo đường dẫn GitHub — mở lại 1 PDF đã từng xem là hiện NGAY LẬP TỨC
  // (đọc từ máy), không phải chờ tải lại từ GitHub mỗi lần. Giới hạn MAX_PDF_CACHE_ENTRIES
  // file, cũ nhất bị dọn khi vượt quá (tránh phình IndexedDB vì PDF thường nặng vài MB).
  getPdfBlob: (path) => idbGet("pdfCache", path),
  async savePdfBlob(path, name, blob) {
    await idbSet("pdfCache", path, { path, name, blob, cachedAt: Date.now() });
    try {
      const all = await idbGetAll("pdfCache");
      if (all.length > MAX_PDF_CACHE_ENTRIES) {
        all.sort((a, b) => (a.cachedAt || 0) - (b.cachedAt || 0));
        const stale = all.slice(0, all.length - MAX_PDF_CACHE_ENTRIES);
        for (const it of stale) await idbDelete("pdfCache", it.path);
      }
    } catch (e) { /* dọn cache lỗi thì thôi, không quan trọng bằng việc lưu được file mới */ }
  },
};
