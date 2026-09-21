# 測試素材

以瀏覽器 console 手動驗證解析路徑（`python3 -m http.server` 後開啟 index.html）：

```js
const p = await import('./js/parsers.js');
const f = new File([await (await fetch('./test/fixtures/heading-styles.docx')).blob()], 'of115ds-16-交作.docx');
const out = []; await p.parseDocx(f, out, '作業基金', '115'); console.log(out[0]);
```

- `heading-styles.docx`：使用 Word 標題 1／2 樣式 → 應走樣式路徑，無警告。
- `plain-text.docx`：無標題樣式 → 應退回文字規則，並回報「未使用 Word 標題樣式」與「基金名稱由檔名推定」。

## PDF 版面處理

`two-column.pdf`（自動產生的最小 PDF，3 頁雙欄，含重複頁首與頁碼）：

```js
const p = await import('./js/parsers.js');
const f = new File([await (await fetch('./test/fixtures/two-column.pdf')).blob()], 'two-column.pdf');
const out = []; await p.parsePdf(f, out, '作業基金', '115'); console.log(out[0]);
```

預期：警告列出「雙欄版面已重排」與「已移除重複頁首／頁尾」，內容為左欄 0–7 全部在右欄 0–7 之前。

單元層級可直接餵假的 text item（`{str, width, height, transform}`）給 `extractPageLines(items, pageWidth)`
與 `stripRunningLines(pages, warnings)`，驗證三種版面：真雙欄要判 2、單欄整行與「單行被切成兩片段」都要判 1。
