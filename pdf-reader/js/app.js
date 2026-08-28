/* app.js — PDF Dual Reader
   - Pane A: mở PDF, hiển thị bằng pdf.js. Text layer cho phép bôi đen chọn text.
     Khi chọn text: hiện toolbar (Highlight / Gạch chân / Add) NGAY DƯỚI đoạn chọn.
     "Add" mở 1 bảng ghi chú kéo-thả-tự-do; bấm "Thêm" sẽ đẩy ghi chú lên GitHub
     (data/notes.json trong repo) qua GH (js/github.js).
   - Pane B: đọc dữ liệu JSON (bản dịch + phân tích ngữ pháp/slang/idiom/collocation)
     theo từng trang, chia theo book/chapter, lấy trực tiếp từ GitHub
     (data/<book>/<chapter>.json). Có mục lục chọn book/chapter, chuyển trang,
     bật/tắt hiển thị Dịch / Phân tích / Cả hai, và sửa nội dung rồi đẩy lại lên GitHub.
   - Nút "Nhập & đẩy dữ liệu lên GitHub": chọn 1 thư mục JSON trên máy (Windows/Chrome)
     rồi tự động đẩy từng file lên data/<book>/ trên GitHub.
   - Topbar và thanh công cụ từng pane có thể ẩn/hiện (thu gọn) để tiết kiệm diện tích
     màn hình nhỏ (iPhone). Ranh giới giữa 2 cột có thể kéo để đổi kích thước.
     PDF hỗ trợ pinch-zoom 2 ngón tay. Cả 2 pane hỗ trợ vuốt trái/phải để chuyển trang
     (phân biệt với cuộn dọc bình thường).
*/

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const state = {
  layout: "horizontal",
  splitRatio: null, // % chiều rộng/cao dành cho paneA, null = mặc định 50/50
  panes: {
    A: {
      name: null, pdfDoc: null, pageNum: 1, numPages: 0, scale: null,
      source: null,           // { type: "device", size } | { type: "github", path }
      pdfId: null,            // định danh ổn định để lưu/đọc highlight
      viewport: null,         // viewport pdf.js của lần render gần nhất (dùng để đổi tọa độ)
      highlightsByPage: {},   // { [pageNum]: [ {id, page, mode, color, quads, createdAt} ] }
    },
  },
  pdfBrowse: { stack: [] }, // ngăn xếp thư mục đang duyệt khi mở PDF từ GitHub
  activeRange: null,
  activeText: "",
  activeSlot: null,
  activePage: null,
  hlMode: "highlight",
  hlColor: "#F7E27A",
  dragging: null,
  json: {
    book: null,
    chapter: null,
    raw: null,        // toàn bộ object JSON gốc (giữ nguyên field khác ngoài "pages")
    pages: [],       // mảng page object đã sort theo số trang
    pageIdx: 0,       // vị trí hiện tại trong mảng pages (0-based)
    mode: "translation", // "translation" | "analysis" | "both"
    editing: false,
  },
  tocBook: null, // book đang chọn dở trong drawer mục lục
};

const $ = (sel) => document.querySelector(sel);

const els = {
  splitContainer: $("#splitContainer"),
  paneResizer: $("#paneResizer"),
  btnLayout: $("#btnLayout"),
  btnGithubStatus: $("#btnGithubStatus"),
  btnImport: $("#btnImport"),
  hlToolbar: $("#hlToolbar"),
  addPanel: $("#addPanel"),
  addPanelHandle: $("#addPanelHandle"),
  addTextOriginal: $("#addTextOriginal"),
  addVocab: $("#addVocab"),
  addGrammar: $("#addGrammar"),
  addNote: $("#addNote"),
  addTranslation: $("#addTranslation"),
  addStatus: $("#addStatus"),
  githubOverlay: $("#githubOverlay"),
  githubConfigPanel: $("#githubConfigPanel"),
  // Pane B / JSON
  paneBTitle: $("#paneBTitle"),
  pageIndB: $("#pageIndB"),
  jsonContent: $("#jsonContent"),
  emptyB: $("#emptyB"),
  modeToggle: $("#modeToggle"),
  btnJsonEdit: $("#btnJsonEdit"),
  btnOpenToc: $("#btnOpenToc"),
  tocOverlay: $("#tocOverlay"),
  tocPanel: $("#tocPanel"),
  tocBookList: $("#tocBookList"),
  tocChapterWrap: $("#tocChapterWrap"),
  tocChapterList: $("#tocChapterList"),
  tocStatus: $("#tocStatus"),
  tocHint: $("#tocHint"),
  // Import
  importOverlay: $("#importOverlay"),
  importPanel: $("#importPanel"),
  importBookName: $("#importBookName"),
  importLog: $("#importLog"),
};

function paneEls(slot) {
  return {
    fileInput: $(`#file${slot}`),
    title: $(`#pane${slot}Title`),
    scroll: $(`#scroll${slot}`),
    pageWrap: $(`#pageWrap${slot}`),
    canvas: $(`#canvas${slot}`),
    textLayer: $(`#textLayer${slot}`),
    highlightLayer: $(`#highlightLayer${slot}`),
    pageInd: $(`#pageInd${slot}`),
    empty: $(`#empty${slot}`),
    toolbar: $(`#pane${slot}`).querySelector(".pane-toolbar"),
  };
}

// ---------- Khởi tạo ----------
async function init() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }

  const uiState = await Store.getUiState();
  if (uiState && uiState.layout) setLayout(uiState.layout, false);
  if (uiState && uiState.splitRatio) applySplitRatio(uiState.splitRatio);
  if (uiState && uiState.collapse) applyCollapseState(uiState.collapse);

  const cfg = await Store.getConfig();
  updateGhStatus(!!(cfg && cfg.owner && cfg.repo && cfg.token));

  const pe = paneEls("A");
  pe.fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) openPdfFile("A", file);
  });
  pe.toolbar.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => handlePaneNav("A", btn.dataset.act));
  });
  $("#btnOpenPdfGithub").addEventListener("click", openPdfPicker);
  bindPdfPicker();

  // Khôi phục PDF đã mở lần trước (lưu trong IndexedDB), kèm nguồn gốc (device/github)
  // để biết đọc/ghi highlight đúng chỗ.
  const saved = await Store.getPdf("A");
  if (saved && saved.blob) {
    try {
      await openPdfBlob("A", saved.blob, saved.name, saved.source || { type: "device" });
    } catch (e) { /* bỏ qua nếu lỗi */ }
  }

  els.btnLayout.addEventListener("click", () => {
    setLayout(state.layout === "horizontal" ? "vertical" : "horizontal", true);
  });

  bindSelectionHandlers();
  bindHlToolbar();
  bindAddPanel();
  bindGithubConfig();
  bindJsonPane();
  bindImportPanel();
  bindCollapsibleBars();
  bindResizer();
  bindPinchZoom("A");
  bindSwipeNav($("#scrollA"), "A", false);
  bindSwipeNav($("#scrollB"), "B", true);

  // Khôi phục book/chapter/mode đã đọc lần trước
  if (uiState && uiState.json && uiState.json.book && uiState.json.chapter) {
    state.json.mode = uiState.json.mode || "translation";
    setModeButtons(state.json.mode);
    loadChapter(uiState.json.book, uiState.json.chapter, uiState.json.pageIdx || 0).catch(() => {});
  }

  window.addEventListener("resize", debounce(() => {
    if (state.panes.A.pdfDoc) fitAndRender("A", true);
  }, 250));
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function persistJsonUiState() {
  Store.saveUiState({
    layout: state.layout,
    splitRatio: state.splitRatio,
    collapse: getCollapseState(),
    json: {
      book: state.json.book,
      chapter: state.json.chapter,
      pageIdx: state.json.pageIdx,
      mode: state.json.mode,
    },
  }).catch(() => {});
}

// ---------- Layout ----------
function setLayout(layout, persist) {
  state.layout = layout;
  els.splitContainer.classList.remove("layout-horizontal", "layout-vertical");
  els.splitContainer.classList.add(layout === "vertical" ? "layout-vertical" : "layout-horizontal");
  if (persist) persistJsonUiState();
  setTimeout(() => { if (state.panes.A.pdfDoc) fitAndRender("A", true); }, 50);
}

// ---------- Thanh công cụ có thể ẩn/hiện (topbar + pane-toolbar) ----------
function bindCollapsibleBars() {
  bindCollapsible($("#btnToggleTopbar"), $("#topbar"), () => {
    requestAnimationFrame(() => { if (state.panes.A.pdfDoc) fitAndRender("A", true); });
  });
  bindCollapsible($("#btnToggleToolbarA"), $("#toolbarA"), () => {
    requestAnimationFrame(() => { if (state.panes.A.pdfDoc) fitAndRender("A", true); });
  });
  bindCollapsible($("#btnToggleToolbarB"), $("#toolbarB"), () => {});
}

function bindCollapsible(handleEl, containerEl, onToggle) {
  if (!handleEl || !containerEl) return;
  handleEl.addEventListener("click", () => {
    const collapsed = containerEl.classList.toggle("collapsed");
    handleEl.textContent = collapsed ? "⌄" : "⌃";
    persistJsonUiState();
    if (onToggle) onToggle(collapsed);
  });
}

function getCollapseState() {
  return {
    topbar: $("#topbar").classList.contains("collapsed"),
    toolbarA: $("#toolbarA").classList.contains("collapsed"),
    toolbarB: $("#toolbarB").classList.contains("collapsed"),
  };
}

function applyCollapseState(c) {
  [
    ["topbar", "btnToggleTopbar"],
    ["toolbarA", "btnToggleToolbarA"],
    ["toolbarB", "btnToggleToolbarB"],
  ].forEach(([id, btnId]) => {
    if (!c[id]) return;
    const el = document.getElementById(id);
    const btn = document.getElementById(btnId);
    if (el) el.classList.add("collapsed");
    if (btn) btn.textContent = "⌄";
  });
}

// ---------- Ranh giới có thể kéo để đổi kích thước 2 cột ----------
function applySplitRatio(ratio) {
  state.splitRatio = ratio;
  $("#paneA").style.flex = `0 0 ${ratio}%`;
  $("#paneB").style.flex = `0 0 ${100 - ratio}%`;
}

function bindResizer() {
  const resizer = els.paneResizer;
  const container = els.splitContainer;
  if (!resizer) return;
  let dragging = false;

  resizer.addEventListener("pointerdown", (e) => {
    dragging = true;
    resizer.setPointerCapture(e.pointerId);
  });
  resizer.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const rect = container.getBoundingClientRect();
    let ratio;
    if (state.layout === "vertical") {
      ratio = ((e.clientY - rect.top) / rect.height) * 100;
    } else {
      ratio = ((e.clientX - rect.left) / rect.width) * 100;
    }
    ratio = Math.min(85, Math.max(15, ratio));
    applySplitRatio(ratio);
  });
  ["pointerup", "pointercancel"].forEach((ev) =>
    resizer.addEventListener(ev, () => {
      if (!dragging) return;
      dragging = false;
      persistJsonUiState();
      if (state.panes.A.pdfDoc) fitAndRender("A", true);
    })
  );
}

// ---------- Vuốt trái/phải để chuyển trang (phân biệt với cuộn dọc) ----------
function bindSwipeNav(scrollEl, slot, isJson) {
  if (!scrollEl) return;
  const H_THRESHOLD = 50; // ngưỡng khoảng cách (px) để tính là 1 lần vuốt chuyển trang
  const DIR_THRESHOLD = 8; // ngưỡng để xác định hướng vuốt ban đầu
  let t = null;

  scrollEl.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) { t = null; return; }
    const touch = e.touches[0];
    t = { startX: touch.clientX, startY: touch.clientY, dx: 0, dir: null };
  }, { passive: true });

  scrollEl.addEventListener("touchmove", (e) => {
    if (!t || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const dx = touch.clientX - t.startX;
    const dy = touch.clientY - t.startY;
    if (!t.dir) {
      if (Math.abs(dx) > DIR_THRESHOLD || Math.abs(dy) > DIR_THRESHOLD) {
        // Chỉ coi là vuốt ngang (chuyển trang) nếu rõ ràng ngang hơn dọc,
        // để không xung đột với việc cuộn lên/xuống bình thường.
        t.dir = Math.abs(dx) > Math.abs(dy) * 1.4 ? "h" : "v";
      }
    }
    if (t.dir === "h") {
      t.dx = dx;
      e.preventDefault(); // chặn kéo giật/cuộn ngang mặc định trong lúc vuốt chuyển trang
    }
  }, { passive: false });

  scrollEl.addEventListener("touchend", () => {
    if (t && t.dir === "h" && Math.abs(t.dx) > H_THRESHOLD) {
      if (t.dx < 0) {
        isJson ? handleJsonNav("next") : handlePaneNav(slot, "next");
      } else {
        isJson ? handleJsonNav("prev") : handlePaneNav(slot, "prev");
      }
    }
    t = null;
  });
  scrollEl.addEventListener("touchcancel", () => { t = null; });
}

// ---------- Pinch-zoom 2 ngón tay (Pane A — PDF) ----------
function bindPinchZoom(slot) {
  const pe = paneEls(slot);
  let pinch = null;

  pe.scroll.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2 && state.panes[slot].pdfDoc) {
      const [a, b] = e.touches;
      const dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
      pinch = { startDist: dist, startScale: state.panes[slot].scale || 1, pendingScale: null };
    } else if (e.touches.length !== 2) {
      pinch = null;
    }
  }, { passive: true });

  pe.scroll.addEventListener("touchmove", (e) => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const [a, b] = e.touches;
    const dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
    const ratio = dist / pinch.startDist;
    let newScale = pinch.startScale * ratio;
    newScale = Math.min(4, Math.max(0.3, newScale));
    pinch.pendingScale = newScale;
    const visualRatio = newScale / (state.panes[slot].scale || 1);
    pe.pageWrap.style.transform = `scale(${visualRatio})`;
    pe.pageWrap.style.transformOrigin = "center center";
  }, { passive: false });

  const endPinch = () => {
    if (!pinch) return;
    pe.pageWrap.style.transform = "";
    if (pinch.pendingScale) {
      state.panes[slot].scale = pinch.pendingScale;
      fitAndRender(slot, false);
    }
    pinch = null;
  };
  pe.scroll.addEventListener("touchend", endPinch);
  pe.scroll.addEventListener("touchcancel", endPinch);
}

// ---------- Mở PDF (Pane A) ----------
async function openPdfFile(slot, file) {
  const buf = await file.arrayBuffer();
  const source = { type: "device", size: file.size };
  await loadPdfIntoPane(slot, buf, file.name, source);
  Store.savePdf(slot, file.name, file, source).catch(() => {});
}

async function openPdfBlob(slot, blob, name, source) {
  const buf = await blob.arrayBuffer();
  await loadPdfIntoPane(slot, buf, name, source || { type: "device", size: blob.size });
}

// Mở PDF lấy trực tiếp từ GitHub (thư mục cfg.pdfPrefix trong repo).
async function openPdfFromGithub(relPath, name) {
  const cfg = await Store.getConfig();
  if (!cfg || !cfg.owner || !cfg.repo || !cfg.token) {
    alert('Chưa cấu hình GitHub — mở "☁" ở góc trên để cấu hình trước.');
    return;
  }
  const file = await GH.getBinaryFile(cfg, GH.fullPath(cfg, relPath));
  if (!file) throw new Error("Không tìm thấy file trên GitHub.");
  const bytes = file.bytes;
  if (!bytes || !bytes.length) throw new Error("Tải file từ GitHub về nhưng rỗng — thử lại hoặc kiểm tra file trên GitHub.");
  const source = { type: "github", path: relPath };
  await loadPdfIntoPane("A", bytes.buffer, name, source);
  // Lưu cache blob để mở lại nhanh/offline lần sau, kèm nguồn gốc github.
  const blob = new Blob([bytes], { type: "application/pdf" });
  Store.savePdf("A", name, blob, source).catch(() => {});
}

function computePdfId(name, source) {
  if (source && source.type === "github" && source.path) return `gh:${source.path}`;
  const size = (source && source.size) || 0;
  return `local:${name}:${size}`;
}

async function loadPdfIntoPane(slot, arrayBuffer, name, source) {
  const pane = state.panes[slot];
  const pe = paneEls(slot);
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdfDoc = await loadingTask.promise;
  pane.pdfDoc = pdfDoc;
  pane.pageNum = 1;
  pane.numPages = pdfDoc.numPages;
  pane.scale = null; // sẽ auto-fit
  pane.name = name;
  pane.source = source || { type: "device" };
  pane.pdfId = computePdfId(name, pane.source);
  pane.highlightsByPage = {};
  pe.title.textContent = name;
  pe.empty.classList.add("hidden");
  await fitAndRender(slot, true);
  loadHighlightsForPane(slot).catch(() => {});
}

// ---------- Render PDF ----------
async function fitAndRender(slot, refit) {
  const pane = state.panes[slot];
  if (!pane.pdfDoc) return;
  const pe = paneEls(slot);
  const page = await pane.pdfDoc.getPage(pane.pageNum);

  if (refit || !pane.scale) {
    const base = page.getViewport({ scale: 1 });
    const availWidth = pe.scroll.clientWidth - 24;
    pane.scale = Math.max(0.3, availWidth / base.width);
  }

  const viewport = page.getViewport({ scale: pane.scale });
  pane.viewport = viewport; // dùng để đổi tọa độ khi tạo/khôi phục highlight
  const dpr = window.devicePixelRatio || 1;

  pe.canvas.width = Math.floor(viewport.width * dpr);
  pe.canvas.height = Math.floor(viewport.height * dpr);
  pe.canvas.style.width = viewport.width + "px";
  pe.canvas.style.height = viewport.height + "px";
  pe.pageWrap.style.width = viewport.width + "px";
  pe.pageWrap.style.height = viewport.height + "px";

  const ctx = pe.canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  await page.render({ canvasContext: ctx, viewport }).promise;

  pe.textLayer.innerHTML = "";
  pe.textLayer.style.width = viewport.width + "px";
  pe.textLayer.style.height = viewport.height + "px";
  pe.textLayer.style.setProperty("--scale-factor", pane.scale);
  const textContent = await page.getTextContent();
  const task = pdfjsLib.renderTextLayer({
    textContentSource: textContent,
    container: pe.textLayer,
    viewport,
  });
  await task.promise;

  if (pe.highlightLayer) {
    pe.highlightLayer.style.width = viewport.width + "px";
    pe.highlightLayer.style.height = viewport.height + "px";
    renderHighlightOverlay(slot);
  }

  pe.pageInd.textContent = `${pane.pageNum}/${pane.numPages}`;
}

function handlePaneNav(slot, act) {
  const pane = state.panes[slot];
  if (!pane.pdfDoc) return;
  if (act === "prev" && pane.pageNum > 1) { pane.pageNum--; fitAndRender(slot, false); }
  if (act === "next" && pane.pageNum < pane.numPages) { pane.pageNum++; fitAndRender(slot, false); }
  if (act === "zoomIn") { pane.scale = Math.min(4, (pane.scale || 1) + 0.15); fitAndRender(slot, false); }
  if (act === "zoomOut") { pane.scale = Math.max(0.3, (pane.scale || 1) - 0.15); fitAndRender(slot, false); }
}

// ---------- Chọn & mở PDF từ GitHub (thư mục cfg.pdfPrefix, có thể có thư mục con) ----------
function bindPdfPicker() {
  $("#btnClosePdfPick").addEventListener("click", closePdfPicker);
  $("#pdfPickOverlay").addEventListener("click", closePdfPicker);
  $("#btnPdfPickBack").addEventListener("click", () => {
    state.pdfBrowse.stack.pop();
    showPdfDir(state.pdfBrowse.stack[state.pdfBrowse.stack.length - 1] || "");
  });
}

function openPdfPicker() {
  state.pdfBrowse.stack = [""];
  $("#pdfPickOverlay").classList.remove("hidden");
  $("#pdfPickPanel").classList.remove("hidden");
  showPdfDir("");
}

function closePdfPicker() {
  $("#pdfPickOverlay").classList.add("hidden");
  $("#pdfPickPanel").classList.add("hidden");
}

async function showPdfDir(relPath) {
  const listEl = $("#pdfPickList");
  const statusEl = $("#pdfPickStatus");
  const hintEl = $("#pdfPickHint");
  const backBtn = $("#btnPdfPickBack");
  listEl.innerHTML = "";
  statusEl.textContent = "Đang tải…";
  hintEl.textContent = relPath ? `Thư mục: ${relPath}` : "Đang ở thư mục gốc.";
  backBtn.classList.toggle("hidden", state.pdfBrowse.stack.length <= 1);

  const cfg = await Store.getConfig();
  if (!cfg || !cfg.owner || !cfg.repo || !cfg.token) {
    statusEl.textContent = 'Chưa cấu hình GitHub — mở "☁" ở góc trên để cấu hình trước.';
    return;
  }
  try {
    const pdfPrefix = cfg.pdfPrefix || "pdf";
    const fullRel = relPath ? `${pdfPrefix}/${relPath}` : pdfPrefix;
    const queriedPath = GH.fullPath(cfg, fullRel);
    const items = await GH.listDir(cfg, queriedPath);
    statusEl.textContent = "";
    const dirs = items.filter((it) => it.type === "dir").sort((a, b) => a.name.localeCompare(b.name));
    const files = items
      .filter((it) => it.type === "file" && /\.pdf$/i.test(it.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (!dirs.length && !files.length) {
      statusEl.textContent = `Không thấy PDF nào ở đường dẫn GitHub: "${queriedPath}" (repo ${cfg.owner}/${cfg.repo}, branch ${cfg.branch || "main"}). ` +
        `Nếu thư mục pdf/ có file thật mà vẫn báo trống, khả năng cao "Đường dẫn tới thư mục app" hoặc ` +
        `"Thư mục chứa file PDF" trong cấu hình GitHub (☁) đang sai — kiểm tra lại cho khớp cấu trúc thật trên GitHub.`;
      return;
    }
    dirs.forEach((d) => {
      const btn = document.createElement("button");
      btn.className = "toc-item";
      btn.textContent = `📁 ${d.name}`;
      btn.addEventListener("click", () => {
        const next = relPath ? `${relPath}/${d.name}` : d.name;
        state.pdfBrowse.stack.push(next);
        showPdfDir(next);
      });
      listEl.appendChild(btn);
    });
    files.forEach((f) => {
      const btn = document.createElement("button");
      btn.className = "toc-item";
      btn.textContent = f.name;
      btn.addEventListener("click", async () => {
        const path = `${fullRel}/${f.name}`; // đường dẫn tính từ thư mục app (đã gồm pdfPrefix)
        statusEl.textContent = "Đang tải PDF…";
        try {
          await openPdfFromGithub(path, f.name);
          closePdfPicker();
        } catch (e) {
          statusEl.textContent = `Lỗi mở file: ${e.message}`;
        }
      });
      listEl.appendChild(btn);
    });
  } catch (e) {
    statusEl.textContent = `Lỗi tải danh sách: ${e.message}`;
  }
}

// ================= PANE B — JSON (dịch + phân tích) =================

function blockIfEditing() {
  if (state.json.editing) {
    alert('Đang sửa nội dung — hãy bấm "Cập nhật" hoặc "Hủy" trước khi làm việc khác.');
    return true;
  }
  return false;
}

function bindJsonPane() {
  els.btnOpenToc.addEventListener("click", () => { if (!blockIfEditing()) openToc(); });
  $("#btnCloseToc").addEventListener("click", closeToc);
  els.tocOverlay.addEventListener("click", closeToc);
  $("#btnTocBack").addEventListener("click", showTocBooks);

  els.modeToggle.querySelectorAll(".mode-btn[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (blockIfEditing()) return;
      state.json.mode = btn.dataset.mode;
      setModeButtons(state.json.mode);
      renderJsonPage();
      persistJsonUiState();
    });
  });

  els.btnJsonEdit.addEventListener("click", () => {
    if (!state.json.pages.length) return;
    if (state.json.editing) return;
    state.json.editing = true;
    renderJsonEditForm();
  });

  $("#paneB .pane-nav").querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => handleJsonNav(btn.dataset.act));
  });
}

function setModeButtons(mode) {
  els.modeToggle.querySelectorAll(".mode-btn[data-mode]").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === mode);
  });
}

function handleJsonNav(act) {
  if (state.json.editing) return;
  const j = state.json;
  if (!j.pages.length) return;
  if (act === "prev" && j.pageIdx > 0) { j.pageIdx--; renderJsonPage(); persistJsonUiState(); }
  if (act === "next" && j.pageIdx < j.pages.length - 1) { j.pageIdx++; renderJsonPage(); persistJsonUiState(); }
}

// ---- Mục lục (chọn book -> chapter) ----
async function openToc() {
  els.tocOverlay.classList.remove("hidden");
  els.tocPanel.classList.remove("hidden");
  await showTocBooks();
}
function closeToc() {
  els.tocOverlay.classList.add("hidden");
  els.tocPanel.classList.add("hidden");
}

async function showTocBooks() {
  els.tocChapterWrap.classList.add("hidden");
  els.tocHint.textContent = "Chọn sách (thư mục trong data/ trên GitHub):";
  els.tocBookList.classList.remove("hidden");
  els.tocBookList.innerHTML = "";
  els.tocStatus.textContent = "Đang tải danh sách sách…";

  const cfg = await Store.getConfig();
  if (!cfg || !cfg.owner || !cfg.repo || !cfg.token) {
    els.tocStatus.textContent = 'Chưa cấu hình GitHub — mở "☁" ở góc trên để cấu hình trước.';
    return;
  }
  try {
    const booksPath = cfg.booksPath || "data";
    const items = await GH.listDir(cfg, GH.fullPath(cfg, booksPath));
    const dirs = items.filter((it) => it.type === "dir");
    els.tocStatus.textContent = "";
    if (!dirs.length) {
      els.tocStatus.textContent = "Chưa có sách nào trong data/. Dùng nút ⇪ để nhập & đẩy dữ liệu lên.";
      return;
    }
    dirs.forEach((d) => {
      const btn = document.createElement("button");
      btn.className = "toc-item";
      btn.textContent = d.name;
      btn.addEventListener("click", () => showTocChapters(d.name));
      els.tocBookList.appendChild(btn);
    });
  } catch (e) {
    els.tocStatus.textContent = `Lỗi tải danh sách sách: ${e.message}`;
  }
}

async function showTocChapters(book) {
  state.tocBook = book;
  els.tocBookList.classList.add("hidden");
  els.tocChapterWrap.classList.remove("hidden");
  els.tocChapterList.innerHTML = "";
  els.tocStatus.textContent = "Đang tải danh sách chương…";

  const cfg = await Store.getConfig();
  try {
    const booksPath = cfg.booksPath || "data";
    const items = await GH.listDir(cfg, GH.fullPath(cfg, `${booksPath}/${book}`));
    const files = items
      .filter((it) => it.type === "file" && /\.json$/i.test(it.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    els.tocStatus.textContent = "";
    if (!files.length) {
      els.tocStatus.textContent = "Sách này chưa có chương nào.";
      return;
    }
    files.forEach((f) => {
      const chapterId = f.name.replace(/\.json$/i, "");
      const btn = document.createElement("button");
      btn.className = "toc-item";
      btn.textContent = chapterId;
      btn.addEventListener("click", () => {
        closeToc();
        loadChapter(book, chapterId, 0);
      });
      els.tocChapterList.appendChild(btn);
    });
  } catch (e) {
    els.tocStatus.textContent = `Lỗi tải danh sách chương: ${e.message}`;
  }
}

// ---- Tải & hiển thị 1 chương ----
async function loadChapter(book, chapter, pageIdx) {
  state.json.editing = false;
  els.paneBTitle.textContent = `${book} / ${chapter}`;
  els.jsonContent.innerHTML = "";
  els.emptyB.textContent = "Đang tải…";
  els.emptyB.classList.remove("hidden");

  let data = null;
  try {
    const cfg = await Store.getConfig();
    if (cfg && cfg.owner && cfg.repo && cfg.token) {
      const booksPath = cfg.booksPath || "data";
      const res = await GH.getJSONObject(cfg, `${booksPath}/${book}/${chapter}.json`);
      if (res && res.data) {
        data = res.data;
        Store.saveChapter(book, chapter, data).catch(() => {});
      }
    }
  } catch (e) {
    els.emptyB.textContent = `Lỗi tải từ GitHub: ${e.message}. Thử đọc bản đã lưu tạm trên máy…`;
  }

  if (!data) {
    data = await Store.getChapter(book, chapter).catch(() => null);
  }

  if (!data || !Array.isArray(data.pages) || !data.pages.length) {
    els.emptyB.textContent = "Không đọc được dữ liệu chương này (chưa có trên GitHub hoặc chưa cache trên máy).";
    els.pageIndB.textContent = "–";
    return;
  }

  const pages = data.pages.slice().sort((a, b) => (Number(a.page) || 0) - (Number(b.page) || 0));
  state.json.book = book;
  state.json.chapter = chapter;
  state.json.raw = data;
  state.json.pages = pages;
  state.json.pageIdx = Math.min(Math.max(0, pageIdx || 0), pages.length - 1);

  els.emptyB.classList.add("hidden");
  renderJsonPage();
  persistJsonUiState();
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const ANALYSIS_LABEL = {
  grammar: "Ngữ pháp",
  vocab: "Từ vựng",
  idiom: "Thành ngữ",
  slang: "Slang",
  collocation: "Collocation",
  phrase: "Cụm từ",
};

function renderAnalysisList(items, cls) {
  if (!items || !items.length) return "";
  return items.map((it) => {
    const rawType = it.type || (cls === "grammar" ? "grammar" : "");
    const type = it.type ? (ANALYSIS_LABEL[it.type] || it.type) : (cls === "grammar" ? ANALYSIS_LABEL.grammar : "");
    return `<div class="an-item ${cls}">
      ${type ? `<span class="an-type" data-type="${escapeHtml(rawType)}">${escapeHtml(type)}</span>` : ""}
      <span class="an-phrase">${escapeHtml(it.phrase)}</span>
      ${it.explain ? `<div class="an-explain">${escapeHtml(it.explain)}</div>` : ""}
    </div>`;
  }).join("");
}

function renderJsonPage() {
  const j = state.json;
  const page = j.pages[j.pageIdx];
  if (!page) return;
  els.pageIndB.textContent = `${j.pageIdx + 1}/${j.pages.length} (tr.${page.page ?? "?"})`;

  const mode = j.mode;
  let html = "";
  if (mode === "translation" || mode === "both") {
    html += `<div class="json-section">
      <div class="json-section-title">Bản dịch</div>
      <div class="translation-text">${escapeHtml(page.translation || "(chưa có bản dịch)")}</div>
    </div>`;
  }
  if (mode === "analysis" || mode === "both") {
    const grammarHtml = renderAnalysisList(page.grammar, "grammar");
    const analysisHtml = renderAnalysisList(page.analysis, "analysis");
    html += `<div class="json-section">
      <div class="json-section-title">Ngữ pháp</div>
      ${grammarHtml || '<div class="an-empty">(không có)</div>'}
    </div>
    <div class="json-section">
      <div class="json-section-title">Từ vựng / Slang / Idiom / Collocation / Cụm từ</div>
      ${analysisHtml || '<div class="an-empty">(không có)</div>'}
    </div>`;
  }
  els.jsonContent.innerHTML = html;
  $("#scrollB").scrollTop = 0;
}

// ---- Sửa nội dung trang JSON (dịch / phân tích) rồi đẩy lên GitHub ----
function renderEditableList(items, cls, title) {
  const rows = (items || []).map((it, idx) => `
    <div class="an-item edit ${cls}" data-idx="${idx}">
      <input type="text" class="an-edit-phrase" data-field="phrase" value="${escapeHtml(it.phrase || "")}" placeholder="Cụm từ / từ khóa">
      <textarea class="an-edit-explain" data-field="explain" rows="2" placeholder="Giải thích">${escapeHtml(it.explain || "")}</textarea>
    </div>`).join("");
  return `<div class="json-section">
    <div class="json-section-title">${title} (đang sửa)</div>
    ${rows || '<div class="an-empty">(không có mục nào để sửa)</div>'}
  </div>`;
}

function renderJsonEditForm() {
  const j = state.json;
  const page = j.pages[j.pageIdx];
  if (!page) return;
  els.pageIndB.textContent = `${j.pageIdx + 1}/${j.pages.length} (tr.${page.page ?? "?"}) — đang sửa`;

  let html = "";
  if (j.mode === "translation" || j.mode === "both") {
    html += `<div class="json-section">
      <div class="json-section-title">Bản dịch (đang sửa)</div>
      <textarea class="edit-translation" id="editTranslation" rows="6" placeholder="Nhập bản dịch…">${escapeHtml(page.translation || "")}</textarea>
    </div>`;
  }
  if (j.mode === "analysis" || j.mode === "both") {
    html += renderEditableList(page.grammar, "grammar", "Ngữ pháp");
    html += renderEditableList(page.analysis, "analysis", "Slang / Idiom / Collocation / Cụm từ");
  }
  html += `<div class="edit-actions json-edit-actions">
    <button id="btnJsonSave" class="btn-save">Cập nhật</button>
    <button id="btnJsonCancel" class="btn-cancel">Hủy</button>
  </div>
  <div id="jsonEditStatus" class="gh-hint"></div>`;

  els.jsonContent.innerHTML = html;
  $("#scrollB").scrollTop = 0;

  $("#btnJsonCancel").addEventListener("click", () => {
    state.json.editing = false;
    renderJsonPage();
  });
  $("#btnJsonSave").addEventListener("click", saveJsonEdits);
}

function applyEditableList(page, field) {
  const items = page[field] || [];
  els.jsonContent.querySelectorAll(`.an-item.edit.${field}`).forEach((el) => {
    const idx = Number(el.dataset.idx);
    if (!items[idx]) return;
    const phraseInput = el.querySelector('[data-field="phrase"]');
    const explainInput = el.querySelector('[data-field="explain"]');
    items[idx].phrase = phraseInput.value.trim();
    items[idx].explain = explainInput.value.trim();
  });
}

async function saveJsonEdits() {
  const statusEl = $("#jsonEditStatus");
  const cfg = await Store.getConfig();
  if (!cfg || !cfg.owner || !cfg.repo || !cfg.token) {
    statusEl.textContent = 'Chưa cấu hình GitHub — mở "☁" ở góc trên để cấu hình trước.';
    return;
  }

  const j = state.json;
  const page = j.pages[j.pageIdx];
  if (j.mode === "translation" || j.mode === "both") {
    const ta = $("#editTranslation");
    if (ta) page.translation = ta.value;
  }
  if (j.mode === "analysis" || j.mode === "both") {
    applyEditableList(page, "grammar");
    applyEditableList(page, "analysis");
  }

  statusEl.textContent = "Đang cập nhật lên GitHub…";
  $("#btnJsonSave").disabled = true;
  $("#btnJsonCancel").disabled = true;
  try {
    const booksPath = cfg.booksPath || "data";
    const relPath = `${booksPath}/${j.book}/${j.chapter}.json`;
    const raw = j.raw || { pages: j.pages };
    raw.pages = j.pages;
    await GH.putTextFile(cfg, relPath, JSON.stringify(raw, null, 2), `Cập nhật ${j.book}/${j.chapter} trang ${page.page ?? j.pageIdx + 1}`);
    await Store.saveChapter(j.book, j.chapter, raw).catch(() => {});
    statusEl.textContent = "Đã cập nhật ✓";
    setTimeout(() => {
      state.json.editing = false;
      renderJsonPage();
    }, 600);
  } catch (e) {
    statusEl.textContent = `Lỗi đẩy lên GitHub: ${e.message}. Bấm "Cập nhật" để thử lại.`;
  } finally {
    $("#btnJsonSave").disabled = false;
    $("#btnJsonCancel").disabled = false;
  }
}

// ================= NHẬP & ĐẨY DỮ LIỆU LÊN GITHUB =================

function bindImportPanel() {
  els.btnImport.addEventListener("click", openImportPanel);
  $("#btnCloseImport").addEventListener("click", closeImportPanel);
  $("#btnCancelImport").addEventListener("click", closeImportPanel);
  els.importOverlay.addEventListener("click", closeImportPanel);
  $("#btnPickFolder").addEventListener("click", pickFolderAndPush);
}

function openImportPanel() {
  els.importLog.innerHTML = "";
  els.importBookName.value = "";
  els.importOverlay.classList.remove("hidden");
  els.importPanel.classList.remove("hidden");
}
function closeImportPanel() {
  els.importOverlay.classList.add("hidden");
  els.importPanel.classList.add("hidden");
}

function logImport(msg, cls) {
  const div = document.createElement("div");
  div.className = `import-log-line ${cls || ""}`;
  div.textContent = msg;
  els.importLog.appendChild(div);
  els.importLog.scrollTop = els.importLog.scrollHeight;
}

async function pickFolderAndPush() {
  const cfg = await Store.getConfig();
  if (!cfg || !cfg.owner || !cfg.repo || !cfg.token) {
    logImport('Chưa cấu hình GitHub — mở "☁" ở góc trên để cấu hình trước.', "err");
    return;
  }
  if (!("showDirectoryPicker" in window)) {
    logImport("Trình duyệt này không hỗ trợ chọn thư mục (cần Chrome/Edge trên máy tính).", "err");
    return;
  }

  let dirHandle;
  try {
    dirHandle = await window.showDirectoryPicker();
  } catch (e) {
    return; // người dùng bấm Hủy
  }

  const bookName = (els.importBookName.value.trim() || dirHandle.name).trim();
  els.importBookName.value = bookName;
  logImport(`Đang đọc thư mục "${dirHandle.name}" → sẽ đẩy lên data/${bookName}/ …`);

  const jsonFiles = [];
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === "file" && /\.json$/i.test(name)) jsonFiles.push({ name, handle });
  }
  if (!jsonFiles.length) {
    logImport("Không tìm thấy file .json nào trong thư mục này.", "err");
    return;
  }
  jsonFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  const booksPath = cfg.booksPath || "data";
  let ok = 0, fail = 0;
  for (const jf of jsonFiles) {
    try {
      const file = await jf.handle.getFile();
      const text = await file.text();
      JSON.parse(text); // kiểm tra JSON hợp lệ trước khi đẩy lên
      const relPath = `${booksPath}/${bookName}/${jf.name}`;
      await GH.putTextFile(cfg, relPath, text, `Cập nhật ${bookName}/${jf.name}`);
      logImport(`✓ Đã đẩy ${jf.name}`, "ok");
      ok++;
    } catch (e) {
      logImport(`✗ Lỗi ${jf.name}: ${e.message}`, "err");
      fail++;
    }
  }
  logImport(`Hoàn tất: ${ok} file thành công, ${fail} file lỗi.`, fail ? "err" : "ok");
}

// ================= Chọn text -> toolbar Highlight/Gạch chân/Add (Pane A) =================
function bindSelectionHandlers() {
  document.addEventListener("mouseup", handleSelectionEnd);
  document.addEventListener("touchend", handleSelectionEnd);
}

function handleSelectionEnd(e) {
  // Đừng đóng toolbar nếu người dùng đang bấm chính vào toolbar/panel
  if (e && e.target && (e.target.closest("#hlToolbar") || e.target.closest("#addPanel"))) return;

  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.toString().trim() === "") { hideHlToolbar(); return; }

  const range = sel.getRangeAt(0);
  const anchorEl = range.commonAncestorContainer.nodeType === 1
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement;
  const textLayerEl = anchorEl ? anchorEl.closest(".textLayer") : null;
  if (!textLayerEl) { hideHlToolbar(); return; }

  const slot = textLayerEl.id.replace("textLayer", "");
  state.activeRange = range.cloneRange();
  state.activeText = sel.toString().trim();
  state.activeSlot = slot;
  state.activePage = state.panes[slot].pageNum;

  const rect = range.getBoundingClientRect();
  els.hlToolbar.classList.remove("hidden");
  const tbH = els.hlToolbar.offsetHeight || 44;
  const tbW = els.hlToolbar.offsetWidth || 220;
  // Ưu tiên hiện PHÍA DƯỚI đoạn được chọn để tránh đè lên popup Copy/Look Up của iOS
  let top = rect.bottom + 10;
  if (top + tbH > window.innerHeight - 8) top = Math.max(8, rect.top - tbH - 10);
  let left = Math.min(Math.max(8, rect.left), window.innerWidth - tbW - 8);
  els.hlToolbar.style.top = top + "px";
  els.hlToolbar.style.left = left + "px";
}

function hideHlToolbar() { els.hlToolbar.classList.add("hidden"); }

function bindHlToolbar() {
  els.hlToolbar.querySelectorAll(".hl-act-btn[data-act]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const act = btn.dataset.act;
      if (act === "highlight" || act === "underline") {
        state.hlMode = act;
        applyMark(state.hlMode, state.hlColor);
      } else if (act === "add") {
        openAddPanel();
      }
    });
  });
  els.hlToolbar.querySelectorAll(".swatch").forEach((sw) => {
    sw.addEventListener("click", () => {
      state.hlColor = sw.dataset.color;
      applyMark(state.hlMode, state.hlColor);
    });
  });
}

// Bọc mọi text-node giao với range bằng 1 phần tử (mark/span), kể cả khi
// selection cắt ngang nhiều <span> dòng khác nhau của pdf.js text layer.
function wrapRangeNodes(range, makeWrapper, outWrappers) {
  const root = range.commonAncestorContainer;
  let textNodes = [];
  if (root.nodeType === 3) {
    textNodes = [root];
  } else {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        try { return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT; }
        catch (e) { return NodeFilter.FILTER_REJECT; }
      },
    });
    let n;
    while ((n = walker.nextNode())) textNodes.push(n);
  }
  let wrapped = 0;
  textNodes.forEach((node) => {
    if (!node.parentNode) return;
    const isStart = node === range.startContainer;
    const isEnd = node === range.endContainer;
    let start = isStart ? range.startOffset : 0;
    let end = isEnd ? range.endOffset : node.length;
    if (start >= end) return;
    let target = node;
    if (end < target.length) target.splitText(end);
    if (start > 0) target = target.splitText(start);
    const wrapper = makeWrapper();
    target.parentNode.insertBefore(wrapper, target);
    wrapper.appendChild(target);
    wrapped++;
    if (outWrappers) outWrappers.push(wrapper);
  });
  return wrapped;
}

function applyMark(mode, color) {
  const range = state.activeRange;
  if (!range) return;
  const slot = state.activeSlot;
  const pane = state.panes[slot];
  const wrappers = [];
  const ok = wrapRangeNodes(range, () => {
    const el = document.createElement(mode === "highlight" ? "mark" : "span");
    el.className = mode === "highlight" ? "hl" : "ul";
    el.style.setProperty(mode === "highlight" ? "--hl-color" : "--ul-color", color);
    return el;
  }, wrappers);
  if (!ok) alert("Không đánh dấu được đoạn này. Thử chọn lại đoạn text trong 1 dòng.");
  else saveNewHighlight(slot, pane, mode, color, wrappers);
  window.getSelection().removeAllRanges();
  hideHlToolbar();
}

// ---------- Lưu highlight/gạch chân để lần sau mở lại vẫn còn ----------
// Đổi vị trí các <mark>/<span> vừa bọc (theo pixel trên màn hình) sang tọa độ PDF
// (đơn vị PDF, không phụ thuộc zoom) để lưu lại và vẽ lại chính xác dù zoom khác đi.
function saveNewHighlight(slot, pane, mode, color, wrappers) {
  if (!pane.viewport || !wrappers.length) return;
  const pe = paneEls(slot);
  const canvasRect = pe.canvas.getBoundingClientRect();
  const quads = wrappers.map((el) => {
    const r = el.getBoundingClientRect();
    const left = r.left - canvasRect.left;
    const top = r.top - canvasRect.top;
    const p1 = pane.viewport.convertToPdfPoint(left, top);
    const p2 = pane.viewport.convertToPdfPoint(left + r.width, top + r.height);
    return [Math.min(p1[0], p2[0]), Math.min(p1[1], p2[1]), Math.max(p1[0], p2[0]), Math.max(p1[1], p2[1])];
  }).filter(Boolean);
  if (!quads.length) return;

  const record = {
    id: `h_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    page: pane.pageNum,
    mode,
    color,
    quads,
    createdAt: new Date().toISOString(),
  };
  if (!pane.highlightsByPage[record.page]) pane.highlightsByPage[record.page] = [];
  pane.highlightsByPage[record.page].push(record);
  persistHighlights(pane).catch((e) => console.warn("Lưu highlight lỗi:", e));
}

// Gộp toàn bộ highlight của pane (mọi trang) thành 1 mảng để lưu.
function flattenHighlights(pane) {
  const all = [];
  Object.keys(pane.highlightsByPage || {}).forEach((p) => {
    (pane.highlightsByPage[p] || []).forEach((r) => all.push(r));
  });
  return all;
}

// Đường dẫn file JSON sidecar lưu highlight của 1 file PDF cụ thể trên GitHub.
function highlightsRelPath(cfg, pane) {
  const prefix = cfg.highlightsPrefix || "highlights";
  if (pane.source && pane.source.type === "github" && pane.source.path) {
    return `${prefix}/${pane.source.path}.json`;
  }
  const safeName = (pane.name || "unnamed").replace(/[^a-zA-Z0-9._-]/g, "_");
  const size = (pane.source && pane.source.size) || 0;
  return `${prefix}/local/${safeName}_${size}.json`;
}

// Ghi lại toàn bộ highlight của pane: lưu local (IndexedDB) ngay lập tức để không
// mất dữ liệu, và đẩy lên GitHub (nếu đã cấu hình) để "lưu trực tiếp vào file",
// không chỉ dựa vào bộ nhớ trình duyệt — dùng chung cho cả PDF mở từ máy lẫn từ GitHub.
async function persistHighlights(pane) {
  const items = flattenHighlights(pane);
  await Store.saveHighlights(pane.pdfId, items);
  const cfg = await Store.getConfig();
  if (cfg && cfg.owner && cfg.repo && cfg.token) {
    await GH.putJSONArray(cfg, highlightsRelPath(cfg, pane), items, `Cập nhật highlight ${pane.name || ""}`);
  }
}

// Tải lại highlight đã lưu cho pane (ưu tiên bản trên GitHub nếu có cấu hình,
// vì đó là nguồn lưu trữ "thật", đọc được từ bất kỳ thiết bị/trình duyệt nào).
async function loadHighlightsForPane(slot) {
  const pane = state.panes[slot];
  if (!pane.pdfId) return;
  let items = (await Store.getHighlights(pane.pdfId).catch(() => null)) || [];
  const cfg = await Store.getConfig();
  if (cfg && cfg.owner && cfg.repo && cfg.token) {
    try {
      const remote = await GH.getJSONArray(cfg, highlightsRelPath(cfg, pane));
      if (remote && remote.sha) {
        items = remote.items;
        Store.saveHighlights(pane.pdfId, items).catch(() => {});
      }
    } catch (e) { /* offline hoặc chưa có file — dùng bản local đã có */ }
  }
  const byPage = {};
  items.forEach((r) => {
    if (!byPage[r.page]) byPage[r.page] = [];
    byPage[r.page].push(r);
  });
  pane.highlightsByPage = byPage;
  renderHighlightOverlay(slot);
}

// Vẽ lại các highlight/gạch chân đã lưu của TRANG ĐANG MỞ, đổi từ tọa độ PDF
// sang tọa độ màn hình theo viewport hiện tại (đúng dù đã zoom khác lúc tạo).
function renderHighlightOverlay(slot) {
  const pane = state.panes[slot];
  const pe = paneEls(slot);
  if (!pe.highlightLayer) return;
  pe.highlightLayer.innerHTML = "";
  if (!pane.viewport) return;
  const records = (pane.highlightsByPage && pane.highlightsByPage[pane.pageNum]) || [];
  records.forEach((record) => {
    (record.quads || []).forEach((q) => {
      const p1 = pane.viewport.convertToViewportPoint(q[0], q[1]);
      const p2 = pane.viewport.convertToViewportPoint(q[2], q[3]);
      const left = Math.min(p1[0], p2[0]);
      const top = Math.min(p1[1], p2[1]);
      const width = Math.abs(p2[0] - p1[0]);
      const height = Math.abs(p2[1] - p1[1]);
      const el = document.createElement("div");
      el.dataset.id = record.id;
      if (record.mode === "underline") {
        el.className = "persist-ul";
        el.style.left = left + "px";
        el.style.top = top + "px";
        el.style.width = width + "px";
        el.style.height = height + "px";
        el.style.borderBottomWidth = "3px";
        el.style.borderBottomColor = record.color;
      } else {
        el.className = "persist-hl";
        el.style.left = left + "px";
        el.style.top = top + "px";
        el.style.width = width + "px";
        el.style.height = height + "px";
        el.style.background = record.color;
      }
      el.title = "Chạm để xóa đánh dấu này";
      el.addEventListener("click", () => deleteHighlight(slot, record.id));
      pe.highlightLayer.appendChild(el);
    });
  });
}

function deleteHighlight(slot, id) {
  const pane = state.panes[slot];
  if (!confirm("Xóa đánh dấu này?")) return;
  Object.keys(pane.highlightsByPage || {}).forEach((p) => {
    pane.highlightsByPage[p] = (pane.highlightsByPage[p] || []).filter((r) => r.id !== id);
  });
  renderHighlightOverlay(slot);
  persistHighlights(pane).catch((e) => console.warn("Xóa highlight lỗi:", e));
}

// ---------- Bảng "Add" — kéo thả tự do ----------
function openAddPanel() {
  if (!state.activeRange || !state.activeText) return;
  els.addTextOriginal.textContent = state.activeText;
  els.addVocab.value = "";
  els.addGrammar.value = "";
  els.addNote.value = "";
  els.addTranslation.value = "";
  els.addStatus.textContent = "";

  const rect = state.activeRange.getBoundingClientRect();
  const panelW = 340;
  let left = Math.min(Math.max(8, rect.left), window.innerWidth - panelW - 8);
  let top = Math.min(rect.bottom + 10, window.innerHeight - 200);
  els.addPanel.style.left = left + "px";
  els.addPanel.style.top = Math.max(8, top) + "px";

  hideHlToolbar();
  els.addPanel.classList.remove("hidden");
}

function closeAddPanel() { els.addPanel.classList.add("hidden"); }

function bindAddPanel() {
  $("#btnCloseAddPanel").addEventListener("click", closeAddPanel);
  $("#btnAddCancel").addEventListener("click", closeAddPanel);
  $("#btnAddSubmit").addEventListener("click", submitAddNote);

  // Kéo thả tự do (2 chiều) bằng pointer events
  let dragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;
  els.addPanelHandle.addEventListener("pointerdown", (e) => {
    dragging = true;
    startX = e.clientX; startY = e.clientY;
    const r = els.addPanel.getBoundingClientRect();
    startLeft = r.left; startTop = r.top;
    els.addPanelHandle.setPointerCapture(e.pointerId);
  });
  els.addPanelHandle.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    const w = els.addPanel.offsetWidth, h = els.addPanel.offsetHeight;
    let left = Math.min(Math.max(4, startLeft + dx), window.innerWidth - w - 4);
    let top = Math.min(Math.max(4, startTop + dy), window.innerHeight - h - 4);
    els.addPanel.style.left = left + "px";
    els.addPanel.style.top = top + "px";
  });
  ["pointerup", "pointercancel"].forEach((ev) =>
    els.addPanelHandle.addEventListener(ev, () => (dragging = false))
  );
}

async function submitAddNote() {
  const cfg = await GH.getConfig();
  if (!cfg || !cfg.owner || !cfg.repo || !cfg.token) {
    els.addStatus.textContent = "Chưa cấu hình GitHub — mở ☁ ở góc trên để cấu hình trước.";
    return;
  }

  const pane = state.panes[state.activeSlot] || {};
  const note = {
    id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    text: state.activeText,
    vocab: els.addVocab.value.trim(),
    grammar: els.addGrammar.value.trim(),
    note: els.addNote.value.trim(),
    translation: els.addTranslation.value.trim(),
    source: pane.name || null,
    slot: state.activeSlot,
    page: state.activePage,
    createdAt: new Date().toISOString(),
    synced: false,
  };

  await Store.saveNote(note);

  els.addStatus.textContent = "Đang đẩy lên GitHub…";
  $("#btnAddSubmit").disabled = true;
  try {
    await GH.appendNoteToRepo(cfg, cfg.notesPath || "data/notes.json", note);
    note.synced = true;
    await Store.saveNote(note);
    try {
      wrapRangeNodes(state.activeRange, () => {
        const el = document.createElement("span");
        el.className = "added";
        return el;
      });
    } catch (e) { /* range có thể đã đổi trang, bỏ qua phần đánh dấu trực quan */ }
    window.getSelection().removeAllRanges();
    els.addStatus.textContent = "Đã thêm ✓";
    setTimeout(closeAddPanel, 700);
  } catch (e) {
    els.addStatus.textContent = `Lưu máy rồi nhưng đẩy GitHub lỗi: ${e.message}. Bấm "Thêm" để thử lại.`;
  } finally {
    $("#btnAddSubmit").disabled = false;
  }
}

// ---------- Cấu hình GitHub ----------
function updateGhStatus(connected) {
  els.btnGithubStatus.dataset.connected = connected ? "true" : "false";
}

function bindGithubConfig() {
  els.btnGithubStatus.addEventListener("click", openGithubConfig);
  $("#btnCloseGhConfig").addEventListener("click", closeGithubConfig);
  $("#btnCancelGhConfig").addEventListener("click", closeGithubConfig);
  els.githubOverlay.addEventListener("click", closeGithubConfig);
  $("#btnSaveGhConfig").addEventListener("click", async () => {
    const cfg = {
      owner: $("#cfgOwner").value.trim(),
      repo: $("#cfgRepo").value.trim(),
      dataPrefix: $("#cfgPrefix").value.trim(),
      notesPath: $("#cfgNotesPath").value.trim() || "data/notes.json",
      booksPath: $("#cfgBooksPath").value.trim() || "data",
      pdfPrefix: $("#cfgPdfPath").value.trim() || "pdf",
      highlightsPrefix: $("#cfgHlPath").value.trim() || "highlights",
      branch: $("#cfgBranch").value.trim() || "main",
      token: $("#cfgToken").value.trim(),
    };
    if (!cfg.owner || !cfg.repo || !cfg.token) {
      alert("Cần nhập ít nhất username, tên repo và token.");
      return;
    }
    await Store.saveConfig(cfg);
    updateGhStatus(true);
    closeGithubConfig();
  });
}

async function openGithubConfig() {
  const cfg = (await Store.getConfig()) || {};
  $("#cfgOwner").value = cfg.owner || "";
  $("#cfgRepo").value = cfg.repo || "";
  $("#cfgPrefix").value = cfg.dataPrefix || "";
  $("#cfgNotesPath").value = cfg.notesPath || "data/notes.json";
  $("#cfgBooksPath").value = cfg.booksPath || "data";
  $("#cfgPdfPath").value = cfg.pdfPrefix || "pdf";
  $("#cfgHlPath").value = cfg.highlightsPrefix || "highlights";
  $("#cfgBranch").value = cfg.branch || "main";
  $("#cfgToken").value = cfg.token || "";
  els.githubOverlay.classList.remove("hidden");
  els.githubConfigPanel.classList.remove("hidden");
}
function closeGithubConfig() {
  els.githubOverlay.classList.add("hidden");
  els.githubConfigPanel.classList.add("hidden");
}

document.addEventListener("DOMContentLoaded", init);
