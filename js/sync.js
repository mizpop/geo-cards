// 学習記録の端末間同期（引き継ぎコード）。記録は各端末のブラウザに保存したまま、サーバーを経由して他の端末とマージする
import { exportAll, mergeAll, onProgressChange } from './progress.js';

const CODE_KEY = 'geo-cards-sync-code-v1';
const AT_KEY = 'geo-cards-sync-at-v1';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 0 / O / 1 / I など、読み間違えやすい文字を除く 32 文字

export const normalizeCode = (text) => String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const formatCode = (code) => (code.match(/.{1,5}/g) || []).join('-');
export const isValidCode = (code) => /^[A-Z2-9]{20}$/.test(code);
export function newCode() {
  const a = new Uint8Array(20);
  crypto.getRandomValues(a);
  return Array.from(a, (x) => ALPHABET[x % 32]).join('');
}
export const getCode = () => { try { return localStorage.getItem(CODE_KEY) || ''; } catch { return ''; } };
export const lastSyncAt = () => { try { return Number(localStorage.getItem(AT_KEY)) || 0; } catch { return 0; } };
export function setCode(code) { try { localStorage.setItem(CODE_KEY, code); } catch { /* 無視 */ } }
export function clearCode() { try { localStorage.removeItem(CODE_KEY); localStorage.removeItem(AT_KEY); } catch { /* 無視 */ } }

const stable = (v) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

// 1 回の同期: サーバーの記録を取り込み（マージ）、違いがあればマージ後の記録を送り返す。戻り値: この端末の記録が変わったか
export async function syncNow(api) {
  const code = getCode();
  if (!code || typeof api?.syncGet !== 'function') return false;
  const remote = await api.syncGet(code);
  const changedLocal = mergeAll(remote?.data);
  const merged = exportAll();
  if (!remote || stable(remote.data) !== stable(merged)) await api.syncPut(code, merged);
  try { localStorage.setItem(AT_KEY, String(Date.now())); } catch { /* 無視 */ }
  return changedLocal;
}

// 自動同期: 起動時・記録が変わって少し経ったとき・画面に戻ってきたとき（1 分以上あいていれば）
let started = false;
export function startAutoSync(api, { onMerged, onError } = {}) {
  if (started || typeof api?.syncGet !== 'function') return;
  started = true;
  let timer = null;
  let busy = false;
  const run = async () => {
    if (busy || !getCode()) return;
    busy = true;
    try { if (await syncNow(api)) onMerged?.(); } catch (e) { onError?.(e); } finally { busy = false; }
  };
  onProgressChange(() => { if (!getCode()) return; clearTimeout(timer); timer = setTimeout(run, 8000); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastSyncAt() > 60000) run();
  });
  run();
}
