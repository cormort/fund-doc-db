// 本機自動保存：IndexedDB（單一 key 存整份資料庫）
// ponytail: 整份覆寫而非逐筆 upsert；資料量到數萬筆再改分筆存。
import { appState, showToast } from './state.js';

const DB_NAME = 'fund-doc-db';
const STORE = 'snapshot';
const KEY = 'funds';
const PREF_KEY = 'fundToolAutoSave';

export function autoSaveEnabled() {
    try { return localStorage.getItem(PREF_KEY) === '1'; } catch (e) { return false; }
}

export function setAutoSaveEnabled(on) {
    try { localStorage.setItem(PREF_KEY, on ? '1' : '0'); } catch (e) {}
}

function openDb() {
    return new Promise((resolve, reject) => {
        if (!window.indexedDB) return reject(new Error('此瀏覽器不支援 IndexedDB'));
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function tx(mode, run) {
    return openDb().then(db => new Promise((resolve, reject) => {
        const request = run(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    }));
}

export async function saveSnapshot() {
    if (!autoSaveEnabled()) return;
    const payload = {
        savedAt: new Date().toISOString(),
        funds: appState.funds.map(({ isDataSet, ...rest }) => rest)
    };
    try { await tx('readwrite', store => store.put(payload, KEY)); }
    catch (e) { showToast(`本機自動保存失敗：${e.message}`, true); }
}

export async function loadSnapshot() {
    try { return await tx('readonly', store => store.get(KEY)); }
    catch (e) { return null; }
}

export async function clearSnapshot() {
    try { await tx('readwrite', store => store.delete(KEY)); } catch (e) {}
}
