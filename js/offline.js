// オフライン学習: カードの画像とデータを、この端末に保存しておき、通信できないときに使う
// 画像は Cache Storage（/offline-img/<キー>）、データ（カード・カテゴリー・メモ・国の情報）は同じ Cache の JSON に保存する。
// 配信は sw.js が行う（/offline-img/ を保存済みの画像で返す）
const CACHE = 'geochecker-offline-v1';
const DATA_URL = '/offline-data/all.json';
const AT_KEY = 'geo-cards-offline-at';
export const offlineSupported = () => 'caches' in window;
export const offlineSavedAt = () => { try { return Number(localStorage.getItem(AT_KEY)) || 0; } catch { return 0; } };
const keyUrl = (key) => `/offline-img/${encodeURIComponent(key)}`;

// state: { cards, categories, countryNotes(Map), facts(Map<key, Map<code, value>>), urls(Map<key, url>) }
export async function saveOffline(state, onProgress = () => {}) {
  const cache = await caches.open(CACHE);
  const entries = [...state.urls].filter(([, url]) => url && !String(url).startsWith('/offline-img/'));
  let done = 0;
  let failed = 0;
  const saved = [];
  const queue = entries.slice();
  const worker = async () => {
    while (queue.length) {
      const [key, url] = queue.shift();
      try {
        const res = await fetch(url, { mode: 'cors' });
        if (!res.ok) throw new Error(String(res.status));
        await cache.put(keyUrl(key), res);
        saved.push(key);
      } catch { failed++; }
      onProgress(++done, entries.length);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  const data = {
    savedAt: Date.now(),
    cards: state.cards,
    categories: state.categories,
    countryNotes: [...(state.countryNotes || [])],
    facts: [...(state.facts || [])].map(([k, m]) => [k, [...m]]),
    images: saved,
  };
  await cache.put(DATA_URL, new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }));
  try { localStorage.setItem(AT_KEY, String(data.savedAt)); } catch { /* 無視 */ }
  return { images: saved.length, failed, cards: state.cards.length };
}

// 保存したデータを読む（なければ null）。画像の URL は /offline-img/ に差し替える
export async function loadOffline() {
  if (!offlineSupported()) return null;
  try {
    const cache = await caches.open(CACHE);
    const res = await cache.match(DATA_URL);
    if (!res) return null;
    const d = await res.json();
    return {
      savedAt: d.savedAt,
      cards: d.cards,
      categories: d.categories,
      countryNotes: new Map(d.countryNotes || []),
      facts: new Map((d.facts || []).map(([k, arr]) => [k, new Map(arr)])),
      urls: new Map((d.images || []).map((k) => [k, keyUrl(k)])),
    };
  } catch { return null; }
}

export async function clearOffline() {
  try { await caches.delete(CACHE); localStorage.removeItem(AT_KEY); } catch { /* 無視 */ }
}
