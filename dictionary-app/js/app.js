/* app.js — Từ điển tra cứu tổng hợp: quét toàn bộ data/<book>/<chapter>.json trên GitHub
   (đúng cấu trúc app đọc sách đang dùng), gom hết grammar + analysis (vocab/idiom/slang/
   collocation/phrase) của TẤT CẢ sách/chương vào 1 danh sách, cho tra cứu bằng tiếng Anh/
   Nhật (cụm từ gốc) hoặc tiếng Việt (phần giải thích), không phân biệt hoa/thường, không
   phân biệt dấu tiếng Việt khi tra bằng tiếng Việt.

   - Sửa (✎): ghi ngược thay đổi lên ĐÚNG file JSON nguồn (data/<book>/<chapter>.json) của
     mọi trang đã đóng góp vào mục đang sửa (1 mục có thể gộp từ nhiều trang/chương/sách
     nếu nội dung giống hệt nhau).
   - Xóa (🗑): CHỈ ẩn trên riêng app này, KHÔNG đụng gì tới dữ liệu gốc (grammar/analysis) của
     app đọc sách. Danh sách "đã ẩn" được lưu thành 1 file JSON DÙNG CHUNG trên GitHub (không
     phải riêng từng máy), nên mở app từ điện thoại hay PC đều thấy đồng bộ. Lần "Đồng bộ" sau
     tự lọc bỏ các mục đã ẩn.
   - Loa (🔊): đọc to đúng phần cụm từ/từ khóa (không đọc phần giải thích) bằng Web Speech API,
     tự nhận diện tiếng Nhật (có Hiragana/Katakana/Kanji) hay tiếng Anh để chọn giọng đọc.
*/

const $ = (sel) => document.querySelector(sel);
const DEFAULT_HIDDEN_PATH = "hidden.json";

const state = {
  entries: [],        // toàn bộ mục đã gom, mỗi mục: {key, type, phrase, explain, sources:[{book,chapter,page}]}
  books: [],           // danh sách tên sách duy nhất, để lọc
  activeTypes: new Set(["grammar", "vocab", "idiom", "slang", "collocation", "phrase"]),
  activeBook: "",       // "" = tất cả sách
  syncedAt: null,
  hiddenList: [],       // [{key, type, phrase, explain}] — mục đã bị xóa, lưu chung trên GitHub
  hiddenSha: null,       // sha hiện tại của file hidden.json trên GitHub (để ghi đè an toàn)
};

const TYPE_LABEL = {
  grammar: "Ngữ pháp",
  vocab: "Từ vựng",
  idiom: "Thành ngữ",
  slang: "Slang",
  collocation: "Collocation",
  phrase: "Cụm từ",
};

const els = {
  btnSync: $("#btnSync"),
  btnGhConfig: $("#btnGhConfig"),
  btnHidden: $("#btnHidden"),
  hiddenCount: $("#hiddenCount"),
  searchInput: $("#searchInput"),
  results: $("#results"),
  resultStats: $("#resultStats"),
  typeChips: $("#typeChips"),
  bookFilter: $("#bookFilter"),
  syncStatus: $("#syncStatus"),
  syncLog: $("#syncLog"),
  syncOverlay: $("#syncOverlay"),
  syncPanel: $("#syncPanel"),
  githubOverlay: $("#githubOverlay"),
  githubPanel: $("#githubPanel"),
  hiddenOverlay: $("#hiddenOverlay"),
  hiddenPanel: $("#hiddenPanel"),
  hiddenListEl: $("#hiddenList"),
};

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Chuẩn hoá chuỗi để so khớp khi tìm kiếm: chữ thường + bỏ dấu tiếng Việt.
// Áp dụng chung cho cả cụm từ gốc (Anh/Nhật, không bị ảnh hưởng) lẫn phần giải thích tiếng Việt.
function normalize(s) {
  return String(s == null ? "" : s)
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
}

function makeEntryKey(type, phrase, explain) {
  return `${type}\u0000${normalize(phrase)}\u0000${normalize(explain)}`;
}

// ---------------- Đồng bộ dữ liệu từ GitHub ----------------

function logSync(msg, cls) {
  const d = document.createElement("div");
  d.className = "sync-log-line " + (cls || "");
  d.textContent = msg;
  els.syncLog.appendChild(d);
  els.syncLog.scrollTop = els.syncLog.scrollHeight;
}

async function syncFromGithub() {
  const cfg = await Store.getConfig();
  if (!cfg || !cfg.owner || !cfg.repo || !cfg.token) {
    openGithubConfig();
    return;
  }

  els.syncLog.innerHTML = "";
  els.syncOverlay.classList.remove("hidden");
  els.syncPanel.classList.remove("hidden");
  els.btnSync.disabled = true;

  const booksPath = cfg.booksPath || "data";
  const merged = new Map(); // key -> {type, phrase, explain, sources:[]}

  try {
    logSync(`Đang tải danh sách mục đã ẩn (dùng chung trên GitHub)...`);
    try {
      const { list, sha } = await loadHiddenFromGithub(cfg);
      state.hiddenList = list;
      state.hiddenSha = sha;
      await Store.saveHidden(list);
    } catch (e) {
      logSync(`Không tải được danh sách đã ẩn (${e.message}) — tạm dùng bản đã lưu trên máy.`, "err");
    }
    updateHiddenCount();

    logSync(`Đang lấy danh sách sách trong "${booksPath}/"...`);
    const bookItems = (await GH.listDir(cfg, booksPath)).filter((it) => it.type === "dir");
    if (!bookItems.length) {
      logSync("Không tìm thấy sách nào.", "err");
    }

    for (const bookItem of bookItems) {
      const book = bookItem.name;
      logSync(`— Sách "${book}": đang lấy danh sách chương...`);
      const chapterItems = (await GH.listDir(cfg, `${booksPath}/${book}`))
        .filter((it) => it.type === "file" && /\.json$/i.test(it.name));

      for (const chFile of chapterItems) {
        const chapter = chFile.name.replace(/\.json$/i, "");
        try {
          const res = await GH.getJSONObject(cfg, `${booksPath}/${book}/${chFile.name}`);
          const data = res ? res.data : null;
          const pages = (data && Array.isArray(data.pages)) ? data.pages : [];
          let count = 0;
          for (const page of pages) {
            const pageNum = page.page;
            const grammarItems = Array.isArray(page.grammar) ? page.grammar : [];
            const analysisItems = Array.isArray(page.analysis) ? page.analysis : [];
            grammarItems.forEach((it) => {
              if (!it || !it.phrase) return;
              addEntry(merged, "grammar", it.phrase, it.explain || "", book, chapter, pageNum);
              count++;
            });
            analysisItems.forEach((it) => {
              if (!it || !it.phrase) return;
              const type = TYPE_LABEL[it.type] ? it.type : "phrase";
              addEntry(merged, type, it.phrase, it.explain || "", book, chapter, pageNum);
              count++;
            });
          }
          logSync(`   ${chapter}: ${pages.length} trang, ${count} mục`, "ok");
        } catch (e) {
          logSync(`   ${chapter}: lỗi đọc — ${e.message}`, "err");
        }
      }
    }

    let entries = Array.from(merged.values());
    entries.forEach((e) => { e.key = makeEntryKey(e.type, e.phrase, e.explain); });

    const hiddenKeySet = new Set(state.hiddenList.map((h) => h.key));
    const beforeCount = entries.length;
    entries = entries.filter((e) => !hiddenKeySet.has(e.key));
    const hiddenSkipped = beforeCount - entries.length;

    const books = Array.from(new Set(bookItems.map((b) => b.name))).sort();
    state.entries = entries;
    state.books = books;
    state.syncedAt = new Date().toISOString();

    await Store.saveCache({ entries, books, syncedAt: state.syncedAt });

    logSync(`Xong. Tổng cộng ${entries.length} mục từ ${books.length} sách` +
      (hiddenSkipped ? ` (đã bỏ qua ${hiddenSkipped} mục đã ẩn trước đó).` : "."), "ok");
    renderBookFilter();
    updateSyncStatus();
    runSearch();
  } catch (e) {
    logSync(`Lỗi đồng bộ: ${e.message}`, "err");
  } finally {
    els.btnSync.disabled = false;
  }
}

function addEntry(merged, type, phrase, explain, book, chapter, page) {
  const key = makeEntryKey(type, phrase, explain);
  let entry = merged.get(key);
  if (!entry) {
    entry = { type, phrase: phrase.trim(), explain: (explain || "").trim(), sources: [] };
    merged.set(key, entry);
  }
  const src = { book, chapter, page };
  const dup = entry.sources.some((s) => s.book === book && s.chapter === chapter && s.page === page);
  if (!dup) entry.sources.push(src);
}

function updateSyncStatus() {
  if (!state.syncedAt) {
    els.syncStatus.textContent = "Chưa đồng bộ dữ liệu.";
    return;
  }
  const d = new Date(state.syncedAt);
  els.syncStatus.textContent = `Đã đồng bộ lúc ${d.toLocaleString("vi-VN")} — ${state.entries.length} mục, ${state.books.length} sách.`;
}

function renderBookFilter() {
  els.bookFilter.innerHTML = `<option value="">Tất cả sách</option>` +
    state.books.map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join("");
  els.bookFilter.value = state.activeBook;
}

// ---------------- Đọc to (Web Speech API) ----------------

function detectSpeechLang(text) {
  // Có Hiragana/Katakana/Kanji -> tiếng Nhật, còn lại mặc định tiếng Anh.
  if (/[\u3040-\u30ff\u4e00-\u9fff]/.test(text)) return "ja-JP";
  return "en-US";
}

function speakText(text) {
  if (!text) return;
  if (!("speechSynthesis" in window)) {
    alert("Trình duyệt này không hỗ trợ đọc to (Web Speech API).");
    return;
  }
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = detectSpeechLang(text);
  utter.rate = 0.95;
  window.speechSynthesis.speak(utter);
}

// ---------------- Xóa (chỉ ẩn trên app này, lưu chung 1 file trên GitHub) ----------------

async function loadHiddenFromGithub(cfg) {
  const path = cfg.hiddenPath || DEFAULT_HIDDEN_PATH;
  const res = await GH.getJSONObject(cfg, path);
  if (!res) return { list: [], sha: null };
  const list = Array.isArray(res.data) ? res.data : [];
  return { list, sha: res.sha };
}

function mergeHiddenLists(a, b) {
  const map = new Map();
  [...a, ...b].forEach((h) => map.set(h.key, h));
  return Array.from(map.values());
}

// Ghi danh sách "đã ẩn" lên GitHub. Nếu bị lệch sha (thiết bị khác vừa ghi trước đó),
// tự tải bản mới nhất, gộp (union theo key) rồi thử ghi lại 1 lần.
async function saveHiddenListToGithub(cfg, newList, attempt) {
  attempt = attempt || 0;
  const path = cfg.hiddenPath || DEFAULT_HIDDEN_PATH;
  try {
    await GH.putTextFile(cfg, path, JSON.stringify(newList, null, 2), state.hiddenSha,
      "Cập nhật danh sách đã ẩn (dictionary-app)");
    state.hiddenList = newList;
    const fresh = await GH.getJSONObject(cfg, path).catch(() => null);
    state.hiddenSha = fresh ? fresh.sha : null;
    await Store.saveHidden(newList); // cache cục bộ, để mở lại nhanh / dùng tạm khi mất mạng
    return true;
  } catch (e) {
    if (attempt < 1) {
      const fresh = await loadHiddenFromGithub(cfg).catch(() => null);
      if (fresh) {
        const merged = mergeHiddenLists(fresh.list, newList);
        state.hiddenSha = fresh.sha;
        return saveHiddenListToGithub(cfg, merged, attempt + 1);
      }
    }
    throw e;
  }
}

async function deleteEntryLocally(entry) {
  const key = entry.key || makeEntryKey(entry.type, entry.phrase, entry.explain);
  const newList = state.hiddenList.some((h) => h.key === key)
    ? state.hiddenList
    : [...state.hiddenList, { key, type: entry.type, phrase: entry.phrase, explain: entry.explain }];

  state.entries = state.entries.filter((e) => e !== entry);
  await Store.saveCache({ entries: state.entries, books: state.books, syncedAt: state.syncedAt });
  updateSyncStatus();
  runSearch();

  const cfg = await Store.getConfig();
  if (!cfg || !cfg.owner || !cfg.repo || !cfg.token) {
    alert("Chưa cấu hình GitHub nên không lưu được danh sách ẩn dùng chung — cấu hình xong rồi xóa lại.");
    return;
  }
  try {
    await saveHiddenListToGithub(cfg, newList);
    updateHiddenCount();
  } catch (e) {
    alert(`Lỗi lưu danh sách ẩn lên GitHub: ${e.message}\nMục vẫn bị ẩn tạm trên máy này, thử "Đồng bộ" lại sau.`);
    state.hiddenList = newList;
    await Store.saveHidden(newList);
    updateHiddenCount();
  }
}

function updateHiddenCount() {
  els.hiddenCount.textContent = String(state.hiddenList.length);
}

function bindHiddenPanel() {
  els.btnHidden.addEventListener("click", openHiddenPanel);
  $("#btnCloseHidden").addEventListener("click", closeHiddenPanel);
  els.hiddenOverlay.addEventListener("click", closeHiddenPanel);
}

function openHiddenPanel() {
  renderHiddenList();
  els.hiddenOverlay.classList.remove("hidden");
  els.hiddenPanel.classList.remove("hidden");
}
function closeHiddenPanel() {
  els.hiddenOverlay.classList.add("hidden");
  els.hiddenPanel.classList.add("hidden");
}

function renderHiddenList() {
  els.hiddenListEl.innerHTML = "";
  if (!state.hiddenList.length) {
    els.hiddenListEl.innerHTML = `<div class="dict-empty">Chưa ẩn mục nào.</div>`;
    return;
  }
  state.hiddenList.forEach((h) => {
    const row = document.createElement("div");
    row.className = "hidden-row";
    row.innerHTML = `
      <div class="hidden-row-text">
        <span class="dict-type" data-type="${escapeHtml(h.type)}">${escapeHtml(TYPE_LABEL[h.type] || h.type)}</span>
        <span class="dict-phrase">${escapeHtml(h.phrase)}</span>
      </div>
      <button class="btn-cancel hidden-restore-btn">Khôi phục</button>
    `;
    const btn = row.querySelector(".hidden-restore-btn");
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      const newList = state.hiddenList.filter((x) => x.key !== h.key);
      const cfg = await Store.getConfig();
      try {
        if (cfg && cfg.owner && cfg.repo && cfg.token) {
          await saveHiddenListToGithub(cfg, newList);
        } else {
          state.hiddenList = newList;
          await Store.saveHidden(newList);
        }
        updateHiddenCount();
        renderHiddenList();
      } catch (e) {
        alert(`Lỗi lưu lên GitHub: ${e.message}`);
        btn.disabled = false;
      }
    });
    els.hiddenListEl.appendChild(row);
  });
}

// ---------------- Sửa (ghi ngược lên đúng file JSON nguồn) ----------------

async function saveEntryEdit(entry, newPhrase, newExplain, statusEl) {
  const cfg = await Store.getConfig();
  if (!cfg || !cfg.owner || !cfg.repo || !cfg.token) {
    statusEl.textContent = "Chưa cấu hình GitHub.";
    return false;
  }
  newPhrase = (newPhrase || "").trim();
  newExplain = (newExplain || "").trim();
  if (!newPhrase) {
    statusEl.textContent = "Cụm từ / từ khóa không được để trống.";
    return false;
  }

  const booksPath = cfg.booksPath || "data";
  const byChapter = new Map(); // "book/chapter" -> { book, chapter, pages:Set }
  entry.sources.forEach((s) => {
    const k = `${s.book}/${s.chapter}`;
    if (!byChapter.has(k)) byChapter.set(k, { book: s.book, chapter: s.chapter, pages: new Set() });
    byChapter.get(k).pages.add(s.page);
  });

  const oldPhraseNorm = normalize(entry.phrase);
  const oldExplainNorm = normalize(entry.explain);
  let totalChanged = 0;

  for (const { book, chapter, pages } of byChapter.values()) {
    const relPath = `${booksPath}/${book}/${chapter}.json`;
    statusEl.textContent = `Đang cập nhật ${book}/${chapter}...`;
    let res;
    try {
      res = await GH.getJSONObject(cfg, relPath);
    } catch (e) {
      statusEl.textContent = `Lỗi đọc ${relPath}: ${e.message}`;
      return false;
    }
    if (!res || !res.data) {
      statusEl.textContent = `Không tìm thấy ${relPath} trên GitHub — dừng lại, chưa ghi gì thêm.`;
      return false;
    }
    const data = res.data;
    let changed = 0;
    (data.pages || []).forEach((page) => {
      if (!pages.has(page.page)) return;
      const arr = entry.type === "grammar" ? page.grammar : page.analysis;
      if (!Array.isArray(arr)) return;
      arr.forEach((it) => {
        if (!it || !it.phrase) return;
        const itType = entry.type === "grammar" ? "grammar" : (it.type || "phrase");
        if (itType !== entry.type) return;
        if (normalize(it.phrase) === oldPhraseNorm && normalize(it.explain || "") === oldExplainNorm) {
          it.phrase = newPhrase;
          it.explain = newExplain;
          changed++;
        }
      });
    });
    if (!changed) {
      logSync(`Sửa: không thấy mục khớp trong ${relPath} (có thể đã đổi từ nơi khác) — bỏ qua file này.`, "err");
      continue;
    }
    try {
      await GH.putTextFile(cfg, relPath, JSON.stringify(data, null, 2), res.sha,
        `Sửa "${TYPE_LABEL[entry.type] || entry.type}" '${newPhrase}' (từ dictionary-app)`);
      totalChanged += changed;
    } catch (e) {
      statusEl.textContent = `Ghi ${relPath} lỗi: ${e.message}`;
      return false;
    }
  }

  if (!totalChanged) {
    statusEl.textContent = "Không cập nhật được file nào (dữ liệu nguồn có thể đã thay đổi) — bấm Đồng bộ rồi thử lại.";
    return false;
  }

  entry.phrase = newPhrase;
  entry.explain = newExplain;
  entry.key = makeEntryKey(entry.type, newPhrase, newExplain);
  await Store.saveCache({ entries: state.entries, books: state.books, syncedAt: state.syncedAt });
  return true;
}

// ---------------- Tìm kiếm + hiển thị kết quả ----------------

function runSearch() {
  const rawQuery = els.searchInput.value.trim();
  const query = normalize(rawQuery);
  els.results.innerHTML = "";

  if (!state.entries.length) {
    els.resultStats.textContent = "Chưa có dữ liệu — bấm \"Đồng bộ\" để tải từ GitHub.";
    return;
  }
  if (!query) {
    els.resultStats.textContent = `${state.entries.length} mục sẵn sàng tra cứu. Nhập từ khóa (Anh/Nhật hoặc tiếng Việt) để tìm.`;
    return;
  }

  const filtered = state.entries.filter((e) => state.activeTypes.has(e.type));
  const scored = [];
  for (const e of filtered) {
    if (state.activeBook && !e.sources.some((s) => s.book === state.activeBook)) continue;
    const phraseNorm = normalize(e.phrase);
    const explainNorm = normalize(e.explain);
    let score = 0;
    if (phraseNorm === query) score = 4;
    else if (phraseNorm.startsWith(query)) score = 3;
    else if (phraseNorm.includes(query)) score = 2;
    else if (explainNorm.includes(query)) score = 1;
    if (score > 0) scored.push({ e, score });
  }

  scored.sort((a, b) => b.score - a.score || a.e.phrase.localeCompare(b.e.phrase));

  const MAX_SHOW = 300;
  els.resultStats.textContent = `${scored.length} kết quả cho "${rawQuery}"` +
    (scored.length > MAX_SHOW ? ` (hiện ${MAX_SHOW} kết quả đầu)` : "");

  if (!scored.length) {
    els.results.innerHTML = `<div class="dict-empty">Không tìm thấy mục nào khớp "${escapeHtml(rawQuery)}".</div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  scored.slice(0, MAX_SHOW).forEach(({ e }) => frag.appendChild(createResultItemEl(e)));
  els.results.appendChild(frag);
}

function sourcesToText(sources) {
  return sources.slice(0, 6)
    .map((s) => `${s.book}/${s.chapter}${s.page != null ? ` tr.${s.page}` : ""}`)
    .join(", ") + (sources.length > 6 ? `, +${sources.length - 6} nữa` : "");
}

function createResultItemEl(entry) {
  const wrap = document.createElement("div");
  wrap.className = "dict-item";

  function renderView() {
    wrap.innerHTML = `
      <div class="dict-head">
        <span class="dict-type" data-type="${escapeHtml(entry.type)}">${escapeHtml(TYPE_LABEL[entry.type] || entry.type)}</span>
        <span class="dict-phrase">${escapeHtml(entry.phrase)}</span>
        <span class="dict-actions">
          <button class="dict-btn-icon dict-speak" title="Đọc to">🔊</button>
          <button class="dict-btn-icon dict-edit" title="Sửa">✎</button>
          <button class="dict-btn-icon dict-delete" title="Xóa khỏi từ điển này (không xóa dữ liệu gốc)">🗑</button>
        </span>
      </div>
      ${entry.explain ? `<div class="dict-explain">${escapeHtml(entry.explain)}</div>` : ""}
      <div class="dict-source">${escapeHtml(sourcesToText(entry.sources))}</div>
    `;
    wrap.querySelector(".dict-speak").addEventListener("click", () => speakText(entry.phrase));
    wrap.querySelector(".dict-edit").addEventListener("click", renderEdit);
    wrap.querySelector(".dict-delete").addEventListener("click", () => {
      const ok = confirm(
        `Xóa "${entry.phrase}" khỏi từ điển này?\n\n` +
        `Chỉ ẩn trên riêng app tra cứu này — KHÔNG xóa dữ liệu gốc trên GitHub / app đọc sách. ` +
        `Có thể khôi phục sau trong mục "Đã ẩn".`
      );
      if (ok) deleteEntryLocally(entry);
    });
  }

  function renderEdit() {
    wrap.innerHTML = `
      <div class="dict-item-edit">
        <label>Cụm từ / từ khóa</label>
        <input type="text" class="dict-edit-phrase" value="${escapeHtml(entry.phrase)}">
        <label>Giải thích</label>
        <textarea class="dict-edit-explain" rows="3">${escapeHtml(entry.explain)}</textarea>
        <div class="gh-hint">Sẽ ghi đè lên đúng file JSON nguồn trên GitHub: ${escapeHtml(sourcesToText(entry.sources))}</div>
        <div class="dict-edit-actions">
          <button class="btn-save dict-edit-save">Lưu lên GitHub</button>
          <button class="btn-cancel dict-edit-cancel">Hủy</button>
        </div>
        <div class="dict-edit-status gh-hint"></div>
      </div>
    `;
    const statusEl = wrap.querySelector(".dict-edit-status");
    const saveBtn = wrap.querySelector(".dict-edit-save");
    wrap.querySelector(".dict-edit-cancel").addEventListener("click", renderView);
    saveBtn.addEventListener("click", async () => {
      const newPhrase = wrap.querySelector(".dict-edit-phrase").value;
      const newExplain = wrap.querySelector(".dict-edit-explain").value;
      saveBtn.disabled = true;
      statusEl.textContent = "Đang lưu...";
      const ok = await saveEntryEdit(entry, newPhrase, newExplain, statusEl);
      saveBtn.disabled = false;
      if (ok) renderView();
    });
  }

  renderView();
  return wrap;
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ---------------- Bộ lọc loại ----------------

function bindTypeChips() {
  els.typeChips.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const type = chip.dataset.type;
      if (state.activeTypes.has(type)) {
        state.activeTypes.delete(type);
        chip.classList.remove("active");
      } else {
        state.activeTypes.add(type);
        chip.classList.add("active");
      }
      runSearch();
    });
  });
}

// ---------------- Cấu hình GitHub ----------------

function openGithubConfig() {
  (async () => {
    const cfg = (await Store.getConfig()) || {};
    $("#cfgOwner").value = cfg.owner || "";
    $("#cfgRepo").value = cfg.repo || "";
    $("#cfgBooksPath").value = cfg.booksPath || "data";
    $("#cfgHiddenPath").value = cfg.hiddenPath || DEFAULT_HIDDEN_PATH;
    $("#cfgBranch").value = cfg.branch || "main";
    $("#cfgToken").value = cfg.token || "";
    els.githubOverlay.classList.remove("hidden");
    els.githubPanel.classList.remove("hidden");
  })();
}
function closeGithubConfig() {
  els.githubOverlay.classList.add("hidden");
  els.githubPanel.classList.add("hidden");
}

function bindGithubConfig() {
  els.btnGhConfig.addEventListener("click", openGithubConfig);
  $("#btnCloseGhConfig").addEventListener("click", closeGithubConfig);
  $("#btnCancelGhConfig").addEventListener("click", closeGithubConfig);
  els.githubOverlay.addEventListener("click", closeGithubConfig);
  $("#btnSaveGhConfig").addEventListener("click", async () => {
    const cfg = {
      owner: $("#cfgOwner").value.trim(),
      repo: $("#cfgRepo").value.trim(),
      booksPath: $("#cfgBooksPath").value.trim() || "data",
      hiddenPath: $("#cfgHiddenPath").value.trim() || DEFAULT_HIDDEN_PATH,
      branch: $("#cfgBranch").value.trim() || "main",
      token: $("#cfgToken").value.trim(),
    };
    if (!cfg.owner || !cfg.repo || !cfg.token) {
      alert("Cần nhập ít nhất username, tên repo và token.");
      return;
    }
    await Store.saveConfig(cfg);
    closeGithubConfig();
    syncFromGithub();
  });
}

function bindSyncPanel() {
  els.btnSync.addEventListener("click", syncFromGithub);
  $("#btnCloseSync").addEventListener("click", () => {
    els.syncOverlay.classList.add("hidden");
    els.syncPanel.classList.add("hidden");
  });
}

// ---------------- Khởi tạo ----------------

async function init() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }

  bindGithubConfig();
  bindSyncPanel();
  bindTypeChips();
  bindHiddenPanel();

  els.searchInput.addEventListener("input", debounce(runSearch, 150));
  els.bookFilter.addEventListener("change", () => {
    state.activeBook = els.bookFilter.value;
    runSearch();
  });

  const cfg0 = await Store.getConfig();
  if (cfg0 && cfg0.owner && cfg0.repo && cfg0.token) {
    try {
      const { list, sha } = await loadHiddenFromGithub(cfg0);
      state.hiddenList = list;
      state.hiddenSha = sha;
      await Store.saveHidden(list);
    } catch (e) {
      state.hiddenList = (await Store.getHidden().catch(() => null)) || [];
    }
  } else {
    state.hiddenList = (await Store.getHidden().catch(() => null)) || [];
  }
  updateHiddenCount();

  const cached = await Store.getCache().catch(() => null);
  if (cached && Array.isArray(cached.entries)) {
    state.entries = cached.entries;
    state.books = cached.books || [];
    state.syncedAt = cached.syncedAt || null;
    renderBookFilter();
    updateSyncStatus();
    runSearch();
  } else {
    updateSyncStatus();
  }

  const cfg = await Store.getConfig();
  if (!cfg || !cfg.owner || !cfg.repo || !cfg.token) {
    openGithubConfig();
  }
}

document.addEventListener("DOMContentLoaded", init);
