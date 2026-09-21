if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.worker.min.js`;
}

window.fundsData = [];
window.pendingFiles = [];
window.isDatabaseDirty = false;

function markDirty(dirty = true) {
    window.isDatabaseDirty = dirty;
    const badge = document.getElementById('dirty-badge');
    if (badge) badge.style.display = dirty ? 'inline' : 'none';
}
window.addEventListener('beforeunload', e => {
    if (!window.isDatabaseDirty) return;
    e.preventDefault();
    e.returnValue = '';
});

function checkDependencies() {
    const missing = [];
    if (!window.pdfjsLib) missing.push('PDF.js');
    if (!window.mammoth) missing.push('Mammoth');
    if (!window.XLSX) missing.push('SheetJS');
    if (!missing.length) return;
    const bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;padding:10px;background:#c0392b;color:#fff;text-align:center;font-size:14px;';
    bar.textContent = `缺少必要元件：${missing.join('、')}。請確認網路連線（本工具的解析／匯出功能需要載入 CDN 套件）。`;
    document.body.prepend(bar);
}

// DOM Elements
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const jsonInput = document.getElementById('json-input');
const importJsonBtn = document.getElementById('import-json-btn');
const exportJsonBtn = document.getElementById('export-json-btn');
const exportExcelBtn = document.getElementById('export-excel-btn');
const globalControlsPanel = document.getElementById('global-controls-panel');
const yearSelector = document.getElementById('year-selector');
const fundTypeSelector = document.getElementById('fund-type-selector');
const confirmSetupBtn = document.getElementById('confirm-setup-btn');
const fileList = document.getElementById('file-list');
const loader = document.getElementById('loader');
const fundSelector = document.getElementById('fund-selector'); 
const fundContentDisplay = document.getElementById('fund-content-display');
const searchKeywordInput = document.getElementById('search-keyword');
const searchBtn = document.getElementById('search-btn');
const searchResultsBody = document.getElementById('search-results-body');
const yearFilter = document.getElementById('year-filter');
const fundFilter = document.getElementById('fund-filter');
const mainTitleFilter = document.getElementById('main-title-filter');
const subTitleFilter = document.getElementById('sub-title-filter');
const subSubTitleFilter = document.getElementById('sub-sub-title-filter');

const REGEX_SETS = {
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

function openTab(evt, tabName) {
    let i, tabcontent, tablinks;
    tabcontent = document.getElementsByClassName("tab-content");
    for (i = 0; i < tabcontent.length; i++) tabcontent[i].style.display = "none";
    tablinks = document.getElementsByClassName("tab-button");
    for (i = 0; i < tablinks.length; i++) tablinks[i].className = tablinks[i].className.replace(" active", "");
    document.getElementById(tabName).style.display = "block";
    evt.currentTarget.className += " active";
}

function setupDragAndDrop() {
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
        document.body.addEventListener(eventName, preventDefaults, false);
    });
    ['dragenter', 'dragover'].forEach(eventName => dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'), false));
    ['dragleave', 'drop'].forEach(eventName => dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'), false));
    dropZone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        if (dt.files && dt.files.length > 0) routeIncomingFiles(dt.files);
    }, false);
}

function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }
dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) handleFiles(e.target.files);
});

function handleFiles(files) {
    window.pendingFiles = Array.from(files).filter(file => ['pdf', 'docx', 'doc'].includes(file.name.split('.').pop().toLowerCase()));
    fileList.innerHTML = '';
    window.pendingFiles.forEach(file => {
        const fileType = file.name.split('.').pop().toLowerCase();
        if (fileType === 'doc') {
             fileList.innerHTML += `<p style="color:orange;">待處理 (請先轉為.docx): ${file.name}</p>`;
        } else {
             fileList.innerHTML += `<p>待處理: ${file.name}</p>`;
        }
    });

    if (window.pendingFiles.length > 0) {
        globalControlsPanel.style.display = 'flex';
        document.getElementById('pending-files-summary').textContent = `本批次共 ${window.pendingFiles.length} 個 PDF／DOCX 待設定與解析。`;
        yearSelector.innerHTML = '<option value="">請先載入資料</option>';
        yearSelector.disabled = true;
        searchResultsBody.innerHTML = `<tr><td colspan="7" style="text-align:center;">請為新載入的 ${window.pendingFiles.length} 個基金應用年度和屬性。</td></tr>`;
    }
}

confirmSetupBtn.addEventListener('click', async () => {
    if (window.pendingFiles.length === 0) {
        alert("沒有待處理的檔案。請先拖曳檔案。");
        return;
    }

    let selectedYear = yearSelector.value;
    const selectedType = fundTypeSelector.value;
    if (!selectedYear) {
        selectedYear = prompt('目前尚無可選年度，請輸入本批檔案的民國預算年度（例如 115）：', '')?.trim() || '';
        if (!/^\d{2,3}$/.test(selectedYear)) {
            alert('請輸入正確的民國年度。');
            return;
        }
        selectedYear = String(Number(selectedYear)).padStart(3, '0');
    }
    
    loader.style.display = 'block';
    fileList.innerHTML = '';

    let newFunds = [];
    const filePromises = window.pendingFiles.map(async (file) => {
        const fileType = file.name.split('.').pop().toLowerCase();
        fileList.innerHTML += `<p>處理中 (${fileType}): ${file.name}</p>`;

        if (fileType === 'pdf') {
            await parsePdf(file, newFunds, selectedType, selectedYear);
        } else if (fileType === 'docx') {
            await parseDocx(file, newFunds, selectedType, selectedYear);
        } else if (fileType === 'doc') {
            fileList.innerHTML += `<p style="color:red;">無法處理: ${file.name} (.doc 格式不支援，請先另存為 .docx)</p>`;
        } else {
             fileList.innerHTML += `<p style="color:orange;">跳過不支援的檔案: ${file.name}</p>`;
        }
    });

    await Promise.all(filePromises);
    
    window.fundsData.push(...newFunds.map(normalizeFundName));
    window.pendingFiles = [];
    if (newFunds.length) markDirty();

    loader.style.display = 'none';
    if(newFunds.length > 0) {
         initializeFilters();
    }
});

async function parsePdf(file, targetArray, fundType, budgetYear) {
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

async function parseDocx(file, targetArray, fundType, budgetYear) {
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

function extractData(text, fileName, targetArray, fundType, budgetYear) {
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

// --- DATA MANAGEMENT AND UI LOGIC ---

importJsonBtn.addEventListener('click', () => jsonInput.click());
jsonInput.addEventListener('change', async (event) => {
    await importJsonFiles(event.target.files);
    jsonInput.value = '';
});

function looksLikeSourceFileName(name) {
    const value = String(name || '').trim();
    return /^(?:of|sf)?\d{2,3}[a-z]{0,3}[-_]/i.test(value) || /\.(?:pdf|docx?|json)$/i.test(value);
}

function normalizeFundName(fund) {
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

// 匯入階段就把資料標準化，避免查詢時才因欄位型別異常而中斷。
function validateAndNormalizeFund(rawFund, fileName, index) {
    if (!rawFund || typeof rawFund !== 'object' || Array.isArray(rawFund)) {
        throw new Error(`第 ${index + 1} 筆不是有效物件`);
    }
    const fundName = String(rawFund.fundName ?? '').trim();
    if (!fundName) throw new Error(`第 ${index + 1} 筆缺少 fundName`);
    const structured = (Array.isArray(rawFund.structured) ? rawFund.structured : [])
        .filter(item => item && typeof item === 'object')
        .map(item => ({
            main: String(item.main ?? '').trim(),
            sub: String(item.sub ?? '').trim(),
            subSub: String(item.subSub ?? '').trim(),
            content: String(item.content ?? '')
        }));
    if (!structured.length) throw new Error(`第 ${index + 1} 筆（${fundName}）缺少 structured 資料`);
    return normalizeFundName({
        fundName,
        budgetYear: String(rawFund.budgetYear ?? '').trim(),
        fundType: String(rawFund.fundType ?? '').trim(),
        sourceFile: String(rawFund.sourceFile ?? fileName).trim(),
        structured,
        isDataSet: true
    });
}

function readJsonFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => {
            try {
                const parsed = JSON.parse(e.target.result);
                const rows = Array.isArray(parsed) ? parsed
                    : (parsed && Array.isArray(parsed.funds)) ? parsed.funds
                    : null;
                if (!rows) throw new Error('根層級必須是陣列，或含 funds 陣列的物件');
                resolve(rows.map((fund, i) => validateAndNormalizeFund(fund, file.name, i)));
            } catch (err) { reject(new Error(`${file.name}：${err.message}`)); }
        };
        reader.onerror = () => reject(new Error(`${file.name}：讀取失敗`));
        reader.readAsText(file);
    });
}

async function importJsonFiles(fileListInput) {
    const files = Array.from(fileListInput || []).filter(f => f.name.toLowerCase().endsWith('.json'));
    if (!files.length) return;
    loader.style.display = 'block';
    const results = await Promise.allSettled(files.map(readJsonFile));
    const incoming = results.filter(r => r.status === 'fulfilled').flatMap(r => r.value);
    const errors = results.filter(r => r.status === 'rejected').map(r => r.reason.message);
    // 以「年度＋屬性＋基金名稱」作為紀錄識別碼；同一筆基金若再次匯入，以較新版本取代舊版本。
    // ponytail: 單純「後蓋前」，不做三選一策略；真要保留多版本再加 UI。
    const byId = new Map();
    let replaced = 0;
    [...window.fundsData, ...incoming].forEach(fund => {
        const id = [fund.budgetYear || '', fund.fundType || '', fund.fundName || ''].join('||');
        if (byId.has(id)) replaced++;
        byId.set(id, fund);
    });
    window.fundsData = [...byId.values()];
    loader.style.display = 'none';
    globalControlsPanel.style.display = window.pendingFiles.length ? 'flex' : 'none';
    markDirty();
    fileList.innerHTML = `<p style="color:var(--success-color)">✓ 已讀取 ${files.length} 個 JSON，讀入 ${incoming.length} 筆，取代重複 ${replaced} 筆，合併後共 ${window.fundsData.length} 筆。</p>` +
        (errors.length ? `<p style="color:var(--danger-color)">⚠ ${errors.join('<br>')}</p>` : '');
    if (window.fundsData.length) initializeFilters();
    updateDataSummary();
    showToast(errors.length ? `匯入完成，但有 ${errors.length} 個檔案無法讀取` : `成功匯入 ${files.length} 個 JSON 檔案`, !!errors.length);
}

function routeIncomingFiles(inputFiles) {
    const files = Array.from(inputFiles);
    const jsonFiles = files.filter(f => f.name.toLowerCase().endsWith('.json'));
    const sourceFiles = files.filter(f => !f.name.toLowerCase().endsWith('.json'));
    if (jsonFiles.length) importJsonFiles(jsonFiles);
    if (sourceFiles.length) handleFiles(sourceFiles);
}

function updateDataSummary() {
    const box = document.getElementById('data-summary');
    const years = new Set(window.fundsData.map(f => f.budgetYear).filter(Boolean));
    const types = new Set(window.fundsData.map(f => f.fundType).filter(Boolean));
    box.innerHTML = window.fundsData.length
        ? `<strong>${window.fundsData.length}</strong> 筆基金資料 · <strong>${years.size}</strong> 個年度 · <strong>${types.size}</strong> 種屬性`
          + ` <span id="dirty-badge" style="color:var(--danger-color);display:none;">● 有尚未儲存的變更</span>`
        : '<span>目前資料庫尚無資料</span>';
    const badge = document.getElementById('dirty-badge');
    if (badge) badge.style.display = window.isDatabaseDirty ? 'inline' : 'none';
}

function showToast(message, isError = false) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast show${isError ? ' error' : ''}`;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.className = 'toast', 3200);
}

exportJsonBtn.addEventListener('click', () => {
    if (window.fundsData.length === 0) {
        alert("目前資料庫沒有可儲存的資料。");
        return;
    }
    const dataToExport = window.fundsData.map(({ isDataSet, ...rest }) => rest);
    const jsonString = JSON.stringify(dataToExport, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `基金資料匯出_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    markDirty(false);
    updateDataSummary();
    showToast('已儲存 JSON 資料庫');
});

exportExcelBtn.addEventListener('click', () => {
    const table = document.getElementById('search-results-table');
    const rows = table.querySelectorAll('tbody > tr');
    if (rows.length === 0 || (rows.length === 1 && rows[0].children[0].colSpan > 1)) {
         alert("沒有可匯出的查詢結果。");
        return;
    }
    
    const data = [];
    const header = [];
    table.querySelectorAll('thead th').forEach(th => header.push(th.textContent));
    data.push(header);

    rows.forEach(row => {
        const rowData = [];
        row.querySelectorAll('td').forEach(td => {
            rowData.push(td.textContent);
        });
        data.push(rowData);
    });

    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "查詢結果");
    XLSX.writeFile(wb, `查詢結果_${new Date().toISOString().slice(0,10)}.xlsx`);
});

function populatePreviewDropdown() {
     fundSelector.innerHTML = '<option value="">--- 請選擇 ---</option>';
     window.fundsData.forEach((fund, index) => {
        const displayText = `[${fund.budgetYear || 'N/A'}] [${fund.fundType || '作業基金'}] - ${fund.fundName}`;
        fundSelector.add(new Option(displayText, index));
     });
     if(fundSelector.options.length > 1) {
        fundSelector.selectedIndex = 1;
        fundSelector.dispatchEvent(new Event('change'));
     }
}

fundSelector.addEventListener('change', (e) => {
    const selectedIndex = e.target.value;
    if (selectedIndex && window.fundsData[selectedIndex]) {
        const fund = window.fundsData[selectedIndex];
        let previewText = `預算年度: ${fund.budgetYear || 'N/A'}\n基金屬性: ${fund.fundType || '作業基金'}\n基金名稱: ${fund.fundName}\n來源檔案: ${fund.sourceFile}\n\n--- 結構化內容 ---\n\n`;
        fund.structured.forEach(item => {
            if (item.main) previewText += `${item.main}\n`;
            if (item.sub) previewText += `  ${item.sub}\n`;
            if (item.subSub) previewText += `    ${item.subSub}\n`;
            if (item.content) previewText += `      --> ${item.content.replace(/\n\s*/g, '\n          ')}\n\n`;
            else previewText += `\n`;
        });
        fundContentDisplay.textContent = previewText;
    } else {
         fundContentDisplay.textContent = '請從上方選擇一個基金進行預覽。';
    }
});

function refreshAvailableYearSelector() {
    const years = [...new Set(window.fundsData.map(f => String(f.budgetYear || '').trim()).filter(Boolean))]
        .sort((a, b) => Number(b) - Number(a));
    const current = yearSelector.value;
    yearSelector.innerHTML = '';
    years.forEach(year => yearSelector.add(new Option(year, year)));
    yearSelector.disabled = years.length === 0;
    if (!years.length) yearSelector.add(new Option('尚無資料年度', ''));
    else if (years.includes(current)) yearSelector.value = current;
}

function initializeFilters() {
    refreshAvailableYearSelector();
    populatePreviewDropdown();
    updateAndFilter();
}

function updateDropdown(selectElement, items, selectedValue, allLabel, cleanFn = null) {
    selectElement.innerHTML = `<option value="all">${allLabel}</option>`;
    const uniqueItems = [...new Set(items)].filter(Boolean).sort();
    
    uniqueItems.forEach(item => {
        const optionText = cleanFn ? cleanFn(item) : item;
        selectElement.add(new Option(optionText, item));
    });
    if (Array.from(selectElement.options).some(opt => opt.value === selectedValue)) {
        selectElement.value = selectedValue;
    } else {
        selectElement.value = 'all';
    }
}

function updateAndFilter() {
    const selectedYear = yearFilter.value;
    const selectedFund = fundFilter.value;
    const selectedMain = mainTitleFilter.value;
    const selectedSub = subTitleFilter.value;
    const selectedSubSub = subSubTitleFilter.value;

    // Step 1: Filter by Year
    let dataAfterYear = window.fundsData.filter(f => f.isDataSet);
    if (selectedYear && selectedYear !== 'all') {
        dataAfterYear = dataAfterYear.filter(f => f.budgetYear === selectedYear);
    }
    updateDropdown(yearFilter, window.fundsData.map(f => f.budgetYear), selectedYear, '所有年度', null);
    
    // Step 2: Filter by Fund Name
    let dataAfterFund = dataAfterYear;
    if (selectedFund && selectedFund !== 'all') {
        dataAfterFund = dataAfterFund.filter(f => f.fundName === selectedFund);
    }
    window.fundsData = window.fundsData.map(normalizeFundName);
    updateDropdown(fundFilter, dataAfterYear.map(f => normalizeFundName(f).fundName), selectedFund, '所有基金', null);
    
    // Step 3: Filter by Main Title
    let structuredAfterMain = dataAfterFund.flatMap(f => f.structured);
    if (selectedMain && selectedMain !== 'all') {
        structuredAfterMain = structuredAfterMain.filter(i => i.main === selectedMain);
    }
    updateDropdown(mainTitleFilter, dataAfterFund.flatMap(f => f.structured).map(i => i.main), selectedMain, '所有大標題', cleanTitle);
    
    // Step 4: Filter by Sub Title
    let structuredAfterSub = structuredAfterMain;
    if (selectedSub && selectedSub !== 'all') {
        structuredAfterSub = structuredAfterSub.filter(i => i.sub === selectedSub);
    }
    updateDropdown(subTitleFilter, structuredAfterMain.map(i => i.sub), selectedSub, '所有中標題', cleanTitle);
    
    // Step 5: Filter by Sub-Sub Title
    let structuredAfterSubSub = structuredAfterSub;
    if (selectedSubSub && selectedSubSub !== 'all') {
        structuredAfterSubSub = structuredAfterSubSub.filter(i => i.subSub === selectedSubSub);
    }
    updateDropdown(subSubTitleFilter, structuredAfterSub.map(i => i.subSub), selectedSubSub, '所有小標題', cleanTitle);
    
    renderTable();
}

function renderTable() {
    const selectedYear = yearFilter.value;
    const selectedFundName = fundFilter.value;
    const selectedMain = mainTitleFilter.value;
    const selectedSub = subTitleFilter.value;
    const selectedSubSub = subSubTitleFilter.value;
    const keyword = searchKeywordInput.value.trim().toLowerCase();
    
    searchResultsBody.innerHTML = '';
    let found = false;
    
    let fundsToSearch = window.fundsData.filter(f => f.isDataSet);
     if (selectedYear !== 'all') fundsToSearch = fundsToSearch.filter(f => f.budgetYear === selectedYear);
     if (selectedFundName !== 'all') fundsToSearch = fundsToSearch.filter(f => f.fundName === selectedFundName);
    
    fundsToSearch.forEach(fund => {
        (Array.isArray(fund.structured) ? fund.structured : []).forEach(item => {
            const mainTitleMatch = selectedMain === 'all' || item.main === selectedMain;
            if (!mainTitleMatch) return;

            const subTitleMatch = selectedSub === 'all' || item.sub === selectedSub;
            if (!subTitleMatch) return;

            const subSubTitleMatch = selectedSubSub === 'all' || item.subSub === selectedSubSub;
            if (!subSubTitleMatch) return;
            
            const content = String(item.content ?? '');
            if (!content.trim()) return;
            if (keyword && !content.toLowerCase().includes(keyword)) return;
            
            found = true;

            const row = searchResultsBody.insertRow();
            row.insertCell().textContent = fund.budgetYear || 'N/A';
            row.insertCell().textContent = fund.fundType || '作業基金';
            row.insertCell().textContent = fund.fundName;
            row.insertCell().textContent = item.main || '';
            row.insertCell().textContent = item.sub || '';
            row.insertCell().textContent = item.subSub || '';
            const pre = document.createElement('pre');
            appendHighlightedText(pre, content, keyword);
            row.insertCell().appendChild(pre);
        });
    });

    if (!found) {
        searchResultsBody.innerHTML = `<tr><td colspan="7" style="text-align:center;">在此篩選條件下找不到結果。</td></tr>`;
    }
}

// 以文字節點建構醒目標示，避免把文件內容當成 HTML 執行。
function appendHighlightedText(container, content, keyword) {
    container.textContent = '';
    if (!keyword) { container.textContent = content; return; }
    const lowerContent = content.toLowerCase();
    const lowerKeyword = keyword.toLowerCase();
    let start = 0, index;
    while ((index = lowerContent.indexOf(lowerKeyword, start)) !== -1) {
        container.appendChild(document.createTextNode(content.slice(start, index)));
        const mark = document.createElement('mark');
        mark.className = 'highlight';
        mark.textContent = content.slice(index, index + keyword.length);
        container.appendChild(mark);
        start = index + keyword.length;
    }
    container.appendChild(document.createTextNode(content.slice(start)));
}

function cleanTitle(fullTitle) {
    if (!fullTitle) return '';
    const match = fullTitle.match(/^[\(（][一二三四五六七八九十]+[\)）]|^[一二三四五六七八九十壹貳參肆伍陸柒捌玖拾]+、|^\d+\./);
    if (match) {
        return fullTitle.substring(match[0].length).trim();
    }
    return fullTitle;
}

function resizableGrid(table) {
    const row = table.getElementsByTagName('tr')[0];
    const cols = row ? row.children : undefined;
    if (!cols) return;

    table.style.overflow = 'hidden';

    for (let i = 0; i < cols.length; i++) {
        const div = createDiv();
        cols[i].appendChild(div);
        setListeners(div);
    }

    function setListeners(div) {
        let pageX, curCol, nxtCol, curColWidth, nxtColWidth;

        div.addEventListener('mousedown', function(e) {
            e.preventDefault(); 
            curCol = e.target.parentElement;
            nxtCol = curCol.nextElementSibling;
            pageX = e.pageX;

            const padding = paddingDiff(curCol);

            curColWidth = curCol.offsetWidth - padding;
            if (nxtCol) nxtColWidth = nxtCol.offsetWidth - padding;
        });

        document.addEventListener('mousemove', function(e) {
            if (curCol) {
                const diffX = e.pageX - pageX;
                if (nxtCol) nxtCol.style.width = (nxtColWidth - (diffX)) + 'px';
                curCol.style.width = (curColWidth + diffX) + 'px';
            }
        });

        document.addEventListener('mouseup', function(e) {
            curCol = undefined; nxtCol = undefined; pageX = undefined;
            nxtColWidth = undefined; curColWidth = undefined;
        });
    }

    function createDiv() {
        const div = document.createElement('div');
        div.className = 'resize-handle';
        return div;
    }

    function paddingDiff(col) {
        const style = window.getComputedStyle(col, null);
        return parseInt(style.getPropertyValue('padding-left')) + parseInt(style.getPropertyValue('padding-right'));
    }
}

document.getElementById('clear-data-btn').addEventListener('click', () => {
    if (!window.fundsData.length || !confirm('確定要清空目前資料庫嗎？此動作不會刪除已下載的 JSON 備份。')) return;
    window.fundsData = []; window.pendingFiles = [];
    fileList.innerHTML = ''; globalControlsPanel.style.display = 'none'; document.getElementById('pending-files-summary').textContent = '請先上傳 PDF 或 DOCX 檔案。';
    fundSelector.innerHTML = ''; fundContentDisplay.textContent = '請先載入資料。';
    markDirty(false);
    refreshAvailableYearSelector(); updateDataSummary(); updateAndFilter(); showToast('已清空目前資料庫');
});
document.getElementById('reset-filters-btn').addEventListener('click', () => {
    [yearFilter, fundFilter, mainTitleFilter, subTitleFilter, subSubTitleFilter].forEach(x => x.value = 'all');
    searchKeywordInput.value = ''; updateAndFilter(); showToast('已重設篩選條件');
});

function setSidebarCollapsed(collapsed) {
    const main = document.getElementById('main-container');
    const btn = document.getElementById('sidebar-collapse-btn');
    main.classList.toggle('sidebar-collapsed', collapsed);
    btn.setAttribute('aria-expanded', String(!collapsed));
    btn.title = collapsed ? '展開左側選單' : '收合左側選單';
    btn.querySelector('.collapse-label').textContent = collapsed ? '展開' : '收合';
    try { localStorage.setItem('fundToolSidebarCollapsed', collapsed ? '1' : '0'); } catch(e) {}
}
document.getElementById('sidebar-collapse-btn').addEventListener('click', () => setSidebarCollapsed(!document.getElementById('main-container').classList.contains('sidebar-collapsed')));

document.addEventListener('DOMContentLoaded', () => {
    try { setSidebarCollapsed(localStorage.getItem('fundToolSidebarCollapsed') === '1'); } catch(e) { setSidebarCollapsed(false); }
    checkDependencies();
    setupDragAndDrop();
    resizableGrid(document.getElementById('search-results-table'));
});

const filterControls = document.getElementById('filter-controls');
// Dropdown filters trigger filtering immediately
filterControls.querySelectorAll('select').forEach(sel => {
    sel.addEventListener('change', updateAndFilter);
});
// Keyword search is triggered by button or Enter key
searchBtn.addEventListener('click', updateAndFilter);
searchKeywordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        updateAndFilter();
    }
});

