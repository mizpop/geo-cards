import { REGIONS, REGION_BY_ID, COUNTRIES, COUNTRY_BY_CODE, flagUrl, findCountry, searchCountries, searchText, normKana, hasKana, regionMatches, romajiLoose } from './countries.js';
import { initApi } from './api.js';
import { readClipboardImage, blobToDataUrl, dataUrlToBlob } from './image.js';
import { attachZoom } from './zoom.js';
import { editImage } from './annotate.js';
import { initChat, teardownChat, raiseChat } from './chat.js';
import { renderMap, refreshMap, plonkitUrl, isPlayable, focusOnNextRender, setTileStyle, removeSvPanel, countryAt } from './map.js';
import { COUNTRY_INFO, LANG_EN } from './countryinfo.js';
import { LANGS, LEFT_DRIVING } from './languages.js';
import { play, setMuted, playedRecently } from './sound.js';
import { getCode, setCode, clearCode, newCode, normalizeCode, formatCode, isValidCode, lastSyncAt, syncNow, startAutoSync } from './sync.js';
import { record, getProg, isDue, reviewOrder, weakness, stats as progStats, levelHtml, logActivity, activity, streak, dayKey, resetActivity, logConfusion, confusions, saveBest } from './progress.js';
import { mountQuizMap, nearestKm, mountPinMap, distanceBetween } from './quizmap.js';
import { REF_PAGES, REF_IMAGES, REF_BASE, refInfo, refInfoLoaded, ensureRefInfo } from './refimages.js';
import { setFacts, setCards as setInfoCards, CHEV_COLORS, typesOf, chevSignSvg, factOf, modeDef, MAP_MODES, classify, legendGroups, factPanelHtml } from './infomap.js';

/* ================= ユーティリティ ================= */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl2br = (s) => esc(s).replace(/\n/g, '<br>');

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

let toastTimer;
// お知らせ。編集画面などのモーダルより手前に出すため、ポップオーバー（最前面の層）として表示する
function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = msg;
  if (el.showPopover) {
    try {
      if (el.matches(':popover-open')) el.hidePopover();
      el.showPopover(); // 開くたびに最前面へ積み直す
    } catch { /* 非対応ブラウザは通常表示 */ }
  }
  el.className = `toast ${kind}`;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => { if (!el.classList.contains('show') && el.hidePopover && el.matches(':popover-open')) el.hidePopover(); }, 250);
  }, 3200);
}

function flagImg(code, cls = 'flag') {
  return `<img class="${cls}" src="${flagUrl(code)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`;
}
const countryName = (code) => COUNTRY_BY_CODE.get(code)?.ja ?? code;
// カテゴリー
const UNCAT = { id: 'none', name: '未分類', color: '#8a96a3' };
const catOf = (card) => (card.photo ? { id: `ref-${card.topic}`, name: `参考写真: ${modeDef(card.topic).name}`, color: '#868e96' } : (card.category_id && state.categories.find((c) => c.id === card.category_id)) || UNCAT);
const catKey = (card) => catOf(card).id;
// 背景色に対して読みやすい文字色（白 / 黒）
function textOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#fff';
  const n = parseInt(m[1], 16);
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.36 ? '#111' : '#fff';
}
const catVars = (cat) => `--cat:${cat.color};--cat-text:${textOn(cat.color)}`;
const catStyle = (card) => catVars(catOf(card));
function catBadge(card, cls = '') {
  const c = catOf(card);
  if (c === UNCAT) return '';
  return `<span class="cat-badge ${cls}" style="${catVars(c)}">${esc(c.name)}</span>`;
}
const allCats = () => [...state.categories, UNCAT];

const cardRegions = (card) => new Set(card.countries.map((c) => COUNTRY_BY_CODE.get(c)?.region).filter(Boolean));

/* ================= 状態 ================= */
let api;
const state = {
  user: null,
  cards: [],
  categories: [],
  countryNotes: new Map(), // 国ごとのメモ（code -> 文）
  urls: new Map(),
  urlsAt: 0,
  view: 'study',
  study: { regionsOff: new Set(), catsOff: new Set(), openPick: null, review: false, shuffled: false, deck: [], index: 0, flipped: false, enter: '' },
  quiz: { photoTopics: new Set(['bollard', 'pole', 'chevron', 'plate']), timeLimit: 0, kind: 'cards', factTopic: 'chevron', factDir: 'forward', order: 'random', phase: 'setup', regions: new Set(REGIONS.map((r) => r.id)), count: 10, catsOff: new Set(), mode: 'choice', questions: [], i: 0, answers: [], answered: null },
  search: { q: '', cat: null },
  mapMatch: {}, // 地図の「条件で絞り込み」の条件 { topic: key }
  compare: { codes: [], closed: new Set() }, // 比較タブで並べる国・閉じている項目
  lang: { q: '', chars: new Set(), open: new Set(['Latin']) }, // 言語タブ: 絞り込みの文字・開いている文字のまとまり
  mapFilter: { regionsOff: new Set(), catsOff: new Set(), openPick: null }, // 地図の絞り込み
  manage: { q: '', regionsOff: new Set(), catsOff: new Set(), openPick: null, sel: new Set(), anchor: null }, // sel: 選択中のカード id（まとめて削除・カテゴリー変更）
};
// 参考写真（GeoHints）もカードと同じように出題できるよう、id「ref|種類|国|番号」で疑似カードを作る
const PHOTO_TOPICS = ['bollard', 'pole', 'chevron', 'plate'];
const refCards = new Map();
function refCard(id) {
  if (refCards.has(id)) return refCards.get(id);
  const [, topic, code, i] = id.split('|');
  const rel = REF_IMAGES[topic]?.[code]?.[Number(i)];
  if (!rel) return undefined;
  const info = refInfo(topic, rel) || {};
  const card = { id, countries: [code], description: '', area: '', notes: '', category_id: null, created_at: '', photo: true, topic, src: REF_BASE + rel, lat: info.lat, lng: info.lng };
  if (refInfoLoaded()) refCards.set(id, card); // 座標などの情報を読み込む前に作った分は覚えない（あとで座標つきで作り直す）
  return card;
}
const cardById = (id) => state.cards.find((c) => c.id === id) || (String(id).startsWith('ref|') ? refCard(id) : undefined);
// クイズに出せる参考写真（選んだ種類・地域。「撮影地点を当てる」では座標のあるものだけ）
function photoPool(q) {
  const out = [];
  for (const t of q.photoTopics) for (const [code, list] of Object.entries(REF_IMAGES[t] || {})) {
    if (!q.regions.has(COUNTRY_BY_CODE.get(code)?.region)) continue;
    list.forEach((_, i) => { const c = refCard(`ref|${t}|${code}|${i}`); if (c && (q.mode !== 'pin' || c.lat != null)) out.push(c); });
  }
  return out;
}

/* ================= 設定（この端末のブラウザに保存） ================= */
const SETTINGS_KEY = 'geo-cards-settings-v1';
const DEFAULT_SETTINGS = {
  animations: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  theme: 'auto', // auto | light | dark
  studyStart: 'front', // 暗記カードで最初に見る面: front | back
  showDesc: true, // 表面に説明文を表示（暗記・クイズ）
  autoNext: false, // クイズで正解したら自動で次へ
  hoverExpand: true, // 地図: 国にマウスを乗せて止まると詳しいプレビューを表示
  cardSort: 'new', // 編集画面・検索結果の並び順（CARD_SORTS）
  mapTiles: 'en', // 地図の背景: en（国名・地名が英語表記）/ osm（OpenStreetMap・現地の言語）
  studySplit: false,
  studyPhotos: false, // 暗記に参考写真（GeoHints）も混ぜる
  mapMode: 'cards', // 地図の表示: カード / シェブロン / ガードレール / 通行 / 文字 / 苦手 // 暗記カード: 表面と裏面を左右に並べて表示（めくらない）
  liveSearch: true, // 地図: 検索バーに入力するたびに候補の国へ移動（オフなら Enter で移動）
  sound: true, // 効果音（右上のボタンでも切り替え）
  dailyGoal: 30, // 1 日の目標（暗記の「覚えた / まだ」とクイズの回答の数）
  keys: {}, // キー割り当て（DEFAULT_KEYS からの変更分）
};
let settings = (() => {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return { ...DEFAULT_SETTINGS }; }
})();
function applySettings() {
  const root = document.documentElement;
  root.classList.toggle('no-anim', !settings.animations);
  if (settings.theme === 'auto') delete root.dataset.theme;
  else root.dataset.theme = settings.theme;
  setMuted(!settings.sound);
  setTileStyle(settings.mapTiles);
  const sb = document.getElementById('sound-btn');
  if (sb) {
    sb.classList.toggle('is-muted', !settings.sound);
    sb.setAttribute('aria-pressed', String(!settings.sound));
    sb.title = settings.sound ? '効果音: オン（クリックでミュート）' : '効果音: ミュート中（クリックでオン）';
    sb.setAttribute('aria-label', settings.sound ? '効果音をミュート' : '効果音をオンにする');
  }
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* 保存できなくても動作は続ける */ }
  applySettings();
  updateSearchKeyHint();
}
applySettings();

function openSettings() {
  const seg = (key, opts) => `<div class="seg" data-key="${key}">${opts.map(([v, label]) => `<button type="button" class="${settings[key] === v ? 'on' : ''}" data-v="${v}">${label}</button>`).join('')}</div>`;
  const sw = (key) => `<label class="switch"><input type="checkbox" data-key="${key}" ${settings[key] ? 'checked' : ''}><span class="switch-track"><span class="switch-thumb"></span></span></label>`;
  // スイッチは右端に、選択肢は説明の下に横幅いっぱいで並べる
  const item = (title, desc, ctrl, stacked = false) => `
    <div class="set-item ${stacked ? 'set-item-stacked' : ''}">
      <div class="set-text"><div class="set-title">${title}</div>${desc ? `<div class="set-desc">${desc}</div>` : ''}</div>
      ${ctrl}
    </div>`;
  openModal(`
    <div class="modal-head"><h2>設定</h2><button class="icon-btn" data-close aria-label="閉じる">✕</button></div>
    <h3 class="set-group-title">🎨 表示</h3>
    <section class="set-group">
      ${item('アニメーション', 'めくる・スライド・飛び出す動きや地図のズーム', sw('animations'))}
      ${item('効果音', 'めくる・移動・ボタン・クイズの正解 / 不正解の音。右上の 🔊 ボタンでも切り替えられます', sw('sound'))}
      ${item('テーマ', '「自動」は端末のライト / ダークに合わせます', seg('theme', [['auto', '自動'], ['light', '☀ ライト'], ['dark', '☾ ダーク']]), true)}
    </section>
    <h3 class="set-group-title">🃏 暗記カード・クイズ</h3>
    <section class="set-group">
      ${item('最初に見る面', '「裏」から始めると、国名から特徴を思い出す練習に', seg('studyStart', [['front', '表（画像）'], ['back', '裏（国名）']]), true)}
      ${item('表面に説明文を表示', 'オフにすると画像だけで答える練習に', sw('showDesc'))}
      ${item('正解したら自動で次へ', 'クイズで ○ のとき 1.2 秒後に次の問題へ', sw('autoNext'))}
    </section>
    <h3 class="set-group-title">🗺 地図</h3>
    <section class="set-group">
      ${item('入力中に国へ移動', '地図の検索バーに入力するたびに、候補の国へ移動します。オフにすると Enter を押したときだけ移動します', sw('liveSearch'))}
      ${item('止まると詳しく表示', '国にマウスを乗せて 0.5 秒止まると、吹き出しに詳しい情報を出します。オフでも右クリックで表示できます', sw('hoverExpand'))}
      ${item('背景の地図', '英語表記: 国名・地名を英語で表示（Google マップに近い見た目）／ OpenStreetMap: 地名を現地の言語で表示', seg('mapTiles', [['en', '英語表記'], ['osm', 'OpenStreetMap']]), true)}
    </section>
    <h3 class="set-group-title">🔄 学習記録の同期</h3>
    <section class="set-group" id="sync-box"></section>
    <h3 class="set-group-title">⌨ キーボード操作</h3>
    <section class="set-group set-keys">
      ${KEY_ACTIONS.map(([act, label]) => `
        <div class="set-item set-key">
          <div class="set-text"><div class="set-title">${label}</div></div>
          <button type="button" class="icon-btn key-reset" data-reset="${act}" title="初期設定（${keyLabel(DEFAULT_KEYS[act])}）に戻す" aria-label="${label}のキーを初期設定に戻す">↺</button>
          <button type="button" class="keycap" data-act="${act}">${esc(keyLabel({ ...DEFAULT_KEYS, ...settings.keys }[act]))}</button>
        </div>`).join('')}
      <div class="key-reset-all-row"><button type="button" class="btn btn-ghost btn-sm" id="key-reset-all">⌨ キー設定をすべてリセット</button></div>
      <p class="key-dup-warn" id="key-dup-warn" hidden>⚠ 同じキーが複数の操作に割り当てられています（赤枠）。上にある操作が優先されます</p>
      <p class="set-desc set-key-note">ボタンを押してから割り当てたいキーを押します（Esc で取り消し）。<br>Ctrl・Alt との組み合わせも使えます（Ctrl / Alt を押したまま割り当てたいキー）。<br>そのほか: スペース / Enter でめくる・← → で移動・4択は 1〜4・Ctrl+K でも検索・地図ではそのまま文字を打つと国の検索・入力欄では Esc でキー操作に戻る</p>
    </section>
    <p class="muted small set-note">設定はこの端末のブラウザに保存されます</p>
    <div class="modal-foot set-foot">
      <button class="btn btn-ghost" id="set-reset" type="button">初期設定に戻す</button>
      <span class="grow"></span>
      <button class="btn btn-primary" data-close type="button">閉じる</button>
    </div>`, 'modal-settings');

  // 学習記録の同期（引き継ぎコード）: 覚え具合・毎日の記録・自己ベストを、PC とスマホなどで共有する
  const renderSyncBox = (msg = '', kind = '') => {
    const box = $('#sync-box');
    if (!box) return;
    const code = getCode();
    const at = lastSyncAt();
    const note = msg ? `<div class="set-desc sync-msg ${kind}">${esc(msg)}</div>` : '';
    box.innerHTML = typeof api.syncGet !== 'function' ? '<div class="set-item"><div class="set-text"><div class="set-desc">この環境では同期を使えません</div></div></div>' : !code ? `
      <div class="set-item set-item-stacked"><div class="set-text"><div class="set-title">引き継ぎコードで記録を共有</div>
        <div class="set-desc">「覚えた / まだ」・連続日数・毎日の回数・タイムアタックの自己ベストを、ほかの端末と共有します。1 台目で「コードを作る」を押し、表示されたコードを 2 台目の「コードを入力」に入力してください。${api.mode === 'demo' ? '（デモモードでは、このブラウザの中だけで試せます）' : ''}</div></div>
        <div class="sync-row"><button type="button" class="btn btn-primary btn-sm" id="sync-new">コードを作って同期を始める</button></div>
        <div class="sync-row"><input class="input sync-input" id="sync-code-in" placeholder="別の端末のコードを入力（例: ABCDE-FGHJK-…）" autocomplete="off" spellcheck="false"><button type="button" class="btn btn-sm" id="sync-join">この端末を同期する</button></div>${note}</div>` : `
      <div class="set-item set-item-stacked"><div class="set-text"><div class="set-title">同期中</div>
        <div class="set-desc">引き継ぎコード: <b class="sync-code" id="sync-code-view" data-shown="0">${esc(formatCode(code).replace(/[A-Z0-9]/g, (c, i) => (i < 5 ? c : '•')))}</b>
        <button type="button" class="link-btn" id="sync-show">表示</button> ・ <button type="button" class="link-btn" id="sync-copy">コピー</button><br>
        ${at ? `最後の同期: ${esc(fmtTime(new Date(at).toISOString()))}` : 'まだ同期していません'}</div></div>
        <div class="sync-row"><button type="button" class="btn btn-sm" id="sync-now">今すぐ同期</button><button type="button" class="btn btn-ghost btn-sm" id="sync-off">同期をやめる</button></div>${note}</div>`;
    const run = async (label, fn) => {
      const btns = $$('#sync-box button');
      btns.forEach((b) => { b.disabled = true; });
      try { await fn(); } catch (e) { renderSyncBox(`${label}に失敗しました: ${e.message}`, 'is-error'); return; }
    };
    const afterSync = (merged) => { if (merged) { rebuildStudyDeck(true); if (state.view !== 'quiz') render(); } };
    $('#sync-new')?.addEventListener('click', () => run('コードの作成', async () => {
      const c = newCode();
      setCode(c);
      try { afterSync(await syncNow(api)); } catch (e) { clearCode(); throw e; }
      renderSyncBox('コードを作りました。ほかの端末の「コードを入力」にこのコードを入れてください（「表示」で確認できます）', 'is-ok');
    }));
    $('#sync-join')?.addEventListener('click', () => run('同期', async () => {
      const c = normalizeCode($('#sync-code-in').value);
      if (!isValidCode(c)) throw new Error('コードは 20 文字です（ハイフンはあってもなくても大丈夫）');
      const remote = await api.syncGet(c);
      if (!remote) throw new Error('このコードの記録が見つかりません。1 台目で作ったコードか確認してください');
      setCode(c);
      afterSync(await syncNow(api));
      renderSyncBox('この端末の記録と合わせて同期しました', 'is-ok');
    }));
    $('#sync-now')?.addEventListener('click', () => run('同期', async () => { afterSync(await syncNow(api)); renderSyncBox('同期しました', 'is-ok'); }));
    $('#sync-off')?.addEventListener('click', () => { if (confirm('同期をやめますか？この端末の記録はそのまま残り、サーバーの記録も消えません')) { clearCode(); renderSyncBox(); } });
    $('#sync-show')?.addEventListener('click', () => {
      const el = $('#sync-code-view');
      const shown = el.dataset.shown === '1';
      el.dataset.shown = shown ? '0' : '1';
      el.textContent = shown ? formatCode(code).replace(/[A-Z0-9]/g, (c, i) => (i < 5 ? c : '•')) : formatCode(code);
      $('#sync-show').textContent = shown ? '表示' : '隠す';
    });
    $('#sync-copy')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(formatCode(code)); toast('コードをコピーしました'); } catch { toast('コピーできませんでした。「表示」で確認してください', 'error'); }
    });
  };
  renderSyncBox();
  const changed = () => { saveSettings(); };
  $$('#modal .switch input').forEach((cb) => cb.addEventListener('change', () => { settings[cb.dataset.key] = cb.checked; changed(); }));
  $$('#modal .seg').forEach((g) => g.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    settings[g.dataset.key] = b.dataset.v;
    $$('button', g).forEach((x) => x.classList.toggle('on', x === b));
    changed();
    if (g.dataset.key === 'mapTiles' && state.view === 'map') render(); // 背景の地図を作り直す
  }));
  // キーの割り当て変更: 次に押されたキーを記録。重複は赤枠で知らせる
  const drawKeycaps = () => {
    const keys = { ...DEFAULT_KEYS, ...settings.keys };
    const count = {};
    for (const k of Object.values(keys)) count[k] = (count[k] || 0) + 1;
    let dup = false;
    $$('#modal .keycap').forEach((x) => {
      if (x.classList.contains('is-capturing')) return;
      const code = keys[x.dataset.act];
      x.textContent = keyLabel(code);
      const isDup = count[code] > 1;
      x.classList.toggle('is-dup', isDup);
      x.title = isDup ? 'ほかの操作と同じキーです' : '';
      dup = dup || isDup;
    });
    // 初期設定と違う操作だけ個別リセットを押せるように
    $$('#modal .key-reset').forEach((r) => { r.disabled = keys[r.dataset.reset] === DEFAULT_KEYS[r.dataset.reset]; });
    $('#key-reset-all').disabled = Object.keys(DEFAULT_KEYS).every((k) => keys[k] === DEFAULT_KEYS[k]);
    $('#key-dup-warn').hidden = !dup;
  };
  drawKeycaps();
  $$('#modal .key-reset').forEach((r) => r.addEventListener('click', () => {
    const keys = { ...settings.keys };
    delete keys[r.dataset.reset];
    settings.keys = keys;
    saveSettings();
    drawKeycaps();
  }));
  $('#key-reset-all').addEventListener('click', () => {
    settings.keys = {};
    saveSettings();
    drawKeycaps();
    toast('キー設定を初期状態に戻しました');
  });
  $$('#modal .keycap').forEach((b) => b.addEventListener('click', () => {
    if (capturingKey) return;
    capturingKey = true;
    b.classList.add('is-capturing');
    b.textContent = 'キーを押す…';
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (MOD_KEYS.includes(e.key)) { b.textContent = `${comboOf(e).replace(/\+?(Control|Shift|Alt|Meta)(Left|Right)$/, '').split('+').join(' + ')} + …`; return; } // Ctrl などだけ押した段階では待つ
      window.removeEventListener('keydown', onKey, true);
      capturingKey = false;
      b.classList.remove('is-capturing');
      const keys = { ...DEFAULT_KEYS, ...settings.keys };
      const mod = e.ctrlKey || e.metaKey || e.altKey;
      if (e.key !== 'Escape' && e.code && (mod || !['Tab', 'Enter', 'Space'].includes(e.code))) {
        keys[b.dataset.act] = mod ? comboOf(e) : e.code;
        settings.keys = keys;
        saveSettings();
      } else if (e.key !== 'Escape') {
        toast('そのキーは割り当てられません', 'error');
      }
      drawKeycaps();
    };
    window.addEventListener('keydown', onKey, true);
  }));
  $('#set-reset').addEventListener('click', () => { settings = { ...DEFAULT_SETTINGS }; saveSettings(); openSettings(); });
  // 閉じたら現在の画面に反映
  $('#modal').addEventListener('close', () => {
    if (state.user) {
      if (state.view === 'study') { state.study.flipped = settings.studyStart === 'back'; }
      render();
    }
  }, { once: true });
}
const imgUrl = (card) => card.src || state.urls.get(card.id) || '';
// 一覧・地図などの小さい表示用の低画質版（まだ作っていないカードは元の画像）
const thumbUrl = (card) => card.src || state.urls.get(`${card.id}|thumb`) || imgUrl(card);
// 裏面だけに表示する書き込みのレイヤー（なければ ''）
const backUrl = (card) => (card.photo ? '' : state.urls.get(`${card.id}|back`) || '');

/* ================= 起動・ログイン ================= */
async function boot() {
  fillDatalists();
  try {
    api = await initApi();
  } catch (e) {
    document.body.innerHTML = `<p style="padding:24px">Supabase ライブラリの読み込みに失敗しました: ${esc(e.message)}</p>`;
    return;
  }
  $('#demo-banner').hidden = api.mode !== 'demo';
  bindLogin();
  bindGlobal();
  state.user = await api.getUser().catch(() => null);
  window.__appBooted = true;
  if (state.user) await enterApp();
  else showLogin();
}

function showLogin() {
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#viewer-pass').focus();
}

function bindLogin() {
  const err = $('#login-error');
  $('#toggle-login').addEventListener('click', () => {
    const toEditor = $('#editor-form').hidden;
    $('#editor-form').hidden = !toEditor;
    $('#viewer-form').hidden = toEditor;
    $('#toggle-login').textContent = toEditor ? '閲覧パスワードで入る' : '編集者としてログイン';
    err.textContent = '';
    (toEditor ? $('#editor-email') : $('#viewer-pass')).focus();
  });
  const handle = (form, fn) => form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    err.textContent = '';
    try {
      await fn();
      state.user = await api.getUser();
      form.reset();
      await enterApp();
    } catch (ex) {
      err.textContent = ex.message;
    } finally {
      btn.disabled = false;
    }
  });
  handle($('#viewer-form'), () => api.loginViewer($('#viewer-pass').value));
  handle($('#editor-form'), () => api.loginEditor($('#editor-email').value.trim(), $('#editor-pass').value));
}

async function enterApp() {
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#user-label').textContent = api.mode === 'demo' ? 'デモ' : state.user.isEditor ? `編集者: ${state.user.email}` : '閲覧のみ';
  $('#logout-btn').hidden = api.mode === 'demo';
  $('#view').innerHTML = '<p class="empty">読み込み中…</p>';
  initChat({ api, user: state.user, toast });
  await reloadCards();
  route();
  startLive();
  // 学習記録の同期（引き継ぎコードを設定している場合）: 起動時と、記録が変わったあと自動で
  startAutoSync(api, {
    onMerged: () => { if (!$('#modal').open && !(state.view === 'quiz' && state.quiz.phase === 'question')) { rebuildStudyDeck(true); renderView(); } toast('ほかの端末の学習記録を取り込みました'); },
    onError: (e) => console.warn('学習記録の同期に失敗しました', e),
  });
}

/* ---- ほかの人によるカードの追加・編集・削除をリアルタイムで反映 ----
   変更の通知が来たらデータを読み直し、今の画面を描き直す。
   ただし操作の邪魔になるとき（クイズの出題中・入力欄に入力中・マウスのボタンを押している間）は待ってから反映する */
const live = { unsub: null, timer: null, dirty: false, busy: false, pressed: false };
function startLive() {
  live.unsub?.();
  live.unsub = api.subscribeCards ? api.subscribeCards(() => {
    // 続けて届く通知（まとめて読み込んだときなど）は 1 回にまとめる
    clearTimeout(live.timer);
    live.timer = setTimeout(() => { live.dirty = true; flushLive(); }, 700);
  }) : null;
}
function stopLive() {
  live.unsub?.();
  live.unsub = null;
  clearTimeout(live.timer);
  live.dirty = false;
}
function liveBlocked() {
  if (live.pressed) return true;
  if (state.view === 'quiz' && state.quiz.phase !== 'setup') return true; // 出題中は問題のカードを入れ替えない
  const a = document.activeElement;
  return !!(a && a.closest('#view') && a.matches('input, textarea, select'));
}
async function flushLive() {
  if (!live.dirty || live.busy || !state.user || liveBlocked()) return;
  live.dirty = false;
  live.busy = true;
  try {
    await reloadCards();
    if (!state.user) return;
    if (state.view === 'map') refreshMap($('#view'), mapCtx); // 表示位置・選んでいる国はそのまま
    else render();
    window.dispatchEvent(new Event('geo:notes'));
  } finally {
    live.busy = false;
  }
  if (live.dirty) flushLive();
}
document.addEventListener('pointerdown', () => { live.pressed = true; }, true);
document.addEventListener('pointerup', () => { live.pressed = false; setTimeout(flushLive, 0); }, true);
document.addEventListener('pointercancel', () => { live.pressed = false; }, true);
document.addEventListener('focusout', () => setTimeout(flushLive, 0));

async function reloadCards() {
  try {
    state.categories = await api.listCategories();
    state.cards = await api.listCards();
    // メモのテーブルがまだない（setup.sql を更新前）場合も、ほかの機能は動くように
    state.countryNotes = await api.listCountryNotes().catch((e) => { console.warn('国のメモを読み込めませんでした', e); return new Map(); });
    // 地図のインフォグラフィックの値（テーブルがまだない場合は初期値だけで動く）
    state.facts = await (api.listFacts ? api.listFacts() : Promise.resolve(new Map())).catch((e) => { console.warn('国の情報を読み込めませんでした', e); state.factsMissing = true; return new Map(); });
    setFacts(state.facts);
    setInfoCards(state.cards);
    state.urls = await api.imageUrls(state.cards);
    state.urlsAt = Date.now();
  } catch (e) {
    toast(`読み込みに失敗しました: ${e.message}`, 'error');
  }
  rebuildStudyDeck(true);
}

// 署名付きURLの期限が近ければ取り直す
async function refreshUrlsIfStale() {
  if (api.mode === 'supabase' && Date.now() - state.urlsAt > 1000 * 60 * 60 * 10) {
    state.urls = await api.imageUrls(state.cards);
    state.urlsAt = Date.now();
  }
}

function bindGlobal() {
  window.addEventListener('hashchange', route);
  $('#settings-btn').addEventListener('click', openSettings);
  $('#stats-btn').addEventListener('click', openStats);
  $('#sound-btn').addEventListener('click', () => {
    settings.sound = !settings.sound;
    saveSettings();
    const cb = $('#modal .switch input[data-key="sound"]');
    if (cb) cb.checked = settings.sound;
  });
  // ボタン全般を押したときの小さな音（めくる・正解などの専用の音が鳴ったときは重ねない）
  document.addEventListener('click', (e) => {
    if (!e.target.closest?.('button, a[href], [role="button"], .chip-btn, .tile, .map-thumb, select, label.switch')) return;
    if (!playedRecently()) play('tap');
  });
  $('#search-btn').addEventListener('click', openSpotlight);
  updateSearchKeyHint();
  // ヘッダーの高さ（編集画面で上部の操作欄をその下に追従させる位置）
  const topbar = $('.topbar');
  if (topbar && window.ResizeObserver) new ResizeObserver(() => document.documentElement.style.setProperty('--topbar-h', `${topbar.offsetHeight}px`)).observe(topbar);
  const sp = $('#spotlight');
  sp.addEventListener('click', (e) => { if (e.target === sp) closeSpotlight(); });
  sp.addEventListener('cancel', (e) => { e.preventDefault(); closeSpotlight(); });
  $('#logout-btn').addEventListener('click', async () => {
    await api.logout();
    teardownChat();
    stopLive();
    state.user = null;
    state.cards = [];
    showLogin();
  });
  document.addEventListener('keydown', onKeydown);
  const modal = $('#modal');
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  // カード詳細・国の詳細では、右クリックで前のカード / 国に戻る（履歴がなければ閉じる）
  // 右ボタンを押し始めた場所を記録（地図で右ボタンを押したまま Alt+クリックで詳細を開き、
  // その後に右ボタンを離したときの contextmenu で詳細が閉じないように）
  let rightPressInModal = false;
  document.addEventListener('pointerdown', (e) => { if (e.button === 2) rightPressInModal = !!e.target.closest?.('#modal'); }, true);
  modal.addEventListener('contextmenu', (e) => {
    if (!modalCurrent || modalCurrent.kind === 'editor') return; // 編集画面などでは通常の右クリックメニュー
    if (!rightPressInModal) { e.preventDefault(); return; } // 詳細の外で押した右ボタンを離しただけ
    if (e.target.closest('a, input, textarea')) return; // リンクや入力欄はブラウザのメニューを使えるように
    e.preventDefault();
    if (modalStack.length) modalBack();
    else closeModal();
  });
  // Esc（ダイアログの cancel）: 編集の途中で詳細を開いていたら、編集の画面へ戻る
  modal.addEventListener('cancel', (e) => { if (returnToEditor()) e.preventDefault(); });
  // close イベントは非同期に届くため、閉じた直後に別の画面（編集など）を開いた場合は片付けない
  modal.addEventListener('close', () => {
    if (modal.open) return;
    modal.innerHTML = ''; modal.className = 'modal'; modalPasteHandler = null; modalStack = []; modalCurrent = null;
  });
  document.addEventListener('paste', (e) => { if (modalPasteHandler) modalPasteHandler(e); });
}

function fillDatalists() {
  $('#country-list').innerHTML = COUNTRIES.map((c) => `<option value="${esc(c.ja)}">${esc(c.en)}</option>`).join('');
  $('#search-list').innerHTML =
    REGIONS.map((r) => `<option value="${esc(r.name)}">地域</option>`).join('') +
    COUNTRIES.map((c) => `<option value="${esc(c.ja)}">${esc(c.en)}</option>`).join('');
}

/* ================= ルーティング ================= */
async function route() {
  if (!state.user) return;
  let view = location.hash.replace('#', '') || 'study';
  if (view === 'search') { // 旧「検索」タブの URL は Spotlight で開く
    history.replaceState(null, '', `#${state.view || 'study'}`);
    view = state.view || 'study';
    setTimeout(openSpotlight, 0);
  }
  if (!['study', 'quiz', 'map', 'manage', 'compare', 'lang'].includes(view)) view = 'study';
  state.view = view;
  $$('#tabs a').forEach((a) => a.classList.toggle('active', a.dataset.view === view));
  // 狭い画面で、開いているタブ（名前つき）がヘッダーの外に出ないようにタブの列を動かす
  const act = $('#tabs a.active');
  const nav = $('#tabs');
  if (act && nav) requestAnimationFrame(() => { nav.scrollLeft = Math.max(0, act.offsetLeft - (nav.clientWidth - act.offsetWidth) / 2); });
  await refreshUrlsIfStale().catch(() => {});
  render();
}

// 編集以外のタブは画面の高さに収めて、ページ全体はスクロールさせない
// on === 'scroll': 内容が多い画面（クイズの設定・結果）は、ヘッダーの下の枠の中だけでスクロール
function setFit(on) {
  $('#app').classList.toggle('app-fit', !!on);
  $('#view').classList.toggle('view-fit', !!on);
  $('#view').classList.toggle('view-scroll', on === 'scroll');
}

function render() {
  document.querySelector('.hover-bubble')?.classList.remove('show'); // 地図のプレビュー吹き出しを閉じる
  try {
    renderView();
  } catch (e) {
    console.error(e);
    $('#view').innerHTML = `<div class="empty"><p>画面の表示中にエラーが起きました。</p><pre class="err-pre">${esc(e.stack || e.message)}</pre><p class="muted small">Ctrl + Shift + R で強制再読み込みすると直ることがあります</p></div>`;
  }
  if (live.dirty) setTimeout(flushLive, 0); // 待たせていた更新（クイズが終わった後など）
}

function renderView() {
  const v = state.view;
  if ($('#spotlight').open) renderSearchResults();
  if (v !== 'map') removeSvPanel(); // 地図を離れたらストリートビューのパネルも閉じる
  if (v === 'study') renderStudy();
  else if (v === 'quiz') renderQuiz();
  else if (v === 'map') { setFit(true); renderMap($('#view'), mapCtx); }
  else if (v === 'manage') renderManage();
  else if (v === 'compare') renderCompare();
  else if (v === 'lang') renderLang();
}

// ---- キーボード操作（キーは設定で変更可能。e.code で判定するので日本語入力中でも動く）
const KEY_ACTIONS = [
  ['prev', '前のカード'],
  ['next', '次のカード / 次の問題'],
  ['flip', 'カードをめくる'],
  ['back', '詳細を閉じる / 前に戻る'],
  ['country', '国を見る'],
  ['edit', 'カードを編集'],
  ['tabPrev', '前のタブへ'],
  ['tabNext', '次のタブへ'],
  ['known', '覚えた（暗記カード）'],
  ['unknown', 'まだ（暗記カード）'],
  ['tab1', '暗記カードへ'],
  ['tab2', 'クイズへ'],
  ['tab3', '地図へ'],
  ['tab4', 'カード一覧へ'],
  ['tab5', '比較へ'],
  ['tab6', '言語へ'],
  ['search', '検索を開く'],
];
const DEFAULT_KEYS = { prev: 'KeyA', next: 'KeyD', flip: 'KeyS', back: 'KeyQ', country: 'KeyW', edit: 'KeyE', tabPrev: 'Ctrl+KeyA', tabNext: 'Ctrl+KeyD', known: 'KeyR', unknown: 'KeyF', tab1: 'Ctrl+Digit1', tab2: 'Ctrl+Digit2', tab3: 'Ctrl+Digit3', tab4: 'Ctrl+Digit4', tab5: 'Ctrl+Digit5', tab6: 'Ctrl+Digit6', search: 'Ctrl+KeyF' };
// キーは e.code（例: KeyA）。Ctrl / Alt / Shift と組み合わせるときは「Ctrl+KeyF」のように前に付ける
const keyLabel = (code) => (code || '—').split('+').map((k) => k.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'テンキー').replace('Space', 'スペース')).join(' + ');
const MOD_KEYS = ['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'];
const comboOf = (e) => [(e.ctrlKey || e.metaKey) && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.code].filter(Boolean).join('+');
// 押されたキーに割り当てられた操作。単独のキーは Shift の有無を問わず、組み合わせは完全一致
function actionFor(e) {
  const keys = { ...DEFAULT_KEYS, ...settings.keys };
  const combo = comboOf(e);
  const plain = !(e.ctrlKey || e.metaKey || e.altKey);
  return Object.keys(keys).find((k) => (keys[k].includes('+') ? keys[k] === combo : plain && keys[k] === e.code));
}
// ヘッダーの検索ボタンに今のキーを表示
function updateSearchKeyHint() {
  const label = keyLabel({ ...DEFAULT_KEYS, ...settings.keys }.search);
  const kbd = $('#search-btn kbd');
  if (kbd) kbd.textContent = label.replace(' + ', '+');
  $('#search-btn')?.setAttribute('title', `検索（${label} / Ctrl + K）`);
}
let capturingKey = false;

function switchTab(delta) {
  const tabs = ['study', 'quiz', 'map', 'manage', 'compare', 'lang'];
  const i = Math.max(0, tabs.indexOf(state.view));
  goTab(tabs[(i + delta + tabs.length) % tabs.length]);
}
// キー操作でタブを移るとき（効果音つき）
function goTab(view) {
  if (view === state.view) return;
  play('tab');
  location.hash = `#${view}`;
}

function onKeydown(e) {
  if (capturingKey || e.isComposing) return;
  const act = actionFor(e);
  const mod = e.ctrlKey || e.metaKey || e.altKey;
  // 検索（初期設定は Ctrl+F。Ctrl+K でも）: 組み合わせキーなら入力中でもどこからでも開閉
  if (state.user && ((mod && act === 'search') || ((e.ctrlKey || e.metaKey) && e.code === 'KeyK')) && !$('dialog.viewer[open]')) {
    e.preventDefault();
    if (spotOnTop()) closeSpotlight();
    else { if ($('#spotlight').open) $('#spotlight').close(); openSpotlight(); } // カード・国の詳細や編集中でも、その手前に開く
    return;
  }
  // タブへ直接移動（初期設定は Ctrl+1〜4）: 組み合わせキーなら入力中でも
  const tabTo = { tab1: 'study', tab2: 'quiz', tab3: 'map', tab4: 'manage', tab5: 'compare', tab6: 'lang' }[act];
  if (state.user && tabTo && (mod || !['input', 'textarea', 'select'].includes((e.target.tagName || '').toLowerCase())) && !$('dialog[open]')) {
    e.preventDefault();
    goTab(tabTo);
    return;
  }
  if (mod && !act) return; // 割り当てのない Ctrl / Alt の組み合わせはブラウザの標準動作のまま（入力欄の Ctrl+A なども）
  const tag = (e.target.tagName || '').toLowerCase();
  if (['input', 'textarea', 'select'].includes(tag)) {
    if (e.key === 'Escape' && tag !== 'select' && !$('dialog[open]')) e.target.blur(); // Esc で入力欄から抜けてキー操作へ
    return;
  }
  const digit = /^(Digit|Numpad)([1-9])$/.exec(e.code)?.[2];

  // 全画面の画像ビューア
  const viewer = $('dialog.viewer[open]');
  if (viewer) { if (act === 'back') { e.preventDefault(); viewer.close(); } return; }

  // Ctrl+K / ⌘+K / 「/」でも検索を開く
  if ((e.key === '/' && !$('dialog[open]')) ) { e.preventDefault(); openSpotlight(); return; }

  // 検索パネル（カード・国の詳細や編集の手前に開いているとき）
  if ($('#spotlight').open && spotOnTop()) {
    if (act === 'back' || act === 'search') { e.preventDefault(); closeSpotlight(); }
    return;
  }
  // カード詳細・国の詳細
  if ($('#modal').open) {
    if (!modalCurrent || modalCurrent.kind === 'editor') return; // 編集・設定などの画面では無効
    const card = modalCurrent.kind === 'card' ? cardById(modalCurrent.id) : null;
    if (act === 'back') { e.preventDefault(); if (modalStack.length) modalBack(); else closeModal(); }
    else if (modalCurrent.kind === 'photo' && (e.key === 'ArrowLeft' || act === 'prev')) { e.preventDefault(); stepPhoto(-1); }
    else if (modalCurrent.kind === 'photo' && (e.key === 'ArrowRight' || act === 'next')) { e.preventDefault(); stepPhoto(1); }
    else if (card && (e.key === 'ArrowLeft' || act === 'prev')) { e.preventDefault(); stepCard(-1); }
    else if (card && (e.key === 'ArrowRight' || act === 'next')) { e.preventDefault(); stepCard(1); }
    else if (act === 'country' && card) { e.preventDefault(); openCountryInfo(card.countries[0]); }
    else if (act === 'edit' && card) { e.preventDefault(); $('#detail-edit')?.click(); }
    return;
  }

  // 検索パネル（カードを開いていないとき）
  if ($('#spotlight').open) {
    if (act === 'back' || act === 'search') { e.preventDefault(); closeSpotlight(); }
    return;
  }
  if ($('dialog[open]')) return;
  if (act === 'search') { e.preventDefault(); openSpotlight(); return; }
  if (state.view === 'manage' && e.key === 'Escape' && state.manage.sel.size) { e.preventDefault(); clearSel(); return; }

  // 地図: 文字を打ち始めたら、そのまま国の検索バーに入力（Enter を押さなくてよい）。日本語入力の最初のキーも
  const ms = state.view === 'map' && $('#map-search');
  if (ms && !mod && ((e.key.length === 1 && e.key.trim()) || e.key === 'Process')) {
    ms.focus();
    ms.select(); // 前回の検索語は打ち始めた文字で置き換える
    return; // preventDefault しないので、押した文字は検索バーに入る
  }

  if (act === 'tabPrev' || act === 'tabNext') { e.preventDefault(); switchTab(act === 'tabNext' ? 1 : -1); return; }

  // 地図: Enter で国の検索バーへ
  if (state.view === 'map' && e.key === 'Enter' && $('#map-search')) {
    e.preventDefault();
    $('#map-search').focus();
    $('#map-search').select();
    return;
  }

  if (state.view === 'study') {
    const menu = $('#study-country-menu');
    if (menu && !menu.hidden && digit) { e.preventDefault(); $$('[data-country]', menu)[Number(digit) - 1]?.click(); return; }
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowUp' || e.key === 'ArrowDown' || act === 'flip') { e.preventDefault(); flipStudy(); }
    else if (e.key === 'ArrowRight' || act === 'next') { e.preventDefault(); moveStudy(1); }
    else if (e.key === 'ArrowLeft' || act === 'prev') { e.preventDefault(); moveStudy(-1); }
    // 国の詳細・編集は答えが見えているとき（裏面 / 並べて表示）だけ
    else if ((act === 'known' || act === 'unknown') && (state.study.flipped || settings.studySplit)) { e.preventDefault(); markStudy(act === 'known' ? 'ok' : 'ng'); }
    else if (act === 'country' && (state.study.flipped || settings.studySplit)) { e.preventDefault(); $('#study-country')?.click(); }
    else if (act === 'edit' && (state.study.flipped || settings.studySplit)) { e.preventDefault(); $('#study-edit')?.click(); }
    else if (act === 'back' && menu && !menu.hidden) { e.preventDefault(); menu.hidden = true; }
  } else if (state.view === 'quiz' && state.quiz.phase === 'question') {
    const q = state.quiz;
    if (q.answered) {
      const card = cardById(q.questions[q.i].cardId);
      if (e.key === 'Enter' || act === 'next') { e.preventDefault(); nextQuestion(); }
      else if (act === 'country' && card) { e.preventDefault(); openCountryInfo(card.countries[0], $('.quiz-card')); }
      else if (act === 'flip') { e.preventDefault(); $('#q-view')?.click(); } // 解答後はカード詳細を開く
      else if (act === 'edit' && card && !card.photo && state.user.isEditor) { e.preventDefault(); openEditor(card); }
    } else if ((q.mode === 'choice' || q.kind === 'fact') && digit && Number(digit) <= 4) {
      e.preventDefault();
      $$('.choice')[Number(digit) - 1]?.click();
    }
  }
}

/* ================= カード表示部品 ================= */
// withBack: 裏面だけの書き込み（ヒントの印）を画像に重ねる（答えが見えている場面用）
function frontHtml(card, showDesc = settings.showDesc, withBack = false) {
  const back = withBack && backUrl(card);
  return `
    <div class="front-img">${catBadge(card, 'cat-on-img')}${imgUrl(card) ? `<img src="${esc(imgUrl(card))}" alt="カード画像">${back ? `<img class="layer-back" src="${esc(back)}" alt="" aria-hidden="true"><button type="button" class="layer-toggle" title="裏面の印（ヒントの場所）の表示を切り替え">🔁 印</button>` : ''}` : '<div class="img-missing">画像なし</div>'}</div>
    ${card.description && showDesc ? `<p class="front-desc">${nl2br(card.description)}</p>` : ''}`;
}

function answerHtml(card, size = 'lg', linkCountries = false) {
  const many = card.countries.length > 3;
  return `
    <div class="answer answer-${size} ${many ? 'answer-many' : ''}">
      ${card.countries.map((c) => (linkCountries
        ? `<button type="button" class="answer-country country-link" data-info="${c}" title="国の基本情報">${flagImg(c, 'flag flag-answer')}${esc(countryName(c))}</button>`
        : `<span class="answer-country">${flagImg(c, 'flag flag-answer')}${esc(countryName(c))}</span>`)).join('')}
    </div>
    ${card.area ? `<p class="answer-area">${esc(card.area)}</p>` : ''}
    <p class="answer-regions">${[...cardRegions(card)].map((r) => esc(REGION_BY_ID.get(r).name)).join(' · ')}</p>`;
}

// 暗記カードの裏面の画像（表面より小さく、国名の上に）
function backImgHtml(card) {
  const src = imgUrl(card);
  if (!src) return '';
  const back = backUrl(card);
  return `<div class="back-img"><div class="back-img-box"><img src="${esc(src)}" alt="カード画像">${back ? `<img class="back-layer" src="${esc(back)}" alt="" aria-hidden="true">` : ''}</div></div>`;
}

// 関連カード（このカードが選んだカードと、このカードを選んでいるカード）
function relatedCards(card) {
  if (card.photo) return [];
  const ids = new Set((card.related || []).filter((id) => id !== card.id));
  for (const c of state.cards) if (c.id !== card.id && (c.related || []).includes(card.id)) ids.add(c.id);
  return [...ids].map((id) => state.cards.find((c) => c.id === id)).filter(Boolean);
}
function relatedHtml(card) {
  const list = relatedCards(card);
  if (!list.length) return '';
  return `<div class="related">
    <div class="related-head">🔗 関連カード <span class="muted">${list.length}</span></div>
    <div class="related-list">${list.map((c) => `<button type="button" class="related-item" data-related="${c.id}" style="${catStyle(c)}" title="${esc(c.description || catOf(c).name)}">
      <span class="related-thumb">${thumbUrl(c) ? `<img src="${esc(thumbUrl(c))}" alt="" loading="lazy">` : ''}</span>
      <span class="related-text"><span class="related-country">${flagImg(c.countries[0])}${esc(countryName(c.countries[0]))}${c.countries.length > 1 ? ` +${c.countries.length - 1}` : ''}</span><span class="related-cat">${esc(catOf(c).name)}</span></span>
    </button>`).join('')}</div>
  </div>`;
}
function bindRelated(root) {
  root.querySelectorAll('[data-related]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const c = cardById(b.dataset.related);
    if (c) openCardModal(c, b);
  }));
  // 画像に重ねた裏面の印の表示切り替え
  root.querySelectorAll('.layer-toggle').forEach((b) => b.addEventListener('pointerdown', (e) => e.stopPropagation())); // 画像のドラッグ・タップ扱いにしない
  root.querySelectorAll('.layer-toggle').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    b.closest('.front-img').classList.toggle('hide-layer');
  }));
}

// 日時の表示（2026/10/04 12:34）
function fmtTime(t) {
  const d = t ? new Date(t) : null;
  if (!d || Number.isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
const cardDatesHtml = (card) => (card.photo || !card.created_at ? '' : `<p class="card-dates muted small">追加: ${fmtTime(card.created_at)}${card.updated_at && card.updated_at !== card.created_at ? ` ・ 最終編集: ${fmtTime(card.updated_at)}` : ''}</p>`);

function notesHtml(card) {
  return card.notes ? `<div class="notes">${nl2br(card.notes)}</div>` : '';
}

function tileHtml(card, extra = '') {
  const shown = card.countries.slice(0, 4);
  const more = card.countries.length - shown.length;
  return `
    <article class="tile" data-id="${card.id}" tabindex="0" style="${catStyle(card)}">
      <div class="tile-img">${catBadge(card, 'cat-on-img')}${thumbUrl(card) ? `<img src="${esc(thumbUrl(card))}" alt="" loading="lazy">` : ''}</div>
      <div class="tile-body">
        <div class="tile-countries">${shown.map((c) => `<span class="chip">${flagImg(c)}${esc(countryName(c))}</span>`).join('')}${more > 0 ? `<span class="chip chip-more">+${more}</span>` : ''}</div>
        ${card.description ? `<p class="tile-desc">${esc(card.description)}</p>` : ''}
        ${extra}
      </div>
    </article>`;
}

/* ---- カード詳細 ⇄ 国の基本情報 の行き来（戻るボタン用の履歴） ---- */
let modalStack = [];
let modalCurrent = null;

function navModal(entry) {
  const m = $('#modal');
  // 検索パネルを詳細・編集の手前に開いていたら、閉じてから詳細を表示（奥の画面に描くため）
  if ($('#spotlight').open && m.open && spotOverModal) $('#spotlight').close();
  // モーダルでカード詳細・国情報・編集を表示中なら履歴に積む。それ以外は新しく開く
  if (m.open && modalCurrent) {
    // 編集中の画面は、入力内容ごと（DOM のまま）取っておいて「戻る」で元に戻す
    if (modalCurrent.kind === 'editor') Object.assign(modalCurrent, { node: m.firstElementChild, cls: m.className, paste: modalPasteHandler });
    modalStack.push(modalCurrent);
  } else modalStack = [];
  showNav(entry);
}
function showNav(entry) {
  if (entry.kind === 'editor') {
    const m = $('#modal');
    m.className = entry.cls;
    m.style.removeProperty('--cat');
    m.replaceChildren(entry.node);
    modalPasteHandler = entry.paste;
    modalCurrent = entry;
    return;
  }
  if (entry.kind === 'card') {
    const card = cardById(entry.id);
    if (!card) { closeModal(); return; }
    renderCardModal(card, entry);
  } else if (entry.kind === 'photo') {
    renderPhotoModal(entry);
  } else {
    renderCountryModal(entry);
  }
  modalCurrent = entry;
  // 参考写真の説明・撮影地点は大きいデータなので、必要になったときに読み込んで表示し直す
  if ((entry.kind === 'photo' || (entry.kind === 'card' && String(entry.id).startsWith('ref|'))) && !refInfoLoaded()) {
    ensureRefInfo().then(() => { if (modalCurrent === entry && $('#modal').open) showNav(entry); }).catch(() => {});
  }
}
function modalBack() {
  const prev = modalStack.pop();
  if (prev) showNav(prev);
}
function backBtnHtml() {
  const prev = modalStack[modalStack.length - 1];
  if (!prev) return '';
  const label = prev.kind === 'country' ? countryName(prev.code) : prev.kind === 'photo' ? '写真' : prev.kind === 'editor' ? '編集中のカード' : 'カード';
  return `<button class="btn btn-ghost btn-sm modal-back" id="modal-back" type="button">← ${esc(label)}</button>`;
}
function bindModalNav() {
  const b = $('#modal-back');
  if (b) b.addEventListener('click', modalBack);
  $$('#modal [data-info]').forEach((x) => x.addEventListener('click', () => openCountryInfo(x.dataset.info)));
}

// src: クリックされたタイル等。そこから飛び出すように開く
// list: 開いた場所に並んでいたカードの id。あれば ← → / 矢印ボタンで前後のカードへ移れる
function openCardModal(card, src = null, list = null) {
  const fresh = !$('#modal').open;
  navModal({ kind: 'card', id: card.id, list: list && list.length > 1 && list.includes(card.id) ? list : null });
  if (src && fresh) popFrom($('#modal'), src);
}

// 要素 src の位置・大きさから el を拡大して表示するアニメーション
// src は要素、または画面上の点 { x, y }（地図の Alt+クリックなど）
function popFrom(el, src) {
  if (!settings.animations || !el.animate) return;
  const r1 = src.getBoundingClientRect ? src.getBoundingClientRect() : { left: src.x - 30, top: src.y - 20, width: 60, height: 40 };
  const r2 = el.getBoundingClientRect();
  if (!r1.width || !r2.width) return;
  const s = Math.max(0.08, Math.min(1, r1.width / r2.width));
  const dx = r1.left + r1.width / 2 - (r2.left + r2.width / 2);
  const dy = r1.top + r1.height / 2 - (r2.top + r2.height / 2);
  el.animate([
    { transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: 0.3 },
    { transform: 'translate(0, 0) scale(1.015)', opacity: 1, offset: 0.75 },
    { transform: 'none', opacity: 1 },
  ], { duration: 360, easing: 'cubic-bezier(.2, .8, .25, 1)' });
}

// 並びの中で前 / 次のカードへ（履歴には積まず、今の表示を差し替える）
function stepCard(delta) {
  const entry = modalCurrent;
  if (entry?.kind !== 'card' || !entry.list) return false;
  const ids = entry.list.filter((id) => cardById(id)); // 削除されたカードは飛ばす
  const i = ids.indexOf(entry.id) + delta;
  if (i < 0 || i >= ids.length) return false;
  play('slide');
  showNav({ ...entry, id: ids[i], enter: delta > 0 ? 'next' : 'prev' });
  return true;
}

// カードのカテゴリーと地図のデータの対応（シェブロンのカードなら、その国のシェブロンの色見本を出す）
const CAT_TOPIC = { シェブロン: 'chevron', ガードレール: 'guardrail', 電柱: 'pole', ボラード: 'bollard', ナンバープレート: 'plate', '道路標示・ライン': 'lines', 'Googleカー・カメラ': 'camera' };
const cardTopic = (card) => CAT_TOPIC[catOf(card).name] || null;
// compact: 暗記カードの裏面用。端に小さくたたんで置き、押すと開く
function cardFactsHtml(card, compact = false) {
  const t = cardTopic(card);
  if (!t) return '';
  const m = modeDef(t);
  const body = `${card.countries.slice(0, 4).map((c) => `<div class="card-fact-row"><span class="cf-country">${flagImg(c)}${esc(countryName(c))}</span>${factPanelHtml(t, c).replace(/<div class="pfact-head">.*?<\/div>/, '')}</div>`).join('')}
    <button type="button" class="btn btn-ghost btn-sm" data-map-topic="${t}" data-map-code="${card.countries[0]}">🗺 地図の「${esc(m.name)}」で見る</button>`;
  if (compact) {
    return `<details class="card-facts card-facts-mini" id="back-facts" ${state.study.factsOpen ? 'open' : ''}>
      <summary title="地図のデータ（${esc(m.name)}）を開く">🗺 <span class="tab-long">地図のデータ</span></summary>
      <div class="card-facts-pop"><div class="card-facts-head">${esc(m.icon)} ${esc(m.name)}</div>${body}</div>
    </details>`;
  }
  return `<div class="card-facts">
    <div class="card-facts-head">🗺 地図のデータ: ${esc(m.icon)} ${esc(m.name)}</div>
    ${body}
  </div>`;
}
function bindCardFacts(root) {
  root.querySelectorAll('[data-map-topic]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    settings.mapMode = b.dataset.mapTopic;
    saveSettings();
    focusOnNextRender(b.dataset.mapCode);
    closeModal();
    if (state.view === 'map') render(); else location.hash = '#map';
  }));
}

// 国の詳細に出す地図のデータ（シェブロン・ガードレールなど）と参考写真
const COUNTRY_FACT_TOPICS = ['chevron', 'guardrail', 'pole', 'bollard', 'plate', 'lines', 'camera', 'snow', 'script'];
function countryFactsHtml(code) {
  const rows = COUNTRY_FACT_TOPICS.map((t) => {
    const m = modeDef(t);
    const photos = REF_IMAGES[t]?.[code] || [];
    return `<div class="cfacts-row">
      <div class="cfacts-head">${esc(m.icon)} ${esc(m.name)}<button type="button" class="link-btn cfacts-map" data-topic="${t}" title="地図の「${esc(m.name)}」で見る">地図で見る</button></div>
      <div class="cfacts-body">${factPanelHtml(t, code).replace(/<div class="pfact-head">.*?<\/div>/, '')}</div>
      ${photos.length ? `<div class="cfacts-photos">${photos.map((r, i) => { const n = photoNote(t, REF_BASE + r, code); return `<button type="button" class="cfacts-photo ${n ? 'has-note' : ''}" data-topic="${t}" data-i="${i}" title="${esc(n || '参考写真（GeoHints）')}"><img src="${esc(REF_BASE + r)}" alt="" loading="lazy"></button>`; }).join('')}</div>` : ''}
    </div>`;
  }).join('');
  return `<details class="cinfo-facts" ${settings.countryFactsOpen === false ? '' : 'open'}>
    <summary class="cinfo-cards-title">🗺 地図のデータ <span class="muted small">シェブロン・ガードレール・電柱など</span></summary>
    <div class="cfacts">${rows}</div>
  </details>`;
}

/* ---- 地図の参考写真（GeoHints）: カード詳細と同じ画面で開く ---- */
// entry: { kind: 'photo', topic, code, srcs: [...], i }
function openPhotoModal(topic, code, srcs, i, src = null) {
  const fresh = !$('#modal').open;
  navModal({ kind: 'photo', topic, code, srcs, i });
  if (src && fresh) popFrom($('#modal'), src);
}
// 写真ごとのメモ（見どころ）: 国ごとの情報と同じテーブル（country_facts）に topic「photo|種類|画像のパス」で保存
const relOf = (src) => (src.startsWith(REF_BASE) ? src.slice(REF_BASE.length) : src);
const photoNoteKey = (topic, src) => `photo|${topic}|${relOf(src)}`;
const photoNote = (topic, src, code) => state.facts.get(photoNoteKey(topic, src))?.get(code)?.note || '';

// 写真ごとの説明（撮影場所・種類・見どころのメモ）と Google マップへのリンク
function photoInfoHtml(topic, src, code) {
  const info = refInfo(topic, relOf(src)) || {};
  const note = factOf(topic, code)?.note || '';
  const pnote = photoNote(topic, src, code);
  if (!info.desc && !info.map && !note && !pnote) return '';
  return `<div class="photo-info">
    ${pnote ? `<p class="photo-desc photo-pnote">📝 <b>この写真の見どころ:</b> ${esc(pnote)}</p>` : ''}
    ${(info.desc || '').split('\n').filter(Boolean).map((l) => `<p class="photo-desc${/^(撮影場所|種類):/.test(l) ? ' photo-meta' : ''}">${esc(l)}</p>`).join('')}
    ${note ? `<p class="photo-desc photo-note"><b>見分け方:</b> ${esc(note)}</p>` : ''}
    ${info.map ? `<a class="btn btn-sm photo-map" href="${esc(info.map)}" target="_blank" rel="noopener">📍 Google マップ（ストリートビュー）で開く ↗</a>` : ''}
  </div>`;
}
// 参考写真を自分のカードに: 画像はこのサイト経由（/api/refimg）で取得して、作成画面に入れる
async function photoToCard(topic, code, src, btn) {
  btn.disabled = true;
  btn.textContent = '画像を読み込み中…';
  try {
    const rel = src.startsWith(REF_BASE) ? src.slice(REF_BASE.length) : src;
    const res = await fetch(`/api/refimg?path=${encodeURIComponent(rel)}`);
    if (!res.ok) throw new Error(`画像を取得できませんでした（${res.status}）`);
    const blob = await res.blob();
    await ensureRefInfo().catch(() => {});
    const info = refInfo(topic, rel) || {};
    const place = (info.desc || '').match(/撮影場所: (.+?)付近/)?.[1] || '';
    const note = factOf(topic, code)?.note || '';
    const catId = state.categories.find((k) => CAT_TOPIC[k.name] === topic)?.id || null;
    openEditor(null, {
      countries: [code], categoryId: catId, blob, area: place,
      notes: [photoNote(topic, src, code), note, `出典: GeoHints（${REF_PAGES[topic] || 'https://geohints.com/'}）${info.map ? `\n撮影地点: ${info.map}` : ''}`].filter(Boolean).join('\n'),
    });
  } catch (ex) {
    toast(ex.message, 'error');
    btn.disabled = false;
    btn.textContent = '＋ この写真でカードを作る';
  }
}
function stepPhoto(delta) {
  const e = modalCurrent;
  if (e?.kind !== 'photo') return;
  const i = e.i + delta;
  if (i < 0 || i >= e.srcs.length) return;
  play('slide');
  showNav({ ...e, i, enter: delta > 0 ? 'next' : 'prev' });
}
function renderPhotoModal(entry) {
  const { topic, code, srcs, i } = entry;
  const m = modeDef(topic);
  const pager = srcs.length > 1 ? `
    <div class="card-pager">
      <button class="icon-btn pager-btn" id="photo-prev" type="button" aria-label="前の写真" title="前の写真（←）" ${i === 0 ? 'disabled' : ''}>‹</button>
      <span class="pager-pos">${i + 1} / ${srcs.length}</span>
      <button class="icon-btn pager-btn" id="photo-next" type="button" aria-label="次の写真" title="次の写真（→）" ${i === srcs.length - 1 ? 'disabled' : ''}>›</button>
    </div>` : '';
  openModal(`
    <div class="modal-head">
      ${backBtnHtml()}
      <h2>参考写真: ${esc(m.icon)} ${esc(m.name)}</h2>
      ${pager}
      <button class="icon-btn" data-close aria-label="閉じる">✕</button>
    </div>
    <div class="detail ${entry.enter ? `enter-${entry.enter}` : ''}">
      <div class="detail-front">
        <div class="front-img"><img src="${esc(srcs[i])}" alt="${esc(countryName(code))}の${esc(m.name)}の参考写真"></div>
        <p class="muted small photo-credit">写真: <a href="${REF_PAGES[topic] || 'https://geohints.com/'}" target="_blank" rel="noopener">GeoHints</a></p>
      </div>
      <div class="detail-back">
        ${answerHtml({ countries: [code], area: '' }, 'md', true)}
        <p class="muted small detail-hint">国名をクリックすると基本情報を表示</p>
        ${photoInfoHtml(topic, srcs[i], code)}
        ${state.user.isEditor ? `<label class="field photo-note-edit"><span>📝 この写真の見どころ（メモ）<span class="muted small" id="pnote-status"></span></span>
          <textarea id="pnote-input" rows="3" placeholder="例: 反射板の形がポイント。左のボラードは赤い帯が一周している。入力が止まると自動で保存されます">${esc(photoNote(topic, srcs[i], code))}</textarea></label>` : ''}
        ${state.user.isEditor ? '<button type="button" class="btn btn-sm" id="photo-to-card" title="この写真を自分のカードにする（国・カテゴリー・見分け方を入れた状態で作成画面を開きます）">＋ この写真でカードを作る</button>' : ''}
        <div class="pfact">${factPanelHtml(topic, code).replace(/<div class="pfact-note">[^<]*<\/div>/g, '')}</div>
      </div>
    </div>`, 'modal-wide', true);
  attachZoom($('.detail-front .front-img'), srcs.length > 1 ? { onSwipe: (d) => stepPhoto(d) } : {});
  $('#photo-to-card')?.addEventListener('click', (e) => photoToCard(topic, code, srcs[i], e.currentTarget));
  // 写真ごとのメモ: 入力が止まって 0.8 秒、または欄から離れたら保存
  const pin = $('#pnote-input');
  if (pin) {
    const key = photoNoteKey(topic, srcs[i]);
    let saved = pin.value;
    let timer = null;
    const save = async () => {
      clearTimeout(timer);
      const text = pin.value.trim();
      if (text === saved.trim()) return;
      if (state.factsMissing) { $('#pnote-status').textContent = '保存先のテーブルがありません（supabase/country-facts.sql を実行してください）'; return; }
      $('#pnote-status').textContent = '保存中…';
      try {
        await api.saveFact(code, key, text ? { note: text } : null);
        saved = pin.value;
        if (!state.facts.has(key)) state.facts.set(key, new Map());
        if (text) state.facts.get(key).set(code, { note: text }); else state.facts.get(key).delete(code);
        setFacts(state.facts);
        $('#pnote-status').textContent = '保存しました';
        window.dispatchEvent(new Event('geo:notes')); // 地図の右パネル（写真の 📝 印）に反映
      } catch (ex) {
        $('#pnote-status').textContent = '';
        toast(`メモを保存できませんでした: ${ex.message}`, 'error');
      }
    };
    pin.addEventListener('input', () => { $('#pnote-status').textContent = ''; clearTimeout(timer); timer = setTimeout(save, 800); });
    pin.addEventListener('blur', save);
    $('#modal').addEventListener('close', save, { once: true });
  }
  $('#photo-prev')?.addEventListener('click', () => stepPhoto(-1));
  $('#photo-next')?.addEventListener('click', () => stepPhoto(1));
  delete entry.enter;
  bindModalNav();
}

function renderCardModal(card, entry = {}) {
  const ids = entry.list ? entry.list.filter((id) => cardById(id)) : [];
  const pos = ids.indexOf(card.id);
  const pager = ids.length > 1 && pos >= 0 ? `
    <div class="card-pager">
      <button class="icon-btn pager-btn" id="card-prev" type="button" aria-label="前のカード" title="前のカード（←）" ${pos === 0 ? 'disabled' : ''}>‹</button>
      <span class="pager-pos">${pos + 1} / ${ids.length}</span>
      <button class="icon-btn pager-btn" id="card-next" type="button" aria-label="次のカード" title="次のカード（→）" ${pos === ids.length - 1 ? 'disabled' : ''}>›</button>
    </div>` : '';
  openModal(`
    <div class="modal-head">
      ${backBtnHtml()}
      <h2>カード詳細</h2>
      ${pager}
      <button class="icon-btn" data-close aria-label="閉じる">✕</button>
    </div>
    <div class="detail ${entry.enter ? `enter-${entry.enter}` : ''}">
      <div class="detail-front">
        ${frontHtml(card, true, true)}
      </div>
      <div class="detail-back">
        ${answerHtml(card, 'md', true)}
        <p class="muted small detail-hint">国名をクリックすると基本情報を表示</p>
        ${notesHtml(card)}
        ${card.photo ? photoInfoHtml(card.topic, card.src, card.countries[0]) : cardFactsHtml(card)}
        ${relatedHtml(card)}
        ${cardDatesHtml(card)}
      </div>
    </div>
    ${state.user.isEditor && !card.photo ? `<div class="modal-foot"><button class="btn" id="detail-edit">編集する</button></div>` : ''}
  `, 'modal-wide', true);
  // カード詳細の背景もカテゴリーの色を薄く
  $('#modal').classList.add('modal-card');
  $('#modal').style.setProperty('--cat', catOf(card).color);
  attachZoom($('.detail-front .front-img'), pager ? { onSwipe: (d) => stepCard(d) } : {});
  bindCardFacts($('#modal'));
  bindRelated($('#modal'));
  $('#card-prev')?.addEventListener('click', () => stepCard(-1));
  $('#card-next')?.addEventListener('click', () => stepCard(1));
  delete entry.enter;
  bindModalNav();
  const eb = $('#detail-edit');
  if (eb) eb.addEventListener('click', () => { closeModal(); openEditor(card); });
}

/* ================= 言語（一覧と、看板に出てくる文字での絞り込み） ================= */
// 文字のまとまり（Unicode の文字体系）と表示名。ラテン文字は ASCII 以外（ダイアクリティカルマーク付きなど）だけ
const LANG_SCRIPTS = [
  ['Latin', 'ラテン文字（記号付き）'], ['Cyrillic', 'キリル文字'], ['Greek', 'ギリシャ文字'], ['Arabic', 'アラビア文字'], ['Hebrew', 'ヘブライ文字'],
  ['Armenian', 'アルメニア文字'], ['Georgian', 'ジョージア文字'], ['Devanagari', 'デーヴァナーガリー'], ['Bengali', 'ベンガル文字'],
  ['Gurmukhi', 'グルムキー文字'], ['Gujarati', 'グジャラート文字'], ['Tamil', 'タミル文字'], ['Telugu', 'テルグ文字'], ['Kannada', 'カンナダ文字'],
  ['Malayalam', 'マラヤーラム文字'], ['Sinhala', 'シンハラ文字'], ['Thai', 'タイ文字'], ['Lao', 'ラーオ文字'], ['Khmer', 'クメール文字'],
  ['Myanmar', 'ミャンマー文字'], ['Tibetan', 'チベット文字'], ['Ethiopic', 'エチオピア文字'], ['Hangul', 'ハングル'], ['Thaana', 'ターナ文字'],
  ['Mongolian', 'モンゴル文字'], ['Tifinagh', 'ティフィナグ文字'], ['Hiragana', 'ひらがな'], ['Katakana', 'カタカナ'],
];
const SCRIPT_RES = LANG_SCRIPTS.map(([k]) => [k, new RegExp(`^\\p{Script=${k}}`, 'u')]);
const graphemes = (str) => ('Segmenter' in Intl ? [...new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(str)].map((x) => x.segment) : [...str]);
function scriptOf(ch) {
  for (const [k, re] of SCRIPT_RES) if (re.test(ch)) return k;
  return null;
}
// 言語ごとの「見分けに使える文字」（特徴的な文字・よく見る単語から）。説明の日本語（漢字・かな）は除く
let langCharIndex = null;
function langChars() {
  if (langCharIndex) return langCharIndex;
  const byLang = new Map();
  const byChar = new Map(); // 文字 → その文字を使う言語
  const kanaOk = new Set(['jpn']); // ひらがな・カタカナは日本語の項目からだけ
  for (const [l, v] of Object.entries(LANGS)) {
    const set = new Set();
    for (const [src, fromWords] of [[v.c, false], [v.w, true]]) {
      // （）の中の日本語の説明は飛ばす
      for (const g of graphemes(String(src || '').replace(/（[^）]*）/g, ' '))) {
        const ch = g.toLocaleLowerCase();
        const sc = scriptOf(ch);
        if (!sc) continue;
        if (sc === 'Latin' && /^[a-z]$/.test(ch)) continue; // ふつうのアルファベットは手がかりにならない
        if (fromWords && sc !== 'Latin') continue; // ラテン文字以外は「特徴的な文字」に挙げた文字だけ（よくある文字で候補が埋まらないように）
        if ((sc === 'Hiragana' || sc === 'Katakana') && !kanaOk.has(l)) continue;
        set.add(ch);
      }
    }
    byLang.set(l, set);
    for (const ch of set) { if (!byChar.has(ch)) byChar.set(ch, new Set()); byChar.get(ch).add(l); }
  }
  langCharIndex = { byLang, byChar };
  return langCharIndex;
}
const langText = (l) => { const v = LANGS[l]; return `${v.ja} ${LANG_EN[l] || ''} ${v.s} ${v.c} ${v.w} ${v.t}`.toLowerCase(); };

function renderLang() {
  setFit('scroll');
  const st = state.lang;
  const { byLang, byChar } = langChars();
  const terms = st.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const all = Object.keys(LANGS);
  const hits = all.filter((l) => [...st.chars].every((ch) => byLang.get(l).has(ch)) && terms.every((t) => langText(l).includes(t)))
    .sort((a, b) => langCountries(b).length - langCountries(a).length || LANGS[a].ja.localeCompare(LANGS[b].ja, 'ja'));
  // 候補の文字: 今の絞り込み結果の言語に出てくる文字（選ぶほど候補が減る）。文字体系ごとに
  const avail = new Map();
  for (const l of hits) for (const ch of byLang.get(l)) avail.set(ch, (avail.get(ch) || 0) + 1);
  const groups = LANG_SCRIPTS.map(([k, name]) => ({ k, name, chars: [...byChar.keys()].filter((ch) => scriptOf(ch) === k).sort((a, b) => a.localeCompare(b)) })).filter((g) => g.chars.length);
  const hl = (text) => {
    let h = esc(text);
    for (const ch of st.chars) h = h.split(esc(ch)).join(`<mark>${esc(ch)}</mark>`);
    return h;
  };
  $('#view').innerHTML = `
    <div class="lang-view">
      <div class="toolbar lang-toolbar">
        <h2 class="lang-title">🔤 言語</h2>
        <input type="search" id="lang-q" class="input grow" placeholder="言語名・文字・単語で絞り込み（例: ñ / ulica / スワヒリ）" value="${esc(st.q)}" autocomplete="off">
        <span class="counter">${hits.length} / ${all.length} 言語</span>
      </div>
      <div class="lang-picked">
        ${st.chars.size ? `<span class="muted small">選んだ文字:</span> ${[...st.chars].map((ch) => `<button type="button" class="lang-ch on" data-ch="${esc(ch)}" title="外す">${esc(ch)} ✕</button>`).join('')}<button type="button" class="link-btn" id="lang-clear">すべて外す</button>` : '<span class="muted small">看板で見かけた文字を下から選ぶと、その文字を使う言語に絞り込めます（キリル文字など、キーボードで打てない文字も選べます）</span>'}
      </div>
      <div class="lang-palette">
        ${groups.map((g) => {
          const n = g.chars.filter((ch) => avail.has(ch)).length;
          if (!n && !g.chars.some((ch) => st.chars.has(ch))) return ''; // 今の絞り込みで出てこない文字体系はたたむ
          return `<details class="lang-group" data-group="${g.k}" ${st.open.has(g.k) || g.chars.some((ch) => st.chars.has(ch)) ? 'open' : ''}>
            <summary>${esc(g.name)} <span class="muted">${n}</span></summary>
            <div class="lang-chars">${g.chars.map((ch) => {
              const on = st.chars.has(ch);
              const ok = on || avail.has(ch);
              return `<button type="button" class="lang-ch ${on ? 'on' : ''}" data-ch="${esc(ch)}" ${ok ? '' : 'disabled'} title="${ok ? `${[...byChar.get(ch)].map((l) => LANGS[l].ja).join('・')}` : '今の絞り込みでは出てきません'}">${esc(ch)}</button>`;
            }).join('')}</div>
          </details>`;
        }).join('')}
      </div>
      <div class="lang-list">
        ${hits.length ? hits.map((l) => {
          const v = LANGS[l];
          const cs = langCountries(l);
          return `<article class="lang-item">
            <div class="lang-head"><b class="lang-name">${esc(v.ja)}</b><span class="muted small">${esc(LANG_EN[l] || '')}</span><span class="chip lang-script">${esc(v.s)}</span></div>
            ${v.c ? `<p class="lang-row"><span class="lang-k">文字</span><span class="lang-chars-text">${hl(v.c)}</span></p>` : ''}
            ${v.w ? `<p class="lang-row"><span class="lang-k">単語</span><span>${hl(v.w)}</span></p>` : ''}
            ${v.t ? `<p class="lang-row"><span class="lang-k">コツ</span><span>${esc(v.t)}</span></p>` : ''}
            ${cs.length ? `<div class="lang-countries">${cs.slice(0, 24).map((c) => `<button type="button" class="chip chip-btn" data-lang-country="${c}" data-lang="${l}">${flagImg(c)}${esc(countryName(c))}</button>`).join('')}${cs.length > 24 ? `<span class="muted small">ほか ${cs.length - 24}</span>` : ''}</div>` : ''}
          </article>`;
        }).join('') : '<p class="empty">当てはまる言語がありません。文字を外すか、言葉を変えてみてください</p>'}
      </div>
    </div>`;
  const q = $('#lang-q');
  q.addEventListener('input', () => {
    st.q = q.value;
    const pos = q.selectionStart;
    renderLang();
    const nq = $('#lang-q');
    nq.focus();
    nq.setSelectionRange(pos, pos);
  });
  $$('#view .lang-ch[data-ch]').forEach((b) => b.addEventListener('click', () => {
    const ch = b.dataset.ch;
    if (st.chars.has(ch)) st.chars.delete(ch); else st.chars.add(ch);
    play('tap');
    renderLang();
  }));
  $('#lang-clear')?.addEventListener('click', () => { st.chars.clear(); renderLang(); });
  $$('#view .lang-group').forEach((d) => d.addEventListener('toggle', () => { if (d.open) st.open.add(d.dataset.group); else st.open.delete(d.dataset.group); }));
  $$('#view [data-lang-country]').forEach((b) => b.addEventListener('click', () => openCountryInfo(b.dataset.langCountry, b, b.dataset.lang)));
}

/* ================= 国の比較（カテゴリーごとに横並び） ================= */
const MAX_COMPARE = 4;
const COMPARE_TOPICS = ['chevron', 'guardrail', 'pole', 'bollard', 'plate', 'lines', 'drive', 'script', 'camera', 'snow'];
// 比較の開閉できるまとまり（大見出し）と項目
const cmpSection = (key, title, inner) => `<details class="cmp-sec" data-key="sec-${key}" ${state.compare.closed.has(`sec-${key}`) ? '' : 'open'}><summary>${title}</summary>${inner}</details>`;
const cmpItem = (key, label, cells) => `<details class="cmp-item" data-key="${key}" ${state.compare.closed.has(key) ? '' : 'open'}><summary>${label}</summary><div class="cmp-cells">${cells}</div></details>`;
// 比較に国を足して比較タブへ（国の詳細の「⚖ 比較」から）
function openCompare(code) {
  const c = state.compare;
  if (!c.codes.includes(code)) c.codes = c.codes.length >= MAX_COMPARE ? [code] : [...c.codes, code];
  closeModal();
  if (state.view === 'compare') render(); else location.hash = '#compare';
}
function renderCompare() {
  setFit('scroll');
  const st = state.compare;
  const codes = st.codes.filter((c) => COUNTRY_BY_CODE.has(c));
  const cardsOf = (code, catId) => state.cards.filter((c) => c.countries.includes(code) && catKey(c) === catId);
  // カードのある カテゴリーを先に。編集者には、カードのないカテゴリーも作成用に出す
  const hasCards = (k) => codes.some((code) => cardsOf(code, k.id).length);
  const cats = state.user.isEditor ? [...allCats().filter(hasCards), ...allCats().filter((k) => !hasCards(k))] : allCats().filter(hasCards);
  const editor = state.user.isEditor;
  const addBtn = (code, catId, label = '＋ カードを作成') => (editor && catId ? `<button type="button" class="cmp-add-card" data-new-code="${code}" data-new-cat="${catId}" title="${esc(countryName(code))}・${esc(allCats().find((k) => k.id === catId)?.name || '')} のカードを作成">${label}</button>` : '');
  const topicCat = (t) => state.categories.find((k) => CAT_TOPIC[k.name] === t)?.id || null;
  // 追加の候補: 選んだ国の隣の国
  const suggest = [...new Set(codes.flatMap((c) => COUNTRY_INFO[c]?.nb || []))].filter((c) => !codes.includes(c) && COUNTRY_BY_CODE.has(c)).slice(0, 12);
  const full = codes.length >= MAX_COMPARE;
  $('#view').innerHTML = `
    <section class="compare">
      <div class="toolbar cmp-pick">
        <h2 class="cmp-title">⚖ 国を比較</h2>
        ${codes.map((c) => `<span class="chip cmp-chip">${flagImg(c)}<button type="button" class="cmp-name" data-info="${c}" title="国の詳細">${esc(countryName(c))}</button><button type="button" class="cmp-rm" data-rm="${c}" aria-label="${esc(countryName(c))}を外す">✕</button></span>`).join('')}
        ${full ? `<span class="muted small">最大 ${MAX_COMPARE} か国まで</span>` : `<input type="text" id="cmp-input" class="cmp-input" list="country-list" placeholder="＋ 比べる国を追加" autocomplete="off">`}
        ${codes.length ? `<span class="grow"></span>
          <button type="button" class="btn btn-ghost btn-sm" id="cmp-expand" title="すべての項目を開く">▾ すべて開く</button>
          <button type="button" class="btn btn-ghost btn-sm" id="cmp-collapse" title="すべての項目を閉じる">▸ すべて閉じる</button>
          <button type="button" class="btn btn-ghost btn-sm" id="cmp-clear">国をすべて外す</button>` : ''}
      </div>
      ${suggest.length && !full ? `<div class="cmp-suggest"><span class="muted small">隣の国:</span>${suggest.map((c) => `<button type="button" class="chip chip-btn" data-add="${c}">＋ ${flagImg(c)}${esc(countryName(c))}</button>`).join('')}</div>` : ''}
      ${!codes.length ? `<div class="empty"><p>比べたい国を追加してください</p><p class="muted small">最大 ${MAX_COMPARE} か国の地図のデータ（シェブロン・ガードレールなど）とカードを、横に並べて比べられます。<br>国の詳細の「⚖ 比較」からも追加できます</p></div>` : `
      <div class="cmp-scroll">
        <div class="cmp-table" style="--cols:${codes.length}">
          <div class="cmp-headrow cmp-cells">
            ${codes.map((c) => `<div class="cmp-colhead">${flagImg(c)}<span>${esc(countryName(c))}</span><span class="muted small">${state.cards.filter((x) => x.countries.includes(c)).length} 枚</span></div>`).join('')}
          </div>
          ${cmpSection('facts', '🗺 地図のデータ', COMPARE_TOPICS.map((t) => cmpItem(`fact-${t}`, `${modeDef(t).icon} ${esc(modeDef(t).name)}`,
            codes.map((code) => `<div class="cmp-cell cmp-fact">${factPanelHtml(t, code).replace(/<div class="pfact-head">.*?<\/div>/, '')}${addBtn(code, topicCat(t), '＋ カード')}</div>`).join(''))).join(''))}
          ${cmpSection('cards', `🃏 カード`, cats.length ? cats.map((k) => cmpItem(`cat-${k.id}`, `<span class="cat-dot" style="${catVars(k)}"></span>${esc(k.name)}`,
            codes.map((code) => {
              const list = cardsOf(code, k.id);
              return `<div class="cmp-cell">${list.length ? `<div class="tiles tiles-compact cmp-tiles">${list.map((c) => tileHtml(c)).join('')}</div>` : (editor ? '' : '<span class="cmp-none">—</span>')}${addBtn(code, k.id)}</div>`;
            }).join(''))).join('') : '<p class="muted cmp-empty">これらの国のカードはまだありません</p>')}
        </div>
      </div>`}
    </section>`;
  const update = (next) => { st.codes = next; renderCompare(); };
  $$('#view [data-rm]').forEach((b) => b.addEventListener('click', () => update(codes.filter((c) => c !== b.dataset.rm))));
  $$('#view [data-add]').forEach((b) => b.addEventListener('click', () => update([...codes, b.dataset.add])));
  $$('#view [data-info]').forEach((b) => b.addEventListener('click', () => openCountryInfo(b.dataset.info, b)));
  $('#cmp-clear')?.addEventListener('click', () => update([]));
  // 国とカテゴリーを決めた状態でカードの作成を始める
  $$('#view [data-new-code]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    openEditor(null, { countries: [b.dataset.newCode], categoryId: b.dataset.newCat });
  }));
  // 開閉した項目を覚えておく
  $$('#view details[data-key]').forEach((d) => d.addEventListener('toggle', () => {
    if (d.open) st.closed.delete(d.dataset.key); else st.closed.add(d.dataset.key);
  }));
  $('#cmp-expand')?.addEventListener('click', () => { st.closed.clear(); renderCompare(); });
  $('#cmp-collapse')?.addEventListener('click', () => { $$('#view details.cmp-item').forEach((d) => st.closed.add(d.dataset.key)); renderCompare(); });
  const input = $('#cmp-input');
  if (input) {
    attachInlineComplete(input, { regions: false, ja: true });
    const add = () => {
      const code = resolveCountryCode(input.value);
      if (!code) { toast('候補にある国名を入力してください', 'error'); return; }
      if (!codes.includes(code)) update([...codes, code]); else input.value = '';
      setTimeout(() => $('#cmp-input')?.focus(), 0);
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); add(); } });
    input.addEventListener('change', () => { if (findCountry(input.value)) add(); });
  }
  bindTiles();
}

// 混同しやすい 2 か国だけのクイズ（自分のカード。少なければ参考写真も使う。答えは 2 択）
function startPairQuiz(pair) {
  const q = state.quiz;
  let pool = state.cards.filter((c) => c.countries.some((x) => pair.includes(x)));
  if (pool.length < 6) {
    for (const t of PHOTO_TOPICS) for (const code of pair) (REF_IMAGES[t]?.[code] || []).forEach((_, i) => pool.push(refCard(`ref|${t}|${code}|${i}`)));
  }
  pool = pool.filter(Boolean);
  if (!pool.length) { toast('この 2 か国のカードや写真がありません', 'error'); return; }
  closeModal();
  q.kind = 'cards';
  q.mode = 'choice';
  q.timeLimit = 0;
  const cards = shuffle(pool).slice(0, 20);
  q.questions = cards.map((c) => ({ cardId: c.id, options: shuffle([...new Set([...c.countries.filter((x) => pair.includes(x)).slice(0, 1), ...pair])]).slice(0, 2) }));
  q.i = 0;
  q.answers = [];
  q.answered = null;
  q.phase = 'question';
  startQuizClock(q);
  if (state.view === 'quiz') renderQuiz(); else location.hash = '#quiz';
}

/* ================= 学習記録（毎日の目標・連続日数・地域ごとの正答率） ================= */
function openStats() {
  const act = activity();
  const goal = Math.max(1, Number(settings.dailyGoal) || 30);
  const today = act.days[dayKey()] || { n: 0, ok: 0 };
  const st = streak();
  const prog = progStats(state.cards.map((c) => c.id));
  // 直近 14 日
  const days = Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (13 - i)); return { d, k: dayKey(d), v: act.days[dayKey(d)] || { n: 0, ok: 0 } }; });
  const max = Math.max(goal, ...days.map((x) => x.v.n), 1);
  const W = 560; const H = 160; const padL = 28; const padB = 22; const bw = (W - padL) / 14;
  const y = (n) => H - padB - ((H - padB - 8) * n) / max;
  const bars = days.map((x, i) => {
    const h = H - padB - y(x.v.n);
    const bx = padL + i * bw + 3;
    const w = bw - 6;
    const r = Math.min(4, h / 2, w / 2);
    const path = h > 0 ? `M${bx},${H - padB} V${y(x.v.n) + r} Q${bx},${y(x.v.n)} ${bx + r},${y(x.v.n)} H${bx + w - r} Q${bx + w},${y(x.v.n)} ${bx + w},${y(x.v.n) + r} V${H - padB} Z` : '';
    const label = `${x.d.getMonth() + 1}/${x.d.getDate()}`;
    const tip = `${label}: ${x.v.n} 回（正解・覚えた ${x.v.ok}）`;
    return `<g class="st-bar ${x.v.n >= goal ? 'is-goal' : ''}" data-tip="${esc(tip)}">
      <rect x="${padL + i * bw}" y="0" width="${bw}" height="${H - padB}" fill="transparent"/>
      ${path ? `<path d="${path}"/>` : ''}
      ${i % 2 === 1 || i === 13 ? `<text x="${bx + w / 2}" y="${H - 6}" text-anchor="middle">${label}</text>` : ''}
    </g>`;
  }).join('');
  const regions = REGIONS.map((r) => ({ r, s: act.regions[r.id] })).filter((x) => x.s?.n).sort((a, b) => a.s.ok / a.s.n - b.s.ok / b.s.n);
  openModal(`
    <div class="modal-head"><h2>📈 学習記録</h2><button class="icon-btn" data-close aria-label="閉じる">✕</button></div>
    <div class="st-tiles">
      <div class="st-tile"><div class="st-label">今日</div><div class="st-num">${today.n}<small> / ${goal}</small></div>
        <div class="st-meter" role="progressbar" aria-valuemin="0" aria-valuemax="${goal}" aria-valuenow="${today.n}"><i style="width:${Math.min(100, (today.n / goal) * 100)}%"></i></div>
        <div class="st-sub">${today.n >= goal ? '🎉 今日の目標を達成！' : `あと ${goal - today.n} 回`}</div></div>
      <div class="st-tile"><div class="st-label">連続学習</div><div class="st-num">${st}<small> 日</small></div><div class="st-sub">${st ? '途切れないように続けましょう' : '今日から始めましょう'}</div></div>
      <div class="st-tile"><div class="st-label">覚えたカード</div><div class="st-num">${prog.learned}<small> / ${prog.total}</small></div><div class="st-sub">習熟度 3 以上・復習待ち ${prog.due} 枚</div></div>
    </div>
    <h3 class="st-title">直近 14 日の回数 <span class="muted small">（点線は 1 日の目標）</span></h3>
    <div class="st-chart">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="直近 14 日の学習回数">
        <line class="st-axis" x1="${padL}" x2="${W}" y1="${H - padB}" y2="${H - padB}"/>
        <text class="st-ytick" x="${padL - 6}" y="${y(max) + 4}" text-anchor="end">${max}</text>
        <text class="st-ytick" x="${padL - 6}" y="${H - padB}" text-anchor="end">0</text>
        ${bars}
        <line class="st-goal" x1="${padL}" x2="${W}" y1="${y(goal)}" y2="${y(goal)}"/>
      </svg>
      <div class="st-tip" hidden></div>
    </div>
    <h3 class="st-title">地域ごとの正答率 <span class="muted small">（苦手な順。暗記の「覚えた / まだ」とクイズの結果）</span></h3>
    ${regions.length ? `<div class="st-regions">${regions.map(({ r, s: x }) => {
      const pct = Math.round((x.ok / x.n) * 100);
      return `<div class="st-region" title="${esc(r.name)}: ${x.ok} / ${x.n}"><span class="st-rname">${esc(r.name)}</span><span class="st-rbar"><i style="width:${pct}%"></i></span><span class="st-rpct">${pct}%</span><span class="st-rn muted">${x.n} 回</span></div>`;
    }).join('')}</div>` : '<p class="muted small">まだ記録がありません。暗記カードやクイズを解くとここに出ます</p>'}
    <h3 class="st-title">よく間違える組み合わせ <span class="muted small">（クイズで正解の国と答えた国）</span></h3>
    ${(() => {
      const pairs = confusions().slice(0, 8);
      return pairs.length ? `<div class="st-pairs">${pairs.map(({ pair: [a, b], n }) => `
        <div class="st-pair">
          <span class="st-pair-names">${flagImg(a)}${esc(countryName(a))} <span class="muted">⇄</span> ${flagImg(b)}${esc(countryName(b))}</span>
          <span class="muted small">${n} 回</span>
          <button type="button" class="btn btn-ghost btn-sm" data-pair-cmp="${a}|${b}">⚖ 比較</button>
          <button type="button" class="btn btn-ghost btn-sm" data-pair-quiz="${a}|${b}">🎯 この 2 か国のクイズ</button>
        </div>`).join('')}</div>` : '<p class="muted small">まだ記録がありません。クイズで間違えると、ここに出ます</p>';
    })()}
    <div class="modal-foot">
      <label class="st-goal-input">1 日の目標 <input type="number" id="st-goal" min="1" max="999" value="${goal}"> 回</label>
      <span class="grow"></span>
      <button class="btn btn-ghost btn-sm" id="st-reset" type="button">記録をリセット</button>
      <button class="btn btn-primary" data-close type="button">閉じる</button>
    </div>`, 'modal-md');
  const tip = $('#modal .st-tip');
  $$('#modal .st-bar').forEach((g) => {
    g.addEventListener('pointerenter', () => { tip.textContent = g.dataset.tip; tip.hidden = false; const r = g.getBoundingClientRect(); const c = g.closest('.st-chart').getBoundingClientRect(); tip.style.left = `${r.left - c.left + r.width / 2}px`; });
    g.addEventListener('pointerleave', () => { tip.hidden = true; });
  });
  $$('#modal [data-pair-cmp]').forEach((b) => b.addEventListener('click', () => {
    state.compare.codes = b.dataset.pairCmp.split('|');
    closeModal();
    if (state.view === 'compare') render(); else location.hash = '#compare';
  }));
  $$('#modal [data-pair-quiz]').forEach((b) => b.addEventListener('click', () => startPairQuiz(b.dataset.pairQuiz.split('|'))));
  $('#st-goal').addEventListener('change', (e) => { settings.dailyGoal = Math.max(1, Number(e.target.value) || 30); saveSettings(); openStats(); });
  $('#st-reset').addEventListener('click', () => { if (confirm('学習記録（毎日の回数・地域ごとの正答率）をリセットしますか？カードの覚え具合はそのままです')) { resetActivity(); openStats(); } });
}

/* ================= 地図のインフォグラフィック: 国ごとの値の編集 ================= */
function openFactEditor(topic, code) {
  if (!state.user.isEditor) return;
  if (state.factsMissing) { toast('保存先のテーブルがありません。supabase/country-facts.sql を実行してください', 'error'); return; }
  const cur = factOf(topic, code);
  const m = modeDef(topic);
  const draft = topic === 'chevron'
    ? { bg: cur?.bg || 'yellow', fg: cur?.fg || 'black', alt: cur?.alt || [], note: cur?.note || '' }
    : { types: [...(cur?.types || [])], note: cur?.note || '' };
  openModal(`
    <div class="modal-head"><h2>${m.icon} ${esc(m.name)}: ${flagImg(code)} ${esc(countryName(code))}</h2><button class="icon-btn" data-close aria-label="閉じる">✕</button></div>
    ${cur?.seed ? `<p class="muted small">今の値は ${esc(cur.src?.name || '資料')} から入れた初期データです。直して保存すると、こちらが優先されます</p>` : ''}
    <div id="fact-form"></div>
    <label class="field fact-note"><span>メモ（任意: 地域による違い・見分けるコツなど）</span><textarea id="fact-note" rows="2">${esc(draft.note)}</textarea></label>
    <div class="modal-foot">
      <button class="btn btn-ghost" id="fact-none" type="button" title="この国にはデータなし（初期値も使わない）にします">データなし</button>
      <span class="grow"></span>
      <button class="btn btn-ghost" data-close type="button">キャンセル</button>
      <button class="btn btn-primary" id="fact-save" type="button">保存</button>
    </div>`, 'modal-sm');
  const form = $('#fact-form');
  const draw = () => {
    if (topic === 'chevron') {
      const row = (key, label) => `<div class="fact-row"><span class="fact-label">${label}</span><div class="swatches">${CHEV_COLORS.map((c) => `<button type="button" class="swatch-btn ${draft[key] === c.id ? 'on' : ''}" data-key="${key}" data-v="${c.id}" style="--sw:${c.hex}" title="${c.name}" aria-label="${label}: ${c.name}"></button>`).join('')}</div></div>`;
      form.innerHTML = `<div class="fact-preview">${chevSignSvg(draft, 108, 72)}</div>${row('bg', '背景の色')}${row('fg', '矢印の色')}`;
      $$('.swatch-btn', form).forEach((b) => b.addEventListener('click', () => { draft[b.dataset.key] = b.dataset.v; draw(); }));
    } else {
      form.innerHTML = `<p class="muted small">よく見る種類を選んでください（${topic === 'lines' ? '当てはまるものすべて' : '2 つまで'}）</p>
        <div class="guard-list">${typesOf(topic).map((t) => `
          <label class="guard-item"><input type="checkbox" value="${t.id}" ${draft.types.includes(t.id) ? 'checked' : ''}><span class="sw" style="background:${t.color}"></span>${esc(t.name)}</label>`).join('')}</div>`;
      $$('input', form).forEach((cb) => cb.addEventListener('change', () => {
        if (cb.checked) { draft.types.push(cb.value); if (draft.types.length > (topic === 'lines' ? 5 : 2)) draft.types.shift(); }
        else draft.types = draft.types.filter((x) => x !== cb.value);
        draw();
      }));
    }
  };
  draw();
  const save = async (value, msg) => {
    try {
      await api.saveFact(code, topic, value);
      if (!state.facts.has(topic)) state.facts.set(topic, new Map());
      state.facts.get(topic).set(code, value);
      setFacts(state.facts);
      closeModal();
      toast(msg);
      if (state.view === 'map') refreshMap($('#view'), mapCtx);
    } catch (ex) {
      toast(`保存できませんでした: ${ex.message}`, 'error');
    }
  };
  $('#fact-save').addEventListener('click', () => {
    const note = $('#fact-note').value.trim();
    if (topic !== 'chevron' && !draft.types.length) { toast('種類を選んでください（なければ「データなし」）', 'error'); return; }
    const value = topic === 'chevron' ? { bg: draft.bg, fg: draft.fg, ...(draft.alt.length ? { alt: draft.alt } : {}) } : { types: draft.types };
    if (note) value.note = note;
    save(value, '保存しました');
  });
  $('#fact-none').addEventListener('click', () => save({ none: true }, 'データなしにしました'));
}

/* ================= モーダル ================= */
let modalPasteHandler = null;
function openModal(html, cls = '', nav = false) {
  const m = $('#modal');
  if (!nav) { modalStack = []; modalCurrent = null; }
  m.className = `modal ${cls}`;
  m.style.removeProperty('--cat');
  if (!m.open) play('open'); // 詳細の中で移るとき（戻る・国へ）はタップ音だけ
  m.innerHTML = `<div class="modal-inner">${html}</div>`;
  modalPasteHandler = null;
  $$('[data-close]', m).forEach((b) => b.addEventListener('click', closeModal));
  if (!m.open) { m.showModal(); spotOverModal = false; }
  raiseChat(); // メモのボタン・欄をモーダルの手前に
}
function closeModal() {
  const m = $('#modal');
  if (m.open && returnToEditor()) return;
  if (m.open) m.close();
}
// 編集中に検索などで詳細を開いていたら、閉じる代わりに編集の画面へ戻る（入力内容を失わないように）
function returnToEditor() {
  if (!modalCurrent || modalCurrent.kind === 'editor') return false;
  const i = modalStack.findIndex((x) => x.kind === 'editor');
  if (i < 0) return false;
  const entry = modalStack[i];
  modalStack = modalStack.slice(0, i);
  showNav(entry);
  return true;
}

function emptyState(msg) {
  const canAdd = state.user.isEditor;
  return `<div class="empty">
    <p>${msg}</p>
    ${canAdd ? '<p><a class="btn btn-primary" href="#manage">カードを追加する</a></p>' : ''}
  </div>`;
}

// 地域・カテゴリーの絞り込み（複数選択）。チェックを外した項目を off に持つ（off が空 = すべて）
// 暗記カード・編集画面・地図で共通
const pickMatch = (c, regionsOff, catsOff) => [...cardRegions(c)].some((r) => !regionsOff.has(r)) && !catsOff.has(catKey(c));
const regionPickHtml = (id, off) => multiPickHtml(id, 'すべての地域', '地域', REGIONS.map((r) => ({ id: r.id, name: r.name, n: state.cards.filter((c) => cardRegions(c).has(r.id)).length })), off);
const catPickHtml = (id, off) => multiPickHtml(id, 'すべてのカテゴリー', 'カテゴリー', allCats().map((k) => ({ id: k.id, name: k.name, dot: catVars(k), n: state.cards.filter((c) => catKey(c) === k.id).length })), off);

// 複数選択のドロップダウン。チェックが入っている項目が対象
function multiPickHtml(id, allLabel, unit, options, off) {
  const on = options.filter((o) => !off.has(o.id));
  const offs = options.filter((o) => off.has(o.id));
  const label = !offs.length ? allLabel
    : !on.length ? `${unit}: なし`
      : on.length === 1 ? on[0].name
        : offs.length === 1 ? `${offs[0].name} 以外`
          : on.length === 2 ? `${on[0].name}・${on[1].name}`
            : `${unit} ${on.length} / ${options.length}`;
  return `<div class="mpick" id="${id}">
    <button type="button" class="select mpick-btn ${offs.length ? 'is-set' : ''} ${on.length ? '' : 'is-none'}" aria-haspopup="true" aria-expanded="false" title="${esc(offs.length ? on.map((o) => o.name).join('、') || 'なし' : allLabel)}">
      <span class="mpick-label">${esc(label)}</span><span class="mpick-arrow" aria-hidden="true">▾</span>
    </button>
    <div class="mpick-pop" hidden>
      <div class="mpick-head">
        <button type="button" class="btn btn-ghost btn-sm" data-mp-all ${offs.length ? '' : 'disabled'}>☑ 全選択</button>
        <button type="button" class="btn btn-ghost btn-sm" data-mp-none ${on.length ? '' : 'disabled'}>☐ 全解除</button>
        <span class="muted small">${on.length} / ${options.length}</span>
      </div>
      <div class="mpick-list">${options.map((o) => `
        <label class="mpick-item ${o.n ? '' : 'is-empty'}" ${o.dot ? `style="${o.dot}"` : ''}>
          <input type="checkbox" value="${esc(o.id)}" ${off.has(o.id) ? '' : 'checked'}>
          ${o.dot ? '<span class="cat-dot"></span>' : ''}<span class="mpick-name">${esc(o.name)}</span><span class="mpick-n">${o.n}</span>
        </label>`).join('')}</div>
    </div>
  </div>`;
}
function bindMultiPick(id, off, onChange, reopen = false) {
  const root = $(`#${id}`);
  if (!root) return;
  const btn = $('.mpick-btn', root);
  const pop = $('.mpick-pop', root);
  const setOpen = (on) => {
    // ほかに開いている欄は閉じる
    if (on) $$('.mpick-pop').forEach((p) => { if (p !== pop) { p.hidden = true; p.previousElementSibling?.setAttribute('aria-expanded', 'false'); } });
    pop.hidden = !on;
    btn.setAttribute('aria-expanded', String(on));
    // 画面の右端からはみ出すときは左へずらす
    pop.style.left = '';
    if (on) {
      const over = pop.getBoundingClientRect().right - (document.documentElement.clientWidth - 8);
      if (over > 0) pop.style.left = `${-over}px`;
    }
  };
  btn.addEventListener('click', () => setOpen(pop.hidden));
  const boxes = $$('input', pop);
  boxes.forEach((cb) => cb.addEventListener('change', () => {
    if (cb.checked) off.delete(cb.value); else off.add(cb.value);
    onChange();
  }));
  $('[data-mp-all]', pop).addEventListener('click', () => { off.clear(); onChange(); });
  $('[data-mp-none]', pop).addEventListener('click', () => { for (const cb of boxes) off.add(cb.value); onChange(); });
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); btn.focus(); } });
  if (reopen) { setOpen(true); }
}
// 欄の外をクリックしたら閉じる
document.addEventListener('pointerdown', (e) => {
  if (e.target.closest?.('.mpick')) return;
  $$('.mpick-pop').forEach((p) => { if (!p.hidden) { p.hidden = true; p.previousElementSibling?.setAttribute('aria-expanded', 'false'); } });
});

/* ================= 暗記カード ================= */
/* ---- 暗記に混ぜる参考写真 ---- */
const PHOTO_NEW_PER_DAY = 10; // 復習では、まだ見ていない写真は 1 日に何枚ずつ増やすか
const PHOTO_NEW_KEY = 'geo-cards-photo-new-v1'; // { day, ids: [今日はじめて覚え具合をつけた写真] }
const photoNewToday = () => {
  let v = null;
  try { v = JSON.parse(localStorage.getItem(PHOTO_NEW_KEY)); } catch { /* 空 */ }
  return v && v.day === dayKey() ? v : { day: dayKey(), ids: [] };
};
function notePhotoIntroduced(id) {
  const v = photoNewToday();
  if (!v.ids.includes(id)) v.ids.push(id);
  try { localStorage.setItem(PHOTO_NEW_KEY, JSON.stringify(v)); } catch { /* 無視 */ }
}
// 地域・カテゴリーの絞り込みに従った参考写真（カテゴリーの「ボラード」などを外すと、その種類の写真も外れる）
function studyPhotoCards(s) {
  const off = new Set(state.categories.filter((k) => s.catsOff.has(k.id) && PHOTO_TOPICS.includes(CAT_TOPIC[k.name])).map((k) => CAT_TOPIC[k.name]));
  const out = [];
  for (const t of PHOTO_TOPICS) {
    if (off.has(t)) continue;
    for (const [code, list] of Object.entries(REF_IMAGES[t] || {})) {
      if (!COUNTRY_BY_CODE.has(code) || s.regionsOff.has(COUNTRY_BY_CODE.get(code).region)) continue;
      list.forEach((_, i) => { const c = refCard(`ref|${t}|${code}|${i}`); if (c) out.push(c); });
    }
  }
  return out;
}
// 日付から決まる並び（同じ日のうちは、組み直しても同じ写真が選ばれるように）
function seededOrder(ids, seedText) {
  let h = 2166136261;
  for (const ch of seedText) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const rnd = () => { h = (h + 0x6d2b79f5) | 0; let t = Math.imul(h ^ (h >>> 15), 1 | h); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const a = [...ids].sort();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
// 復習に出す id: 自分のカード全部 + 覚え具合をつけた写真 + まだの写真（1 日 PHOTO_NEW_PER_DAY 枚まで）
function reviewPoolIds(s) {
  const ids = state.cards.filter((c) => pickMatch(c, s.regionsOff, s.catsOff)).map((c) => c.id);
  if (!settings.studyPhotos) return ids;
  const photos = studyPhotoCards(s).map((c) => c.id);
  const today = new Set(photoNewToday().ids);
  const seen = photos.filter((id) => getProg(id));
  const unseen = seededOrder(photos.filter((id) => !getProg(id)), dayKey());
  const room = Math.max(0, PHOTO_NEW_PER_DAY - today.size);
  return [...ids, ...seen, ...unseen.slice(0, room)];
}

function rebuildStudyDeck(keepPosition = false) {
  const s = state.study;
  const currentId = s.deck[s.index];
  let list = state.cards.filter((c) => pickMatch(c, s.regionsOff, s.catsOff));
  if (s.review) {
    // 復習: 期限が来たカード（苦手な順）→ まだ覚え具合をつけていないカード
    const order = reviewOrder(reviewPoolIds(s));
    s.deck = order;
    const idx = keepPosition ? s.deck.indexOf(currentId) : -1;
    s.index = idx >= 0 ? idx : 0;
    if (idx < 0) s.flipped = settings.studyStart === 'back';
    return;
  }
  if (settings.studyPhotos) list = [...list, ...studyPhotoCards(s)]; // 自分のカードのあとに写真（シャッフルしたときは混ぜる）
  if (s.shuffled) {
    // 既存の並びをなるべく保つ
    const prev = new Map(s.deck.map((id, i) => [id, i]));
    const known = list.filter((c) => prev.has(c.id)).sort((a, b) => prev.get(a.id) - prev.get(b.id));
    const fresh = shuffle(list.filter((c) => !prev.has(c.id)));
    list = keepPosition ? [...known, ...fresh] : shuffle(list);
  }
  s.deck = list.map((c) => c.id);
  const idx = keepPosition ? s.deck.indexOf(currentId) : -1;
  s.index = idx >= 0 ? idx : 0;
  if (idx < 0) s.flipped = settings.studyStart === 'back';
}

function renderStudy() {
  setFit(true);
  const s = state.study;
  const total = s.deck.length;
  const card = cardById(s.deck[s.index]);
  const split = settings.studySplit;
  const filteredIds = reviewPoolIds(s);
  const reviewCount = filteredIds.filter((id) => isDue(id)).length;
  const keys = { ...DEFAULT_KEYS, ...settings.keys };
  $('#view').classList.toggle('is-back', split || s.flipped);
  $('#view').innerHTML = `
    <div class="toolbar">
      ${regionPickHtml('study-region', s.regionsOff)}
      ${catPickHtml('study-cat', s.catsOff)}
      <button class="btn" id="study-shuffle" aria-label="シャッフル" title="押すたびに順番をランダムに並べ替え">🔀<span class="tab-long"> シャッフル</span></button>
      <button class="btn ${s.review ? 'btn-on' : ''}" id="study-review" aria-pressed="${s.review}" title="期限が来たカード・苦手なカードと、まだ覚え具合をつけていないカードだけを出します">🧠<span class="tab-long"> 復習</span>${reviewCount ? ` <b class="badge-n">${reviewCount}</b>` : ''}</button>
      <button class="btn ${settings.studyPhotos ? 'btn-on' : ''}" id="study-photos" aria-pressed="${settings.studyPhotos}" aria-label="参考写真も出す" title="GeoHints の参考写真（約 1,000 枚）も暗記に混ぜます。復習では、まだ見ていない写真は 1 日 ${PHOTO_NEW_PER_DAY} 枚ずつ増えます">📷<span class="tab-long"> 写真も</span></button>
      <button class="btn ${split ? 'btn-on' : ''}" id="study-split" aria-pressed="${split}" aria-label="表と裏を並べて表示" title="表面と裏面を左右に並べて表示">◫<span class="tab-long"> 並べて表示</span></button>
      <span class="counter">${total ? `${s.index + 1} / ${total}` : '0 / 0'}</span>
    </div>
    <div class="progress"><div class="progress-bar" style="width:${total ? ((s.index + 1) / total) * 100 : 0}%"></div></div>
    ${card ? `
      <div class="flash-wrap ${s.enter ? `enter-${s.enter}` : ''}">
        <div class="flashcard ${split ? 'split' : s.flipped ? 'is-flipped' : ''}" id="flashcard" ${split ? '' : 'role="button" aria-label="カードをめくる"'} tabindex="0" style="${catStyle(card)}">
          <div class="face face-front">${frontHtml(card, settings.showDesc, split)}</div>
          <div class="face face-back">
            ${catBadge(card, 'cat-on-back')}
            <div class="back-actions">
              <button class="btn btn-sm" id="study-view" type="button" title="カード詳細を開く">🔍<span class="tab-long"> カードを見る</span></button>
              <div class="back-country-wrap">
                <button class="btn btn-sm" id="study-country" type="button" title="国の基本情報" ${card.countries.length > 1 ? 'aria-haspopup="menu" aria-expanded="false"' : ''}>🌐<span class="tab-long"> 国を見る</span>${card.countries.length > 1 ? ' ▾' : ''}</button>
                ${card.countries.length > 1 ? `<div class="back-menu" id="study-country-menu" role="menu" hidden>
                  ${card.countries.map((c) => `<button type="button" role="menuitem" data-country="${c}">${flagImg(c)}${esc(countryName(c))}</button>`).join('')}
                </div>` : ''}
              </div>
              ${state.user.isEditor && !card.photo ? '<button class="btn btn-sm" id="study-edit" type="button" title="編集">✏️<span class="tab-long"> 編集</span></button>' : ''}
            </div>
            <div class="back-inner">
              ${split ? '' : backImgHtml(card)}
              <div class="back-answer">${answerHtml(card)}</div>
              <div class="srs-row">${levelHtml(card.id)}</div>
              ${notesHtml(card)}
              ${card.photo ? photoInfoHtml(card.topic, card.src, card.countries[0]) : ''}
              ${relatedHtml(card)}
            </div>
            ${cardFactsHtml(card, true)}
          </div>
        </div>
      </div>
      <div class="study-nav">
        <button class="btn btn-round" id="study-prev" aria-label="前へ" ${s.index === 0 ? 'disabled' : ''}>←</button>
        <button class="btn btn-mark mark-ng" id="study-ng" title="まだ覚えていない（すぐまた出ます）">😣 まだ<kbd>${esc(keyLabel(keys.unknown))}</kbd></button>
        ${split ? '' : '<button class="btn btn-primary" id="study-flip">めくる</button>'}
        <button class="btn btn-mark mark-ok" id="study-ok" title="覚えた（次に出るまでの間隔が空きます）">👍 覚えた<kbd>${esc(keyLabel(keys.known))}</kbd></button>
        <button class="btn btn-round" id="study-next" aria-label="次へ" ${s.index >= total - 1 ? 'disabled' : ''}>→</button>
      </div>
      <p class="hint">${split ? '<span class="tab-long">← → で移動・画像はホイールで拡大、ドラッグで移動</span><span class="tab-short">左右スワイプで移動・ピンチで拡大</span>' : '<span class="tab-long">クリック / スペースキーでめくる・← → で移動・画像はホイールで拡大、ドラッグで移動</span><span class="tab-short">タップでめくる・左右スワイプで移動・ピンチで拡大</span>'}</p>
    ` : emptyState(s.review && filteredIds.length ? '🎉 今日の復習はすべて終わりました<br><small class="muted">「復習」をもう一度押すと、すべてのカードに戻ります</small>' : state.cards.length ? 'この地域のカードはまだありません' : 'カードがまだありません')}
  `;
  s.enter = '';
  const repick = (id) => { s.openPick = id; rebuildStudyDeck(); renderStudy(); };
  bindMultiPick('study-region', s.regionsOff, () => repick('study-region'), s.openPick === 'study-region');
  bindMultiPick('study-cat', s.catsOff, () => repick('study-cat'), s.openPick === 'study-cat');
  s.openPick = null;
  // 押すたびに並べ替えて 1 枚目から（以降、絞り込みを変えてもランダムな順のまま）
  $('#study-review').addEventListener('click', () => {
    s.review = !s.review;
    rebuildStudyDeck();
    s.enter = 'next';
    renderStudy();
    toast(s.review ? `復習モード: ${s.deck.length} 枚` : 'すべてのカードに戻りました');
  });
  if (card) { bindCardFacts($('#flashcard')); bindRelated($('#flashcard')); }
  preloadStudyImages();
  // 参考写真の解説は大きなデータなので、写真を混ぜているときだけ読み込んで描き直す
  if (settings.studyPhotos && !refInfoLoaded()) ensureRefInfo().then(() => { if (state.view === 'study') renderStudy(); }).catch(() => {});
  $('#back-facts')?.addEventListener('toggle', (e) => { s.factsOpen = e.currentTarget.open; });
  $('#study-ok')?.addEventListener('click', () => markStudy('ok'));
  $('#study-ng')?.addEventListener('click', () => markStudy('ng'));
  $('#study-photos').addEventListener('click', async () => {
    settings.studyPhotos = !settings.studyPhotos;
    saveSettings();
    if (settings.studyPhotos) await ensureRefInfo().catch(() => {}); // 写真の解説・撮影場所
    rebuildStudyDeck();
    s.enter = 'next';
    renderStudy();
    toast(settings.studyPhotos ? `参考写真も出します（${s.review ? `復習は 1 日 ${PHOTO_NEW_PER_DAY} 枚ずつ` : `${s.deck.length} 枚`}）` : '自分のカードだけに戻しました');
  });
  $('#study-split').addEventListener('click', () => { settings.studySplit = !settings.studySplit; saveSettings(); renderStudy(); });
  $('#study-shuffle').addEventListener('click', () => {
    s.shuffled = true;
    rebuildStudyDeck();
    s.enter = 'next';
    play('flip');
    renderStudy();
    toast('順番をシャッフルしました');
  });
  if (card) {
    $('#flashcard').addEventListener('click', (e) => {
      // 画像部分のタップは attachZoom 側で処理（ドラッグ・拡大中はめくらない）
      if (e.target.closest('.front-img, button, .card-facts-mini, .related, a')) return;
      flipStudy();
    });
    attachZoom($('#flashcard .front-img'), { onTap: flipStudy, onSwipe: moveStudy, dblclick: false });
    bindSwipe($('#flashcard .face-back'), moveStudy);
    const editBtn = $('#study-edit');
    if (editBtn) editBtn.addEventListener('click', (e) => { e.stopPropagation(); openEditor(card); });
    $('#study-view').addEventListener('click', (e) => { e.stopPropagation(); openCardModal(card); });
    const menu = $('#study-country-menu');
    $('#study-country').addEventListener('click', (e) => {
      e.stopPropagation();
      if (!menu) { openCountryInfo(card.countries[0], e.currentTarget); return; }
      menu.hidden = !menu.hidden;
      e.currentTarget.setAttribute('aria-expanded', String(!menu.hidden));
    });
    if (menu) {
      menu.addEventListener('click', (e) => {
        e.stopPropagation();
        const b = e.target.closest('[data-country]');
        if (!b) return;
        menu.hidden = true;
        openCountryInfo(b.dataset.country, b);
      });
      // メニューの外をクリックしたら閉じる
      $('#flashcard .face-back').addEventListener('click', (e) => {
        if (!e.target.closest('.back-country-wrap') && !menu.hidden) { menu.hidden = true; e.stopPropagation(); }
      }, true);
    }
    $('#study-flip')?.addEventListener('click', flipStudy);
    $('#study-prev').addEventListener('click', () => moveStudy(-1));
    $('#study-next').addEventListener('click', () => moveStudy(1));
  }
}

// 次（と前）のカードの画像を先に読み込んでおく（めくったあとの表示が待たされないように）
// 読み込み中の Image は参照を持っておく（なくなると読み込みが途中で止まることがあるため）
const preloaded = new Map(); // url -> Image（新しいものだけ残す）
function preloadStudyImages() {
  if (navigator.connection?.saveData) return; // データ節約の設定では先読みしない
  const s = state.study;
  for (const i of [s.index + 1, s.index + 2, s.index - 1]) {
    const c = cardById(s.deck[i]);
    if (!c) continue;
    for (const url of [imgUrl(c), backUrl(c)]) {
      if (!url || preloaded.has(url) || url.startsWith('data:')) continue;
      const img = new Image();
      img.fetchPriority = 'low'; // 今見ているカードの読み込みを邪魔しない
      img.decoding = 'async';
      img.src = url;
      preloaded.set(url, img);
    }
  }
  while (preloaded.size > 12) preloaded.delete(preloaded.keys().next().value); // 古いものから手放す
}

// 裏面など、拡大機能のない場所での横スワイプ
function bindSwipe(el, fn) {
  if (!el) return;
  let st = null;
  el.addEventListener('touchstart', (e) => {
    st = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() } : null;
  }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (!st) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - st.x;
    const dy = t.clientY - st.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - st.t < 700) {
      e.preventDefault(); // 続く click でめくらないように
      fn(dx < 0 ? 1 : -1);
    }
    st = null;
  });
}

function flipStudy() {
  const fc = $('#flashcard');
  if (!fc || settings.studySplit) return; // 並べて表示中はめくらない
  state.study.flipped = !state.study.flipped;
  play('flip');
  fc.parentElement.classList.remove('enter-next', 'enter-prev'); // スライドのアニメーションと競合させない
  fc.classList.remove('anim-to-back', 'anim-to-front');
  void fc.offsetWidth; // アニメーションを最初から再生させる
  fc.classList.add(state.study.flipped ? 'anim-to-back' : 'anim-to-front');
  fc.classList.toggle('is-flipped', state.study.flipped);
  $('#view').classList.toggle('is-back', state.study.flipped);
}

// 暗記カード: 覚えた / まだ をつけて次のカードへ（答えが見えているときだけ）
function markStudy(result) {
  const s = state.study;
  const card = cardById(s.deck[s.index]);
  if (!card || !(s.flipped || settings.studySplit)) return;
  if (card.photo && !getProg(card.id)) notePhotoIntroduced(card.id); // 今日の「新しい写真」の枚数に数える
  record(card.id, result);
  logActivity(result === 'ok', COUNTRY_BY_CODE.get(card.countries[0])?.region);
  play(result === 'ok' ? 'correct' : 'partial');
  if (s.index < s.deck.length - 1) { moveStudy(1); return; }
  // 最後のカード: 復習なら残り（まだ のカードなど）で組み直す
  if (s.review) {
    rebuildStudyDeck();
    s.enter = 'next';
    renderStudy();
    toast(s.deck.length ? `復習が一巡しました。残り ${s.deck.length} 枚` : '🎉 今日の復習はすべて終わりました');
  } else {
    renderStudy();
    toast('最後のカードです');
  }
}

function moveStudy(delta) {
  const s = state.study;
  const ni = s.index + delta;
  if (ni < 0 || ni >= s.deck.length) return;
  play('slide');
  s.index = ni;
  s.flipped = settings.studyStart === 'back';
  s.enter = delta > 0 ? 'next' : 'prev';
  renderStudy();
}

/* ================= クイズ ================= */
function quizEligible(regions) {
  const off = state.quiz.catsOff;
  return state.cards.filter((c) => !off.has(catKey(c)) && c.countries.some((code) => regions.has(COUNTRY_BY_CODE.get(code)?.region)));
}

function renderQuiz() {
  const q = state.quiz;
  setFit(q.phase === 'question' ? true : 'scroll');
  if (q.phase === 'question') return renderQuestion();
  if (q.phase === 'result') return renderQuizResult();

  const counts = new Map(REGIONS.map((r) => [r.id, 0]));
  for (const c of state.cards) for (const r of cardRegions(c)) counts.set(r, counts.get(r) + 1);
  const catCounts = new Map(allCats().map((c) => [c.id, 0]));
  for (const c of state.cards) catCounts.set(catKey(c), catCounts.get(catKey(c)) + 1);
  const eligible = quizEligible(q.regions).length;

  const isFact = q.kind === 'fact';
  const isPhoto = q.kind === 'photo';
  if (!isPhoto && q.mode === 'pin') q.mode = 'choice';
  const factEligible = isFact ? factQuizPool(q.factTopic, q.regions).length : 0;
  const photoEligible = isPhoto ? photoPool(q).length : 0;
  $('#view').innerHTML = `
    <section class="panel quiz-setup ${isFact ? 'is-fact' : ''} ${isPhoto ? 'is-photo' : ''}">
      <h2>クイズ設定</h2>
      <div class="setup-block">
        <div class="setup-label"><span>出題内容</span></div>
        <div class="seg" id="q-kind">
          <button class="${q.kind === 'cards' ? 'on' : ''}" data-kind="cards">🃏 カード（画像から国を当てる）</button>
          <button class="${isPhoto ? 'on' : ''}" data-kind="photo">📷 参考写真（GeoHints の写真から国を当てる）</button>
          <button class="${isFact ? 'on' : ''}" data-kind="fact">🗺 国の特徴・基本データ</button>
        </div>
      </div>
      ${isPhoto ? `
      <div class="setup-block">
        <div class="setup-label"><span>写真の種類</span></div>
        <div class="seg seg-wrap" id="q-ptopic">
          ${PHOTO_TOPICS.map((t) => `<button class="${q.photoTopics.has(t) ? 'on' : ''}" data-ptopic="${t}">${modeDef(t).icon} ${modeDef(t).name}</button>`).join('')}
        </div>
        <p class="muted small">地図の参考写真（約 1,000 枚）から出題します。答えたあとに撮影場所と Google マップのリンクが出ます</p>
        <div class="og-export">
          ${allSpotsLink()}
          <span class="muted small">🎮 この条件の写真の撮影地点を、ほかのサイトで遊べるマップ（GeoGuessr 形式の JSON）として書き出し</span>
          <select class="select select-sm og-site" id="q-og-site" aria-label="書き出し先">${Object.entries(PLAY_SITES).map(([k, v]) => `<option value="${k}" ${playSite() === v ? 'selected' : ''}>${v.name} 用</option>`).join('')}</select>
          <button type="button" class="btn btn-ghost btn-sm" id="q-og">書き出す</button>
        </div>
      </div>` : ''}
      ${isFact ? `
      <div class="setup-block">
        <div class="setup-label"><span>答える特徴</span></div>
        <div class="seg seg-wrap" id="q-topic">
          ${FACT_TOPICS.map((t) => `<button class="${q.factTopic === t ? 'on' : ''}" data-topic="${t}">${modeDef(t).icon} ${modeDef(t).name}</button>`).join('')}
        </div>
        <div class="setup-label setup-sub"><span>問題の向き</span></div>
        <div class="seg" id="q-dir">
          <button class="${q.factDir === 'forward' ? 'on' : ''}" data-dir="forward">国 → 特徴（4 択）</button>
          <button class="${q.factDir === 'reverse' ? 'on' : ''}" data-dir="reverse">特徴 → 国（地図で答える）</button>
        </div>
        <p class="muted small">${q.factDir === 'reverse'
          ? `${esc(modeDef(q.factTopic).name)}の見本を見て、それが見られる国を地図でクリックします（当てはまる国ならどれでも正解）`
          : `国旗と国名を見て、その国の${esc(modeDef(q.factTopic).name)}を 4 択で答えます`}。地図の「${esc(modeDef(q.factTopic).name)}」モードと同じデータです</p>
      </div>` : ''}
      <div class="setup-block">
        <div class="setup-label">
          <span>出題する地域</span>
          <span class="setup-actions">
            <button class="link-btn" id="q-all">すべて選択</button>
            <button class="link-btn" id="q-none">すべて解除</button>
          </span>
        </div>
        <div class="region-grid">
          ${REGIONS.map((r) => `
            <label class="region-check ${counts.get(r.id) ? '' : 'is-empty'}">
              <input type="checkbox" value="${r.id}" ${q.regions.has(r.id) ? 'checked' : ''}>
              <span>${esc(r.name)}</span>
              <span class="count">${counts.get(r.id)}</span>
            </label>`).join('')}
        </div>
      </div>
      <div class="setup-block cards-only">
        <div class="setup-label">
          <span>カテゴリー</span>
          <span class="setup-actions">
            <button class="link-btn" id="qc-all">すべて選択</button>
            <button class="link-btn" id="qc-none">すべて解除</button>
          </span>
        </div>
        <div class="region-grid cat-grid">
          ${allCats().map((c) => `
            <label class="region-check cat-check ${catCounts.get(c.id) ? '' : 'is-empty'}" style="${catVars(c)}">
              <input type="checkbox" value="${c.id}" ${q.catsOff.has(c.id) ? '' : 'checked'}>
              <span class="cat-dot"></span><span>${esc(c.name)}</span>
              <span class="count">${catCounts.get(c.id)}</span>
            </label>`).join('')}
        </div>
      </div>
      <div class="setup-row">
        <div class="setup-block">
          <div class="setup-label"><span>問題数</span></div>
          <div class="seg" id="q-count">
            ${[10, 20, 50, 0].map((n) => `<button class="${q.count === n ? 'on' : ''}" data-n="${n}">${n || '全部'}</button>`).join('')}
          </div>
        </div>
        <div class="setup-block not-fact">
          <div class="setup-label"><span>回答方式</span></div>
          <div class="seg" id="q-mode">
            <button class="${q.mode === 'choice' ? 'on' : ''}" data-mode="choice">4択</button>
            <button class="${q.mode === 'input' ? 'on' : ''}" data-mode="input">国名を入力</button>
            <button class="${q.mode === 'map' ? 'on' : ''}" data-mode="map">🗺 地図で答える</button>
            ${isPhoto ? `<button class="${q.mode === 'pin' ? 'on' : ''}" data-mode="pin" title="写真の撮影地点を地図でクリック。近いほど高得点">📍 撮影地点を当てる</button>` : ''}
          </div>
        </div>
        <div class="setup-block">
          <div class="setup-label"><span>制限時間（タイムアタック）</span></div>
          <div class="seg" id="q-time">
            ${[0, 60, 120].map((n) => `<button class="${q.timeLimit === n ? 'on' : ''}" data-t="${n}">${n ? `${n} 秒` : 'なし'}</button>`).join('')}
          </div>
        </div>
        <div class="setup-block cards-only">
          <div class="setup-label"><span>出題の順番</span></div>
          <div class="seg" id="q-order">
            <button class="${q.order === 'random' ? 'on' : ''}" data-order="random">ランダム</button>
            <button class="${q.order === 'weak' ? 'on' : ''}" data-order="weak" title="間違えたカード・覚え具合の低いカードを先に出します">苦手を優先</button>
          </div>
        </div>
      </div>
      <div class="setup-foot">
        <span class="muted">${isFact ? `対象の国: <strong>${factEligible}</strong> か国` : isPhoto ? `対象の写真: <strong>${photoEligible}</strong> 枚` : `対象カード: <strong>${eligible}</strong> 枚`}${q.timeLimit ? `・⏱ ${q.timeLimit} 秒で何問解けるか（問題数は無制限）` : ''}</span>
        <button class="btn btn-primary btn-lg" id="q-start" ${(isFact ? factEligible : isPhoto ? photoEligible : eligible) ? '' : 'disabled'}>スタート</button>
      </div>
    </section>`;

  $$('.cat-grid input').forEach((cb) => cb.addEventListener('change', () => {
    cb.checked ? q.catsOff.delete(cb.value) : q.catsOff.add(cb.value);
    renderQuiz();
  }));
  $('#qc-all').addEventListener('click', () => { q.catsOff = new Set(); renderQuiz(); });
  $('#qc-none').addEventListener('click', () => { q.catsOff = new Set(allCats().map((c) => c.id)); renderQuiz(); });
  $$('.region-grid:not(.cat-grid) input').forEach((cb) => cb.addEventListener('change', () => {
    cb.checked ? q.regions.add(cb.value) : q.regions.delete(cb.value);
    renderQuiz();
  }));
  $('#q-all').addEventListener('click', () => { q.regions = new Set(REGIONS.map((r) => r.id)); renderQuiz(); });
  $('#q-none').addEventListener('click', () => { q.regions = new Set(); renderQuiz(); });
  $$('#q-count button').forEach((b) => b.addEventListener('click', () => { q.count = Number(b.dataset.n); renderQuiz(); }));
  $$('#q-mode button').forEach((b) => b.addEventListener('click', () => { q.mode = b.dataset.mode; renderQuiz(); }));
  $$('#q-order button').forEach((b) => b.addEventListener('click', () => { q.order = b.dataset.order; renderQuiz(); }));
  $$('#q-kind button').forEach((b) => b.addEventListener('click', () => { q.kind = b.dataset.kind; renderQuiz(); }));
  $$('#q-topic button').forEach((b) => b.addEventListener('click', () => { q.factTopic = b.dataset.topic; renderQuiz(); }));
  $$('#q-dir button').forEach((b) => b.addEventListener('click', () => { q.factDir = b.dataset.dir; renderQuiz(); }));
  $$('#q-ptopic button').forEach((b) => b.addEventListener('click', () => {
    if (q.photoTopics.has(b.dataset.ptopic)) { if (q.photoTopics.size > 1) q.photoTopics.delete(b.dataset.ptopic); } else q.photoTopics.add(b.dataset.ptopic);
    renderQuiz();
  }));
  $('#q-og-site')?.addEventListener('change', (e) => { settings.playSite = e.target.value; saveSettings(); });
  $('#q-og')?.addEventListener('click', async () => {
    await ensureRefInfo().catch(() => toast('写真の情報を読み込めませんでした', 'error'));
    const pool = photoPool({ ...q, mode: 'pin' });
    exportOpenGuessr(pool, `GeoChecker 参考写真（${[...q.photoTopics].map((t) => modeDef(t).name).join('・')}）`);
  });
  $$('#q-time button').forEach((b) => b.addEventListener('click', () => { q.timeLimit = Number(b.dataset.t); renderQuiz(); }));
  $('#q-start').addEventListener('click', async () => {
    if (isPhoto) await ensureRefInfo().catch(() => {}); // 撮影地点を当てる問題に必要な座標
    if (isFact) startFactQuiz(factQuizPool(q.factTopic, q.regions));
    else startQuiz(isPhoto ? photoPool(q) : quizEligible(q.regions));
  });
  // 写真のクイズの設定画面: 「撮影地点を当てる」に出せる枚数の計算に座標が要る。読み込めたら描き直す
  if (isPhoto && !refInfoLoaded()) ensureRefInfo().then(() => { if (state.view === 'quiz' && q.phase === 'setup' && q.kind === 'photo') renderQuiz(); }).catch(() => {});
}

/* ---- タイムアタック（制限時間つき） ---- */
let quizTimer = null;
function startQuizClock(q) {
  clearInterval(quizTimer);
  q.deadline = q.timeLimit ? Date.now() + q.timeLimit * 1000 : 0;
  q.bestSaved = false;
  if (!q.deadline) return;
  quizTimer = setInterval(() => {
    const left = Math.max(0, q.deadline - Date.now());
    const el = $('#qt-timer');
    if (el) { el.textContent = (left / 1000).toFixed(1); el.closest('.counter')?.classList.toggle('is-hurry', left < 10000); }
    if (!left && q.phase === 'question') { endQuizByTime(); }
  }, 100);
}
function endQuizByTime() {
  const q = state.quiz;
  clearInterval(quizTimer);
  q.phase = 'result';
  play('finish');
  if (state.view === 'quiz') renderQuiz();
}
// 時間制限のときは問題を足りなくならないだけ並べる
function stretchPool(list) {
  if (!state.quiz.timeLimit || !list.length) return list;
  const out = [];
  while (out.length < 300) out.push(...shuffle(list));
  return out;
}
const quizCounterHtml = (q) => (q.deadline
  ? `<span class="counter qt-counter">⏱ <b id="qt-timer">${(Math.max(0, q.deadline - Date.now()) / 1000).toFixed(1)}</b> 秒・${q.i + 1} 問目</span>`
  : `<span class="counter">第 ${q.i + 1} 問 / ${q.questions.length}</span>`);
// 答えたあと: タイムアタックはすぐ次へ、そうでなければ設定の「正解したら自動で次へ」
function afterAnswer(result) {
  const q = state.quiz;
  const at = q.i;
  const go = () => { if (state.view === 'quiz' && q.phase === 'question' && q.i === at && q.answered) nextQuestion(); };
  if (q.deadline) setTimeout(go, result === 'ok' ? 600 : 1200);
  else if (result === 'ok' && settings.autoNext) setTimeout(go, 1200);
}

/* ---- 国の特徴クイズ（地図のインフォグラフィックのデータで出題） ---- */
const factChipHtmlSafe = (topic, code) => factPanelHtml(topic, code).replace(/<div class="pfact-head">.*?<\/div>/, '');
const FACT_TOPICS = ['chevron', 'guardrail', 'pole', 'bollard', 'plate', 'lines', 'drive', 'script', 'camera', 'snow', 'tld', 'phone', 'currency', 'capital'];
const allCodes = () => COUNTRIES.map((c) => c.code);
function factQuizPool(topic, regions) {
  if (legendGroups(topic, allCodes()).length < 2) return [];
  // 通行・文字は全ての国にデータがあるので、GeoGuessr に出題される国だけに
  const playOnly = ['drive', 'script', 'tld', 'phone', 'currency', 'capital'].includes(topic);
  return COUNTRIES.filter((c) => regions.has(c.region) && classify(topic, c.code) && (!playOnly || isPlayable(c.code))).map((c) => c.code);
}
// 不正解の選択肢にしてはいけないもの（その国でも見られる種類）
function alsoTrue(topic, code, group) {
  const c = classify(topic, code);
  if (!c) return false;
  if (topic === 'chevron') return (c.alt || []).some((x) => `${x.bg}-${x.fg}` === group.key);
  if (c.value?.types) {
    const mine = new Set(c.value.types);
    return group.key.split('+').some((t) => mine.has(t));
  }
  return false;
}
// 特徴 → 国: 見本を見せて、地図で国をクリック
function renderReverseQuestion() {
  const q = state.quiz;
  const item = q.questions[q.i];
  const a = q.answered;
  const m = modeDef(q.factTopic);
  const okN = q.answers.filter((x) => x.result === 'ok').length;
  const g = a?.given;
  $('#view').innerHTML = `
    <div class="toolbar">
      ${quizCounterHtml(q)}
      <span class="muted">○ ${okN}</span>
      <button class="btn btn-ghost btn-sm" id="q-quit">やめる</button>
    </div>
    <div class="progress"><div class="progress-bar" style="width:${(q.i / q.questions.length) * 100}%"></div></div>
    <div class="qm-layout">
      <div class="quiz-card fact-card rev-card">
        <div class="muted">${esc(m.icon)} ${esc(m.name)}</div>
        <div class="rev-swatch">${item.swatch}</div>
        <div class="fact-country rev-label">${esc(item.label)}</div>
        <p class="muted small">この${esc(m.name)}が見られる国を、地図でクリック（${item.answers.length} か国のどれでも正解）</p>
      </div>
      <div class="qm-side">
        <div class="quiz-map" id="quiz-map"><div class="map-loading">地図を読み込み中…</div></div>
        ${a ? `
          <div class="feedback fb-${a.result}">
            <div class="feedback-head">
              <div class="feedback-title">${a.result === 'ok' ? '○ 正解！' : '✗ 不正解'}</div>
              <button class="btn btn-primary" id="q-next">${q.i + 1 < q.questions.length ? '次へ' : '結果を見る'}<span class="kbd-inline">Enter</span></button>
            </div>
            ${a.result !== 'ok' ? `<p class="qm-dist">あなたの回答: ${flagImg(g)}<b>${esc(countryName(g))}</b>${a.km != null ? ` ・ 一番近い正解まで約 <b>${Math.round(a.km).toLocaleString()} km</b>` : ''}</p>` : ''}
            <div class="rev-answers"><span class="muted small">当てはまる国:</span>${item.answers.map((c) => `<button type="button" class="chip chip-btn" data-info="${c}">${flagImg(c)}${esc(countryName(c))}</button>`).join('')}</div>
          </div>` : ''}
      </div>
    </div>`;
  $('#q-quit').addEventListener('click', () => { clearInterval(quizTimer); q.phase = q.answers.length ? 'result' : 'setup'; renderQuiz(); });
  $$('.rev-answers [data-info]').forEach((b) => b.addEventListener('click', () => openCountryInfo(b.dataset.info, b)));
  const at = q.i;
  mountQuizMap($('#quiz-map'), {
    answers: item.answers,
    answered: a ? { given: [g] } : null,
    animate: settings.animations,
    qid: q.questions[q.i], // 次の問題では地図の位置を世界全体に戻す
    onPick: (code) => {
      if (q.answered || q.i !== at || state.view !== 'quiz') return;
      const result = item.answers.includes(code) ? 'ok' : 'ng';
      q.answered = { given: code, result, km: result === 'ok' ? null : nearestKm(code, item.answers) };
      q.answers.push({ code: item.code, given: code, givenLabel: countryName(code), result, reverse: true, label: item.label, swatch: item.swatch, n: item.answers.length });
      play(result === 'ok' ? 'correct' : 'wrong');
      logActivity(result === 'ok', COUNTRY_BY_CODE.get(item.code)?.region);
      renderReverseQuestion();
      afterAnswer(result);
    },
  }).then(() => $('#quiz-map .map-loading')?.remove()).catch((ex) => {
    const el = $('#quiz-map .map-loading');
    if (el) el.textContent = `地図を読み込めませんでした（${ex.message}）`;
  });
  if (a) {
    $('#q-next').addEventListener('click', nextQuestion);
    $('#q-next').focus({ preventScroll: true });
  }
}

function startFactQuiz(pool) {
  const q = state.quiz;
  const groups = legendGroups(q.factTopic, allCodes());
  let codes = shuffle(pool);
  if (q.count && !q.timeLimit) codes = codes.slice(0, q.count);
  codes = stretchPool(codes);
  q.questions = codes.map((code) => {
    const right = classify(q.factTopic, code);
    const wrong = shuffle(groups.filter((g) => g.key !== right.key && !alsoTrue(q.factTopic, code, g))).slice(0, 3);
    // 逆向き（特徴 → 国）: その分類に当てはまる国すべてが正解
    if (q.factDir === 'reverse') {
      const g = groups.find((x) => x.key === right.key);
      return { code, answer: right.key, reverse: true, label: right.label, swatch: right.swatch || `<span class="sw" style="background:${right.color}"></span>`, answers: g ? g.codes : [code] };
    }
    return { code, answer: right.key, options: shuffle([right, ...wrong]).map((g) => ({ key: g.key, label: g.label, swatch: g.swatch || `<span class="sw" style="background:${g.color}"></span>` })) };
  });
  q.i = 0;
  q.answers = [];
  q.answered = null;
  q.phase = 'question';
  startQuizClock(q);
  renderQuiz();
}
function renderFactQuestion() {
  const q = state.quiz;
  const item = q.questions[q.i];
  if (item.reverse) { renderReverseQuestion(); return; }
  const a = q.answered;
  const m = modeDef(q.factTopic);
  const okN = q.answers.filter((x) => x.result === 'ok').length;
  $('#view').innerHTML = `
    <div class="toolbar">
      ${quizCounterHtml(q)}
      <span class="muted">○ ${okN}</span>
      <button class="btn btn-ghost btn-sm" id="q-quit">やめる</button>
    </div>
    <div class="progress"><div class="progress-bar" style="width:${(q.i / q.questions.length) * 100}%"></div></div>
    <div class="quiz-card fact-card">
      <img class="fact-flag" src="${flagUrl(item.code)}" alt="">
      <div class="fact-country">${esc(countryName(item.code))}</div>
      <div class="muted">${esc(REGION_BY_ID.get(COUNTRY_BY_CODE.get(item.code)?.region)?.name || '')}</div>
    </div>
    <div class="quiz-bottom ${a ? 'is-answered' : ''}">
      ${a ? '' : `<p class="quiz-prompt">この国の${esc(m.icon)} ${esc(m.name)}は？</p>`}
      <div class="choices fact-choices">${item.options.map((o, i) => {
        let cls = '';
        if (a) cls = o.key === item.answer ? 'correct' : o.key === a.given ? 'wrong' : 'dim';
        return `<button class="choice ${cls}" data-key="${esc(o.key)}" ${a ? 'disabled' : ''}><span class="kbd">${i + 1}</span>${o.swatch}<span>${esc(o.label)}</span></button>`;
      }).join('')}</div>
      ${a ? `
        <div class="feedback fb-${a.result}">
          <div class="feedback-head">
            <div class="feedback-title">${a.result === 'ok' ? '○ 正解！' : '✗ 不正解'}</div>
            <button class="btn btn-ghost btn-sm" id="q-info" type="button">🌐<span class="tab-long"> 国を見る</span></button>
            <button class="btn btn-primary" id="q-next">${q.i + 1 < q.questions.length ? '次へ' : '結果を見る'}<span class="kbd-inline">Enter</span></button>
          </div>
          <div class="pfact">${factPanelHtml(q.factTopic, item.code)}</div>
        </div>` : ''}
    </div>`;
  $('#q-quit').addEventListener('click', () => { clearInterval(quizTimer); q.phase = q.answers.length ? 'result' : 'setup'; renderQuiz(); });
  if (a) {
    $('#q-next').addEventListener('click', nextQuestion);
    $('#q-info').addEventListener('click', (e) => openCountryInfo(item.code, e.currentTarget));
    $('#q-next').focus({ preventScroll: true });
    return;
  }
  $$('.fact-choices .choice').forEach((b) => b.addEventListener('click', () => {
    const result = b.dataset.key === item.answer ? 'ok' : 'ng';
    q.answered = { given: b.dataset.key, result };
    q.answers.push({ code: item.code, given: b.dataset.key, givenLabel: item.options.find((o) => o.key === b.dataset.key)?.label, result });
    play(result === 'ok' ? 'correct' : 'wrong');
    logActivity(result === 'ok', COUNTRY_BY_CODE.get(item.code)?.region);
    renderFactQuestion();
    afterAnswer(result);
  }));
}

function startQuiz(pool) {
  const q = state.quiz;
  let cards = shuffle(pool);
  // 苦手を優先: 苦手さの大きい順（同じくらいならランダム）に選んで、出す順番は混ぜる
  if (q.order === 'weak') {
    cards = cards.map((c) => ({ c, w: weakness(c.id) + Math.random() * 0.15 })).sort((a, b) => b.w - a.w).map((x) => x.c);
    if (q.count) cards = shuffle(cards.slice(0, q.count));
  } else if (q.count && !q.timeLimit) cards = cards.slice(0, q.count);
  cards = stretchPool(cards);
  q.questions = cards.map((c) => ({ cardId: c.id, options: q.mode === 'choice' ? makeOptions(c, q.regions) : null }));
  q.i = 0;
  q.answers = [];
  q.answered = null;
  q.phase = 'question';
  startQuizClock(q);
  renderQuiz();
}

// 正解1つ + 紛らわしい不正解3つ（できるだけ同じ地域から）
function makeOptions(card, regions) {
  const inSel = card.countries.filter((c) => regions.has(COUNTRY_BY_CODE.get(c)?.region));
  const correct = pick(inSel.length ? inSel : card.countries);
  const exclude = new Set(card.countries);
  const correctRegion = COUNTRY_BY_CODE.get(correct)?.region;
  const sameRegion = shuffle(COUNTRIES.filter((c) => c.region === correctRegion && !exclude.has(c.code)).map((c) => c.code));
  const selRegion = shuffle(COUNTRIES.filter((c) => regions.has(c.region) && c.region !== correctRegion && !exclude.has(c.code)).map((c) => c.code));
  const rest = shuffle(COUNTRIES.filter((c) => !exclude.has(c.code)).map((c) => c.code));
  const picks = [];
  const take = (src, n) => { for (const c of src) { if (picks.length >= n) break; if (!picks.includes(c)) picks.push(c); } };
  take(sameRegion, 2);
  take(selRegion, 3);
  take(sameRegion, 3);
  take(rest, 3);
  return shuffle([correct, ...picks]);
}

// 採点: 全部正解 → ok、一部正解 → partial、正解なし → ng
function grade(card, given) {
  const answers = new Set(card.countries);
  const hits = given.filter((g) => answers.has(g)).length;
  if (hits === 0) return 'ng';
  if (hits === answers.size && hits === given.length) return 'ok';
  return 'partial';
}
const RESULT_LABEL = { ok: '○ 正解！', partial: '△ 部分正解', ng: '✗ 不正解' };

function renderQuestion() {
  const q = state.quiz;
  if (q.kind === 'fact') { renderFactQuestion(); return; }
  const item = q.questions[q.i];
  const card = cardById(item.cardId);
  if (!card) { nextQuestion(); return; }
  const a = q.answered;
  const multi = q.mode === 'input' && card.countries.length > 1;
  q.draft = q.draft || [];
  if (q.mode === 'map') { renderMapQuestion(card); return; }
  if (q.mode === 'pin' && card.lat != null) { renderPinQuestion(card); return; }

  let answerUi;
  if (q.mode === 'choice') {
    answerUi = `<div class="choices">${item.options.map((code, i) => {
      let cls = '';
      if (a) {
        if (card.countries.includes(code)) cls = 'correct';
        else if (a.given.includes(code)) cls = 'wrong';
        else cls = 'dim';
      }
      return `<button class="choice ${cls}" data-code="${code}" ${a ? 'disabled' : ''}>
        <span class="kbd">${i + 1}</span>${flagImg(code)}<span>${esc(countryName(code))}</span></button>`;
    }).join('')}</div>`;
  } else if (!a) {
    answerUi = `
      <div class="input-answer">
        <div class="multi-input" id="q-box">
          <span id="q-chips" class="q-chips"></span>
          <input type="text" id="q-input" list="country-list" placeholder="${multi ? '国名を入力して Enter で追加' : '国名を入力（例: ポーランド / Poland）'}" autocomplete="off" enterkeyhint="${multi ? 'next' : 'done'}">
        </div>
        <button class="btn btn-primary" type="button" id="q-submit">回答</button>
      </div>
      ${multi ? `<p class="muted small multi-note">答えは <b>${card.countries.length} か国</b>。Enter で追加し、「回答」で確定（一部だけ正解なら △）</p>` : ''}`;
  } else {
    // 回答後: 正解・未回答・誤答を並べる
    const answers = new Set(card.countries);
    answerUi = `<div class="given-list">
      ${card.countries.map((c) => `<span class="given ${a.given.includes(c) ? 'given-hit' : 'given-miss'}">${a.given.includes(c) ? '✓' : '・'} ${flagImg(c)}${esc(countryName(c))}${a.given.includes(c) ? '' : '<small>（未回答）</small>'}</span>`).join('')}
      ${a.given.filter((g) => !answers.has(g)).map((g) => `<span class="given given-wrong">✗ ${flagImg(g)}${esc(countryName(g))}</span>`).join('')}
    </div>`;
  }

  const okN = q.answers.filter((x) => x.result === 'ok').length;
  const partN = q.answers.filter((x) => x.result === 'partial').length;
  $('#view').innerHTML = `
    <div class="toolbar">
      ${quizCounterHtml(q)}
      <span class="muted">○ ${okN}${partN ? ` △ ${partN}` : ''}</span>
      <button class="btn btn-ghost btn-sm" id="q-quit">やめる</button>
    </div>
    <div class="progress"><div class="progress-bar" style="width:${(q.i / q.questions.length) * 100}%"></div></div>
    <div class="quiz-card" style="${catStyle(card)}">${frontHtml(card)}</div>
    <div class="quiz-bottom ${a ? 'is-answered' : ''}">
      ${a ? '' : '<p class="quiz-prompt">この特徴が見られる国は？</p>'}
      ${answerUi}
      ${a ? `
        <div class="feedback fb-${a.result}">
          <div class="feedback-head">
            <div class="feedback-title">${RESULT_LABEL[a.result]}${a.result === 'partial' ? ` <small>（${a.given.filter((g) => card.countries.includes(g)).length} / ${card.countries.length}）</small>` : ''}</div>
            <button class="btn btn-ghost btn-sm" id="q-view" type="button" title="カード詳細を開く">🔍<span class="tab-long"> カードを見る</span></button>
            <button class="btn btn-primary" id="q-next">${q.i + 1 < q.questions.length ? '次へ' : '結果を見る'}<span class="kbd-inline">Enter</span></button>
          </div>
          ${q.mode === 'choice' || a.result !== 'ok' ? answerHtml(card, 'sm') : ''}
          ${notesHtml(card)}
          ${card.photo ? photoInfoHtml(card.topic, card.src, card.countries[0]) : ''}
        </div>` : ''}
    </div>
  `;

  attachZoom($('.quiz-card .front-img'));
  $('#q-quit').addEventListener('click', () => {
    clearInterval(quizTimer);
    q.phase = q.answers.length ? 'result' : 'setup';
    renderQuiz();
  });
  if (a) {
    $('#q-next').addEventListener('click', nextQuestion);
    $('#q-view').addEventListener('click', (e) => openCardModal(card, $('.quiz-card') || e.currentTarget));
    $('#q-next').focus({ preventScroll: true });
    return;
  }
  if (q.mode === 'choice') {
    $$('.choice').forEach((b) => b.addEventListener('click', () => submitAnswer(card, [b.dataset.code])));
    return;
  }

  // ---- 入力式
  const input = $('#q-input');
  const redrawGhost = attachInlineComplete(input, { regions: false, ja: true });
  const drawChips = () => {
    $('#q-chips').innerHTML = q.draft.map((c) => `<span class="chip chip-removable">${flagImg(c)}${esc(countryName(c))}<button type="button" data-rm="${c}" aria-label="外す">✕</button></span>`).join('');
    $$('#q-chips [data-rm]').forEach((b) => b.addEventListener('click', () => {
      q.draft = q.draft.filter((x) => x !== b.dataset.rm);
      drawChips();
      input.focus();
    }));
  };
  const addText = () => {
    const text = input.value.trim();
    if (!text) return true;
    const c = findCountry(text);
    if (!c) { toast('候補にある国名を入力してください', 'error'); return false; }
    if (!q.draft.includes(c.code)) q.draft.push(c.code);
    input.value = '';
    drawChips();
    redrawGhost();
    return true;
  };
  const submit = () => {
    if (!addText()) return;
    if (!q.draft.length) { toast('国名を入力してください', 'error'); return; }
    submitAnswer(card, q.draft);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      if (!multi) { submit(); return; }
      if (input.value.trim()) addText();
      else if (q.draft.length) submit();
    } else if (e.key === 'Backspace' && !input.value && q.draft.length) {
      q.draft.pop();
      drawChips();
    }
  });
  // 候補リストから選んだら、複数回答ではそのまま追加
  input.addEventListener('input', (e) => {
    if (multi && (e.inputType === 'insertReplacementText' || !e.inputType) && findCountry(input.value)) addText();
  });
  $('#q-box').addEventListener('click', () => input.focus());
  $('#q-submit').addEventListener('click', submit);
  drawChips();
  input.focus({ preventScroll: true });
}

/* ---- OpenGuessr / GeoGuessr 用に、参考写真の撮影地点をマップとして書き出す ----
   GeoGuessr 形式（customCoordinates）の JSON。OpenGuessr の「マップ作成」で読み込むと、その地点から遊べる */
// 書き出し先（どちらも GeoGuessr 形式の JSON を読み込んでマップを作れる）
const PLAY_SITES = {
  worldguessr: { name: 'WorldGuessr', url: 'https://www.worldguessr.com/maps', how: 'WorldGuessr の Community Maps →「Make Map」でこのファイルを読み込んで公開してください（公開まで最大 1 時間ほど）' },
  openguessr: { name: 'OpenGuessr', url: 'https://www.openguessr.com/maps/create', how: 'OpenGuessr の「マップ作成」でこのファイルを読み込んでください' },
};
const playSite = () => PLAY_SITES[settings.playSite] || PLAY_SITES.worldguessr;
// 参考写真の全地点が入った OpenGuessr のマップ（作成済み）
const OPENGUESSR_ALL_MAP = "https://www.openguessr.com/maps/community/geohints'_spots";
const allSpotsLink = () => `<a class="btn btn-sm og-all" href="${OPENGUESSR_ALL_MAP}" target="_blank" rel="noopener" title="GeoHints の参考写真の撮影地点がすべて入った OpenGuessr のマップ">🎮 全スポットのマップを OpenGuessr で遊ぶ ↗</a>`;
function exportOpenGuessr(cards, name) {
  const locs = cards.filter((c) => c?.lat != null).map((c) => {
    const info = refInfo(c.topic, c.src.slice(REF_BASE.length)) || {};
    return {
      lat: c.lat, lng: c.lng, heading: info.heading || 0, pitch: info.pitch || 0, zoom: 0,
      panoId: info.pano && !info.pano.startsWith('AF1Q') ? info.pano : null,
      countryCode: c.countries[0].toLowerCase(), stateCode: null,
      extra: { tags: [modeDef(c.topic).name, countryName(c.countries[0])] },
    };
  });
  // 同じ地点（座標が同じ写真）は 1 つにまとめる（重複があると読み込めないサイトがある）
  const seen = new Set();
  const uniq = locs.filter((l) => { const k = `${l.lat.toFixed(5)},${l.lng.toFixed(5)}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const dup = locs.length - uniq.length;
  locs.length = 0;
  locs.push(...uniq);
  if (!locs.length) { toast('書き出せる地点がありません', 'error'); return; }
  const site = playSite();
  // OpenGuessr: { locations: [[緯度, 経度, { heading, pitch, panoramaId }]] }
  // WorldGuessr など: GeoGuessr 形式 { name, customCoordinates: [{ lat, lng, heading, pitch, panoId, ... }] }
  const data = site === PLAY_SITES.openguessr
    ? { locations: locs.map((l) => [l.lat, l.lng, { heading: l.heading, pitch: l.pitch, ...(l.panoId ? { panoramaId: l.panoId } : {}) }]) }
    : { name, customCoordinates: locs };
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name.replace(/[\\/:*?"<>|\s]+/g, '_')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`${locs.length} 地点を書き出しました${dup ? `（同じ地点 ${dup} 件はまとめました）` : ''}。${site.how}`);
  window.open(site.url, '_blank', 'noopener');
}

// 撮影地点を当てる（参考写真）: 地図のどこでもクリック。距離で採点（GeoGuessr のように最大 5000 点）
function renderPinQuestion(card) {
  const q = state.quiz;
  const a = q.answered;
  const total = q.answers.reduce((n, x) => n + (x.points || 0), 0);
  $('#view').innerHTML = `
    <div class="toolbar">
      ${quizCounterHtml(q)}
      <span class="muted">合計 ${total.toLocaleString()} 点</span>
      <button class="btn btn-ghost btn-sm" id="q-quit">やめる</button>
    </div>
    <div class="progress"><div class="progress-bar" style="width:${(q.i / q.questions.length) * 100}%"></div></div>
    <div class="qm-layout">
      <div class="quiz-card" style="${catStyle(card)}">${frontHtml(card)}</div>
      <div class="qm-side">
        <div class="quiz-map" id="quiz-map"><div class="map-loading">地図を読み込み中…</div></div>
        ${a ? `
          <div class="feedback fb-${a.result}">
            <div class="feedback-head">
              <div class="feedback-title">📍 約 ${Math.round(a.km).toLocaleString()} km ・ <b>${a.points.toLocaleString()}</b> 点</div>
              <button class="btn btn-primary" id="q-next">${q.i + 1 < q.questions.length ? '次へ' : '結果を見る'}<span class="kbd-inline">Enter</span></button>
            </div>
            ${answerHtml(card, 'sm')}
            ${photoInfoHtml(card.topic, card.src, card.countries[0])}
          </div>` : '<p class="quiz-prompt">この写真の撮影地点を、地図でクリック（近いほど高得点）</p>'}
      </div>
    </div>`;
  attachZoom($('.quiz-card .front-img'));
  $('#q-quit').addEventListener('click', () => { clearInterval(quizTimer); q.phase = q.answers.length ? 'result' : 'setup'; renderQuiz(); });
  const at = q.i;
  mountPinMap($('#quiz-map'), {
    answer: [card.lat, card.lng],
    guess: a?.guess,
    animate: settings.animations,
    qid: q.questions[q.i],
    onPick: (guess) => {
      if (q.answered || q.i !== at || state.view !== 'quiz') return;
      const km = distanceBetween(guess, [card.lat, card.lng]);
      const points = Math.round(5000 * Math.exp(-km / 1500));
      const result = km <= 150 ? 'ok' : km <= 750 ? 'partial' : 'ng';
      q.answered = { given: [], guess, km, points, result };
      q.answers.push({ cardId: card.id, given: [], result, km, points });
      record(card.id, result);
      logActivity(result === 'ok', COUNTRY_BY_CODE.get(card.countries[0])?.region);
      play(result === 'ok' ? 'correct' : result === 'partial' ? 'partial' : 'wrong');
      renderPinQuestion(card);
      afterAnswer(result);
    },
  }).then(() => $('#quiz-map .map-loading')?.remove()).catch((ex) => {
    const el = $('#quiz-map .map-loading');
    if (el) el.textContent = `地図を読み込めませんでした（${ex.message}）`;
  });
  if (a) {
    $('#q-next').addEventListener('click', nextQuestion);
    $('#q-next').focus({ preventScroll: true });
  }
}

// 地図で答えるクイズ: 左に問題の画像、右に地図（スマホでは上下）
function renderMapQuestion(card) {
  const q = state.quiz;
  const a = q.answered;
  const okN = q.answers.filter((x) => x.result === 'ok').length;
  const partN = q.answers.filter((x) => x.result === 'partial').length;
  const g = a?.given[0];
  const label = a ? { ok: '○ 正解！', partial: '△ 惜しい（隣の国）', ng: '✗ 不正解' }[a.result] : '';
  $('#view').innerHTML = `
    <div class="toolbar">
      ${quizCounterHtml(q)}
      <span class="muted">○ ${okN}${partN ? ` △ ${partN}` : ''}</span>
      <button class="btn btn-ghost btn-sm" id="q-quit">やめる</button>
    </div>
    <div class="progress"><div class="progress-bar" style="width:${(q.i / q.questions.length) * 100}%"></div></div>
    <div class="qm-layout">
      <div class="quiz-card" style="${catStyle(card)}">${frontHtml(card)}</div>
      <div class="qm-side">
        <div class="quiz-map" id="quiz-map"><div class="map-loading">地図を読み込み中…</div></div>
        ${a ? `
          <div class="feedback fb-${a.result}">
            <div class="feedback-head">
              <div class="feedback-title">${label}</div>
              <button class="btn btn-ghost btn-sm" id="q-view" type="button" title="カード詳細を開く">🔍<span class="tab-long"> カードを見る</span></button>
              <button class="btn btn-primary" id="q-next">${q.i + 1 < q.questions.length ? '次へ' : '結果を見る'}<span class="kbd-inline">Enter</span></button>
            </div>
            ${a.result !== 'ok' ? `<p class="qm-dist">あなたの回答: ${flagImg(g)}<b>${esc(countryName(g))}</b>${a.km != null ? ` ・ 正解まで約 <b>${Math.round(a.km).toLocaleString()} km</b>` : ''}</p>` : ''}
            ${answerHtml(card, 'sm')}
            ${notesHtml(card)}
            ${card.photo ? photoInfoHtml(card.topic, card.src, card.countries[0]) : ''}
          </div>` : '<p class="quiz-prompt">この特徴が見られる国を、地図でクリック</p>'}
      </div>
    </div>`;
  attachZoom($('.quiz-card .front-img'));
  $('#q-quit').addEventListener('click', () => { clearInterval(quizTimer); q.phase = q.answers.length ? 'result' : 'setup'; renderQuiz(); });
  const at = q.i;
  mountQuizMap($('#quiz-map'), {
    answers: card.countries,
    answered: a,
    animate: settings.animations,
    qid: q.questions[q.i],
    onPick: (code) => { if (!q.answered && q.i === at && state.view === 'quiz') submitAnswer(card, [code]); },
  }).then(() => $('#quiz-map .map-loading')?.remove()).catch((ex) => {
    const el = $('#quiz-map .map-loading');
    if (el) el.textContent = `地図を読み込めませんでした（${ex.message}）`;
  });
  if (a) {
    $('#q-next').addEventListener('click', nextQuestion);
    $('#q-view').addEventListener('click', (e) => openCardModal(card, $('.quiz-card') || e.currentTarget));
    $('#q-next').focus({ preventScroll: true });
  }
}

function submitAnswer(card, given) {
  const q = state.quiz;
  // 4択は正解を1つ選べば正解。入力式は全部そろって正解、一部なら部分正解
  // 地図で答える: 正解の国をクリックで正解、隣の国なら惜しい（△）。外れたら正解までの距離を出す
  let result;
  let km = null;
  if (q.mode === 'map') {
    const g = given[0];
    result = card.countries.includes(g) ? 'ok' : card.countries.some((c) => COUNTRY_INFO[c]?.nb.includes(g)) ? 'partial' : 'ng';
    if (result !== 'ok') km = nearestKm(g, card.countries);
  } else result = q.mode === 'choice' ? (card.countries.includes(given[0]) ? 'ok' : 'ng') : grade(card, given);
  record(card.id, result); // 覚え具合（暗記カードの復習にも反映）
  // よく間違える組み合わせ（正解の国と答えた国）
  if (result !== 'ok') for (const g of given) if (!card.countries.includes(g)) logConfusion(card.countries[0], g);
  logActivity(result === 'ok', COUNTRY_BY_CODE.get(card.countries[0])?.region);
  q.answered = { given: [...given], result, km };
  q.answers.push({ cardId: card.id, given: [...given], result, correct: result === 'ok' });
  play(result === 'ok' ? 'correct' : result === 'partial' ? 'partial' : 'wrong');
  q.draft = [];
  renderQuestion();
  afterAnswer(result);
  const fb = $('.feedback');
  if (fb && q.mode !== 'map') fb.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function nextQuestion() {
  const q = state.quiz;
  q.answered = null;
  q.draft = [];
  q.i++;
  if (q.i >= q.questions.length || (q.deadline && Date.now() >= q.deadline)) { q.phase = 'result'; clearInterval(quizTimer); }
  play(q.phase === 'result' ? 'finish' : 'slide');
  renderQuiz();
  window.scrollTo({ top: 0 });
}

function renderQuizResult() {
  const q = state.quiz;
  const total = q.answers.length;
  const ok = q.answers.filter((a) => a.result === 'ok').length;
  const part = q.answers.filter((a) => a.result === 'partial').length;
  const wrong = q.answers.filter((a) => a.result !== 'ok');
  const pct = total ? Math.round(((ok + part * 0.5) / total) * 100) : 0;
  const points = q.answers.reduce((n, a) => n + (a.points || 0), 0);
  const isPin = q.answers.some((a) => a.points != null);
  // タイムアタックの自己ベスト（表示名ごと・設定ごと）
  let bestHtml = '';
  if (q.timeLimit && q.deadline) {
    const who = (() => { try { return localStorage.getItem('geo-cards-chat-name') || 'あなた'; } catch { return 'あなた'; } })();
    const what = q.kind === 'fact' ? `${q.factTopic}-${q.factDir}` : q.kind === 'photo' ? `${[...q.photoTopics].sort().join('+')}-${q.mode}` : q.mode;
    const score = isPin ? points : ok;
    const key = `${q.kind}:${what}:${q.timeLimit}:${who}`;
    if (!q.bestSaved) { q.prevBest = saveBest(key, score); q.bestSaved = true; }
    const prev = q.prevBest;
    bestHtml = `<div class="ta-best">${prev === null || score > prev ? `🏆 自己ベスト更新！（${esc(who)}）` : `自己ベスト: ${prev.toLocaleString()}${isPin ? ' 点' : ' 問'}（${esc(who)}）`}</div>`;
  }
  $('#view').innerHTML = `
    <section class="panel result">
      ${q.timeLimit && q.deadline ? `<div class="score-pct">⏱ ${q.timeLimit} 秒のタイムアタック</div>` : ''}
      <div class="score">${isPin ? `${points.toLocaleString()}<span> 点</span>` : `${ok}<span> / ${total}</span>`}</div>
      <div class="score-pct">${isPin ? `${total} 問・平均 約 ${Math.round(q.answers.reduce((n, a) => n + (a.km || 0), 0) / Math.max(1, total)).toLocaleString()} km` : `${part ? `△ 部分正解 ${part} ・ ` : ''}正答率 ${pct}%${part ? '（△は0.5問として計算）' : ''}`}</div>
      ${bestHtml}
      <div class="result-actions">
        ${wrong.length ? '<button class="btn btn-primary" id="q-retry">間違えた問題だけ再挑戦</button>' : ''}
        <button class="btn" id="q-again">同じ設定でもう一度</button>
        <button class="btn btn-ghost" id="q-setup">設定に戻る</button>
      </div>
    </section>
    ${wrong.length && q.kind === 'fact' ? `
      <h3 class="section-title">間違えた国（${wrong.length}）</h3>
      <div class="fact-wrong">${wrong.map((w) => w.reverse ? `
        <div class="fw-row">
          <span class="fact-chip">${w.swatch}<span>${esc(w.label)}</span></span>
          <span class="fw-given">✗ あなたの回答: ${esc(w.givenLabel || '')}</span>
          <span class="muted small">当てはまる国は ${w.n} か国（例: <button type="button" class="link-btn fw-country" data-info="${w.code}">${esc(countryName(w.code))}</button>）</span>
        </div>` : `
        <div class="fw-row">
          <button type="button" class="fw-country" data-info="${w.code}">${flagImg(w.code)}<b>${esc(countryName(w.code))}</b></button>
          <span class="fw-given">✗ ${w.reverse ? `答え: ${esc(w.givenLabel || '')}` : esc(w.givenLabel || '')}</span>
          <span class="fw-right">${factChipHtmlSafe(q.factTopic, w.code)}</span>
        </div>`).join('')}</div>` : ''}
    ${wrong.length && q.kind !== 'fact' ? `
      <h3 class="section-title">間違えた・部分正解のカード（${wrong.length}）</h3>
      <div class="tiles">${wrong.map((w) => {
        const c = cardById(w.cardId);
        return c ? tileHtml(c, `<p class="tile-given">${w.result === 'partial' ? '△' : '✗'} ${w.km != null ? `撮影地点から約 ${Math.round(w.km).toLocaleString()} km` : `あなたの回答: ${esc(w.given.map(countryName).join('・'))}`}</p>`) : '';
      }).join('')}</div>` : ''}
  `;
  bindTiles();
  $$('.fw-country').forEach((b) => b.addEventListener('click', () => openCountryInfo(b.dataset.info, b)));
  const retry = $('#q-retry');
  if (q.kind === 'fact') {
    if (retry) retry.addEventListener('click', () => startFactQuiz(wrong.map((w) => w.code)));
    $('#q-again').addEventListener('click', () => startFactQuiz(factQuizPool(q.factTopic, q.regions)));
  } else {
    if (retry) retry.addEventListener('click', () => startQuiz(wrong.map((w) => cardById(w.cardId)).filter(Boolean)));
    $('#q-again').addEventListener('click', () => startQuiz(q.kind === 'photo' ? photoPool(q) : quizEligible(q.regions)));
  }
  $('#q-setup').addEventListener('click', () => { q.phase = 'setup'; renderQuiz(); setTimeout(flushLive, 0); });
}

/* ================= 検索 ================= */
// 検索: 国名・地域名に当てはまるカードを先に、続けて説明文・解説・詳細エリア・カテゴリー名に含むカード
// （文の検索はスペース区切りの語をすべて含むもの）
const cardText = (card) => `${card.description || ''}\n${card.notes || ''}\n${card.area || ''}\n${catOf(card).id === 'none' ? '' : catOf(card).name}`.toLowerCase();
function matchCards(query) {
  const q = query.trim().toLowerCase();
  if (!q) return state.cards;
  const regionHits = new Set(REGIONS.filter((r) => regionMatches(r, q)).map((r) => r.id));
  const countryHits = searchCountries(q);
  for (const c of COUNTRIES) if (regionHits.has(c.region)) countryHits.add(c.code);
  const byCountry = state.cards.filter((card) => card.countries.some((c) => countryHits.has(c)));
  const seen = new Set(byCountry.map((c) => c.id));
  const terms = q.split(/\s+/).filter(Boolean);
  const byText = state.cards.filter((card) => !seen.has(card.id) && terms.every((t) => cardText(card).includes(t)));
  return [...byCountry, ...byText];
}

// 編集画面・検索結果の並び順
const CARD_SORTS = [
  ['new', '新しい順'], ['old', '古い順'], ['edited', '最近編集した順'], ['cat', 'カテゴリー順'], ['country', '国名順'],
];
const timeOf = (t) => (t ? Date.parse(t) || 0 : 0);
function sortCards(list, by = settings.cardSort) {
  const out = [...list];
  const catIndex = new Map(allCats().map((c, i) => [c.id, i]));
  const byNew = (a, b) => timeOf(b.created_at) - timeOf(a.created_at);
  if (by === 'old') out.sort((a, b) => -byNew(a, b));
  else if (by === 'edited') out.sort((a, b) => timeOf(b.updated_at || b.created_at) - timeOf(a.updated_at || a.created_at));
  else if (by === 'cat') out.sort((a, b) => (catIndex.get(catKey(a)) ?? 999) - (catIndex.get(catKey(b)) ?? 999) || byNew(a, b));
  else if (by === 'country') out.sort((a, b) => countryName(a.countries[0]).localeCompare(countryName(b.countries[0]), 'ja') || byNew(a, b));
  else out.sort(byNew);
  return out;
}
const sortSelectHtml = (id) => `<select class="select select-sm sort-select" id="${id}" aria-label="並び順" title="並び順">${CARD_SORTS.map(([v, label]) => `<option value="${v}" ${settings.cardSort === v ? 'selected' : ''}>↕ ${label}</option>`).join('')}</select>`;

// 文に一致したカードのタイルに、一致した部分の前後を抜き出して表示
function textSnippet(card, query) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return '';
  for (const src of [card.description, card.notes, card.area]) {
    if (!src) continue;
    const lower = src.toLowerCase();
    const i = lower.indexOf(terms[0]);
    if (i < 0) continue;
    const start = Math.max(0, i - 18);
    const end = Math.min(src.length, i + terms[0].length + 30);
    let html = esc(src.slice(start, end).replace(/\s+/g, ' '));
    for (const t of terms) {
      const re = new RegExp(esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      html = html.replace(re, (m) => `<mark>${m}</mark>`);
    }
    return `<p class="tile-snippet">${start > 0 ? '…' : ''}${html}${end < src.length ? '…' : ''}</p>`;
  }
  return '';
}

// 検索は Spotlight 風のパネル（今の画面の手前に浮かぶ）
function openSpotlight() {
  if (!state.user) return;
  const sp = $('#spotlight');
  const s = state.search;
  if (!sp.open) play('open');
  sp.innerHTML = `
    <div class="spot-inner">
      <div class="spot-bar">
        <svg class="spot-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
        <div class="spot-field">
          <input type="search" id="search-input" class="spot-input" list="search-list" placeholder="国名・地域名・説明文で検索（例: ブラジル / 東南アジア / USA / ボラード 赤）" value="${esc(s.q)}" autocomplete="off" enterkeyhint="search">
        </div>
        <button class="icon-btn" type="button" id="spot-close" aria-label="閉じる">✕</button>
      </div>
      <div class="spot-filters">
        <div class="region-chips spot-regions">
          ${REGIONS.map((r) => `<button class="chip chip-btn ${s.q === r.name ? 'on' : ''}" data-q="${esc(r.name)}">${esc(r.name)}</button>`).join('')}
        </div>
        <div class="region-chips cat-chips spot-cats">
          ${allCats().map((c) => `<button class="chip chip-btn chip-cat ${s.cat === c.id ? 'on' : ''}" data-cat="${c.id}" style="${catVars(c)}"><span class="cat-dot"></span>${esc(c.name)}</button>`).join('')}
        </div>
      </div>
      <div class="spot-results" id="search-results"></div>
      <div class="spot-foot muted">↑↓←→ で選択・Enter で開く・Ctrl+Enter で Plonkit・Alt+Enter で国の詳細・Esc で閉じる</div>
    </div>`;
  const input = $('#search-input', sp);
  const syncChips = () => $$('.spot-regions [data-q]', sp).forEach((b) => b.classList.toggle('on', b.dataset.q === s.q));

  // PC は入力欄の中に候補を薄く表示して Tab で補完（スマホは候補リスト）
  const drawGhost = attachInlineComplete(input);
  input.addEventListener('input', () => { s.q = input.value; renderSearchResults(); syncChips(); });
  input.addEventListener('keydown', (e) => {
    // 地図と同じ: Ctrl+Enter で Plonkit、Alt+Enter で国の詳細（入力した国名から）
    if (e.key === 'Enter' && !e.isComposing && (e.ctrlKey || e.metaKey || e.altKey)) {
      e.preventDefault();
      e.stopPropagation();
      const code = resolveCountryCode(input.value);
      if (!code) { toast('国が見つかりません', 'error'); return; }
      if (e.altKey) { openCountryInfo(code, input); return; }
      const url = plonkitUrl(code);
      if (!url) { toast(`${countryName(code)} の Plonkit ガイドはありません`, 'error'); return; }
      setTimeout(() => { const w = window.open(url, '_blank'); if (w) { w.opener = null; w.focus(); } }, 0);
      return;
    }
    if (e.key === 'ArrowDown' || (e.key === 'Enter' && !e.isComposing)) {
      const first = $('.spot-results .tile', sp);
      if (first) { e.preventDefault(); first.focus(); }
    }
  });
  $$('.spot-regions [data-q]', sp).forEach((b) => b.addEventListener('click', () => {
    s.q = s.q === b.dataset.q ? '' : b.dataset.q;
    input.value = s.q;
    renderSearchResults();
    syncChips();
  }));
  $$('.spot-cats [data-cat]', sp).forEach((b) => b.addEventListener('click', () => {
    s.cat = s.cat === b.dataset.cat ? null : b.dataset.cat;
    $$('.spot-cats [data-cat]', sp).forEach((x) => x.classList.toggle('on', x.dataset.cat === s.cat));
    renderSearchResults();
  }));
  $('#spot-close', sp).addEventListener('click', closeSpotlight);
  $$('.spot-filters .region-chips', sp).forEach(makeHScroll);
  // 結果のタイルを矢印キーで移動（グリッドの列数は表示位置から判定）
  $('.spot-results', sp).addEventListener('keydown', (e) => {
    const tiles = $$('.spot-results .tile', sp);
    const i = tiles.indexOf(document.activeElement);
    if (i < 0) return;
    const cols = tiles.filter((t) => t.offsetTop === tiles[0].offsetTop).length || 1;
    const move = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
    if (move === undefined) return;
    e.preventDefault();
    const j = i + move;
    if (j < 0) input.focus();
    else if (tiles[j]) tiles[j].focus();
  });
  renderSearchResults();
  drawGhost();
  sp.classList.remove('closing');
  if (!sp.open) { sp.showModal(); spotOverModal = $('#modal').open; }
  raiseChat();
  input.focus();
  input.select();
}

// PC の入力欄に、最上位の候補を薄い文字で重ねて表示し Tab（または末尾で →）で補完する
// スマホでは何もしない（従来の候補リストがキーボードの上に出るため）。戻り値は再描画関数
function attachInlineComplete(input, opts = {}) {
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return () => {};
  input.removeAttribute('list');
  const field = document.createElement('span');
  field.className = 'ghost-field';
  const ghost = document.createElement('span');
  ghost.className = 'ghost';
  ghost.setAttribute('aria-hidden', 'true');
  input.replaceWith(field);
  field.append(ghost, input);
  let cand = null;
  let composing = false;
  const draw = () => {
    cand = !composing && !input.disabled ? topCandidate(input.value, opts) : null;
    if (!cand || input.scrollWidth > input.clientWidth + 1) { ghost.innerHTML = ''; return; }
    // 入力欄と同じ文字の大きさ・位置に合わせる
    const cs = getComputedStyle(input);
    ghost.style.font = cs.font;
    ghost.style.paddingLeft = `${parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth)}px`;
    const typed = input.value;
    ghost.innerHTML = cand.prefix
      ? `<span class="g-typed">${esc(typed)}</span><span class="g-rest">${esc(cand.value.slice(typed.length))}</span>${cand.hint ? `<span class="g-hint">${esc(cand.hint)}</span>` : ''}<kbd class="g-tab">Tab</kbd>`
      : `<span class="g-typed">${esc(typed)}</span><span class="g-hint">→ ${esc(cand.value)}</span><kbd class="g-tab">Tab</kbd>`;
  };
  input.addEventListener('compositionstart', () => { composing = true; draw(); });
  input.addEventListener('compositionend', () => { composing = false; draw(); });
  input.addEventListener('input', draw);
  input.addEventListener('blur', () => { ghost.innerHTML = ''; });
  input.addEventListener('focus', draw);
  input.addEventListener('keydown', (e) => {
    if (!cand || e.isComposing) return;
    if ((e.key === 'Tab' && !e.shiftKey) || (e.key === 'ArrowRight' && input.selectionStart === input.value.length)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      input.value = cand.value;
      input.dispatchEvent(new Event('input'));
    }
  });
  return draw;
}

// 入力から国を1つ決める: 完全一致 → 補完候補 → 部分一致の先頭
function resolveCountryCode(text) {
  if (!String(text || '').trim()) return null;
  const exact = findCountry(text);
  if (exact) return exact.code;
  const cand = topCandidate(text, { regions: false, ja: true });
  const fromCand = cand && findCountry(cand.value);
  if (fromCand) return fromCand.code;
  return [...searchCountries(text)][0] || null;
}

// 入力中の文字に対する最上位の候補（国名・地域名）。カードがある国を優先
// opts.regions: 地域名も候補にするか / opts.ja: 英語名で一致しても日本語の国名で補完する（クイズ用）
function topCandidate(text, opts = {}) {
  const { regions = true, ja = false } = opts;
  const t = text.trim();
  if (!t || t !== text) return null;
  const l = t.toLowerCase();
  // 略称・コードの完全一致（USA, UK, JP など）は日本語名へ
  const exact = findCountry(t);
  if (exact && exact.ja !== t) return { value: exact.ja, prefix: false };
  const has = new Set(state.cards.flatMap((c) => c.countries));
  const tk = hasKana(t) ? normKana(t) : '';
  const rk = romajiLoose(t); // ローマ字（nihon, doitsu, porando など）
  const list = [];
  // prefix: true は入力の続きを薄く表示、false は「→ 国名」で表示（ひらがな → カタカナ・漢字の変換など）
  for (const r of regions ? REGIONS : []) {
    if (r.name.startsWith(t)) list.push({ value: r.name, prefix: true, score: 1 });
    else if (tk && r.kana.some((k) => k.startsWith(tk))) list.push({ value: r.name, prefix: false, score: 1 });
    else if (rk && r.loose.some((k) => k.startsWith(rk))) list.push({ value: r.name, prefix: false, score: 1.5 });
  }
  for (const c of COUNTRIES) {
    const sc = has.has(c.code) ? 0 : 2;
    if (c.ja.startsWith(t)) list.push({ value: c.ja, prefix: true, score: sc });
    else if (tk && c.kana.some((k) => k.startsWith(tk))) list.push({ value: c.ja, prefix: false, score: sc });
    else if (c.en.toLowerCase().startsWith(l)) list.push(ja ? { value: c.ja, prefix: false, score: sc + 0.5 } : { value: t + c.en.slice(t.length), hint: ` ${c.ja}`, prefix: true, score: sc + 0.5 });
    else if (rk && c.loose.some((k) => k.startsWith(rk))) list.push({ value: c.ja, prefix: false, score: sc + 0.6 });
  }
  list.sort((a, b) => a.score - b.score || a.value.length - b.value.length);
  return list.find((x) => x.value !== t) || null;
}

// 横一列のチップをマウスでも横スクロールできるように（ホイール・ドラッグ・左右の矢印ボタン）
function makeHScroll(row) {
  const wrap = document.createElement('div');
  wrap.className = 'hscroll';
  row.replaceWith(wrap);
  wrap.innerHTML = '<button type="button" class="hs-btn hs-left" aria-label="左へ" tabindex="-1">‹</button><button type="button" class="hs-btn hs-right" aria-label="右へ" tabindex="-1">›</button>';
  wrap.insertBefore(row, wrap.lastChild);
  const update = () => {
    const max = row.scrollWidth - row.clientWidth;
    wrap.classList.toggle('can-left', row.scrollLeft > 2);
    wrap.classList.toggle('can-right', row.scrollLeft < max - 2);
  };
  const by = (dx) => row.scrollBy({ left: dx, behavior: settings.animations ? 'smooth' : 'auto' });
  $('.hs-left', wrap).addEventListener('click', () => by(-row.clientWidth * 0.7));
  $('.hs-right', wrap).addEventListener('click', () => by(row.clientWidth * 0.7));
  row.addEventListener('scroll', update, { passive: true });
  // 縦ホイールを横スクロールに変換
  row.addEventListener('wheel', (e) => {
    if (row.scrollWidth <= row.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault();
    row.scrollLeft += e.deltaY;
  }, { passive: false });
  // マウスでドラッグしてスクロール（少しでも動かしたらクリック扱いにしない）
  let drag = null;
  row.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    drag = { x: e.clientX, left: row.scrollLeft, moved: false };
  });
  row.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 5) return;
    if (!drag.moved) { drag.moved = true; row.setPointerCapture(e.pointerId); row.classList.add('is-dragging'); }
    row.scrollLeft = drag.left - dx;
  });
  const end = () => {
    if (drag?.moved) {
      row.classList.remove('is-dragging');
      // ドラッグ直後のクリックを無効に
      row.addEventListener('click', (ev) => { ev.stopPropagation(); ev.preventDefault(); }, { capture: true, once: true });
    }
    drag = null;
  };
  row.addEventListener('pointerup', end);
  row.addEventListener('pointercancel', end);
  if ('ResizeObserver' in window) new ResizeObserver(update).observe(row);
  requestAnimationFrame(update);
}

// 検索パネルを、開いているカード・国の詳細（#modal）の手前に開いたか
let spotOverModal = false;
const spotOnTop = () => $('#spotlight').open && (spotOverModal || !$('#modal').open);

function closeSpotlight() {
  const sp = $('#spotlight');
  if (!sp.open || sp.classList.contains('closing')) return;
  if (!settings.animations) { sp.close(); return; }
  sp.classList.add('closing'); // 縮みながら消えるアニメーションの後に閉じる
  setTimeout(() => { sp.classList.remove('closing'); sp.close(); }, 150);
}

function renderSearchResults() {
  const { q, cat } = state.search;
  const list = sortCards(matchCards(q).filter((c) => !cat || catKey(c) === cat));
  const catName = cat ? allCats().find((c) => c.id === cat)?.name : '';
  const cond = [q.trim() && `「${esc(q.trim())}」`, catName && `カテゴリー: ${esc(catName)}`].filter(Boolean).join(' / ');
  const label = cond ? `${cond} の検索結果: ${list.length} 枚` : `すべてのカード: ${list.length} 枚`;
  if (!$('#search-results')) return;
  $('#search-results').innerHTML = `
    <div class="result-head"><p class="muted result-count">${label}</p>${sortSelectHtml('search-sort')}</div>
    ${list.length ? `<div class="tiles">${list.map((c) => tileHtml(c, textSnippet(c, q))).join('')}</div>` : '<p class="empty">該当するカードがありません</p>'}`;
  $('#search-sort').addEventListener('change', (e) => { settings.cardSort = e.target.value; saveSettings(); renderSearchResults(); });
  bindTiles();
}

function bindTiles() {
  $$('.tile[data-id]').forEach((t) => {
    if (t.dataset.bound) return;
    t.dataset.bound = '1';
    // 同じ並び（検索結果・一覧など）のカードを ← → で順に見られるように
    const open = () => { const c = cardById(t.dataset.id); if (c) openCardModal(c, t, $$('.tile[data-id]', t.parentElement).map((x) => x.dataset.id)); };
    t.addEventListener('click', (e) => { if (!e.target.closest('button')) open(); });
    t.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === t) open(); });
  });
}

/* ================= 編集（一覧） ================= */
function renderManage() {
  setFit(false);
  const m = state.manage;
  const ed = state.user.isEditor; // 編集権限がなくても一覧は見られる（追加・編集・削除・選択などは編集者だけ）
  $('#view').innerHTML = `
    <div class="manage-head">
    <div class="toolbar">
      ${ed ? '<button class="btn btn-primary" id="m-new">＋ 新しいカード</button>' : ''}
      <input type="search" id="m-filter" class="input grow" placeholder="絞り込み（国名・地域名・説明）" value="${esc(m.q)}">
      ${regionPickHtml('m-region', m.regionsOff)}
      ${catPickHtml('m-cat', m.catsOff)}
      ${sortSelectHtml('m-sort')}
      <span class="counter" id="m-count"></span>
    </div>
    ${ed ? `<div class="toolbar toolbar-sub">
      <button class="btn btn-ghost btn-sm" id="m-cats">🏷 カテゴリー管理</button>
      <button class="btn btn-ghost btn-sm" id="m-bulk" title="複数の画像からまとめてカードを作る">📥 まとめて追加</button>
      ${api.mode === 'supabase' && state.cards.some((c) => !c.thumb_path) ? `<button class="btn btn-ghost btn-sm" id="m-thumbs" title="一覧・地図で読み込む画像を軽くします（まだ低画質版のないカード ${state.cards.filter((c) => !c.thumb_path).length} 枚）">🖼 軽量画像を作成 <b class="badge-n">${state.cards.filter((c) => !c.thumb_path).length}</b></button>` : ''}
      <button class="btn btn-ghost btn-sm" id="m-export">バックアップを書き出し</button>
      <label class="btn btn-ghost btn-sm">バックアップから読み込み<input type="file" id="m-import" accept="application/json,.json" hidden></label>
      <span class="grow"></span>
      <button class="btn btn-ghost btn-sm" id="m-sel-all" title="表示中のカードをすべて選択">☑ 全選択</button>
      <button class="btn btn-ghost btn-sm" id="m-sel-none" title="選択を解除（Esc）">☐ 選択解除</button>
    </div>` : ''}
    ${ed ? `<div class="sel-bar" id="sel-bar" hidden>
      <b id="sel-count"></b>
      <span class="muted small sel-tip tab-long">Shift+クリックで範囲選択・Ctrl+クリックで1枚ずつ</span>
      <span class="grow"></span>
      <select class="select select-sm" id="sel-cat" aria-label="選択したカードのカテゴリーを変更">
        <option value="">🏷 カテゴリーを変更…</option>
        ${allCats().map((k) => `<option value="${k.id}">${esc(k.name)}</option>`).join('')}
      </select>
      <button class="btn btn-sm btn-danger" id="sel-del">🗑 削除</button>
      <button class="icon-btn" id="sel-clear" aria-label="選択を解除" title="選択を解除（Esc）">✕</button>
    </div>` : ''}
    </div>
    <div id="manage-list"></div>`;
  $('#m-new')?.addEventListener('click', () => openEditor(null));
  $('#m-filter').addEventListener('input', (e) => { m.q = e.target.value; renderManageList(); });
  $('#m-sort').addEventListener('change', (e) => { settings.cardSort = e.target.value; saveSettings(); renderManageList(); });
  const repick = (id) => { m.openPick = id; renderManage(); };
  bindMultiPick('m-region', m.regionsOff, () => repick('m-region'), m.openPick === 'm-region');
  bindMultiPick('m-cat', m.catsOff, () => repick('m-cat'), m.openPick === 'm-cat');
  m.openPick = null;
  $('#m-export')?.addEventListener('click', exportBackup);
  $('#m-thumbs')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const todo = state.cards.filter((c) => !c.thumb_path).length;
      const n = await api.ensureThumbs(state.cards, (d, t) => { btn.textContent = `作成中… ${d} / ${t}`; });
      toast(`${n} / ${todo} 枚の低画質版を作りました`);
      await reloadCards();
      render();
    } catch (ex) {
      toast(`作成に失敗しました: ${ex.message}`, 'error');
      btn.disabled = false;
    }
  });
  $('#m-bulk')?.addEventListener('click', openBulkAdd);
  $('#m-cats')?.addEventListener('click', openCategoryManager);
  $('#m-import')?.addEventListener('change', (e) => { if (e.target.files[0]) importBackup(e.target.files[0]); e.target.value = ''; });
  $('#m-sel-all')?.addEventListener('click', () => { for (const c of manageFiltered()) m.sel.add(c.id); updateSelUI(); });
  $('#m-sel-none')?.addEventListener('click', clearSel);
  $('#sel-clear')?.addEventListener('click', clearSel);
  $('#sel-del')?.addEventListener('click', confirmBulkDelete);
  $('#sel-cat')?.addEventListener('change', (e) => { const v = e.target.value; e.target.value = ''; if (v) bulkSetCategory(v); });
  // 選択: Shift+クリックで範囲・Ctrl(⌘)+クリックで1枚ずつ。選択中は普通のクリック / チェックでも切り替え
  const listEl = $('#manage-list');
  listEl.addEventListener('mousedown', (e) => { if (ed && e.shiftKey && e.target.closest('.tile')) e.preventDefault(); }); // 文字が選択されないように
  listEl.addEventListener('click', (e) => {
    if (!ed) return; // 閲覧だけのときは選択しない（普通にカード詳細を開く）
    const tile = e.target.closest('.tile[data-id]');
    if (!tile) return;
    const check = e.target.closest('.tile-check');
    const selecting = check || e.shiftKey || e.ctrlKey || e.metaKey || m.sel.size > 0;
    if (!selecting || (!check && e.target.closest('button'))) return;
    e.preventDefault();
    e.stopPropagation(); // カード詳細は開かない
    const id = tile.dataset.id;
    if (e.shiftKey && m.anchor && m.anchor !== id) {
      const ids = $$('.tile[data-id]', listEl).map((t) => t.dataset.id);
      const [a, b] = [ids.indexOf(m.anchor), ids.indexOf(id)].sort((x, y) => x - y);
      if (a >= 0) { for (const x of ids.slice(a, b + 1)) m.sel.add(x); updateSelUI(); m.anchor = id; return; }
    }
    if (m.sel.has(id)) m.sel.delete(id); else m.sel.add(id);
    m.anchor = id;
    updateSelUI();
  }, true);
  renderManageList();
}

function clearSel() {
  state.manage.sel.clear();
  state.manage.anchor = null;
  updateSelUI();
}
// 選択の見た目（タイルの枠・チェック、上の操作バー）を描き直さずに更新
function updateSelUI() {
  const m = state.manage;
  for (const id of [...m.sel]) if (!cardById(id)) m.sel.delete(id); // 削除済みは外す
  $$('#manage-list .tile[data-id]').forEach((t) => {
    const on = m.sel.has(t.dataset.id);
    t.classList.toggle('is-selected', on);
    const cb = $('.tile-check input', t);
    if (cb) cb.checked = on;
  });
  const bar = $('#sel-bar');
  if (!bar) return;
  bar.hidden = !m.sel.size;
  $('#manage-list').classList.toggle('is-selecting', m.sel.size > 0);
  $('#sel-count').textContent = `${m.sel.size} 枚を選択中`;
  const sn = $('#m-sel-none');
  if (sn) sn.disabled = !m.sel.size;
}

function confirmBulkDelete() {
  const ids = [...state.manage.sel].filter((id) => cardById(id));
  if (!ids.length) return;
  openModal(`
    <div class="modal-head"><h2>カードをまとめて削除</h2><button class="icon-btn" data-close aria-label="閉じる">✕</button></div>
    <p>選択した <b>${ids.length} 枚</b>のカードを削除します。元に戻せません。</p>
    <div class="modal-foot">
      <button class="btn btn-ghost" data-close>キャンセル</button>
      <button class="btn btn-danger" id="del-ok">${ids.length} 枚を削除する</button>
    </div>`, 'modal-sm');
  $('#del-ok').addEventListener('click', async (e) => {
    e.target.disabled = true;
    closeModal();
    await bulkRun(ids, (card) => api.deleteCard(card), '削除');
  });
}

async function bulkSetCategory(catId) {
  const ids = [...state.manage.sel].filter((id) => cardById(id));
  const cat = allCats().find((k) => k.id === catId);
  if (!ids.length || !cat || !confirm(`選択した ${ids.length} 枚のカテゴリーを「${cat.name}」にします。よろしいですか？`)) return;
  const value = cat === UNCAT ? null : cat.id;
  await bulkRun(ids, (card) => api.updateCard(card, { ...card, category_id: value }), 'カテゴリーを変更');
}

// 選択したカードに同じ操作を順に行い、進み具合を表示
async function bulkRun(ids, fn, label) {
  let ok = 0;
  let fail = 0;
  for (const id of ids) {
    const card = cardById(id);
    if (!card) continue;
    try { await fn(card); ok++; } catch (ex) { fail++; console.warn(`${label}できませんでした`, id, ex); }
    toast(`${label}中… ${ok + fail} / ${ids.length}`);
  }
  state.manage.sel.clear();
  state.manage.anchor = null;
  await reloadCards();
  render();
  if (fail) toast(`${ok} 枚を${label}しました（${fail} 枚は失敗）`, 'error');
  else toast(`${ok} 枚を${label}しました`);
}

// 編集画面の一覧: 文字の絞り込み＋地域・カテゴリー
function manageFiltered() {
  const m = state.manage;
  return sortCards(matchCards(m.q.trim().toLowerCase()).filter((c) => pickMatch(c, m.regionsOff, m.catsOff)));
}
function renderManageList() {
  const m = state.manage;
  const list = manageFiltered();
  const filtered = m.q.trim() || m.regionsOff.size || m.catsOff.size;
  $('#m-count').textContent = filtered ? `${list.length} / ${state.cards.length} 枚` : `${state.cards.length} 枚`;
  const ed = state.user.isEditor;
  $('#manage-list').innerHTML = list.length
    ? `<div class="tiles">${list.map((c) => tileHtml(c, !ed ? '' : `
        <label class="tile-check" title="選択（Shift / Ctrl+クリックでも）"><input type="checkbox" aria-label="このカードを選択"></label>
        <div class="tile-actions">
          <button class="btn btn-sm" data-edit="${c.id}">編集</button>
          <button class="btn btn-sm btn-danger-ghost" data-del="${c.id}">削除</button>
        </div>`)).join('')}</div>`
    : `<div class="empty"><p>${state.cards.length ? '該当するカードがありません' : ed ? 'まだカードがありません。「＋ 新しいカード」から追加しましょう' : 'まだカードがありません'}</p></div>`;
  bindTiles();
  $$('[data-edit]').forEach((b) => b.addEventListener('click', () => openEditor(cardById(b.dataset.edit))));
  $$('[data-del]').forEach((b) => b.addEventListener('click', () => confirmDelete(cardById(b.dataset.del))));
  updateSelUI();
}

function confirmDelete(card) {
  if (!card) return;
  openModal(`
    <div class="modal-head"><h2>カードを削除</h2><button class="icon-btn" data-close aria-label="閉じる">✕</button></div>
    <p>このカード（${esc(card.countries.map(countryName).join('・'))}）を削除します。元に戻せません。</p>
    <div class="modal-foot">
      <button class="btn btn-ghost" data-close>キャンセル</button>
      <button class="btn btn-danger" id="del-ok">削除する</button>
    </div>`, 'modal-sm');
  $('#del-ok').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await api.deleteCard(card);
      closeModal();
      toast('削除しました');
      await reloadCards();
      render();
    } catch (ex) {
      toast(`削除に失敗しました: ${ex.message}`, 'error');
      e.target.disabled = false;
    }
  });
}

/* ================= 編集（カードエディタ） ================= */
// preset: 新しいカードの初期値 { countries: [...], categoryId }（比較タブの「＋ カードを作成」から）
function openEditor(card, preset = {}) {
  const ed = {
    blob: null,
    preview: card ? imgUrl(card) : '',
    countries: new Set(card ? card.countries : preset.countries || []),
    back: null, // 裏面だけの書き込み: null（変更なし）/ Blob（新しく保存）/ 'clear'（消す）
    backPreview: card ? backUrl(card) : '',
    related: new Set((card?.related || []).filter((id) => state.cards.some((c) => c.id === id))),
  };

  openModal(`
    <div class="modal-head">
      <h2>${card ? 'カードを編集' : '新しいカード'}</h2>
      <button class="icon-btn" data-close aria-label="閉じる">✕</button>
    </div>
    <div class="editor">
      <section class="editor-side">
        <h3 class="side-title">表面</h3>
        <div class="dropzone" id="ed-drop" tabindex="0">
          <div class="ed-img-wrap" id="ed-img-wrap" ${ed.preview ? '' : 'hidden'}>
            <img id="ed-img" alt="" ${ed.preview ? `src="${esc(ed.preview)}"` : ''}>
            <img id="ed-back" class="ed-back" alt="" ${ed.backPreview ? `src="${esc(ed.backPreview)}"` : 'hidden'}>
          </div>
          <span class="ed-back-tag" id="ed-back-tag" ${ed.backPreview ? '' : 'hidden'} title="カードを裏返したときだけ表示される書き込みがあります">🔁 裏面の印あり</span>
          <div class="dropzone-hint" id="ed-hint" ${ed.preview ? 'hidden' : ''}>
            <strong>画像をドロップ</strong><br>またはクリックしてファイルを選択<br><span class="muted">Ctrl+V（⌘+V）でも貼り付けできます</span>
          </div>
        </div>
        <div class="row">
          <button class="btn" id="ed-paste" type="button">📋 クリップボードから貼り付け</button>
          <button class="btn btn-ghost" id="ed-annot" type="button" title="トリミング・丸や矢印の書き込み（裏面だけに表示する印も）" ${ed.preview ? '' : 'disabled'}>🎨 画像編集</button>
          <label class="btn btn-ghost">ファイルを選択<input type="file" id="ed-file" accept="image/*" hidden></label>
        </div>
        <div class="field">
          <span>カテゴリー</span>
          <div class="cat-picker">
            ${allCats().map((c) => `
              <label class="cat-opt" style="${catVars(c)}">
                <input type="radio" name="ed-cat" value="${c.id}" ${(card ? catKey(card) : preset.categoryId || 'none') === c.id ? 'checked' : ''}>
                <span class="cat-dot"></span>${esc(c.name)}
              </label>`).join('')}
          </div>
        </div>
        <label class="field">
          <span>説明（表面）</span>
          <textarea id="ed-desc" rows="3" placeholder="例: 黄色い背景の道路標識。ボラードの上部が赤">${esc(card?.description)}</textarea>
        </label>
      </section>

      <section class="editor-side">
        <h3 class="side-title">裏面</h3>
        <div class="field">
          <span>国・地域（複数選択可）</span>
          <div class="selected-chips" id="ed-chips"></div>
        </div>
        <div class="picker">
          <input type="search" id="ed-filter" class="input" list="country-list" placeholder="国名で絞り込み（Tab で補完・Enter で追加）" autocomplete="off" enterkeyhint="done">
          <div class="picker-list" id="ed-picker">
            ${REGIONS.map((r) => `
              <details class="picker-region" data-region="${r.id}">
                <summary>
                  <span class="picker-region-name">${esc(r.name)}</span>
                  <span class="picker-sel-count" data-count="${r.id}"></span>
                  <button type="button" class="link-btn picker-all" data-all="${r.id}">全選択</button>
                </summary>
                <div class="picker-countries">
                  ${r.countries.map((c) => `
                    <label class="picker-country" data-search="${esc(searchText(c))}" data-loose="${esc(c.loose.join(' '))}">
                      <input type="checkbox" value="${c.code}" ${ed.countries.has(c.code) ? 'checked' : ''}>
                      ${flagImg(c.code)}<span>${esc(c.ja)}</span>
                    </label>`).join('')}
                </div>
              </details>`).join('')}
          </div>
        </div>
        <label class="field">
          <span>詳細エリア（任意）</span>
          <input type="text" id="ed-area" class="input" placeholder="例: 北部 / 東海岸 / ○○州" value="${esc(card?.area)}">
        </label>
        <label class="field">
          <span>解説</span>
          <textarea id="ed-notes" rows="4" placeholder="見分け方や注意点など">${esc(card?.notes)}</textarea>
        </label>
        <div class="field">
          <span>関連カード（暗記では裏面、そのほかはカードを開いたときに表示）</span>
          <div class="ed-related" id="ed-related"></div>
          <input type="search" id="ed-rel-q" class="input" placeholder="国名・地域名・説明でカードを検索して追加" autocomplete="off">
          <div class="ed-rel-results" id="ed-rel-results"></div>
        </div>
      </section>
    </div>
    <div class="modal-foot">
      ${card ? '<button class="btn btn-danger-ghost" id="ed-delete" type="button">削除</button>' : ''}
      ${card ? cardDatesHtml(card).replace('card-dates', 'card-dates ed-dates') : ''}
      <span class="grow"></span>
      <button class="btn btn-ghost" data-close type="button">キャンセル</button>
      <button class="btn btn-primary" id="ed-save" type="button">保存</button>
    </div>
  `, 'modal-wide');
  modalCurrent = { kind: 'editor' }; // 検索から詳細を開いても、戻ると編集を続けられるように

  const showBack = () => {
    const b = $('#ed-back');
    b.hidden = !ed.backPreview;
    if (ed.backPreview) b.src = ed.backPreview; else b.removeAttribute('src');
    $('#ed-back-tag').hidden = !ed.backPreview;
  };
  // fromEditor: 画像編集の結果（裏面の印もそれに合わせてある）。それ以外の新しい画像では裏面の印を外す
  const setImage = async (blob, fromEditor = false) => {
    if (!blob || !blob.type.startsWith('image/')) { toast('画像ファイルではありません', 'error'); return; }
    ed.blob = blob;
    ed.preview = await blobToDataUrl(blob);
    $('#ed-img').src = ed.preview;
    $('#ed-img-wrap').hidden = false;
    $('#ed-hint').hidden = true;
    $('#ed-annot').disabled = false;
    if (!fromEditor && ed.backPreview) {
      ed.back = card?.back_path ? 'clear' : null;
      ed.backPreview = '';
      showBack();
      toast('画像を差し替えたので、裏面の印は外しました');
    }
  };
  // 画像編集: トリミング・書き込み（表面に焼き込み / 裏面だけのレイヤー）
  $('#ed-annot').addEventListener('click', async (e) => {
    if (!ed.preview) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const out = await editImage(ed.preview, { backSrc: ed.backPreview, host: $('#modal') });
      if (!out) return;
      if (out.image) await setImage(out.image, true);
      if (out.back instanceof Blob) { ed.back = out.back; ed.backPreview = await blobToDataUrl(out.back); }
      else if (out.back === 'clear') { ed.back = card?.back_path ? 'clear' : null; ed.backPreview = ''; }
      showBack();
      if (out.image || out.back) toast('画像の編集を反映しました（保存すると確定します）');
    } catch (ex) {
      toast(`画像を編集できませんでした: ${ex.message}`, 'error');
    } finally {
      btn.disabled = false;
    }
  });
  // 参考写真などから作るときの初期値
  if (preset.blob) setImage(preset.blob);
  // クリップボードに画像（スクリーンショット）があれば自動で入れる（許可を求められることがあります。なければ何もしない）
  if (preset.autoPaste) readClipboardImage().then((b) => { if (b && !ed.blob) setImage(b); }).catch(() => {});
  if (preset.description) $('#ed-desc').value = preset.description;
  if (preset.notes) $('#ed-notes').value = preset.notes;
  if (preset.area) $('#ed-area').value = preset.area;

  // 画像の入力: ファイル選択・ドロップ・貼り付け
  const fileInput = $('#ed-file');
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) setImage(fileInput.files[0]); fileInput.value = ''; });
  const drop = $('#ed-drop');
  drop.addEventListener('click', () => fileInput.click());
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const f = e.dataTransfer.files[0];
    if (f) setImage(f);
  });
  $('#ed-paste').addEventListener('click', async () => {
    try {
      const blob = await readClipboardImage();
      if (blob) setImage(blob);
      else toast('クリップボードに画像がありません', 'error');
    } catch (ex) {
      toast(ex.name === 'NotAllowedError' ? 'クリップボードへのアクセスが許可されませんでした。Ctrl+V で貼り付けてください' : ex.message, 'error');
    }
  });
  modalPasteHandler = (e) => {
    const item = Array.from(e.clipboardData?.items || []).find((i) => i.type.startsWith('image/'));
    if (!item) return; // 文字の貼り付けはそのまま
    e.preventDefault();
    setImage(item.getAsFile());
  };

  // 国の選択
  const renderChips = () => {
    $('#ed-chips').innerHTML = ed.countries.size
      ? [...ed.countries].map((c) => `<span class="chip chip-removable">${flagImg(c)}${esc(countryName(c))}<button type="button" data-rm="${c}" aria-label="${esc(countryName(c))}を外す">✕</button></span>`).join('')
      : '<span class="muted">下のリストから選択してください</span>';
    $$('#ed-chips [data-rm]').forEach((b) => b.addEventListener('click', () => {
      ed.countries.delete(b.dataset.rm);
      const cb = $(`#ed-picker input[value="${b.dataset.rm}"]`);
      if (cb) cb.checked = false;
      renderChips();
    }));
    for (const r of REGIONS) {
      const n = r.countries.filter((c) => ed.countries.has(c.code)).length;
      const el = $(`[data-count="${r.id}"]`);
      if (el) el.textContent = n ? `${n} 件選択` : '';
      const all = $(`[data-all="${r.id}"]`);
      if (all) all.textContent = n === r.countries.length ? '全解除' : '全選択';
    }
  };
  $$('#ed-picker input[type=checkbox]').forEach((cb) => cb.addEventListener('change', () => {
    cb.checked ? ed.countries.add(cb.value) : ed.countries.delete(cb.value);
    renderChips();
  }));
  $$('#ed-picker [data-all]').forEach((b) => b.addEventListener('click', (e) => {
    e.preventDefault(); // summary の開閉を防ぐ
    const r = REGION_BY_ID.get(b.dataset.all);
    const allOn = r.countries.every((c) => ed.countries.has(c.code));
    for (const c of r.countries) allOn ? ed.countries.delete(c.code) : ed.countries.add(c.code);
    $$(`details[data-region="${r.id}"] input`).forEach((cb) => { cb.checked = ed.countries.has(cb.value); });
    renderChips();
  }));
  // 選択済みの国がある地域は最初から開いておく
  for (const r of REGIONS) {
    if (r.countries.some((c) => ed.countries.has(c.code))) $(`details[data-region="${r.id}"]`).open = true;
  }
  $('#ed-filter').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    const rq = q.length >= 3 ? romajiLoose(q) : null;
    $$('#ed-picker details').forEach((d) => {
      let any = false;
      $$('.picker-country', d).forEach((l) => {
        const hit = !q || l.dataset.search.includes(q) || (hasKana(q) && l.dataset.search.includes(normKana(q).toLowerCase()))
          || (rq && l.dataset.loose.includes(rq));
        l.hidden = !hit;
        if (hit) any = true;
      });
      d.hidden = !!q && !any;
      if (q) d.open = any;
    });
  });
  // 補完（Tab）と、Enter でその国を追加
  const edFilter = $('#ed-filter');
  attachInlineComplete(edFilter, { regions: false, ja: true });
  edFilter.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    const code = resolveCountryCode(edFilter.value)
      || $$('#ed-picker .picker-country:not([hidden]) input')[0]?.value;
    if (!code) { toast('国が見つかりません', 'error'); return; }
    ed.countries.add(code);
    const cb = $(`#ed-picker input[value="${code}"]`);
    if (cb) { cb.checked = true; cb.closest('details').open = true; }
    renderChips();
    edFilter.value = '';
    edFilter.dispatchEvent(new Event('input'));
  });
  renderChips();

  // 関連カード: 検索して追加（検索パネルと同じ一致のしかた）
  const renderRelated = () => {
    const list = [...ed.related].map((id) => state.cards.find((c) => c.id === id)).filter(Boolean);
    $('#ed-related').innerHTML = list.length
      ? list.map((c) => `<span class="chip chip-removable rel-chip" style="${catStyle(c)}">${thumbUrl(c) ? `<img class="rel-chip-img" src="${esc(thumbUrl(c))}" alt="">` : ''}${flagImg(c.countries[0])}${esc(countryName(c.countries[0]))}・${esc(catOf(c).name)}<button type="button" data-rel-rm="${c.id}" aria-label="関連カードから外す">✕</button></span>`).join('')
      : '<span class="muted small">まだありません</span>';
    $$('#ed-related [data-rel-rm]').forEach((b) => b.addEventListener('click', () => { ed.related.delete(b.dataset.relRm); renderRelated(); renderRelResults(); }));
  };
  const renderRelResults = () => {
    const q = $('#ed-rel-q').value.trim();
    const box = $('#ed-rel-results');
    if (!q) { box.innerHTML = ''; return; }
    const hits = sortCards(matchCards(q)).filter((c) => c.id !== card?.id && !ed.related.has(c.id));
    box.innerHTML = hits.length
      ? `${hits.slice(0, 12).map((c) => `<button type="button" class="rel-hit" data-rel-add="${c.id}" style="${catStyle(c)}" title="${esc(c.description || '')}">
          <span class="related-thumb">${thumbUrl(c) ? `<img src="${esc(thumbUrl(c))}" alt="" loading="lazy">` : ''}</span>
          <span class="related-text"><span class="related-country">${flagImg(c.countries[0])}${esc(countryName(c.countries[0]))}${c.countries.length > 1 ? ` +${c.countries.length - 1}` : ''}</span><span class="related-cat">${esc(catOf(c).name)}${c.description ? `・${esc(c.description)}` : ''}</span></span>
        </button>`).join('')}${hits.length > 12 ? `<p class="muted small">ほか ${hits.length - 12} 枚（言葉を足して絞り込めます）</p>` : ''}`
      : '<p class="muted small">該当するカードがありません</p>';
    $$('#ed-rel-results [data-rel-add]').forEach((b) => b.addEventListener('click', () => { ed.related.add(b.dataset.relAdd); renderRelated(); renderRelResults(); }));
  };
  $('#ed-rel-q').addEventListener('input', renderRelResults);
  $('#ed-rel-q').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    $('#ed-rel-results [data-rel-add]')?.click(); // Enter で先頭の候補を追加
  });
  renderRelated();

  // 保存・削除
  if (card) $('#ed-delete').addEventListener('click', () => confirmDelete(card));
  $('#ed-save').addEventListener('click', async (e) => {
    if (!card && !ed.blob) { toast('画像を追加してください', 'error'); return; }
    if (!ed.countries.size) { toast('国・地域を1つ以上選択してください', 'error'); return; }
    const fields = {
      description: $('#ed-desc').value.trim(),
      countries: [...ed.countries],
      area: $('#ed-area').value.trim(),
      notes: $('#ed-notes').value.trim(),
      category_id: (() => { const v = $('input[name=ed-cat]:checked')?.value; return v && v !== 'none' ? v : null; })(),
      related: [...ed.related],
    };
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = '保存中…';
    try {
      if (card) await api.updateCard(card, fields, ed.blob, ed.back);
      else await api.createCard(fields, ed.blob, ed.back instanceof Blob ? ed.back : null);
      closeModal();
      toast(card ? '更新しました' : '追加しました');
      await reloadCards();
      render();
    } catch (ex) {
      toast(`保存に失敗しました: ${ex.message}`, 'error');
      btn.disabled = false;
      btn.textContent = '保存';
    }
  });
}

/* ================= カテゴリー管理 ================= */
const PALETTE = ['#e03131', '#f76707', '#f59f00', '#74b816', '#2f9e44', '#0ca678', '#1098ad', '#1c7ed6', '#4263eb', '#7048e8', '#ae3ec9', '#d6336c', '#795548', '#868e96'];

function openCategoryManager() {
  const draw = () => {
    const cats = state.categories;
    openModal(`
      <div class="modal-head"><h2>カテゴリー管理</h2><button class="icon-btn" data-close aria-label="閉じる">✕</button></div>
      <p class="muted small">色の丸をクリックすると色を変更できます。カテゴリーを削除すると、そのカードは「未分類」になります。</p>
      <div class="cat-rows">
        ${cats.map((c, i) => `
          <div class="cat-row" data-id="${c.id}">
            <input type="color" class="cat-color" value="${esc(c.color)}" aria-label="色">
            <input type="text" class="input cat-name" value="${esc(c.name)}" maxlength="30" aria-label="名前">
            <span class="cat-count muted">${state.cards.filter((x) => x.category_id === c.id).length} 枚</span>
            <button class="icon-btn" data-up ${i === 0 ? 'disabled' : ''} aria-label="上へ">↑</button>
            <button class="icon-btn" data-down ${i === cats.length - 1 ? 'disabled' : ''} aria-label="下へ">↓</button>
            <button class="icon-btn icon-danger" data-del aria-label="削除">🗑</button>
          </div>`).join('') || '<p class="muted">カテゴリーがありません</p>'}
      </div>
      <form class="cat-add" id="cat-add">
        <input type="color" id="cat-new-color" class="cat-color" value="${PALETTE[cats.length % PALETTE.length]}" aria-label="色">
        <input type="text" id="cat-new-name" class="input" placeholder="新しいカテゴリー名（例: 消火栓）" maxlength="30" required>
        <button class="btn btn-primary" type="submit">追加</button>
      </form>
      <div class="modal-foot"><button class="btn" data-close>閉じる</button></div>`, 'modal-md');

    const run = async (fn, redraw = true) => {
      try {
        await fn();
        state.categories = await api.listCategories();
        if (redraw) draw();
      } catch (ex) {
        toast(`保存に失敗しました: ${ex.message}`, 'error');
      }
    };
    $$('.cat-row').forEach((row) => {
      const cat = cats.find((c) => c.id === row.dataset.id);
      $('.cat-color', row).addEventListener('change', (e) => run(() => api.saveCategory({ ...cat, color: e.target.value }), false));
      $('.cat-name', row).addEventListener('change', (e) => {
        const name = e.target.value.trim();
        if (!name) { e.target.value = cat.name; return; }
        run(() => api.saveCategory({ ...cat, name }), false);
      });
      const swap = (j) => run(async () => {
        const other = cats[j];
        const order = cats.map((c, k) => ({ ...c, sort: (k + 1) * 10 }));
        const a = order.find((c) => c.id === cat.id);
        const b = order.find((c) => c.id === other.id);
        [a.sort, b.sort] = [b.sort, a.sort];
        for (const c of order) await api.saveCategory(c);
      });
      const i = cats.indexOf(cat);
      $('[data-up]', row).addEventListener('click', () => swap(i - 1));
      $('[data-down]', row).addEventListener('click', () => swap(i + 1));
      $('[data-del]', row).addEventListener('click', () => {
        if (confirm(`「${cat.name}」を削除しますか？（カードは未分類になります）`)) run(() => api.deleteCategory(cat.id));
      });
    });
    $('#cat-add').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = $('#cat-new-name').value.trim();
      if (!name) return;
      const sort = (cats.reduce((m, c) => Math.max(m, c.sort || 0), 0)) + 10;
      run(() => api.saveCategory({ name, color: $('#cat-new-color').value, sort }));
    });
  };
  draw();
  // 閉じたら色・名前の変更を反映
  $('#modal').addEventListener('close', () => { reloadCards().then(render); }, { once: true });
}

/* ================= 国の基本情報 ================= */
let langListOpen = false; // 「使われている国」の一覧を開いているか（国を移っても開いたまま）
// その言語が使われている国・地域（独立国を先に、それぞれ日本語名順）
function langCountries(l) {
  return Object.keys(COUNTRY_INFO)
    .filter((k) => COUNTRY_BY_CODE.get(k) && COUNTRY_INFO[k].lang.includes(l))
    .sort((a, b) => (COUNTRY_INFO[b].un - COUNTRY_INFO[a].un) || countryName(a).localeCompare(countryName(b), 'ja'));
}
function openCountryInfo(code, src = null, lang = null) {
  if (!COUNTRY_BY_CODE.get(code) || !COUNTRY_INFO[code]) return;
  const fresh = !$('#modal').open;
  navModal({ kind: 'country', code, cat: null, lang });
  if (src && fresh) popFrom($('#modal'), src);
}

function renderCountryModal(entry) {
  const { code } = entry;
  const c = COUNTRY_BY_CODE.get(code);
  const info = COUNTRY_INFO[code];
  const region = REGION_BY_ID.get(c.region);
  const left = LEFT_DRIVING.has(code);
  const plonkit = plonkitUrl(code);
  const langs = info.lang.filter((l) => !/Sign Language/i.test(LANG_EN[l] || ''));
  const langName = (l) => LANGS[l]?.ja || LANG_EN[l] || l;
  const row = (label, value) => (value ? `<div class="info-row"><dt>${label}</dt><dd>${value}</dd></div>` : '');
  const cards = state.cards.filter((x) => x.countries.includes(code));
  const cats = allCats().filter((k) => cards.some((x) => catKey(x) === k.id));

  openModal(`
    <div class="modal-head">
      ${backBtnHtml()}
      <h2>国の基本情報</h2>
      <button class="icon-btn" data-close aria-label="閉じる">✕</button>
    </div>
    <div class="cinfo-hero">
      <img class="cinfo-flag" src="${flagUrl(code)}" alt="${esc(c.ja)}の国旗">
      <div>
        <div class="cinfo-name ${isPlayable(code) ? '' : 'is-no-play'}">${esc(c.ja)}</div>
        <div class="cinfo-sub">${esc(c.en)}${info.o && info.o !== c.ja ? ` ・ ${esc(info.o)}` : ''}</div>
        <div class="cinfo-tags">
          <span class="tag">${esc(region.name)}</span>
          ${isPlayable(code) ? '' : '<span class="tag no-play-tag" title="GeoGuessr の公式マップには出題されない国・地域です（Plonkit にガイドがない）">出題なし</span>'}
          ${info.un ? '' : '<span class="tag">海外領土・地域</span>'}
          ${info.ll ? '<span class="tag">内陸国</span>' : ''}
          ${plonkit ? `<a class="tag tag-link" href="${plonkit}" target="_blank" rel="noopener">Plonkit ↗</a>` : ''}
          <button type="button" class="tag tag-link tag-btn" id="cinfo-compare" title="ほかの国とカードをカテゴリーごとに並べて比べる">⚖ 比較</button>
        </div>
      </div>
    <section class="cinfo-memo cinfo-memo-side">
        <h3 class="memo-title">📝 メモ <span class="memo-status muted small" id="memo-status"></span></h3>
        ${state.user.isEditor
          ? `<textarea id="memo-input" class="memo-input" rows="4" placeholder="この国の覚えておきたいこと（見分け方・注意点など）。入力が止まると自動で保存されます">${esc(state.countryNotes.get(code) || '')}</textarea>`
          : `<div class="memo-view">${state.countryNotes.get(code) ? nl2br(state.countryNotes.get(code)) : '<span class="muted small">メモはまだありません</span>'}</div>`}
      </section>
    </div>
    <dl class="info-list">
      <div class="info-row info-row-wide">
        <dt>言語</dt>
        <dd>
          <div class="lang-btns">
            ${langs.map((l) => `<button type="button" class="lang-btn" data-lang="${l}" aria-expanded="false">${esc(langName(l))}</button>`).join('') || '—'}
          </div>
          <div class="lang-pop" id="lang-guide" role="dialog" hidden></div>
        </dd>
      </div>
      ${row('通行', `<span class="drive drive-${left ? 'left' : 'right'}">${left ? '⬅ 左側通行' : '右側通行 ➡'}</span>`)}
      ${row('国別ドメイン', info.tld.map((t) => `<code>${esc(t)}</code>`).join(' '))}
      ${row('国際電話番号', info.tel ? `<code>${esc(info.tel)}</code>` : '')}
      ${row('首都', esc(info.cap.join('、')))}
      ${row('通貨', info.cur.map(([k, n, sym]) => `${esc(k)}${sym ? ` <b>${esc(sym)}</b>` : ''} <span class="muted">(${esc(n)})</span>`).join('<br>'))}
      ${row('隣接国', info.nb.map((n) => `<button type="button" class="chip chip-btn nb-btn" data-info="${n}">${flagImg(n)}${esc(countryName(n))}</button>`).join(' '))}
    </dl>
    ${countryFactsHtml(code)}

    <section class="cinfo-cards">
      <h3 class="cinfo-cards-title">この国のカード <span class="muted">${cards.length} 枚</span></h3>
      ${cards.length ? `
        <div class="region-chips cat-chips">
          <button class="chip chip-btn ${entry.cat ? '' : 'on'}" data-ccat="">すべて</button>
          ${cats.map((k) => `<button class="chip chip-btn chip-cat ${entry.cat === k.id ? 'on' : ''}" data-ccat="${k.id}" style="${catVars(k)}"><span class="cat-dot"></span>${esc(k.name)}</button>`).join('')}
        </div>
        <div class="tiles tiles-compact" id="cinfo-tiles"></div>` : '<p class="muted small">まだカードがありません</p>'}
    </section>`, 'modal-md', true);

  $('#cinfo-compare').addEventListener('click', () => openCompare(code));
  // 地図のデータ: 写真を押すとカードと同じ画面で開く・開閉を覚える
  $$('#modal .cfacts-photo').forEach((b) => b.addEventListener('click', () => {
    const t = b.dataset.topic;
    openPhotoModal(t, code, (REF_IMAGES[t]?.[code] || []).map((r) => REF_BASE + r), Number(b.dataset.i), b);
  }));
  $$('#modal .cfacts-map').forEach((b) => b.addEventListener('click', () => {
    settings.mapMode = b.dataset.topic;
    saveSettings();
    focusOnNextRender(code);
    closeModal();
    if (state.view === 'map') render(); else location.hash = '#map';
  }));
  $('#modal .cinfo-facts')?.addEventListener('toggle', (e) => { settings.countryFactsOpen = e.currentTarget.open; saveSettings(); });

  // 言語の見分け方
  const guide = $('#lang-guide');
  const showLang = (l) => {
    $$('.lang-btn').forEach((x) => x.setAttribute('aria-expanded', String(x.dataset.lang === l)));
    entry.lang = l;
    if (!l) { guide.hidden = true; return; }
    const btn = $(`.lang-btn[data-lang="${l}"]`);
    const g = LANGS[l];
    guide.innerHTML = g ? `
      <div class="lg-title">${esc(g.ja)} <span class="muted">${esc(LANG_EN[l] || '')}</span></div>
      <dl class="lg-list">
        <div><dt>文字</dt><dd>${esc(g.s)}</dd></div>
        ${g.c ? `<div><dt>特徴的な文字</dt><dd class="lg-chars">${esc(g.c)}</dd></div>` : ''}
        ${g.w ? `<div><dt>よく見る単語</dt><dd>${esc(g.w)}</dd></div>` : ''}
        ${g.t ? `<div><dt>見分け方</dt><dd>${esc(g.t)}</dd></div>` : ''}
      </dl>` : `<div class="lg-title">${esc(LANG_EN[l] || l)}</div><p class="muted small">この言語の識別情報はまだ登録されていません</p>`;
    guide.insertAdjacentHTML('afterbegin', '<button type="button" class="icon-btn lang-pop-close" aria-label="閉じる">✕</button>');
    guide.querySelector('.lang-pop-close').addEventListener('click', () => showLang(null));
    // この言語が使われている国の一覧（ボタンで開閉。国を押すと同じ言語の吹き出しを開いた状態でその国へ）
    const users = langCountries(l);
    guide.insertAdjacentHTML('beforeend', `
      <button type="button" class="chip chip-btn lg-countries-btn" aria-expanded="${langListOpen ? 'true' : 'false'}">🌍 使われている国 <b>${users.length}</b> ${langListOpen ? '▲' : '▼'}</button>
      ${langListOpen ? `<div class="lg-countries">${users.map((n) => (n === code
        ? `<span class="chip nb-btn is-current">${flagImg(n)}${esc(countryName(n))}</span>`
        : `<button type="button" class="chip chip-btn nb-btn" data-lang-country="${n}">${flagImg(n)}${esc(countryName(n))}</button>`)).join('')}</div>` : ''}`);
    guide.querySelector('.lg-countries-btn').addEventListener('click', () => { langListOpen = !langListOpen; showLang(l); });
    guide.querySelectorAll('[data-lang-country]').forEach((b) => b.addEventListener('click', () => openCountryInfo(b.dataset.langCountry, null, l)));
    guide.hidden = false;
    // 押したボタンの真下に吹き出しを置き、矢印をボタンの中央に合わせる
    const host = guide.offsetParent || guide.parentElement;
    const hostW = host.clientWidth;
    const popW = Math.min(440, hostW);
    const bx = btn.offsetLeft + btn.offsetWidth / 2;
    const left = Math.max(0, Math.min(hostW - popW, bx - popW / 2));
    guide.style.width = `${popW}px`;
    guide.style.left = `${left}px`;
    guide.style.top = `${btn.offsetTop + btn.offsetHeight + 10}px`;
    guide.style.setProperty('--arrow-x', `${bx - left}px`);
  };
  // 吹き出しの外をクリック / Esc で閉じる（Esc はモーダル全体を閉じる前に吹き出しだけ閉じる）
  $('#modal .modal-inner').addEventListener('click', (e) => {
    // 吹き出しの中身を描き直したときは、押した要素が外れているので外側とみなさない
    if (entry.lang && e.target.isConnected && !e.target.closest('.lang-pop, .lang-btn')) showLang(null);
  });
  $('#modal').oncancel = (e) => {
    if (entry.lang && $('#lang-guide') && !$('#lang-guide').hidden) { e.preventDefault(); showLang(null); }
  };
  $$('.lang-btn').forEach((b) => b.addEventListener('click', () => showLang(entry.lang === b.dataset.lang ? null : b.dataset.lang)));
  if (entry.lang) showLang(entry.lang); // 戻ってきたときは開いていた言語を復元

  // メモ: 入力が止まって 0.8 秒、または欄から離れたら保存
  const memo = $('#memo-input');
  if (memo) {
    const status = $('#memo-status');
    let timer = null;
    let saved = memo.value;
    const save = async () => {
      clearTimeout(timer);
      const text = memo.value.trim();
      if (text === saved.trim()) return;
      status.textContent = '保存中…';
      try {
        await api.saveCountryNote(code, text);
        saved = memo.value;
        if (text) state.countryNotes.set(code, text); else state.countryNotes.delete(code);
        status.textContent = '保存しました';
        window.dispatchEvent(new Event('geo:notes')); // 地図のパネル・吹き出しに反映
      } catch (ex) {
        status.textContent = '';
        toast(`メモを保存できませんでした: ${ex.message}`, 'error');
      }
    };
    memo.addEventListener('input', () => { status.textContent = ''; clearTimeout(timer); timer = setTimeout(save, 800); });
    memo.addEventListener('blur', save);
    $('#modal').addEventListener('close', save, { once: true });
  }

  // カード一覧（カテゴリーで絞り込み）
  const drawTiles = () => {
    const el = $('#cinfo-tiles');
    if (!el) return;
    const list = cards.filter((x) => !entry.cat || catKey(x) === entry.cat);
    el.innerHTML = list.map((x) => tileHtml(x)).join('');
    bindTiles();
  };
  $$('[data-ccat]').forEach((b) => b.addEventListener('click', () => {
    entry.cat = b.dataset.ccat || null;
    $$('[data-ccat]').forEach((x) => x.classList.toggle('on', (x.dataset.ccat || null) === entry.cat));
    drawTiles();
  }));
  drawTiles();
  bindModalNav();
}

// 地図の右パネル用: 国の基本情報のコンパクト版
// 言語は data-lang（クリックで国の詳細をその言語の見分け方つきで開く）、隣接国は data-focus（地図をその国へ）
function countrySummaryHtml(code) {
  const c = COUNTRY_BY_CODE.get(code);
  const info = COUNTRY_INFO[code];
  if (!c || !info) return '';
  const left = LEFT_DRIVING.has(code);
  const plonkit = plonkitUrl(code);
  const langs = info.lang.filter((l) => !/Sign Language/i.test(LANG_EN[l] || ''));
  const row = (label, value) => (value ? `<div class="sum-row"><dt>${label}</dt><dd>${value}</dd></div>` : '');
  return `
    <div class="sum-head">
      <img class="sum-flag" src="${flagUrl(code)}" alt="">
      <div class="sum-names">
        <div class="sum-name ${isPlayable(code) ? '' : 'is-no-play'}">${esc(c.ja)}${isPlayable(code) ? '' : '<span class="no-play-tag">出題なし</span>'}</div>
        <div class="sum-sub">${esc(c.en)} ・ ${esc(REGION_BY_ID.get(c.region).name)}</div>
      </div>
      ${plonkit ? `<a class="ext-link" href="${plonkit}" target="_blank" rel="noopener" title="Plonkit で開く">${EXT_ICON_SVG}</a>` : ''}
      <button type="button" class="btn btn-sm sum-more" data-more="${code}" title="国の詳細を開く">詳細</button>
    </div>
    <dl class="sum-list">
      ${row('通行', `<span class="drive drive-${left ? 'left' : 'right'}">${left ? '⬅ 左側' : '右側 ➡'}</span>`)}
      ${row('ドメイン', info.tld.map((t) => `<code>${esc(t)}</code>`).join(' '))}
      ${row('電話', info.tel ? `<code>${esc(info.tel)}</code>` : '')}
      ${row('首都', esc(info.cap.join('、')))}
      ${row('通貨', info.cur.map(([k, , sym]) => `${esc(k)}${sym ? ` <b>${esc(sym)}</b>` : ''}`).join('・'))}
      ${row('言語', langs.map((l) => `<button type="button" class="chip chip-btn sum-lang" data-lang="${l}">${esc(LANGS[l]?.ja || LANG_EN[l] || l)}</button>`).join(' '))}
      ${row('隣接国', info.nb.map((n) => `<button type="button" class="chip chip-btn sum-nb" data-focus="${n}">${flagImg(n)}${esc(countryName(n))}</button>`).join(' '))}
    </dl>
    ${state.countryNotes.get(code) ? `<div class="sum-memo">📝 ${nl2br(state.countryNotes.get(code))}</div>` : ''}`;
}
const EXT_ICON_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>';

/* ================= 地図 ================= */
// ストリートビューで見つけた場所からカードを作る: 国・場所の名前・Google マップのリンクを入れた作成画面を開く
async function cardFromSv({ lat, lng, code }) {
  let area = '';
  try { // 場所の名前（県・市など）を OpenStreetMap で調べる。調べられなくても作成は続ける
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 3500);
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=ja&lat=${lat.toFixed(6)}&lon=${lng.toFixed(6)}`, { signal: ctl.signal });
    clearTimeout(timer);
    const a = (await r.json()).address || {};
    area = [a.state || a.province || a.region, a.city || a.county || a.town || a.municipality].filter(Boolean).filter((x, i, arr) => arr.indexOf(x) === i).join(' ');
  } catch { /* 空のまま */ }
  if (!code) toast('国を判定できなかったので、国は選び直してください');
  else toast('先にスクリーンショットをコピーしておけば、画像が自動で入ります（なければ Ctrl+V で貼り付け）');
  closeModal();
  openEditor(null, {
    countries: code ? [code] : [], area,
    notes: `ストリートビュー: https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat.toFixed(6)},${lng.toFixed(6)}`,
    autoPaste: true,
  });
}
const mapCtx = {
  createCardFromSv: (p) => cardFromSv(p),
  countrySummaryHtml: (code) => countrySummaryHtml(code),
  openCountry: (code, src, lang) => openCountryInfo(code, src, lang),
  attachComplete: (input, opts) => attachInlineComplete(input, opts),
  findCountry: (text) => findCountry(text),
  resolveCountry: (text) => resolveCountryCode(text),
  get cards() { return state.cards; },
  allCats, catKey, catOf, catVars, imgUrl, thumbUrl, countryName, esc, flagImg,
  openCard: (card, src, list) => openCardModal(card, src, list),
  animations: () => settings.animations,
  hoverAutoExpand: () => settings.hoverExpand,
  liveSearch: () => settings.liveSearch,
  mapMode: () => settings.mapMode || 'cards',
  mapPhotos: () => settings.mapPhotos !== false,
  panelSplit: () => Number(settings.mapPanelSplit) || 0.36,
  setPanelSplit: (r) => { settings.mapPanelSplit = Math.round(r * 1000) / 1000; saveSettings(); },
  openPhoto: (topic, code, srcs, i, src) => openPhotoModal(topic, code, srcs, i, src),
  photoNote: (topic, src, code) => photoNote(topic, src, code),
  setMapPhotos: (on) => { settings.mapPhotos = on; saveSettings(); },
  setMapMode: (m) => { settings.mapMode = m; saveSettings(); },
  isEditor: () => !!state.user?.isEditor,
  matchConds: () => state.mapMatch,
  setMatchCond: (t, k) => { if (k) state.mapMatch[t] = k; else delete state.mapMatch[t]; },
  clearMatch: () => { state.mapMatch = {}; },
  editFact: (mode, code) => openFactEditor(mode, code),
  // 地図の地域・カテゴリーの絞り込み（暗記・編集画面と同じ部品）
  filterPicksHtml: () => `${regionPickHtml('map-region', state.mapFilter.regionsOff)}${catPickHtml('map-cat', state.mapFilter.catsOff)}`,
  bindFilterPicks: (onChange) => {
    const f = state.mapFilter;
    const repick = (id) => { f.openPick = id; onChange(); };
    bindMultiPick('map-region', f.regionsOff, () => repick('map-region'), f.openPick === 'map-region');
    bindMultiPick('map-cat', f.catsOff, () => repick('map-cat'), f.openPick === 'map-cat');
    f.openPick = null;
  },
  filterMatch: (c) => pickMatch(c, state.mapFilter.regionsOff, state.mapFilter.catsOff),
  toast: (msg, kind) => toast(msg, kind),
  tileHtml: (card) => tileHtml(card),
  bindTiles: () => bindTiles(),
};

/* ================= バックアップ ================= */
async function exportBackup() {
  toast('書き出し中…');
  try {
    const out = [];
    for (const c of state.cards) {
      let image = '';
      const url = imgUrl(c);
      if (url) image = url.startsWith('data:') ? url : await blobToDataUrl(await (await fetch(url)).blob());
      const bu = backUrl(c);
      const back = bu ? (bu.startsWith('data:') ? bu : await blobToDataUrl(await (await fetch(bu)).blob())) : '';
      out.push({ description: c.description, countries: c.countries, area: c.area, notes: c.notes, category: catOf(c) === UNCAT ? '' : catOf(c).name, created_at: c.created_at, image, ...(back ? { back } : {}) });
    }
    const json = JSON.stringify({ app: 'geo-cards', version: 1, exportedAt: new Date().toISOString(), cards: out, countryNotes: Object.fromEntries(state.countryNotes) });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = `geochecker-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast(`${out.length} 枚を書き出しました`);
  } catch (ex) {
    toast(`書き出しに失敗しました: ${ex.message}`, 'error');
  }
}

/* ---- カードのまとめて追加: 複数の画像をドロップし、国・カテゴリーを選んで一度に作る ---- */
function openBulkAdd() {
  const items = []; // { blob, url, country, desc }
  openModal(`
    <div class="modal-head"><h2>📥 カードをまとめて追加</h2><button class="icon-btn" data-close aria-label="閉じる">✕</button></div>
    <div class="bulk-common">
      <label class="field"><span>カテゴリー（全部に共通）</span>
        <select id="bulk-cat" class="select">${allCats().map((k) => `<option value="${k.id}">${esc(k.name)}</option>`).join('')}</select></label>
      <label class="field"><span>国（全部に共通・あとで 1 枚ずつ変更可）</span><input type="text" id="bulk-country" class="input" list="country-list" placeholder="例: ポーランド" autocomplete="off"></label>
    </div>
    <div class="dropzone bulk-drop" id="bulk-drop" tabindex="0">
      <strong>画像をまとめてドロップ</strong><br>またはクリックして選択（複数可）・Ctrl+V で 1 枚ずつ貼り付け
      <input type="file" id="bulk-file" accept="image/*" multiple hidden>
    </div>
    <div class="bulk-list" id="bulk-list"></div>
    <div class="modal-foot">
      <span class="muted small" id="bulk-count">0 枚</span>
      <span class="grow"></span>
      <button class="btn btn-ghost" data-close type="button">キャンセル</button>
      <button class="btn btn-primary" id="bulk-save" type="button" disabled>まとめて作成</button>
    </div>`, 'modal-wide');
  const list = $('#bulk-list');
  const draw = () => {
    list.innerHTML = items.map((it, i) => `
      <div class="bulk-row">
        <img src="${it.url}" alt="">
        <input type="text" class="input bulk-c" data-i="${i}" list="country-list" placeholder="国（空なら共通の国）" value="${esc(it.country ? countryName(it.country) : '')}" autocomplete="off">
        <input type="text" class="input bulk-d" data-i="${i}" placeholder="説明（任意）" value="${esc(it.desc)}">
        <button type="button" class="icon-btn" data-rm="${i}" aria-label="外す">✕</button>
      </div>`).join('');
    $('#bulk-count').textContent = `${items.length} 枚`;
    $('#bulk-save').disabled = !items.length;
    $$('.bulk-c', list).forEach((x) => x.addEventListener('change', () => { items[x.dataset.i].country = resolveCountryCode(x.value) || ''; if (x.value && !items[x.dataset.i].country) toast('候補にある国名を入力してください', 'error'); }));
    $$('.bulk-d', list).forEach((x) => x.addEventListener('input', () => { items[x.dataset.i].desc = x.value; }));
    $$('[data-rm]', list).forEach((b) => b.addEventListener('click', () => { URL.revokeObjectURL(items[b.dataset.rm].url); items.splice(Number(b.dataset.rm), 1); draw(); }));
  };
  const add = (files) => {
    for (const f of files) if (f && f.type.startsWith('image/')) items.push({ blob: f, url: URL.createObjectURL(f), country: '', desc: '' });
    draw();
  };
  const drop = $('#bulk-drop');
  const file = $('#bulk-file');
  drop.addEventListener('click', () => file.click());
  file.addEventListener('change', () => { add([...file.files]); file.value = ''; });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); add([...e.dataTransfer.files]); });
  modalPasteHandler = (e) => {
    const its = [...(e.clipboardData?.items || [])].filter((i) => i.type.startsWith('image/'));
    if (!its.length) return;
    e.preventDefault();
    add(its.map((i) => i.getAsFile()));
  };
  $('#bulk-save').addEventListener('click', async (e) => {
    const common = resolveCountryCode($('#bulk-country').value);
    const missing = items.filter((it) => !it.country && !common).length;
    if (missing) { toast(`国が決まっていない画像が ${missing} 枚あります（共通の国か、1 枚ずつ国を入力してください）`, 'error'); return; }
    const cat = $('#bulk-cat').value;
    e.target.disabled = true;
    let ok = 0;
    for (const it of items) {
      try {
        await api.createCard({ description: it.desc, countries: [it.country || common], area: '', notes: '', category_id: cat === 'none' ? null : cat }, it.blob);
        ok++;
        toast(`作成中… ${ok} / ${items.length}`);
      } catch (ex) { toast(`作成できなかった画像があります: ${ex.message}`, 'error'); }
    }
    items.forEach((it) => URL.revokeObjectURL(it.url));
    closeModal();
    await reloadCards();
    render();
    toast(`${ok} 枚のカードを作成しました`);
  });
  attachInlineComplete($('#bulk-country'), { regions: false, ja: true });
}

async function importBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { toast('JSON を読み込めませんでした', 'error'); return; }
  const items = (data.cards || []).filter((c) => c.image && Array.isArray(c.countries));
  // 国のメモ（既存のメモがある国は上書きしない）
  const notes = Object.entries(data.countryNotes || {}).filter(([code, text]) => COUNTRY_BY_CODE.has(code) && text && !state.countryNotes.has(code));
  for (const [code, text] of notes) {
    try { await api.saveCountryNote(code, text); state.countryNotes.set(code, text); } catch { /* 続行 */ }
  }
  if (notes.length) toast(`国のメモを ${notes.length} 件読み込みました`);
  if (!items.length) { if (!notes.length) toast('読み込めるカードがありません', 'error'); return; }
  if (!confirm(`${items.length} 枚のカードを追加します。よろしいですか？（既存のカードはそのまま残ります）`)) return;
  let ok = 0;
  for (const it of items) {
    try {
      const countries = it.countries.filter((c) => COUNTRY_BY_CODE.has(c));
      if (!countries.length) continue;
      let cat = it.category ? state.categories.find((c) => c.name === it.category) : null;
      if (it.category && !cat) {
        await api.saveCategory({ name: it.category, color: PALETTE[state.categories.length % PALETTE.length], sort: (state.categories.length + 1) * 10 });
        state.categories = await api.listCategories();
        cat = state.categories.find((c) => c.name === it.category);
      }
      await api.createCard({ ...it, related: undefined, countries, category_id: cat?.id ?? null }, await dataUrlToBlob(it.image), it.back ? await dataUrlToBlob(it.back) : null);
      ok++;
      toast(`読み込み中… ${ok} / ${items.length}`);
    } catch (ex) {
      toast(`一部の読み込みに失敗しました: ${ex.message}`, 'error');
    }
  }
  await reloadCards();
  render();
  toast(`${ok} 枚を追加しました`);
}

boot();
