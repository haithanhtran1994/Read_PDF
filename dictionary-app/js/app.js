/* app.js — Từ điển tra cứu tổng hợp: quét toàn bộ data/<book>/<chapter>.json trên GitHub
   (đúng cấu trúc app đọc sách đang dùng), gom hết grammar + analysis (vocab/idiom/slang/
   collocation/phrase) của TẤT CẢ sách/chương vào 1 danh sách, cho tra cứu bằng tiếng Anh/
   Nhật (cụm từ gốc) hoặc tiếng Việt (phần giải thích), không phân biệt hoa/thường, không
   phân biệt dấu tiếng Việt khi tra bằng tiếng Việt.
*/

const $ = (sel) => document.querySelector(sel);

const state = {
  entries: [],       // toàn bộ mục đã gom, mỗi mục: {type, phrase, explain, sources:[{book,chapter,page}]}
  books: [],         // danh sách tên sách duy nhất, để lọc
  activeTypes: new Set(["grammar", "vocab", "idiom", "slang", "collocation", "phrase"]),
  activeBook: "",     // "" = tất cả sách
  syncedAt: null,
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

// ---------------- Đồng bộ dữ liệu từ GitHub ----------------

function logSync(msg, cls) {
  const d = document.createElement("div");
  d.className = "sync-log-line " + (cls || "");
  d.textContent = msg;
  els.syncLog.appendChild(d);
  els.syncLog.scrollTop = els.syncLog.scrollHeight;
}

function makeEntryKey(type, phrase, explain) {
  return `${type}\u0000${normalize(phrase)}\u0000${normalize(explain)}`;
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
          const data = await GH.getJSONObject(cfg, `${booksPath}/${book}/${chFile.name}`);
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

    const entries = Array.from(merged.values());
    const books = Array.from(new Set(bookItems.map((b) => b.name))).sort();
    state.entries = entries;
    state.books = books;
    state.syncedAt = new Date().toISOString();

    await Store.saveCache({ entries, books, syncedAt: state.syncedAt });

    logSync(`Xong. Tổng cộng ${entries.length} mục từ ${books.length} sách.`, "ok");
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

// ---------------- Tìm kiếm ----------------

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

  const html = scored.slice(0, MAX_SHOW).map(({ e }) => {
    const sourcesText = e.sources
      .slice(0, 6)
      .map((s) => `${s.book}/${s.chapter}${s.page != null ? ` tr.${s.page}` : ""}`)
      .join(", ") + (e.sources.length > 6 ? `, +${e.sources.length - 6} nữa` : "");
    return `<div class="dict-item">
      <div class="dict-head">
        <span class="dict-type" data-type="${escapeHtml(e.type)}">${escapeHtml(TYPE_LABEL[e.type] || e.type)}</span>
        <span class="dict-phrase">${escapeHtml(e.phrase)}</span>
      </div>
      ${e.explain ? `<div class="dict-explain">${escapeHtml(e.explain)}</div>` : ""}
      <div class="dict-source">${escapeHtml(sourcesText)}</div>
    </div>`;
  }).join("");
  els.results.innerHTML = html || `<div class="dict-empty">Không tìm thấy mục nào khớp "${escapeHtml(rawQuery)}".</div>`;
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

  els.searchInput.addEventListener("input", debounce(runSearch, 150));
  els.bookFilter.addEventListener("change", () => {
    state.activeBook = els.bookFilter.value;
    runSearch();
  });

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
