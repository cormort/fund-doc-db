// PDF／DOCX 文字解析與階層結構抽取
import { fileList } from './dom.js';

export const REGEX_SETS = {
    '作業基金': {
        main: /^(一、基金概況|二、(主要營運|最近\s*5\s*年主要營運項目)|三、本年度營運計畫及預算)/,
        sub: /^[\(（](一|二|三)[\)）](營運計畫主要內容|預算內容|補辦預算)/,
        subSub: /^(1\.業務收支之預計|2\.餘絀撥補之預計|3\.現金流量之預計)/,
        sectionTwoIdentifier: /二、.*(主要營運|最近\s*5\s*年主要營運項目)/
    },
    '政事基金': {
        main: /^(一、基金概況|二、(主要業務項目|最近\s*5\s*年主要業務項目|本年度業務計畫及預算)|三、本年度業務計畫及預算)/,
        sub: /^[\(（](一|二)[\)）](主要業務計畫|預算內容)/,
        subSub: /^(1\.基金來源、用途及餘絀之預計|2\.現金流量之預計)/,
        sectionTwoIdentifier: /二、.*(主要業務項目|最近\s*5\s*年主要業務項目|本年度業務計畫及預算)/
    }
};

export async function parsePdf(file, targetArray, fundType, budgetYear) {
    const reader = new FileReader();
    return new Promise((resolve) => {
        reader.onload = async (event) => {
            try {
                const pdfData = new Uint8Array(event.target.result);
                const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
                const warnings = [];
                const emptyPages = [];
                const twoColumnPages = [];
                const tablePages = [];
                const pages = [];

                for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
                    const page = await pdf.getPage(pageNo);
                    const items = (await page.getTextContent()).items.filter(i => i.str.trim());
                    if (!items.length) { emptyPages.push(pageNo); continue; }

                    const { lines, columns, table } = extractPageLines(items, page.getViewport({ scale: 1 }).width);
                    if (columns > 1) twoColumnPages.push(pageNo);
                    if (table) tablePages.push(pageNo);
                    pages.push({ page: pageNo, lines });
                }

                if (emptyPages.length) {
                    warnings.push(`第 ${emptyPages.join('、')} 頁沒有可擷取文字（可能為掃描影像或圖表）`);
                }
                if (twoColumnPages.length) {
                    warnings.push(`第 ${twoColumnPages.join('、')} 頁偵測為雙欄版面，已依左欄、右欄順序重排`);
                }
                if (tablePages.length) {
                    warnings.push(`第 ${tablePages.join('、')} 頁疑似表格，維持逐列讀取（未重排欄位），內容可能需人工核對`);
                }
                extractData(stripRunningLines(pages, warnings), file.name, targetArray, fundType, budgetYear, warnings);
                resolve();
            } catch (error) {
                console.error('解析 PDF 時發生錯誤:', file.name, error);
                fileList.innerHTML += `<p style="color:red;">讀取失敗: ${file.name}</p>`;
                resolve();
            }
        };
        reader.readAsArrayBuffer(file);
    });
}

// 將單頁文字片段合併成行；偵測雙欄版面時，左右欄各自成行再依序輸出。
export function extractPageLines(items, pageWidth) {
    const lineGap = medianHeight(items) * 0.6;
    const rowWise = () => ({ lines: buildLines(items, lineGap).map(l => l.text), columns: 1 });

    if (detectColumns(items, pageWidth) < 2) return rowWise();

    // 表格同樣有欄間空白，但欄位必須逐列一起讀，重排會拆散同一列資料。
    if (looksLikeTable(items, pageWidth)) return { ...rowWise(), table: true };

    // ponytail: 假設跨欄的行是頁面上方標題；若正文中間插入跨欄標題會被排到最前面，
    // 屆時再改成以跨欄行切分區塊（band）處理。
    const mid = pageWidth / 2;
    const spanning = items.filter(i => isSpanning(i, pageWidth));
    const rest = items.filter(i => !isSpanning(i, pageWidth));
    const left = rest.filter(i => itemCenter(i) < mid);
    const right = rest.filter(i => itemCenter(i) >= mid);

    return {
        lines: [spanning, left, right].flatMap(group => buildLines(group, lineGap).map(l => l.text)),
        columns: 2
    };
}

// 表格判定：欄位起點在各列對齊（三欄以上必為表格），或欄內文字短而參差、以數字為主。
export function looksLikeTable(items, pageWidth) {
    const tolerance = Math.max(medianHeight(items) * 0.5, 3);
    const lines = buildLines(items, medianHeight(items) * 0.6).filter(l => !l.items.some(i => isSpanning(i, pageWidth)));
    if (lines.length < 3) return false;

    // 1) 欄位起點叢集：多數列都在同樣的 x 位置開始 → 表格欄位
    const anchors = [];
    lines.forEach(line => {
        const starts = [...new Set(line.items.map(itemLeft))];
        starts.forEach(x => {
            const hit = anchors.find(a => Math.abs(a.x - x) <= tolerance);
            if (hit) { hit.lines.add(line); } else { anchors.push({ x, lines: new Set([line]) }); }
        });
    });
    const sharedAnchors = anchors.filter(a => a.lines.size >= lines.length * 0.6).length;
    if (sharedAnchors >= 3) return true;

    // 2) 兩欄時看欄內文字是否填滿欄寬：正文會接近填滿，表格儲存格短而參差
    const mid = pageWidth / 2;
    const sideFill = side => {
        const rows = lines.map(l => l.items.filter(i => side === 'left' ? itemRight(i) <= mid : itemLeft(i) >= mid))
                          .filter(cells => cells.length);
        if (rows.length < 3) return 1;
        const colStart = Math.min(...rows.flat().map(itemLeft));
        const colEnd = Math.max(...rows.flat().map(itemRight));
        const width = colEnd - colStart || 1;
        return rows.reduce((sum, cells) =>
            sum + (Math.max(...cells.map(itemRight)) - Math.min(...cells.map(itemLeft))) / width, 0) / rows.length;
    };
    if (Math.min(sideFill('left'), sideFill('right')) < 0.6) return true;

    // 3) 右側多為數字（預算金額表常見）
    const numericRows = lines.filter(line => {
        const text = line.items.filter(i => itemLeft(i) >= mid).map(i => i.str).join('').trim();
        return text && /^[\d\s.,()%\-–—]+$/.test(text);
    }).length;
    return numericRows >= lines.length * 0.6;
}

function medianHeight(items) {
    const heights = items.map(i => Math.abs(i.height || i.transform[3]) || 0).filter(Boolean).sort((a, b) => a - b);
    return heights[Math.floor(heights.length / 2)] || 10;
}

const itemLeft = item => item.transform[4];
const itemRight = item => item.transform[4] + (item.width || 0);
const itemCenter = item => (itemLeft(item) + itemRight(item)) / 2;

function isSpanning(item, pageWidth) {
    return itemLeft(item) < pageWidth * 0.45 && itemRight(item) > pageWidth * 0.55;
}

// 依 Y 座標合併成行；同一行內再依 X 由左至右排列。
function buildLines(items, lineGap) {
    const sorted = [...items].sort((a, b) => (b.transform[5] - a.transform[5]) || (itemLeft(a) - itemLeft(b)));
    const lines = [];
    let current = null;
    for (const item of sorted) {
        const y = item.transform[5];
        if (!current || Math.abs(y - current.y) > lineGap) {
            current = { text: '', y, items: [] };
            lines.push(current);
        }
        current.text += item.str;
        current.items.push(item);
        current.y = y;
    }
    return lines.map(l => ({ ...l, text: l.text.trim() })).filter(l => l.text);
}

// 雙欄判定：多數文字行在版面中央留有連續的欄間空白（gutter），而不是被切成兩段的單欄文字。
// ponytail: 欄間空白小於 2% 頁寬（A4 約 12pt）的緊排雙欄不會被判出，會維持逐列讀取；遇到再依字寬調整門檻。
function detectColumns(items, pageWidth) {
    if (!pageWidth || items.length < 8) return 1;
    const mid = pageWidth / 2;
    const minGutter = pageWidth * 0.02;
    const lines = buildLines(items, medianHeight(items) * 0.6);

    let bothSides = 0, withGutter = 0;
    lines.forEach(line => {
        if (line.items.some(i => isSpanning(i, pageWidth))) return;
        const before = line.items.filter(i => itemRight(i) <= mid);
        const after = line.items.filter(i => itemLeft(i) >= mid);
        if (!before.length || !after.length) return;
        bothSides++;
        const gutter = Math.min(...after.map(itemLeft)) - Math.max(...before.map(itemRight));
        if (gutter >= minGutter) withGutter++;
    });

    if (bothSides < 3 || withGutter / bothSides < 0.8) return 1;
    const left = items.filter(i => !isSpanning(i, pageWidth) && itemCenter(i) < mid).length;
    const right = items.filter(i => !isSpanning(i, pageWidth) && itemCenter(i) >= mid).length;
    return (left >= items.length * 0.25 && right >= items.length * 0.25) ? 2 : 1;
}

const PAGE_NUMBER_ONLY = /^[\s\-–—第]*\d{1,4}[\s\-–—頁]*$/;
const runningKey = text => text.replace(/\d+/g, '#').replace(/\s/g, '');

// 移除各頁重複出現的頁首／頁尾與純頁碼行。
export function stripRunningLines(pages, warnings = []) {
    const counts = new Map();
    pages.forEach(({ lines }) => {
        [lines[0], lines[lines.length - 1]].forEach(text => {
            if (!text) return;
            const key = runningKey(text);
            const seen = counts.get(key) || { count: 0, sample: text };
            seen.count++;
            counts.set(key, seen);
        });
    });

    const threshold = Math.max(3, Math.ceil(pages.length * 0.6));
    const repeated = new Set([...counts.entries()].filter(([, v]) => v.count >= threshold).map(([k]) => k));
    const removedSamples = [...counts.entries()].filter(([k]) => repeated.has(k)).map(([, v]) => v.sample);

    const out = [];
    pages.forEach(({ page, lines }) => {
        lines.forEach((text, i) => {
            const edge = i === 0 || i === lines.length - 1;
            if (edge && (repeated.has(runningKey(text)) || PAGE_NUMBER_ONLY.test(text))) return;
            out.push({ text, page, level: 0 });
        });
    });

    if (removedSamples.length) {
        warnings.push(`已移除重複頁首／頁尾：${removedSamples.slice(0, 3).join('、')}`);
    }
    return out;
}

export async function parseDocx(file, targetArray, fundType, budgetYear) {
    const reader = new FileReader();
    return new Promise((resolve) => {
        reader.onload = async (event) => {
            try {
                const arrayBuffer = event.target.result;
                const warnings = [];
                let lines = [];

                // 先試 Word 的標題樣式（標題 1／2／3），比純文字正規表示式可靠。
                try {
                    const html = (await mammoth.convertToHtml({ arrayBuffer })).value;
                    lines = linesFromHtml(html, warnings);
                } catch (e) {
                    warnings.push('Word 樣式解析失敗，改用純文字規則');
                }

                if (!lines.some(l => l.level > 0)) {
                    warnings.push('文件未使用 Word 標題樣式，改以文字規則判斷階層');
                    const raw = await mammoth.extractRawText({ arrayBuffer });
                    lines = toLines(raw.value);
                }
                extractData(lines, file.name, targetArray, fundType, budgetYear, warnings);
                resolve();
            } catch (error) {
                console.error('解析 DOCX 時發生錯誤:', file.name, error);
                fileList.innerHTML += `<p style="color:red;">讀取失敗: ${file.name}</p>`;
                resolve();
            }
        };
        reader.readAsArrayBuffer(file);
    });
}

// 將 mammoth 轉出的 HTML 轉成帶階層的行；h1/h2/h3 對應大／中／小標題。
function linesFromHtml(html, warnings = []) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (doc.querySelector('table')) warnings.push('文件含表格，表格內容以文字方式併入');
    const lines = [];
    doc.body.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, td, th').forEach(node => {
        const text = node.textContent.trim();
        if (!text) return;
        const heading = /^H([1-6])$/.exec(node.tagName);
        lines.push({ text, page: null, level: heading ? Math.min(Number(heading[1]), 3) : 0 });
    });
    return lines;
}

// 純文字（無樣式資訊）轉成行物件
export function toLines(text) {
    return String(text).split('\n').map(l => l.trim()).filter(Boolean)
        .map(text => ({ text, page: null, level: 0 }));
}

export function extractData(input, fileName, targetArray, fundType, budgetYear, warnings = []) {
    const regexSet = REGEX_SETS[fundType] || REGEX_SETS['作業基金'];
    const { main: mainTitleRegex, sub: subTitleRegex, subSub: subSubTitleRegex, sectionTwoIdentifier } = regexSet;

    // 相容舊呼叫方式：直接傳入純文字
    const allLines = typeof input === 'string' ? toLines(input) : input.filter(l => l && l.text);
    if (allLines.length === 0) return;

    let fundName = fileName.replace(/\.(pdf|docx)$/i, '');
    let fundNameSource = 'file-name';
    let startIndex = 0;

    for (let i = 0; i < Math.min(allLines.length, 5); i++) {
        const text = allLines[i].text;
        if (mainTitleRegex.test(text.replace(/\s/g, ''))) break;
        if (text.includes('基金')) {
            fundName = text.replace(/\s/g, '');
            fundNameSource = 'document-leading-line';
            startIndex = i + 1;
            break;
        }
    }
    if (fundNameSource === 'file-name') warnings.push('基金名稱由檔名推定，請確認是否正確');

    const flatData = [];
    let currentMain = '', currentSub = '', currentSubSub = '';
    let contentBuffer = [];
    let sectionPage = allLines[startIndex]?.page ?? null;

    function pushContent() {
        if (!currentMain && !currentSub && !currentSubSub && contentBuffer.length === 0) return;

        let content = contentBuffer.join('').replace(/\s/g, '');
        if (currentMain) {
            const isSectionTwo = sectionTwoIdentifier.test(currentMain);
            if (isSectionTwo && currentSub === '' && currentSubSub === '') {
                content = "[表格內容，已於程式中略過]";
            } else if (content) {
                content = content.replace(/。/g, '。\n');
            }
        }

        if (currentMain || currentSub || currentSubSub || content) {
            flatData.push({ main: currentMain, sub: currentSub, subSub: currentSubSub, content, page: sectionPage });
        }
        contentBuffer = [];
    }

    for (let i = startIndex; i < allLines.length; i++) {
        const { text: line, level, page } = allLines[i];
        const normalizedLine = line.replace(/\s/g, '');
        // 有 Word 標題樣式就相信樣式，否則退回文字規則。
        const isMain = level === 1 || (!level && mainTitleRegex.test(normalizedLine));
        const isSub = level === 2 || (!level && subTitleRegex.test(normalizedLine));
        const isSubSub = level === 3 || (!level && subSubTitleRegex.test(normalizedLine));

        if (isMain) {
            pushContent();
            currentMain = line; currentSub = ''; currentSubSub = ''; sectionPage = page;
        } else if (isSub) {
            pushContent();
            currentSub = line; currentSubSub = ''; sectionPage = page;
        } else if (isSubSub) {
            pushContent();
            currentSubSub = line; sectionPage = page;
        } else {
            if (!contentBuffer.length && page != null) sectionPage = page;
            contentBuffer.push(line);
        }
    }
    pushContent();

    const structured = flatData.filter(item => item.main || item.sub || item.subSub || item.content);
    if (!structured.some(item => item.main)) warnings.push('未辨識到任何大標題，階層可能不完整');

    targetArray.push({
        fundName, budgetYear, fundType,
        structured,
        sourceFile: fileName,
        fundNameSource,
        extractionWarnings: warnings,
        isDataSet: true
    });
}

export function looksLikeSourceFileName(name) {
    const value = String(name || '').trim();
    return /^(?:of|sf)?\d{2,3}[a-z]{0,3}[-_]/i.test(value) || /\.(?:pdf|docx?|json)$/i.test(value);
}

export function normalizeFundName(fund) {
    const originalName = String(fund.fundName || '').trim();
    if (!looksLikeSourceFileName(originalName)) return fund;

    // 部分舊資料解析時，真正基金名稱被放在 structured 第一筆內容中，fundName 則誤用來源檔名。
    const candidates = Array.isArray(fund.structured)
        ? fund.structured
            .filter(item => !item.main && !item.sub && !item.subSub)
            .map(item => String(item.content || '').replace(/\s+/g, '').trim())
            .filter(text => text && text.length <= 40 && /基金$/.test(text))
        : [];

    if (candidates.length) {
        return { ...fund, fundName: candidates[0], originalFundName: originalName };
    }
    return fund;
}

export function cleanTitle(fullTitle) {
    if (!fullTitle) return '';
    const match = fullTitle.match(/^[\(（][一二三四五六七八九十]+[\)）]|^[一二三四五六七八九十壹貳參肆伍陸柒捌玖拾]+、|^\d+\./);
    if (match) {
        return fullTitle.substring(match[0].length).trim();
    }
    return fullTitle;
}
