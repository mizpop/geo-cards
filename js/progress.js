// カードごとの覚え具合（この端末のブラウザに保存）
// 箱（box）0〜5 の間隔反復: 覚えた / 正解で 1 段上がり、まだ / 不正解で 0 に戻る。
// 段ごとに次に出すまでの間隔を空け、期限が来たカードを「復習」に出す

const KEY = 'geo-cards-progress-v1';
const DAY = 24 * 60 * 60 * 1000;
const INTERVALS = [0, 1, 3, 7, 16, 35].map((d) => d * DAY); // 段 → 次に出すまで
export const MAX_BOX = INTERVALS.length - 1;

let data = (() => {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
})();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* 保存できなくても続行 */ } };
// 別のタブで記録したときも反映
window.addEventListener('storage', (e) => {
  if (e.key !== KEY) return;
  try { data = JSON.parse(e.newValue) || {}; } catch { /* そのまま */ }
});

export const getProg = (id) => data[id] || null;

// result: 'ok'（覚えた・正解） / 'partial'（部分正解） / 'ng'（まだ・不正解）
export function record(id, result) {
  const now = Date.now();
  const p = data[id] || { box: 0, ok: 0, ng: 0 };
  if (result === 'ok') { p.box = Math.min(MAX_BOX, p.box + 1); p.ok++; }
  else if (result === 'partial') { p.box = Math.max(0, p.box - 1); p.ng++; }
  else { p.box = 0; p.ng++; }
  p.seen = now;
  p.due = now + INTERVALS[p.box];
  data[id] = p;
  save();
  return p;
}

// 復習の対象: まだ一度も覚え具合をつけていない（新しい）カードか、次に出す期限が来たカード
export const isDue = (id, now = Date.now()) => !data[id] || data[id].due <= now;

// 苦手さ（大きいほど苦手）: 段が低く、不正解が多いほど高い。未学習は中くらい
export function weakness(id) {
  const p = data[id];
  if (!p) return 0.6;
  return (MAX_BOX - p.box) / MAX_BOX + p.ng / (p.ok + p.ng + 1) + (p.due <= Date.now() ? 0.3 : 0);
}

// 復習の順番: 期限が来た学習済みのカード（段が低い順・期限の古い順）→ 新しいカード
export function reviewOrder(ids) {
  const now = Date.now();
  const due = ids.filter((id) => data[id] && data[id].due <= now)
    .sort((a, b) => data[a].box - data[b].box || data[a].due - data[b].due);
  const fresh = ids.filter((id) => !data[id]);
  return [...due, ...fresh];
}

export function stats(ids) {
  const now = Date.now();
  let due = 0; let fresh = 0; let learned = 0;
  for (const id of ids) {
    const p = data[id];
    if (!p) fresh++;
    else {
      if (p.due <= now) due++;
      if (p.box >= 3) learned++;
    }
  }
  return { due, fresh, learned, total: ids.length };
}

// 習熟度の表示（●○ で段を表す）
export function levelHtml(id) {
  const p = data[id];
  const box = p ? p.box : 0;
  const dots = Array.from({ length: MAX_BOX }, (_, i) => `<i class="${i < box ? 'on' : ''}"></i>`).join('');
  const title = p ? `習熟度 ${box} / ${MAX_BOX}・覚えた / 正解 ${p.ok} 回・まだ / 不正解 ${p.ng} 回` : 'まだ覚え具合をつけていないカード';
  return `<span class="srs-level" title="${title}">${dots}<span class="srs-text">${p ? `${p.ok}○ ${p.ng}✗` : '新しいカード'}</span></span>`;
}

/* ---------------- 学習の記録（毎日の数・地域ごとの正答率。この端末に保存） ---------------- */
const ACT_KEY = 'geo-cards-activity-v1';
let act = (() => {
  try { return JSON.parse(localStorage.getItem(ACT_KEY)) || { days: {}, regions: {} }; } catch { return { days: {}, regions: {} }; }
})();
window.addEventListener('storage', (e) => {
  if (e.key !== ACT_KEY) return;
  try { act = JSON.parse(e.newValue) || { days: {}, regions: {} }; } catch { /* そのまま */ }
});
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// ok: 覚えた・正解なら true / region: 地域 id（あれば地域ごとの正答率に）
export function logActivity(ok, region) {
  const k = dayKey();
  const d = act.days[k] || { n: 0, ok: 0 };
  d.n++;
  if (ok) d.ok++;
  act.days[k] = d;
  if (region) {
    const r = act.regions[region] || { n: 0, ok: 0 };
    r.n++;
    if (ok) r.ok++;
    act.regions[region] = r;
  }
  try { localStorage.setItem(ACT_KEY, JSON.stringify(act)); } catch { /* 保存できなくても続行 */ }
}
export const activity = () => act;
// 連続して学習した日数（今日まだなら昨日まででも数える）
export function streak() {
  let n = 0;
  const d = new Date();
  if (!act.days[dayKey(d)]) d.setDate(d.getDate() - 1);
  while (act.days[dayKey(d)]?.n) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
export function resetActivity() {
  act = { days: {}, regions: {} };
  try { localStorage.removeItem(ACT_KEY); } catch { /* 無視 */ }
}

/* ---------------- よく間違える組み合わせ（正解の国と答えた国のペア） ---------------- */
export function logConfusion(right, given) {
  if (!right || !given || right === given) return;
  const k = [right, given].sort().join('|');
  act.conf = act.conf || {};
  act.conf[k] = (act.conf[k] || 0) + 1;
  try { localStorage.setItem(ACT_KEY, JSON.stringify(act)); } catch { /* 無視 */ }
}
export const confusions = () => Object.entries(act.conf || {}).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ pair: k.split('|'), n }));

/* ---------------- タイムアタックの自己ベスト（表示名ごと） ---------------- */
const BEST_KEY = 'geo-cards-best-v1';
export function saveBest(key, score) {
  let all = {};
  try { all = JSON.parse(localStorage.getItem(BEST_KEY)) || {}; } catch { /* 空 */ }
  const prev = all[key] ?? null;
  if (prev === null || score > prev) {
    all[key] = score;
    try { localStorage.setItem(BEST_KEY, JSON.stringify(all)); } catch { /* 無視 */ }
  }
  return prev;
}
