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
                const lines = [];
                const warnings = [];
                const emptyPages = [];

                for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
                    const page = await pdf.getPage(pageNo);
                    const items = (await page.getTextContent()).items.filter(i => i.str.trim());
                    if (!items.length) { emptyPages.push(pageNo); continue; }

                    items.sort((a, b) => (b.transform[5] - a.transform[5]) || (a.transform[4] - b.transform[4]));

                    // 以本頁字高中位數推估換行門檻，取代固定 5pt
                    const heights = items.map(i => Math.abs(i.height || i.transform[3]) || 0).filter(Boolean).sort((a, b) => a - b);
                    const lineGap = (heights[Math.floor(heights.length / 2)] || 10) * 0.6;

                    let buffer = '';
                    let lastY = items[0].transform[5];
                    for (const item of items) {
                        if (Math.abs(item.transform[5] - lastY) > lineGap) {
                            if (buffer.trim()) lines.push({ text: buffer.trim(), page: pageNo, level: 0 });
                            buffer = '';
                        }
                        buffer += item.str;
                        lastY = item.transform[5];
                    }
                    if (buffer.trim()) lines.push({ text: buffer.trim(), page: pageNo, level: 0 });
                }

                if (emptyPages.length) {
                    warnings.push(`第 ${emptyPages.join('、')} 頁沒有可擷取文字（可能為掃描影像或圖表）`);
                }
                extractData(lines, file.name, targetArray, fundType, budgetYear, warnings);
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
