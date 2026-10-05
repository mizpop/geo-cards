// 浮かぶウィンドウ（ストリートビュー・カードや国の詳細）の共通部品: 重なり順と、画面の左右のはしへ寄せる「画面分割」
let z = 2400;
// 最後に触ったものを手前にする
export function bringFront(el) {
  if (el) el.style.zIndex = String(++z);
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
  bar.style.left = side === 'left' ? `calc(${w * 100}vw - 5px)` : `calc(${(1 - w) * 100}vw - 5px)`;
  bar.style.top = `${top}px`;
  bar.style.height = `calc(100vh - ${top}px)`;
  bar.style.zIndex = String(z + 5);
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
export function snapWindow(el, side, restore) {
  const cur = sideOf(el);
  if (cur) slots[cur] = null; // もう片側に入っていたら、こちらへ移す
  const prev = slots[side];
  slots[side] = null;
  if (prev && prev.el !== el) { prev.el.classList.remove('is-snap'); prev.restore?.(); } // その側にいた別のウィンドウは、浮かぶ状態に戻す
  slots[side] = { el, restore };
  if (slots.left && slots.right) ratio.left = ratio.right = Math.min(ratio.left, ratio.right, 1 / 3); // 左右そろったら、同じ幅で 3 つに分ける
  showSnapPreview(null);
  clearIfEmpty();
  layout();
}
// 分割をやめて、浮かぶ状態に戻す。戻したら true
export function unsnapWindow(el) {
  const side = sideOf(el);
  if (!side) return false;
  const { restore } = slots[side];
  slots[side] = null;
  el.classList.remove('is-snap');
  clearIfEmpty();
  restore?.();
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
