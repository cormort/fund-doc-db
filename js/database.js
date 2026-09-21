// 資料庫：JSON 驗證、匯入合併、匯出 JSON／Excel、資料摘要
import { exportExcelBtn, exportJsonBtn, fileList, globalControlsPanel, loader } from './dom.js';
import { normalizeFundName } from './parsers.js';
import { initializeFilters } from './query.js';
import { appState, markDirty, showToast } from './state.js';

// 匯入階段就把資料標準化，避免查詢時才因欄位型別異常而中斷。
export function validateAndNormalizeFund(rawFund, fileName, index) {
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

export function readJsonFile(file) {
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

export async function importJsonFiles(fileListInput) {
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
    [...appState.funds, ...incoming].forEach(fund => {
        const id = [fund.budgetYear || '', fund.fundType || '', fund.fundName || ''].join('||');
        if (byId.has(id)) replaced++;
        byId.set(id, fund);
    });
    appState.funds = [...byId.values()];
    loader.style.display = 'none';
    globalControlsPanel.style.display = appState.pendingFiles.length ? 'flex' : 'none';
    markDirty();
    fileList.innerHTML = `<p style="color:var(--success-color)">✓ 已讀取 ${files.length} 個 JSON，讀入 ${incoming.length} 筆，取代重複 ${replaced} 筆，合併後共 ${appState.funds.length} 筆。</p>` +
        (errors.length ? `<p style="color:var(--danger-color)">⚠ ${errors.join('<br>')}</p>` : '');
    if (appState.funds.length) initializeFilters();
    updateDataSummary();
    showToast(errors.length ? `匯入完成，但有 ${errors.length} 個檔案無法讀取` : `成功匯入 ${files.length} 個 JSON 檔案`, !!errors.length);
}

export function updateDataSummary() {
    const box = document.getElementById('data-summary');
    const years = new Set(appState.funds.map(f => f.budgetYear).filter(Boolean));
    const types = new Set(appState.funds.map(f => f.fundType).filter(Boolean));
    box.innerHTML = appState.funds.length
        ? `<strong>${appState.funds.length}</strong> 筆基金資料 · <strong>${years.size}</strong> 個年度 · <strong>${types.size}</strong> 種屬性`
          + ` <span id="dirty-badge" style="color:var(--danger-color);display:none;">● 有尚未儲存的變更</span>`
        : '<span>目前資料庫尚無資料</span>';
    const badge = document.getElementById('dirty-badge');
    if (badge) badge.style.display = appState.isDirty ? 'inline' : 'none';
}

exportJsonBtn.addEventListener('click', () => {
    if (appState.funds.length === 0) {
        alert("目前資料庫沒有可儲存的資料。");
        return;
    }
    const dataToExport = appState.funds.map(({ isDataSet, ...rest }) => rest);
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
