# 基金文件結構化資料庫

純前端工具：Word/PDF 解析 → 結構化 JSON 資料庫 → 條件查詢與匯出。

線上使用：https://cormort.github.io/fund-doc-db/

資料僅存在瀏覽器記憶體中，不會上傳伺服器；請自行下載 JSON 備份。

## 專案結構

```
index.html        頁面骨架（無 inline CSS / JS）
css/styles.css    樣式
js/state.js       應用狀態 appState、異動旗標、CDN 套件檢查、Toast
js/dom.js         共用 DOM 元素
js/parsers.js     PDF／DOCX 解析與階層抽取
js/database.js    JSON 驗證、匯入合併、匯出 JSON／Excel
js/query.js       篩選連動與查詢結果渲染
js/files.js       拖放檔案流程
js/storage.js     IndexedDB 本機自動保存
js/ui.js          事件綁定與進入點（ES module entry）
test/fixtures/    DOCX 解析路徑的驗證素材
```

以原生 ES modules 載入，無建置步驟；直接以任何靜態伺服器開啟即可（`python3 -m http.server`）。

## JSON 格式（schemaVersion 2.0）

```json
{
  "schemaVersion": "2.0",
  "application": "基金文件結構化資料庫",
  "exportedAt": "2026-09-21T10:00:00.000Z",
  "recordCount": 344,
  "funds": [ { "fundName": "...", "budgetYear": "115", "fundType": "作業基金", "sourceFile": "...", "structured": [] } ]
}
```

匯入同時相容舊格式（根層級直接是陣列）。重複資料以「年度＋屬性＋基金名稱」判定，可選擇
**取代**（預設，寫入 `updatedAt`）、**略過**或**兩者都保留**；內容完全相同者一律略過。

## 解析與查詢行為

- **Word**：優先採用 Word 標題 1／2／3 樣式判斷階層；文件未套樣式時退回文字正規表示式，並回報警告。
- **PDF**：逐頁擷取並記錄頁碼，換行門檻依每頁字高中位數動態推估；整頁無文字者列為警告（可能為掃描影像）。
- **雙欄版面**：以「多數文字行在版面中央有連續欄間空白」判定，成立時左欄先於右欄輸出，跨欄標題排在最前，並回報哪幾頁被重排。
- **頁首／頁尾**：出現在 60% 以上頁面（至少 3 頁）的首行／末行，以及純頁碼行，會被移除並列為警告。
- **解析警告**：`extractionWarnings` 隨資料保存，顯示於檔案清單與內容預覽（含「基金名稱由檔名推定」）。
- **查詢結果分頁**：每頁 25／50／100 筆，查詢結果表格附「來源」欄（檔名＋頁碼）；Excel 匯出為完整結果集，不受分頁影響。
- **自動保存**：可勾選以 IndexedDB 保存於本機瀏覽器；非共用資料庫、不跨電腦同步，JSON 仍為備份與交換格式。
