/* db.js — lớp lưu trữ local bằng IndexedDB.
   Object store:
   - "config"     : key "github" -> { owner, repo, branch, dataPrefix, notesPath, token, pdfPrefix, highlightsPrefix }
   - "notes"      : key = note id -> { id, text, vocab, grammar, note, translation, source, page, createdAt, synced }
   - "pdfs"       : key "A" | "B" -> { name, blob, source }  (để nhớ lại PDF đã mở khi mở lại app;
                     source = { type: "device" } | { type: "github", path } )
   - "state"      : key "ui" -> { layout }  (nhớ layout ngang/dọc)
   - "highlights" : key = pdfId -> [ { id, page, mode, color, quads, createdAt } ]  (cache local,
                     nguồn "thật" là file JSON trên GitHub khi có cấu hình GitHub)
*/
const DB_NAME = "pdf_dual_reader_db";
const DB_VERSION = 3;

function openDB() {
  return new Promise((resolve, reject) => {
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
  getConfig: () => idbGet("config", "github"),
  saveConfig: (cfg) => idbSet("config", "github", cfg),

  getUiState: () => idbGet("state", "ui"),
  saveUiState: (s) => idbSet("state", "ui", s),

  savePdf: (slot, name, blob, source) => idbSet("pdfs", slot, { name, blob, source: source || null }),
  getPdf: (slot) => idbGet("pdfs", slot),
  clearPdf: (slot) => idbDelete("pdfs", slot),

  saveNote: (note) => idbSet("notes", note.id, note),
  getAllNotes: () => idbGetAll("notes"),

  saveChapter: (book, chapter, data) => idbSet("chapters", `${book}/${chapter}`, data),
  getChapter: (book, chapter) => idbGet("chapters", `${book}/${chapter}`),

  saveHighlights: (pdfId, records) => idbSet("highlights", pdfId, records || []),
  getHighlights: (pdfId) => idbGet("highlights", pdfId),
};
