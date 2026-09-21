// 查詢頁：篩選條件連動、結果渲染、關鍵字醒目標示
import { fundContentDisplay, fundFilter, fundSelector, mainTitleFilter, searchKeywordInput, searchResultsBody, subSubTitleFilter, subTitleFilter, yearFilter, yearSelector } from './dom.js';
import { cleanTitle, normalizeFundName } from './parsers.js';
import { appState } from './state.js';

export function populatePreviewDropdown() {
     fundSelector.innerHTML = '<option value="">--- 請選擇 ---</option>';
     appState.funds.forEach((fund, index) => {
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
    if (selectedIndex && appState.funds[selectedIndex]) {
        const fund = appState.funds[selectedIndex];
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

export function refreshAvailableYearSelector() {
    const years = [...new Set(appState.funds.map(f => String(f.budgetYear || '').trim()).filter(Boolean))]
        .sort((a, b) => Number(b) - Number(a));
    const current = yearSelector.value;
    yearSelector.innerHTML = '';
    years.forEach(year => yearSelector.add(new Option(year, year)));
    yearSelector.disabled = years.length === 0;
    if (!years.length) yearSelector.add(new Option('尚無資料年度', ''));
    else if (years.includes(current)) yearSelector.value = current;
}

export function initializeFilters() {
    refreshAvailableYearSelector();
    populatePreviewDropdown();
    updateAndFilter();
}

export function updateDropdown(selectElement, items, selectedValue, allLabel, cleanFn = null) {
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

export function updateAndFilter() {
    const selectedYear = yearFilter.value;
    const selectedFund = fundFilter.value;
    const selectedMain = mainTitleFilter.value;
    const selectedSub = subTitleFilter.value;
    const selectedSubSub = subSubTitleFilter.value;

    // Step 1: Filter by Year
    let dataAfterYear = appState.funds.filter(f => f.isDataSet);
    if (selectedYear && selectedYear !== 'all') {
        dataAfterYear = dataAfterYear.filter(f => f.budgetYear === selectedYear);
    }
    updateDropdown(yearFilter, appState.funds.map(f => f.budgetYear), selectedYear, '所有年度', null);
    
    // Step 2: Filter by Fund Name
    let dataAfterFund = dataAfterYear;
    if (selectedFund && selectedFund !== 'all') {
        dataAfterFund = dataAfterFund.filter(f => f.fundName === selectedFund);
    }
    appState.funds = appState.funds.map(normalizeFundName);
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

export function renderTable() {
    const selectedYear = yearFilter.value;
    const selectedFundName = fundFilter.value;
    const selectedMain = mainTitleFilter.value;
    const selectedSub = subTitleFilter.value;
    const selectedSubSub = subSubTitleFilter.value;
    const keyword = searchKeywordInput.value.trim().toLowerCase();
    
    searchResultsBody.innerHTML = '';
    let found = false;
    
    let fundsToSearch = appState.funds.filter(f => f.isDataSet);
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
export function appendHighlightedText(container, content, keyword) {
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
