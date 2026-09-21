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
js/ui.js          事件綁定與進入點（ES module entry）
```

以原生 ES modules 載入，無建置步驟；直接以任何靜態伺服器開啟即可（`python3 -m http.server`）。
