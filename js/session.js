// 再読み込みしても、開いていたクイズ・暗記の途中・ウィンドウなどを引き継ぐための保存（このタブの sessionStorage）
// タブを閉じると消える（新しく開いたタブは、まっさらから始まる）。Set / Map / Infinity も保存できる

const KEY = 'geochecker-session-v1';
const MAX_AGE = 12 * 60 * 60 * 1000; // 12 時間たったものは使わない

const encode = (k, v) => (v instanceof Set ? { $set: [...v] } : v instanceof Map ? { $map: [...v] } : v === Infinity ? { $inf: 1 } : v);
const decode = (k, v) => {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    if (Array.isArray(v.$set)) return new Set(v.$set);
    if (Array.isArray(v.$map)) return new Map(v.$map);
    if (v.$inf === 1) return Infinity;
  }
  return v;
};

export function saveSession(snapshot) {
  try { sessionStorage.setItem(KEY, JSON.stringify(snapshot, encode)); } catch { /* 容量不足・非対応でも動作は続ける */ }
}
export function loadSession() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const sn = JSON.parse(raw, decode);
    return sn && sn.v === 1 && Date.now() - (sn.at || 0) < MAX_AGE ? sn : null;
  } catch { return null; }
}
export function clearSession() {
  try { sessionStorage.removeItem(KEY); } catch { /* 無視 */ }
}
