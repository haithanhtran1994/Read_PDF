/* github.js — gọi thẳng GitHub Contents API từ trình duyệt để đọc/ghi file JSON
   ghi chú (data/notes.json) trên repo. Cần 1 Personal Access Token (fine-grained,
   chỉ cấp quyền Contents: Read & Write cho đúng 1 repo) do người dùng tự tạo và
   nhập 1 lần, lưu trong IndexedDB (Store.getConfig/saveConfig), KHÔNG hardcode.
*/
const GH = (() => {
  function apiBase(cfg) {
    return `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents`;
  }

  function fullPath(cfg, relPath) {
    return cfg.dataPrefix ? `${cfg.dataPrefix}/${relPath}` : relPath;
  }

  function b64ToStr(b64) {
    return decodeURIComponent(escape(atob(b64.replace(/\n/g, ""))));
  }

  function strToBase64(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }

  // Base64 -> Uint8Array, dùng cho dữ liệu NHỊ PHÂN (PDF, ảnh…) — không được
  // decode qua escape/unescape như b64ToStr (sẽ làm hỏng byte nhị phân).
  function b64ToUint8Array(b64) {
    const bin = atob(b64.replace(/\n/g, ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  async function getFile(cfg, path) {
    try {
      const res = await fetch(`${apiBase(cfg)}/${path}?ref=${cfg.branch || "main"}`, {
        headers: { Authorization: `token ${cfg.token}` },
      });
      if (res.status === 404) return null;
      if (!res.ok) {
        let msg = res.status;
        try { msg = (await res.json()).message || msg; } catch (e) {}
        throw new Error(`${path}: ${msg}`);
      }
      const data = await res.json();
      return { sha: data.sha, content: data.content ? b64ToStr(data.content) : "" };
    } catch (e) {
      if (e instanceof TypeError) throw new Error("Không kết nối được tới GitHub (kiểm tra mạng).");
      throw e;
    }
  }

  // Đọc 1 file NHỊ PHÂN (ví dụ .pdf) từ repo, trả về { sha, bytes: Uint8Array }.
  // Trả về null nếu file không tồn tại (404).
  // Lưu ý: GitHub Contents API chỉ trả field "content" (base64) cho file <= 1MB.
  // File lớn hơn (đến 100MB) phải xin định dạng "raw" mới lấy được nội dung thật,
  // nếu không sẽ nhận về nội dung rỗng dù request thành công (200).
  async function getBinaryFile(cfg, path) {
    try {
      const res = await fetch(`${apiBase(cfg)}/${path}?ref=${cfg.branch || "main"}`, {
        headers: {
          Authorization: `token ${cfg.token}`,
          Accept: "application/vnd.github.raw",
        },
      });
      if (res.status === 404) return null;
      if (!res.ok) {
        let msg = res.status;
        try { msg = (await res.json()).message || msg; } catch (e) {}
        throw new Error(`${path}: ${msg}`);
      }
      const buf = await res.arrayBuffer();
      return { sha: res.headers.get("etag") || null, bytes: new Uint8Array(buf) };
    } catch (e) {
      if (e instanceof TypeError) throw new Error("Không kết nối được tới GitHub (kiểm tra mạng).");
      throw e;
    }
  }

  // Đọc 1 file JSON, trả về mảng rỗng nếu file chưa tồn tại
  async function getJSONArray(cfg, relPath) {
    const path = fullPath(cfg, relPath);
    const file = await getFile(cfg, path);
    if (!file) return { sha: null, items: [] };
    try {
      const parsed = JSON.parse(file.content || "[]");
      return { sha: file.sha, items: Array.isArray(parsed) ? parsed : [] };
    } catch (e) {
      throw new Error(`${relPath} không phải JSON hợp lệ trên GitHub.`);
    }
  }

  async function putFile(cfg, relPath, base64Content, message, knownSha) {
    const path = fullPath(cfg, relPath);
    const sha = knownSha !== undefined ? knownSha : (await getFile(cfg, path))?.sha || null;
    const body = {
      message: message || `Update ${relPath}`,
      content: base64Content,
      branch: cfg.branch || "main",
    };
    if (sha) body.sha = sha;

    const res = await fetch(`${apiBase(cfg)}/${path}`, {
      method: "PUT",
      headers: {
        Authorization: `token ${cfg.token}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.github+json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let msg = res.status;
      try { msg = (await res.json()).message || msg; } catch (e) {}
      throw new Error(`${relPath}: ${msg}`);
    }
    return res.json();
  }

  async function putTextFile(cfg, relPath, textContent, message, knownSha) {
    return putFile(cfg, relPath, strToBase64(textContent), message, knownSha);
  }

  // Thêm 1 note vào mảng JSON trên GitHub (đọc mới nhất -> append -> ghi lại, tránh mất dữ liệu do sha cũ)
  async function appendNoteToRepo(cfg, relPath, note) {
    const { sha, items } = await getJSONArray(cfg, relPath);
    items.push(note);
    await putTextFile(cfg, relPath, JSON.stringify(items, null, 2), `Thêm ghi chú ${note.id}`, sha);
    return items;
  }

  // Ghi đè toàn bộ 1 mảng JSON lên GitHub (đọc sha mới nhất trước để tránh conflict).
  // Dùng cho highlight/underline: mỗi lần thay đổi, ghi lại cả mảng của 1 file PDF.
  async function putJSONArray(cfg, relPath, items, message) {
    const path = fullPath(cfg, relPath);
    const existing = await getFile(cfg, path).catch(() => null);
    const sha = existing ? existing.sha : null;
    await putTextFile(cfg, relPath, JSON.stringify(items, null, 2), message || `Update ${relPath}`, sha);
    return items;
  }

  // Liệt kê nội dung 1 thư mục trên repo (dùng để làm mục lục book/chapter).
  // Trả về [] nếu thư mục không tồn tại (thay vì lỗi), để UI dễ xử lý.
  async function listDir(cfg, path) {
    try {
      const res = await fetch(`${apiBase(cfg)}/${path}?ref=${cfg.branch || "main"}`, {
        headers: { Authorization: `token ${cfg.token}` },
      });
      if (res.status === 404) return [];
      if (!res.ok) {
        let msg = res.status;
        try { msg = (await res.json()).message || msg; } catch (e) {}
        throw new Error(`${path}: ${msg}`);
      }
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch (e) {
      if (e instanceof TypeError) throw new Error("Không kết nối được tới GitHub (kiểm tra mạng).");
      throw e;
    }
  }

  // Đọc 1 file JSON dạng object (không phải mảng), trả về null nếu chưa có / lỗi parse
  async function getJSONObject(cfg, relPath) {
    const path = fullPath(cfg, relPath);
    const file = await getFile(cfg, path);
    if (!file) return null;
    try {
      return { sha: file.sha, data: JSON.parse(file.content || "null") };
    } catch (e) {
      throw new Error(`${relPath} không phải JSON hợp lệ trên GitHub.`);
    }
  }

  // Ghi đè 1 object JSON (không phải mảng) lên GitHub (đọc sha mới nhất trước để tránh conflict).
  // Dùng cho tiến độ đọc PDF (reading-progress.json): { [pdfId]: {name, page, numPages, updatedAt} }.
  async function putJSONObject(cfg, relPath, obj, message) {
    const path = fullPath(cfg, relPath);
    const existing = await getFile(cfg, path).catch(() => null);
    const sha = existing ? existing.sha : null;
    await putTextFile(cfg, relPath, JSON.stringify(obj, null, 2), message || `Update ${relPath}`, sha);
    return obj;
  }

  return {
    getConfig: Store.getConfig,
    saveConfig: Store.saveConfig,
    getFile,
    getBinaryFile,
    getJSONArray,
    getJSONObject,
    putFile,
    putTextFile,
    putJSONArray,
    putJSONObject,
    appendNoteToRepo,
    listDir,
    fullPath,
  };
})();
