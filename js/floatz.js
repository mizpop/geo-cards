// 浮かぶウィンドウ（ストリートビュー・カードや国の詳細）の共通部品: 重なり順と、画面の左右のはしへ寄せる「画面分割」
let z = 2400;
// 最後に触ったものを手前にする
export function bringFront(el) {
  if (el) el.style.zIndex = String(++z);
}

// 開くときのアニメーション用: クリックした要素（キーボードで開いたときは、フォーカスのある要素）から、ウィンドウが拡大して現れるように見せる
const SRC = 'a, button, .tile, [data-open], [role="button"], li, .fan-card, .pin-card';
let lastSrc = { el: null, rect: null, t: 0 };
const remember = (el, x, y) => {
  const inMap = !!el?.closest?.('.leaflet-container') && !el.closest('button, a, .tile, .leaflet-popup, .leaflet-control, [data-card], [data-open], .hb-card');
  const target = inMap ? null : el?.closest?.(SRC) || el; // 地図の上（国・海・地図の目印）は、押した点から
  const r = target?.getBoundingClientRect?.();
  lastSrc = { el: target, rect: r && !inMap && r.width && r.height && r.width < innerWidth * 0.9 ? { left: r.left, top: r.top, width: r.width, height: r.height } : { left: x - 12, top: y - 12, width: 24, height: 24 }, t: Date.now() };
};
document.addEventListener('pointerdown', (e) => remember(e.target, e.clientX, e.clientY), true);
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { const el = document.activeElement; if (el && el !== document.body) { const r = el.getBoundingClientRect(); remember(el, r.left + r.width / 2, r.top + r.height / 2); } } }, true);
export function setPopOrigin(el) {
  let src = null;
  if (Date.now() - lastSrc.t < 2000) {
    const live = lastSrc.el?.isConnected && !lastSrc.el.closest?.('.leaflet-container') ? lastSrc.el.getBoundingClientRect() : null; // 地図の中の要素は、動くことがあるので、押した時点の位置を使う
    src = live && live.width && live.height ? live : lastSrc.rect;
  } else if (document.activeElement && document.activeElement !== document.body && !el.contains(document.activeElement)) {
    const r = document.activeElement.getBoundingClientRect();
    if (r.width && r.height) src = r;
  }
  popWindow(el, src);
}
// src: 出てくる元の位置 { left, top, width, height }（なければ、ウィンドウの中央から）。地図などから開くときは、その位置を直接渡す
export function popWindow(el, src) {
  if (document.documentElement.classList.contains('no-anim') || !el.animate) return;
  const w = { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight }; // 変形の途中でも、本来の位置と大きさ
  if (!w.width || !w.height) return;
  el.getAnimations().forEach((a) => { if (a.effect?.getKeyframes?.()[0]?.transformOrigin === '50% 50%') a.cancel(); }); // 先に始めた同じアニメーションがあれば置き換える
  const scx = src ? src.left + src.width / 2 : w.left + w.width / 2;
  const scy = src ? src.top + src.height / 2 : w.top + w.height / 2;
  const sc = src ? Math.max(0.04, Math.min(0.5, Math.max(src.width / w.width, src.height / w.height))) : 0.9;
  const dx = scx - (w.left + w.width / 2);
  const dy = scy - (w.top + w.height / 2);
  el.animate([
    { opacity: 0, transform: `translate(${dx}px, ${dy}px) scale(${sc})`, transformOrigin: '50% 50%' },
    { opacity: 1, offset: 0.3, transform: `translate(${dx * 0.5}px, ${dy * 0.5}px) scale(${(1 + sc) / 2})`, transformOrigin: '50% 50%' },
    { opacity: 1, transform: 'none', transformOrigin: '50% 50%' },
  ], { duration: 340, easing: 'cubic-bezier(.3, .1, .2, 1)' });
}
// 大きさ・位置が変わる操作（最大化・縮小など）を、元の形から新しい形へなめらかに動かす。change() の中で、クラスなどを切り替える
let flipBusy = false;
export function flipAnimate(el, change) {
  if (flipBusy || !el.animate || document.documentElement.classList.contains('no-anim') || !el.isConnected) { change(); return; }
  flipBusy = true;
  const a = el.getBoundingClientRect();
  try { change(); } finally { flipBusy = false; }
  const b = el.getBoundingClientRect();
  if (!b.width || !b.height || (Math.abs(a.left - b.left) < 1 && Math.abs(a.top - b.top) < 1 && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1)) return;
  // 縮小・元に戻す（高さだけが変わる）ときに拡大・縮小すると、見出しが縦に伸びて見えるので、中身は伸ばさずに動かす
  if (Math.abs(a.left - b.left) < 1 && Math.abs(a.width - b.width) < 1) {
    const grow = b.height > a.height;
    el.animate(
      grow ? [{ clipPath: `inset(0 0 ${b.height - a.height}px 0)` }, { clipPath: 'inset(0 0 0 0)' }] : [{ opacity: 0.55, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }],
      { duration: 200, easing: 'cubic-bezier(.2, .8, .3, 1)' },
    );
    return;
  }
  el.animate(
    [{ transformOrigin: 'top left', transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})` }, { transformOrigin: 'top left', transform: 'none' }],
    { duration: 240, easing: 'cubic-bezier(.2, .8, .3, 1)' },
  );
}

/* ---- 画面分割: ウィンドウを画面の左右のはしへドラッグして離すと、その側にウィンドウを置き、残りにアプリを並べる ----
   左右に 1 つずつ（合わせて 2 つ）まで。ヘッダーは分割せず、その下の部分だけ */
const RATIO_KEY = 'geo-cards-split-ratio-v2';
const EDGE = 28; // 画面の端から何 px 以内で離したら分割するか
const MIN_W = 0.2; // ウィンドウ 1 つの最小の幅（画面に対する割合）
const MIN_PAGE = 0.2; // ページ側に残す最小の幅
const loadRatios = () => { try { const v = JSON.parse(localStorage.getItem(RATIO_KEY)); return { left: clampR(v?.left), right: clampR(v?.right) }; } catch { return { left: 0.5, right: 0.5 }; } };
const clampR = (x) => (Number(x) >= MIN_W && Number(x) <= 1 - MIN_PAGE ? Number(x) : 0.5);
const ratio = loadRatios(); // それぞれの側のウィンドウが占める割合
const slots = { left: null, right: null }; // { el, restore: () => void }
let preview = null;
const bars = { left: null, right: null };

// 画面の端で離したときの動作: 左右の端は分割、上の端は最大化（'left' / 'right' / 'top'）
// 左下の角は、ウィンドウをしまう場所（'dock'）。左右の端より優先する
export const DOCK_CORNER = 88;
export const inDockCorner = (x, y) => x <= DOCK_CORNER && y >= window.innerHeight - DOCK_CORNER;
export const dropEdgeAt = (x, y) => (inDockCorner(x, y) ? 'dock' : snapSideAt(x) || (y <= EDGE ? 'top' : null));
export const snapSideAt = (x) => (x <= EDGE ? 'left' : x >= window.innerWidth - EDGE ? 'right' : null);
const sideOf = (el) => (slots.left?.el === el ? 'left' : slots.right?.el === el ? 'right' : null);
export const isSnapped = (el) => !!sideOf(el);
export const snappedSide = (el) => sideOf(el);
const resized = () => setTimeout(() => window.dispatchEvent(new Event('resize')), 0); // 地図などに大きさの変化を知らせる
// ヘッダー（タブの帯とデモの帯）の高さ。分割は、この下の部分だけで行う
const headerH = () => {
  const bar = document.querySelector('.topbar');
  const banner = document.getElementById('demo-banner');
  return Math.round((bar?.offsetHeight || 0) + (banner && !banner.hidden ? banner.offsetHeight : 0));
};
// 左右のどちらかに入れるときの、ウィンドウの幅の割合（反対側にもあれば、ページ側が残るように）
const widthFor = (side) => {
  const other = side === 'left' ? 'right' : 'left';
  return slots[other] ? Math.min(ratio[side], 1 - MIN_PAGE - ratio[other]) : ratio[side];
};

// ドラッグ中に、離したらどこに入るかを薄く見せる（side が null なら消す）
export function showSnapPreview(side) {
  if (!side) { preview?.remove(); preview = null; return; }
  if (!preview) {
    preview = document.createElement('div');
    preview.className = 'snap-preview';
    document.body.appendChild(preview);
  }
  preview.classList.toggle('is-dock', side === 'dock');
  if (side === 'dock') { // 左下の角: しまう場所
    Object.assign(preview.style, { left: '0', top: '', bottom: '0', width: `${DOCK_CORNER + 8}px`, height: `${DOCK_CORNER + 8}px` });
    return;
  }
  preview.style.bottom = '';
  if (side === 'top') { // 最大化したときの大きさ（画面の四方に 12px 残す）
    Object.assign(preview.style, { left: '12px', top: '12px', width: 'calc(100vw - 24px)', height: 'calc(100vh - 24px)' });
    return;
  }
  const top = headerH();
  const w = slots[side === 'left' ? 'right' : 'left'] ? Math.min(ratio[side], (1 - MIN_PAGE) / 2) : ratio[side];
  preview.style.left = side === 'left' ? '0' : `${(1 - w) * 100}vw`;
  preview.style.width = `${w * 100}vw`;
  preview.style.top = `${top}px`;
  preview.style.height = `calc(100vh - ${top}px)`;
}

function placeBar(side) {
  const slot = slots[side];
  if (!slot) { bars[side]?.remove(); bars[side] = null; return; }
  if (!bars[side]) {
    const bar = document.createElement('div');
    bar.className = 'split-bar';
    bar.title = 'ドラッグで分割の幅を変える';
    bar.setAttribute('role', 'separator');
    bar.setAttribute('aria-orientation', 'vertical');
    document.body.appendChild(bar);
    bars[side] = bar;
    let drag = false;
    bar.addEventListener('pointerdown', (e) => {
      drag = true;
      bar.setPointerCapture(e.pointerId);
      e.preventDefault();
      for (const k of ['left', 'right']) if (slots[k]) ratio[k] = widthFor(k); // 今の幅から動かす（もう一方の幅が飛ばないように）
    });
    bar.addEventListener('pointermove', (e) => {
      if (!drag || !slots[side]) return;
      const x = e.clientX / window.innerWidth;
      const want = side === 'left' ? x : 1 - x;
      const other = slots[side === 'left' ? 'right' : 'left'] ? ratio[side === 'left' ? 'right' : 'left'] : 0;
      ratio[side] = Math.max(MIN_W, Math.min(1 - MIN_PAGE - other, want)); // 反対側のウィンドウとページ側の分を残す
      layout(true);
    });
    const end = () => { if (drag) { drag = false; try { localStorage.setItem(RATIO_KEY, JSON.stringify(ratio)); } catch { /* 無視 */ } resized(); } };
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
  }
  const w = widthFor(side);
  const top = headerH();
  const bar = bars[side];
  bar.style.left = side === 'left' ? `calc(${w * 100}vw)` : `calc(${(1 - w) * 100}vw - 10px)`; // 窓の外側（ページ側）に置く
  bar.style.top = `${top}px`;
  bar.style.height = `calc(100vh - ${top}px)`;
  bar.style.zIndex = '2399'; // 窓（2400〜）より奥: 窓を重ねたり動かしたりしたとき、棒が窓の前に出ないように
}

function layout(silent = false) {
  const top = headerH();
  const l = slots.left ? widthFor('left') : 0;
  const r = slots.right ? widthFor('right') : 0;
  if (!slots.left && !slots.right) return;
  document.body.dataset.split = slots.left && slots.right ? 'both' : slots.left ? 'left' : 'right';
  document.documentElement.style.setProperty('--split-l', String(l));
  document.documentElement.style.setProperty('--split-r', String(r));
  for (const side of ['left', 'right']) {
    const slot = slots[side];
    if (!slot) continue;
    const w = side === 'left' ? l : r;
    const { el } = slot;
    el.classList.add('is-snap');
    el.classList.remove('is-max', 'is-min');
    Object.assign(el.style, {
      position: 'fixed', margin: '0', top: `${top}px`, bottom: 'auto', right: 'auto', maxHeight: 'none',
      height: `calc(100vh - ${top}px)`, width: `${w * 100}vw`, left: side === 'left' ? '0' : `${(1 - w) * 100}vw`,
    });
  }
  placeBar('left');
  placeBar('right');
  if (!silent) resized();
}

function clearIfEmpty() {
  placeBar('left');
  placeBar('right');
  if (!slots.left && !slots.right) {
    delete document.body.dataset.split;
    document.documentElement.style.removeProperty('--split-l');
    document.documentElement.style.removeProperty('--split-r');
    resized();
  } else layout();
}

// ウィンドウを side に入れる。restore: 浮かぶ状態に戻すとき（ドラッグで外したとき・縮小・拡大）に呼ぶ関数
// keep: 再読み込み・描き直しで戻すとき（保存した幅をそのまま使い、左右そろっても 3 等分に直さない）
export function snapWindow(el, side, restore, keep = false) {
  if (keep) snapNow(el, side, restore, keep); // 再読み込みで戻すときは、動きをつけない
  else flipAnimate(el, () => snapNow(el, side, restore, keep)); // 左右へ寄せるときは、なめらかに動かす
}
function snapNow(el, side, restore, keep) {
  const cur = sideOf(el);
  if (cur) slots[cur] = null; // もう片側に入っていたら、こちらへ移す
  const prev = slots[side];
  slots[side] = null;
  if (prev && prev.el !== el) { prev.el.classList.remove('is-snap'); prev.restore?.(); } // その側にいた別のウィンドウは、浮かぶ状態に戻す
  slots[side] = { el, restore };
  if (slots.left && slots.right && !keep) ratio.left = ratio.right = Math.min(ratio.left, ratio.right, 1 / 3); // 左右そろったら、同じ幅で 3 つに分ける
  showSnapPreview(null);
  clearIfEmpty();
  layout();
}
// 分割をやめて、浮かぶ状態に戻す。戻したら true
export function unsnapWindow(el) {
  const side = sideOf(el);
  if (!side) return false;
  const { restore } = slots[side];
  flipAnimate(el, () => {
    slots[side] = null;
    el.classList.remove('is-snap');
    clearIfEmpty();
    restore?.();
  });
  return true;
}
// ウィンドウを閉じたとき（元に戻す処理はしない）
export function releaseSnap(el) {
  const side = sideOf(el);
  if (!side) return;
  slots[side] = null;
  el.classList.remove('is-snap');
  clearIfEmpty();
}

// ヘッダーの高さが変わったとき（帯が出入りしたなど）は、ウィンドウの位置を合わせ直す
if ('ResizeObserver' in window) {
  const watch = () => { const bar = document.querySelector('.topbar'); if (bar) new ResizeObserver(() => layout(true)).observe(bar); else setTimeout(watch, 500); };
  watch();
}
