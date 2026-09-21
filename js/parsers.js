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
                let fullText = '';
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    const items = textContent.items;
                    if (items.length === 0) continue;
                    items.sort((a, b) => {
                        if (a.transform[5] > b.transform[5]) return -1;
                        if (a.transform[5] < b.transform[5]) return 1;
                        if (a.transform[4] < b.transform[4]) return -1;
                        if (a.transform[4] > b.transform[4]) return 1;
                        return 0;
                    });
                    let pageText = '';
                    if (items.length > 0) {
                        let lastY = items[0].transform[5];
                        for (const item of items) {
                            if (Math.abs(item.transform[5] - lastY) > 5) pageText += '\n';
                            pageText += item.str;
                            lastY = item.transform[5];
                        }
                    }
                    fullText += pageText + '\n\n';
                }
                extractData(fullText, file.name, targetArray, fundType, budgetYear);
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
                const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
                extractData(result.value, file.name, targetArray, fundType, budgetYear);
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

export function extractData(text, fileName, targetArray, fundType, budgetYear) {
    const regexSet = REGEX_SETS[fundType] || REGEX_SETS['作業基金'];
    const { main: mainTitleRegex, sub: subTitleRegex, subSub: subSubTitleRegex, sectionTwoIdentifier } = regexSet;

    const allLines = text.split('\n').map(line => line.trim()).filter(Boolean);
    if (allLines.length === 0) return;

    let fundName = fileName.replace(/\.(pdf|docx)$/i, '');
    let startIndex = 0;
    
    for (let i = 0; i < Math.min(allLines.length, 5); i++) {
        if (!mainTitleRegex.test(allLines[i].replace(/\s/g, ''))) {
            if (allLines[i].includes('基金')) {
                fundName = allLines[i].replace(/\s/g, '');
                startIndex = i + 1;
                break;
            }
        } else {
            break;
        }
    }

    const flatData = [];
    let currentMain = '', currentSub = '', currentSubSub = '';
    let contentBuffer = [];

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
            flatData.push({ main: currentMain, sub: currentSub, subSub: currentSubSub, content: content });
        }
        contentBuffer = [];
    }

    for (let i = startIndex; i < allLines.length; i++) {
        const line = allLines[i];
        const normalizedLine = line.replace(/\s/g, '');

        if (mainTitleRegex.test(normalizedLine)) {
            pushContent();
            currentMain = line;
            currentSub = ''; currentSubSub = '';
        } else if (subTitleRegex.test(normalizedLine)) {
            pushContent();
            currentSub = line;
            currentSubSub = '';
        } else if (subSubTitleRegex.test(normalizedLine)) {
            pushContent();
            currentSubSub = line;
        } else {
            contentBuffer.push(line);
        }
    }
    pushContent();

    targetArray.push({
        fundName, budgetYear, fundType,
        structured: flatData.filter(item => item.main || item.sub || item.subSub || item.content),
        sourceFile: fileName,
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
