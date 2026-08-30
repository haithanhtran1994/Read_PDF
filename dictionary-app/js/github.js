/* github.js — gọi GitHub Contents API để đọc dữ liệu (chỉ đọc, app này không ghi gì lên GitHub).
   Dùng chung Personal Access Token với app đọc sách (chỉ cần quyền Contents: Read). */
const GH = (() => {
  function apiBase(cfg) {
    return `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents`;
  }

  function b64ToStr(b64) {
    return decodeURIComponent(escape(atob(b64.replace(/\n/g, ""))));
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
      return JSON.parse(file.content || "null");
    } catch (e) {
      throw new Error(`${path} không phải JSON hợp lệ trên GitHub.`);
    }
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

  return { getFile, getJSONObject, listDir };
})();
