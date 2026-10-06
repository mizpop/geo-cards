// ストリートビューのウィンドウ（どのタブからでも開ける、画面に固定して浮かぶウィンドウ）
// 地図のストリートビューモード・参考写真・保存したストリートビューのタブから共通で使う。
// ヘッダーのドラッグで移動・左右への分割・縮小・拡大・保存・カード作成ができる
import { bringFront, snapSideAt, showSnapPreview, snapWindow, unsnapWindow, isSnapped, snappedSide, releaseSnap, setPopOrigin, flipAnimate } from './floatz.js';

// キー不要の Google マップの埋め込み（クリックした地点の最寄りのストリートビューが開く）
// zoom: 視野（fov。小さいほど拡大）から求めた拡大の段階。cbp=12,向き,0,ズーム,傾き
const zoomFromFov = (fov) => (fov > 0 ? Math.round(Math.max(0, Math.min(5, Math.log2(90 / fov))) * 100) / 100 : 0);
export const svEmbedUrl = (lat, lng, heading = 0, pitch = 0, fov = 0) => `https://www.google.com/maps?layer=c&cbll=${lat.toFixed(6)},${lng.toFixed(6)}&cbp=12,${Math.round(heading)},0,${zoomFromFov(fov)},${Math.round(pitch)}&hl=ja&output=svembed`;
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
    return { lat, lng, heading: h ? Number(h[1]) : 0, pitch: tt ? Number(tt[1]) - 90 : 0, fov: y ? Number(y[1]) : 0 };
  }
  return null;
}

let panel = null;
let frame = null;
let point = null; // [lat, lng]
let view = { heading: 0, pitch: 0, fov: 0 }; // 向き・傾き・視野（ズーム）
let rect = null; // { left, top, width, height }（画面全体の中の位置と大きさ。開き直しても引き継ぐ）
let hooks = { isEditor: () => false, canSave: () => false, createCard: null, save: null, isSaved: () => false, toast: () => {}, syncPosition: null };
const listeners = new Set();
const mobile = () => window.matchMedia('(max-width: 760px)').matches;
const notify = () => listeners.forEach((fn) => { try { fn(point); } catch { /* 無視 */ } });

/** 開いた・閉じたときに呼ばれる（地図の目印の表示に使う）。解除する関数を返す */
export function onSvChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
/** 保存・カード作成などの動作を、アプリから渡す。{ isEditor, canSave, save({lat,lng}), isSaved({lat,lng}), createCard({lat,lng}) } */
export function setSvHooks(h) { hooks = { ...hooks, ...h }; if (panel) refreshButtons(); }
export const svWindowPoint = () => (point ? [...point] : null);
export const svWindowView = () => ({ ...view });
export const svWindowIsOpen = () => !!point && !!panel && !panel.hidden;

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
  if (!panel || mobile() || panel.hidden || panel.classList.contains('is-max') || panel.classList.contains('is-min') || panel.classList.contains('is-snap')) return;
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
  const card = panel.querySelector('#sv-card');
  if (card) card.hidden = !hooks.isEditor() || !hooks.createCard;
  const save = panel.querySelector('#sv-save');
  if (save) {
    save.hidden = !hooks.canSave();
    const saved = point ? !!hooks.isSaved({ lat: point[0], lng: point[1] }) : false;
    save.classList.toggle('is-saved', saved);
    save.title = saved ? '保存済み（ストリートビュータブにあります）' : 'この場所を保存する（ストリートビュータブから開けます）';
    save.setAttribute('aria-label', save.title);
  }
}
/** 保存の状態が変わったとき（保存済みの表示を更新する） */
export const refreshSvWindow = () => refreshButtons();

function ensure() {
  if (panel?.isConnected) return panel;
  panel = document.getElementById('sv-panel');
  if (panel) panel.remove(); // 古い版が残っていたら作り直す
  panel = document.createElement('div');
  panel.className = 'sv-panel';
  panel.id = 'sv-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="sv-head" id="sv-head">
      <span class="sv-title">${SV_ICON} ストリートビュー</span>
      <span class="sv-coord muted small" id="sv-coord"></span>
      <button type="button" class="icon-btn sv-btn" id="sv-paste" title="いる位置を取り込む（ウィンドウ内の「Google マップで見る」を右クリック →「リンクのアドレスをコピー」してから押す）" aria-label="位置を貼り付けて合わせる">📋</button>
      <button type="button" class="icon-btn sv-btn" id="sv-save" title="この場所を保存する（ストリートビュータブから開けます）" aria-label="この場所を保存する" hidden>${SAVE_ICON}</button>
      <button type="button" class="icon-btn sv-btn" id="sv-card" title="この場所でカードを作る（国と場所を入れた状態で作成画面を開きます）" aria-label="この場所でカードを作る" hidden>📍</button>
      <a class="icon-btn sv-btn" id="sv-ext" target="_blank" rel="noopener" title="Google マップで開く" aria-label="Google マップで開く">↗</a>
      <button type="button" class="icon-btn sv-btn" id="sv-min" title="一時的に縮小（ヘッダーだけにする）" aria-label="縮小">—</button>
      <button type="button" class="icon-btn sv-btn" id="sv-max" title="大きく / 元の大きさ（ヘッダーのダブルクリックでも）" aria-label="大きく表示">⤢</button>
      <button type="button" class="icon-btn sv-btn" id="sv-close" title="閉じる（Esc）" aria-label="閉じる">✕</button>
    </div>
    <iframe id="sv-frame" title="Google ストリートビュー" allow="fullscreen" referrerpolicy="strict-origin-when-cross-origin"></iframe>
    <p class="sv-note muted small">ヘッダーをドラッグすると、画面のどこにでも動かせます。</p>`;
  document.body.appendChild(panel);
  frame = panel.querySelector('#sv-frame');
  panel.addEventListener('pointerdown', () => bringFront(panel), true); // 触ったウィンドウを手前に

  panel.querySelector('#sv-close').addEventListener('click', closeSvWindow);
  // 矢印をたどって移動したあとの位置は、Google の埋め込みからは読み取れないので、「Google マップで見る」のリンク（今いる地点の URL）を貼り付けて取り込む
  panel.querySelector('#sv-paste').addEventListener('click', async () => {
    if (hooks.syncPosition) { hooks.toast((await hooks.syncPosition()) ? `今いる位置: ${point[0].toFixed(4)}, ${point[1].toFixed(4)}` : '位置を読み取れませんでした（映像の読み込み後にもう一度）'); return; } // Windows 版アプリ: 自動で読める
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch { hooks.toast('クリップボードを読み取れませんでした（許可してください）', 'error'); return; }
    const p = parseLatLng(text);
    if (!p) { hooks.toast('位置を読み取れません。ウィンドウ内の「Google マップで見る」を右クリック →「リンクのアドレスをコピー」してから押してください', 'error'); return; }
    openSvWindow(p.lat, p.lng, { heading: p.heading, pitch: p.pitch, fov: p.fov });
    hooks.toast(`位置を取り込みました: ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}（保存すると、この位置で保存されます）`);
  });
  panel.querySelector('#sv-card').addEventListener('click', async () => { await hooks.syncPosition?.(); if (point) hooks.createCard?.({ lat: point[0], lng: point[1] }); });
  panel.querySelector('#sv-save').addEventListener('click', async () => {
    await hooks.syncPosition?.(); // Windows 版アプリは、移動したあとの今いる位置を読み取る
    if (!point) return;
    const btn = panel.querySelector('#sv-save');
    btn.disabled = true;
    try { await hooks.save?.({ lat: point[0], lng: point[1], ...view }); } finally { btn.disabled = false; refreshButtons(); }
  });
  panel.querySelector('#sv-max').addEventListener('click', () => flipAnimate(panel, () => { unsnapWindow(panel); setMinNow(false); saveRect(); panel.classList.toggle('is-max'); }));
  panel.querySelector('#sv-min').addEventListener('click', () => setMin(!panel.classList.contains('is-min')));

  // パネルをヘッダーのドラッグで動かす（画面のどこへでも。スマホは下に固定）
  const head = panel.querySelector('#sv-head');
  let drag = null;
  head.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, a') || mobile()) return;
    const pr = panel.getBoundingClientRect();
    drag = { dx: e.clientX - pr.left, dy: e.clientY - pr.top, w: pr.width, sx: e.clientX, sy: e.clientY, started: false };
    head.setPointerCapture(e.pointerId);
  });
  head.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.started) { // 少し動かしてから動かし始める（ダブルクリックで拡大するときに、位置が動かないように）
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
      drag.started = true;
      if (isSnapped(panel)) { unsnapWindow(panel); drag.dx = Math.min(drag.dx, rect.width / 2); drag.w = rect.width; } // 分割から外す
      else if (panel.classList.contains('is-max')) { // 大きくしている途中で動かしたら元の大きさに戻す
        panel.classList.remove('is-max');
        place();
        drag.dx = Math.min(drag.dx, rect.width - 40);
        drag.w = rect.width;
      }
    }
    showSnapPreview(snapSideAt(e.clientX)); // 画面の左右のはしに近いときは、離したときに入る場所を見せる
    panel.style.left = `${Math.max(-drag.w + 80, Math.min(window.innerWidth - 80, e.clientX - drag.dx))}px`; // 画面の端に少し残す
    panel.style.top = `${Math.max(0, Math.min(window.innerHeight - 40, e.clientY - drag.dy))}px`;
  });
  // ヘッダーのダブルクリックで、大きく / 元の大きさ
  head.addEventListener('dblclick', (e) => {
    if (e.target.closest('button, a')) return;
    if (panel.classList.contains('is-min')) { setMin(false); return; }
    unsnapWindow(panel);
    saveRect();
    panel.classList.toggle('is-max');
  });
  const endDrag = (e) => {
    if (drag?.started) {
      const side = e.type === 'pointerup' ? snapSideAt(e.clientX) : null;
      if (side) snapWindow(panel, side, () => { panel.classList.remove('is-snap'); place(); }); // 画面の左右のはしで離したら、画面を分割
      else saveRect();
    }
    showSnapPreview(null);
    drag = null;
  };
  head.addEventListener('pointerup', endDrag);
  head.addEventListener('pointercancel', endDrag);
  // 角のドラッグで大きさを変えたときも覚える
  if ('ResizeObserver' in window) new ResizeObserver(() => { if (!panel.hidden) saveRect(); }).observe(panel);
  refreshButtons();
  return panel;
}

/** その地点のストリートビューを、ウィンドウで開く（開いていれば、場所だけ切り替える） */
export function openSvWindow(lat, lng, opts = {}) {
  ensure();
  point = [lat, lng];
  setMin(false); // 縮小していても、新しい場所を開いたら戻す
  panel.classList.remove('is-closing');
  if (panel.hidden) { panel.hidden = false; place(); bringFront(panel); setPopOrigin(panel); }
  view = { heading: Number(opts.heading) || 0, pitch: Number(opts.pitch) || 0, fov: Number(opts.fov) || 0 };
  frame.src = svEmbedUrl(lat, lng, view.heading, view.pitch, view.fov);
  panel.querySelector('#sv-coord').textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  panel.querySelector('#sv-ext').href = svOpenUrl(lat, lng, view);
  refreshButtons();
  notify();
}

export function closeSvWindow() {
  if (!panel) return;
  releaseSnap(panel);
  point = null;
  setMin(false);
  notify();
  const hide = () => { if (!panel.classList.contains('is-closing')) return; panel.classList.remove('is-closing'); if (point) return; panel.hidden = true; frame.src = 'about:blank'; };
  panel.classList.add('is-closing'); // 小さく消えるアニメーションのあとで隠す
  if (panel.hidden || document.documentElement.classList.contains('no-anim') || mobile()) { hide(); return; }
  setTimeout(hide, 170);
}

/** 映像はそのままで、今いる位置だけを更新する（Windows 版アプリが、「Google マップで見る」の押下から位置を受け取ったとき） */
export function setSvWindowPoint(lat, lng, v = {}) {
  if (!panel || panel.hidden) return;
  const nv = { heading: Number(v.heading) || 0, pitch: Number(v.pitch) || 0, fov: Number(v.fov) || 0 };
  if (point && Math.abs(point[0] - lat) < 1e-7 && Math.abs(point[1] - lng) < 1e-7 && nv.heading === view.heading && nv.pitch === view.pitch && nv.fov === view.fov) return;
  point = [lat, lng];
  view = nv;
  panel.querySelector('#sv-coord').textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  panel.querySelector('#sv-ext').href = svOpenUrl(lat, lng, view);
  refreshButtons();
  notify();
}

/** 再読み込みしても引き継ぐための、ウィンドウの状態 */
export function getSvWindowState() {
  const win = panel && !panel.hidden ? { side: snappedSide(panel), min: panel.classList.contains('is-min'), max: panel.classList.contains('is-max') } : null;
  return { point, rect, win, view };
}
/** 保存した状態から開き直す（再読み込み後。位置・大きさ・拡大・縮小・分割も戻す） */
export function restoreSvWindow(s) {
  if (!s) return;
  if (s.rect) rect = s.rect;
  if (!s.point) return;
  openSvWindow(s.point[0], s.point[1], s.view || {});
  const w = s.win;
  if (w && !mobile()) {
    if (w.side) snapWindow(panel, w.side, () => { panel.classList.remove('is-snap'); place(); }, true);
    else if (w.max) panel.classList.add('is-max');
    else if (w.min) setMinNow(true);
  }
}
