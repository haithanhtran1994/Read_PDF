/* js/kanji.js — Popup nhận diện Kanji viết tay, nổi trên PDF + JSON, kéo thả tự do +
   đổi kích thước được. Mở/đóng bằng nút "✍️" trên thanh công cụ Pane A (xem index.html).

   - Vẽ nét trên canvas. Sau khi dừng tay ~700ms (không vẽ nét mới), TỰ ĐỘNG gọi API nhận
     diện của Google Input Tools (giữ nguyên logic từ file kanji-recognizer.html gốc) —
     không cần bấm nút "Nhận diện" nữa. Có nút "⟳" nhỏ trên thanh tiêu đề để nhận diện lại
     thủ công nếu cần (ví dụ lỗi mạng).
   - Bấm vào 1 kết quả nhận diện: ghép ký tự/cụm từ đó vào "Chuỗi đã ghép" và dọn canvas để
     vẽ chữ tiếp theo ngay (giữ nguyên hành vi của bản gốc).
   - "🔍 Tra cứu": tra chuỗi đã ghép trong TOÀN BỘ dữ liệu sách đang có trên GitHub (gom
     grammar + analysis của mọi book/chapter, giống cách app từ điển riêng làm), có cache
     lại trên máy (IndexedDB, xem js/db.js) để tra nhanh lần sau, và nút "↻ Làm mới" để quét
     lại khi dữ liệu sách đã đổi.
   - "＋ Thêm từ": mở 1 popup để nhập phần "Giải thích", còn "Từ vựng" lấy thẳng từ chuỗi đã
     ghép (khỏi gõ lại). Bấm "Thêm" sẽ chèn { type: "vocab", phrase, explain } vào ĐÚNG trang
     đang mở ở cột JSON bên phải (state.json.pageIdx) rồi đẩy cả file chương đó lên GitHub,
     y hệt cách "✎ Sửa nội dung trang" đang làm (js/app.js: saveJsonEdits). Bấm "Hủy" thì
     không đụng gì tới dữ liệu.

   Ghi chú: file này nạp SAU js/db.js, js/github.js, js/app.js (script thường, không phải
   module) nên dùng chung được các biến/hàm top-level của chúng: Store, GH, state, $,
   escapeHtml, renderJsonPage, ANALYSIS_LABEL... mà không cần import gì thêm.
*/

const kanjiState = {
  strokes: [],        // nét đã vẽ xong: [{x:[],y:[]}]
  currentStroke: null,
  drawing: false,
  composedText: "",
  lastRect: null,      // kích thước canvas (CSS px) lần đo gần nhất, để co giãn nét vẽ khi resize popup
  positioned: false,   // đã đặt vị trí/khích thước mặc định cho popup lần đầu mở chưa
  busy: false,         // đang gọi API nhận diện
};

let kanjiRecognizeTimer = null;
const KANJI_RECOGNIZE_DEBOUNCE_MS = 700;

let kanjiCtx = null;
let kanjiDictCache = null; // mảng entries đã gom, cache trong bộ nhớ (tránh quét lại GitHub nhiều lần trong 1 phiên)

const KANJI_TYPE_LABEL = {
  grammar: "Ngữ pháp", vocab: "Từ vựng", idiom: "Thành ngữ",
  slang: "Slang", collocation: "Collocation", phrase: "Cụm từ",
};

function kanjiNormalize(s) {
  return String(s == null ? "" : s)
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
}

function setKanjiStatus(msg, isError) {
  const el = $("#kanjiStatus");
  if (!el) return;
  el.textContent = msg || "";
  el.classList.toggle("error", !!isError);
}

// ---------- Canvas vẽ nét ----------
function kanjiRedraw() {
  const canvas = $("#kanjiPad");
  const rect = canvas.getBoundingClientRect();
  kanjiCtx.clearRect(0, 0, rect.width, rect.height);
  kanjiCtx.lineJoin = "round";
  kanjiCtx.lineCap = "round";
  kanjiCtx.lineWidth = 6;
  kanjiCtx.strokeStyle = "#1c1c1e";
  const all = kanjiState.strokes.concat(kanjiState.currentStroke ? [kanjiState.currentStroke] : []);
  all.forEach((s) => {
    if (s.x.length < 2) {
      if (s.x.length === 1) {
        kanjiCtx.beginPath();
        kanjiCtx.arc(s.x[0], s.y[0], 3, 0, Math.PI * 2);
        kanjiCtx.fillStyle = "#1c1c1e";
        kanjiCtx.fill();
      }
      return;
    }
    kanjiCtx.beginPath();
    kanjiCtx.moveTo(s.x[0], s.y[0]);
    for (let i = 1; i < s.x.length; i++) kanjiCtx.lineTo(s.x[i], s.y[i]);
    kanjiCtx.stroke();
  });
}

// rescale=true: co giãn lại toạ độ các nét đã vẽ theo tỉ lệ kích thước mới/cũ (khi resize popup)
function kanjiResizeCanvas(rescale) {
  const canvas = $("#kanjiPad");
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  if (rescale && kanjiState.lastRect && kanjiState.lastRect.width) {
    const scale = rect.width / kanjiState.lastRect.width;
    if (isFinite(scale) && scale > 0 && scale !== 1) {
      kanjiState.strokes.forEach((s) => {
        s.x = s.x.map((v) => v * scale);
        s.y = s.y.map((v) => v * scale);
      });
      if (kanjiState.currentStroke) {
        kanjiState.currentStroke.x = kanjiState.currentStroke.x.map((v) => v * scale);
        kanjiState.currentStroke.y = kanjiState.currentStroke.y.map((v) => v * scale);
      }
    }
  }
  kanjiState.lastRect = { width: rect.width, height: rect.height };
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  kanjiCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  kanjiRedraw();
}

function kanjiGetPos(evt) {
  const canvas = $("#kanjiPad");
  const rect = canvas.getBoundingClientRect();
  return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
}

function scheduleKanjiAutoRecognize() {
  clearTimeout(kanjiRecognizeTimer);
  kanjiRecognizeTimer = setTimeout(() => { recognizeKanji(); }, KANJI_RECOGNIZE_DEBOUNCE_MS);
}

function bindKanjiCanvas() {
  const canvas = $("#kanjiPad");
  kanjiCtx = canvas.getContext("2d");

  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    clearTimeout(kanjiRecognizeTimer); // đang vẽ tiếp -> hoãn lần nhận diện tự động trước đó
    kanjiState.drawing = true;
    const p = kanjiGetPos(e);
    kanjiState.currentStroke = { x: [p.x], y: [p.y] };
    kanjiRedraw();
    setKanjiStatus("");
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!kanjiState.drawing) return;
    e.preventDefault();
    const p = kanjiGetPos(e);
    kanjiState.currentStroke.x.push(p.x);
    kanjiState.currentStroke.y.push(p.y);
    kanjiRedraw();
  });
  const finishStroke = () => {
    if (!kanjiState.drawing) return;
    kanjiState.drawing = false;
    if (kanjiState.currentStroke) kanjiState.strokes.push(kanjiState.currentStroke);
    kanjiState.currentStroke = null;
    kanjiRedraw();
    if (kanjiState.strokes.length) scheduleKanjiAutoRecognize();
  };
  window.addEventListener("pointerup", finishStroke);
  window.addEventListener("pointercancel", finishStroke);

  $("#btnKanjiUndo").addEventListener("click", () => {
    clearTimeout(kanjiRecognizeTimer);
    kanjiState.strokes.pop();
    kanjiRedraw();
    if (kanjiState.strokes.length) scheduleKanjiAutoRecognize();
  });
  $("#btnKanjiClear").addEventListener("click", () => {
    clearTimeout(kanjiRecognizeTimer);
    kanjiState.strokes = [];
    kanjiState.currentStroke = null;
    $("#kanjiCandidates").innerHTML = "";
    setKanjiStatus("");
    kanjiRedraw();
  });
  $("#btnKanjiRetry").addEventListener("click", () => {
    clearTimeout(kanjiRecognizeTimer);
    recognizeKanji();
  });
}

function renderKanjiCandidates(list) {
  const box = $("#kanjiCandidates");
  box.innerHTML = "";
  list.forEach((ch) => {
    const div = document.createElement("div");
    div.className = "kanji-candidate" + (ch.length > 1 ? " multi" : "");
    div.textContent = ch;
    div.addEventListener("click", () => {
      kanjiState.composedText += ch;
      renderKanjiComposed();
      // dọn canvas để vẽ chữ tiếp theo ngay
      clearTimeout(kanjiRecognizeTimer);
      kanjiState.strokes = [];
      kanjiState.currentStroke = null;
      box.innerHTML = "";
      setKanjiStatus(`Đã thêm "${ch}"`);
      kanjiRedraw();
    });
    box.appendChild(div);
  });
}

async function recognizeKanji() {
  if (kanjiState.busy) return;
  if (!kanjiState.strokes.length) { setKanjiStatus("Chưa có nét nào.", true); return; }
  kanjiState.busy = true;
  setKanjiStatus("Đang nhận diện…");

  const canvas = $("#kanjiPad");
  const rect = canvas.getBoundingClientRect();
  const ink = kanjiState.strokes.map((s) => [
    s.x.map((v) => Math.round(v)),
    s.y.map((v) => Math.round(v)),
    s.x.map(() => 0),
  ]);

  const body = {
    app_version: 0.4,
    api_level: "537.36",
    device: navigator.userAgent,
    input_type: 0,
    options: "enable_pre_space",
    requests: [{
      writing_guide: {
        writing_area_width: Math.round(rect.width),
        writing_area_height: Math.round(rect.height),
      },
      pre_context: "",
      max_num_results: 10,
      max_completions: 0,
      language: "ja",
      ink: ink,
    }],
  };

  try {
    const res = await fetch("https://inputtools.google.com/request?itc=ja-t-i0-handwrit&app=translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    if (data[0] === "SUCCESS" && data[1] && data[1][0] && data[1][0][1]) {
      const results = data[1][0][1];
      if (!results.length) {
        setKanjiStatus("Không tìm thấy chữ khớp.", true);
      } else {
        renderKanjiCandidates(results.slice(0, 10));
        setKanjiStatus(results.length + " kết quả");
      }
    } else {
      setKanjiStatus("Không nhận được kết quả hợp lệ.", true);
    }
  } catch (e) {
    setKanjiStatus("Lỗi kết nối: " + e.message, true);
  } finally {
    kanjiState.busy = false;
  }
}

// ---------- Chuỗi đã ghép ----------
function renderKanjiComposed() {
  $("#kanjiComposed").textContent = kanjiState.composedText;
}

function resetKanjiComposed() {
  kanjiState.composedText = "";
  renderKanjiComposed();
  $("#kanjiLookupBox").classList.add("hidden");
  $("#kanjiLookupResults").innerHTML = "";
}

function bindKanjiComposedActions() {
  $("#btnKanjiComposedUndo").addEventListener("click", () => {
    kanjiState.composedText = [...kanjiState.composedText].slice(0, -1).join("");
    renderKanjiComposed();
  });
  $("#btnKanjiComposedClear").addEventListener("click", resetKanjiComposed);
  $("#btnKanjiCopy").addEventListener("click", async () => {
    if (!kanjiState.composedText) return;
    try {
      await navigator.clipboard.writeText(kanjiState.composedText);
      setKanjiStatus("Đã copy.");
    } catch (e) {
      setKanjiStatus("Không copy được: " + e.message, true);
    }
  });
  $("#btnKanjiLookup").addEventListener("click", handleKanjiLookup);
  $("#btnKanjiLookupRefresh").addEventListener("click", handleKanjiLookupRefresh);
  $("#btnKanjiAddVocab").addEventListener("click", openVocabAddPanel);
}

// ---------- Tra cứu (gom dữ liệu từ toàn bộ data/<book>/<chapter>.json trên GitHub) ----------
function addKanjiDictEntry(merged, type, it, book, chapter, page) {
  if (!it || !it.phrase) return;
  const phrase = String(it.phrase).trim();
  const explain = String(it.explain || "").trim();
  const key = `${type}\u0000${kanjiNormalize(phrase)}\u0000${kanjiNormalize(explain)}`;
  let entry = merged.get(key);
  if (!entry) {
    entry = { key, type, phrase, explain, sources: [] };
    merged.set(key, entry);
  }
  const dup = entry.sources.some((s) => s.book === book && s.chapter === chapter && s.page === page);
  if (!dup) entry.sources.push({ book, chapter, page });
}

async function scanKanjiDictFromGithub(cfg, onProgress) {
  const booksPath = cfg.booksPath || "data";
  const merged = new Map();
  const bookItems = (await GH.listDir(cfg, booksPath)).filter((it) => it.type === "dir");
  for (const bookItem of bookItems) {
    const book = bookItem.name;
    if (onProgress) onProgress(`Đang quét sách "${book}"…`);
    let chapterItems = [];
    try {
      chapterItems = (await GH.listDir(cfg, `${booksPath}/${book}`))
        .filter((it) => it.type === "file" && /\.json$/i.test(it.name));
    } catch (e) { continue; }
    for (const chFile of chapterItems) {
      const chapter = chFile.name.replace(/\.json$/i, "");
      try {
        const res = await GH.getJSONObject(cfg, `${booksPath}/${book}/${chFile.name}`);
        const data = res ? res.data : null;
        const pages = (data && Array.isArray(data.pages)) ? data.pages : [];
        pages.forEach((page) => {
          const pageNum = page.page;
          (page.grammar || []).forEach((it) => addKanjiDictEntry(merged, "grammar", it, book, chapter, pageNum));
          (page.analysis || []).forEach((it) => {
            const type = KANJI_TYPE_LABEL[it.type] ? it.type : "phrase";
            addKanjiDictEntry(merged, type, it, book, chapter, pageNum);
          });
        });
      } catch (e) { /* bỏ qua chương lỗi, quét tiếp chương khác */ }
    }
  }
  // Nếu app từ điển riêng (dictionary-app) đang dùng chung repo này và đã ẩn 1 số mục
  // (data/hidden.json hoặc cfg.hiddenPath) thì lọc bớt cho đồng bộ. Không có file này cũng
  // không sao — bỏ qua lặng lẽ.
  try {
    const hiddenPath = cfg.hiddenPath || "hidden.json";
    const res = await GH.getJSONObject(cfg, hiddenPath);
    const hiddenList = res && Array.isArray(res.data) ? res.data : [];
    hiddenList.forEach((h) => { if (h && h.key) merged.delete(h.key); });
  } catch (e) { /* không có file ẩn hoặc lỗi đọc -> bỏ qua */ }

  return Array.from(merged.values());
}

async function ensureKanjiDictIndex(forceRefresh, onProgress) {
  if (kanjiDictCache && !forceRefresh) return kanjiDictCache;
  if (!forceRefresh) {
    const cached = await Store.getDictIndex().catch(() => null);
    if (cached && Array.isArray(cached.entries) && cached.entries.length) {
      kanjiDictCache = cached.entries;
      return kanjiDictCache;
    }
  }
  const cfg = await Store.getConfig();
  if (!cfg || !cfg.owner || !cfg.repo || !cfg.token) {
    throw new Error('Chưa cấu hình GitHub — mở "☁" ở góc trên để cấu hình trước.');
  }
  const entries = await scanKanjiDictFromGithub(cfg, onProgress);
  kanjiDictCache = entries;
  await Store.saveDictIndex({ entries, syncedAt: Date.now() }).catch(() => {});
  return entries;
}

function searchKanjiDict(entries, query) {
  const q = kanjiNormalize(query);
  if (!q) return [];
  const exact = [];
  const partial = [];
  entries.forEach((e) => {
    const np = kanjiNormalize(e.phrase);
    if (np === q) exact.push(e);
    else if (np.includes(q) || kanjiNormalize(e.explain).includes(q)) partial.push(e);
  });
  return exact.concat(partial).slice(0, 30);
}

function renderKanjiLookupResults(results, query) {
  const box = $("#kanjiLookupResults");
  if (!results.length) {
    box.innerHTML = `<div class="an-empty">Không tìm thấy "${escapeHtml(query)}" trong dữ liệu sách.</div>`;
    return;
  }
  box.innerHTML = results.map((e) => {
    const srcTxt = (e.sources || []).slice(0, 3)
      .map((s) => `${s.book}/${s.chapter} (tr.${s.page ?? "?"})`).join(", ");
    return `<div class="an-item ${escapeHtml(e.type)}">
      <span class="an-type" data-type="${escapeHtml(e.type)}">${escapeHtml(KANJI_TYPE_LABEL[e.type] || e.type)}</span>
      <span class="an-phrase">${escapeHtml(e.phrase)}</span>
      ${e.explain ? `<div class="an-explain">${escapeHtml(e.explain)}</div>` : ""}
      ${srcTxt ? `<div class="kanji-lookup-src">${escapeHtml(srcTxt)}</div>` : ""}
    </div>`;
  }).join("");
}

async function handleKanjiLookup() {
  const q = kanjiState.composedText.trim();
  if (!q) {
    alert('Chưa có từ/cụm từ nào để tra — bấm vào 1 kết quả nhận diện để thêm vào "Chuỗi đã ghép" trước.');
    return;
  }
  const box = $("#kanjiLookupBox");
  const results = $("#kanjiLookupResults");
  box.classList.remove("hidden");
  results.innerHTML = `<div class="an-empty">Đang tra cứu…</div>`;
  try {
    const entries = await ensureKanjiDictIndex(false, (msg) => {
      results.innerHTML = `<div class="an-empty">${escapeHtml(msg)}</div>`;
    });
    renderKanjiLookupResults(searchKanjiDict(entries, q), q);
  } catch (e) {
    results.innerHTML = `<div class="an-empty">Lỗi: ${escapeHtml(e.message)}</div>`;
  }
}

async function handleKanjiLookupRefresh() {
  const box = $("#kanjiLookupBox");
  const results = $("#kanjiLookupResults");
  box.classList.remove("hidden");
  results.innerHTML = `<div class="an-empty">Đang quét lại toàn bộ dữ liệu sách trên GitHub…</div>`;
  try {
    const entries = await ensureKanjiDictIndex(true, (msg) => {
      results.innerHTML = `<div class="an-empty">${escapeHtml(msg)}</div>`;
    });
    const q = kanjiState.composedText.trim();
    if (q) renderKanjiLookupResults(searchKanjiDict(entries, q), q);
    else results.innerHTML = `<div class="an-empty">Đã làm mới (${entries.length} mục). Ghép 1 từ rồi bấm "🔍 Tra cứu".</div>`;
  } catch (e) {
    results.innerHTML = `<div class="an-empty">Lỗi: ${escapeHtml(e.message)}</div>`;
  }
}

// ---------- Thêm từ vựng vào ĐÚNG trang đang mở ở cột JSON, rồi đẩy lên GitHub ----------
function openVocabAddPanel() {
  const phrase = kanjiState.composedText.trim();
  if (!phrase) {
    alert('Chưa có từ/cụm từ nào — bấm vào 1 kết quả nhận diện để thêm vào "Chuỗi đã ghép" trước.');
    return;
  }
  const j = state.json;
  if (!j.book || !j.chapter || !j.pages.length) {
    alert("Chưa mở trang sách nào ở cột bên phải (JSON) — mở 1 chương và đứng đúng trang cần thêm từ trước.");
    return;
  }
  if (j.editing) {
    alert('Cột JSON đang ở chế độ sửa — bấm "Cập nhật" hoặc "Hủy" ở đó trước khi thêm từ.');
    return;
  }
  const page = j.pages[j.pageIdx];
  $("#vocabAddPhrase").textContent = phrase;
  $("#vocabAddExplain").value = "";
  $("#vocabAddStatus").textContent = "";
  $("#vocabAddTarget").textContent = `Thêm vào: ${j.book} / ${j.chapter} — trang ${page.page ?? (j.pageIdx + 1)}`;
  $("#vocabAddOverlay").classList.remove("hidden");
  $("#vocabAddPanel").classList.remove("hidden");
  $("#vocabAddExplain").focus();
}

function closeVocabAddPanel() {
  $("#vocabAddOverlay").classList.add("hidden");
  $("#vocabAddPanel").classList.add("hidden");
}

async function submitVocabAdd() {
  const statusEl = $("#vocabAddStatus");
  const cfg = await Store.getConfig();
  if (!cfg || !cfg.owner || !cfg.repo || !cfg.token) {
    statusEl.textContent = 'Chưa cấu hình GitHub — mở "☁" ở góc trên để cấu hình trước.';
    return;
  }
  const phrase = $("#vocabAddPhrase").textContent.trim();
  const explain = $("#vocabAddExplain").value.trim();
  if (!phrase) { statusEl.textContent = "Thiếu từ vựng."; return; }

  const j = state.json;
  const page = j.pages[j.pageIdx];
  if (!page) { statusEl.textContent = "Không xác định được trang đang mở."; return; }
  if (!Array.isArray(page.analysis)) page.analysis = [];
  page.analysis.push({ type: "vocab", phrase, explain });

  statusEl.textContent = "Đang đẩy lên GitHub…";
  $("#btnVocabAddSubmit").disabled = true;
  $("#btnVocabAddCancel").disabled = true;
  try {
    const booksPath = cfg.booksPath || "data";
    const relPath = `${booksPath}/${j.book}/${j.chapter}.json`;
    const raw = j.raw || { pages: j.pages };
    raw.pages = j.pages;
    await GH.putTextFile(cfg, relPath, JSON.stringify(raw, null, 2),
      `Thêm từ vựng "${phrase}" — ${j.book}/${j.chapter} trang ${page.page ?? j.pageIdx + 1}`);
    await Store.saveChapter(j.book, j.chapter, raw).catch(() => {});
    kanjiDictCache = null; // dữ liệu tra cứu đã cũ do vừa thêm mục mới -> buộc quét lại lần tra cứu sau
    statusEl.textContent = "Đã thêm ✓";
    if (!state.json.editing) renderJsonPage();
    setTimeout(() => {
      closeVocabAddPanel();
      resetKanjiComposed();
    }, 700);
  } catch (e) {
    page.analysis.pop(); // đẩy lỗi -> hoàn tác để có thể bấm "Thêm" thử lại từ trạng thái sạch
    statusEl.textContent = `Lỗi đẩy lên GitHub: ${e.message}. Bấm "Thêm" để thử lại.`;
  } finally {
    $("#btnVocabAddSubmit").disabled = false;
    $("#btnVocabAddCancel").disabled = false;
  }
}

function bindVocabAddPanel() {
  $("#btnCloseVocabAdd").addEventListener("click", closeVocabAddPanel);
  $("#btnVocabAddCancel").addEventListener("click", closeVocabAddPanel);
  $("#vocabAddOverlay").addEventListener("click", closeVocabAddPanel);
  $("#btnVocabAddSubmit").addEventListener("click", submitVocabAdd);
}

// ---------- Mở/đóng popup + kéo thả + đổi kích thước ----------
function openKanjiPanel() {
  const panel = $("#kanjiPanel");
  if (!panel.classList.contains("hidden")) return;
  panel.classList.remove("hidden");
  if (!kanjiState.positioned) {
    const w = Math.min(400, window.innerWidth - 24);
    const h = Math.min(600, window.innerHeight - 24);
    panel.style.width = w + "px";
    panel.style.height = h + "px";
    panel.style.left = Math.max(8, (window.innerWidth - w) / 2) + "px";
    panel.style.top = Math.max(8, (window.innerHeight - h) / 2 - 20) + "px";
    kanjiState.positioned = true;
  }
  requestAnimationFrame(() => kanjiResizeCanvas(false));
}

function closeKanjiPanel() {
  $("#kanjiPanel").classList.add("hidden");
}

function bindKanjiPanelToggle() {
  $("#btnKanjiTool").addEventListener("click", () => {
    const panel = $("#kanjiPanel");
    if (panel.classList.contains("hidden")) openKanjiPanel();
    else closeKanjiPanel();
  });
  $("#btnCloseKanjiPanel").addEventListener("click", closeKanjiPanel);
}

function bindKanjiPanelDrag() {
  const panel = $("#kanjiPanel");
  const handle = $("#kanjiPanelHandle");
  let dragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;
  handle.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return; // không kéo khi bấm nút ⟳ / ✕ trên thanh tiêu đề
    dragging = true;
    startX = e.clientX; startY = e.clientY;
    const r = panel.getBoundingClientRect();
    startLeft = r.left; startTop = r.top;
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    const w = panel.offsetWidth, h = panel.offsetHeight;
    const left = Math.min(Math.max(4, startLeft + dx), window.innerWidth - w - 4);
    const top = Math.min(Math.max(4, startTop + dy), window.innerHeight - h - 4);
    panel.style.left = left + "px";
    panel.style.top = top + "px";
  });
  ["pointerup", "pointercancel"].forEach((ev) => handle.addEventListener(ev, () => { dragging = false; }));
}

function bindKanjiPanelResize() {
  const panel = $("#kanjiPanel");
  const handle = $("#kanjiResizeHandle");
  let resizing = false, startX = 0, startY = 0, startW = 0, startH = 0;
  handle.addEventListener("pointerdown", (e) => {
    resizing = true;
    startX = e.clientX; startY = e.clientY;
    const r = panel.getBoundingClientRect();
    startW = r.width; startH = r.height;
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  handle.addEventListener("pointermove", (e) => {
    if (!resizing) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    const maxW = window.innerWidth - panel.getBoundingClientRect().left - 4;
    const maxH = window.innerHeight - panel.getBoundingClientRect().top - 4;
    const w = Math.min(Math.max(280, startW + dx), maxW);
    const h = Math.min(Math.max(380, startH + dy), maxH);
    panel.style.width = w + "px";
    panel.style.height = h + "px";
    kanjiResizeCanvas(true);
  });
  ["pointerup", "pointercancel"].forEach((ev) => handle.addEventListener(ev, () => { resizing = false; }));
}

function initKanji() {
  bindKanjiCanvas();
  bindKanjiComposedActions();
  bindVocabAddPanel();
  bindKanjiPanelToggle();
  bindKanjiPanelDrag();
  bindKanjiPanelResize();
  window.addEventListener("resize", () => {
    if (!$("#kanjiPanel").classList.contains("hidden")) kanjiResizeCanvas(true);
  });
}

document.addEventListener("DOMContentLoaded", initKanji);
