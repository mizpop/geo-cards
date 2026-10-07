// ストリートビューのウィンドウ（どのタブからでも開ける、画面に固定して浮かぶウィンドウ）
// 地図のストリートビューモード・参考写真・保存したストリートビューのタブから共通で使う。
// ヘッダーのドラッグで移動・左右への分割・縮小・拡大・保存・カード作成ができる
import { dockAdd, dockRemove, dockHas } from './dock.js';
import { bringFront, snapSideAt, dropEdgeAt, popWindow, showSnapPreview, snapWindow, unsnapWindow, isSnapped, snappedSide, releaseSnap, setPopOrigin, flipAnimate } from './floatz.js';

// キー不要の Google マップの埋め込み（クリックした地点の最寄りのストリートビューが開く）
// zoom: 視野（fov。小さいほど拡大）から求めた拡大の段階。cbp=12,向き,0,ズーム,傾き
// 視野（fov。小さいほど拡大）→ 拡大の段階。標準（ズーム 0）の視野は 73.7 度で、1 段上げるごとに、視野の半分の tan が半分になる（実測）
const BASE_HALF_FOV = Math.tan((73.7 / 2) * Math.PI / 180);
const zoomFromFov = (fov) => (fov > 0 && fov < 73.7 ? Math.round(Math.min(5, Math.log2(BASE_HALF_FOV / Math.tan((fov / 2) * Math.PI / 180))) * 100) / 100 : 0);
// 向き: 0 だと「指定なし」とみなされて、その地点の標準の向きになる。真北を指定したいときは 360 にする
const yaw = (heading) => { const r = Math.round(((heading % 360) + 360) % 360); return r === 0 ? (heading ? 360 : 0) : r; };
export const svEmbedUrl = (lat, lng, heading = 0, pitch = 0, fov = 0) => `https://www.google.com/maps?layer=c&cbll=${lat.toFixed(6)},${lng.toFixed(6)}&cbp=12,${yaw(heading)},0,${zoomFromFov(fov)},${Math.round(pitch)}&hl=ja&output=svembed`;
export const svOpenUrl = (lat, lng, v = {}) => `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat.toFixed(6)},${lng.toFixed(6)}${v.heading ? `&heading=${Math.round(v.heading)}` : ''}${v.pitch ? `&pitch=${Math.round(v.pitch)}` : ''}${v.fov ? `&fov=${Math.round(v.fov)}` : ''}`;
export const SV_ICON = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="5" r="2.6"/><path d="M12 9v6M8 11l4-2 4 2M9.5 21l2.5-6 2.5 6"/></svg>';
const SAVE_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/></svg>';

// Google マップのリンク・座標の文字から、緯度・経度（と向き）を取り出す。
// 例: https://www.google.com/maps/@48.8584,2.2944,3a,75y,90h,90t/... / ...viewpoint=48.85,2.29 / cbll=48.85,2.29 / 48.8584, 2.2944
const inRange = (lat, lng) => Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
export function parseLatLng(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const num = '(-?\\d{1,3}(?:\\.\\d+)?)';
  const tries = [
    new RegExp(`[?&](?:cbll|viewpoint)=${num},${num}`), // ストリートビューの地点
    new RegExp(`@${num},${num}`), // Google マップのアドレスバー（ストリートビューでは、今いる地点）
    /!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/, // 場所の指定
    new RegExp(`[?&](?:ll|q|center)=${num},${num}`),
    new RegExp(`^${num}\\s*[,，\\s]\\s*${num}$`), // 「緯度, 経度」だけ
  ];
  for (const re of tries) {
    const m = re.exec(t);
    if (!m) continue;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (!inRange(lat, lng)) continue;
    // …,3a,75y,90h,95t: y = 視野（小さいほど拡大）、h = 向き、t = 傾き（90 が水平）
    const h = /,(-?\d+(?:\.\d+)?)h(?:,|\/|$)/.exec(t);
    const y = /,(\d+(?:\.\d+)?)y(?:,|\/|$)/.exec(t);
    const tt = /,(-?\d+(?:\.\d+)?)t(?:,|\/|$)/.exec(t);
    return { lat, lng, heading: h ? (Number(h[1]) || 360) : 0, pitch: tt ? 90 - Number(tt[1]) : 0, fov: y ? Number(y[1]) : 0 };
  }
  return null;
}

// ---- ウィンドウの実体: ストリートビューのウィンドウを、複数同時に開ける。
//  下の panel / frame / point / view / rect … は「今操作しているウィンドウ（cur）」の作業用のコピー。
//  ウィンドウのイベントは、先に use(inst) で、そのウィンドウに切り替えてから処理する ----
const svs = []; // すべてのウィンドウ（閉じたあとも、1 つは残して使い回す）
let cur = null; // 作業用のコピーの持ち主
let active = null; // 最後に触った・開いたウィンドウ（外から呼ばれる関数が操作する相手）
let svSeq = 0;
const newInst = () => ({ id: ++svSeq, panel: null, frame: null, point: null, readyTimer: null, acceptAfter: 0, frameReady: true, view: { heading: 0, pitch: 0, fov: 0 }, rect: null, req: null });
function store() { if (cur) Object.assign(cur, { panel, frame, point, readyTimer, acceptAfter, frameReady, view, rect }); }
function use(inst) {
  if (!inst || cur === inst) return;
  store();
  cur = inst;
  ({ panel, frame, point, readyTimer, acceptAfter, frameReady, view, rect } = inst);
}
const useActive = () => { if (active) use(active); };
const openInsts = () => { store(); return svs.filter((i) => i.panel && !i.panel.hidden && i.point); };

let panel = null;
let frame = null;
let point = null; // [lat, lng]
let readyTimer = null;
let acceptAfter = 0; // 映像の読み込み完了から少しの間（Google の映像が準備できるまで）も、読み取った位置は受け付けない
let frameReady = true; // 映像（iframe）の読み込みが終わるまでは false。読み込み中は、前の映像の位置が読み取られて、位置が元に戻らないように、位置の更新を受け付けない
let view = { heading: 0, pitch: 0, fov: 0 }; // 向き・傾き・視野（ズーム）
let rect = null; // { left, top, width, height }（画面全体の中の位置と大きさ。開き直しても引き継ぐ）
let hooks = { isEditor: () => false, canSave: () => false, createCard: null, save: null, isSaved: () => false, savedAt: null, nearSaved: null, deleteSaved: null, renameSaved: null, placeName: null, toast: () => {}, readPosition: null, linkCard: null, listSaved: null, label: null, sub: null, flag: null };
const listeners = new Set();
const mobile = () => window.matchMedia('(max-width: 760px)').matches;
// スマホでは、カードなどの詳細がモーダル（最前面の層）で開くので、そのままだとストリートビューが下に隠れる。
// ストリートビューも最前面の層（popover）に出して、あとから開いた方が手前に来るようにする（PC は、浮かぶウィンドウどうしの重なりを保つため使わない）
function raiseTop() {
  store();
  for (const i of svs) {
    const p = i.panel;
    if (!p?.isConnected) continue;
    try {
      if (p.matches(':popover-open')) p.hidePopover();
      if (mobile() && !p.hidden) { p.setAttribute('popover', 'manual'); p.showPopover(); } else p.removeAttribute('popover');
    } catch { /* 非対応のブラウザでは、そのまま */ }
  }
}
let raiseTimer = null;
const raiseSoon = () => { clearTimeout(raiseTimer); raiseTimer = setTimeout(raiseTop, 0); };
if (typeof MutationObserver !== 'undefined') new MutationObserver((list) => { if (mobile() && list.some((m) => m.target.nodeName === 'DIALOG' && m.target.hasAttribute('open'))) raiseSoon(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['open'], subtree: true });
window.addEventListener('geo:dialog', raiseSoon);
const notify = () => { const pts = openInsts().map((i) => [...i.point]); listeners.forEach((fn) => { try { fn(pts); } catch { /* 無視 */ } }); }; // 開いているすべてのウィンドウの地点

// ポップアップ（保存した一覧・カードの選択）の共通部品: ボタンのそばに出して、外を押す・Esc で閉じる
let pop = null;
let popOwner = null; // ポップアップを出したボタン（同じボタンをもう一度押したら閉じる）
export const svPopOpenFor = (anchor) => !!pop && popOwner === anchor;
export function closeSvPop() { if (pop) { pop.remove(); pop = null; popOwner = null; document.removeEventListener('pointerdown', onPopOutside, true); document.removeEventListener('keydown', onPopKey, true); } }
const onPopOutside = (e) => { if (pop && !pop.contains(e.target) && !e.target.closest?.('#sv-save, #sv-link, #sv-list')) closeSvPop(); };
const onPopKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeSvPop(); } };
export function openSvPop(anchor, html, cls = '') {
  closeSvPop();
  popOwner = anchor;
  pop = document.createElement('div');
  pop.className = `sv-pop ${cls}`;
  pop.innerHTML = html;
  document.body.appendChild(pop);
  // 中身が増えても画面からはみ出さないよう、広い方（下か上）に、空きに合わせた高さで出す
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w));
  const spaceBelow = window.innerHeight - r.bottom - 14;
  const spaceAbove = r.top - 14;
  const below = spaceBelow >= 300 || spaceBelow >= spaceAbove;
  Object.assign(pop.style, { left: `${left}px`, maxHeight: `${Math.max(160, Math.min(460, below ? spaceBelow : spaceAbove))}px`, top: below ? `${r.bottom + 6}px` : '', bottom: below ? '' : `${window.innerHeight - r.top + 6}px` });
  bringFront(pop);
  setTimeout(() => { document.addEventListener('pointerdown', onPopOutside, true); document.addEventListener('keydown', onPopKey, true); }, 0);
  return pop;
}
// 保存した場所の削除（保存ボタンの右クリック）
function showDeletePop(anchor, row) {
  if (svPopOpenFor(anchor)) { closeSvPop(); return; }
  const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const el = openSvPop(anchor, `<label class="sv-pop-field"><span class="muted small">名前（空にすると地名の表示に戻ります）</span>
      <input type="text" class="input sv-pop-name" maxlength="60" value="${esc(row.title || '')}" placeholder="${esc(hooks.placeName?.(row) || '名前')}" autocomplete="off"></label>
    <p class="sv-pop-msg muted small">${esc(hooks.sub?.(row) || '')}</p>
    <button type="button" class="btn btn-sm btn-danger sv-pop-del">このストリートビューを削除</button>
    <p class="muted small sv-pop-msg">保存した場所から消します（関連付けたカードからも外れて見えなくなります）</p>`, 'sv-pop-delete');
  const input = el.querySelector('.sv-pop-name');
  let applied = (row.title || '').trim();
  const applyName = async () => { // Enter か、欄から離れたときに、名前を変える
    const v = input.value.trim();
    if (v === applied || !hooks.renameSaved) return;
    try { await hooks.renameSaved(row, v); applied = v; refreshSvWindow(); hooks.toast('名前を変えました'); } catch (err) { hooks.toast(err.message || '変えられませんでした', 'error'); }
  };
  input.addEventListener('keydown', (e) => { if (e.isComposing) return; if (e.key === 'Enter') { e.preventDefault(); applyName().then(closeSvPop); } });
  input.addEventListener('blur', applyName);
  el.querySelector('.sv-pop-del').addEventListener('click', async () => {
    try { await hooks.deleteSaved(row); closeSvPop(); refreshSvWindow(); hooks.toast('保存を削除しました'); } catch (err) { hooks.toast(err.message || '削除できませんでした', 'error'); }
  });
  input.focus(); input.select();
}
// 保存したストリートビューの一覧（押すと開く）
function showSavedList(anchor) {
  if (svPopOpenFor(anchor)) { closeSvPop(); return; } // 開いている状態でもう一度押したら閉じる
  const rows = hooks.listSaved?.() || [];
  const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const item = (r) => `<button type="button" class="sv-pop-item" data-i="${rows.indexOf(r)}">${hooks.flag?.(r.code) || ''}<span class="sv-pop-text"><b>${esc(hooks.label?.(r) || '')}</b><span class="muted small">${esc(hooks.sub?.(r) || '')}</span></span></button>`;
  const el = openSvPop(anchor, rows.length
    ? `<input type="search" class="input sv-pop-q" placeholder="絞り込み" autocomplete="off"><div class="sv-pop-list">${rows.map(item).join('')}</div>`
    : '<p class="muted small sv-pop-empty">保存したストリートビューはまだありません</p>', 'sv-pop-saved');
  const list = el.querySelector('.sv-pop-list');
  el.querySelector('.sv-pop-q')?.addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    list.querySelectorAll('.sv-pop-item').forEach((b) => { b.hidden = !!q && !b.textContent.toLowerCase().includes(q); });
  });
  const openRow = (e, newWindow) => {
    const b = e.target.closest('.sv-pop-item');
    const r = b && rows[Number(b.dataset.i)];
    if (!r) return;
    e.preventDefault();
    closeSvPop();
    openSvWindow(Number(r.lat), Number(r.lng), { heading: Number(r.heading) || 0, pitch: Number(r.pitch) || 0, fov: Number(r.fov) || 0, newWindow });
  };
  list.addEventListener('click', (e) => openRow(e, false));
  list.addEventListener('contextmenu', (e) => openRow(e, true)); // 右クリックは、新しいウィンドウで開く
  el.querySelector('.sv-pop-q')?.focus();
}

/** 開いた・閉じたときに呼ばれる（地図の目印の表示に使う）。解除する関数を返す */
export function onSvChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
/** 保存・カード作成などの動作を、アプリから渡す。{ isEditor, canSave, save({lat,lng}), isSaved({lat,lng}), createCard({lat,lng}) } */
export function setSvHooks(h) {
  hooks = { ...hooks, ...h };
  if (hooks.readPosition && !pollTimer) pollTimer = setInterval(syncAll, 1500); // Windows 版: 移動後の位置を自動で追いかける
  refreshSvWindow();
}
let pollTimer = null;
// 操作中のウィンドウの様子を読むだけ（作業用のコピーの持ち主は切り替えない。切り替えると、処理の途中のウィンドウと取り違えるため）
export const svWindowPoint = () => { store(); return active?.point ? [...active.point] : null; };
export const svWindowView = () => { store(); return active ? { ...active.view } : { heading: 0, pitch: 0, fov: 0 }; };
export const svWindowIsOpen = () => openInsts().length > 0;
export const svWindowIsOpenPoints = () => openInsts().map((i) => [...i.point]); // 開いているすべてのウィンドウの地点

function place() {
  if (!panel) return;
  if (mobile()) { panel.style.cssText = ''; return; }
  if (!rect) { // 最初は画面の左下に
    const w = Math.min(520, window.innerWidth - 24);
    const h = Math.min(400, window.innerHeight * 0.65);
    rect = { left: 12, top: window.innerHeight - h - 12, width: w, height: h };
  }
  const r = rect;
  Object.assign(panel.style, {
    left: `${Math.max(0, Math.min(window.innerWidth - 120, r.left))}px`, top: `${Math.max(0, Math.min(window.innerHeight - 60, r.top))}px`,
    width: `${r.width}px`, height: `${r.height}px`, right: 'auto', bottom: 'auto',
  });
}
function saveRect() {
  if (!panel || mobile() || panel.hidden || panel.classList.contains('is-docked') || !panel.offsetWidth || panel.classList.contains('is-max') || panel.classList.contains('is-min') || panel.classList.contains('is-snap')) return;
  rect = { left: panel.offsetLeft, top: panel.offsetTop, width: panel.offsetWidth, height: panel.offsetHeight }; // アニメーション（transform）の途中でも、本来の位置と大きさ
}
function setMinNow(on) {
  if (on) { unsnapWindow(panel); saveRect(); panel.classList.remove('is-max'); }
  panel.classList.toggle('is-min', on);
  const b = panel.querySelector('#sv-min');
  b.textContent = on ? '□' : '—';
  b.title = on ? 'もとの大きさに戻す' : '一時的に縮小（ヘッダーだけにする）';
  b.setAttribute('aria-label', on ? 'もとの大きさに戻す' : '縮小');
}
const setMin = (on) => flipAnimate(panel, () => setMinNow(on));

function refreshButtons() {
  if (!panel) return;
  const editor = !!hooks.isEditor();
  const card = panel.querySelector('#sv-card');
  if (card) card.hidden = !editor || !hooks.createCard;
  // Windows 版は、移動後の位置を自動で読み取れるので、貼り付けのボタンは出さない
  const paste = panel.querySelector('#sv-paste');
  if (paste) paste.hidden = !!hooks.readPosition;
  // 編集者: 既存のカードに関連付けるボタン（Google マップで開くボタンの代わり）
  const link = panel.querySelector('#sv-link');
  if (link) link.hidden = !editor || !hooks.linkCard;
  const ext = panel.querySelector('#sv-ext');
  if (ext) ext.hidden = editor && !!hooks.linkCard;
  // 題名: 保存した場所（同じ場所・同じ向き）にいるときはその名前、保存した地点の 100m 以内なら「〜付近」
  const cur = point ? { lat: point[0], lng: point[1], heading: view.heading } : null;
  const row = cur && hooks.savedAt ? hooks.savedAt(cur) : null;
  const near = !row && cur && hooks.nearSaved ? hooks.nearSaved(cur, 100) : null;
  const tt = panel.querySelector('#sv-title-text');
  if (tt) {
    tt.textContent = row ? (hooks.label?.(row) || 'ストリートビュー') : near ? `${hooks.label?.(near) || ''} 付近` : 'ストリートビュー';
    tt.title = row || near ? [hooks.sub?.(row || near), row ? '保存済みの場所' : `保存した地点の近く（約 ${Math.round(near._dist || 0)}m）`].filter(Boolean).join(' · ') : '';
  }
  panel.classList.toggle('is-named', !!row);
  panel.classList.toggle('is-nearby', !!near);
  panel.querySelector('.sv-title')?.classList.toggle('is-link', !!(row || near)); // 保存した場所の名前・「〜 付近」の題名は、押すと、保存した位置へ正確に移動できる
  const save = panel.querySelector('#sv-save');
  if (save) {
    save.hidden = false; // 保存できない（閲覧のみ）ときも、保存した一覧を開くために出す
    const saved = point ? !!hooks.isSaved({ lat: point[0], lng: point[1], heading: view.heading }) : false; // 同じ場所・同じ向きで保存済みのときだけ、色つき
    save.classList.toggle('is-saved', saved);
    save.title = hooks.canSave()
      ? `${saved ? '保存済み（ストリートビュータブにあります）' : 'この場所を保存する（ストリートビュータブから開けます）'}／右クリックで、保存した場所の一覧`
      : '保存したストリートビューの一覧';
    save.setAttribute('aria-label', save.title);
  }
}
/** 保存の状態が変わったとき（保存済みの表示を更新する） */
export function refreshSvWindow() { const keep = cur; for (const i of svs) { if (!i.panel) continue; use(i); refreshButtons(); } if (keep) use(keep); }

function ensure(inst) {
  use(inst);
  if (panel?.isConnected) return panel;
  panel = document.createElement('div');
  panel.className = 'sv-panel';
  panel.id = inst.id === 1 ? 'sv-panel' : `sv-panel-${inst.id}`;
  panel.hidden = true;
  panel.innerHTML = `
    <div class="sv-head" id="sv-head">
      <span class="sv-title">${SV_ICON} <span id="sv-title-text">ストリートビュー</span></span>
      <span class="sv-coord muted small" id="sv-coord"></span>
      <button type="button" class="icon-btn sv-btn" id="sv-paste" title="いる位置を取り込む（ウィンドウ内の「Google マップで見る」を右クリック →「リンクのアドレスをコピー」してから押す）" aria-label="位置を貼り付けて合わせる">📋</button>
      <button type="button" class="icon-btn sv-btn" id="sv-map" title="地図で場所を選ぶ（小さい地図が開きます。いる場所の近くが表示されます）" aria-label="地図で場所を選ぶ" aria-expanded="false">🗺</button>
      <button type="button" class="icon-btn sv-btn" id="sv-list" title="保存したストリートビューの一覧を開く" aria-label="保存したストリートビューの一覧">📂</button>
      <button type="button" class="icon-btn sv-btn" id="sv-save" title="この場所を保存する（ストリートビュータブから開けます）" aria-label="この場所を保存する" hidden>${SAVE_ICON}</button>
      <button type="button" class="icon-btn sv-btn" id="sv-card" title="この場所でカードを作る（国と場所を入れた状態で作成画面を開きます）" aria-label="この場所でカードを作る" hidden>📍</button>
      <button type="button" class="icon-btn sv-btn" id="sv-link" title="いる地点を、既存のカードに関連付ける（保存していなければ、保存してから関連付けます）" aria-label="既存のカードに関連付ける" hidden>🔗</button>
      <a class="icon-btn sv-btn" id="sv-ext" target="_blank" rel="noopener" title="Google マップで開く" aria-label="Google マップで開く">↗</a>
      <button type="button" class="icon-btn sv-btn" id="sv-min" title="一時的に縮小（ヘッダーだけにする）" aria-label="縮小">—</button>
      <button type="button" class="icon-btn sv-btn" id="sv-max" title="大きく / 元の大きさ（ヘッダーのダブルクリックでも）" aria-label="大きく表示">⤢</button>
      <button type="button" class="icon-btn sv-btn" id="sv-close" title="閉じる（Esc）" aria-label="閉じる">✕</button>
    </div>
    <iframe id="sv-frame" name="svf-${inst.id}" title="Google ストリートビュー" allow="fullscreen" referrerpolicy="strict-origin-when-cross-origin"></iframe>
    <div class="sv-minimap" hidden><div class="sv-minimap-map"></div><button type="button" class="icon-btn sv-minimap-close" aria-label="地図を閉じる" title="地図を閉じる">✕</button><span class="sv-minimap-tip">地図を押すと、近くの道路のストリートビューを開きます</span></div>
    <p class="sv-note muted small">ヘッダーをドラッグすると、画面のどこにでも動かせます。</p>`;
  document.body.appendChild(panel);
  frame = panel.querySelector('#sv-frame');
  const P = panel; const F = frame;
  // このウィンドウのイベントは、先にこのウィンドウに切り替えてから処理する
  const L = (el) => ({ addEventListener: (t, fn, o) => el.addEventListener(t, (e) => { use(inst); return fn(e); }, o) });
  L(frame).addEventListener('load', () => { frameReady = true; acceptAfter = Date.now() + 2500; clearTimeout(readyTimer); });
  L(panel).addEventListener('pointerdown', () => { active = inst; bringFront(panel); }, true); // 触ったウィンドウを手前に
  // 映像（別のサイトの iframe）をクリックするとキー入力が映像の中に行って、スペースキー（ストリートビューのモード）などが効かなくなるので、ポインターがウィンドウの外へ出たら、フォーカスをアプリ側に戻す
  const releaseFocus = () => { if (document.activeElement === F) { F.blur(); window.focus(); } };
  P.addEventListener('mouseleave', releaseFocus);
  // 映像（別のサイトの iframe）の中を操作したときは、ポインターのイベントがこちらに届かないので、フォーカスが映像に移ったことで、「操作中のウィンドウ」をこのウィンドウにする
  window.addEventListener('blur', () => { if (document.activeElement === F) { active = inst; bringFront(P); } });
  document.addEventListener('mousemove', (e) => { if (document.activeElement === F && !P.contains(e.target)) releaseFocus(); }, true); // ウィンドウの外でポインターが動いたら（mouseleave が届かない場合の備え）

  L(panel.querySelector('#sv-close')).addEventListener('click', () => closeSvWindow(inst));
  // 保存した場所の名前・「〜 付近」の題名を押すと、その保存した位置へ、保存したときの向き・ズームで正確に移動する
  L(panel.querySelector('.sv-title')).addEventListener('click', () => {
    if (!point) return;
    const cur = { lat: point[0], lng: point[1], heading: view.heading };
    const r = hooks.savedAt?.(cur) || hooks.nearSaved?.(cur, 100);
    if (r) openSvWindow(Number(r.lat), Number(r.lng), { heading: Number(r.heading) || 0, pitch: Number(r.pitch) || 0, fov: Number(r.fov) || 0 });
  });
  L(panel.querySelector('#sv-card')).addEventListener('click', async () => { await syncCurrent(); use(inst); if (point) hooks.createCard?.({ lat: point[0], lng: point[1], ...view }); });
  const SV_COVERAGE_TILE = 'https://mts1.google.com/vt?hl=ja&lyrs=svv&style=40,18&x={x}&y={y}&z={z}';
// 小さい地図: いる場所に近づいた状態で開き、押した場所のストリートビューに移る
  const mm = { map: null, marker: null, opening: false };
  inst.mini = {
    sync: () => { // いる場所が変わったら、目印と中心を合わせる
      const pt = inst.point || (inst === cur ? point : null);
      if (!mm.map || !pt) return;
      mm.marker.setLatLng(pt);
      if (mm.self) return; // この地図を押して移ったときは、地図を動かさない（押した場所が、画面の外へずれて見えないように）
      if (!mm.map.getBounds().contains(pt)) mm.map.panTo(pt, { animate: false }); // 外から場所が変わって、地図の外に出たときだけ、追いかける
    },
  };
  const miniEl = panel.querySelector('.sv-minimap');
  const miniBtn = panel.querySelector('#sv-map');
  const closeMini = () => { miniEl.hidden = true; miniBtn.setAttribute('aria-expanded', 'false'); miniBtn.classList.remove('is-on'); };
  panel.querySelector('.sv-minimap-close').addEventListener('click', closeMini);
  L(miniBtn).addEventListener('click', async () => {
    if (!miniEl.hidden) { closeMini(); return; }
    if (mm.opening) return;
    mm.opening = true;
    try {
      const { loadLibs, addBaseTiles } = await import('./map.js');
      await loadLibs();
      use(inst);
      const Lf = window.L;
      miniEl.hidden = false;
      miniBtn.setAttribute('aria-expanded', 'true');
      miniBtn.classList.add('is-on');
      const pt = point || [20, 0];
      if (!mm.map) {
        mm.map = Lf.map(miniEl.querySelector('.sv-minimap-map'), { zoomControl: true, attributionControl: false, minZoom: 2, maxZoom: 18, worldCopyJump: true });
        addBaseTiles(mm.map, { updateWhenZooming: false });
        // ストリートビューのある道路を青く（地図タブと同じタイル）
        mm.map.createPane('svCoverage').style.cssText = 'z-index:450;pointer-events:none';
        Lf.tileLayer(SV_COVERAGE_TILE, { pane: 'svCoverage', tileSize: 128, zoomOffset: 1, maxNativeZoom: 20, maxZoom: 19, updateWhenZooming: false, keepBuffer: 1, attribution: '' }).addTo(mm.map);
        mm.marker = Lf.circleMarker(pt, { radius: 7, color: '#fff', weight: 2, fillColor: '#e8590c', fillOpacity: 1, interactive: false }).addTo(mm.map);
        window.__svMiniMap = mm.map; // デバッグ・動作確認用
        let clickSeq = 0;
        mm.map.on('click', async (e) => { // 押した場所の近くの道路（地図タブと同じ。青い線）に寄せて、このウィンドウに開く。近くに道路がなければ、ポップアップで知らせる
          const ll = e.latlng.wrap();
          const seq = ++clickSeq;
          const { svFind } = await import('./map.js');
          const hit = await svFind(ll.lat, ll.lng, mm.map.getZoom()).catch(() => null);
          if (seq !== clickSeq) return; // 続けて押されたら、最後の 1 回だけ
          if (!hit) {
            Lf.popup({ closeButton: false, autoClose: true, autoPan: false, className: 'sv-minimap-pop', offset: [0, -2] }).setLatLng(e.latlng).setContent('この付近にはストリートビューがありません').openOn(mm.map);
            clearTimeout(mm.popTimer);
            mm.popTimer = setTimeout(() => mm.map?.closePopup(), 2600);
            return;
          }
          mm.map.closePopup();
          use(inst);
          active = inst;
          mm.self = true;
          try { openSvWindow(hit.lat, hit.lng, {}); } finally { mm.self = false; }
          mm.marker.setLatLng([hit.lat, hit.lng]);
        });
      }
      mm.map.invalidateSize();
      mm.map.setView(pt, point ? 15 : 3, { animate: false }); // 今のいる場所に近づいた状態で開く
      mm.marker.setLatLng(pt);
    } catch { hooks.toast?.('地図を読み込めませんでした', 'error'); } finally { mm.opening = false; }
  });
  L(panel.querySelector('#sv-save')).addEventListener('click', async (e) => {
    if (!hooks.canSave()) { showSavedList(e.currentTarget); return; } // 保存できない（閲覧のみ）ときは、一覧を出す
    await syncCurrent(); // Windows 版アプリは、移動したあとの今いる位置を読み取る
    use(inst);
    if (!point) return;
    const btn = panel.querySelector('#sv-save');
    btn.disabled = true;
    try { await hooks.save?.({ lat: point[0], lng: point[1], ...view }); } finally { btn.disabled = false; use(inst); refreshButtons(); }
  });
  L(panel.querySelector('#sv-list')).addEventListener('click', (e) => showSavedList(e.currentTarget));
  // 保存ボタンを右クリック: 保存したストリートビューの一覧をポップアップで出して、そこから開く
  L(panel.querySelector('#sv-save')).addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const row = point && hooks.savedAt ? hooks.savedAt({ lat: point[0], lng: point[1], heading: view.heading }) : null;
    if (row && hooks.canSave() && hooks.deleteSaved) showDeletePop(e.currentTarget, row); // 保存した場所にいるときは、削除のボタン
    else showSavedList(e.currentTarget);
  });
  L(panel.querySelector('#sv-link')).addEventListener('click', (e) => {
    if (svPopOpenFor(e.currentTarget)) { closeSvPop(); return; } // 開いている状態でもう一度押したら閉じる
    if (!point) return;
    // すぐにカードの一覧を出す。選んだ時点で、いる位置を読み取り直して（Windows 版）から、関連付ける
    hooks.linkCard?.(async () => { await syncCurrent(); use(inst); return point ? { lat: point[0], lng: point[1], ...view } : null; }, e.currentTarget);
  });
  L(panel.querySelector('#sv-max')).addEventListener('click', () => flipAnimate(panel, () => { unsnapWindow(panel); setMinNow(false); saveRect(); panel.classList.toggle('is-max'); if (!panel.classList.contains('is-max')) place(); })); // 元に戻すときは、覚えている位置・大きさへ
  L(panel.querySelector('#sv-min')).addEventListener('click', () => setMin(!panel.classList.contains('is-min')));

  // パネルをヘッダーのドラッグで動かす（画面のどこへでも。スマホは下に固定）
  const head = panel.querySelector('#sv-head');
  let drag = null;
  L(head).addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, a, .sv-title.is-link') || mobile()) return;
    const pr = panel.getBoundingClientRect();
    drag = { dx: e.clientX - pr.left, dy: e.clientY - pr.top, w: pr.width, sx: e.clientX, sy: e.clientY, started: false };
    head.setPointerCapture(e.pointerId);
  });
  L(head).addEventListener('mousedown', (e) => { if (e.button === 1 && !e.target.closest('button, a')) e.preventDefault(); }); // 中ボタンの自動スクロールを出さない
  L(head).addEventListener('auxclick', (e) => { // ウィンドウの上部（見出し）のホイールクリックで閉じる
    if (e.button !== 1 || e.target.closest('button, a')) return;
    e.preventDefault();
    closeSvWindow(inst);
  });
  L(head).addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.started) { // 少し動かしてから動かし始める（ダブルクリックで拡大するときに、位置が動かないように）
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
      drag.started = true;
      // 分割・最大化から外すと元の大きさに戻る。見出しの上でのカーソルの相対的な位置（左から何割か）が変わらないよう、カーソルを中心に縮む
      const rel = drag.w ? drag.dx / drag.w : 0.5;
      if (isSnapped(panel)) { unsnapWindow(panel); drag.w = rect.width; drag.dx = Math.max(20, Math.min(drag.w - 20, rel * drag.w)); } // 分割から外す
      else if (panel.classList.contains('is-max')) {
        panel.classList.remove('is-max');
        place();
        drag.w = rect.width;
        drag.dx = Math.max(20, Math.min(drag.w - 20, rel * drag.w));
      }
    }
    showSnapPreview(dropEdgeAt(e.clientX, e.clientY)); // 画面の左右のはしは分割、上のはしは最大化: 離したときの場所を見せる
    panel.style.left = `${Math.max(-drag.w + 80, Math.min(window.innerWidth - 80, e.clientX - drag.dx))}px`; // 画面の端に少し残す
    panel.style.top = `${Math.max(0, Math.min(window.innerHeight - 40, e.clientY - drag.dy))}px`;
  });
  // ヘッダーのダブルクリックで、大きく / 元の大きさ
  L(head).addEventListener('dblclick', (e) => {
    if (e.target.closest('button, a, .sv-title.is-link')) return;
    if (panel.classList.contains('is-min')) { setMin(false); return; }
    unsnapWindow(panel);
    saveRect();
    panel.classList.toggle('is-max');
    if (!panel.classList.contains('is-max')) place();
  });
  const endDrag = (e) => {
    if (drag?.started) {
      const side = e.type === 'pointerup' ? dropEdgeAt(e.clientX, e.clientY) : null;
      if (side === 'dock') dockPanel(); // 左下の角で離したら、しまう（バックグラウンドで保持）
      else if (side === 'top') flipAnimate(panel, () => { setMinNow(false); panel.classList.add('is-max'); }); // 画面の上のはしで離したら、最大化（元の位置・大きさは覚えたまま）
      else if (side) snapWindow(panel, side, () => { panel.classList.remove('is-snap'); place(); }); // 画面の左右のはしで離したら、画面を分割
      else saveRect();
    }
    showSnapPreview(null);
    drag = null;
  };
  L(head).addEventListener('pointerup', endDrag);
  L(head).addEventListener('pointercancel', endDrag);
  // 角のドラッグで大きさを変えたときも覚える
  if ('ResizeObserver' in window) new ResizeObserver(() => { use(inst); if (!panel.hidden) saveRect(); }).observe(panel);
  refreshButtons();
  return panel;
}

// ウィンドウをしまう・取り出す（左下の角。js/dock.js）
const dockKey = () => `sv-window-${cur.id}`;
function rectAt(drop) { if (rect) rect = { ...rect, left: Math.max(0, Math.min(window.innerWidth - 160, drop.x - 100)), top: Math.max(0, Math.min(window.innerHeight - 80, drop.y - 20)) }; }
function undockPanel() { if (!panel) return; panel.classList.remove('is-docked'); dockRemove(dockKey()); }
function dockPanel() {
  if (!panel || dockHas(dockKey())) return;
  const inst = cur;
  panel.classList.add('is-docked');
  dockAdd({
    key: dockKey(),
    label: () => { const p = inst.panel; const t = p?.querySelector('#sv-title-text')?.textContent || ''; return t && t !== 'ストリートビュー' ? `ストリートビュー: ${t}` : `ストリートビュー ${p?.querySelector('#sv-coord')?.textContent || ''}`.trim(); }, // 作業用のコピーは切り替えずに、このウィンドウの要素から読む
    thumb: () => ({ emoji: '🧍' }),
    restore: (rect, drop) => { // 離した場所に出す（大きさは、しまう前のまま）
      use(inst); active = inst;
      undockPanel();
      if (drop && !mobile()) rectAt(drop);
      if (!panel.classList.contains('is-max') && !isSnapped(panel)) place();
      bringFront(panel);
      popWindow(panel, rect);
    },
    close: () => { use(inst); undockPanel(); closeSvWindow(inst); },
  });
}

// 位置の自動読み取り（Windows 版）: 映像（Google の埋め込み）の中の今いる位置を、そのウィンドウごとに読み取る
const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);
async function syncInst(inst) {
  if (!hooks.readPosition || !inst.panel || inst.panel.hidden || !inst.point) return false;
  const hint = { name: `svf-${inst.id}`, ...(inst.req ? { lat: inst.req[0], lng: inst.req[1] } : {}) }; // 複数の映像から、このウィンドウのものを探す手がかり（映像の名前。なければ、開いたときの地点）
  const href = await withTimeout(Promise.resolve(hooks.readPosition(hint)).catch(() => null), 1200);
  const p = href ? parseLatLng(href) : null;
  if (!p) return false;
  const keep = cur;
  use(inst);
  applyPoint(p.lat, p.lng, p);
  if (keep) use(keep);
  return true;
}
const syncCurrent = () => (cur ? syncInst(cur) : Promise.resolve(false));
async function syncAll() { for (const inst of svs.slice()) { if (document.visibilityState === 'visible') await syncInst(inst); } }

// 映像はそのままで、今いる位置だけを更新する（読み取った位置。映像の読み込み中は受け付けない）
function applyPoint(lat, lng, v = {}) {
  if (!panel || panel.hidden || !frameReady || Date.now() < acceptAfter) return;
  const nv = { heading: Number(v.heading) || 0, pitch: Number(v.pitch) || 0, fov: Number(v.fov) || 0 };
  if (point && Math.abs(point[0] - lat) < 1e-7 && Math.abs(point[1] - lng) < 1e-7 && nv.heading === view.heading && nv.pitch === view.pitch && nv.fov === view.fov) return;
  point = [lat, lng];
  view = nv;
  cur?.mini?.sync();
  panel.querySelector('#sv-coord').textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  panel.querySelector('#sv-ext').href = svOpenUrl(lat, lng, view);
  refreshButtons();
  notify();
}
export function setSvWindowPoint(lat, lng, v = {}) { useActive(); applyPoint(lat, lng, v); }

/** その地点のストリートビューを、ウィンドウで開く（開いていれば、場所だけ切り替える）。opts.newWindow: 今のウィンドウを置き換えず、新しいウィンドウで開く */
export function openSvWindow(lat, lng, opts = {}) {
  store();
  let inst;
  if (opts.newWindow && openInsts().length) {
    inst = newInst();
    const base = (active && active.rect) || cur?.rect || null;
    // 前のウィンドウから少しずらして重ねる
    if (base) { let left = base.left + 40; let top = base.top - 34; if (left + base.width > window.innerWidth - 12 || top < 12) { left = 24 + (svs.length % 4) * 40; top = 80 + (svs.length % 4) * 28; } inst.rect = { ...base, left, top }; }
    svs.push(inst);
  } else {
    const shown = svs.filter((i) => i.panel && !i.panel.hidden);
    inst = (active && svs.includes(active) && (!shown.length || shown.includes(active)) ? active : shown[shown.length - 1] || svs[0]);
    if (!inst) { inst = newInst(); svs.push(inst); }
  }
  active = inst;
  ensure(inst);
  inst.req = [lat, lng];
  if (panel.classList.contains('is-docked')) { undockPanel(); if (!panel.classList.contains('is-max') && !isSnapped(panel)) place(); bringFront(panel); } // しまってあったら、取り出して開く（ドラッグ前の位置・大きさで）
  point = [lat, lng];
  cur?.mini?.sync();
  setMin(false); // 縮小していても、新しい場所を開いたら戻す
  panel.classList.remove('is-closing');
  if (panel.hidden) { panel.hidden = false; place(); bringFront(panel); setPopOrigin(panel); }
  raiseTop();
  view = { heading: Number(opts.heading) || 0, pitch: Number(opts.pitch) || 0, fov: Number(opts.fov) || 0 };
  frameReady = false; // 新しい映像が読み込まれるまで、読み取った位置では上書きしない
  clearTimeout(readyTimer);
  const mine = inst;
  readyTimer = setTimeout(() => { mine.frameReady = true; mine.acceptAfter = Date.now() + 2500; if (cur === mine) { frameReady = true; acceptAfter = mine.acceptAfter; } }, 15000); // 読み込み完了が通知されなくても、ずっと止まらないように
  frame.src = svEmbedUrl(lat, lng, view.heading, view.pitch, view.fov);
  panel.querySelector('#sv-coord').textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  panel.querySelector('#sv-ext').href = svOpenUrl(lat, lng, view);
  refreshButtons();
  notify();
}

/** 今のウィンドウ（または、渡したウィンドウ）を閉じる */
export function closeSvWindow(inst = null) {
  if (inst) use(inst); else useActive();
  if (!panel) return;
  const me = cur;
  undockPanel();
  releaseSnap(panel);
  point = null;
  setMin(false);
  notify();
  const hide = () => {
    use(me);
    if (!panel.classList.contains('is-closing')) return;
    panel.classList.remove('is-closing');
    if (point) return;
    panel.hidden = true; frame.src = 'about:blank';
    if (svs.length > 1) { // 余分なウィンドウは片付ける（最後の 1 つは、位置を覚えたまま使い回す）
      panel.remove();
      const i = svs.indexOf(me);
      if (i >= 0) svs.splice(i, 1);
      if (active === me) active = svs.filter((x) => x.panel && !x.panel.hidden).pop() || svs[0];
      cur = null; panel = frame = null;
    }
  };
  panel.classList.add('is-closing'); // 小さく消えるアニメーションのあとで隠す
  if (panel.hidden || document.documentElement.classList.contains('no-anim') || mobile()) { hide(); return; }
  setTimeout(hide, 170);
}

/** 再読み込みしても引き継ぐための、ウィンドウの状態（開いているすべてのウィンドウ） */
export function getSvWindowState() {
  const list = openInsts();
  const one = (i) => { use(i); return { point, rect, win: { side: snappedSide(panel), min: panel.classList.contains('is-min'), max: panel.classList.contains('is-max') }, view, docked: panel.classList.contains('is-docked') }; };
  const keep = cur;
  const wins = list.map(one);
  if (keep) use(keep);
  const first = wins[0] || { point: null, rect: svs[0]?.rect || null, win: null, view, docked: false };
  return { ...first, wins, activeIndex: Math.max(0, list.indexOf(active)) }; // 先頭の 1 つの分は、古い形式の読み取り用にも残す
}
/** 保存した状態から開き直す（再読み込み後。位置・大きさ・拡大・縮小・分割・しまったかも戻す） */
export function restoreSvWindow(s) {
  if (!s) return;
  const list = Array.isArray(s.wins) && s.wins.length ? s.wins : [s];
  list.forEach((w, i) => {
    if (!w.point) { if (w.rect && i === 0) { ensureFirst(); svs[0].rect = w.rect; if (cur === svs[0]) rect = w.rect; } return; }
    if (w.rect && i === 0) { ensureFirst(); svs[0].rect = w.rect; if (cur === svs[0]) rect = w.rect; }
    openSvWindow(w.point[0], w.point[1], { ...(w.view || {}), newWindow: i > 0 });
    if (i > 0 && w.rect) { rect = w.rect; }
    const st = w.win;
    if (st && !mobile()) {
      if (st.side) snapWindow(panel, st.side, () => { panel.classList.remove('is-snap'); place(); }, true);
      else if (st.max) panel.classList.add('is-max');
      else if (st.min) setMinNow(true);
    }
    if (w.docked && !mobile()) dockPanel(); // しまってあったウィンドウは、しまったまま戻す
  });
  if (Number.isInteger(s.activeIndex)) { const o = openInsts()[s.activeIndex]; if (o) active = o; }
}
function ensureFirst() { if (!svs.length) svs.push(newInst()); }
