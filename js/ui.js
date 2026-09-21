// 介面組裝：分頁、拖放區、欄寬調整、側欄、事件綁定（進入點）
import { importJsonFiles, updateDataSummary, validateAndNormalizeFund } from './database.js';
import { autoSaveToggle, dropZone, fileInput, fileList, fundContentDisplay, fundFilter, fundSelector, globalControlsPanel, importJsonBtn, jsonInput, mainTitleFilter, searchBtn, searchKeywordInput, subSubTitleFilter, subTitleFilter, yearFilter } from './dom.js';
import { handleFiles, routeIncomingFiles } from './files.js';
import { initializeFilters, refreshAvailableYearSelector, updateAndFilter } from './query.js';
import { appState, checkDependencies, markDirty, showToast } from './state.js';
import { autoSaveEnabled, clearSnapshot, loadSnapshot, saveSnapshot, setAutoSaveEnabled } from './storage.js';

export function openTab(evt, tabName) {
    let i, tabcontent, tablinks;
    tabcontent = document.getElementsByClassName("tab-content");
    for (i = 0; i < tabcontent.length; i++) tabcontent[i].style.display = "none";
    tablinks = document.getElementsByClassName("tab-button");
    for (i = 0; i < tablinks.length; i++) tablinks[i].className = tablinks[i].className.replace(" active", "");
    document.getElementById(tabName).style.display = "block";
    evt.currentTarget.className += " active";
}

export function setupDragAndDrop() {
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

export function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }
dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) handleFiles(e.target.files);
});

// --- DATA MANAGEMENT AND UI LOGIC ---

importJsonBtn.addEventListener('click', () => jsonInput.click());
jsonInput.addEventListener('change', async (event) => {
    await importJsonFiles(event.target.files);
    jsonInput.value = '';
});

export function resizableGrid(table) {
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
    if (!appState.funds.length || !confirm('確定要清空目前資料庫嗎？此動作不會刪除已下載的 JSON 備份。')) return;
    appState.funds = []; appState.pendingFiles = [];
    clearSnapshot();
    fileList.innerHTML = ''; globalControlsPanel.style.display = 'none'; document.getElementById('pending-files-summary').textContent = '請先上傳 PDF 或 DOCX 檔案。';
    fundSelector.innerHTML = ''; fundContentDisplay.textContent = '請先載入資料。';
    markDirty(false);
    refreshAvailableYearSelector(); updateDataSummary(); updateAndFilter(); showToast('已清空目前資料庫');
});
document.getElementById('reset-filters-btn').addEventListener('click', () => {
    [yearFilter, fundFilter, mainTitleFilter, subTitleFilter, subSubTitleFilter].forEach(x => x.value = 'all');
    searchKeywordInput.value = ''; updateAndFilter(); showToast('已重設篩選條件');
});

export function setSidebarCollapsed(collapsed) {
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
    document.querySelectorAll('.tab-button[data-tab]').forEach(btn =>
        btn.addEventListener('click', evt => openTab(evt, btn.dataset.tab)));
    resizableGrid(document.getElementById('search-results-table'));

    autoSaveToggle.checked = autoSaveEnabled();
    autoSaveToggle.addEventListener('change', () => {
        setAutoSaveEnabled(autoSaveToggle.checked);
        if (autoSaveToggle.checked) { saveSnapshot(); showToast('已開啟本機自動保存'); }
        else { clearSnapshot(); showToast('已關閉本機自動保存並清除本機備份'); }
    });
    restoreSnapshot();
});

// 開啟自動保存時，重新載入頁面即還原上次的資料庫內容。
async function restoreSnapshot() {
    if (!autoSaveEnabled()) return;
    const snapshot = await loadSnapshot();
    if (!snapshot || !Array.isArray(snapshot.funds) || !snapshot.funds.length) return;
    try {
        appState.funds = snapshot.funds.map((f, i) => validateAndNormalizeFund(f, '本機自動保存', i));
    } catch (e) {
        showToast(`本機自動保存內容無法讀取：${e.message}`, true);
        return;
    }
    initializeFilters();
    updateDataSummary();
    markDirty(false);
    showToast(`已還原本機自動保存的 ${appState.funds.length} 筆資料（${new Date(snapshot.savedAt).toLocaleString()}）`);
}

export const filterControls = document.getElementById('filter-controls');
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
