/* github.js — gọi GitHub Contents API để đọc VÀ ghi dữ liệu. Token cần quyền
   Contents: Read and write (để tính năng "Sửa" ghi ngược lại đúng file JSON nguồn). */
const GH = (() => {
  function apiBase(cfg) {
    return `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents`;
  }

  // Nối các đoạn đường dẫn, bỏ qua đoạn rỗng hoặc "." (dùng "." để chỉ định
  // "ngay tại gốc repo", ví dụ khi repo dữ liệu sách không có prefix nào).
  function joinPath(...parts) {
    return parts
      .filter((p) => p !== undefined && p !== null && p !== "" && p !== ".")
      .map((p) => String(p).replace(/^\/+|\/+$/g, ""))
      .filter(Boolean)
      .join("/");
  }

  // Trả về 1 bản cfg "trỏ" sang repo riêng lưu dữ liệu sách (JSON), nếu người dùng có
  // cấu hình bookOwner/bookRepo (xem index.html mục "Repo dữ liệu sách"). Nếu không
  // cấu hình gì thêm, trả về nguyên cfg gốc -> KHÔNG đổi hành vi cũ (danh sách đã ẩn
  // vẫn dùng repo/token cũ, chỉ nội dung sách để tra cứu mới đọc từ repo riêng này).
  function bookRepoCfg(cfg) {
    if (!cfg || !(cfg.bookOwner || cfg.bookRepo)) return cfg;
    return {
      ...cfg,
      owner: cfg.bookOwner || cfg.owner,
      repo: cfg.bookRepo || cfg.repo,
      branch: cfg.bookBranch || cfg.branch,
      token: cfg.bookToken || cfg.token,
    };
  }

  function b64ToStr(b64) {
    return decodeURIComponent(escape(atob(b64.replace(/\n/g, ""))));
  }

  function strToB64(str) {
    return btoa(unescape(encodeURIComponent(str)));
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

  async function getJSONObject(cfg, path) {
    const file = await getFile(cfg, path);
    if (!file) return null;
    try {
      return { sha: file.sha, data: JSON.parse(file.content || "null") };
    } catch (e) {
      throw new Error(`${path} không phải JSON hợp lệ trên GitHub.`);
    }
  }

  // Ghi đè 1 file text (dùng cho việc "Sửa" — ghi lại đúng file JSON nguồn sau khi sửa).
  // Cần đúng "sha" hiện tại của file (lấy từ getFile/getJSONObject) để tránh ghi đè nhầm
  // lên thay đổi mới hơn mà app chưa biết.
  async function putTextFile(cfg, path, content, sha, message) {
    const res = await fetch(`${apiBase(cfg)}/${path}`, {
      method: "PUT",
      headers: {
        Authorization: `token ${cfg.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: message || `Cập nhật ${path} (từ dictionary-app)`,
        content: strToB64(content),
        sha: sha || undefined,
        branch: cfg.branch || "main",
      }),
    });
    if (!res.ok) {
      let msg = res.status;
      try { msg = (await res.json()).message || msg; } catch (e) {}
      throw new Error(`Ghi ${path} lỗi: ${msg}`);
    }
    return res.json();
  }

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

  return { getFile, getJSONObject, putTextFile, listDir, joinPath, bookRepoCfg };
})();
