/* shortcuts.js — Bảng phím tắt (chỉ dành cho máy tính có bàn phím: Edge/Chrome trên Windows…).
   - Nút ⌨ trên thanh trên cùng mở bảng: cột trái = tên chức năng, cột phải = ô gán phím.
   - Cấu hình lưu local (IndexedDB) và đồng bộ lên GitHub (mặc định data/shortcuts.json trong
     repo chính, đổi được qua cfg.shortcutsPath) để máy khác mở lên vẫn có đúng phím tắt đó.
   - Mọi phím tắt chỉ GỌI LẠI đúng các hàm/nút đã có sẵn (click nút, handlePaneNav…), không
     thay đổi logic của chức năng nào. Trên màn hình cảm ứng (iPhone/iPad) nút ⌨ bị ẩn bằng
     CSS; bàn phím rời (nếu có) vẫn chạy các phím đã gán.
*/
(function () {
  "use strict";

  // ----- Danh sách chức năng -----
  // run() được gọi khi bấm phím tắt. def = phím mặc định ("" = chưa gán).
  const clickEl = (sel) => () => {
    const el = document.querySelector(sel);
    if (el && !el.disabled) el.click();
  };
  const audioReady = () => { const b = document.getElementById("audioBar"); return b && !b.hidden; };
  const clickAudio = (sel) => () => { if (audioReady()) clickEl(sel)(); };
  const scrollPane = (id, factor, dir) => () => {
    const el = document.getElementById(id);
    if (el) el.scrollBy({ top: dir * el.clientHeight * factor, behavior: "auto" });
  };
  const scrollTo = (id, toEnd) => () => {
    const el = document.getElementById(id);
    if (el) el.scrollTo({ top: toEnd ? el.scrollHeight : 0, behavior: "auto" });
  };
  const closeTopPopup = () => {
    // Đóng popup/panel đang mở (nút "✕" của panel hiện ra sau cùng)
    const open = Array.from(document.querySelectorAll(
      ".gh-panel-modal:not(.hidden), .dict-modal:not(.hidden), .add-panel:not(.hidden), .kanji-panel:not(.hidden)"
    ));
    const panel = open[open.length - 1];
    if (!panel) return;
    const closeBtn = panel.querySelector('[id^="btnClose"]');
    if (closeBtn) closeBtn.click();
  };

  const ACTIONS = [
    // ---- Chuyển trang ----
    { group: "Chuyển trang", id: "navBothPrev", label: "Trang trước — cả PDF và JSON", def: "ArrowLeft",
      run: () => { handlePaneNav("A", "prev"); handleJsonNav("prev"); } },
    { group: "Chuyển trang", id: "navBothNext", label: "Trang sau — cả PDF và JSON", def: "ArrowRight",
      run: () => { handlePaneNav("A", "next"); handleJsonNav("next"); } },
    { group: "Chuyển trang", id: "navPdfPrev", label: "Chỉ PDF: trang trước", def: "", run: () => handlePaneNav("A", "prev") },
    { group: "Chuyển trang", id: "navPdfNext", label: "Chỉ PDF: trang sau", def: "", run: () => handlePaneNav("A", "next") },
    { group: "Chuyển trang", id: "navJsonPrev", label: "Chỉ JSON: trang trước", def: "", run: () => handleJsonNav("prev") },
    { group: "Chuyển trang", id: "navJsonNext", label: "Chỉ JSON: trang sau", def: "", run: () => handleJsonNav("next") },

    // ---- Cuộn (thay con lăn chuột) ----
    { group: "Cuộn trang (thay con lăn)", id: "scrollPdfDown", label: "PDF: cuộn xuống nửa màn hình", def: "", run: scrollPane("scrollA", 0.5, 1) },
    { group: "Cuộn trang (thay con lăn)", id: "scrollPdfUp", label: "PDF: cuộn lên nửa màn hình", def: "", run: scrollPane("scrollA", 0.5, -1) },
    { group: "Cuộn trang (thay con lăn)", id: "scrollPdfTop", label: "PDF: về đầu trang", def: "", run: scrollTo("scrollA", false) },
    { group: "Cuộn trang (thay con lăn)", id: "scrollPdfBottom", label: "PDF: xuống cuối trang", def: "", run: scrollTo("scrollA", true) },
    { group: "Cuộn trang (thay con lăn)", id: "scrollJsonDown", label: "JSON: cuộn xuống nửa màn hình", def: "", run: scrollPane("scrollB", 0.5, 1) },
    { group: "Cuộn trang (thay con lăn)", id: "scrollJsonUp", label: "JSON: cuộn lên nửa màn hình", def: "", run: scrollPane("scrollB", 0.5, -1) },
    { group: "Cuộn trang (thay con lăn)", id: "scrollJsonTop", label: "JSON: về đầu trang", def: "", run: scrollTo("scrollB", false) },
    { group: "Cuộn trang (thay con lăn)", id: "scrollJsonBottom", label: "JSON: xuống cuối trang", def: "", run: scrollTo("scrollB", true) },

    // ---- Bên PDF ----
    { group: "Bên PDF", id: "pdfZoomIn", label: "PDF: phóng to", def: "", run: () => handlePaneNav("A", "zoomIn") },
    { group: "Bên PDF", id: "pdfZoomOut", label: "PDF: thu nhỏ", def: "", run: () => handlePaneNav("A", "zoomOut") },
    { group: "Bên PDF", id: "pdfOpenLocal", label: "Mở PDF từ máy…", def: "", run: clickEl("#fileA") },
    { group: "Bên PDF", id: "pdfOpenGithub", label: "Mở PDF từ GitHub (PDF ☁)", def: "", run: clickEl("#btnOpenPdfGithub") },
    { group: "Bên PDF", id: "pdfSearch", label: "Tìm trong trang PDF (🔍 bật/tắt)", def: "", run: clickEl("#btnSearchToggleA") },
    { group: "Bên PDF", id: "pdfSearchPrev", label: "Kết quả tìm kiếm trước", def: "", run: clickEl("#btnSearchPrevA") },
    { group: "Bên PDF", id: "pdfSearchNext", label: "Kết quả tìm kiếm sau", def: "", run: clickEl("#btnSearchNextA") },
    { group: "Bên PDF", id: "pdfOutline", label: "Mục lục PDF (📑)", def: "", run: clickEl("#btnOutlineA") },
    { group: "Bên PDF", id: "pdfSpeak", label: "Đọc to văn bản (🔊)", def: "", run: clickEl("#btnSpeakA") },
    { group: "Bên PDF", id: "pdfAddTextMode", label: "Bật/tắt chế độ thêm text lên PDF", def: "", run: clickEl("#btnAddTextMode") },
    { group: "Bên PDF", id: "pdfToggleTextBoxes", label: "Ẩn/hiện text đã thêm lên PDF (👁)", def: "", run: clickEl("#btnToggleTextBoxes") },

    // ---- Bên JSON ----
    { group: "Bên JSON", id: "jsonOpenToc", label: "Chọn sách / chương…", def: "", run: clickEl("#btnOpenToc") },
    { group: "Bên JSON", id: "jsonOpenLocal", label: "Mở file JSON từ máy (JSON 📂)", def: "", run: clickEl("#btnOpenJsonLocal") },
    { group: "Bên JSON", id: "jsonModeCycle", label: "Đổi chế độ: Tóm tắt → Dịch → Phân tích → Cả ba", def: "", run: clickEl("#btnModeCycle") },
    { group: "Bên JSON", id: "jsonHighlight", label: "Highlight đoạn đang bôi đen (🖍)", def: "", run: clickEl("#btnJsonHighlight") },
    { group: "Bên JSON", id: "jsonUnderline", label: "Gạch chân đoạn đang bôi đen (U̲)", def: "", run: clickEl("#btnJsonUnderline") },
    { group: "Bên JSON", id: "jsonKanji", label: "Nhận diện Kanji viết tay (✍️)", def: "", run: clickEl("#btnKanjiTool") },
    { group: "Bên JSON", id: "jsonEdit", label: "Sửa nội dung trang này (✎)", def: "", run: clickEl("#btnJsonEdit") },

    // ---- Audio ----
    { group: "Audio", id: "audioPlayPause", label: "Phát / tạm dừng audio", def: "",
      run: () => { if (!audioReady()) return; const a = document.getElementById("jsonAudioEl"); if (a) { a.paused ? a.play().catch(() => {}) : a.pause(); } } },
    { group: "Audio", id: "audioBack5", label: "Audio: lùi 5 giây", def: "", run: clickAudio("#btnAudioBack5") },
    { group: "Audio", id: "audioFwd5", label: "Audio: tiến 5 giây", def: "", run: clickAudio("#btnAudioFwd5") },
    { group: "Audio", id: "audioSpeed", label: "Audio: đổi tốc độ", def: "", run: clickAudio("#btnAudioSpeed") },
    { group: "Audio", id: "audioRepeat", label: "Audio: bật/tắt lặp lại trang", def: "", run: clickAudio("#btnAudioRepeat") },
    { group: "Audio", id: "audioAutoNext", label: "Audio: bật/tắt tự phát trang kế", def: "", run: clickAudio("#btnAudioAutoNext") },

    // ---- Giao diện chung ----
    { group: "Giao diện chung", id: "toggleBars", label: "Ẩn/hiện tất cả thanh công cụ (⌃)", def: "", run: clickEl("#btnToggleAllBars") },
    { group: "Giao diện chung", id: "layout", label: "Đổi bố cục ngang/dọc (⬓)", def: "", run: clickEl("#btnLayout") },
    { group: "Giao diện chung", id: "swapPanes", label: "Đổi chỗ 2 bên PDF ⇄ JSON", def: "", run: clickEl("#btnSwapPanes") },
    { group: "Giao diện chung", id: "dictionary", label: "Mở Từ điển (🔤)", def: "", run: clickEl("#btnOpenDict") },
    { group: "Giao diện chung", id: "importJson", label: "Nhập & đẩy dữ liệu JSON lên GitHub (⇪)", def: "", run: clickEl("#btnImport") },
    { group: "Giao diện chung", id: "githubConfig", label: "Cấu hình GitHub (☁)", def: "", run: clickEl("#btnGithubStatus") },
    { group: "Giao diện chung", id: "closePopup", label: "Đóng popup đang mở", def: "", run: closeTopPopup },
    { group: "Giao diện chung", id: "openShortcuts", label: "Mở bảng phím tắt này", def: "", run: () => openPanel() },
  ];
  const ACTION_BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));

  // ----- Cấu hình hiện hành: { actionId: "Ctrl+K" | "" } — id không có trong map = dùng mặc định -----
  let userMap = {};
  const SHORTCUTS_PATH_DEFAULT = "data/shortcuts.json";

  function keyOf(id) {
    if (Object.prototype.hasOwnProperty.call(userMap, id)) return userMap[id] || "";
    const a = ACTION_BY_ID.get(id);
    return a ? a.def : "";
  }
  function buildComboIndex() {
    const idx = new Map();
    for (const a of ACTIONS) {
      const k = keyOf(a.id);
      if (k && !idx.has(k)) idx.set(k, a);
    }
    return idx;
  }
  let comboIndex = buildComboIndex();

  // ----- Chuẩn hoá tổ hợp phím từ sự kiện -----
  function comboFromEvent(e) {
    const k = e.key;
    if (k === "Control" || k === "Shift" || k === "Alt" || k === "Meta" || k === "Dead" || k === "Process") return null;
    let main;
    if (/^Key[A-Z]$/.test(e.code)) main = e.code.slice(3);
    else if (/^Digit[0-9]$/.test(e.code)) main = e.code.slice(5);
    else if (k === " ") main = "Space";
    else if (k.length === 1) main = k.toUpperCase();
    else main = k; // ArrowLeft, F2, PageDown, Home, Enter, Tab…
    const parts = [];
    if (e.ctrlKey) parts.push("Ctrl");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    if (e.metaKey) parts.push("Meta");
    parts.push(main);
    return parts.join("+");
  }

  // ----- Phím nóng toàn cục -----
  let capturing = false;
  function onKeyDown(e) {
    if (capturing || e.isComposing) return;
    const panel = document.getElementById("shortcutsPanel");
    if (panel && !panel.classList.contains("hidden")) return; // đang mở bảng gán phím
    const combo = comboFromEvent(e);
    if (!combo) return;
    const action = comboIndex.get(combo);
    if (!action) return;

    const hasMod = e.ctrlKey || e.altKey || e.metaKey;
    const el = document.activeElement;
    const tag = el && el.tagName;
    const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el && el.isContentEditable);
    // Đang gõ chữ / đang sửa nội dung: chỉ cho phím có Ctrl/Alt/Meta hoặc F1–F12 chạy,
    // để phím chữ/mũi tên trần vẫn làm đúng việc bình thường của nó.
    const isFn = /^F([1-9]|1[0-2])$/.test(e.key);
    if ((typing || (state.json && state.json.editing)) && !hasMod && !isFn) return;

    e.preventDefault();
    try { action.run(); } catch (err) { console.warn("Phím tắt lỗi:", action.id, err); }
  }

  // ----- Lưu / tải -----
  function cleanMap(m) {
    const out = {};
    if (m && typeof m === "object") {
      for (const id of Object.keys(m)) if (ACTION_BY_ID.has(id) && typeof m[id] === "string") out[id] = m[id];
    }
    return out;
  }
  function applyMap(m) {
    userMap = cleanMap(m);
    comboIndex = buildComboIndex();
  }
  function pathOf(cfg) { return (cfg && cfg.shortcutsPath) || SHORTCUTS_PATH_DEFAULT; }

  async function loadShortcuts() {
    const local = await idbGet("state", "shortcuts").catch(() => null);
    if (local && local.keys) applyMap(local.keys);
    try {
      const cfg = await Store.getConfig();
      if (cfg && cfg.owner && cfg.repo && cfg.token) {
        const remote = await GH.getJSONObject(cfg, pathOf(cfg));
        if (remote && remote.data && remote.data.keys) {
          applyMap(remote.data.keys);
          idbSet("state", "shortcuts", { keys: userMap }).catch(() => {});
          if (isPanelOpen()) renderRows();
        }
      }
    } catch (e) { /* offline / chưa có file — dùng bản local */ }
  }

  async function saveShortcuts(statusEl) {
    await idbSet("state", "shortcuts", { keys: userMap }).catch(() => {});
    const cfg = await Store.getConfig();
    if (!cfg || !cfg.owner || !cfg.repo || !cfg.token) {
      statusEl.textContent = 'Đã lưu trên máy này. Chưa cấu hình GitHub (☁) nên chưa đồng bộ sang máy khác.';
      return;
    }
    statusEl.textContent = "Đang đẩy lên GitHub…";
    try {
      await GH.putJSONObject(cfg, pathOf(cfg), { version: 1, keys: userMap }, "Cập nhật phím tắt");
      statusEl.textContent = "Đã lưu & đồng bộ GitHub ✓";
    } catch (e) {
      statusEl.textContent = `Đã lưu trên máy, nhưng đẩy GitHub lỗi: ${e.message}`;
    }
  }

  // ----- Giao diện bảng -----
  let panelBuilt = false;
  let editingId = null; // đang chờ bấm phím cho chức năng nào
  let pendingTimer = null;

  function isPanelOpen() {
    const p = document.getElementById("shortcutsPanel");
    return !!p && !p.classList.contains("hidden");
  }

  function buildPanel() {
    if (panelBuilt) return;
    panelBuilt = true;
    const overlay = document.createElement("div");
    overlay.id = "shortcutsOverlay";
    overlay.className = "drawer-overlay hidden";
    const panel = document.createElement("div");
    panel.id = "shortcutsPanel";
    panel.className = "gh-panel gh-panel-modal shortcuts-panel hidden";
    panel.innerHTML = `
      <div class="gh-panel-header">
        <h2>⌨ Bảng phím tắt</h2>
        <button id="btnCloseShortcuts" class="icon-btn" aria-label="Đóng">✕</button>
      </div>
      <p class="sc-hint">Bấm vào ô bên phải rồi nhấn tổ hợp phím muốn gán (Esc = huỷ, Backspace/Delete = xoá phím). Phím trùng sẽ được chuyển sang chức năng vừa gán.</p>
      <div id="shortcutsRows" class="sc-rows"></div>
      <div class="edit-actions">
        <button id="btnSaveShortcuts" class="btn-save">Lưu & đồng bộ GitHub</button>
        <button id="btnResetShortcuts" class="btn-cancel">Mặc định</button>
        <button id="btnCancelShortcuts" class="btn-cancel">Đóng</button>
      </div>
      <div id="shortcutsStatus" class="sc-status"></div>`;
    document.body.appendChild(overlay);
    document.body.appendChild(panel);

    overlay.addEventListener("click", closePanel);
    panel.querySelector("#btnCloseShortcuts").addEventListener("click", closePanel);
    panel.querySelector("#btnCancelShortcuts").addEventListener("click", closePanel);
    panel.querySelector("#btnSaveShortcuts").addEventListener("click", () => saveShortcuts(panel.querySelector("#shortcutsStatus")));
    panel.querySelector("#btnResetShortcuts").addEventListener("click", () => {
      applyMap({});
      // Lưu rõ ràng "đã đặt lại" — mảng rỗng nghĩa là tất cả về mặc định
      renderRows();
      panel.querySelector("#shortcutsStatus").textContent = 'Đã về phím mặc định — bấm "Lưu & đồng bộ GitHub" để áp dụng cho các máy khác.';
    });

    // Bắt phím khi đang gán (capture phase để chặn các handler khác)
    document.addEventListener("keydown", (e) => {
      if (!editingId || !isPanelOpen()) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") { stopEditing(); return; }
      let combo;
      if (e.key === "Backspace" || e.key === "Delete") combo = "";
      else { combo = comboFromEvent(e); if (combo === null) return; }
      assign(editingId, combo);
      stopEditing();
    }, true);
  }

  function assign(id, combo) {
    const st = document.getElementById("shortcutsStatus");
    let note = "";
    if (combo) {
      for (const a of ACTIONS) {
        if (a.id !== id && keyOf(a.id) === combo) {
          userMap[a.id] = ""; // gỡ khỏi chức năng cũ
          note = ` (đã gỡ khỏi “${a.label}”)`;
        }
      }
    }
    userMap[id] = combo;
    comboIndex = buildComboIndex();
    renderRows();
    if (st) st.textContent = `Đã gán${note} — nhớ bấm “Lưu & đồng bộ GitHub”.`;
  }

  function stopEditing() {
    editingId = null;
    capturing = false;
    renderRows();
  }

  function renderRows() {
    const box = document.getElementById("shortcutsRows");
    if (!box) return;
    let html = "";
    let lastGroup = null;
    for (const a of ACTIONS) {
      if (a.group !== lastGroup) {
        html += `<div class="sc-group">${a.group}</div>`;
        lastGroup = a.group;
      }
      const k = keyOf(a.id);
      const isEd = editingId === a.id;
      html += `<div class="sc-row">
        <span class="sc-label">${a.label}</span>
        <button type="button" class="sc-key${isEd ? " editing" : ""}${k ? "" : " empty"}" data-id="${a.id}">${isEd ? "Nhấn phím…" : (k || "— chưa gán —")}</button>
      </div>`;
    }
    box.innerHTML = html;
    box.querySelectorAll(".sc-key").forEach((b) => {
      b.addEventListener("click", () => {
        editingId = b.dataset.id;
        capturing = true;
        renderRows();
      });
    });
  }

  function openPanel() {
    buildPanel();
    editingId = null; capturing = false;
    document.getElementById("shortcutsStatus").textContent = "";
    renderRows();
    document.getElementById("shortcutsOverlay").classList.remove("hidden");
    document.getElementById("shortcutsPanel").classList.remove("hidden");
  }
  function closePanel() {
    editingId = null; capturing = false;
    const o = document.getElementById("shortcutsOverlay");
    const p = document.getElementById("shortcutsPanel");
    if (o) o.classList.add("hidden");
    if (p) p.classList.add("hidden");
  }

  function init() {
    const btn = document.getElementById("btnShortcuts");
    if (btn) btn.addEventListener("click", openPanel);
    document.addEventListener("keydown", onKeyDown);
    loadShortcuts();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
