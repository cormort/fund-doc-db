// 應用狀態、異動旗標、外部套件檢查、Toast 訊息

if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.worker.min.js`;
}

export const appState = {
    funds: [],
    pendingFiles: [],
    isDirty: false,
    results: [],
    page: 1,
    pageSize: 50
};

export function markDirty(dirty = true) {
    appState.isDirty = dirty;
    const badge = document.getElementById('dirty-badge');
    if (badge) badge.style.display = dirty ? 'inline' : 'none';
}
window.addEventListener('beforeunload', e => {
    if (!appState.isDirty) return;
    e.preventDefault();
    e.returnValue = '';
});

export function checkDependencies() {
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

export function showToast(message, isError = false) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast show${isError ? ' error' : ''}`;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.className = 'toast', 3200);
}
