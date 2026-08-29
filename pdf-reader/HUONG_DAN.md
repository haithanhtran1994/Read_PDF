# PDF Dual Reader — hướng dẫn tính năng mới

## 1. Bố cục
- **Cột A**: vẫn là đọc PDF như cũ (mở file, zoom, bôi đen để highlight/gạch chân/thêm ghi chú lên GitHub).
- **Cột B**: đổi thành đọc dữ liệu JSON (bản dịch + phân tích ngữ pháp/slang/idiom/collocation) theo từng trang,
  lấy trực tiếp từ GitHub, theo cấu trúc `data/<book>/<chapter>.json`.

Trong cột B:
- Bấm **"Chọn sách / chương…"** để mở mục lục: chọn sách (thư mục trong `data/`) rồi chọn chương (file `.json`).
- 3 nút **Dịch / Phân tích / Cả hai** để chọn hiển thị bản dịch, phần phân tích, hay cả hai.
- Nút `‹ ›` chuyển trang trong chương đang đọc, có đánh số trang.
- Cấu hình GitHub (nút ☁) có thêm 1 dòng **"Thư mục dữ liệu sách JSON"** (mặc định `data`) —
  đây là thư mục chứa các thư mục con theo từng sách.

## 2. Định dạng dữ liệu JSON mỗi chương
`data/book1/chp1.json`:
```json
{
  "book": "book1",
  "chapter": "chp1",
  "pages": [
    {
      "page": 1,
      "summary": "Tóm tắt/tổng kết đầy đủ ý của trang 1: nội dung tổng quát, các ý chính cần hiểu, phần cần tìm hiểu thêm...",
      "translation": "Bản dịch tiếng Việt của trang 1...",
      "grammar": [
        { "phrase": "the girl who loved me", "explain": "mệnh đề quan hệ bổ nghĩa cho \"girl\"" }
      ],
      "analysis": [
        { "type": "vocab", "phrase": "mitigate", "explain": "làm giảm nhẹ, giảm bớt mức độ nghiêm trọng" },
        { "type": "idiom", "phrase": "kick the bucket", "explain": "nghĩa là chết (informal)" }
      ]
    }
  ]
}
```
`analysis[].type` là 1 trong: `vocab` (từ đơn lẻ khó/hiếm/chuyên ngành), `idiom`, `slang`, `collocation`, `phrase` (cụm từ dài đáng chú ý khác).

`summary` là tùy chọn — trang/chương cũ chưa có field này thì app tự bỏ qua, không hiển thị mục
"Tóm tắt", không lỗi gì cả.

## 3. Tạo dữ liệu bằng Excel
- Mỗi **sách** = 1 file Excel (`book1.xlsx`), mỗi **chapter** = 1 **sheet** (tên sheet = tên chapter, ví dụ `chp1`).
- Cột trong mỗi sheet: `page | translation | grammar | analysis`
  - `translation`: bản dịch nguyên trang. **Tùy chọn**: có thể thêm phần "Tóm tắt" (tổng quan,
    ý chính cần hiểu, phần cần tìm hiểu thêm) ở ĐẦU ô, trước bản dịch, phân tách bằng 2 dòng marker
    riêng (Alt+Enter xuống dòng):
    ```
    === TÓM TẮT ===
    nội dung tóm tắt…
    === BẢN DỊCH ===
    nội dung bản dịch…
    ```
    Không có 2 dòng marker này thì cả ô được hiểu là bản dịch thuần (không có tóm tắt) — vẫn hoạt động bình thường.
  - `grammar`: mỗi dòng (Alt+Enter trong ô Excel) = 1 mục, dạng `cụm từ :: giải thích`.
  - `analysis`: mỗi dòng = 1 mục, dạng `loại: cụm từ :: giải thích` (loại: vocab/idiom/slang/collocation/phrase).
- Chi tiết + ví dụ xem trong công cụ `tools/xlsx-to-json.html` (mở file này trực tiếp trong trình duyệt, không cần cài gì).
- Nếu dùng `batch_ocr_pdf_gemini.py` để tạo Excel bằng Gemini: script tự ghi đúng 2 marker trên vào ô
  `translation`, không cần làm gì thêm.

## 4. Quy trình làm việc trên Windows → đẩy lên GitHub → đọc trên iPhone
1. Trên Windows, nhập liệu vào file Excel theo định dạng ở mục 3.
2. Mở `tools/xlsx-to-json.html` (double-click, hoặc mở bằng Chrome/Edge) → chọn file Excel →
   bấm "Chuyển sang JSON" → bấm "Lưu vào thư mục trên máy…", chọn thư mục gốc (ví dụ `create_data`).
   Công cụ sẽ tự tạo `create_data/book1/chp1.json`, `chp2.json`, …
3. Mở app PDF Dual Reader trên Windows (Chrome/Edge) → cấu hình GitHub (☁) nếu chưa có →
   bấm nút **⇪ (Nhập & đẩy dữ liệu lên GitHub)** ở góc trên → chọn thư mục `create_data/book1` vừa tạo →
   app tự đọc từng file `.json` và đẩy lên repo GitHub vào `data/book1/`.
4. Mở app trên iPhone (Safari, hoặc bản đã "Add to Home Screen") → cấu hình GitHub (chỉ cần đúng
   owner/repo/token, không cần thao tác gì thêm) → ở cột B bấm "Chọn sách / chương…" → sách `book1`
   sẽ xuất hiện trong mục lục, đọc trực tiếp từ GitHub.

Lưu ý: bước 2–3 (chọn thư mục trên máy, `showDirectoryPicker`) chỉ chạy được trên Chrome/Edge desktop,
không chạy trên Safari/iPhone — đúng như quy trình bạn mô tả (tạo & đẩy dữ liệu trên Windows, đọc trên iPhone).

## 5. Mở PDF từ GitHub (không chỉ từ máy)

Ở cột A, cạnh nút **"Mở PDF…"** giờ có thêm nút **"☁PDF"**. Bấm vào đó sẽ mở 1 bảng duyệt thư mục
`pdf/` trên GitHub (có thể có thư mục con, ví dụ `pdf/book1/chuong1.pdf`) — bấm vào thư mục để đi
sâu vào, bấm vào file `.pdf` để mở luôn. Muốn đổi tên thư mục khác `pdf`, sửa ở cấu hình GitHub (☁),
mục **"Thư mục chứa file PDF sách"**. Cứ đẩy file PDF lên đúng thư mục đó trên GitHub (web GitHub,
GitHub Desktop, git...) là app đọc được, không cần công cụ gì thêm.

## 6. Highlight / gạch chân được lưu lại, không mất khi mở lại file

Trước đây bôi đen / gạch chân chỉ là hiệu ứng hiển thị tạm thời — đóng app hoặc mở lại file là mất.
Giờ mỗi lần Highlight/Gạch chân, app tự:
1. Ghi lại ngay trên máy (IndexedDB) — mở lại app trên máy đó vẫn còn, kể cả khi không có mạng.
2. Nếu đã cấu hình GitHub (☁), đẩy luôn 1 file JSON nhỏ lên repo (thư mục **"Thư mục lưu highlight"**,
   mặc định `highlights/`) — file này đi kèm PDF, không phụ thuộc trình duyệt/thiết bị nào cả.
   Nhờ vậy mở cùng file PDF đó trên máy khác (ví dụ mở trên iPhone file đã tải từ GitHub) cũng thấy
   lại đúng highlight đã đánh dấu.
3. Chạm vào 1 vùng highlight/gạch chân đã lưu để xóa nó.

**Về việc "lưu trực tiếp vào file PDF":** app hiện lưu highlight vào 1 **file JSON đi kèm** (không
sửa vào bên trong file PDF gốc), vì: (a) mở file PDF từ `<input type=file>` trên Safari/iPhone thì
trình duyệt không cho ghi ngược lại đúng file đó trên máy — có ghi vào PDF cũng không lưu được;
(b) nếu ghi thẳng vào PDF trên GitHub thì mỗi lần bôi 1 highlight sẽ phải tải lại + đẩy lại nguyên
file PDF (có thể vài MB) lên GitHub, rất chậm và tốn dung lượng lịch sử commit. File JSON đi kèm nhẹ,
nhanh, đồng bộ qua GitHub được, và hoạt động giống nhau dù mở PDF từ máy hay từ GitHub. Nếu bạn thực
sự cần highlight nằm ngay trong file PDF (để mở bằng app đọc PDF khác cũng thấy), nói lại — đây là
một hướng làm khác, phức tạp hơn, cần tính kỹ lại.
