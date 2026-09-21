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

                    const viewport = page.getViewport({ scale: 1 });
                    const { lines, columns, table } = extractPageLines(items, viewport.width);
                    if (columns > 1) twoColumnPages.push(pageNo);
                    if (table) tablePages.push(pageNo);
                    pages.push({
                        page: pageNo,
                        height: viewport.height,
                        lines,
                        cells: items.map(i => ({ s: i.str, x: itemLeft(i), y: i.transform[5], w: i.width || 0, page: pageNo }))
                    });
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
                extractData(stripRunningLines(pages, warnings), file.name, targetArray, fundType, budgetYear, warnings,
                    pages.flatMap(pg => pg.cells));
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
    const toLine = ({ text, y, items: parts }) => ({ text, y, cells: parts.map(i => ({ s: i.str, x: itemLeft(i), w: i.width || 0 })) });
    const rowWise = () => ({ lines: buildLines(items, lineGap).map(toLine), columns: 1 });

    const gutter = findGutter(items, pageWidth);
    if (!gutter) return rowWise();

    // 表格同樣有欄間空白，但欄位必須逐列一起讀，重排會拆散同一列資料。
    if (looksLikeTable(items, pageWidth)) return { ...rowWise(), table: true };

    // ponytail: 假設跨欄的行是頁面上方標題；若正文中間插入跨欄標題會被排到最前面，
    // 屆時再改成以跨欄行切分區塊（band）處理。
    const spanning = items.filter(i => isSpanning(i, pageWidth, gutter));
    const rest = items.filter(i => !isSpanning(i, pageWidth, gutter));
    const left = rest.filter(i => itemRight(i) <= gutter.end);
    const right = rest.filter(i => itemRight(i) > gutter.end);

    return {
        lines: [spanning, left, right].flatMap(group => buildLines(group, lineGap).map(toLine)),
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

// 跨欄：文字橫跨欄間空白（沒有 gutter 時退回以版面中央帶判斷）
function isSpanning(item, pageWidth, gutter = null) {
    const lo = gutter ? gutter.start : pageWidth * 0.45;
    const hi = gutter ? gutter.end : pageWidth * 0.55;
    return itemLeft(item) < lo && itemRight(item) > hi;
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

// 雙欄判定：版面中央必須有一條「幾乎沒有文字跨越」的連續空白（gutter）。
// 逐列檢查會被內文的隨機換行空隙誤導，改以整頁掃描中央區域找真正的欄間空白。
// ponytail: 只處理兩欄；三欄以上或欄寬不對稱的版面會判為單欄（逐列讀取），是安全的退路。
function detectColumns(items, pageWidth) {
    return findGutter(items, pageWidth) ? 2 : 1;
}

// 回傳中央區域的欄間空白 { start, end }，找不到則回傳 null。
function findGutter(items, pageWidth) {
    if (!pageWidth || items.length < 8) return null;
    const lines = buildLines(items, medianHeight(items) * 0.6);
    if (lines.length < 6) return null;

    const crossTolerance = Math.max(1, Math.floor(lines.length * 0.1)); // 容許少數跨欄標題
    const minGutter = pageWidth * 0.02;
    let best = null;

    for (let x = pageWidth * 0.35; x <= pageWidth * 0.65; x += 2) {
        const crossing = lines.filter(l => l.items.some(i => itemLeft(i) < x && itemRight(i) > x)).length;
        if (crossing > crossTolerance) continue;

        const clear = items.filter(i => !(itemLeft(i) < x && itemRight(i) > x));
        const before = clear.filter(i => itemRight(i) <= x);
        const after = clear.filter(i => itemLeft(i) >= x);
        if (before.length < items.length * 0.25 || after.length < items.length * 0.25) continue;

        const start = Math.max(...before.map(itemRight));
        const end = Math.min(...after.map(itemLeft));
        if (end - start < minGutter) continue;
        if (!best || end - start > best.end - best.start) best = { start, end };
    }
    return best;
}

const PAGE_NUMBER_ONLY = /^[\s\-–—第]*\d{1,4}[\s\-–—頁]*$/;
const runningKey = text => text.replace(/\d+/g, '#').replace(/\s/g, '');

// 移除各頁重複出現的頁首／頁尾與純頁碼行。
// 只看版面上下緣 12% 範圍內的行，避免把正文首尾誤刪。
export function stripRunningLines(pages, warnings = []) {
    const inMargin = (line, height) => {
        if (line.y == null || !height) return false;
        return line.y >= height * 0.88 || line.y <= height * 0.12;
    };

    const counts = new Map();
    pages.forEach(({ lines, height }) => {
        lines.filter(l => inMargin(l, height)).forEach(({ text }) => {
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
    pages.forEach(({ page, lines, height }) => {
        lines.forEach(line => {
            const text = typeof line === 'string' ? line : line.text;
            const margin = typeof line === 'string' ? false : inMargin(line, height);
            if (margin && (repeated.has(runningKey(text)) || PAGE_NUMBER_ONLY.test(text))) return;
            out.push({ text, page, level: 0, cells: line.cells });
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

export function extractData(input, fileName, targetArray, fundType, budgetYear, warnings = [], tableCells = null) {
    const regexSet = REGEX_SETS[fundType] || REGEX_SETS['作業基金'];
    const { main: mainTitleRegex, sub: subTitleRegex, subSub: subSubTitleRegex, sectionTwoIdentifier } = regexSet;

    // 相容舊呼叫方式：直接傳入純文字
    const allLines = typeof input === 'string' ? toLines(input) : input.filter(l => l && l.text);
    if (allLines.length === 0) return;

    let fundName = fileName.replace(/\.(pdf|docx)$/i, '');
    let fundNameSource = 'file-name';
    let startIndex = 0;

    for (let i = 0; i < Math.min(allLines.length, 5); i++) {
        // 標題常以字距排版（「實 施 平 均 地 權 基 金」），一律先去掉空白再判斷。
        const normalized = allLines[i].text.replace(/\s/g, '');
        if (mainTitleRegex.test(normalized)) break;
        if (normalized.length <= 40 && /基金$/.test(normalized)) {
            fundName = normalized;
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
    // 「二、」表格：只有 PDF 帶得出文字座標，Word 仍維持原本的佔位字串。
    const sectionTwoTable = tableCells ? extractTable(tableCells) : null;
    if (sectionTwoTable && sectionTwoTable.issues.length) {
        warnings.push(`表格有 ${sectionTwoTable.issues.length} 個數值格式異常，請核對：${sectionTwoTable.issues.slice(0, 2).join('、')}`);
    }

    function pushContent() {
        if (!currentMain && !currentSub && !currentSubSub && contentBuffer.length === 0) return;

        let content = contentBuffer.join('').replace(/\s/g, '');
        if (currentMain) {
            const isSectionTwo = sectionTwoIdentifier.test(currentMain);
            if (isSectionTwo && currentSub === '' && currentSubSub === '') {
                content = sectionTwoTable ? sectionTwoTable.text : "[表格內容，已於程式中略過]";
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

    // 「二、」標題若與表格標題列同行而未被辨識為大標題，表格仍要保留，不能靜靜遺失。
    if (sectionTwoTable && !structured.some(item => sectionTwoIdentifier.test(item.main))) {
        const heading = allLines.map(l => l.text.replace(/\s/g, '')).find(t => /^二、/.test(t)) || '二、最近5年主要營運項目';
        structured.push({
            main: heading.replace(/^(二、[^0-9]*?(?:項目))(.*)$/, '$1'),
            sub: '', subSub: '', content: sectionTwoTable.text, page: null
        });
        warnings.push('「二、」標題與表格同行，已另外補上表格段落');
    }

    if (tableCells && !sectionTwoTable && structured.some(item => sectionTwoIdentifier.test(item.main))) {
        warnings.push('「二、最近5年主要營運項目」表格無法解析，內容以佔位字串取代');
    }
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

// ---- 「二、最近5年主要營運項目」表格解析 ----
// 表格以座標還原：年度標題列與「決算數／預算數」列給出欄位錨點，數值靠右對齊於各欄之內。
const YEAR_HEADER = /^(\d{2,3}年度){2,}$/;
const KIND_HEADER = /^(決算數|預算數)+$/;
const ITEM_UNIT_HEADER = /^項目單位$/;
const VALUE_PATTERN = /^(-|—|－|\d{1,3}(,\d{3})*(\.\d+)?|\(\d[\d,]*\))$/;
const strip = text => String(text).replace(/\s/g, '');

// 以已知欄數自我校驗的 x 分群：找出能剛好切出 expected 欄的間距門檻。
function clusterByGap(cells, expected) {
    const sorted = [...cells].sort((a, b) => a.x - b.x);
    for (const gap of [20, 25, 30, 35, 40, 45, 50]) {
        const out = [];
        let current = null;
        sorted.forEach(c => {
            if (!current || c.x - current.x > gap) { current = { x: c.x, parts: [c.s] }; out.push(current); }
            else current.parts.push(c.s);
        });
        if (out.length === expected) return out;
    }
    return null;
}

// 同列換行 vs 換列：行距通常呈雙峰，取兩群之間當分界。
function rowGapLimit(gaps, fallback = 12) {
    const sorted = gaps.filter(g => g >= 4).sort((a, b) => a - b);
    if (sorted.length < 2) return fallback;
    let best = { ratio: 1, at: -1 };
    for (let i = 1; i < sorted.length; i++) {
        const ratio = sorted[i] / sorted[i - 1];
        if (ratio > best.ratio) best = { ratio, at: i };
    }
    return best.ratio >= 1.6 ? (sorted[best.at] + sorted[best.at - 1]) / 2 : fallback;
}

function columnOf(centre, anchors, spacing, unitAnchor) {
    const lead = spacing * 0.1;   // 數字偶爾比欄寬略長，左緣容許一點溢出
    if (centre < unitAnchor - 10) return 'item';
    if (centre < anchors[0] - lead) return 'unit';
    let k = 0;
    anchors.forEach((a, i) => { if (centre >= a - lead) k = i; });
    return k;
}

// 從整份文件的原始文字座標中，解析「二、」與「三、」之間的表格。
// 產出 { text, issues, rows }；抓不到表格結構時回傳 null。
export function extractTable(cells) {
    if (!Array.isArray(cells) || !cells.length) return null;

    // 依「頁＋y」還原視覺列（各頁 y 座標各自獨立）
    const byLine = new Map();
    cells.filter(c => c.s.trim()).forEach(c => {
        const key = `${c.page || 1}:${Math.round(c.y)}`;
        if (!byLine.has(key)) byLine.set(key, []);
        byLine.get(key).push(c);
    });
    const merged = [];
    [...byLine.values()]
        .map(cs => ({ page: cs[0].page || 1, y: cs[0].y, cells: cs }))
        .sort((a, b) => (a.page - b.page) || (b.y - a.y))
        .forEach(row => {
            const last = merged[merged.length - 1];
            if (last && last.page === row.page && Math.abs(last.y - row.y) <= 3) last.cells.push(...row.cells);
            else merged.push(row);
        });
    const allRows = merged.map(r => {
        const cells = r.cells.sort((a, b) => a.x - b.x);
        return { page: r.page, y: r.y, cells, txt: strip(cells.map(c => c.s).join('')) };
    });

    // 取出「二、」到「三、」之間的列
    const from = allRows.findIndex(r => /^二、/.test(r.txt));
    if (from < 0) return null;
    const rest = allRows.slice(from + 1);
    const to = rest.findIndex(r => /^三、/.test(r.txt));
    const region = to < 0 ? rest : rest.slice(0, to);
    if (!region.length) return null;

    const header = region.find(l => YEAR_HEADER.test(l.txt));
    const kindRow = region.find(l => KIND_HEADER.test(l.txt));
    const itemUnitRow = region.find(l => ITEM_UNIT_HEADER.test(l.txt));
    if (!header || !kindRow) return null;

    const years = clusterByGap(header.cells, header.txt.match(/\d{2,3}年度/g).length);
    if (!years || years.length < 2) return null;

    const anchors = years.map(y => y.x);
    const spacing = anchors[1] - anchors[0];
    // 「決算數／預算數」碎片依最近的年度錨點歸欄，避免另行分群產生錯位
    const kindParts = anchors.map(() => []);
    kindRow.cells.forEach(c => {
        let k = 0;
        anchors.forEach((a, i) => { if (Math.abs(c.x - a) < Math.abs(c.x - anchors[k])) k = i; });
        kindParts[k].push(c.s);
    });
    const labels = anchors.map((_, i) => strip(years[i].parts.join('')) + strip(kindParts[i].join('')));
    const unitCell = itemUnitRow && itemUnitRow.cells.find(c => strip(c.s).startsWith('單'));
    const unitAnchor = unitCell ? unitCell.x
        : itemUnitRow ? Math.max(...itemUnitRow.cells.map(c => c.x))
        : anchors[0] - 40;

    const isHeaderRow = l => YEAR_HEADER.test(l.txt) || KIND_HEADER.test(l.txt) || ITEM_UNIT_HEADER.test(l.txt);
    const body = region.filter(l => !isHeaderRow(l));
    const limit = rowGapLimit(body.slice(1).map((l, i) => body[i].y - l.y));

    const groups = [];
    let group = null, lastY = null;
    body.forEach(l => {
        if (!group || lastY - l.y > limit) { group = [l]; groups.push(group); }
        else group.push(l);
        lastY = l.y;
    });

    const issues = [];
    const rendered = [['項目', '單位', ...labels].join('｜')];
    groups.forEach(g => {
        const buckets = { item: [], unit: [] };
        anchors.forEach((_, i) => { buckets[i] = []; });
        g.forEach(l => l.cells.forEach(c =>
            buckets[columnOf(c.x + c.w / 2, anchors, spacing, unitAnchor)].push(c)));

        const join = list => strip(list.sort((a, b) => (b.y - a.y) || (a.x - b.x)).map(c => c.s).join(''));
        const item = join(buckets.item);
        const unit = join(buckets.unit);
        const values = anchors.map((_, i) => join(buckets[i]));
        if (!item && values.every(v => !v)) return;
        // 註解與說明文字橫跨整個表格寬度，整列合併而不分欄
        const noValues = values.every(v => !v || !VALUE_PATTERN.test(v));
        if (/^註/.test(item) || (noValues && /[、。「」（）]/.test(item + values.join('')))) {
            rendered.push(strip(g.flatMap(l => l.cells).sort((a, b) => (b.y - a.y) || (a.x - b.x)).map(c => c.s).join('')));
            return;
        }

        values.forEach((v, i) => { if (v && !VALUE_PATTERN.test(v)) issues.push(`${item}／${labels[i]}＝${v}`); });
        rendered.push([item, unit, ...values].join('｜'));
    });

    if (rendered.length < 2) return null;
    return { text: rendered.join('\n'), issues, rows: rendered.length - 1 };
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
