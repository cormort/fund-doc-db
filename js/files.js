// 檔案進入點：拖放、待處理清單、年度屬性設定與解析
import { importJsonFiles } from './database.js';
import { confirmSetupBtn, fileList, fundTypeSelector, globalControlsPanel, loader, searchResultsBody, yearSelector } from './dom.js';
import { normalizeFundName, parseDocx, parsePdf } from './parsers.js';
import { initializeFilters } from './query.js';
import { appState, markDirty } from './state.js';
import { saveSnapshot } from './storage.js';

// .doc 是 Word 97-2003 的二進位格式，瀏覽器端無法解析；提供實際可用的批次轉檔指令。
export function docConversionHint() {
    const box = document.createElement('div');
    box.className = 'doc-hint';
    box.innerHTML = `<strong>.doc 需先轉為 .docx</strong>
        <p>單檔可用 Word 另存新檔；整批轉換可在終端機執行（需安裝 LibreOffice，35 份約 20 秒）：</p>`;
    const code = document.createElement('code');
    code.textContent = 'soffice --headless --convert-to docx --outdir converted *.doc';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'btn btn-ghost doc-hint-copy';
    copy.textContent = '複製指令';
    copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(code.textContent); copy.textContent = '已複製'; }
        catch (e) { copy.textContent = '請手動選取複製'; }
        setTimeout(() => { copy.textContent = '複製指令'; }, 2000);
    });
    box.append(code, copy);
    return box;
}

export function handleFiles(files) {
    appState.pendingFiles = Array.from(files).filter(file => ['pdf', 'docx', 'doc'].includes(file.name.split('.').pop().toLowerCase()));
    fileList.innerHTML = '';
    appState.pendingFiles.forEach(file => {
        const fileType = file.name.split('.').pop().toLowerCase();
        if (fileType === 'doc') {
             fileList.innerHTML += `<p style="color:orange;">待處理 (請先轉為.docx): ${file.name}</p>`;
        } else {
             fileList.innerHTML += `<p>待處理: ${file.name}</p>`;
        }
    });
    if (appState.pendingFiles.some(f => f.name.toLowerCase().endsWith('.doc'))) {
        fileList.appendChild(docConversionHint());
    }

    if (appState.pendingFiles.length > 0) {
        globalControlsPanel.style.display = 'flex';
        document.getElementById('pending-files-summary').textContent = `本批次共 ${appState.pendingFiles.length} 個 PDF／DOCX 待設定與解析。`;
        yearSelector.innerHTML = '<option value="">請先載入資料</option>';
        yearSelector.disabled = true;
        searchResultsBody.innerHTML = `<tr><td colspan="8" style="text-align:center;">請為新載入的 ${appState.pendingFiles.length} 個基金應用年度和屬性。</td></tr>`;
    }
}

confirmSetupBtn.addEventListener('click', async () => {
    if (appState.pendingFiles.length === 0) {
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
    let skippedDoc = false;
    const filePromises = appState.pendingFiles.map(async (file) => {
        const fileType = file.name.split('.').pop().toLowerCase();
        fileList.innerHTML += `<p>處理中 (${fileType}): ${file.name}</p>`;

        if (fileType === 'pdf') {
            await parsePdf(file, newFunds, selectedType, selectedYear);
        } else if (fileType === 'docx') {
            await parseDocx(file, newFunds, selectedType, selectedYear);
        } else if (fileType === 'doc') {
            fileList.innerHTML += `<p style="color:red;">無法處理: ${file.name}（.doc 為舊版格式，需先轉為 .docx）</p>`;
            skippedDoc = true;
        } else {
             fileList.innerHTML += `<p style="color:orange;">跳過不支援的檔案: ${file.name}</p>`;
        }
    });

    await Promise.all(filePromises);
    
    appState.funds.push(...newFunds.map(normalizeFundName));
    appState.pendingFiles = [];
    if (newFunds.length) { markDirty(); saveSnapshot(); }

    if (skippedDoc) fileList.appendChild(docConversionHint());

    newFunds.filter(f => f.extractionWarnings?.length).forEach(fund => {
        const li = document.createElement('p');
        li.style.color = 'orange';
        li.textContent = `⚠ ${fund.sourceFile}：${fund.extractionWarnings.join('；')}`;
        fileList.appendChild(li);
    });

    loader.style.display = 'none';
    if(newFunds.length > 0) {
         initializeFilters();
    }
});

export function routeIncomingFiles(inputFiles) {
    const files = Array.from(inputFiles);
    const jsonFiles = files.filter(f => f.name.toLowerCase().endsWith('.json'));
    const sourceFiles = files.filter(f => !f.name.toLowerCase().endsWith('.json'));
    if (jsonFiles.length) importJsonFiles(jsonFiles);
    if (sourceFiles.length) handleFiles(sourceFiles);
}
