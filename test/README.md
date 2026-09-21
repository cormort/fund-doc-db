# 測試素材

以瀏覽器 console 手動驗證解析路徑（`python3 -m http.server` 後開啟 index.html）：

```js
const p = await import('./js/parsers.js');
const f = new File([await (await fetch('./test/fixtures/heading-styles.docx')).blob()], 'of115ds-16-交作.docx');
const out = []; await p.parseDocx(f, out, '作業基金', '115'); console.log(out[0]);
```

- `heading-styles.docx`：使用 Word 標題 1／2 樣式 → 應走樣式路徑，無警告。
- `plain-text.docx`：無標題樣式 → 應退回文字規則，並回報「未使用 Word 標題樣式」與「基金名稱由檔名推定」。
