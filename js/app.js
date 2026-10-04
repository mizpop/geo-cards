import { REGIONS, REGION_BY_ID, COUNTRIES, COUNTRY_BY_CODE, flagUrl, findCountry, searchCountries, searchText, normKana, hasKana, regionMatches, romajiLoose } from './countries.js';
import { initApi } from './api.js';
import { readClipboardImage, blobToDataUrl, dataUrlToBlob } from './image.js';
import { attachZoom } from './zoom.js';
import { initChat, teardownChat, raiseChat } from './chat.js';
import { renderMap, refreshMap, plonkitUrl } from './map.js';
import { COUNTRY_INFO, LANG_EN } from './countryinfo.js';
import { LANGS, LEFT_DRIVING } from './languages.js';
import { play, setMuted, playedRecently } from './sound.js';

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
const catOf = (card) => (card.category_id && state.categories.find((c) => c.id === card.category_id)) || UNCAT;
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
  study: { regions: new Set(), cats: new Set(), openPick: null, shuffled: false, deck: [], index: 0, flipped: false, enter: '' },
  quiz: { phase: 'setup', regions: new Set(REGIONS.map((r) => r.id)), count: 10, catsOff: new Set(), mode: 'choice', questions: [], i: 0, answers: [], answered: null },
  search: { q: '', cat: null },
  manage: { q: '', regions: new Set(), cats: new Set(), openPick: null, sel: new Set(), anchor: null }, // sel: 選択中のカード id（まとめて削除・カテゴリー変更）
};
const cardById = (id) => state.cards.find((c) => c.id === id);

/* ================= 設定（この端末のブラウザに保存） ================= */
const SETTINGS_KEY = 'geo-cards-settings-v1';
const DEFAULT_SETTINGS = {
  animations: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  theme: 'auto', // auto | light | dark
  studyStart: 'front', // 暗記カードで最初に見る面: front | back
  showDesc: true, // 表面に説明文を表示（暗記・クイズ）
  autoNext: false, // クイズで正解したら自動で次へ
  hoverExpand: true, // 地図: 国にマウスを乗せて止まると詳しいプレビューを表示
  studySplit: false, // 暗記カード: 表面と裏面を左右に並べて表示（めくらない）
  liveSearch: true, // 地図: 検索バーに入力するたびに候補の国へ移動（オフなら Enter で移動）
  sound: true, // 効果音（右上のボタンでも切り替え）
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
    </section>
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

  const changed = () => { saveSettings(); };
  $$('#modal .switch input').forEach((cb) => cb.addEventListener('change', () => { settings[cb.dataset.key] = cb.checked; changed(); }));
  $$('#modal .seg').forEach((g) => g.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    settings[g.dataset.key] = b.dataset.v;
    $$('button', g).forEach((x) => x.classList.toggle('on', x === b));
    changed();
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
const imgUrl = (card) => state.urls.get(card.id) || '';

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
  $('#tab-manage').hidden = !state.user.isEditor;
  $('#user-label').textContent = api.mode === 'demo' ? 'デモ' : state.user.isEditor ? `編集者: ${state.user.email}` : '閲覧のみ';
  $('#logout-btn').hidden = api.mode === 'demo';
  $('#view').innerHTML = '<p class="empty">読み込み中…</p>';
  initChat({ api, user: state.user, toast });
  await reloadCards();
  route();
  startLive();
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
    if (!modalCurrent) return; // 編集画面などでは通常の右クリックメニュー
    if (!rightPressInModal) { e.preventDefault(); return; } // 詳細の外で押した右ボタンを離しただけ
    if (e.target.closest('a, input, textarea')) return; // リンクや入力欄はブラウザのメニューを使えるように
    e.preventDefault();
    if (modalStack.length) modalBack();
    else closeModal();
  });
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
  if (!['study', 'quiz', 'map', 'manage'].includes(view)) view = 'study';
  if (view === 'manage' && !state.user.isEditor) view = 'study';
  state.view = view;
  $$('#tabs a').forEach((a) => a.classList.toggle('active', a.dataset.view === view));
  await refreshUrlsIfStale().catch(() => {});
  render();
}

// 暗記カード・クイズの出題中は画面の高さに収める（スクロールさせない）
function setFit(on) {
  $('#app').classList.toggle('app-fit', on);
  $('#view').classList.toggle('view-fit', on);
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
  if (v === 'study') renderStudy();
  else if (v === 'quiz') renderQuiz();
  else if (v === 'map') { setFit(false); renderMap($('#view'), mapCtx); }
  else if (v === 'manage') renderManage();
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
  ['search', '検索を開く'],
];
const DEFAULT_KEYS = { prev: 'KeyA', next: 'KeyD', flip: 'KeyS', back: 'KeyQ', country: 'KeyW', edit: 'KeyE', tabPrev: 'Ctrl+KeyA', tabNext: 'Ctrl+KeyD', search: 'Ctrl+KeyF' };
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
  const tabs = ['study', 'quiz', 'map'].concat(state.user.isEditor ? ['manage'] : []);
  const i = Math.max(0, tabs.indexOf(state.view));
  location.hash = `#${tabs[(i + delta + tabs.length) % tabs.length]}`;
}

function onKeydown(e) {
  if (capturingKey || e.isComposing) return;
  const act = actionFor(e);
  const mod = e.ctrlKey || e.metaKey || e.altKey;
  // 検索（初期設定は Ctrl+F。Ctrl+K でも）: 組み合わせキーなら入力中でもどこからでも開閉
  if (state.user && ((mod && act === 'search') || ((e.ctrlKey || e.metaKey) && e.code === 'KeyK')) && !$('dialog.viewer[open]')) {
    e.preventDefault();
    if ($('#spotlight').open) closeSpotlight();
    else if (!$('#modal').open) openSpotlight();
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

  // カード詳細・国の詳細
  if ($('#modal').open) {
    if (!modalCurrent) return; // 編集・設定などの画面では無効
    const card = modalCurrent.kind === 'card' ? cardById(modalCurrent.id) : null;
    if (act === 'back') { e.preventDefault(); if (modalStack.length) modalBack(); else closeModal(); }
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
      else if (act === 'edit' && card && state.user.isEditor) { e.preventDefault(); openEditor(card); }
    } else if (q.mode === 'choice' && digit && Number(digit) <= 4) {
      e.preventDefault();
      $$('.choice')[Number(digit) - 1]?.click();
    }
  }
}

/* ================= カード表示部品 ================= */
function frontHtml(card, showDesc = settings.showDesc) {
  return `
    <div class="front-img">${catBadge(card, 'cat-on-img')}${imgUrl(card) ? `<img src="${esc(imgUrl(card))}" alt="カード画像">` : '<div class="img-missing">画像なし</div>'}</div>
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

function notesHtml(card) {
  return card.notes ? `<div class="notes">${nl2br(card.notes)}</div>` : '';
}

function tileHtml(card, extra = '') {
  const shown = card.countries.slice(0, 4);
  const more = card.countries.length - shown.length;
  return `
    <article class="tile" data-id="${card.id}" tabindex="0" style="${catStyle(card)}">
      <div class="tile-img">${catBadge(card, 'cat-on-img')}${imgUrl(card) ? `<img src="${esc(imgUrl(card))}" alt="" loading="lazy">` : ''}</div>
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
  // モーダルでカード詳細・国情報を表示中なら履歴に積む。それ以外は新しく開く
  if ($('#modal').open && modalCurrent) modalStack.push(modalCurrent);
  else modalStack = [];
  showNav(entry);
}
function showNav(entry) {
  if (entry.kind === 'card') {
    const card = cardById(entry.id);
    if (!card) { closeModal(); return; }
    renderCardModal(card, entry);
  } else {
    renderCountryModal(entry);
  }
  modalCurrent = entry;
}
function modalBack() {
  const prev = modalStack.pop();
  if (prev) showNav(prev);
}
function backBtnHtml() {
  const prev = modalStack[modalStack.length - 1];
  if (!prev) return '';
  const label = prev.kind === 'country' ? countryName(prev.code) : 'カード';
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
        ${frontHtml(card, true)}
      </div>
      <div class="detail-back">
        ${answerHtml(card, 'md', true)}
        <p class="muted small detail-hint">国名をクリックすると基本情報を表示</p>
        ${notesHtml(card)}
      </div>
    </div>
    ${state.user.isEditor ? `<div class="modal-foot"><button class="btn" id="detail-edit">編集する</button></div>` : ''}
  `, 'modal-wide', true);
  attachZoom($('.detail-front .front-img'), pager ? { onSwipe: (d) => stepCard(d) } : {});
  $('#card-prev')?.addEventListener('click', () => stepCard(-1));
  $('#card-next')?.addEventListener('click', () => stepCard(1));
  delete entry.enter;
  bindModalNav();
  const eb = $('#detail-edit');
  if (eb) eb.addEventListener('click', () => { closeModal(); openEditor(card); });
}

/* ================= モーダル ================= */
let modalPasteHandler = null;
function openModal(html, cls = '', nav = false) {
  const m = $('#modal');
  if (!nav) { modalStack = []; modalCurrent = null; }
  m.className = `modal ${cls}`;
  if (!m.open) play('open'); // 詳細の中で移るとき（戻る・国へ）はタップ音だけ
  m.innerHTML = `<div class="modal-inner">${html}</div>`;
  modalPasteHandler = null;
  $$('[data-close]', m).forEach((b) => b.addEventListener('click', closeModal));
  if (!m.open) m.showModal();
  raiseChat(); // メモのボタン・欄をモーダルの手前に
}
function closeModal() {
  const m = $('#modal');
  if (m.open) m.close();
}

function emptyState(msg) {
  const canAdd = state.user.isEditor;
  return `<div class="empty">
    <p>${msg}</p>
    ${canAdd ? '<p><a class="btn btn-primary" href="#manage">カードを追加する</a></p>' : ''}
  </div>`;
}

// 地域・カテゴリーの絞り込み（複数選択。何も選ばなければすべて）。暗記カードと編集画面で共通
const pickMatch = (c, regions, cats) => (!regions.size || [...cardRegions(c)].some((r) => regions.has(r))) && (!cats.size || cats.has(catKey(c)));
const regionPickHtml = (id, sel) => multiPickHtml(id, 'すべての地域', REGIONS.map((r) => ({ id: r.id, name: r.name, n: state.cards.filter((c) => cardRegions(c).has(r.id)).length })), sel);
const catPickHtml = (id, sel) => multiPickHtml(id, 'すべてのカテゴリー', allCats().map((k) => ({ id: k.id, name: k.name, dot: catVars(k), n: state.cards.filter((c) => catKey(c) === k.id).length })), sel);

// 複数選択のドロップダウン（地域・カテゴリー）。selected が空 = すべて
function multiPickHtml(id, allLabel, options, selected) {
  const names = options.filter((o) => selected.has(o.id)).map((o) => o.name);
  const label = !names.length ? allLabel : names.length === 1 ? names[0] : `${names[0]} ほか ${names.length - 1}`;
  return `<div class="mpick" id="${id}">
    <button type="button" class="select mpick-btn ${names.length ? 'is-set' : ''}" aria-haspopup="true" aria-expanded="false" title="${esc(names.join('、') || allLabel)}">
      <span class="mpick-label">${esc(label)}</span><span class="mpick-arrow" aria-hidden="true">▾</span>
    </button>
    <div class="mpick-pop" hidden>
      <div class="mpick-head">
        <button type="button" class="chip chip-btn ${names.length ? '' : 'on'}" data-mp-all>${esc(allLabel)}</button>
        <span class="muted small">複数選べます</span>
      </div>
      <div class="mpick-list">${options.map((o) => `
        <label class="mpick-item ${o.n ? '' : 'is-empty'}" ${o.dot ? `style="${o.dot}"` : ''}>
          <input type="checkbox" value="${esc(o.id)}" ${selected.has(o.id) ? 'checked' : ''}>
          ${o.dot ? '<span class="cat-dot"></span>' : ''}<span class="mpick-name">${esc(o.name)}</span><span class="mpick-n">${o.n}</span>
        </label>`).join('')}</div>
    </div>
  </div>`;
}
function bindMultiPick(id, selected, onChange, reopen = false) {
  const root = $(`#${id}`);
  if (!root) return;
  const btn = $('.mpick-btn', root);
  const pop = $('.mpick-pop', root);
  const setOpen = (on) => {
    // ほかに開いている欄は閉じる
    if (on) $$('.mpick-pop').forEach((p) => { if (p !== pop) { p.hidden = true; p.previousElementSibling?.setAttribute('aria-expanded', 'false'); } });
    pop.hidden = !on;
    btn.setAttribute('aria-expanded', String(on));
  };
  btn.addEventListener('click', () => setOpen(pop.hidden));
  $$('input', pop).forEach((cb) => cb.addEventListener('change', () => {
    if (cb.checked) selected.add(cb.value); else selected.delete(cb.value);
    onChange();
  }));
  $('[data-mp-all]', pop).addEventListener('click', () => { selected.clear(); onChange(); });
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); btn.focus(); } });
  if (reopen) { setOpen(true); }
}
// 欄の外をクリックしたら閉じる
document.addEventListener('pointerdown', (e) => {
  if (e.target.closest?.('.mpick')) return;
  $$('.mpick-pop').forEach((p) => { if (!p.hidden) { p.hidden = true; p.previousElementSibling?.setAttribute('aria-expanded', 'false'); } });
});

/* ================= 暗記カード ================= */
function rebuildStudyDeck(keepPosition = false) {
  const s = state.study;
  const currentId = s.deck[s.index];
  let list = state.cards.filter((c) => pickMatch(c, s.regions, s.cats));
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
  $('#view').innerHTML = `
    <div class="toolbar">
      ${regionPickHtml('study-region', s.regions)}
      ${catPickHtml('study-cat', s.cats)}
      <button class="btn" id="study-shuffle" aria-label="シャッフル" title="押すたびに順番をランダムに並べ替え">🔀<span class="tab-long"> シャッフル</span></button>
      <button class="btn ${split ? 'btn-on' : ''}" id="study-split" aria-pressed="${split}" aria-label="表と裏を並べて表示" title="表面と裏面を左右に並べて表示">◫<span class="tab-long"> 並べて表示</span></button>
      <span class="counter">${total ? `${s.index + 1} / ${total}` : '0 / 0'}</span>
    </div>
    <div class="progress"><div class="progress-bar" style="width:${total ? ((s.index + 1) / total) * 100 : 0}%"></div></div>
    ${card ? `
      <div class="flash-wrap ${s.enter ? `enter-${s.enter}` : ''}">
        <div class="flashcard ${split ? 'split' : s.flipped ? 'is-flipped' : ''}" id="flashcard" ${split ? '' : 'role="button" aria-label="カードをめくる"'} tabindex="0" style="${catStyle(card)}">
          <div class="face face-front">${frontHtml(card)}</div>
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
              ${state.user.isEditor ? '<button class="btn btn-sm" id="study-edit" type="button" title="編集">✏️<span class="tab-long"> 編集</span></button>' : ''}
            </div>
            <div class="back-inner">
              <div class="back-answer">${answerHtml(card)}</div>
              ${notesHtml(card)}
            </div>
          </div>
        </div>
      </div>
      <div class="study-nav">
        <button class="btn btn-round" id="study-prev" aria-label="前へ" ${s.index === 0 ? 'disabled' : ''}>←</button>
        ${split ? '' : '<button class="btn btn-primary" id="study-flip">めくる</button>'}
        <button class="btn btn-round" id="study-next" aria-label="次へ" ${s.index >= total - 1 ? 'disabled' : ''}>→</button>
      </div>
      <p class="hint">${split ? '<span class="tab-long">← → で移動・画像はホイールで拡大、ドラッグで移動</span><span class="tab-short">左右スワイプで移動・ピンチで拡大</span>' : '<span class="tab-long">クリック / スペースキーでめくる・← → で移動・画像はホイールで拡大、ドラッグで移動</span><span class="tab-short">タップでめくる・左右スワイプで移動・ピンチで拡大</span>'}</p>
    ` : emptyState(state.cards.length ? 'この地域のカードはまだありません' : 'カードがまだありません')}
  `;
  s.enter = '';
  const repick = (id) => { s.openPick = id; rebuildStudyDeck(); renderStudy(); };
  bindMultiPick('study-region', s.regions, () => repick('study-region'), s.openPick === 'study-region');
  bindMultiPick('study-cat', s.cats, () => repick('study-cat'), s.openPick === 'study-cat');
  s.openPick = null;
  // 押すたびに並べ替えて 1 枚目から（以降、絞り込みを変えてもランダムな順のまま）
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
      if (e.target.closest('.front-img, button')) return;
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
  setFit(q.phase === 'question');
  if (q.phase === 'question') return renderQuestion();
  if (q.phase === 'result') return renderQuizResult();

  const counts = new Map(REGIONS.map((r) => [r.id, 0]));
  for (const c of state.cards) for (const r of cardRegions(c)) counts.set(r, counts.get(r) + 1);
  const catCounts = new Map(allCats().map((c) => [c.id, 0]));
  for (const c of state.cards) catCounts.set(catKey(c), catCounts.get(catKey(c)) + 1);
  const eligible = quizEligible(q.regions).length;

  $('#view').innerHTML = `
    <section class="panel quiz-setup">
      <h2>クイズ設定</h2>
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
      <div class="setup-block">
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
        <div class="setup-block">
          <div class="setup-label"><span>回答方式</span></div>
          <div class="seg" id="q-mode">
            <button class="${q.mode === 'choice' ? 'on' : ''}" data-mode="choice">4択</button>
            <button class="${q.mode === 'input' ? 'on' : ''}" data-mode="input">国名を入力</button>
          </div>
        </div>
      </div>
      <div class="setup-foot">
        <span class="muted">対象カード: <strong>${eligible}</strong> 枚</span>
        <button class="btn btn-primary btn-lg" id="q-start" ${eligible ? '' : 'disabled'}>スタート</button>
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
  $('#q-start').addEventListener('click', () => startQuiz(quizEligible(q.regions)));
}

function startQuiz(pool) {
  const q = state.quiz;
  let cards = shuffle(pool);
  if (q.count) cards = cards.slice(0, q.count);
  q.questions = cards.map((c) => ({ cardId: c.id, options: q.mode === 'choice' ? makeOptions(c, q.regions) : null }));
  q.i = 0;
  q.answers = [];
  q.answered = null;
  q.phase = 'question';
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
  const item = q.questions[q.i];
  const card = cardById(item.cardId);
  if (!card) { nextQuestion(); return; }
  const a = q.answered;
  const multi = q.mode === 'input' && card.countries.length > 1;
  q.draft = q.draft || [];

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
      <span class="counter">第 ${q.i + 1} 問 / ${q.questions.length}</span>
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
        </div>` : ''}
    </div>
  `;

  attachZoom($('.quiz-card .front-img'));
  $('#q-quit').addEventListener('click', () => {
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

function submitAnswer(card, given) {
  const q = state.quiz;
  // 4択は正解を1つ選べば正解。入力式は全部そろって正解、一部なら部分正解
  const result = q.mode === 'choice' ? (card.countries.includes(given[0]) ? 'ok' : 'ng') : grade(card, given);
  q.answered = { given: [...given], result };
  q.answers.push({ cardId: card.id, given: [...given], result, correct: result === 'ok' });
  play(result === 'ok' ? 'correct' : result === 'partial' ? 'partial' : 'wrong');
  q.draft = [];
  renderQuestion();
  if (result === 'ok' && settings.autoNext) {
    const at = q.i;
    setTimeout(() => { if (state.view === 'quiz' && q.phase === 'question' && q.i === at && q.answered) nextQuestion(); }, 1200);
  }
  const fb = $('.feedback');
  if (fb) fb.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function nextQuestion() {
  const q = state.quiz;
  q.answered = null;
  q.draft = [];
  q.i++;
  if (q.i >= q.questions.length) q.phase = 'result';
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
  $('#view').innerHTML = `
    <section class="panel result">
      <div class="score">${ok}<span> / ${total}</span></div>
      <div class="score-pct">${part ? `△ 部分正解 ${part} ・ ` : ''}正答率 ${pct}%${part ? '（△は0.5問として計算）' : ''}</div>
      <div class="result-actions">
        ${wrong.length ? '<button class="btn btn-primary" id="q-retry">間違えた問題だけ再挑戦</button>' : ''}
        <button class="btn" id="q-again">同じ設定でもう一度</button>
        <button class="btn btn-ghost" id="q-setup">設定に戻る</button>
      </div>
    </section>
    ${wrong.length ? `
      <h3 class="section-title">間違えた・部分正解のカード（${wrong.length}）</h3>
      <div class="tiles">${wrong.map((w) => {
        const c = cardById(w.cardId);
        return c ? tileHtml(c, `<p class="tile-given">${w.result === 'partial' ? '△' : '✗'} あなたの回答: ${esc(w.given.map(countryName).join('・'))}</p>`) : '';
      }).join('')}</div>` : ''}
  `;
  bindTiles();
  const retry = $('#q-retry');
  if (retry) retry.addEventListener('click', () => startQuiz(wrong.map((w) => cardById(w.cardId)).filter(Boolean)));
  $('#q-again').addEventListener('click', () => startQuiz(quizEligible(q.regions)));
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
      <div class="spot-foot muted">↑↓←→ で選択・Enter で開く・Esc で閉じる</div>
    </div>`;
  const input = $('#search-input', sp);
  const syncChips = () => $$('.spot-regions [data-q]', sp).forEach((b) => b.classList.toggle('on', b.dataset.q === s.q));

  // PC は入力欄の中に候補を薄く表示して Tab で補完（スマホは候補リスト）
  const drawGhost = attachInlineComplete(input);
  input.addEventListener('input', () => { s.q = input.value; renderSearchResults(); syncChips(); });
  input.addEventListener('keydown', (e) => {
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
  if (!sp.open) sp.showModal();
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

function closeSpotlight() {
  const sp = $('#spotlight');
  if (!sp.open || sp.classList.contains('closing')) return;
  if (!settings.animations) { sp.close(); return; }
  sp.classList.add('closing'); // 縮みながら消えるアニメーションの後に閉じる
  setTimeout(() => { sp.classList.remove('closing'); sp.close(); }, 150);
}

function renderSearchResults() {
  const { q, cat } = state.search;
  const list = matchCards(q).filter((c) => !cat || catKey(c) === cat);
  const catName = cat ? allCats().find((c) => c.id === cat)?.name : '';
  const cond = [q.trim() && `「${esc(q.trim())}」`, catName && `カテゴリー: ${esc(catName)}`].filter(Boolean).join(' / ');
  const label = cond ? `${cond} の検索結果: ${list.length} 枚` : `すべてのカード: ${list.length} 枚`;
  if (!$('#search-results')) return;
  $('#search-results').innerHTML = `
    <p class="muted result-count">${label}</p>
    ${list.length ? `<div class="tiles">${list.map((c) => tileHtml(c, textSnippet(c, q))).join('')}</div>` : '<p class="empty">該当するカードがありません</p>'}`;
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
  $('#view').innerHTML = `
    <div class="toolbar">
      <button class="btn btn-primary" id="m-new">＋ 新しいカード</button>
      <input type="search" id="m-filter" class="input grow" placeholder="絞り込み（国名・地域名・説明）" value="${esc(m.q)}">
      ${regionPickHtml('m-region', m.regions)}
      ${catPickHtml('m-cat', m.cats)}
      <span class="counter" id="m-count"></span>
    </div>
    <div class="toolbar toolbar-sub">
      <button class="btn btn-ghost btn-sm" id="m-cats">🏷 カテゴリー管理</button>
      <button class="btn btn-ghost btn-sm" id="m-export">バックアップを書き出し</button>
      <label class="btn btn-ghost btn-sm">バックアップから読み込み<input type="file" id="m-import" accept="application/json,.json" hidden></label>
      <span class="grow"></span>
      <button class="btn btn-ghost btn-sm" id="m-sel-all" title="表示中のカードをすべて選択">☑ 全選択</button>
      <button class="btn btn-ghost btn-sm" id="m-sel-none" title="選択を解除（Esc）">☐ 選択解除</button>
    </div>
    <div class="sel-bar" id="sel-bar" hidden>
      <b id="sel-count"></b>
      <span class="muted small sel-tip tab-long">Shift+クリックで範囲選択・Ctrl+クリックで1枚ずつ</span>
      <span class="grow"></span>
      <select class="select select-sm" id="sel-cat" aria-label="選択したカードのカテゴリーを変更">
        <option value="">🏷 カテゴリーを変更…</option>
        ${allCats().map((k) => `<option value="${k.id}">${esc(k.name)}</option>`).join('')}
      </select>
      <button class="btn btn-sm btn-danger" id="sel-del">🗑 削除</button>
      <button class="icon-btn" id="sel-clear" aria-label="選択を解除" title="選択を解除（Esc）">✕</button>
    </div>
    <div id="manage-list"></div>`;
  $('#m-new').addEventListener('click', () => openEditor(null));
  $('#m-filter').addEventListener('input', (e) => { m.q = e.target.value; renderManageList(); });
  const repick = (id) => { m.openPick = id; renderManage(); };
  bindMultiPick('m-region', m.regions, () => repick('m-region'), m.openPick === 'm-region');
  bindMultiPick('m-cat', m.cats, () => repick('m-cat'), m.openPick === 'm-cat');
  m.openPick = null;
  $('#m-export').addEventListener('click', exportBackup);
  $('#m-cats').addEventListener('click', openCategoryManager);
  $('#m-import').addEventListener('change', (e) => { if (e.target.files[0]) importBackup(e.target.files[0]); e.target.value = ''; });
  $('#m-sel-all').addEventListener('click', () => { for (const c of manageFiltered()) m.sel.add(c.id); updateSelUI(); });
  $('#m-sel-none').addEventListener('click', clearSel);
  $('#sel-clear').addEventListener('click', clearSel);
  $('#sel-del').addEventListener('click', confirmBulkDelete);
  $('#sel-cat').addEventListener('change', (e) => { const v = e.target.value; e.target.value = ''; if (v) bulkSetCategory(v); });
  // 選択: Shift+クリックで範囲・Ctrl(⌘)+クリックで1枚ずつ。選択中は普通のクリック / チェックでも切り替え
  const listEl = $('#manage-list');
  listEl.addEventListener('mousedown', (e) => { if (e.shiftKey && e.target.closest('.tile')) e.preventDefault(); }); // 文字が選択されないように
  listEl.addEventListener('click', (e) => {
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
  $('#m-sel-none').disabled = !m.sel.size;
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
  return matchCards(m.q.trim().toLowerCase()).filter((c) => pickMatch(c, m.regions, m.cats));
}
function renderManageList() {
  const m = state.manage;
  const list = manageFiltered();
  const filtered = m.q.trim() || m.regions.size || m.cats.size;
  $('#m-count').textContent = filtered ? `${list.length} / ${state.cards.length} 枚` : `${state.cards.length} 枚`;
  $('#manage-list').innerHTML = list.length
    ? `<div class="tiles">${list.map((c) => tileHtml(c, `
        <label class="tile-check" title="選択（Shift / Ctrl+クリックでも）"><input type="checkbox" aria-label="このカードを選択"></label>
        <div class="tile-actions">
          <button class="btn btn-sm" data-edit="${c.id}">編集</button>
          <button class="btn btn-sm btn-danger-ghost" data-del="${c.id}">削除</button>
        </div>`)).join('')}</div>`
    : `<div class="empty"><p>${state.cards.length ? '該当するカードがありません' : 'まだカードがありません。「＋ 新しいカード」から追加しましょう'}</p></div>`;
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
function openEditor(card) {
  const ed = {
    blob: null,
    preview: card ? imgUrl(card) : '',
    countries: new Set(card ? card.countries : []),
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
          <img id="ed-img" alt="" ${ed.preview ? `src="${esc(ed.preview)}"` : 'hidden'}>
          <div class="dropzone-hint" id="ed-hint" ${ed.preview ? 'hidden' : ''}>
            <strong>画像をドロップ</strong><br>またはクリックしてファイルを選択<br><span class="muted">Ctrl+V（⌘+V）でも貼り付けできます</span>
          </div>
        </div>
        <div class="row">
          <button class="btn" id="ed-paste" type="button">📋 クリップボードから貼り付け</button>
          <label class="btn btn-ghost">ファイルを選択<input type="file" id="ed-file" accept="image/*" hidden></label>
        </div>
        <div class="field">
          <span>カテゴリー</span>
          <div class="cat-picker">
            ${allCats().map((c) => `
              <label class="cat-opt" style="${catVars(c)}">
                <input type="radio" name="ed-cat" value="${c.id}" ${(card ? catKey(card) : 'none') === c.id ? 'checked' : ''}>
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
      </section>
    </div>
    <div class="modal-foot">
      ${card ? '<button class="btn btn-danger-ghost" id="ed-delete" type="button">削除</button>' : ''}
      <span class="grow"></span>
      <button class="btn btn-ghost" data-close type="button">キャンセル</button>
      <button class="btn btn-primary" id="ed-save" type="button">保存</button>
    </div>
  `, 'modal-wide');

  const setImage = async (blob) => {
    if (!blob || !blob.type.startsWith('image/')) { toast('画像ファイルではありません', 'error'); return; }
    ed.blob = blob;
    ed.preview = await blobToDataUrl(blob);
    const img = $('#ed-img');
    img.src = ed.preview;
    img.hidden = false;
    $('#ed-hint').hidden = true;
  };

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
    };
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = '保存中…';
    try {
      if (card) await api.updateCard(card, fields, ed.blob);
      else await api.createCard(fields, ed.blob);
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
        <div class="cinfo-name">${esc(c.ja)}</div>
        <div class="cinfo-sub">${esc(c.en)}${info.o && info.o !== c.ja ? ` ・ ${esc(info.o)}` : ''}</div>
        <div class="cinfo-tags">
          <span class="tag">${esc(region.name)}</span>
          ${info.un ? '' : '<span class="tag">海外領土・地域</span>'}
          ${info.ll ? '<span class="tag">内陸国</span>' : ''}
          ${plonkit ? `<a class="tag tag-link" href="${plonkit}" target="_blank" rel="noopener">Plonkit ↗</a>` : ''}
        </div>
      </div>
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
    <section class="cinfo-memo">
      <h3 class="cinfo-cards-title">📝 メモ <span class="memo-status muted small" id="memo-status"></span></h3>
      ${state.user.isEditor
        ? `<textarea id="memo-input" class="memo-input" rows="3" placeholder="この国の覚えておきたいこと（見分け方・注意点など）。入力が止まると自動で保存されます">${esc(state.countryNotes.get(code) || '')}</textarea>`
        : `<div class="memo-view">${state.countryNotes.get(code) ? nl2br(state.countryNotes.get(code)) : '<span class="muted small">メモはまだありません</span>'}</div>`}
    </section>
    <section class="cinfo-cards">
      <h3 class="cinfo-cards-title">この国のカード <span class="muted">${cards.length} 枚</span></h3>
      ${cards.length ? `
        <div class="region-chips cat-chips">
          <button class="chip chip-btn ${entry.cat ? '' : 'on'}" data-ccat="">すべて</button>
          ${cats.map((k) => `<button class="chip chip-btn chip-cat ${entry.cat === k.id ? 'on' : ''}" data-ccat="${k.id}" style="${catVars(k)}"><span class="cat-dot"></span>${esc(k.name)}</button>`).join('')}
        </div>
        <div class="tiles tiles-compact" id="cinfo-tiles"></div>` : '<p class="muted small">まだカードがありません</p>'}
    </section>`, 'modal-md', true);

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
        <div class="sum-name">${esc(c.ja)}</div>
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
const mapCtx = {
  countrySummaryHtml: (code) => countrySummaryHtml(code),
  openCountry: (code, src, lang) => openCountryInfo(code, src, lang),
  attachComplete: (input, opts) => attachInlineComplete(input, opts),
  findCountry: (text) => findCountry(text),
  resolveCountry: (text) => resolveCountryCode(text),
  get cards() { return state.cards; },
  allCats, catKey, catOf, catVars, imgUrl, countryName, esc, flagImg,
  openCard: (card, src, list) => openCardModal(card, src, list),
  animations: () => settings.animations,
  hoverAutoExpand: () => settings.hoverExpand,
  liveSearch: () => settings.liveSearch,
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
      out.push({ description: c.description, countries: c.countries, area: c.area, notes: c.notes, category: catOf(c) === UNCAT ? '' : catOf(c).name, created_at: c.created_at, image });
    }
    const json = JSON.stringify({ app: 'geo-cards', version: 1, exportedAt: new Date().toISOString(), cards: out, countryNotes: Object.fromEntries(state.countryNotes) });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = `geo-cards-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast(`${out.length} 枚を書き出しました`);
  } catch (ex) {
    toast(`書き出しに失敗しました: ${ex.message}`, 'error');
  }
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
      await api.createCard({ ...it, countries, category_id: cat?.id ?? null }, await dataUrlToBlob(it.image));
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
