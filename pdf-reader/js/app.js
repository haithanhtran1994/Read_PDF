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

// Ghi chú: pdf.js từ bản 4.x trở đi CHỈ phát hành dạng ES module (.mjs), không còn bản
// <script> toàn cục cũ. Nên pdf.js được nạp bằng <script type="module"> ở index.html
// (gán ra window.pdfjsLib), và dòng cấu hình workerSrc dưới đây được dời vào init()
// (chạy sau khi trang đã parse xong, chắc chắn window.pdfjsLib đã sẵn sàng) thay vì
// chạy ngay khi app.js được nạp như trước.

const state = {
  layout: "horizontal",
  splitRatio: null, // % chiều rộng/cao dành cho paneA, null = mặc định 50/50
  panesSwapped: false, // đổi vị trí hiển thị 2 cột (không đổi bố cục ngang/dọc)
  readingProgress: {}, // { [pdfId]: {name, page, numPages, source, updatedAt} } — trang đang đọc dở của từng file PDF
  panes: {
    A: {
      name: null, pdfDoc: null, pageNum: 1, numPages: 0, scale: null,
      source: null,           // { type: "device", size } | { type: "github", path }
      pdfId: null,            // định danh ổn định để lưu/đọc highlight
      viewport: null,         // viewport pdf.js của lần render gần nhất (dùng để đổi tọa độ)
      highlightsByPage: {},   // { [pageNum]: [ {id, page, mode, color, quads, createdAt} ] }
      search: { query: "", matches: [], index: -1 }, // tìm kiếm trong TRANG hiện tại (không lưu lại)
    },
  },
  pdfBrowse: { stack: [] }, // ngăn xếp thư mục đang duyệt khi mở PDF từ GitHub
  activeRange: null,
  activeText: "",
  activeSlot: null,
  activePage: null,
  hlMode: "highlight",
  hlColor: "#F7E27A",
  jsonHlColor: "#F7E27A",
  jsonMarksByBook: {}, // { [book]: [ {id, chapter, page, field, start, end, type, color} ] }
  dragging: null,
  json: {
    book: null,
    chapter: null,
    raw: null,        // toàn bộ object JSON gốc (giữ nguyên field khác ngoài "pages")
    pages: [],       // mảng page object đã sort theo số trang
    pageIdx: 0,       // vị trí hiện tại trong mảng pages (0-based)
    mode: "summary", // "summary" | "translation" | "analysis" | "all"
    activeField: null,  // "summary" | "translation" — vùng vừa bôi đen để Highlight/Gạch chân
    activeRange: null,
    editing: false,
  },
  tocBook: null, // book đang chọn dở trong drawer mục lục
};

const JSON_MODE_CYCLE = ["summary", "translation", "analysis", "all"];
const JSON_MODE_LABEL = { summary: "Tóm tắt", translation: "Dịch", analysis: "Phân tích", all: "Cả ba" };

const $ = (sel) => document.querySelector(sel);

const els = {
  splitContainer: $("#splitContainer"),
  paneResizer: $("#paneResizer"),
  btnLayout: $("#btnLayout"),
  btnSwapPanes: $("#btnSwapPanes"),
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
  if (!window.pdfjsLib) {
    // Script module nạp pdf.js chưa xong kịp (hiếm khi xảy ra vì module luôn chạy
    // trước DOMContentLoaded, nhưng phòng hờ) — đợi tối đa vài giây.
    for (let i = 0; i < 50 && !window.pdfjsLib; i++) await new Promise((r) => setTimeout(r, 100));
  }
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }

  const uiState = await Store.getUiState();
  if (uiState && uiState.layout) setLayout(uiState.layout, false);
  if (uiState && uiState.splitRatio) applySplitRatio(uiState.splitRatio);
  if (uiState && uiState.panesSwapped) setPanesSwapped(true, false);
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
  bindSearchBar("A");
  bindPdfOutline();
  const speakBtn = $("#btnSpeakA");
  // Bấm vào nút Đọc thường làm trình duyệt HỦY vùng bôi đen đang chọn (vì mousedown/touchstart
  // chuyển focus sang nút) -> lúc click chạy thì window.getSelection() đã rỗng, tưởng nhầm là
  // "không chọn gì" nên đọc nhầm cả trang / đoạn khác. Chặn hành vi mặc định đó để giữ nguyên
  // vùng đang bôi đen cho tới khi đọc xong việc kiểm tra trong toggleSpeak().
  speakBtn.addEventListener("mousedown", (e) => e.preventDefault());
  speakBtn.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
  speakBtn.addEventListener("click", () => toggleSpeak("A"));

  // Tải tiến độ đọc (trang đang đọc dở của từng file PDF) TRƯỚC khi mở lại PDF lần trước,
  // để loadPdfIntoPane biết mở đúng trang đã đọc dở thay vì luôn về trang 1.
  await loadReadingProgress();

  // Khôi phục PDF đã mở lần trước (lưu trong IndexedDB), kèm nguồn gốc (device/github)
  // để biết đọc/ghi highlight đúng chỗ.
  const saved = await Store.getPdf("A");
  if (saved && saved.blob) {
    try {
      await openPdfBlob("A", saved.blob, saved.name, saved.source || { type: "device" });
      // An toàn cho lúc khởi động app (đặc biệt PWA standalone trên iOS): layout của
      // .pane-scroll đôi khi CHƯA ổn định xong tại thời điểm render lần đầu này (clientWidth
      // đọc sai/lệch), khiến trang PDF hiển thị sai kích thước (đen xì) cho tới khi có 1 thao
      // tác khác vô tình làm trình duyệt tính lại layout. Đợi chắc chắn đã qua ít nhất 1 khung
      // hình đã layout+paint xong rồi tính lại kích thước 1 lần nữa cho chắc.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => { fitAndRender("A", true).catch(() => {}); });
      });
    } catch (e) { /* bỏ qua nếu lỗi */ }
  }

  els.btnLayout.addEventListener("click", () => {
    setLayout(state.layout === "horizontal" ? "vertical" : "horizontal", true);
  });
  els.btnSwapPanes.addEventListener("click", () => {
    setPanesSwapped(!state.panesSwapped, true);
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
    state.json.mode = uiState.json.mode || "summary";
    setJsonModeButton(state.json.mode);
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
    panesSwapped: state.panesSwapped,
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

// Đổi VỊ TRÍ hiển thị 2 cột cho nhau (cột PDF <-> cột JSON), khác với "Đổi bố cục"
// (chỉ đổi ngang/dọc). Thuần CSS (order), không đụng gì tới ID/logic của từng cột nên
// mọi chức năng khác (tìm kiếm, đọc to, mục lục, ghi chú...) vẫn hoạt động y nguyên.
function setPanesSwapped(swapped, persist) {
  state.panesSwapped = swapped;
  els.splitContainer.classList.toggle("swapped", swapped);
  if (els.btnSwapPanes) els.btnSwapPanes.classList.toggle("active", swapped);
  if (persist) persistJsonUiState();
  setTimeout(() => { if (state.panes.A.pdfDoc) fitAndRender("A", true); }, 50);
}

// ---------- Thanh công cụ có thể ẩn/hiện (topbar + pane-toolbar) ----------
// Gộp 3 nút ẩn/hiện riêng lẻ (topbar, toolbar cột A, toolbar cột B) thành 1 nút
// duy nhất trên thanh mode-toggle: bấm 1 lần ẩn/hiện CẢ 3 cùng lúc.
function bindCollapsibleBars() {
  $("#btnToggleAllBars").addEventListener("click", () => {
    const allCollapsed = $("#topbar").classList.contains("collapsed")
      && $("#toolbarA").classList.contains("collapsed")
      && $("#toolbarB").classList.contains("collapsed");
    // Nếu tất cả đã thu gọn -> mở hết. Ngược lại (còn ít nhất 1 cái đang mở) -> thu gọn hết.
    setAllBarsCollapsed(!allCollapsed);
  });
}

function setAllBarsCollapsed(collapsed) {
  [$("#topbar"), $("#toolbarA"), $("#toolbarB")].forEach((el) => {
    if (el) el.classList.toggle("collapsed", collapsed);
  });
  const btn = $("#btnToggleAllBars");
  if (btn) btn.textContent = collapsed ? "⌄" : "⌃";
  persistJsonUiState();
  requestAnimationFrame(() => { if (state.panes.A.pdfDoc) fitAndRender("A", true); });
}

function getCollapseState() {
  return {
    topbar: $("#topbar").classList.contains("collapsed"),
    toolbarA: $("#toolbarA").classList.contains("collapsed"),
    toolbarB: $("#toolbarB").classList.contains("collapsed"),
  };
}

function applyCollapseState(c) {
  ["topbar", "toolbarA", "toolbarB"].forEach((id) => {
    if (!c[id]) return;
    const el = document.getElementById(id);
    if (el) el.classList.add("collapsed");
  });
  const btn = $("#btnToggleAllBars");
  if (btn) btn.textContent = (c.topbar && c.toolbarA && c.toolbarB) ? "⌄" : "⌃";
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
      // Vuốt ở BÊN NÀO cũng chuyển trang CẢ 2 bên cùng lúc (PDF + JSON), không riêng
      // bên vừa vuốt — khác với cặp nút ‹ › vẫn chỉ chuyển trang đúng bên có nút đó.
      const dir = t.dx < 0 ? "next" : "prev";
      handlePaneNav("A", dir);
      handleJsonNav(dir);
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

// ---------- Tiến độ đọc (trang đang đọc dở của TỪNG file PDF) ----------
// Lưu chung 1 file JSON trên GitHub (mặc định data/reading-progress.json, đổi được qua
// cfg.progressPath) để mở từ điện thoại hay PC đều thấy đúng trang đang đọc dở, không chỉ
// riêng máy đang dùng. Ghi có debounce để khỏi gọi GitHub API liên tục lúc lật trang nhanh.
let progressSaveTimer = null;
const READING_PROGRESS_DEBOUNCE_MS = 900;

function readingProgressRelPath(cfg) {
  return (cfg && cfg.progressPath) || "data/reading-progress.json";
}

function queueSaveReadingProgress(slot) {
  const pane = state.panes[slot];
  if (!pane.pdfDoc || !pane.pdfId) return;
  state.readingProgress[pane.pdfId] = {
    name: pane.name,
    page: pane.pageNum,
    numPages: pane.numPages,
    source: pane.source,
    updatedAt: new Date().toISOString(),
  };
  Store.saveReadingProgress(state.readingProgress).catch(() => {});
  clearTimeout(progressSaveTimer);
  progressSaveTimer = setTimeout(() => {
    persistReadingProgressToGithub().catch((e) => console.warn("Lưu tiến độ đọc lỗi:", e));
  }, READING_PROGRESS_DEBOUNCE_MS);
}

async function persistReadingProgressToGithub() {
  const cfg = await Store.getConfig();
  if (!cfg || !cfg.owner || !cfg.repo || !cfg.token) return;
  await GH.putJSONObject(cfg, readingProgressRelPath(cfg), state.readingProgress, "Cập nhật tiến độ đọc PDF");
}

// Tải tiến độ đọc: ưu tiên bản trên GitHub (nguồn "thật", đọc được từ mọi thiết bị),
// dùng bản cache local khi mất mạng/chưa cấu hình GitHub.
async function loadReadingProgress() {
  let map = (await Store.getReadingProgress().catch(() => null)) || {};
  const cfg = await Store.getConfig();
  if (cfg && cfg.owner && cfg.repo && cfg.token) {
    try {
      const remote = await GH.getJSONObject(cfg, readingProgressRelPath(cfg));
      if (remote && remote.data && typeof remote.data === "object") {
        map = remote.data;
        Store.saveReadingProgress(map).catch(() => {});
      }
    } catch (e) { /* offline hoặc chưa có file — dùng bản local đã có */ }
  }
  state.readingProgress = map;
}

async function loadPdfIntoPane(slot, arrayBuffer, name, source) {
  const pane = state.panes[slot];
  const pe = paneEls(slot);
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdfDoc = await loadingTask.promise;
  pane.pdfDoc = pdfDoc;
  pane.numPages = pdfDoc.numPages;
  pane.scale = null; // sẽ auto-fit
  pane.name = name;
  pane.source = source || { type: "device" };
  pane.pdfId = computePdfId(name, pane.source);
  // Đọc dở tới trang nào lần trước thì mở lại đúng trang đó (nếu file này đã có tiến độ lưu lại)
  const savedProgress = state.readingProgress[pane.pdfId];
  const savedPage = savedProgress && Number.isFinite(savedProgress.page) ? savedProgress.page : 1;
  pane.pageNum = Math.min(Math.max(1, savedPage), pane.numPages);
  pane.highlightsByPage = {};
  pane.outline = undefined; // chưa biết có mục lục hay không, đang tải
  pe.title.textContent = name;
  pe.empty.classList.add("hidden");
  await fitAndRender(slot, true);
  loadHighlightsForPane(slot).catch(() => {});
  loadPdfOutline(slot).catch(() => { pane.outline = null; });
}

// ---------- Mục lục PDF (outline/bookmark nhúng sẵn trong file) ----------
async function loadPdfOutline(slot) {
  const pane = state.panes[slot];
  if (!pane.pdfDoc) return;
  try {
    const outline = await pane.pdfDoc.getOutline();
    pane.outline = (outline && outline.length) ? outline : null;
  } catch (e) {
    pane.outline = null;
  }
}

function bindPdfOutline() {
  $("#btnOutlineA").addEventListener("click", () => openPdfOutline("A"));
  $("#btnCloseOutline").addEventListener("click", closePdfOutline);
  $("#outlineOverlay").addEventListener("click", closePdfOutline);
}

function closePdfOutline() {
  $("#outlineOverlay").classList.add("hidden");
  $("#outlinePanel").classList.add("hidden");
}

async function openPdfOutline(slot) {
  const pane = state.panes[slot];
  const listEl = $("#outlineList");
  const statusEl = $("#outlineStatus");
  listEl.innerHTML = "";
  statusEl.textContent = "";
  $("#outlineOverlay").classList.remove("hidden");
  $("#outlinePanel").classList.remove("hidden");

  if (!pane.pdfDoc) { statusEl.textContent = "Chưa mở PDF nào ở cột này."; return; }
  if (pane.outline === undefined) {
    statusEl.textContent = "Đang tải mục lục…";
    await loadPdfOutline(slot);
  }
  if (!pane.outline) {
    statusEl.textContent = "PDF này không có mục lục nhúng sẵn (không phải file PDF nào cũng có).";
    return;
  }
  statusEl.textContent = "";
  renderOutlineList(listEl, pane.outline, slot, 0);
}

function renderOutlineList(container, items, slot, depth) {
  items.forEach((item) => {
    const btn = document.createElement("button");
    btn.className = "toc-item outline-item";
    btn.style.paddingLeft = (12 + depth * 16) + "px";
    btn.textContent = item.title ? item.title.trim() : "(không có tiêu đề)";
    btn.addEventListener("click", () => jumpToOutlineItem(slot, item));
    container.appendChild(btn);
    if (item.items && item.items.length) {
      renderOutlineList(container, item.items, slot, depth + 1);
    }
  });
}

async function jumpToOutlineItem(slot, item) {
  const pane = state.panes[slot];
  const statusEl = $("#outlineStatus");
  if (!pane.pdfDoc || !item.dest) return;
  try {
    let dest = item.dest;
    if (typeof dest === "string") dest = await pane.pdfDoc.getDestination(dest);
    if (!dest || !dest.length) return;
    const ref = dest[0];
    const pageIndex = (typeof ref === "object" && ref !== null)
      ? await pane.pdfDoc.getPageIndex(ref)
      : ref; // vài PDF cũ dùng số trang trực tiếp thay vì object ref
    pane.pageNum = pageIndex + 1;
    closePdfOutline();
    await fitAndRender(slot, true);
  } catch (e) {
    if (statusEl) statusEl.textContent = `Không nhảy được tới mục này: ${e.message}`;
  }
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
  pane.lastTextContent = textContent; // dùng lại khi tìm kiếm trong trang, khỏi getTextContent lại
  // pdf.js >= 4.x đã bỏ hàm renderTextLayer() cũ, thay bằng class TextLayer.
  const textLayerObj = new pdfjsLib.TextLayer({
    textContentSource: textContent,
    container: pe.textLayer,
    viewport,
  });
  await textLayerObj.render();

  if (pe.highlightLayer) {
    pe.highlightLayer.style.width = viewport.width + "px";
    pe.highlightLayer.style.height = viewport.height + "px";
    renderHighlightOverlay(slot);
  }

  // Đổi trang / zoom lại thì kết quả tìm kiếm cũ (nếu có) không còn khớp DOM nữa — reset.
  resetSearch(slot);

  pe.pageInd.textContent = `${pane.pageNum}/${pane.numPages}`;
  queueSaveReadingProgress(slot);
}

function handlePaneNav(slot, act) {
  const pane = state.panes[slot];
  if (!pane.pdfDoc) return;
  if (act === "prev" && pane.pageNum > 1) { pane.pageNum--; fitAndRender(slot, false); }
  if (act === "next" && pane.pageNum < pane.numPages) { pane.pageNum++; fitAndRender(slot, false); }
  if (act === "zoomIn") { pane.scale = Math.min(4, (pane.scale || 1) + 0.15); fitAndRender(slot, false); }
  if (act === "zoomOut") { pane.scale = Math.max(0.3, (pane.scale || 1) - 0.15); fitAndRender(slot, false); }
}

// ---------- Tìm kiếm trong TRANG hiện tại (Pane A) ----------
// Bọc lại textLayer sạch (chưa có <mark> tìm kiếm nào) từ cache textContent + viewport
// của lần render gần nhất, khỏi phải getPage/getTextContent lại từ PDF.
async function rebuildTextLayerOnly(slot) {
  const pane = state.panes[slot];
  const pe = paneEls(slot);
  if (!pane.viewport || !pane.lastTextContent) return;
  pe.textLayer.innerHTML = "";
  pe.textLayer.style.setProperty("--scale-factor", pane.scale);
  const textLayerObj = new pdfjsLib.TextLayer({
    textContentSource: pane.lastTextContent,
    container: pe.textLayer,
    viewport: pane.viewport,
  });
  await textLayerObj.render();
}

function bindSearchBar(slot) {
  const bar = $(`#searchBar${slot}`);
  const input = $(`#searchInput${slot}`);
  $(`#btnSearchToggle${slot}`).addEventListener("click", () => {
    const willOpen = bar.classList.contains("hidden");
    bar.classList.toggle("hidden");
    if (willOpen) { input.focus(); if (input.value.trim()) runSearch(slot); }
    else closeSearch(slot);
  });
  $(`#btnSearchClose${slot}`).addEventListener("click", () => { bar.classList.add("hidden"); closeSearch(slot); });
  $(`#btnSearchPrev${slot}`).addEventListener("click", () => stepSearch(slot, -1));
  $(`#btnSearchNext${slot}`).addEventListener("click", () => stepSearch(slot, 1));
  let debounceTimer = null;
  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runSearch(slot), 250);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); stepSearch(slot, e.shiftKey ? -1 : 1); }
    if (e.key === "Escape") { bar.classList.add("hidden"); closeSearch(slot); }
  });
}

async function runSearch(slot) {
  const pane = state.panes[slot];
  const input = $(`#searchInput${slot}`);
  const query = input.value.trim();
  await rebuildTextLayerOnly(slot); // luôn bắt đầu từ textLayer sạch trước khi đánh dấu lại
  pane.search = { query, matches: [], index: -1 };
  if (!query) { updateSearchCount(slot); return; }
  const pe = paneEls(slot);
  const ql = query.toLowerCase();
  const spans = Array.from(pe.textLayer.querySelectorAll("span"));
  const allMatches = [];
  spans.forEach((span) => {
    const node0 = span.firstChild;
    if (!node0 || node0.nodeType !== 3) return;
    const text = node0.nodeValue;
    const lower = text.toLowerCase();
    const positions = [];
    let idx = 0;
    while (true) {
      const found = lower.indexOf(ql, idx);
      if (found === -1) break;
      positions.push(found);
      idx = found + ql.length;
    }
    if (!positions.length) return;
    const spanWrappers = [];
    // Bọc từ phải sang trái trong span để offset các match còn lại không bị lệch sau khi tách text node
    for (let i = positions.length - 1; i >= 0; i--) {
      const start = positions[i];
      const end = start + query.length;
      const node = span.firstChild;
      if (!node || node.nodeType !== 3) continue;
      const range = document.createRange();
      try { range.setStart(node, start); range.setEnd(node, end); } catch (e) { continue; }
      const wrappers = [];
      wrapRangeNodes(range, () => {
        const m = document.createElement("mark");
        m.className = "search-hit";
        return m;
      }, wrappers);
      if (wrappers[0]) spanWrappers.unshift(wrappers[0]);
    }
    allMatches.push(...spanWrappers);
  });
  pane.search.matches = allMatches;
  pane.search.index = allMatches.length ? 0 : -1;
  updateSearchCount(slot);
  if (allMatches.length) focusSearchMatch(slot);
}

function stepSearch(slot, dir) {
  const pane = state.panes[slot];
  const n = pane.search.matches.length;
  if (!n) return;
  pane.search.index = (pane.search.index + dir + n) % n;
  focusSearchMatch(slot);
}

function focusSearchMatch(slot) {
  const pane = state.panes[slot];
  pane.search.matches.forEach((el) => el.classList.remove("active"));
  const el = pane.search.matches[pane.search.index];
  if (el) {
    el.classList.add("active");
    scrollMatchIntoView(slot, el);
  }
  updateSearchCount(slot);
}

// pdf.js chèn thêm 1 div nội bộ ("endOfContent") cao hơn nhiều so với khung trang thật
// vào bên trong .textLayer, để hỗ trợ kéo-chọn mượt khi rê chuột qua cuối trang. Việc này
// khiến .textLayer (dù overflow:hidden) vẫn được trình duyệt coi là "cuộn được" bên trong nó
// (scrollHeight > clientHeight). Nếu gọi thẳng el.scrollIntoView() trên 1 <mark> nằm trong đó,
// trình duyệt có thể tự cuộn luôn scrollTop của chính .textLayer để "canh giữa" — trong khi
// canvas (ảnh PDF) là phần tử anh em, KHÔNG nằm trong .textLayer nên không cuộn theo, làm lớp
// text bị lệch hẳn so với ảnh bên dưới (và lệch này còn tồn tại cho các thao tác bôi/chọn sau
// đó, tới khi trang được render lại). Nên tự tính toạ độ và chỉ cuộn khung ngoài (pe.scroll),
// đồng thời ép textLayer/highlightLayer về scrollTop 0 cho chắc.
function scrollMatchIntoView(slot, el) {
  const pe = paneEls(slot);
  const scroller = pe.scroll;
  if (scroller) {
    const elRect = el.getBoundingClientRect();
    const scRect = scroller.getBoundingClientRect();
    const elTopInScroller = (elRect.top - scRect.top) + scroller.scrollTop;
    const elCenterInScroller = elTopInScroller + elRect.height / 2;
    const target = elCenterInScroller - scroller.clientHeight / 2;
    scroller.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  }
  if (pe.textLayer) pe.textLayer.scrollTop = 0;
  if (pe.highlightLayer) pe.highlightLayer.scrollTop = 0;
}

function updateSearchCount(slot) {
  const pane = state.panes[slot];
  const n = pane.search.matches.length;
  $(`#searchCount${slot}`).textContent = n ? `${pane.search.index + 1}/${n}` : "0/0";
}

function closeSearch(slot) {
  rebuildTextLayerOnly(slot); // xóa hết <mark> tìm kiếm, trả textLayer về sạch
  state.panes[slot].search = { query: "", matches: [], index: -1 };
  updateSearchCount(slot);
}

function resetSearch(slot) {
  const pane = state.panes[slot];
  pane.search = { query: "", matches: [], index: -1 };
  const countEl = document.getElementById(`searchCount${slot}`);
  if (countEl) countEl.textContent = "0/0";
}

// ---------- Đọc to văn bản (chọn đoạn thì đọc đoạn đó, không thì đọc cả trang) ----------
function detectSpeechLang(text) {
  // Có ký tự Hiragana/Katakana/Kanji -> đọc tiếng Nhật, không thì mặc định tiếng Anh
  return /[\u3040-\u30ff\u3400-\u9fff]/.test(text) ? "ja-JP" : "en-US";
}

function toggleSpeak(slot) {
  const btn = $(`#btnSpeak${slot}`);
  if (!("speechSynthesis" in window)) {
    alert("Trình duyệt này không hỗ trợ đọc văn bản (Web Speech API).");
    return;
  }
  if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
    window.speechSynthesis.cancel();
    btn.textContent = "🔊";
    return;
  }
  const pe = paneEls(slot);
  let text = "";
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed && sel.toString().trim() && pe.textLayer.contains(sel.anchorNode)) {
    text = sel.toString();
  } else {
    text = pe.textLayer.textContent || "";
  }
  text = text.trim();
  if (!text) { alert("Không có văn bản để đọc — mở 1 trang PDF trước đã."); return; }
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = detectSpeechLang(text);
  utter.rate = 0.95;
  utter.onend = () => { btn.textContent = "🔊"; };
  utter.onerror = () => { btn.textContent = "🔊"; };
  btn.textContent = "⏹";
  window.speechSynthesis.speak(utter);
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

  $("#btnModeCycle").addEventListener("click", () => {
    if (blockIfEditing()) return;
    const idx = JSON_MODE_CYCLE.indexOf(state.json.mode);
    state.json.mode = JSON_MODE_CYCLE[(idx + 1) % JSON_MODE_CYCLE.length];
    setJsonModeButton(state.json.mode);
    renderJsonPage();
    persistJsonUiState();
  });

  bindJsonHlToolbar();

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

function setJsonModeButton(mode) {
  const btn = $("#btnModeCycle");
  if (btn) btn.textContent = JSON_MODE_LABEL[mode] || mode;
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
  state.json.activeField = null;
  state.json.activeRange = null;

  await loadJsonMarksForBook(book).catch((e) => console.warn("Tải mark lỗi:", e));

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
  if (mode === "summary" || mode === "all") {
    const hasSummary = page.summary && page.summary.trim();
    const marks = getJsonMarksFor(j.chapter, page.page, "summary");
    html += `<div class="json-section">
      <div class="json-section-title">Tóm tắt</div>
      <div class="translation-text summary-text" data-field="summary">${hasSummary ? buildMarkedHtml(page.summary, marks) : "(chưa có tóm tắt)"}</div>
    </div>`;
  }
  if (mode === "translation" || mode === "all") {
    const hasTranslation = page.translation && page.translation.trim();
    const marks = getJsonMarksFor(j.chapter, page.page, "translation");
    html += `<div class="json-section">
      <div class="json-section-title">Bản dịch</div>
      <div class="translation-text" data-field="translation">${hasTranslation ? buildMarkedHtml(page.translation, marks) : "(chưa có bản dịch)"}</div>
    </div>`;
  }
  if (mode === "analysis" || mode === "all") {
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
  bindJsonMarkClicks();
  $("#scrollB").scrollTop = 0;
}

// ---- Highlight/gạch chân trong Tóm tắt & Bản dịch (không áp dụng cho Phân tích) ----
// Lưu theo book (data/<book>/mark.json trên GitHub), dùng chung cho mọi chương của sách đó.

function getJsonMarksFor(chapter, pageNum, field) {
  const list = state.jsonMarksByBook[state.json.book] || [];
  return list.filter((m) => m.chapter === chapter && m.page === pageNum && m.field === field);
}

// Dựng lại HTML từ text gốc + danh sách mark (start/end tính theo ký tự trong text gốc),
// escape HTML đúng từng đoạn để không bị lỗi hiển thị hay lọt thẻ script.
function buildMarkedHtml(rawText, marks) {
  if (!marks || !marks.length) return escapeHtml(rawText);
  const sorted = marks.slice().sort((a, b) => a.start - b.start);
  let out = "";
  let pos = 0;
  sorted.forEach((m) => {
    const start = Math.max(pos, Math.min(m.start, rawText.length));
    const end = Math.max(start, Math.min(m.end, rawText.length));
    if (start > pos) out += escapeHtml(rawText.slice(pos, start));
    if (end > start) {
      const tag = m.type === "highlight" ? "mark" : "span";
      const cls = m.type === "highlight" ? "hl" : "ul";
      const cssVar = m.type === "highlight" ? "--hl-color" : "--ul-color";
      out += `<${tag} class="${cls}" style="${cssVar}:${escapeHtml(m.color || "")}" data-mark-id="${escapeHtml(m.id)}">${escapeHtml(rawText.slice(start, end))}</${tag}>`;
    }
    pos = end;
  });
  if (pos < rawText.length) out += escapeHtml(rawText.slice(pos));
  return out;
}

function bindJsonMarkClicks() {
  els.jsonContent.querySelectorAll("mark.hl[data-mark-id], span.ul[data-mark-id]").forEach((el) => {
    el.title = "Chạm để xóa đánh dấu này";
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteJsonMark(el.dataset.markId);
    });
  });
}

async function deleteJsonMark(id) {
  if (!confirm("Xóa đánh dấu này?")) return;
  const book = state.json.book;
  const list = state.jsonMarksByBook[book] || [];
  state.jsonMarksByBook[book] = list.filter((m) => m.id !== id);
  renderJsonPage();
  await persistJsonMarks(book).catch((e) => console.warn("Xóa mark lỗi:", e));
}

function getPlainTextOffsetsInContainer(container, range) {
  const preRange = document.createRange();
  preRange.selectNodeContents(container);
  preRange.setEnd(range.startContainer, range.startOffset);
  const start = preRange.toString().length;
  const end = start + range.toString().length;
  return { start, end };
}

function bindJsonHlToolbar() {
  $("#btnJsonHighlight").addEventListener("click", () => applyJsonMark("highlight"));
  $("#btnJsonUnderline").addEventListener("click", () => applyJsonMark("underline"));
  $("#jsonHlSwatches").querySelectorAll(".swatch").forEach((sw) => {
    sw.addEventListener("click", () => {
      state.jsonHlColor = sw.dataset.color;
      $("#jsonHlSwatches").querySelectorAll(".swatch").forEach((s) => s.classList.remove("active"));
      sw.classList.add("active");
    });
  });
}

async function applyJsonMark(mode) {
  const j = state.json;
  const range = j.activeRange;
  const field = j.activeField;
  if (!range || !field) {
    alert("Bôi đen 1 đoạn trong Tóm tắt hoặc Bản dịch trước, rồi bấm Highlight/Gạch chân.");
    return;
  }
  const page = j.pages[j.pageIdx];
  if (!page) return;
  const containerEl = els.jsonContent.querySelector(`.translation-text[data-field="${field}"]`);
  if (!containerEl) return;

  const { start, end } = getPlainTextOffsetsInContainer(containerEl, range);
  if (end <= start) return;

  const color = state.jsonHlColor;
  const wrappers = [];
  const ok = wrapRangeNodes(range, () => {
    const el = document.createElement(mode === "highlight" ? "mark" : "span");
    el.className = mode === "highlight" ? "hl" : "ul";
    el.style.setProperty(mode === "highlight" ? "--hl-color" : "--ul-color", color);
    return el;
  }, wrappers);
  window.getSelection().removeAllRanges();
  j.activeRange = null;
  j.activeField = null;
  if (!ok) { alert("Không đánh dấu được đoạn này."); return; }

  const record = {
    id: `jm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    chapter: j.chapter,
    page: page.page,
    field,
    start, end,
    type: mode,
    color,
    createdAt: new Date().toISOString(),
  };
  if (!state.jsonMarksByBook[j.book]) state.jsonMarksByBook[j.book] = [];
  state.jsonMarksByBook[j.book].push(record);
  wrappers.forEach((el) => el.dataset.markId = record.id);
  bindJsonMarkClicks();
  await persistJsonMarks(j.book).catch((e) => console.warn("Lưu mark lỗi:", e));
}

function markRelPath(cfg, book) {
  const booksPath = cfg.booksPath || "data";
  return `${booksPath}/${book}/mark.json`;
}

async function persistJsonMarks(book) {
  const items = state.jsonMarksByBook[book] || [];
  await Store.saveMarkList(book, items).catch(() => {});
  const cfg = await Store.getConfig();
  if (cfg && cfg.owner && cfg.repo && cfg.token) {
    await GH.putJSONArray(cfg, markRelPath(cfg, book), items, `Cập nhật highlight/gạch chân ${book}`);
  }
}

async function loadJsonMarksForBook(book) {
  let items = (await Store.getMarkList(book).catch(() => null)) || [];
  const cfg = await Store.getConfig();
  if (cfg && cfg.owner && cfg.repo && cfg.token) {
    try {
      const remote = await GH.getJSONArray(cfg, markRelPath(cfg, book));
      if (remote) {
        items = remote.items;
        Store.saveMarkList(book, items).catch(() => {});
      }
    } catch (e) { /* offline hoặc chưa có file — dùng bản local đã có */ }
  }
  state.jsonMarksByBook[book] = items;
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
  if (j.mode === "summary" || j.mode === "all") {
    html += `<div class="json-section">
      <div class="json-section-title">Tóm tắt (đang sửa)</div>
      <textarea class="edit-translation" id="editSummary" rows="5" placeholder="Nội dung tổng quát, ý chính cần hiểu, phần cần tìm hiểu thêm…">${escapeHtml(page.summary || "")}</textarea>
    </div>`;
  }
  if (j.mode === "translation" || j.mode === "all") {
    html += `<div class="json-section">
      <div class="json-section-title">Bản dịch (đang sửa)</div>
      <textarea class="edit-translation" id="editTranslation" rows="6" placeholder="Nhập bản dịch…">${escapeHtml(page.translation || "")}</textarea>
    </div>`;
  }
  if (j.mode === "analysis" || j.mode === "all") {
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
  if (j.mode === "summary" || j.mode === "all") {
    const taSum = $("#editSummary");
    if (taSum) page.summary = taSum.value;
  }
  if (j.mode === "translation" || j.mode === "all") {
    const ta = $("#editTranslation");
    if (ta) page.translation = ta.value;
  }
  if (j.mode === "analysis" || j.mode === "all") {
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

  if (textLayerEl) {
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
    return;
  }
  hideHlToolbar();

  // Chọn text trong cột JSON (Tóm tắt/Bản dịch) — không có toolbar nổi, chỉ ghi nhớ
  // vùng đã chọn để bấm nút Highlight/Gạch chân cố định trên thanh công cụ cột B.
  const fieldEl = anchorEl ? anchorEl.closest(".translation-text[data-field]") : null;
  if (fieldEl && !state.json.editing) {
    state.json.activeField = fieldEl.dataset.field;
    state.json.activeRange = range.cloneRange();
  } else {
    state.json.activeField = null;
    state.json.activeRange = null;
  }
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
